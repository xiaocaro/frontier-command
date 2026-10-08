/**
 * P1-04 the decision runtime (docs/lv3/03-test-plan.md §5/§6/§7, L-1 … L-6, DEC-11;
 * docs/lv3/04-foundation-status.md §6 item 6).
 *
 * The runtime's whole job is to make the answer *safe*: validate what came back, and when it cannot
 * be validated, produce a deterministic decision in the same shape instead of nothing. So the tests
 * below are mostly about what happens when the provider misbehaves — that is the case that decides
 * whether an unavailable model is an inconvenience or an outage.
 *
 * Nothing here touches the network, a clock, or a `SimulationEngine`'s state.
 */
import { describe, it, expect } from 'vitest';
import { MockModelClient } from '../../electron/agent/mock-client';
import { scoringAgent } from '../../electron/agent/runtime';
import type { ModelClient } from '../../electron/agent/model-client';
import { AGENT_PROMPT_VERSION, STALE_TICK_LIMIT } from '../../src/engine/agent/decision';
import { decisionScore } from '../../src/engine/agent/score';
import { episodicMemory } from '../../src/engine/agent/memory';
import { agentDecisionSchema } from '../../src/engine/agent/schemas';
import { run } from '../helpers';
import {
  agentByCareer,
  agentEngine,
  agentRuntime,
  careerIds,
  failureRule,
  observationFor,
  offerMission,
  patchAgent,
  scenarioRule,
  scenarioRules,
} from './support';
import type { AgentDecision, AgentObservation } from '../../src/engine/types';

/** The situation EVT-01 starts from: a mission is waiting for an answer. */
function missionWaiting() {
  const engine = agentEngine();
  const ids = careerIds(engine);
  const explorer = agentByCareer(engine, 'explorer');
  offerMission(engine, explorer.id);
  const observation = observationFor(engine, explorer.id);
  return { engine, ids, explorer, observation };
}

/**
 * A provider that lies about its own success: it returns `{ ok: true }` with whatever it likes.
 * The real providers never do this, but the runtime must not depend on that — `{ ok: true }` is a
 * claim, not a proof.
 */
function lyingClient(decision: unknown): ModelClient {
  return {
    id: 'liar',
    promptVersion: 'agent-v1',
    decide: async () => ({ ok: true, decision: decision as AgentDecision, latencyMs: 0 }),
  };
}

const firstOffered = (observation: AgentObservation): string => {
  const candidate = observation.availableActions[0];
  if (!candidate) throw new Error('observation offers nothing to choose');
  return candidate.id;
};

describe('the happy path is the pipeline, end to end', () => {
  it('returns the provider’s decision once it validates', async () => {
    const { ids, observation } = missionWaiting();
    const client = new MockModelClient({
      rules: [scenarioRule('EVT-01', 'explorer', observation, ids)],
    });
    const trace: string[] = [];
    const outcome = await agentRuntime(client, (t) => trace.push(t.outcome)).requestDecision(
      observation,
    );
    expect(outcome.status).toBe('decided');
    if (outcome.status !== 'decided') return;
    expect(outcome.decision.intent).toBe('respond');
    expect(outcome.decision.choiceId).toBe('counteroffer');
    expect(outcome.decision.provider).toBe('llm');
    expect(outcome.decision.observationTick).toBe(observation.tick);
    expect(outcome.decision.promptVersion).toBe(AGENT_PROMPT_VERSION);
    expect(outcome.trace.outcome).toBe('provider');
    expect(outcome.trace.fallbackUsed).toBe(false);
    expect(outcome.trace.providerFailure).toBeNull();
    expect(trace).toEqual(['provider']);
  });

  it('traces the decision without persisting anything', async () => {
    const { ids, observation } = missionWaiting();
    const client = new MockModelClient({
      rules: [scenarioRule('EVT-02', 'explorer', observation, ids)],
    });
    const outcome = await agentRuntime(client).requestDecision(observation);
    if (outcome.status !== 'decided') throw new Error('expected a decision');
    expect(outcome.trace.decisionId).toBe(observation.agentId + '@' + observation.tick);
    expect(outcome.trace.agentId).toBe(observation.agentId);
    expect(outcome.trace.provider).toBe('mock');
    expect(outcome.trace.decision).toEqual(outcome.decision);
  });

  it('is deterministic: the same observation and the same fixture give the same answer', async () => {
    const { ids, observation } = missionWaiting();
    const rules = [scenarioRule('EVT-01', 'explorer', observation, ids)];
    const first = await agentRuntime(new MockModelClient({ rules })).requestDecision(observation);
    const second = await agentRuntime(new MockModelClient({ rules })).requestDecision(observation);
    expect(second).toEqual(first);
  });
});

describe('the runtime re-validates; a provider’s claim of success is not proof', () => {
  const offered = (observation: AgentObservation): AgentDecision => ({
    intent: 'act',
    choiceId: firstOffered(observation),
    reason: 'r',
    promptVersion: 'agent-v1',
    observationTick: observation.tick,
    provider: 'llm',
  });

  it('falls back when the decision does not match the schema', async () => {
    const { observation } = missionWaiting();
    const outcome = await agentRuntime(
      lyingClient({ intent: 'act', reason: '忘了给 choiceId 和信封字段' }),
    ).requestDecision(observation);
    expect(outcome.status).toBe('decided');
    if (outcome.status !== 'decided') return;
    expect(outcome.trace.outcome).toBe('fallback');
    expect(outcome.trace.providerFailure).toBe('schema-mismatch');
    expect(outcome.decision.provider).toBe('deterministic');
  });

  it('falls back when the choiceId was never offered', async () => {
    const { observation } = missionWaiting();
    const outcome = await agentRuntime(
      lyingClient({ ...offered(observation), choiceId: 'explore:99/99' }),
    ).requestDecision(observation);
    if (outcome.status !== 'decided') throw new Error('expected a fallback decision');
    expect(outcome.trace.providerFailure).toBe('invalid-choice-id');
    expect(outcome.decision.provider).toBe('deterministic');
  });

  it('falls back when the decision names an Agent the Agent cannot address', async () => {
    const { observation } = missionWaiting();
    const outcome = await agentRuntime(
      lyingClient({
        intent: 'request',
        reason: '我要一个看不见的同伴。',
        request: { type: 'teammate', targetAgentId: 'agent-999' },
        promptVersion: 'agent-v1',
        observationTick: observation.tick,
        provider: 'llm',
      }),
    ).requestDecision(observation);
    if (outcome.status !== 'decided') throw new Error('expected a fallback decision');
    expect(outcome.trace.providerFailure).toBe('invalid-choice-id');
  });

  it('falls back when a physical action is claimed for a social option', async () => {
    const { observation } = missionWaiting();
    const outcome = await agentRuntime(
      lyingClient({ ...offered(observation), choiceId: 'counteroffer' }),
    ).requestDecision(observation);
    if (outcome.status !== 'decided') throw new Error('expected a fallback decision');
    expect(outcome.trace.providerFailure).toBe('invalid-choice-id');
  });

  it('discards a stale answer instead of falling back (docs/lv3/02-decision-flow.md §3.5)', async () => {
    const engine = agentEngine();
    const explorer = agentByCareer(engine, 'explorer');
    offerMission(engine, explorer.id);
    run(engine, 20);
    const observation = observationFor(engine, explorer.id);
    expect(observation.tick).toBeGreaterThan(STALE_TICK_LIMIT);
    const outcome = await agentRuntime(
      lyingClient({
        intent: 'act',
        choiceId: firstOffered(observation),
        reason: '这是很久以前的世界给出的答案。',
        promptVersion: 'agent-v1',
        observationTick: 0,
        provider: 'llm',
      }),
    ).requestDecision(observation);
    expect(outcome.status).toBe('discarded');
    if (outcome.status !== 'discarded') return;
    expect(outcome.error).toBe('stale');
    expect(outcome.trace.outcome).toBe('discarded');
    expect(outcome.trace.fallbackUsed).toBe(false);
    expect(outcome.trace.decision).toBeNull();
  });
});

describe('every provider failure produces a valid deterministic decision (Agent.md §58)', () => {
  it.each([
    ['timeout', 'timeout'],
    ['http-error', 'http-error'],
    ['unavailable', 'unavailable'],
    ['invalid-json', 'invalid-json'],
    ['schema-mismatch', 'schema-mismatch'],
    ['invalid-choice-id', 'invalid-choice-id'],
    ['inaccessible-target', 'invalid-choice-id'],
    ['social-as-act', 'invalid-choice-id'],
  ])('%s ⇒ fallback', async (label, expected) => {
    const { observation } = missionWaiting();
    const outcome = await agentRuntime(
      new MockModelClient({ rules: [failureRule(label)] }),
    ).requestDecision(observation);
    expect(outcome.status).toBe('decided');
    if (outcome.status !== 'decided') return;
    expect(outcome.trace.outcome).toBe('fallback');
    expect(outcome.trace.providerFailure).toBe(expected);
    expect(outcome.trace.fallbackUsed).toBe(true);
    expect(outcome.decision.provider).toBe('deterministic');
    expect(agentDecisionSchema.safeParse(outcome.decision).success).toBe(true);
    expect(outcome.decision.observationTick).toBe(observation.tick);
  });

  it('survives a provider that throws outright', async () => {
    const { observation } = missionWaiting();
    const outcome = await agentRuntime(
      new MockModelClient({ rules: [failureRule('throws')] }),
    ).requestDecision(observation);
    if (outcome.status !== 'decided') throw new Error('expected a fallback decision');
    expect(outcome.trace.providerFailure).toBe('unavailable');
    expect(outcome.trace.reason).toContain('socket hang up');
    expect(agentDecisionSchema.safeParse(outcome.decision).success).toBe(true);
  });

  it('never invents a choiceId while falling back', async () => {
    const { observation } = missionWaiting();
    const outcome = await agentRuntime(
      new MockModelClient({ rules: [failureRule('timeout')] }),
    ).requestDecision(observation);
    if (outcome.status !== 'decided') throw new Error('expected a fallback decision');
    if (outcome.decision.intent === 'act')
      expect(observation.availableActions.map((c) => c.id)).toContain(outcome.decision.choiceId);
  });
});

describe('DEC-11 the runtime never turns a decision into a physical action', () => {
  it('leaves a social answer as a social answer', async () => {
    const { ids, observation } = missionWaiting();
    const outcome = await agentRuntime(
      new MockModelClient({ rules: [scenarioRule('EVT-01', 'explorer', observation, ids)] }),
    ).requestDecision(observation);
    if (outcome.status !== 'decided') throw new Error('expected a decision');
    expect(outcome.decision.intent).toBe('respond');
    // The placeholder Action social candidates carry stays inside `availableActions`; it is never
    // lifted onto the outcome, because only P3's submit path may do that.
    expect('action' in outcome).toBe(false);
    expect('action' in outcome.decision).toBe(false);
  });
});

describe('DEC-14/§十二/§十三 different Agents and different pasts produce different decisions', () => {
  it('four Agents with four goals disagree about the same situation (EVT-06)', async () => {
    const engine = agentEngine();
    const ids = careerIds(engine);
    const explorer = agentByCareer(engine, 'explorer');
    offerMission(engine, explorer.id, '异常数据出现了，下一步怎么办？', 'ask');
    const observation = observationFor(engine, explorer.id);
    const answers: string[] = [];
    for (const career of ['explorer', 'scientist', 'tactical', 'logistics'] as const) {
      const agent = agentByCareer(engine, career);
      const agentObservation = observationFor(engine, agent.id);
      const client = new MockModelClient({
        rules: scenarioRules('EVT-06', observation, ids),
      });
      const outcome = await agentRuntime(client).requestDecision(agentObservation);
      if (outcome.status !== 'decided') throw new Error('expected a decision for ' + career);
      answers.push(
        outcome.decision.intent +
          '|' +
          (outcome.decision.request?.type ?? outcome.decision.choiceId ?? '-'),
      );
    }
    expect(new Set(answers).size).toBe(4);
    expect(new Set(answers.map((a) => a.split('|')[0])).size).toBeGreaterThanOrEqual(2);
  });

  /**
   * Two histories for one Agent, both facing the identical new mission:
   *   A — the Admiral kept a promise, so trust is high and the memory is a good one;
   *   B — the Admiral forced an Override, so trust is low and the memory is that one.
   *
   * The fixture is keyed on trust rather than on the Agent id, which is exactly the claim being
   * tested: the *observation* carries the past, and a provider can act on it.
   */
  const history = (kind: 'kept' | 'forced') => {
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
    const client = new MockModelClient({
      rules: [
        scenarioRule(
          kept ? 'EVT-09:promise-kept' : 'EVT-09:override',
          'explorer',
          observation,
          careerIds(engine),
          (o) => o.self.state.trustInAdmiral >= 60 === kept,
        ),
      ],
    });
    return { observation, client };
  };

  it('the same Agent answers differently after a kept promise than after an Override (EVT-09)', async () => {
    const kept = history('kept');
    const forced = history('forced');

    const keptOutcome = await agentRuntime(kept.client).requestDecision(kept.observation);
    const forcedOutcome = await agentRuntime(forced.client).requestDecision(forced.observation);
    if (keptOutcome.status !== 'decided' || forcedOutcome.status !== 'decided')
      throw new Error('expected both scenarios to decide');

    // Different past ⇒ different decision.
    expect(keptOutcome.decision.choiceId).toBe('accept');
    expect(forcedOutcome.decision.choiceId).toBe('counteroffer');
    expect(keptOutcome.decision).not.toEqual(forcedOutcome.decision);

    // …and the difference is visible to the deterministic path too, which is what makes it a real
    // loop rather than a scripted one (Agent.md §50): trust and memory move the score itself.
    const candidateIn = (observation: AgentObservation) => {
      const candidate = observation.availableActions.find((c) => c.id === 'accept');
      if (!candidate) throw new Error('no social candidate to score');
      return candidate;
    };
    const keptScore = decisionScore(
      scoringAgent(kept.observation),
      kept.observation,
      candidateIn(kept.observation),
    );
    const forcedScore = decisionScore(
      scoringAgent(forced.observation),
      forced.observation,
      candidateIn(forced.observation),
    );
    expect(keptScore.ceoTrust).toBeGreaterThan(forcedScore.ceoTrust);
    // Both histories contribute memory, by different weights — the claim is that the past moves the
    // score at all, not that a pleasant past outranks an unpleasant one (`MEMORY_WEIGHTS` is a
    // proposal to be calibrated in P3, per docs/lv3/04-foundation-status.md §6 item 1).
    expect(keptScore.recentMemoryScore).toBeGreaterThan(0);
    expect(forcedScore.recentMemoryScore).toBeGreaterThan(0);
    expect(keptScore.recentMemoryScore).not.toBe(forcedScore.recentMemoryScore);
    expect(keptScore.score).not.toBe(forcedScore.score);
  });
});

describe('the runtime is isolated from the world', () => {
  it('does not mutate the observation it was given', async () => {
    const { ids, observation } = missionWaiting();
    const before = structuredClone(observation);
    const client = new MockModelClient({
      rules: [scenarioRule('EVT-01', 'explorer', observation, ids)],
    });
    await agentRuntime(client).requestDecision(observation);
    expect(observation).toEqual(before);
  });

  it('does not mutate the world the observation came from', async () => {
    const { engine, ids, observation } = missionWaiting();
    const before = JSON.stringify(engine.state);
    const client = new MockModelClient({
      rules: [scenarioRule('EVT-01', 'explorer', observation, ids)],
    });
    await agentRuntime(client).requestDecision(observation);
    await agentRuntime(new MockModelClient({ rules: [failureRule('timeout')] })).requestDecision(
      observation,
    );
    expect(JSON.stringify(engine.state)).toBe(before);
  });

  it('asks nothing of the world on the fallback path either', async () => {
    const { engine, observation } = missionWaiting();
    const before = structuredClone(engine.state);
    await agentRuntime(new MockModelClient({ rules: [] })).requestDecision(observation);
    expect(engine.state).toEqual(before);
  });
});
