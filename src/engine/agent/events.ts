/**
 * Lv3 Agent settlement planner (docs/lv3/09-game-integration-status.md).
 *
 * P0–P2.5 built the **decision** side of Lv3 and left the **settlement** side unwired: `missionSuccess`,
 * `missionFailure`, `applyGoalProgress`, `teamUp`, `createPromise`/`resolveFulfillments` and every
 * non-Override memory write had unit tests and **no production caller**. Nothing an engine branch did
 * could change an Agent. This module is where the two meet.
 *
 * It carries no numbers of its own: an `AgentEvent` says *what happened*, and every magnitude comes
 * from the domain module that already owns it. That keeps a single source of truth and means the
 * engine never grows a second copy of the settlement rules.
 *
 * Pure: no clock, no randomness, no I/O. Ids are minted through the injected `mint`, so the result is
 * a function of its inputs and the same-seed replay assertion (`tests/architecture.test.ts`) holds.
 */
import type { WorldState } from '../types';
import { applyGoalProgress, GOAL_PROGRESS } from './goals';
import { episodicMemory, remember } from './memory';
import { boundPromises, createPromise, idsSettledBy, resolveFulfillments } from './promise';
import { conflict, teamUp } from './relationship';
import { missionFailure, missionSuccess, PROMISE_KEPT_EFFECT } from './state';
import type { Agent, AgentEvent, AgentState } from './types';
import { applyStateDelta } from './state';

/** The Agent commanding a ship, through the existing operator/assignment binding. */
export function agentOfShip(w: WorldState, shipId: string): Agent | null {
  const assignment = w.assignments.find((a) => a.shipId === shipId);
  const operator = w.operators.find((o) => o.id === assignment?.operatorId);
  if (!operator?.agentId) return null;
  return w.agents.find((a) => a.id === operator.agentId) ?? null;
}

export interface SettledAgents {
  /** The new roster. Agents the event did not touch are returned unchanged. */
  agents: Agent[];
  /** The Agents whose state actually moved, so the caller can log or assert on them. */
  changed: string[];
}

/**
 * Applies one settlement fact. Returns `null` when the fact names nothing this world can settle —
 * the caller turns that into a refused `CommandResult` rather than a silent no-op.
 */
export function settleAgentEvent(
  w: WorldState,
  event: AgentEvent,
  mint: () => string,
): SettledAgents | null {
  switch (event.kind) {
    case 'mission-settled':
      return settleMission(w, event, mint);
    case 'promise-made':
      return settlePromiseMade(w, event, mint);
    case 'module-installed':
      return settleModuleInstalled(w, event, mint);
    case 'team-resolved':
      return settleTeam(w, event);
    case 'discovery':
      return settleDiscovery(w, event, mint);
  }
}

/** Replaces one Agent in the roster and reports it as changed. */
function withAgent(w: WorldState, next: Agent): SettledAgents {
  return {
    agents: w.agents.map((candidate) => (candidate.id === next.id ? next : candidate)),
    changed: [next.id],
  };
}

/** Replaces several Agents at once (a team-up moves both sides). */
function withAgents(w: WorldState, replacements: readonly Agent[]): SettledAgents {
  const byId = new Map(replacements.map((agent) => [agent.id, agent]));
  return {
    agents: w.agents.map((candidate) => byId.get(candidate.id) ?? candidate),
    changed: replacements.map((agent) => agent.id),
  };
}

/**
 * State moves and the goal mirror keeps up.
 *
 * `state.goalProgress` and `goal.progress` are two views of one number (docs/lv3/02-domain-model.md
 * §3). `applyStateDelta` moves only the state half, so the change it actually applied is mirrored
 * back onto the goal, clamped the same way, to keep the two equal.
 */
function applyDelta(agent: Agent, state: AgentState, applied: number): Agent {
  return applyGoalProgress({ ...agent, state }, applied).agent;
}

function settleMission(
  w: WorldState,
  event: Extract<AgentEvent, { kind: 'mission-settled' }>,
  mint: () => string,
): SettledAgents | null {
  const agent = agentOfShip(w, event.shipId);
  if (!agent) return null;

  const success = event.outcome === 'success';
  const { state, effects } = success ? missionSuccess(agent.state) : missionFailure(agent.state);

  return withAgent(w, {
    ...applyDelta(agent, state, effects.goalProgress),
    memories: remember(
      agent.memories,
      episodicMemory({
        id: mint(),
        at: w.time,
        // Names only the action type, never a world entity — same rule as `overrideMemoryText`, so a
        // mission memory can never carry an undiscovered name into a later observation (N-7).
        text: success
          ? '我完成了 ' + event.actionType + ' 任务。'
          : '我没能完成 ' + event.actionType + ' 任务。',
        tags: [success ? 'mission-success' : 'mission-failure'],
      }),
    ),
  });
}

/**
 * The Admiral promises something. This is the only path that creates a promise: the social message
 * that accompanies it (`agentMessage{kind:'promise'}`) carries a bare id and could not express the
 * condition, so a promise that exists is always one the engine built from a stated `fulfills`.
 */
function settlePromiseMade(
  w: WorldState,
  event: Extract<AgentEvent, { kind: 'promise-made' }>,
  mint: () => string,
): SettledAgents | null {
  const agent = w.agents.find((candidate) => candidate.id === event.toAgentId);
  if (!agent) return null;
  return withAgent(w, {
    ...agent,
    promises: boundPromises([
      ...agent.promises,
      createPromise({
        id: mint(),
        to: agent.id,
        type: event.promiseType,
        description: event.description,
        fulfills: event.fulfills,
        createdAt: w.time,
      }),
    ]),
  });
}

/**
 * Something was actually installed — which is what a promise like "after this mission, Deep Scan
 * priority is yours" was waiting for.
 *
 * World-scoped on purpose: the promise names a **beneficiary**, and the hull that flies the REFIT
 * need not be theirs (`execution.ts` installs modules on whichever ship ran the directive). Matching
 * per ship would miss the real case.
 */
function settleModuleInstalled(
  w: WorldState,
  event: Extract<AgentEvent, { kind: 'module-installed' }>,
  mint: () => string,
): SettledAgents {
  const signal = { kind: 'module-installed', moduleId: event.moduleId } as const;
  const replacements: Agent[] = [];
  for (const agent of w.agents) {
    const settled = resolveFulfillments(agent.promises, [signal], w.time);
    const fulfilledIds = idsSettledBy(agent.promises, settled);
    if (fulfilledIds.length === 0) continue;
    const { state, effects } = applyStateDelta(agent.state, PROMISE_KEPT_EFFECT);
    let memories = agent.memories;
    for (const promise of settled) {
      if (!fulfilledIds.includes(promise.id)) continue;
      // Episodic, **not** `promiseMemory`: `memoryContribution` reads only episodic memories, so a
      // `kind: 'promise'` record would move no score and a kept promise would leave no trace in the
      // next decision — which is exactly what EVT-09 measures. The promise id rides on `subjectId`
      // so the link back to the promise is not lost.
      memories = remember(
        memories,
        episodicMemory({
          id: mint(),
          at: w.time,
          text: 'Admiral 兑现了承诺：' + promise.description,
          tags: ['promise-kept'],
          subjectId: promise.id,
        }),
      );
    }
    replacements.push({
      ...applyDelta(agent, state, effects.goalProgress),
      promises: settled,
      memories,
    });
  }
  return replacements.length ? withAgents(w, replacements) : { agents: w.agents, changed: [] };
}

/** Two Agents agreed to fly together, or one declined — both sides move in one write. */
function settleTeam(
  w: WorldState,
  event: Extract<AgentEvent, { kind: 'team-resolved' }>,
): SettledAgents | null {
  const a = w.agents.find((candidate) => candidate.id === event.aAgentId);
  const b = w.agents.find((candidate) => candidate.id === event.bAgentId);
  if (!a || !b || a.id === b.id) return null;
  const moved = event.accepted
    ? teamUp({ id: a.id, relationships: a.relationships }, { id: b.id, relationships: b.relationships })
    : conflict({ id: a.id, relationships: a.relationships }, { id: b.id, relationships: b.relationships });
  // `teamUp` returns both lists together so "A changed but B did not" cannot happen by omission.
  return withAgents(w, [
    { ...a, relationships: moved.a },
    { ...b, relationships: moved.b },
  ]);
}

/**
 * The ship found something. Idempotent by `subjectId`: an Agent that surveys the same anomaly twice
 * remembers it once, which is why the emission site does not have to guard against re-surveys.
 */
function settleDiscovery(
  w: WorldState,
  event: Extract<AgentEvent, { kind: 'discovery' }>,
  mint: () => string,
): SettledAgents | null {
  const agent = agentOfShip(w, event.shipId);
  if (!agent) return null;
  const already = agent.memories.some(
    (memory) =>
      memory.kind === 'episodic' &&
      memory.subjectId === event.bodyId &&
      memory.tags.includes('discovery'),
  );
  if (already) return { agents: w.agents, changed: [] };
  return withAgent(w, {
    ...applyGoalProgress(agent, GOAL_PROGRESS.anomalyDiscovered).agent,
    memories: remember(
      agent.memories,
      episodicMemory({
        id: mint(),
        at: w.time,
        text: '我们发现了未知异常，值得继续调查。',
        tags: ['discovery'],
        subjectId: event.bodyId,
      }),
    ),
  });
}
