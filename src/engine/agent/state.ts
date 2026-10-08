/**
 * Agent mutable state and its deterministic update rules (Agent.md §19/§20/§21/§42,
 * docs/lv3/02-decision-flow.md §5).
 *
 * Trust, loyalty, morale and fatigue are **separate variables** and must stay separate (Agent.md
 * §20): an Agent may still be loyal to the company while no longer believing the Admiral. Every
 * update is a pure function returning both the new state and the change actually applied, so
 * `AgentInteraction.effects` can record what really happened after clamping.
 *
 * Pure module: no I/O, no clock, no randomness.
 */
import { clamp100 } from './personality';
import type { AgentState, AgentStateDelta } from './types';

export type FatigueBand = 'normal' | 'fatigued' | 'severe-fatigue' | 'forced-rest';

/** Agent.md §21: 0-39 normal / 40-69 fatigued / 70-84 severe / 85-100 forced rest. */
export function fatigueBand(fatigue: number): FatigueBand {
  if (fatigue >= 85) return 'forced-rest';
  if (fatigue >= 70) return 'severe-fatigue';
  if (fatigue >= 40) return 'fatigued';
  return 'normal';
}

/** Agent.md §21 mission costs. */
export const TASK_FATIGUE = 10;
export const HIGH_RISK_FATIGUE = 15;
export const FAILURE_FATIGUE = 15;
export const REST_RECOVERY = 20;

/** Agent.md §42: an Override is never free. Exact values, asserted by the test suite. */
export const OVERRIDE_EFFECT: Readonly<AgentStateDelta> = Object.freeze({
  trustInAdmiral: -10,
  morale: -5,
  stress: 10,
  loyaltyToCompany: 0,
  fatigue: 0,
  goalProgress: 0,
  experience: 0,
});

/**
 * Agent.md §19 gives directions but no magnitudes; these are proposals, calibrated in P3 against
 * real decision outcomes. The test suite asserts direction and the recorded delta, not the "right"
 * size.
 */
export const PROMISE_KEPT_EFFECT: Readonly<AgentStateDelta> = Object.freeze({
  trustInAdmiral: 10,
  loyaltyToCompany: 5,
  morale: 10,
  stress: 0,
  fatigue: 0,
  goalProgress: 5,
  experience: 0,
});
export const PROMISE_BROKEN_EFFECT: Readonly<AgentStateDelta> = Object.freeze({
  trustInAdmiral: -15,
  loyaltyToCompany: -5,
  morale: -5,
  stress: 10,
  fatigue: 0,
  goalProgress: 0,
  experience: 0,
});

/** Mission settlement magnitudes (docs/lv3/02-decision-flow.md §5). */
export const MISSION_SUCCESS_EFFECT: Readonly<AgentStateDelta> = Object.freeze({
  trustInAdmiral: 0,
  loyaltyToCompany: 0,
  morale: 5,
  stress: -5,
  fatigue: TASK_FATIGUE,
  goalProgress: 10,
  experience: 10,
});
export const MISSION_FAILURE_EFFECT: Readonly<AgentStateDelta> = Object.freeze({
  trustInAdmiral: 0,
  loyaltyToCompany: 0,
  morale: -10,
  stress: 15,
  fatigue: FAILURE_FATIGUE,
  goalProgress: 0,
  experience: 2,
});

export function emptyDelta(): AgentStateDelta {
  return {
    trustInAdmiral: 0,
    loyaltyToCompany: 0,
    morale: 0,
    stress: 0,
    fatigue: 0,
    goalProgress: 0,
    experience: 0,
  };
}

/** Sums deltas. `relationship` is carried over only when exactly one input defines it. */
export function addDelta(...deltas: readonly AgentStateDelta[]): AgentStateDelta {
  const total = deltas.reduce((sum, d) => {
    sum.trustInAdmiral += d.trustInAdmiral;
    sum.loyaltyToCompany += d.loyaltyToCompany;
    sum.morale += d.morale;
    sum.stress += d.stress;
    sum.fatigue += d.fatigue;
    sum.goalProgress += d.goalProgress;
    sum.experience += d.experience;
    if (d.relationship) sum.relationship = { ...d.relationship };
    return sum;
  }, emptyDelta());
  return total;
}

/**
 * Applies a delta and clamps every bounded field into `[0, 100]` (experience floors at 0 and has no
 * ceiling). Returns the delta **actually applied**, which is what gets recorded on
 * `AgentInteraction.effects` — saturating, not nominal.
 */
export function applyStateDelta(
  state: AgentState,
  delta: AgentStateDelta,
): { state: AgentState; effects: AgentStateDelta } {
  const next: AgentState = {
    fatigue: clamp100(state.fatigue + delta.fatigue),
    stress: clamp100(state.stress + delta.stress),
    morale: clamp100(state.morale + delta.morale),
    trustInAdmiral: clamp100(state.trustInAdmiral + delta.trustInAdmiral),
    loyaltyToCompany: clamp100(state.loyaltyToCompany + delta.loyaltyToCompany),
    goalProgress: clamp100(state.goalProgress + delta.goalProgress),
    experience: Math.max(0, state.experience + delta.experience),
    reputation: state.reputation,
  };
  const effects: AgentStateDelta = {
    trustInAdmiral: next.trustInAdmiral - state.trustInAdmiral,
    loyaltyToCompany: next.loyaltyToCompany - state.loyaltyToCompany,
    morale: next.morale - state.morale,
    stress: next.stress - state.stress,
    fatigue: next.fatigue - state.fatigue,
    goalProgress: next.goalProgress - state.goalProgress,
    experience: next.experience - state.experience,
  };
  if (delta.relationship) effects.relationship = { ...delta.relationship };
  return { state: next, effects };
}

export function missionSuccess(
  state: AgentState,
  options: { highRisk?: boolean } = {},
): { state: AgentState; effects: AgentStateDelta } {
  const delta = addDelta(
    MISSION_SUCCESS_EFFECT,
    options.highRisk ? { ...emptyDelta(), fatigue: HIGH_RISK_FATIGUE - TASK_FATIGUE } : emptyDelta(),
  );
  return applyStateDelta(state, delta);
}

export function missionFailure(state: AgentState): {
  state: AgentState;
  effects: AgentStateDelta;
} {
  return applyStateDelta(state, MISSION_FAILURE_EFFECT);
}

/** Agent.md §21: rest recovers 20 fatigue. A resting Agent's stress also eases. */
export function rest(state: AgentState): { state: AgentState; effects: AgentStateDelta } {
  return applyStateDelta(state, { ...emptyDelta(), fatigue: -REST_RECOVERY, stress: -10 });
}
