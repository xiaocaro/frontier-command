/**
 * `AgentObservation` assembly (Agent.md §29/§30, docs/lv3/02-domain-model.md §9).
 *
 * An Agent never sees `WorldState`; it sees this. The world-level cropping (hidden geography,
 * `enemies`, `seed`, faction internals, other ships' holds) is already done by
 * `projection.snapshot()` and is deliberately **not** reimplemented here. This module adds exactly
 * one more layer: the **single-Agent** view. It must never carry another Agent's memory, promises
 * or state, nor anything an Agent has no business knowing.
 *
 * Memory text is the new leak vector to watch: it flows into the observation, so writers must never
 * embed the name of an undiscovered entity (`tests/recon.test.ts` asserts this).
 *
 * Keeping this pure (values in, values out) is what makes it unit-testable without an engine, and
 * it is why `projection.getObservation` only gathers cropped inputs and delegates the shape here.
 *
 * Pure module: no I/O, no clock, no randomness.
 */
import { recentMemories } from './memory';
import { activePromise } from './promise';
import type {
  Agent,
  AgentActionCandidate,
  AgentDirectiveView,
  AgentMessage,
  AgentObservation,
} from './types';
import type {
  Body,
  Directive,
  IntelRecord,
  Opportunity,
  ReadonlyDeep,
  Ship,
  StarSystem,
} from '../types';

/** Everything an observation needs, already cropped to what the owning Agent may see. */
export interface ObservationInput {
  time: number;
  tick: number;
  operatorId: string;
  agentId: string;
  ship: Ship;
  contacts: ReadonlyDeep<IntelRecord[]>;
  systems: ReadonlyDeep<StarSystem[]>;
  bodies: ReadonlyDeep<Body[]>;
  opportunities: ReadonlyDeep<Opportunity[]>;
  credits: number;
  tension: number;
  messages: readonly AgentMessage[];
  availableActions: readonly AgentActionCandidate[];
}

/** How many unread messages one decision gets to look at. */
export const PENDING_MESSAGE_LIMIT = 10;
/** How many memories one decision gets to look at. */
export const RECENT_MEMORY_LIMIT = 12;

/**
 * Unread messages addressed to this Agent, oldest first so the Agent answers in the order it was
 * spoken to. Ties break on `id` for a total order.
 */
export function pendingMessages(
  messages: readonly AgentMessage[],
  agentId: string,
  limit = PENDING_MESSAGE_LIMIT,
): AgentMessage[] {
  return messages
    .filter((m) => !m.read && m.to === agentId)
    .sort((a, b) => (a.at !== b.at ? a.at - b.at : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, limit)
    .map((m) => ({ ...m }));
}

/** The Agent's view of the directive currently on its ship. */
export function directiveView(directive: Directive | null): AgentDirectiveView | null {
  if (!directive) return null;
  return { actionType: directive.action.type, source: directive.source, note: directive.note };
}

/**
 * The company priorities an Agent is told about.
 *
 * `WorldState` has no player-authored "current focus" field, so this is derived rather than
 * invented: an Admiral directive on the Agent's own ship is the only standing statement of intent
 * the world actually holds.
 */
export function companyPriorities(directive: Directive | null): string[] {
  return directive?.source === 'admiral' ? [directive.action.type] : [];
}

export function buildObservation(agent: Agent, input: ObservationInput): AgentObservation {
  return {
    time: input.time,
    tick: input.tick,
    operatorId: input.operatorId,
    agentId: input.agentId,
    ship: input.ship,
    self: {
      name: agent.name,
      career: agent.career,
      personality: agent.personality,
      state: agent.state,
      goal: agent.goal,
    },
    company: {
      credits: input.credits,
      tension: input.tension,
      priorities: companyPriorities(input.ship.current),
    },
    contacts: [...input.contacts],
    systems: [...input.systems],
    bodies: [...input.bodies],
    opportunities: [...input.opportunities],
    relationships: agent.relationships.map((r) => ({ ...r })),
    recentMemory: recentMemories(agent.memories, RECENT_MEMORY_LIMIT),
    pendingMessages: pendingMessages(input.messages, agent.id),
    activePromise: activePromise(agent.promises),
    activeDirective: directiveView(input.ship.current),
    availableActions: input.availableActions.map((c) => ({ ...c })),
  };
}
