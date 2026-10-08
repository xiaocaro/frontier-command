/**
 * P1-01 the offline provider (docs/lv3/03-test-plan.md §5, L-1 … L-2; §11, B-9).
 *
 * The mock provider is not a convenience — it is a permanent part of the system (docs/lv3/
 * 02-llm-boundary.md §3: every offline regression test depends on it). So it is tested against the
 * same contract a live provider will be held to: it answers with a schema-valid `AgentDecision`,
 * it reports failures as values rather than exceptions, and it never reaches outside the process.
 */
import { describe, it, expect } from 'vitest';
import { MockModelClient } from '../../electron/agent/mock-client';
import { buildDecisionRequest, loadDecisionSchema, loadPromptTemplates } from '../../electron/agent/prompt';
import { agentDecisionSchema } from '../../src/engine/agent/schemas';
import {
  REPO_ROOT,
  agentByCareer,
  agentEngine,
  careerIds,
  failureRule,
  observationFor,
  offerMission,
  scenarioRule,
} from './support';
import type { AgentObservation } from '../../src/engine/types';

const templates = loadPromptTemplates(REPO_ROOT);
const schema = loadDecisionSchema(REPO_ROOT);

function request(observation: AgentObservation) {
  return buildDecisionRequest({ observation, templates, schema });
}

const explorerSetup = () => {
  const engine = agentEngine();
  const ids = careerIds(engine);
  const agent = agentByCareer(engine, 'explorer');
  const observation = observationFor(engine, agent.id);
  return { engine, ids, observation };
};

/** The EVT-01 situation: a mission offer is waiting, so the social options exist. */
const explorerWithOffer = () => {
  const engine = agentEngine();
  const ids = careerIds(engine);
  const agent = agentByCareer(engine, 'explorer');
  offerMission(engine, agent.id);
  return { engine, ids, observation: observationFor(engine, agent.id) };
};

describe('L-1 the mock provider answers with a valid AgentDecision', () => {
  it('replays a recorded decision exactly as written', async () => {
    const { ids, observation } = explorerSetup();
    const client = new MockModelClient({ rules: [scenarioRule('EVT-05', 'explorer', observation, ids)] });
    const result = await client.decide(request(observation));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(agentDecisionSchema.safeParse(result.decision).success).toBe(true);
    expect(result.decision.intent).toBe('act');
    expect(result.decision.choiceId).toMatch(/^survey:/);
    expect(result.decision.provider).toBe('llm');
  });

  it('stamps the observation tick and the client prompt version onto the answer', async () => {
    const { ids, observation } = explorerWithOffer();
    const client = new MockModelClient({
      rules: [scenarioRule('EVT-01', 'explorer', observation, ids)],
      promptVersion: 'agent-v1',
    });
    const result = await client.decide(request(observation));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.observationTick).toBe(observation.tick);
    expect(result.decision.promptVersion).toBe('agent-v1');
    expect(client.id).toBe('mock');
  });

  it('answers unavailable when no rule matches the observation', async () => {
    const { observation } = explorerSetup();
    const client = new MockModelClient({ rules: [] });
    expect(await client.decide(request(observation))).toEqual({
      ok: false,
      error: 'unavailable',
      latencyMs: 0,
    });
  });
});

describe('L-2 the same request always yields the same answer', () => {
  it('is deterministic across repeated calls', async () => {
    const { ids, observation } = explorerWithOffer();
    const client = new MockModelClient({ rules: [scenarioRule('EVT-02', 'explorer', observation, ids)] });
    const first = await client.decide(request(observation));
    const second = await client.decide(request(observation));
    expect(second).toEqual(first);
  });

  it('never lets latency leak into the decision', async () => {
    const { ids, observation } = explorerWithOffer();
    const rules = [scenarioRule('EVT-01', 'explorer', observation, ids)];
    let clock = 0;
    const ticking = new MockModelClient({ rules, now: () => (clock += 7) });
    const still = new MockModelClient({ rules, latencyMs: 0, now: () => 0 });
    const a = await ticking.decide(request(observation));
    const b = await still.decide(request(observation));
    expect(a.latencyMs).toBeGreaterThanOrEqual(0);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.decision).toEqual(b.decision);
  });
});

describe('provider failures are values, not exceptions (Agent.md §58)', () => {
  const setup = explorerSetup();

  it.each(['timeout', 'http-error', 'unavailable'] as const)('reports %s', async (error) => {
    const client = new MockModelClient({ rules: [failureRule(error)] });
    expect(await client.decide(request(setup.observation))).toEqual({
      ok: false,
      error,
      latencyMs: 0,
    });
  });

  it('reports invalid-json for unparseable text', async () => {
    const client = new MockModelClient({ rules: [failureRule('invalid-json')] });
    const result = await client.decide(request(setup.observation));
    expect(result).toEqual({ ok: false, error: 'invalid-json', latencyMs: 0 });
  });

  it('reports schema-mismatch for structurally invalid JSON', async () => {
    const client = new MockModelClient({ rules: [failureRule('schema-mismatch')] });
    const result = await client.decide(request(setup.observation));
    expect(result).toEqual({ ok: false, error: 'schema-mismatch', latencyMs: 0 });
  });

  it('reports invalid-choice-id for an id that was never offered', async () => {
    const client = new MockModelClient({ rules: [failureRule('invalid-choice-id')] });
    const result = await client.decide(request(setup.observation));
    expect(result).toEqual({ ok: false, error: 'invalid-choice-id', latencyMs: 0 });
  });

  it('reports invalid-choice-id for a target the Agent cannot address', async () => {
    const client = new MockModelClient({ rules: [failureRule('inaccessible-target')] });
    const result = await client.decide(request(setup.observation));
    expect(result).toEqual({ ok: false, error: 'invalid-choice-id', latencyMs: 0 });
  });

  it('refuses a social option dressed as a physical action', async () => {
    const engine = agentEngine();
    const agent = agentByCareer(engine, 'explorer');
    engine.state.agentMessages.push({
      id: 'agent-message-1',
      at: 0,
      from: 'admiral',
      to: agent.id,
      kind: 'command',
      text: '去调查。',
      payload: null,
      read: false,
    });
    const observation = observationFor(engine, agent.id);
    const client = new MockModelClient({ rules: [failureRule('social-as-act')] });
    const result = await client.decide(request(observation));
    expect(result).toEqual({ ok: false, error: 'invalid-choice-id', latencyMs: 0 });
  });

  it('lets a provider that throws actually throw, so the runtime can be tested against it', async () => {
    const client = new MockModelClient({ rules: [failureRule('throws')] });
    await expect(client.decide(request(setup.observation))).rejects.toThrow('socket hang up');
  });
});

describe('the provider judges structure, not staleness (docs/lv3/03-api-contract.md §4.4)', () => {
  it('returns an old-tick decision unchanged rather than judging it stale', async () => {
    const { ids, observation } = explorerWithOffer();
    // The recording is replayed with the *observation's* tick, so age is zero here by construction;
    // the point is that the provider applies no age rule of its own — that is the runtime's call.
    const client = new MockModelClient({ rules: [scenarioRule('EVT-01', 'explorer', observation, ids)] });
    const aged: AgentObservation = { ...observation, tick: observation.tick + 10_000 };
    const result = await client.decide(request(aged));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.decision.observationTick).toBe(aged.tick);
  });
});
