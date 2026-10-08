/**
 * Prompt assembly (Agent.md §56/§57, docs/lv3/02-llm-boundary.md §4, CLAUDE.md §7).
 *
 * Prompts live in `prompts/agent/*.md`, versioned, outside the business logic — not buried in
 * TypeScript. This module is the only thing that reads them, and it does two jobs:
 *
 *  1. **Load + version check.** Every file carries `prompt_version`; all four must agree, and
 *     `AgentDecision.promptVersion` records that version so a decision can be traced back to the
 *     wording that produced it (CLAUDE.md §7).
 *  2. **Render the situation** from an `AgentObservation` — and *only* from an observation.
 *
 * The second point is the whole information boundary in one function. `renderSituation` takes no
 * `WorldState`, so `enemies`, `seed`, faction internals, other Agents' memories and undiscovered
 * geography cannot reach a prompt even by accident: they are not in its input type. The same is true
 * of `DecisionScore` and its ten terms — the model is told *who this Agent is*, never *what we
 * think they should answer* (docs/lv3/02-llm-boundary.md §4.3).
 *
 * Pure assembly apart from the two loaders, which read files and nothing else.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSocialChoiceId } from '../../src/engine/agent/actions';
import type { AgentMessage, AgentObservation } from '../../src/engine/agent/types';
import type { DecisionRequest, JsonSchema } from './model-client';
import { DEFAULT_DECISION_TIMEOUT_MS } from './model-client';

/** Prompt files, all required, all carrying the same `prompt_version`. */
export const PROMPT_FILES = ['system', 'decision', 'conversation', 'reflection'] as const;
export type PromptFileName = (typeof PROMPT_FILES)[number];

const VERSION_PATTERN = /prompt_version:\s*([A-Za-z0-9._-]+)/;

export interface PromptTemplates {
  /** The agreed `prompt_version` across every file (e.g. `agent-v2`). */
  version: string;
  system: string;
  decision: string;
  conversation: string;
  reflection: string;
}

function readPromptFile(root: string, name: PromptFileName): { text: string; version: string } {
  const path = join(root, 'prompts', 'agent', name + '.md');
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error('无法读取提示词文件 ' + path + '：' + String(error));
  }
  const match = VERSION_PATTERN.exec(text);
  if (!match) throw new Error('提示词文件缺少 prompt_version：' + path);
  return { text, version: match[1] };
}

/**
 * Loads `prompts/agent/*.md` from `root` (the repository root in dev, `app.getAppPath()` when
 * packaged — `prompts/**` must therefore be listed in `package.json`'s `build.files`).
 *
 * A version mismatch between files is an error rather than a warning: a decision stamped with a
 * version that only half the prompt actually had is untraceable, which defeats the point of
 * versioning.
 */
export function loadPromptTemplates(root: string): PromptTemplates {
  const loaded = PROMPT_FILES.map((name) => ({ name, ...readPromptFile(root, name) }));
  const [first, ...rest] = loaded;
  for (const file of rest)
    if (file.version !== first.version)
      throw new Error(
        '提示词版本不一致：' + first.name + '=' + first.version + '，' + file.name + '=' + file.version,
      );
  const byName = new Map(loaded.map((file) => [file.name, file.text]));
  return {
    version: first.version,
    system: byName.get('system')!,
    decision: byName.get('decision')!,
    conversation: byName.get('conversation')!,
    reflection: byName.get('reflection')!,
  };
}

/**
 * The `AgentDecision` JSON Schema, read from `schemas/` rather than copied into TypeScript: the
 * schema under `schemas/` is the cross-tool contract (CLAUDE.md §6) and a second copy here would
 * drift from it silently.
 */
export function loadDecisionSchema(root: string): JsonSchema {
  const path = join(root, 'schemas', 'agent-decision.schema.json');
  return JSON.parse(readFileSync(path, 'utf8')) as JsonSchema;
}

const num = (value: number): string => (Math.round(value * 100) / 100).toString();

function section(title: string, lines: readonly string[]): string {
  return ['## ' + title, ...(lines.length ? lines : ['- （无）'])].join('\n');
}

function messageLine(message: AgentMessage): string {
  return (
    '- [' +
    message.kind +
    '] ' +
    message.from +
    ' → ' +
    message.to +
    '：' +
    message.text +
    (message.payload ? '（' + JSON.stringify(message.payload) + '）' : '')
  );
}

/**
 * The Agent's situation, as text.
 *
 * Deliberately a projection of `AgentObservation` and nothing else — see the module comment. Lists
 * are rendered in the order the observation already fixed, so the same observation always renders
 * the same prompt (the deterministic-replay guarantee of docs/lv3/03-api-contract.md §7).
 */
export function renderSituation(observation: AgentObservation): string {
  const { self, ship } = observation;
  const blocks: string[] = [];

  blocks.push(
    section('时间', [
      '- 游戏内时间：' + num(observation.time) + ' 分钟（tick ' + observation.tick + '）',
    ]),
  );

  blocks.push(
    section('我自己', [
      '- 姓名：' + self.name,
      '- 职业：' + self.career,
      '- 个人目标：' + self.goal.title + '（' + self.goal.kind + '，进度 ' + num(self.goal.progress) + '）',
      '- 人格：风险偏好 ' +
        num(self.personality.riskTolerance) +
        '，好奇心 ' +
        num(self.personality.curiosity) +
        '，忠诚 ' +
        num(self.personality.loyalty) +
        '，合作 ' +
        num(self.personality.cooperation) +
        '，野心 ' +
        num(self.personality.ambition),
      '- 状态：疲劳 ' +
        num(self.state.fatigue) +
        '，压力 ' +
        num(self.state.stress) +
        '，士气 ' +
        num(self.state.morale) +
        '，对 Admiral 的信任 ' +
        num(self.state.trustInAdmiral) +
        '，对公司忠诚 ' +
        num(self.state.loyaltyToCompany) +
        '，经验 ' +
        num(self.state.experience),
    ]),
  );

  blocks.push(
    section(
      '当前指令',
      observation.activeDirective
        ? [
            '- ' +
              observation.activeDirective.actionType +
              '（来源：' +
              observation.activeDirective.source +
              '）' +
              (observation.activeDirective.note ? '：' + observation.activeDirective.note : ''),
          ]
        : [],
    ),
  );

  blocks.push(
    section('我的船', [
      '- ' +
        ship.name +
        '（' +
        ship.classId +
        '，状态 ' +
        ship.status +
        '，位置 ' +
        num(ship.x) +
        '/' +
        num(ship.y) +
        '）',
      '- 船体 ' + num(ship.hull) + '，护盾 ' + num(ship.shield) + '，核心 ' + num(ship.core),
      '- 光子鱼雷 ' + ship.photon + '，量子鱼雷 ' + ship.quantum,
      '- 模块：' + (ship.modules.length ? ship.modules.join('、') : '无'),
    ]),
  );

  blocks.push(
    section('公司', [
      '- 预算：' + num(observation.company.credits) + ' credits',
      '- 边境紧张度：' + num(observation.company.tension),
      '- 当前重点：' +
        (observation.company.priorities.length ? observation.company.priorities.join('、') : '无'),
    ]),
  );

  blocks.push(
    section(
      '可对话的 Agent',
      observation.relationships.map(
        (r) =>
          '- ' +
          r.targetAgentId +
          '：关系 ' +
          num(r.value) +
          '，信任 ' +
          num(r.trust) +
          '，合作 ' +
          num(r.cooperation),
      ),
    ),
  );

  blocks.push(
    section(
      '未读消息',
      observation.pendingMessages.map(messageLine),
    ),
  );

  blocks.push(
    section(
      '最近记忆',
      observation.recentMemory.map(
        (memory) =>
          '- （' +
          memory.kind +
          '）' +
          (memory.kind === 'episodic'
            ? memory.tags.join('/') + '：' + memory.text
            : memory.text),
      ),
    ),
  );

  blocks.push(
    section(
      '未兑现的承诺',
      observation.activePromise
        ? [
            '- ' +
              observation.activePromise.type +
              '：' +
              observation.activePromise.description +
              '（' +
              observation.activePromise.status +
              '，' +
              observation.activePromise.createdAt +
              ' 分钟时作出）',
          ]
        : [],
    ),
  );

  blocks.push(
    section(
      '已知接触',
      observation.contacts.map(
        (contact) =>
          '- ' +
          contact.id +
          '（' +
          (contact.name ?? '未识别') +
          '，' +
          (contact.hostile ? '敌对' : '非敌对') +
          '，位置 ' +
          num(contact.x) +
          '/' +
          num(contact.y) +
          '）',
      ),
    ),
  );

  blocks.push(
    section(
      '已知机会',
      observation.opportunities.map((o) => '- [' + o.kind + '] ' + o.text),
    ),
  );

  blocks.push(
    section(
      '可选项（只能从这些 id 里选）',
      observation.availableActions.map(
        (candidate) =>
          '- ' +
          candidate.id +
          '：' +
          candidate.label +
          // Which `intent` this option is legal under, said where the choice is made.
          //
          // This line exists because of a live failure, not a theory: the menu mixes two kinds of
          // option and they are **not** interchangeable. A physical option (`explore:0/-1`) is
          // chosen with `act`; a social one (`accept`, `team-accept:<id>`) is chosen with `respond`,
          // and `validateDecisionShape` rejects `act` + a social id outright — `act` means "submit
          // this Action to the engine", and a social option is not an Action
          // (src/engine/agent/decision.ts). Nothing in the menu used to say so, and a real DeepSeek
          // call answered `{"intent":"act","choiceId":"accept"}` — a defensible reading of the old
          // wording, and a rejected decision. Stating the pairing per candidate removes the
          // ambiguity at the point of decision instead of asking the model to cross-reference a rule.
          '｜intent：' +
          (isSocialChoiceId(candidate.id) ? 'respond' : 'act') +
          '｜风险 ' +
          num(candidate.risk) +
          '｜回报 ' +
          num(candidate.reward) +
          (candidate.goalKinds.length ? '｜服务于 ' + candidate.goalKinds.join('/') : '') +
          (candidate.requirements.length
            ? '｜条件：' + candidate.requirements.join('；')
            : ''),
      ),
    ),
  );

  return blocks.join('\n\n');
}

/** The two prompt strings a provider receives. */
export function buildPrompts(
  observation: AgentObservation,
  templates: PromptTemplates,
): { systemPrompt: string; decisionPrompt: string } {
  return {
    systemPrompt: templates.system,
    decisionPrompt: templates.decision + '\n\n# 当前态势\n\n' + renderSituation(observation),
  };
}

/** Assembles the full provider request. Pure. */
export function buildDecisionRequest(input: {
  observation: AgentObservation;
  templates: PromptTemplates;
  schema: JsonSchema;
  timeoutMs?: number;
}): DecisionRequest {
  const { systemPrompt, decisionPrompt } = buildPrompts(input.observation, input.templates);
  return {
    observation: input.observation,
    systemPrompt,
    decisionPrompt,
    schema: input.schema,
    timeoutMs: input.timeoutMs ?? DEFAULT_DECISION_TIMEOUT_MS,
  };
}
