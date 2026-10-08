/**
 * Admiral <-> Agent and Agent <-> Agent interactions (Agent.md §36–§43,
 * docs/lv3/02-domain-model.md §12/§13).
 *
 * Two records come out of every interaction:
 *  - an `AgentMessage`, the bidirectional narrative (who said what to whom, and whether it was
 *    read) — distinct from the existing one-way `Communication` world feed, which the engine also
 *    writes so the existing UI shows Agent speech with zero UI changes;
 *  - an `AgentInteraction`, the audit record, whose `effects` hold the state change that **actually
 *    applied** after clamping. That field is what makes `Agent.md` §59's assertions
 *    (Override -> trust moves, Promise -> trust moves) possible instead of aspirational.
 *
 * Only `override` carries a fixed psychological cost (Agent.md §42, exact −10/−5/+10). Every other
 * kind is deliberately neutral here: Agent.md gives magnitudes for nothing else, and `encourage` in
 * particular must **not** raise values unconditionally (§41), so it changes nothing on its own.
 *
 * Pure module: no I/O, no clock, no randomness. Ids are supplied by the caller so the engine stays
 * the only allocator.
 */
import { episodicMemory } from './memory';
import { applyStateDelta, OVERRIDE_EFFECT, emptyDelta } from './state';
import type {
  Agent,
  AgentMessage,
  AgentMessageKind,
  AgentStateDelta,
  EpisodicMemory,
  InteractionKind,
  InteractionOutcome,
  MessagePayload,
} from './types';

/** Bounded collections (docs/lv3/03-implementation-plan.md §6.3). The save ceiling is 32MB. */
export const AGENT_MESSAGE_CAP = 200;
export const AGENT_INTERACTION_CAP = 200;

/** Message kinds that also produce an `AgentInteraction` record. `report` is speech only. */
export const INTERACTION_KINDS: readonly InteractionKind[] = Object.freeze([
  'command',
  'ask',
  'negotiate',
  'promise',
  'encourage',
  'override',
  'team-request',
  'team-reply',
]);

const INTERACTION_KIND_SET: ReadonlySet<string> = new Set<string>(INTERACTION_KINDS);

export function createsInteraction(kind: AgentMessageKind): kind is InteractionKind {
  return INTERACTION_KIND_SET.has(kind);
}

/**
 * The outcome an interaction resolves to, derived from its kind and payload. Only `override` is
 * `forced` (Agent.md §42); a team reply reports what the answer was.
 */
export function interactionOutcomeFor(
  kind: AgentMessageKind,
  payload: MessagePayload | null,
): InteractionOutcome {
  if (kind === 'override') return 'forced';
  if (kind === 'team-reply')
    return payload && 'accept' in payload && payload.accept ? 'accepted' : 'rejected';
  if (kind === 'negotiate') return 'countered';
  if (kind === 'promise') return 'accepted';
  return 'pending';
}

export function createMessage(input: {
  id: string;
  at: number;
  from: string;
  to: string;
  kind: AgentMessageKind;
  text: string;
  payload: MessagePayload | null;
}): AgentMessage {
  return {
    id: input.id,
    at: input.at,
    from: input.from,
    to: input.to,
    kind: input.kind,
    text: input.text,
    payload: input.payload,
    read: false,
  };
}

/**
 * The intended psychological effect of an interaction, before clamping.
 *
 * `override` is Agent.md §42: trust −10, morale −5, stress +10. It cannot be offset by
 * encouragement (§41), which is why nothing else contributes here.
 */
export function interactionEffect(
  kind: InteractionKind,
  outcome: InteractionOutcome,
): AgentStateDelta {
  if (kind === 'override' && outcome === 'forced') return { ...OVERRIDE_EFFECT };
  return emptyDelta();
}

/**
 * Applies an interaction to its target Agent and records the delta that actually took effect.
 */
export function applyInteraction(
  target: Agent,
  kind: InteractionKind,
  outcome: InteractionOutcome,
): { agent: Agent; effects: AgentStateDelta } {
  const { state, effects } = applyStateDelta(target.state, interactionEffect(kind, outcome));
  return { agent: { ...target, state }, effects };
}

/**
 * Agent.md §42: an Override is not free, and it must be remembered — "Admiral forced me to
 * continue despite my refusal" is the memory that makes the next decision more conservative.
 *
 * The text names only the action type, never a world entity, so remembering an Override can never
 * carry an undiscovered name into an observation.
 */
export function overrideMemoryText(actionType: string): string {
  return 'Admiral 强制我执行 ' + actionType + '，无视我的判断。';
}

export function overrideMemory(input: {
  id: string;
  at: number;
  actionType: string;
}): EpisodicMemory {
  return episodicMemory({
    id: input.id,
    at: input.at,
    text: overrideMemoryText(input.actionType),
    tags: ['admiral-override'],
  });
}

/** Whether a message kind answers a task offer, which is what `accept`/`reject` mean. */
export function isTaskOfferKind(kind: AgentMessageKind): boolean {
  return ['command', 'ask', 'negotiate', 'promise'].includes(kind);
}
