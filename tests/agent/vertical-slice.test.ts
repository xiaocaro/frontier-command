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
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { quietEngine, issue } from '../helpers';
import type {
  Agent,
  AgentActionCandidate,
  AgentDecision,
  AgentEvent,
  AgentObservation,
  Ship,
  SimulationEvent,
} from '../../src/engine/types';
import { SimulationEngine } from '../../src/engine/engine';
import { capabilities } from '../../src/engine/capabilities';
import { AGENT_PROMPT_VERSION, fallbackDecision } from '../../src/engine/agent/decision';
import { assessReadiness } from '../../src/engine/agent/readiness';
import { decisionScore } from '../../src/engine/agent/score';
import { AgentHost, agentEventsOf, agentTriggersOf } from '../../electron/agent-host';
import { MockModelClient } from '../../electron/agent/mock-client';
import { scoringAgent } from '../../electron/agent/runtime';
import {
  REPO_ROOT,
  agentByCareer,
  agentRuntime,
  agentShipOf,
  engineMessenger,
  engineSubmitter,
  observationFor,
  offerMission,
  operatorOf,
  recordingSubmitter,
  requestTeamUp,
} from './support';

/** A client that only ever declines — `applyDecision` never consults it. */
const silent = () => new MockModelClient({ rules: [] });

/** Applies one settlement fact through the engine's own door, and insists it was accepted. */
function settleFact(engine: SimulationEngine, event: AgentEvent) {
  const result = engine.dispatchCommand({ type: 'agentEvent', event });
  if (!result.ok) throw new Error('结算被拒：' + result.reason);
  return result;
}

/** The `accept` option — the social candidate EVT-09 is really about. */
function candidateIn(observation: AgentObservation): AgentActionCandidate {
  const candidate = observation.availableActions.find((option) => option.id === 'accept');
  if (!candidate) throw new Error('菜单里没有 accept 选项');
  return candidate;
}

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

describe('P3-03/P3-05/P3-08 settlement reaches state, memory, goals and relationships', () => {
  it('a promise is created pending, and a real module install fulfils it', () => {
    const engine = quietEngine();
    const agent = agentByCareer(engine, 'explorer');
    const before = agentById(engine, agent.id);

    settleFact(engine, {
      kind: 'promise-made',
      toAgentId: agent.id,
      promiseType: 'equipment',
      description: 'Deep Scan 优先权限',
      fulfills: { kind: 'grant-module', key: 'deepScan' },
    });
    const pending = agentById(engine, agent.id).promises.at(-1)!;
    expect(pending).toMatchObject({ status: 'pending', resolvedAt: null, to: agent.id });
    expect(pending.fulfills).toEqual({ kind: 'grant-module', key: 'deepScan' });

    settleFact(engine, { kind: 'module-installed', moduleId: 'deepScan' });

    const after = agentById(engine, agent.id);
    expect(after.promises.at(-1)).toMatchObject({ status: 'fulfilled' });
    expect(after.promises.at(-1)!.resolvedAt).not.toBeNull();
    // PROMISE_KEPT_EFFECT: trust +10, loyalty +5, morale +10.
    expect(after.state.trustInAdmiral).toBeGreaterThan(before.state.trustInAdmiral);
    expect(after.state.morale).toBeGreaterThan(before.state.morale);
    // Episodic, tagged — that is the carrier `memoryContribution` scores, so the kept promise
    // reaches the *next* decision rather than only the audit trail.
    expect(memoryTags(after).at(-1)).toEqual(['promise-kept']);
  });

  it('an installed module only settles a promise it actually matches', () => {
    const engine = quietEngine();
    const agent = agentByCareer(engine, 'explorer');
    settleFact(engine, {
      kind: 'promise-made',
      toAgentId: agent.id,
      promiseType: 'equipment',
      description: 'Deep Scan 优先权限',
      fulfills: { kind: 'grant-module', key: 'deepScan' },
    });

    settleFact(engine, { kind: 'module-installed', moduleId: 'expandedCargo' });
    expect(agentById(engine, agent.id).promises.at(-1)!.status).toBe('pending');
  });

  it('moves both sides of a team-up, and both sides of a refusal', () => {
    const engine = quietEngine();
    const explorer = agentByCareer(engine, 'explorer');
    const tactical = agentByCareer(engine, 'tactical');
    const regard = (from: string, to: string) =>
      agentById(engine, from).relationships.find((r) => r.targetAgentId === to)!;

    expect(regard(explorer.id, tactical.id).value).toBe(0);

    settleFact(engine, {
      kind: 'team-resolved',
      aAgentId: explorer.id,
      bAgentId: tactical.id,
      accepted: true,
    });
    // `teamUp` returns both lists together, so "A changed but B did not" cannot happen.
    expect(regard(explorer.id, tactical.id).value).toBe(10);
    expect(regard(tactical.id, explorer.id).value).toBe(10);

    settleFact(engine, {
      kind: 'team-resolved',
      aAgentId: explorer.id,
      bAgentId: tactical.id,
      accepted: false,
    });
    expect(regard(explorer.id, tactical.id).value).toBe(0);
    expect(regard(tactical.id, explorer.id).value).toBe(0);
  });

  it('a discovery is remembered once and moves the goal, however often it is reported', () => {
    const engine = quietEngine();
    const agent = agentByCareer(engine, 'explorer');
    const shipId = agentShipOf(engine, agent);
    const fact = { kind: 'discovery', shipId, bodyId: 'body-anomaly-1' } as const;

    settleFact(engine, fact);
    const once = agentById(engine, agent.id);
    expect(once.goal.progress).toBeGreaterThan(0);
    expect(once.goal.progress).toBe(once.state.goalProgress);
    expect(memoryTags(once)).toEqual([['discovery']]);

    // Re-surveying the same anomaly must not farm goal progress.
    settleFact(engine, fact);
    const twice = agentById(engine, agent.id);
    expect(twice.goal.progress).toBe(once.goal.progress);
    expect(memoryTags(twice)).toEqual([['discovery']]);
  });
});

describe('P3-01 a pending offer is answered, and answering consumes it', () => {
  const fallbackFor = (engine: SimulationEngine) => {
    const observation = observationFor(engine, agentByCareer(engine, 'explorer').id);
    return fallbackDecision(scoringAgent(observation), observation);
  };

  it('answers the Admiral before choosing its own work, and only while the offer is pending', () => {
    const engine = quietEngine();
    const agent = agentByCareer(engine, 'explorer');

    // With nothing waiting, the deterministic Agent does its own work.
    expect(fallbackFor(engine).intent).not.toBe('respond');

    offerMission(engine, agent.id);
    const decision = fallbackFor(engine);
    expect(decision.intent).toBe('respond');
    expect(['accept', 'counteroffer', 'reject']).toContain(decision.choiceId);
  });

  it('a reply consumes the offer, so the Agent is not trapped answering forever', () => {
    const engine = quietEngine();
    const agent = agentByCareer(engine, 'explorer');
    offerMission(engine, agent.id);
    const before = observationFor(engine, agent.id);
    expect(before.availableActions.some((c) => c.id === 'accept')).toBe(true);

    applyFor(engine, before, decisionFor(before, { intent: 'respond', choiceId: 'accept' }));

    // The offer is gone from the menu and from the unread set, so the next beat is free again.
    const after = observationFor(engine, agent.id);
    expect(after.availableActions.some((c) => c.id === 'accept')).toBe(false);
    expect(engine.state.agentMessages.filter((m) => m.to === agent.id && !m.read)).toHaveLength(0);
    expect(fallbackFor(engine).intent).not.toBe('respond');
  });

  it('a team reply consumes the request it answers, and only that one', () => {
    const engine = quietEngine();
    const explorer = agentByCareer(engine, 'explorer');
    const tactical = agentByCareer(engine, 'tactical');
    requestTeamUp(engine, explorer.id, tactical.id);
    offerMission(engine, tactical.id);
    const observation = observationFor(engine, tactical.id);

    applyFor(engine, observation, decisionFor(observation, { intent: 'respond', choiceId: 'team-accept:' + explorer.id }));

    const unread = engine.state.agentMessages.filter((m) => m.to === tactical.id && !m.read);
    // The team request is settled; the Admiral's offer is a different question and still stands.
    expect(unread.map((m) => m.kind)).toEqual(['command']);
  });
});

describe('P3-00 the host frame is what closes the loop', () => {
  it('settles the Agent from the engine’s own fact, on the production path', () => {
    // No provider configured — the configuration the game actually runs in. Driving the real
    // `AgentHost` (not a stand-in) is the point: this is the wiring `main.ts` uses.
    const engine = quietEngine();
    const host = new AgentHost(engine, { root: REPO_ROOT, env: {} });
    const agent = agentByCareer(engine, 'explorer');
    const shipId = agentShipOf(engine, agent);
    issue(engine, { type: 'EXPLORE', sector: { q: 0, r: -1 }, approach: 'remote' }, shipId);

    for (let i = 0; i < 6_000; i++) {
      engine.dispatchCommand({ type: 'pause', paused: false });
      host.frame(engine.step());
      if (agentById(engine, agent.id).state.experience > 0) break;
    }

    const settled = agentById(engine, agent.id);
    // MISSION_SUCCESS_EFFECT reached the roster — through the event channel, the host, and the
    // engine's own apply path, with the scheduler in the loop the whole time.
    expect(settled.state.experience).toBe(10);
    expect(memoryTags(settled)).toContainEqual(['mission-success']);
    expect(settled.goal.progress).toBe(settled.state.goalProgress);
  });

  it('carries the Agent’s answer back to the Admiral with no provider configured', async () => {
    // EVT-01 end to end on the production path: the Admiral's offer goes in as a real command, the
    // trigger wakes the scheduler, the deterministic band answers, and the reply leaves as an
    // agentMessage. No API key anywhere in this test.
    const engine = quietEngine();
    const host = new AgentHost(engine, { root: REPO_ROOT, env: {} });
    const agent = agentByCareer(engine, 'explorer');
    const offered = engine.dispatchCommand({
      type: 'agentMessage',
      from: 'admiral',
      to: agent.id,
      kind: 'command',
      text: '穿越虫洞，寻找失联探测船。',
      payload: null,
    });
    expect(offered.ok).toBe(true);

    for (let i = 0; i < 200; i++) {
      engine.dispatchCommand({ type: 'pause', paused: false });
      host.frame(engine.step());
      // The decision is a promise; `frame()` never awaits it (CLAUDE.md §2.4), so the test has to let
      // the microtask queue run before the next `pump()` can drain it.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (engine.state.agentMessages.some((m) => m.from === agent.id)) break;
    }

    const answer = engine.state.agentMessages.find((m) => m.from === agent.id);
    expect(answer).toBeDefined();
    expect(answer!.to).toBe('admiral');
    expect(['report', 'negotiate']).toContain(answer!.kind);
    // And the offer it answered is consumed, so this cannot repeat forever.
    expect(engine.state.agentMessages.filter((m) => m.to === agent.id && !m.read)).toHaveLength(0);
  });

  it('extracts settlement facts from a frame, and triggers from the same frame', () => {
    const frame: SimulationEvent[] = [
      { type: 'agentTrigger', trigger: { kind: 'ship-idle', shipId: 'verity' } },
      {
        type: 'agentEvent',
        event: {
          kind: 'mission-settled',
          shipId: 'verity',
          directiveId: 'd-1',
          actionType: 'EXPLORE',
          outcome: 'success',
        },
      },
    ];
    expect(agentTriggersOf(frame)).toHaveLength(1);
    expect(agentEventsOf(frame)).toEqual([
      {
        kind: 'mission-settled',
        shipId: 'verity',
        directiveId: 'd-1',
        actionType: 'EXPLORE',
        outcome: 'success',
      },
    ]);
  });
});

describe('P3-03 the Agent-Agent team-up is real game state (EVT-03)', () => {
  /** What `AgentHost.frame` does with a frame's settlement facts, for tests that skip the host. */
  const drainFacts = (engine: SimulationEngine) => {
    for (const event of engine.pendingEvents.splice(0))
      if (event.type === 'agentEvent') engine.dispatchCommand({ type: 'agentEvent', event: event.event });
  };

  it('accepting moves both relationships, then the escort is really submitted', () => {
    const engine = quietEngine();
    const tactical = agentByCareer(engine, 'tactical');
    const tacticalShip = agentShipOf(engine, tactical);
    // `physicalCandidates` caps the escort list (`CANDIDATE_CAPS.escort`), so pair with a ship that is
    // actually on the menu rather than assuming one is.
    const peerOf = (shipId: string) => {
      const assignment = engine.state.assignments.find((a) => a.shipId === shipId);
      return engine.state.operators.find((o) => o.id === assignment?.operatorId)?.agentId ?? null;
    };
    const peerShip = observationFor(engine, tactical.id)
      .availableActions.filter((c) => c.id.startsWith('escort:'))
      .map((c) => c.id.slice('escort:'.length))
      .find((shipId) => {
        const peer = peerOf(shipId);
        return peer !== null && peer !== tactical.id;
      });
    expect(peerShip).toBeDefined();
    const explorer = { id: peerOf(peerShip!)! };
    requestTeamUp(engine, explorer.id, tactical.id);

    // 1. The social answer — one decision beat.
    const answerTo = observationFor(engine, tactical.id);
    expect(
      applyFor(
        engine,
        answerTo,
        decisionFor(answerTo, { intent: 'respond', choiceId: 'team-accept:' + explorer.id }),
      ),
    ).toEqual({ status: 'replied', to: explorer.id, kind: 'team-reply' });

    // The reply emits a settlement fact (the engine decided what the answer was); the host applies it.
    drainFacts(engine);
    const regard = (from: string, to: string) =>
      agentById(engine, from).relationships.find((r) => r.targetAgentId === to)!;
    expect(regard(explorer.id, tactical.id).value).toBe(10);
    expect(regard(tactical.id, explorer.id).value).toBe(10);

    // 2. A separate decision beat submits the physical half. `escort:<shipId>` is an existing
    //    candidate and `validateAction` accepts it, so this is a normal `act` — nothing new.
    const escort = observationFor(engine, tactical.id);
    const candidate = escort.availableActions.find((option) => option.id === 'escort:' + peerShip);
    expect(candidate).toBeDefined();
    const runtime = agentRuntime(silent(), undefined, engineSubmitter(engine), engineMessenger(engine));
    expect(runtime.applyDecision(escort, decisionFor(escort, { intent: 'act', choiceId: candidate!.id }))).toEqual(
      { status: 'submitted', choiceId: candidate!.id },
    );

    const ship = engine.state.ships.find((s) => s.id === tacticalShip)!;
    expect(ship.current?.action).toEqual({ type: 'ESCORT', targetId: peerShip });
    // It is the Agent's own directive, not the Admiral's — which is why it does not settle a mission.
    expect(ship.current?.source).toBe('standing');
  });
});

describe('P3-08 a real install fulfils a real promise (EVT-08)', () => {
  it('flips the pending promise when the module is actually installed', () => {
    const engine = quietEngine();
    const host = new AgentHost(engine, { root: REPO_ROOT, env: {} });
    const agent = agentByCareer(engine, 'explorer');
    const beneficiaryShip = agentShipOf(engine, agent);
    const base = engine.state.locations.find((l) => l.owner === 'starfleet' && l.hull > 0)!;
    // The scenario needs a budget to exist; give the world what the module costs rather than hoping
    // the starting stock happens to cover it.
    engine.state.resources.credits = 10_000;
    base.stock.materials = 1_000;
    base.stock.specialFinds = 10;

    settleFact(engine, {
      kind: 'promise-made',
      toAgentId: agent.id,
      promiseType: 'equipment',
      description: 'Deep Scan 优先权限',
      fulfills: { kind: 'grant-module', key: 'deepScan' },
    });
    const before = agentById(engine, agent.id).state.trustInAdmiral;

    // Flown by a *different* hull on purpose: the promise names a beneficiary, not a ship, which is
    // why the settlement matches world-wide instead of per ship.
    const flownBy = engine.state.ships.find((s) => s.id !== beneficiaryShip)!;
    issue(
      engine,
      { type: 'REFIT', targetId: base.id, moduleId: 'deepScan', remove: false },
      flownBy.id,
    );
    for (let i = 0; i < 600; i++) {
      engine.dispatchCommand({ type: 'pause', paused: false });
      host.frame(engine.step());
      if (agentById(engine, agent.id).promises.at(-1)!.status === 'fulfilled') break;
    }

    expect(flownBy.modules).toContain('deepScan');
    const after = agentById(engine, agent.id);
    expect(after.promises.at(-1)).toMatchObject({ status: 'fulfilled' });
    expect(after.state.trustInAdmiral).toBeGreaterThan(before);
    expect(memoryTags(after)).toContainEqual(['promise-kept']);
  });
});

describe('P3-04 readiness is deterministic and has no fuel (EVT-04)', () => {
  const readinessFor = (engine: SimulationEngine, shipId: string, patch: Partial<Ship> = {}) => {
    const ship = engine.state.ships.find((s) => s.id === shipId)!;
    const base = engine.state.locations.find((l) => l.owner === 'starfleet' && l.hull > 0)!;
    return assessReadiness(engine.state, { ...ship, ...patch }, base);
  };

  it('reads ammunition, hull and the route, and nothing else', () => {
    const engine = quietEngine();
    const shipId = agentShipOf(engine, agentByCareer(engine, 'logistics'));
    const ship = engine.state.ships.find((s) => s.id === shipId)!;
    const full = capabilities(ship).hull;

    const healthy = readinessFor(engine, shipId, { photon: 10, quantum: 5, hull: full });
    expect(healthy).toEqual({ verdict: 'READY', reasons: [] });
    // Same ship, dry magazines.
    expect(readinessFor(engine, shipId, { photon: 0, quantum: 0, hull: full }).verdict).toBe('WARNING');
    // Same ship, holed.
    expect(readinessFor(engine, shipId, { photon: 10, quantum: 5, hull: 1 }).verdict).toBe('WARNING');
    // Deterministic: identical inputs, identical answer — the card's API contract.
    expect(readinessFor(engine, shipId, { photon: 10, quantum: 5, hull: full })).toEqual(healthy);
  });

  it('flags the option it applies to, and only that one', () => {
    const engine = quietEngine();
    const agent = agentByCareer(engine, 'logistics');
    const shipId = agentShipOf(engine, agent);
    const ship = engine.state.ships.find((s) => s.id === shipId)!;
    ship.photon = 0;
    ship.quantum = 0;

    const observation = observationFor(engine, agent.id);
    const warned = observation.availableActions.filter((c) =>
      c.requirements.some((reason) => reason.includes('弹药')),
    );
    // The verdict crossed the observation boundary: the decision can see it, and so can the prompt.
    expect(warned.length).toBeGreaterThan(0);
    // It is a fact about a destination, so the option with no destination does not carry it.
    const back = observation.availableActions.find((c) => c.id === 'return')!;
    expect(back.requirements.some((reason) => reason.includes('弹药'))).toBe(true);
    expect(back.requirements.some((reason) => reason.includes('返航余量'))).toBe(false);
  });

  it('leaves no fuel anywhere in the codebase', () => {
    // The card's Done When is "仓库中仍无 `fuel` 字段", and a comment claiming so is not evidence — so
    // this scans the source with comments stripped, exactly as `boundary.test.ts` does.
    const strip = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
    const files: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.ts')) files.push(path);
      }
    };
    for (const root of ['src', 'electron']) walk(join(REPO_ROOT, root));
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((file) => /\bfuel\b/i.test(strip(readFileSync(file, 'utf8'))));
    expect(offenders).toEqual([]);
  });
});

describe('P3-05 a real survey of an anomaly reaches the Agent (EVT-05)', () => {
  it('emits the discovery fact from the survey branch and settles it', () => {
    const engine = quietEngine();
    const host = new AgentHost(engine, { root: REPO_ROOT, env: {} });
    const agent = agentByCareer(engine, 'explorer');
    const shipId = agentShipOf(engine, agent);
    const ship = engine.state.ships.find((s) => s.id === shipId)!;
    // Deterministic: put a known anomaly where the scenario needs one rather than hoping generation
    // produced a discovered one, and sit on it so the test is about the settlement, not travel time.
    const body = engine.state.bodies.find((b) => b.discovered)!;
    body.kind = 'anomaly';
    body.hazard = 0;
    ship.x = body.x;
    ship.y = body.y;

    // Close approach is what makes it a discovery (`execution.ts` emits at tier 2 only) — a remote
    // scan of the same body is not one.
    issue(engine, { type: 'SURVEY', targetId: body.id, approach: 'close', deep: false }, shipId);
    for (let i = 0; i < 600; i++) {
      engine.dispatchCommand({ type: 'pause', paused: false });
      host.frame(engine.step());
      if (agentById(engine, agent.id).goal.progress > 0) break;
    }

    const after = agentById(engine, agent.id);
    // The ordinary engine branch produced the fact, the host relayed it, and the engine settled it —
    // this is the emission point, not the settlement, which is covered separately in P3-00.
    //
    // Note that the Admiral-ordered survey emits **two** facts, and both are right: the survey branch
    // reports the discovery, and `complete()` reports the directive ending. They compose; neither
    // suppresses the other.
    const discovery = after.memories.find(
      (memory) => memory.kind === 'episodic' && memory.tags.includes('discovery'),
    );
    expect(discovery).toMatchObject({ subjectId: body.id });
    expect(memoryTags(after)).toContainEqual(['mission-success']);
    expect(after.goal.progress).toBeGreaterThan(0);
    expect(after.goal.progress).toBe(after.state.goalProgress);
  });

  it('does not call a remote scan of the same body a discovery', () => {
    const engine = quietEngine();
    const host = new AgentHost(engine, { root: REPO_ROOT, env: {} });
    const agent = agentByCareer(engine, 'explorer');
    const shipId = agentShipOf(engine, agent);
    const ship = engine.state.ships.find((s) => s.id === shipId)!;
    const body = engine.state.bodies.find((b) => b.discovered)!;
    body.kind = 'anomaly';
    body.hazard = 0;
    ship.x = body.x;
    ship.y = body.y;

    issue(engine, { type: 'SURVEY', targetId: body.id, approach: 'remote', deep: false }, shipId);
    for (let i = 0; i < 600; i++) {
      engine.dispatchCommand({ type: 'pause', paused: false });
      host.frame(engine.step());
      if (ship.current === null) break;
    }

    expect(ship.current).toBeNull(); // the survey really completed
    expect(memoryTags(agentById(engine, agent.id))).not.toContainEqual(['discovery']);
  });
});

describe('P3-09 the closed loop (EVT-09, I-11)', () => {
  /** The same world, with only the Admiral's past behaviour differing. */
  const history = (kind: 'kept' | 'forced') => {
    const engine = quietEngine();
    const explorer = agentByCareer(engine, 'explorer');
    if (kind === 'kept') {
      settleFact(engine, {
        kind: 'promise-made',
        toAgentId: explorer.id,
        promiseType: 'equipment',
        description: 'Deep Scan 优先权限',
        fulfills: { kind: 'grant-module', key: 'deepScan' },
      });
      settleFact(engine, { kind: 'module-installed', moduleId: 'deepScan' });
    } else {
      engine.dispatchCommand({
        type: 'agentMessage',
        from: 'admiral',
        to: explorer.id,
        kind: 'override',
        text: '这是命令，继续执行。',
        payload: { directiveActionType: 'RETURN' },
      });
    }
    offerMission(engine, explorer.id, '又出现一个高风险调查机会，你去不去？');
    return engine;
  };

  const answerAfter = async (engine: SimulationEngine, threshold: number) => {
    const explorer = agentByCareer(engine, 'explorer');
    const observation = observationFor(engine, explorer.id);
    const client = new MockModelClient({
      rules: [
        {
          label: '信任高：接受',
          match: (o) => o.self.state.trustInAdmiral >= threshold,
          answer: { kind: 'decision', decision: { intent: 'respond', choiceId: 'accept', reason: '信任 Admiral' } },
        },
        {
          label: '信任低：反报价',
          match: (o) => o.self.state.trustInAdmiral < threshold,
          answer: {
            kind: 'decision',
            decision: {
              intent: 'respond',
              choiceId: 'counteroffer',
              reason: '需要额外保障',
              request: { type: 'teammate' },
            },
          },
        },
      ],
    });
    const outcome = await agentRuntime(client).requestDecision(observation);
    if (outcome.status !== 'decided') throw new Error('决策被丢弃：' + outcome.error);
    return outcome.decision;
  };

  it('the same Agent decides differently after a kept promise than after an Override', async () => {
    const kept = history('kept');
    const forced = history('forced');
    const keptAgent = agentById(kept, agentByCareer(kept, 'explorer').id);
    const forcedAgent = agentById(forced, agentByCareer(forced, 'explorer').id);

    // The past actually moved the state, and in opposite directions.
    expect(keptAgent.state.trustInAdmiral).toBeGreaterThan(forcedAgent.state.trustInAdmiral);
    expect(memoryTags(keptAgent).at(-1)).toEqual(['promise-kept']);
    expect(memoryTags(forcedAgent).at(-1)).toEqual(['admiral-override']);

    const threshold = (keptAgent.state.trustInAdmiral + forcedAgent.state.trustInAdmiral) / 2;
    const keptAnswer = await answerAfter(kept, threshold);
    const forcedAnswer = await answerAfter(forced, threshold);

    // Both halves of the acceptance criterion, in one test: the state differs *and* the decision does.
    expect(keptAnswer.choiceId).toBe('accept');
    expect(forcedAnswer.choiceId).toBe('counteroffer');
  });

  it('the deterministic score separates the two histories without any provider', () => {
    // The mechanism underneath the answer above: with no model at all, the settled state is enough
    // for the score to move in opposite directions, which is what Agent.md §50 asks for offline.
    const kept = history('kept');
    const forced = history('forced');
    const scored = (engine: SimulationEngine) => {
      const explorer = agentByCareer(engine, 'explorer');
      const observation = observationFor(engine, explorer.id);
      const candidate = candidateIn(observation);
      return decisionScore(scoringAgent(observation), observation, candidate);
    };
    expect(scored(kept).recentMemoryScore).toBeGreaterThan(0);
    expect(scored(forced).recentMemoryScore).toBeLessThan(0);
    expect(scored(kept).score).toBeGreaterThan(scored(forced).score);
  });

  it('the deterministic fallback answers the two histories differently, with no provider at all', () => {
    // The configuration the game actually runs in. `runtime.test.ts`'s EVT-09 test and the one above
    // both impose the differing answer with a provider keyed on trust; this one does not, so it is the
    // closer claim: the *band* separates the histories on its own.
    const answer = (engine: SimulationEngine) => {
      const explorer = agentByCareer(engine, 'explorer');
      const observation = observationFor(engine, explorer.id);
      return fallbackDecision(scoringAgent(observation), observation);
    };
    const keptAnswer = answer(history('kept'));
    const forcedAnswer = answer(history('forced'));

    expect(keptAnswer.intent).toBe('respond');
    expect(forcedAnswer.intent).toBe('respond');
    expect(keptAnswer.choiceId).toBeDefined();
    expect(forcedAnswer.choiceId).toBeDefined();
    expect(keptAnswer.choiceId).not.toBe(forcedAnswer.choiceId);
  });

  it('the two histories reach different answers through the real host, with no provider', async () => {
    // The whole loop, production-shaped: real `SimulationEngine`, real `AgentHost`, real scheduler,
    // no provider. The history on one side is produced by the game (a real REFIT fulfilling a real
    // promise); on the other it is the real Override command. Neither is patched in.
    const replyAfter = async (engine: SimulationEngine, agentId: string) => {
      const host = new AgentHost(engine, { root: REPO_ROOT, env: {} });
      engine.dispatchCommand({
        type: 'agentMessage',
        from: 'admiral',
        to: agentId,
        kind: 'command',
        text: '又出现一个高风险调查机会，你去不去？',
        payload: null,
      });
      for (let i = 0; i < 400; i++) {
        engine.dispatchCommand({ type: 'pause', paused: false });
        host.frame(engine.step());
        // `frame()` never awaits the decision (CLAUDE.md §2.4), so the microtask queue must run
        // before the next `pump()` can drain it.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (engine.state.agentMessages.some((m) => m.from === agentId)) break;
      }
      return engine.state.agentMessages.filter((m) => m.from === agentId).at(-1) ?? null;
    };

    /** Path A, produced by the game: promise made, then a real REFIT installs the module. */
    const keptByRefit = async () => {
      const engine = quietEngine();
      const host = new AgentHost(engine, { root: REPO_ROOT, env: {} });
      const explorer = agentByCareer(engine, 'explorer');
      const base = engine.state.locations.find((l) => l.owner === 'starfleet' && l.hull > 0)!;
      engine.state.resources.credits = 10_000;
      base.stock.materials = 1_000;
      base.stock.specialFinds = 10;
      settleFact(engine, {
        kind: 'promise-made',
        toAgentId: explorer.id,
        promiseType: 'equipment',
        description: 'Deep Scan 优先权限',
        fulfills: { kind: 'grant-module', key: 'deepScan' },
      });
      const flownBy = engine.state.ships.find((s) => s.id !== agentShipOf(engine, explorer))!;
      issue(engine, { type: 'REFIT', targetId: base.id, moduleId: 'deepScan', remove: false }, flownBy.id);
      for (let i = 0; i < 600; i++) {
        engine.dispatchCommand({ type: 'pause', paused: false });
        host.frame(engine.step());
        if (agentById(engine, explorer.id).promises.at(-1)!.status === 'fulfilled') break;
      }
      expect(agentById(engine, explorer.id).promises.at(-1)!.status).toBe('fulfilled');
      return { engine, explorerId: explorer.id };
    };

    const kept = await keptByRefit();
    const forcedEngine = history('forced');
    const keptReply = await replyAfter(kept.engine, kept.explorerId);
    const forcedReply = await replyAfter(forcedEngine, agentByCareer(forcedEngine, 'explorer').id);

    expect(keptReply).not.toBeNull();
    expect(forcedReply).not.toBeNull();
    // Same Agent, same question, same configuration — different answer, because the past differs.
    expect(keptReply!.kind).not.toBe(forcedReply!.kind);
  });
});
