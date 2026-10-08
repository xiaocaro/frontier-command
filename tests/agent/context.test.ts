/**
 * P2 the prompt / context layer (playbook §22 prompt fixtures, §23 Agent differentiation, §24 memory
 * context; docs/lv3/02-llm-boundary.md §4).
 *
 * The provider tests next door answer "does the wire work?". This file answers the question that
 * actually decides whether the live model is *this Agent* or a generic assistant: **does the prompt
 * carry who this Agent is?** So everything here is asserted at the Observation → Prompt boundary —
 * what the model is told — and then carried one step further to Observation → Prompt → Structured
 * Decision, to prove the same context that reaches a real model is one the recorded fixture can
 * answer. It deliberately stops there: no assertion in this file looks at world state, because the
 * model has no authority over it (Rule 1).
 *
 * The negative half matters as much as the positive one. A prompt that mentions the Agent's career
 * *and also* leaks faction internals would still pass a "contains the career" test, so the forbidden
 * material is asserted absent too.
 */
import { describe, it, expect } from 'vitest';
import { MockModelClient } from '../../electron/agent/mock-client';
import { buildPrompts, loadPromptTemplates } from '../../electron/agent/prompt';
import { createPromise } from '../../src/engine/agent/promise';
import { episodicMemory } from '../../src/engine/agent/memory';
import { agentDecisionSchema } from '../../src/engine/agent/schemas';
import type { SimulationEngine } from '../../src/engine/engine';
import type { AgentCareer, AgentObservation } from '../../src/engine/types';
import {
  REPO_ROOT,
  agentByCareer,
  agentEngine,
  agentRuntime,
  careerIds,
  observationFor,
  offerMission,
  patchAgent,
  requestTeamUp,
  scenarioRule,
  scenarioRules,
} from './support';

const templates = loadPromptTemplates(REPO_ROOT);

/** The situation text handed to the provider, i.e. everything the model gets beyond the system role. */
function situationOf(observation: AgentObservation): string {
  return buildPrompts(observation, templates).decisionPrompt;
}

interface Built {
  engine: SimulationEngine;
  ids: Record<AgentCareer, string>;
  observation: AgentObservation;
}

/** A mission offer is waiting for the Explorer (the situation EVT-01 and EVT-02 both start from). */
function missionWaiting(text = '穿越虫洞，寻找失联探测船，确认发生了什么。'): Built {
  const engine = agentEngine();
  const ids = careerIds(engine);
  const explorer = agentByCareer(engine, 'explorer');
  offerMission(engine, explorer.id, text);
  return { engine, ids, observation: observationFor(engine, explorer.id) };
}

/** The Explorer has asked the Tactical officer to fly with them (EVT-03). */
function teamUpRequest(): Built {
  const engine = agentEngine();
  const ids = careerIds(engine);
  const explorer = agentByCareer(engine, 'explorer');
  const tactical = agentByCareer(engine, 'tactical');
  requestTeamUp(engine, explorer.id, tactical.id);
  return { engine, ids, observation: observationFor(engine, tactical.id) };
}

/** The Explorer is out in the dark with something on the sensors and nothing in the inbox (EVT-05). */
function anomalyFound(): Built {
  const engine = agentEngine();
  const ids = careerIds(engine);
  const explorer = agentByCareer(engine, 'explorer');
  return { engine, ids, observation: observationFor(engine, explorer.id) };
}

/** An Admiral promise is outstanding (EVT-07 promise variant). */
function promiseOutstanding(): Built {
  const engine = agentEngine();
  const ids = careerIds(engine);
  const explorer = agentByCareer(engine, 'explorer');
  patchAgent(engine, explorer.id, (agent) => ({
    ...agent,
    promises: [
      createPromise({
        id: 'promise-deep-scan',
        to: explorer.id,
        type: 'equipment',
        description: '任务完成后给这艘船装 Deep Scan 模块。',
        fulfills: { kind: 'grant-module', key: 'deepScan' },
        createdAt: 0,
      }),
    ],
  }));
  offerMission(engine, explorer.id);
  return { engine, ids, observation: observationFor(engine, explorer.id) };
}

/**
 * §22's event table. Each row is a real situation from docs/lv3/01-mvp-scenario.md, the career that
 * lives it, the recording that answers it, and something that is true of *this Agent in this moment*
 * and therefore has to be visible in the prompt.
 */
const EVENTS: {
  id: string;
  fixtureKey: string;
  career: AgentCareer;
  build: () => Built;
  promptMustContain: string[];
}[] = [
  {
    id: 'EVT-01 Explorer receives mission',
    fixtureKey: 'EVT-01',
    career: 'explorer',
    build: () => missionWaiting(),
    promptMustContain: ['失联探测船', '职业：explorer', '个人目标'],
  },
  {
    id: 'EVT-02 Explorer counteroffers',
    fixtureKey: 'EVT-02',
    career: 'explorer',
    build: () => missionWaiting(),
    promptMustContain: ['未读消息', '可对话的 Agent'],
  },
  {
    id: 'EVT-03 Tactical receives team-up request',
    fixtureKey: 'EVT-03',
    career: 'tactical',
    build: () => teamUpRequest(),
    promptMustContain: ['team-request', '职业：tactical'],
  },
  {
    id: 'EVT-05 Explorer discovers an anomaly',
    fixtureKey: 'EVT-05',
    career: 'explorer',
    build: () => anomalyFound(),
    promptMustContain: ['可选项（只能从这些 id 里选）'],
  },
  {
    id: 'EVT-07 promise / override',
    fixtureKey: 'EVT-07:promise',
    career: 'explorer',
    build: () => promiseOutstanding(),
    promptMustContain: ['未兑现的承诺', 'Deep Scan'],
  },
];

describe('§22 every MVP event is rendered from its observation and validates back', () => {
  it.each(EVENTS)('$id', ({ fixtureKey, career, build, promptMustContain }) => {
    const { ids, observation } = build();
    const prompt = situationOf(observation);

    // The situation is this Agent's, and it carries the facts the decision has to be reasoned from.
    for (const fragment of promptMustContain) expect(prompt).toContain(fragment);
    expect(prompt).toContain(observation.self.name);
    expect(prompt).toContain('tick ' + observation.tick);
    // …and nothing that is not this Agent's to know (docs/lv3/02-llm-boundary.md §4.3).
    for (const forbidden of ['enemies', 'seed', 'factions', 'DecisionScore'])
      expect(prompt).not.toContain(forbidden);

    // Observation → Prompt → Structured Decision: the recorded answer still validates as a decision.
    const rule = scenarioRule(fixtureKey, career, observation, ids);
    return agentRuntime(new MockModelClient({ rules: [rule] }))
      .requestDecision(observation)
      .then((outcome) => {
        expect(outcome.status).toBe('decided');
        if (outcome.status !== 'decided') return;
        expect(agentDecisionSchema.safeParse(outcome.decision).success).toBe(true);
        expect(outcome.decision.provider).toBe('llm');
        expect(outcome.decision.observationTick).toBe(observation.tick);
      });
  });

  it('the same event read by a different career is a different prompt', () => {
    // EVT-06 is the case where the *situation* is identical and only the Agent differs, which is the
    // cleanest way to show the prompt is built from the Agent and not from the event.
    const engine = agentEngine();
    const explorer = agentByCareer(engine, 'explorer');
    offerMission(engine, explorer.id, '异常数据出现了，下一步怎么办？', 'ask');
    const prompts = (['explorer', 'scientist', 'tactical', 'logistics'] as const).map(
      (career) => situationOf(observationFor(engine, agentByCareer(engine, career).id)),
    );
    expect(new Set(prompts).size).toBe(4);
    for (const [index, career] of (['explorer', 'scientist', 'tactical', 'logistics'] as const).entries())
      expect(prompts[index]).toContain('职业：' + career);
  });
});

describe('§23 the same mission reaches four Agents as four different contexts', () => {
  it('each Agent is told its own goal, personality and state — and decides differently', async () => {
    const engine = agentEngine();
    const ids = careerIds(engine);
    const explorer = agentByCareer(engine, 'explorer');
    offerMission(engine, explorer.id, '异常数据出现了，下一步怎么办？', 'ask');
    const anchor = observationFor(engine, explorer.id);

    const seen: { career: AgentCareer; prompt: string; answer: string }[] = [];
    for (const career of ['explorer', 'scientist', 'tactical', 'logistics'] as const) {
      const agent = agentByCareer(engine, career);
      const observation = observationFor(engine, agent.id);
      const prompt = situationOf(observation);

      // The three sections that make the Agent an individual, each carrying this Agent's own values.
      expect(prompt).toContain('职业：' + career);
      expect(prompt).toContain(agent.goal.title);
      expect(prompt).toContain('风险偏好 ' + round(agent.personality.riskTolerance));
      expect(prompt).toContain('士气 ' + round(agent.state.morale));

      const outcome = await agentRuntime(
        new MockModelClient({ rules: scenarioRules('EVT-06', anchor, ids) }),
      ).requestDecision(observation);
      if (outcome.status !== 'decided') throw new Error('expected a decision for ' + career);
      seen.push({
        career,
        prompt,
        answer:
          outcome.decision.intent +
          '|' +
          (outcome.decision.request?.type ?? outcome.decision.choiceId ?? '-'),
      });
    }

    expect(new Set(seen.map((s) => s.prompt)).size).toBe(4);
    expect(new Set(seen.map((s) => s.answer)).size).toBe(4);
  });
});

describe('§24 the same Agent with a different past gets a different context', () => {
  /**
   * Two histories, one identical new mission:
   *   A — the Admiral kept a promise: trust high, the memory is that he can be believed.
   *   B — the Admiral forced an Override: trust low, the memory is that judgement was overruled.
   *
   * playbook §24 does not ask for proof that a live model would answer differently. It asks for the
   * weaker, checkable thing: that the two histories produce *different decision inputs*. That is what
   * is asserted — on the prompt, which is the only thing the model ever sees.
   */
  function history(kind: 'kept' | 'forced'): { observation: AgentObservation; prompt: string } {
    const engine = agentEngine();
    const explorer = agentByCareer(engine, 'explorer');
    const kept = kind === 'kept';
    patchAgent(engine, explorer.id, (agent) => ({
      ...agent,
      state: { ...agent.state, trustInAdmiral: kept ? 90 : 20 },
      memories: [
        kept
          ? episodicMemory({
              id: 'memory-kept',
              at: 0,
              text: 'Admiral 兑现了 Deep Scan 的承诺。',
              tags: ['promise-kept'],
            })
          : episodicMemory({
              id: 'memory-forced',
              at: 0,
              text: 'Admiral 强制我执行 RETURN，无视我的判断。',
              tags: ['admiral-override'],
            }),
      ],
    }));
    offerMission(engine, explorer.id, '又出现一个高风险调查机会，你去不去？');
    const observation = observationFor(engine, explorer.id);
    return { observation, prompt: situationOf(observation) };
  }

  it('the trust the Agent holds is in the context, at its own value', () => {
    const kept = history('kept');
    const forced = history('forced');
    expect(kept.prompt).toContain('对 Admiral 的信任 90');
    expect(forced.prompt).toContain('对 Admiral 的信任 20');
  });

  it('the memory of what happened is in the context, as itself', () => {
    const kept = history('kept');
    const forced = history('forced');
    expect(kept.prompt).toContain('promise-kept');
    expect(kept.prompt).toContain('Admiral 兑现了 Deep Scan 的承诺。');
    expect(forced.prompt).toContain('admiral-override');
    expect(forced.prompt).toContain('Admiral 强制我执行 RETURN，无视我的判断。');
  });

  it('the same new mission therefore arrives as two different contexts', () => {
    const kept = history('kept');
    const forced = history('forced');
    expect(kept.prompt).not.toBe(forced.prompt);
    // Same mission text in both, so the difference is the Agent's past and nothing else.
    expect(kept.prompt).toContain('又出现一个高风险调查机会，你去不去？');
    expect(forced.prompt).toContain('又出现一个高风险调查机会，你去不去？');
  });

  it('and the recorded answers differ, so the difference survives the whole pipeline', async () => {
    const answers: string[] = [];
    for (const kind of ['kept', 'forced'] as const) {
      const engine = agentEngine();
      const explorer = agentByCareer(engine, 'explorer');
      const kept = kind === 'kept';
      patchAgent(engine, explorer.id, (agent) => ({
        ...agent,
        state: { ...agent.state, trustInAdmiral: kept ? 90 : 20 },
      }));
      offerMission(engine, explorer.id, '又出现一个高风险调查机会，你去不去？');
      const observation = observationFor(engine, explorer.id);
      const ids = careerIds(engine);
      const outcome = await agentRuntime(
        new MockModelClient({
          rules: [
            scenarioRule(
              kept ? 'EVT-09:promise-kept' : 'EVT-09:override',
              'explorer',
              observation,
              ids,
              (o) => (o.self.state.trustInAdmiral >= 60) === kept,
            ),
          ],
        }),
      ).requestDecision(observation);
      if (outcome.status !== 'decided') throw new Error('expected a decision for ' + kind);
      answers.push(String(outcome.decision.choiceId));
    }
    expect(answers).toEqual(['accept', 'counteroffer']);
  });
});

/** Matches the prompt renderer's own rounding, so the assertion is about content, not formatting. */
function round(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}
