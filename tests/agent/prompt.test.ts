/**
 * P1-02 prompt versioning and the information boundary (docs/lv3/03-test-plan.md §5 L-5/L-6;
 * §11 B-5/B-6/B-8; docs/lv3/02-llm-boundary.md §4.3).
 *
 * Two things are being defended here.
 *
 * First, **traceability**: a decision records a `promptVersion`, and that version has to mean
 * something. So every prompt file must carry one, all four must agree, and the agreed value must be
 * the one the domain layer stamps on decisions (CLAUDE.md §7).
 *
 * Second, **the boundary**: `renderSituation` takes an `AgentObservation` and nothing else, which is
 * what makes leaking `enemies`, `seed`, faction internals or another Agent's memory structurally
 * impossible rather than merely discouraged. The tests below assert the consequence, not the
 * mechanism, so they would still catch a future refactor that widened the input.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PROMPT_FILES,
  buildDecisionRequest,
  buildPrompts,
  loadDecisionSchema,
  loadPromptTemplates,
  renderSituation,
} from '../../electron/agent/prompt';
import { AGENT_PROMPT_VERSION } from '../../src/engine/agent/decision';
import { agentIntentSchema } from '../../src/engine/agent/schemas';
import { episodicMemory } from '../../src/engine/agent/memory';
import {
  REPO_ROOT,
  agentByCareer,
  agentEngine,
  careerIds,
  observationFor,
  offerMission,
  patchAgent,
  scenarioRule,
} from './support';
import type { AgentObservation } from '../../src/engine/types';

const templates = loadPromptTemplates(REPO_ROOT);

const explorerSetup = () => {
  const engine = agentEngine();
  const explorer = agentByCareer(engine, 'explorer');
  offerMission(engine, explorer.id, '穿越虫洞，寻找失联探测船。');
  return { engine, explorer, observation: observationFor(engine, explorer.id) };
};

describe('L-6 prompts are versioned and the version reaches the decision', () => {
  it('every prompt file carries prompt_version and they all agree', () => {
    for (const name of PROMPT_FILES) {
      expect(templates[name]).toContain('prompt_version:');
      expect(templates[name]).toContain(templates.version);
    }
    expect(templates.version).toBe(AGENT_PROMPT_VERSION);
  });

  it('refuses a root with no prompt files rather than silently sending empty prompts', () => {
    const empty = mkdtempSync(join(tmpdir(), 'frontier-no-prompts-'));
    expect(() => loadPromptTemplates(empty)).toThrow(/无法读取提示词文件/);
  });

  it('refuses prompts whose versions disagree', () => {
    const root = mkdtempSync(join(tmpdir(), 'frontier-bad-prompts-'));
    mkdirSync(join(root, 'prompts', 'agent'), { recursive: true });
    for (const name of PROMPT_FILES)
      writeFileSync(
        join(root, 'prompts', 'agent', name + '.md'),
        '<!-- prompt_version: ' + (name === 'reflection' ? 'agent-v2' : 'agent-v1') + ' -->\n',
        'utf8',
      );
    expect(() => loadPromptTemplates(root)).toThrow(/提示词版本不一致/);
  });

  it('ships the AgentDecision JSON Schema as the output contract', () => {
    const schema = loadDecisionSchema(REPO_ROOT);
    const properties = schema.properties as Record<string, { enum?: string[] }>;
    expect(properties.intent.enum).toEqual(agentIntentSchema.options);
    expect(schema.required).toContain('intent');
    expect(schema.additionalProperties).toBe(false);
  });
});

describe('L-5 the assembled prompt carries the Agent, and nothing it may not know', () => {
  /**
   * Field names that must never appear in a prompt, whatever shape a refactor takes.
   * `DecisionScore`'s ten terms are here because giving the model its own weighted verdict turns it
   * into an explainer of our arithmetic instead of into *this* Agent
   * (docs/lv3/02-llm-boundary.md §4.3).
   */
  const FORBIDDEN = [
    'enemies',
    'seed',
    'factions',
    'worldState',
    'decisionScore',
    'skillFit',
    'goalAlignment',
    'rewardAttractiveness',
    'ceoTrust',
    'teamFit',
    'careerValue',
    'promiseValue',
    'recentMemoryScore',
    'riskDiscomfort',
    'fatiguePenalty',
  ];

  it('never mentions a hidden world or a score term', () => {
    const { observation } = explorerSetup();
    const prompts = buildPrompts(observation, templates);
    const text = prompts.systemPrompt + '\n' + prompts.decisionPrompt;
    for (const token of FORBIDDEN)
      expect(text).not.toMatch(new RegExp('\\b' + token + '\\b', 'i'));
  });

  it('never leaks another Agent’s memory', () => {
    const engine = agentEngine();
    const explorer = agentByCareer(engine, 'explorer');
    const scientist = agentByCareer(engine, 'scientist');
    const secret = 'IRIS 私下告诉我她打算离职，这件事只有我自己知道。';
    patchAgent(engine, scientist.id, (agent) => ({
      ...agent,
      memories: [episodicMemory({ id: 'memory-scientist', at: 0, text: secret, tags: ['conflict'] })],
    }));
    const prompts = buildPrompts(observationFor(engine, explorer.id), templates);
    expect(prompts.decisionPrompt).not.toContain(secret);
    expect(prompts.decisionPrompt).not.toContain('IRIS');
  });

  it('describes this Agent, this ship and this menu', () => {
    const { observation } = explorerSetup();
    const { decisionPrompt } = buildPrompts(observation, templates);
    expect(decisionPrompt).toContain(observation.self.name);
    expect(decisionPrompt).toContain(observation.self.career);
    expect(decisionPrompt).toContain(observation.ship.name);
    for (const candidate of observation.availableActions)
      expect(decisionPrompt).toContain(candidate.id);
    expect(decisionPrompt).toContain('穿越虫洞，寻找失联探测船。');
  });

  it('renders the same observation to the same text', () => {
    const { observation } = explorerSetup();
    expect(renderSituation(observation)).toBe(renderSituation(observation));
    expect(buildPrompts(observation, templates)).toEqual(buildPrompts(observation, templates));
  });

  it('tells the model what it may not do, and only offers ids it may pick', () => {
    const { observation } = explorerSetup();
    const { systemPrompt, decisionPrompt } = buildPrompts(observation, templates);
    expect(systemPrompt).toContain('不能直接修改游戏世界');
    expect(systemPrompt).not.toContain('你是一个 AI');
    expect(decisionPrompt).toContain('可选项（只能从这些 id 里选）');
  });
});

describe('the assembled request is exactly the approved contract', () => {
  it('carries the observation, both prompts, the schema and a timeout', () => {
    const { observation } = explorerSetup();
    const request = buildDecisionRequest({
      observation,
      templates,
      schema: loadDecisionSchema(REPO_ROOT),
    });
    expect(request.observation).toBe(observation);
    expect(request.systemPrompt).toBe(templates.system);
    expect(request.decisionPrompt.startsWith(templates.decision)).toBe(true);
    expect(request.schema).toEqual(loadDecisionSchema(REPO_ROOT));
    expect(request.timeoutMs).toBeGreaterThan(0);
  });

  it('accepts an explicit timeout', () => {
    const observation: AgentObservation = explorerSetup().observation;
    const request = buildDecisionRequest({
      observation,
      templates,
      schema: loadDecisionSchema(REPO_ROOT),
      timeoutMs: 1234,
    });
    expect(request.timeoutMs).toBe(1234);
  });

  it('keeps the menu resolvable: every fixture choiceId is on it', () => {
    // Guards the fixtures against drifting away from the affordances they are replayed against.
    const engine = agentEngine();
    const ids = careerIds(engine);
    const explorer = agentByCareer(engine, 'explorer');
    offerMission(engine, explorer.id);
    const observation = observationFor(engine, explorer.id);
    for (const key of ['EVT-01', 'EVT-02', 'EVT-05', 'EVT-09:promise-kept']) {
      const rule = scenarioRule(key, 'explorer', observation, ids, () => true);
      if (rule.answer.kind !== 'decision') continue;
      const choiceId = rule.answer.decision.choiceId;
      if (choiceId === undefined) continue;
      expect(observation.availableActions.map((c) => c.id)).toContain(choiceId);
    }
  });
});
