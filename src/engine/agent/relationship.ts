/**
 * Agent-to-Agent relationships (Agent.md §13/§14/§43, docs/lv3/02-domain-model.md §6).
 *
 * A relationship is directional: A's view of B is a separate record from B's view of A, so every
 * symmetric event (a successful team-up, a conflict) must update **both** sides in one call —
 * `teamUp` returns both lists so "A changed but B did not" cannot happen by omission.
 *
 * Values: `value` is overall regard in `[-100, 100]`; `trust` and `cooperation` are `[0, 100]`.
 * Trust is kept apart from value on purpose — an Agent may like a colleague without trusting their
 * competence.
 *
 * Pure module: no I/O, no clock, no randomness.
 */
import type { AgentRelationship } from './types';

export const RELATIONSHIP_MIN = -100;
export const RELATIONSHIP_MAX = 100;

/** Starting point for a new relationship: neutral regard, baseline trust and cooperation. */
export const RELATIONSHIP_BASELINE = Object.freeze({ value: 0, trust: 50, cooperation: 50 });

export const TEAM_UP_VALUE = 10;
export const TEAM_UP_COOPERATION = 10;
export const CONFLICT_VALUE = -10;
export const CONFLICT_COOPERATION = -5;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function blankRelationship(targetAgentId: string): AgentRelationship {
  return { targetAgentId, ...RELATIONSHIP_BASELINE };
}

/**
 * Builds a complete relationship table for `selfId` covering `otherIds`, excluding any
 * self-reference and sorted by `targetAgentId` so the order never depends on roster iteration.
 */
export function blankRelationships(
  selfId: string,
  otherIds: readonly string[],
): AgentRelationship[] {
  return [...new Set(otherIds)]
    .filter((id) => id !== selfId)
    .sort()
    .map(blankRelationship);
}

export function findRelationship(
  relationships: readonly AgentRelationship[],
  targetAgentId: string,
): AgentRelationship | undefined {
  return relationships.find((r) => r.targetAgentId === targetAgentId);
}

export interface RelationshipDelta {
  value?: number;
  trust?: number;
  cooperation?: number;
}

/**
 * Applies a delta to one relationship. A self-target is a no-op returning the list unchanged: an
 * Agent never holds a relationship with itself (schema constraint on `targetAgentId`), and silently
 * dropping is safer than throwing inside a pure update.
 */
export function adjustRelationship(
  relationships: readonly AgentRelationship[],
  selfId: string,
  targetAgentId: string,
  delta: RelationshipDelta,
): AgentRelationship[] {
  if (targetAgentId === selfId) return relationships.map((r) => ({ ...r }));
  return relationships.map((r) =>
    r.targetAgentId === targetAgentId
      ? {
          targetAgentId: r.targetAgentId,
          value: clamp(r.value + (delta.value ?? 0), RELATIONSHIP_MIN, RELATIONSHIP_MAX),
          trust: clamp(r.trust + (delta.trust ?? 0), 0, 100),
          cooperation: clamp(r.cooperation + (delta.cooperation ?? 0), 0, 100),
        }
      : { ...r },
  );
}

/**
 * A successful team-up raises regard and cooperation on **both** sides. Returns the two updated
 * lists together.
 */
export function teamUp(
  a: { id: string; relationships: readonly AgentRelationship[] },
  b: { id: string; relationships: readonly AgentRelationship[] },
): { a: AgentRelationship[]; b: AgentRelationship[] } {
  return {
    a: adjustRelationship(a.relationships, a.id, b.id, {
      value: TEAM_UP_VALUE,
      cooperation: TEAM_UP_COOPERATION,
    }),
    b: adjustRelationship(b.relationships, b.id, a.id, {
      value: TEAM_UP_VALUE,
      cooperation: TEAM_UP_COOPERATION,
    }),
  };
}

/** A disagreement lowers regard and cooperation on both sides. */
export function conflict(
  a: { id: string; relationships: readonly AgentRelationship[] },
  b: { id: string; relationships: readonly AgentRelationship[] },
): { a: AgentRelationship[]; b: AgentRelationship[] } {
  return {
    a: adjustRelationship(a.relationships, a.id, b.id, {
      value: CONFLICT_VALUE,
      cooperation: CONFLICT_COOPERATION,
    }),
    b: adjustRelationship(b.relationships, b.id, a.id, {
      value: CONFLICT_VALUE,
      cooperation: CONFLICT_COOPERATION,
    }),
  };
}

/**
 * TeamFit input: how willing this Agent is to work with others right now. Uses the average
 * cooperation of the known relationships, or the neutral 50 when there is nobody to judge.
 */
export function averageCooperation(relationships: readonly AgentRelationship[]): number {
  if (!relationships.length) return 50;
  return (
    relationships.reduce((sum, r) => sum + r.cooperation, 0) / relationships.length
  );
}
