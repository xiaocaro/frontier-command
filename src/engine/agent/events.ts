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
import { applyGoalProgress } from './goals';
import { episodicMemory, remember } from './memory';
import { missionFailure, missionSuccess } from './state';
import type { Agent, AgentEvent } from './types';

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
  }
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

  // `state.goalProgress` and `goal.progress` are two views of one number
  // (docs/lv3/02-domain-model.md §3). `applyStateDelta` moves only the state half, so mirror the
  // change it actually applied back onto the goal, clamped the same way, to keep the two equal.
  const mirrored = applyGoalProgress({ ...agent, state }, effects.goalProgress);

  const settled: Agent = {
    ...mirrored.agent,
    memories: remember(
      mirrored.agent.memories,
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
  };

  return {
    agents: w.agents.map((candidate) => (candidate.id === agent.id ? settled : candidate)),
    changed: [agent.id],
  };
}
