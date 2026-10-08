/**
 * P3 vertical slice (docs/lv3/CODEX_TASKS.md `P3-01…P3-09`, docs/lv3/09-game-integration-status.md).
 *
 * P0–P2.5 built the decision side of Lv3 and left the settlement side unwired: `missionSuccess`,
 * `missionFailure`, `applyGoalProgress`, `teamUp`, `resolveFulfillments` and every non-Override
 * memory write were unit-tested and had **no production caller**. These tests are the ones that
 * would have failed before P3 — they assert the world actually changes.
 *
 * The seam under test: an engine branch reports a fact on the transient `pendingEvents` channel; the
 * host relaunches it as an `agentEvent` Command; the engine applies it through the pure
 * `src/engine/agent/**` functions.
 */
import { describe, it, expect } from 'vitest';
import { quietEngine, issue } from '../helpers';
import type { Agent, AgentDecision, AgentObservation, SimulationEvent } from '../../src/engine/types';
import { SimulationEngine } from '../../src/engine/engine';
import { AGENT_PROMPT_VERSION } from '../../src/engine/agent/decision';
import { MockModelClient } from '../../electron/agent/mock-client';
import {
  agentByCareer,
  agentRuntime,
  agentShipOf,
  engineMessenger,
  observationFor,
  offerMission,
  operatorOf,
  recordingSubmitter,
  requestTeamUp,
} from './support';

/** A client that only ever declines — `applyDecision` never consults it. */
const silent = () => new MockModelClient({ rules: [] });

function decisionFor(
  observation: AgentObservation,
  patch: Partial<AgentDecision> & { intent: AgentDecision['intent'] },
): AgentDecision {
  return {
    reason: '测试决策',
    promptVersion: AGENT_PROMPT_VERSION,
    observationTick: observation.tick,
    provider: 'deterministic',
    ...patch,
  } as AgentDecision;
}

/** Applies one decision for real: the Agent speaks through the engine, as itself. */
function applyFor(engine: SimulationEngine, observation: AgentObservation, decision: AgentDecision) {
  return agentRuntime(silent(), undefined, recordingSubmitter(), engineMessenger(engine)).applyDecision(
    observation,
    decision,
  );
}

/** Every settlement fact the engine emits over `ticks` steps, in order. */
function collectFacts(engine: SimulationEngine, ticks: number) {
  const facts: SimulationEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    engine.dispatchCommand({ type: 'pause', paused: false });
    for (const event of engine.step() as SimulationEvent[])
      if (event.type === 'agentEvent') facts.push(event);
  }
  return facts;
}

/** The Agent record with `id`, read fresh from the engine so it cannot be a stale copy. */
function agentById(engine: SimulationEngine, id: string): Agent {
  const agent = engine.state.agents.find((candidate) => candidate.id === id);
  if (!agent) throw new Error('no agent ' + id);
  return agent;
}

const memoryTags = (agent: Agent) =>
  agent.memories.map((memory) => (memory.kind === 'episodic' ? memory.tags : []));

describe('P3-00 the settlement seam', () => {
  it('every Agent is bound to its own ship and operator (I-1 structural guard)', () => {
    const engine = quietEngine();
    expect(engine.state.agents).toHaveLength(4);
    for (const agent of engine.state.agents) {
      const operator = engine.state.operators.find((o) => o.agentId === agent.id);
      expect(operator?.kind).toBe('agent');
      // A 1:1 binding — the ship an Agent commands is exactly the one its operator is assigned.
      expect(agentShipOf(engine, agent)).toBe(
        engine.state.assignments.find((a) => a.operatorId === operator!.id)!.shipId,
      );
    }
  });

  it('emits a mission-settled fact when an Admiral directive ends', () => {
    const engine = quietEngine();
    const ship = engine.state.ships.find((candidate) => candidate.id === 'verity')!;
    issue(engine, { type: 'EXPLORE', sector: { q: 0, r: -1 }, approach: 'remote' }, ship.id);

    engine.complete(ship, '抵达目标', false);
    const facts = collectFacts(engine, 1);

    expect(facts).toHaveLength(1);
    expect(facts[0]).toEqual({
      type: 'agentEvent',
      event: {
        kind: 'mission-settled',
        shipId: ship.id,
        directiveId: expect.any(String),
        actionType: 'EXPLORE',
        outcome: 'success',
      },
    });
  });

  it('does not settle a directive the Agent submitted itself', () => {
    // An Agent's own submission carries `source: 'standing'` — routine self-directed work is not a
    // mission. Without this guard every ordinary move would spray mission memories at the roster,
    // because `complete()` is the single funnel for all ~45 directive endings.
    const engine = quietEngine();
    const agent = agentByCareer(engine, 'explorer');
    const shipId = agentShipOf(engine, agent);
    const ship = engine.state.ships.find((candidate) => candidate.id === shipId)!;

    const submitted = engine
      .controllerPort(operatorOf(engine, agent.id))
      .submitAction({ type: 'EXPLORE', sector: { q: 0, r: -1 }, approach: 'remote' });
    expect(submitted.ok).toBe(true);
    expect(ship.current?.source).toBe('standing');

    engine.complete(ship, '抵达目标', false);
    expect(collectFacts(engine, 1)).toHaveLength(0);
  });

  it('settles the owning Agent: state moves, the goal mirror keeps up, and a memory lands', () => {
    const engine = quietEngine();
    const agent = agentByCareer(engine, 'explorer');
    const shipId = agentShipOf(engine, agent);
    const ship = engine.state.ships.find((candidate) => candidate.id === shipId)!;
    const before = agentById(engine, agent.id);
    expect(before.state.experience).toBe(0);

    issue(engine, { type: 'EXPLORE', sector: { q: 0, r: -1 }, approach: 'remote' }, shipId);
    engine.complete(ship, '抵达目标', false);
    for (const fact of collectFacts(engine, 1)) engine.dispatchCommand(fact as never);

    const after = agentById(engine, agent.id);
    // MISSION_SUCCESS_EFFECT: experience +10 is never clamped, so it is the exact assertion.
    expect(after.state.experience).toBe(10);
    expect(after.state.morale).toBeGreaterThan(before.state.morale);
    expect(after.state.fatigue).toBeGreaterThan(before.state.fatigue);
    // `state.goalProgress` and `goal.progress` are two views of one number (02-domain-model §3);
    // settlement moves both, so they must still agree afterwards.
    expect(after.goal.progress).toBe(after.state.goalProgress);
    expect(after.state.goalProgress).toBeGreaterThan(0);
    expect(memoryTags(after).at(-1)).toEqual(['mission-success']);
  });

  it('settles a failure as mission-failure', () => {
    const engine = quietEngine();
    const agent = agentByCareer(engine, 'tactical');
    const shipId = agentShipOf(engine, agent);
    const ship = engine.state.ships.find((candidate) => candidate.id === shipId)!;

    issue(engine, { type: 'EXPLORE', sector: { q: 0, r: -1 }, approach: 'remote' }, shipId);
    engine.complete(ship, '目标无法接续：虫洞未测绘', true);
    for (const fact of collectFacts(engine, 1)) engine.dispatchCommand(fact as never);

    const after = agentById(engine, agent.id);
    // MISSION_FAILURE_EFFECT: experience +2, morale down.
    expect(after.state.experience).toBe(2);
    expect(memoryTags(after).at(-1)).toEqual(['mission-failure']);
    expect(after.goal.progress).toBe(after.state.goalProgress);
  });

  it('refuses a settlement fact that names a ship with no Agent behind it', () => {
    const engine = quietEngine();
    const rulesShip = engine.state.ships.find((ship) => {
      const assignment = engine.state.assignments.find((a) => a.shipId === ship.id);
      const operator = engine.state.operators.find((o) => o.id === assignment?.operatorId);
      return operator && !operator.agentId;
    })!;
    expect(rulesShip).toBeDefined();

    const refused = engine.dispatchCommand({
      type: 'agentEvent',
      event: {
        kind: 'mission-settled',
        shipId: rulesShip.id,
        directiveId: 'directive-1',
        actionType: 'EXPLORE',
        outcome: 'success',
      },
    });
    expect(refused.ok).toBe(false);

    const unknown = engine.dispatchCommand({
      type: 'agentEvent',
      event: {
        kind: 'mission-settled',
        shipId: 'no-such-ship',
        directiveId: 'directive-1',
        actionType: 'EXPLORE',
        outcome: 'success',
      },
    });
    expect(unknown.ok).toBe(false);
  });

  it('emitting the fact alone never changes the world (nothing enters WorldState)', () => {
    // The same-seed replay guarantee, exercised over the Lv3 path: two worlds driven by the same
    // commands stay field-for-field equal *because* the fact rides `pendingEvents` and is only ever
    // applied by an explicit Command. This is `C-16` applied to settlement.
    const run = () => {
      const engine = quietEngine();
      const agent = agentByCareer(engine, 'logistics');
      const shipId = agentShipOf(engine, agent);
      const ship = engine.state.ships.find((candidate) => candidate.id === shipId)!;
      issue(engine, { type: 'EXPLORE', sector: { q: 0, r: -1 }, approach: 'remote' }, shipId);
      for (let i = 0; i < 40 && ship.current !== null; i++) {
        engine.dispatchCommand({ type: 'pause', paused: false });
        engine.step(); // events are produced and dropped, never applied
      }
      return engine.state;
    };
    expect(run()).toEqual(run());
  });
});

describe('P3-01/P3-02 the Agent answers the Admiral (EVT-01, EVT-02)', () => {
  it('speaks an acceptance as an agentMessage addressed to the Admiral', () => {
    const engine = quietEngine();
    const agent = agentByCareer(engine, 'explorer');
    offerMission(engine, agent.id);
    const observation = observationFor(engine, agent.id);
    const before = engine.state.agentMessages.length;

    expect(
      applyFor(engine, observation, decisionFor(observation, { intent: 'respond', choiceId: 'accept' })),
    ).toEqual({ status: 'replied', to: 'admiral', kind: 'report' });

    expect(engine.state.agentMessages).toHaveLength(before + 1);
    const reply = engine.state.agentMessages.at(-1)!;
    expect(reply.from).toBe(agent.id);
    expect(reply.to).toBe('admiral');
    expect(reply.kind).toBe('report');
    expect(reply.text.length).toBeGreaterThan(0);
  });

  it('turns a counteroffer into a negotiate message carrying the request (EVT-02)', () => {
    const engine = quietEngine();
    const agent = agentByCareer(engine, 'explorer');
    const tactical = agentByCareer(engine, 'tactical');
    offerMission(engine, agent.id);
    const observation = observationFor(engine, agent.id);

    applyFor(
      engine,
      observation,
      decisionFor(observation, {
        intent: 'respond',
        choiceId: 'counteroffer',
        say: '我可以去，但需要 Tactical 护航。',
        request: { type: 'teammate', targetAgentId: tactical.id },
      }),
    );

    const reply = engine.state.agentMessages.at(-1)!;
    expect(reply).toMatchObject({ from: agent.id, to: 'admiral', kind: 'negotiate' });
    // `AgentRequest.type` becomes the payload's `requestType` — same five values, different key.
    expect(reply.payload).toEqual({ requestType: 'teammate', targetAgentId: tactical.id });
    expect(reply.text).toBe('我可以去，但需要 Tactical 护航。');
  });

  it('answers a team request to the peer rather than to the Admiral (EVT-03)', () => {
    const engine = quietEngine();
    const explorer = agentByCareer(engine, 'explorer');
    const tactical = agentByCareer(engine, 'tactical');
    requestTeamUp(engine, explorer.id, tactical.id);
    const observation = observationFor(engine, tactical.id);

    expect(
      applyFor(
        engine,
        observation,
        decisionFor(observation, { intent: 'respond', choiceId: 'team-accept:' + explorer.id }),
      ),
    ).toEqual({ status: 'replied', to: explorer.id, kind: 'team-reply' });

    const reply = engine.state.agentMessages.at(-1)!;
    expect(reply.to).toBe(explorer.id);
    expect(reply.payload).toEqual({ requestingAgentId: explorer.id, accept: true });
    // `team-reply` is an interaction kind, so the audit trail records the answer.
    expect(engine.state.agentInteractions.at(-1)?.kind).toBe('team-reply');
  });

  it('refuses to invent a recipient for a choice the menu never offered', () => {
    // `replyFor` only understands choice ids `actions.ts` put on the menu; anything else is not
    // speech and must not become a message.
    const engine = quietEngine();
    const agent = agentByCareer(engine, 'scientist');
    const observation = observationFor(engine, agent.id);
    const before = engine.state.agentMessages.length;

    expect(
      applyFor(engine, observation, decisionFor(observation, { intent: 'respond', choiceId: 'team-accept:' })),
    ).toEqual({ status: 'not-an-action', intent: 'respond' });
    expect(engine.state.agentMessages).toHaveLength(before);
  });
});
