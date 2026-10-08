/**
 * What an Agent says (MVP EVT-01/EVT-02/EVT-03, docs/lv3/01-mvp-scenario.md §4).
 *
 * A social decision is not a ship order. `decision.ts` refuses to let `accept`/`reject`/`counteroffer`
 * or `team-accept:<id>` travel as `intent: 'act'`, and before P3 nothing carried them anywhere at all:
 * an Agent could decide to counteroffer and the world would never hear about it.
 *
 * This module is the other half — it turns a social decision into the `agentMessage` it *is*. It is
 * pure, and it invents nothing: every `choiceId` here is one `actions.ts` already put on the menu, so
 * an Agent can only ever say something the engine offered it the chance to say.
 */
import { decisionScore, scoreBand } from './score';
import type { Agent, AgentDecision, AgentMessageKind, AgentObservation, MessagePayload } from './types';

/** The Admiral is an address, not an Agent (`agentMessageSchema`). */
export const ADMIRAL = 'admiral';

export interface AgentReply {
  /** An Agent id, or `'admiral'`. */
  to: string;
  kind: AgentMessageKind;
  text: string;
  payload: MessagePayload | null;
}

/**
 * Used only when the decision carried no `say`. The Agent's own words are preferred; this keeps the
 * communications feed intelligible when a provider returns a choice without a line to go with it.
 */
const DEFAULT_LINE: Readonly<Record<string, string>> = Object.freeze({
  accept: '我接受这个任务。',
  reject: '这个任务我不能接。',
  counteroffer: '我可以去，但有条件。',
  'team-accept': '我加入。',
  'team-decline': '这次我去不了。',
  request: '我需要支援。',
});

function spoken(decision: AgentDecision, fallbackKey: string): string {
  const said = (decision.say ?? '').trim();
  return said.length > 0 ? said : (DEFAULT_LINE[fallbackKey] ?? '……');
}

export type OfferResponse = 'accept' | 'counteroffer' | 'reject';

/**
 * How the Agent answers a task offer, decided **once from the score** rather than by ranking the
 * three answers against each other.
 *
 * `actions.ts` gives `accept`, `reject` and `counteroffer` identical risk, reward and goal kinds, so
 * `decisionScore` gives them identical breakdowns and `rankCandidates` falls through to its id
 * tie-break — which can only ever produce `accept`. Ranking them therefore cannot distinguish them at
 * all; the Agent.md §46 bands can. So the offer is scored once and the band picks the answer.
 *
 * `null` when nothing is being offered (no `accept` on the menu), which is what keeps this from
 * inventing an answer to a question nobody asked.
 */
export function offerResponse(agent: Agent, observation: AgentObservation): OfferResponse | null {
  const offer = observation.availableActions.find((candidate) => candidate.id === 'accept');
  if (!offer) return null;
  const band = scoreBand(decisionScore(agent, observation, offer).score);
  if (band === 'accept') return 'accept';
  if (band === 'reject') return 'reject';
  // The middle bands are the ones whose fallback is a deliberate `wait` or a bare `request` — exactly
  // the bands a negotiation is for. An offer is not merely deferred; it is answered with terms.
  return 'counteroffer';
}

/**
 * The message a social decision amounts to, or `null` when the decision says nothing to anyone
 * (`wait`, `rest`, `quit`, or an `act`/`respond` whose choice is physical).
 */
export function replyFor(decision: AgentDecision): AgentReply | null {
  const choiceId = decision.choiceId ?? '';

  // A reply to another Agent's team request. The peer is in the choice id, which is why it does not
  // have to be guessed from the message log.
  if (choiceId.startsWith('team-accept:') || choiceId.startsWith('team-decline:')) {
    const peer = choiceId.slice(choiceId.indexOf(':') + 1);
    if (!peer) return null;
    const accept = choiceId.startsWith('team-accept:');
    return {
      to: peer,
      kind: 'team-reply',
      text: spoken(decision, accept ? 'team-accept' : 'team-decline'),
      payload: { requestingAgentId: peer, accept },
    };
  }

  // Answers to a task offer. `report` is speech only — `INTERACTION_KINDS` leaves it out, so an
  // acceptance does not manufacture an audit record it has not earned.
  if (choiceId === 'accept' || choiceId === 'reject')
    return { to: ADMIRAL, kind: 'report', text: spoken(decision, choiceId), payload: null };

  // A counteroffer, or a plain request. `AgentRequest.type` becomes the payload's `requestType`:
  // the two shapes name the same five values but spell the key differently.
  if (choiceId === 'counteroffer' || decision.intent === 'request') {
    const request = decision.request;
    return {
      to: ADMIRAL,
      kind: 'negotiate',
      text: spoken(decision, choiceId === 'counteroffer' ? 'counteroffer' : 'request'),
      payload: request
        ? {
            requestType: request.type,
            ...(request.targetAgentId ? { targetAgentId: request.targetAgentId } : {}),
            ...(request.value !== undefined ? { value: request.value } : {}),
          }
        : null,
    };
  }

  return null;
}
