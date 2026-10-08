/**
 * P1-05 deterministic replay (docs/lv3/03-test-plan.md §5 L-2, §7 I-14;
 * docs/lv3/03-api-contract.md §7).
 *
 * The contract is careful about what it claims: an engine replays exactly from the same seed and the
 * same commands, and a **mock provider plus a recording** replays exactly. A live model does not,
 * and nothing here pretends otherwise.
 *
 * So this file proves the honest half: two worlds built independently from the same seed, given the
 * same recorded decisions, produce identical decision streams — including across a multi-step
 * sequence where each step's situation depends on the one before it.
 */
import { describe, it, expect } from 'vitest';
import { MockModelClient } from '../../electron/agent/mock-client';
import { SimulationEngine } from '../../src/engine/engine';
import type { AgentCareer, AgentDecision } from '../../src/engine/types';
import {
  agentByCareer,
  agentEngine,
  agentRuntime,
  careerIds,
  observationFor,
  offerMission,
  requestTeamUp,
  scenarioRule,
} from './support';

/** What a replay comparison looks at: the answer, and how it was reached. */
interface Step {
  key: string;
  decision: AgentDecision;
  outcome: string;
  providerFailure: string | null;
}

/** Replays one recorded decision for one Agent against one world. */
async function replay(engine: SimulationEngine, key: string, career: AgentCareer): Promise<Step> {
  const observation = observationFor(engine, agentByCareer(engine, career).id);
  const client = new MockModelClient({
    rules: [scenarioRule(key, career, observation, careerIds(engine))],
  });
  const outcome = await agentRuntime(client).requestDecision(observation);
  if (outcome.status !== 'decided') throw new Error('discarded: ' + key);
  return {
    key,
    decision: outcome.decision,
    outcome: outcome.trace.outcome,
    providerFailure: outcome.trace.providerFailure,
  };
}

/**
 * The MVP's opening beats, played against a freshly built world: the Admiral issues the mission, the
 * Explorer answers it, and the Tactical Agent is asked to fly along.
 */
async function playOpening(): Promise<Step[]> {
  const engine = agentEngine();
  const explorer = agentByCareer(engine, 'explorer');
  const tactical = agentByCareer(engine, 'tactical');

  offerMission(engine, explorer.id, '穿越虫洞，寻找失联探测船。');
  const first = await replay(engine, 'EVT-01', 'explorer');

  requestTeamUp(engine, explorer.id, tactical.id);
  const second = await replay(engine, 'EVT-03', 'tactical');

  const third = await replay(engine, 'EVT-02', 'explorer');
  return [first, second, third];
}

describe('L-2 the same observation and the same recording give the same decision', () => {
  it('replays identically across two independently built worlds', async () => {
    const first = await playOpening();
    const second = await playOpening();
    expect(second).toEqual(first);
    expect(first.map((step) => step.key)).toEqual(['EVT-01', 'EVT-03', 'EVT-02']);
  });

  it('replays identically when the same world is asked twice', async () => {
    const engine = agentEngine();
    const explorer = agentByCareer(engine, 'explorer');
    offerMission(engine, explorer.id);
    const observation = observationFor(engine, explorer.id);
    const rules = [scenarioRule('EVT-01', 'explorer', observation, careerIds(engine))];
    const a = await agentRuntime(new MockModelClient({ rules })).requestDecision(observation);
    const b = await agentRuntime(new MockModelClient({ rules })).requestDecision(observation);
    expect(b).toEqual(a);
    expect(a.status).toBe('decided');
  });

  it('replays the fallback path identically too', async () => {
    const engine = agentEngine();
    const explorer = agentByCareer(engine, 'explorer');
    offerMission(engine, explorer.id);
    const observation = observationFor(engine, explorer.id);
    const a = await agentRuntime(new MockModelClient({ rules: [] })).requestDecision(observation);
    const b = await agentRuntime(new MockModelClient({ rules: [] })).requestDecision(observation);
    expect(b).toEqual(a);
    if (a.status !== 'decided') throw new Error('expected a fallback decision');
    expect(a.trace.outcome).toBe('fallback');
  });

  it('stamps every recorded step with the world it was formed against', async () => {
    for (const step of await playOpening()) {
      expect(step.decision.observationTick).toBe(0);
      expect(step.decision.promptVersion).toBe('agent-v1');
      expect(step.outcome).toBe('provider');
      expect(step.providerFailure).toBeNull();
    }
  });
});
