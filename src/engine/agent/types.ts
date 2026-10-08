/**
 * Lv3 Agent domain types.
 *
 * Split by one rule: **anything that is validated or persisted comes from `./schemas` (Zod, so the
 * contract has a single source); anything derived at runtime is declared here.**
 *
 * Derived types are never persisted:
 *   - `AgentObservation` is a per-Agent projection of `WorldState` (docs/lv3/02-domain-model.md §9)
 *   - `AgentTrigger` is a transient `SimulationEvent` variant carried on
 *     `SimulationEngine.pendingEvents`, which never enters `WorldState` state equality or saves
 *     (docs/lv3/03-implementation-plan.md §8.2).
 *
 * `Agent` is deliberately **not** the ship. It owns personality, goals, memory, relationships,
 * promises and career state; the physical world stays in `Ship` and is bound through the existing
 * `Assignment` (docs/lv3/02-domain-model.md §1/§8).
 */
import type { Body, IntelRecord, Opportunity, ReadonlyDeep, Ship, StarSystem } from '../types';
import type {
  AgentActionCandidate,
  AgentCareer,
  AgentGoal,
  AgentMemory,
  AgentMessage,
  AgentPersonality,
  AgentPromise,
  AgentRelationship,
  AgentState,
} from './schemas';

export type {
  Agent,
  AgentActionCandidate,
  AgentCareer,
  AgentDecision,
  AgentGoal,
  AgentInteraction,
  AgentIntent,
  AgentMemory,
  AgentMessage,
  AgentPersonality,
  AgentPromise,
  AgentProvider,
  AgentRelationship,
  AgentRequest,
  AgentState,
  AgentStateDelta,
  EpisodicMemory,
  GoalKind,
  InteractionKind,
  InteractionOutcome,
  MemoryTag,
  PromiseFulfillment,
  PromiseMemory,
  PromiseStatus,
  PromiseType,
  SocialMemory,
} from './schemas';
export type { AgentMessageKind, AgentRequestType, MessagePayload } from '../commands';

/** The Agent's own view of the current directive on its ship. */
export interface AgentDirectiveView {
  actionType: string;
  source: 'admiral' | 'standing';
  note: string;
}

/** Company-level context an Agent is allowed to see. */
export interface AgentCompanyView {
  credits: number;
  tension: number;
  priorities: string[];
}

export interface AgentSelfView {
  name: string;
  career: AgentCareer;
  personality: AgentPersonality;
  state: AgentState;
  goal: AgentGoal;
}

/**
 * Everything one Agent may know. Cropped on top of the already-cropped `snapshot()`: it must never
 * carry another Agent's memory/promise/state, `WorldState.enemies`, `seed`, `factions` internals,
 * other ships' holds or undiscovered geography (docs/lv3/02-domain-model.md §9, Rule 5).
 */
export interface AgentObservation {
  time: number;
  tick: number;
  operatorId: string;
  agentId: string;
  ship: Ship;
  self: AgentSelfView;
  company: AgentCompanyView;
  // These four come straight off the cropped `Snapshot`, so they keep its read-only typing: an
  // Agent may look at the world, never write to it.
  contacts: ReadonlyDeep<IntelRecord[]>;
  systems: ReadonlyDeep<StarSystem[]>;
  bodies: ReadonlyDeep<Body[]>;
  opportunities: ReadonlyDeep<Opportunity[]>;
  relationships: AgentRelationship[];
  recentMemory: AgentMemory[];
  pendingMessages: AgentMessage[];
  activePromise: AgentPromise | null;
  activeDirective: AgentDirectiveView | null;
  availableActions: AgentActionCandidate[];
}

/**
 * Discrete decision triggers. This is the carrier for "do not call the LLM every tick": triggers are
 * emitted from existing engine branches (docs/lv3/02-domain-model.md §14), not from a tick counter.
 * Emission itself lands in P1; P0 only fixes the shape.
 */
export type AgentTrigger =
  | { kind: 'ship-idle'; shipId: string }
  | { kind: 'directive-completed'; shipId: string; directiveId: string }
  | { kind: 'directive-failed'; shipId: string; directiveId: string; reason: string }
  | { kind: 'admiral-message'; messageId: string }
  | { kind: 'agent-request'; fromAgentId: string }
  | { kind: 'high-value-opportunity'; opportunityId: string }
  | { kind: 'danger'; contactId: string }
  | { kind: 'promise-changed'; promiseId: string }
  | { kind: 'world-event'; eventId: string }
  | { kind: 'no-decision-for'; minutes: number };
