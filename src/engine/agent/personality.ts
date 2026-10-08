/**
 * Five-dimensional personality (Agent.md §5, docs/lv3/02-domain-model.md §2).
 *
 * Personality is the *stable* half of an Agent; `AgentState` is the mutable half (Agent.md §6).
 * It is the reason two Agents with the same ship and the same orders react differently, and it is
 * the input to `RiskDiscomfort` and `SkillFit` in the DecisionScore.
 *
 * Pure module: no I/O, no clock, no randomness.
 */
import type { AgentCareer, AgentPersonality } from './types';

export const PERSONALITY_DIMENSIONS = [
  'riskTolerance',
  'curiosity',
  'loyalty',
  'cooperation',
  'ambition',
] as const;
export type PersonalityDimension = (typeof PERSONALITY_DIMENSIONS)[number];

export const clamp100 = (value: number): number => Math.min(100, Math.max(0, value));

/** Clamps every dimension into `[0, 100]`. Deterministic and total. */
export function clampPersonality(personality: AgentPersonality): AgentPersonality {
  return {
    riskTolerance: clamp100(personality.riskTolerance),
    curiosity: clamp100(personality.curiosity),
    loyalty: clamp100(personality.loyalty),
    cooperation: clamp100(personality.cooperation),
    ambition: clamp100(personality.ambition),
  };
}

/**
 * The four initial Agents (Agent.md §9–§12, docs/lv3/02-domain-model.md §2).
 *
 * These values are the approved proposal. They are *not* calibrated yet: the calibration happens in
 * P3 against real decision outcomes, so `tests/agent/domain.test.ts` asserts the table itself, not
 * that the numbers produce "good" play.
 */
export const INITIAL_PERSONALITIES: Readonly<Record<AgentCareer, AgentPersonality>> = Object.freeze({
  explorer: { riskTolerance: 75, curiosity: 90, loyalty: 55, cooperation: 55, ambition: 70 },
  scientist: { riskTolerance: 50, curiosity: 75, loyalty: 55, cooperation: 55, ambition: 70 },
  tactical: { riskTolerance: 70, curiosity: 25, loyalty: 85, cooperation: 80, ambition: 70 },
  logistics: { riskTolerance: 25, curiosity: 25, loyalty: 85, cooperation: 80, ambition: 50 },
});

export function initialPersonality(career: AgentCareer): AgentPersonality {
  return { ...INITIAL_PERSONALITIES[career] };
}

/** L1 distance between two personalities, 0–500. Used to assert that the roster is distinguishable. */
export function personalityDistance(a: AgentPersonality, b: AgentPersonality): number {
  return PERSONALITY_DIMENSIONS.reduce((sum, key) => sum + Math.abs(a[key] - b[key]), 0);
}
