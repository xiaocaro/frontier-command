/**
 * Decision validation and deterministic fallback (Agent.md §55 Rule 3, §58;
 * docs/lv3/03-api-contract.md §4.5).
 *
 * This module is the whole of Rule 3: a model response is **data**, and the only things it may say
 * are "here is my intent, my reason, and which of the options you gave me I pick". It cannot name a
 * target, cannot supply parameters, and cannot reach the engine. If its `choiceId` is not one of the
 * offered ids the answer is rejected — it is never "helpfully" reinterpreted as a raw action.
 *
 * It also deliberately does **not** validate game rules. Whether an ESCORT is possible is
 * `validateAction`'s job (src/engine/command-system.ts); doing it here would create a second rules
 * authority. This module only answers "is this well-formed, and did it choose from the menu".
 *
 * Pure: no I/O, no clock, no randomness, no throwing. That is what makes the offline test suite
 * (Agent.md §59) possible.
 */
import { RULES } from '../definitions/rules';
import { isSocialChoiceId } from './actions';
import { scoreBand, rankCandidates, type DecisionBand } from './score';
import { agentDecisionSchema } from './schemas';
import type { Agent, AgentActionCandidate, AgentDecision, AgentObservation } from './types';

/**
 * The prompt version stamped on decisions produced in this stage. P1 introduces the versioned
 * prompt files under `prompts/agent/`; this constant is the single place that names the version
 * until then, and `AgentDecision.promptVersion` must always equal it (CLAUDE.md §7).
 */
export const AGENT_PROMPT_VERSION = 'agent-v2';

/** The six failure classes the provider layer reports (docs/lv3/03-api-contract.md §4.4). */
export type ModelError =
  | 'timeout'
  | 'http-error'
  | 'invalid-json'
  | 'schema-mismatch'
  | 'invalid-choice-id'
  | 'unavailable';

/**
 * Validation additionally separates **staleness**, because the approved failure table treats it
 * differently from every provider failure: a stale decision is dropped **without** fallback
 * (docs/lv3/03-api-contract.md §6). Folding it into one of the six provider codes would make that
 * distinction invisible to the caller, so it gets its own code here.
 */
export type ValidationError = ModelError | 'stale';

export type ValidationResult =
  | { ok: true; decision: AgentDecision }
  | { ok: false; error: ValidationError };

/**
 * The result of validating only what a *provider* is allowed to judge: structure, choice ownership
 * and addressability. Staleness is absent by construction, and the narrower type says so — a caller
 * that receives `ShapeValidationResult` cannot accidentally believe it has been told "stale".
 */
export type ShapeValidationResult =
  | { ok: true; decision: AgentDecision }
  | { ok: false; error: ModelError };

/**
 * How stale an observation may be before its decision is worthless: one decision interval. Past
 * that, the world has moved on by a full scheduler beat.
 */
export const STALE_TICK_LIMIT = RULES.agentDecisionInterval * 10;

/**
 * Stale means the answer was formed against a materially older (or impossible future) world. Such
 * an answer is dropped without fallback: a deterministic score computed from the *old* observation
 * would be just as wrong, and the right response is to re-evaluate next beat.
 */
export function isStale(decision: AgentDecision, observation: AgentObservation): boolean {
  const age = observation.tick - decision.observationTick;
  return age < 0 || age > STALE_TICK_LIMIT;
}

const isOffered = (observation: AgentObservation, choiceId: string): boolean =>
  observation.availableActions.some((candidate) => candidate.id === choiceId);

/**
 * The Agents this one may address: exactly the peers in its own relationship roster.
 *
 * An Agent's roster is built at world creation for the whole starting crew, so this is "the people
 * I know", not "everybody who exists". A decision naming anyone else is naming somebody the Agent
 * cannot see, which is precisely the failure `docs/lv3/02-llm-boundary.md` §9 warns about — an
 * answer that references an entity outside the observation.
 */
export function addressableAgents(observation: AgentObservation): string[] {
  return observation.relationships
    .map((r) => r.targetAgentId)
    .filter((id) => id !== observation.agentId)
    .sort();
}

/**
 * Structure, choice ownership and addressability — everything except staleness.
 *
 * This is deliberately the half a **provider** may apply on its own (docs/lv3/03-api-contract.md
 * §4.4: "只做 JSON 解析 + AgentDecision Zod 校验 + choiceId 归属校验"). Staleness is not a property
 * of the answer, it is a property of the *pair* (answer, world) as the runtime sees it at the moment
 * it is about to act, so it stays out of this function and lives in `validateDecision`.
 *
 * Order matters: structure first, then every id the decision names, then `act`'s extra rule. A
 * well-formed decision choosing an id it was never offered gets `invalid-choice-id` — never a
 * synthesised action.
 */
export function validateDecisionShape(
  raw: unknown,
  observation: AgentObservation,
): ShapeValidationResult {
  const parsed = agentDecisionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'schema-mismatch' };
  const decision = parsed.data;
  // Whatever the intent, a `choiceId` is a claim about the menu. If it is not on the menu the
  // decision is answered with a refusal, not with a guess.
  if (decision.choiceId !== undefined && !isOffered(observation, decision.choiceId))
    return { ok: false, error: 'invalid-choice-id' };
  if (decision.intent === 'act') {
    // `act` means "submit this Action to the engine", so a social option is not eligible for it —
    // it may only be chosen as a social intent (see `isSocialChoiceId`).
    if (!decision.choiceId) return { ok: false, error: 'invalid-choice-id' };
    if (isSocialChoiceId(decision.choiceId)) return { ok: false, error: 'invalid-choice-id' };
  }
  const target = decision.request?.targetAgentId;
  if (target !== undefined && !addressableAgents(observation).includes(target))
    return { ok: false, error: 'invalid-choice-id' };
  return { ok: true, decision };
}

/**
 * The full gate: `validateDecisionShape` plus the staleness test.
 *
 * This is what the runtime applies to whatever comes back from a provider (docs/lv3/03-api-contract.md
 * §4.5), including a provider that claims success. Re-checking rather than trusting the provider is
 * the point: the model layer is untrusted by construction (Rule 3).
 */
export function validateDecision(raw: unknown, observation: AgentObservation): ValidationResult {
  const shaped = validateDecisionShape(raw, observation);
  if (!shaped.ok) return shaped;
  if (isStale(shaped.decision, observation)) return { ok: false, error: 'stale' };
  return shaped;
}

/**
 * Parses a JSON string from a provider, mapping a parse failure onto the right error code.
 *
 * Staleness is not applied here, for the same reason it is absent from `validateDecisionShape`.
 */
export function parseDecisionText(
  text: string,
  observation: AgentObservation,
): ShapeValidationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid-json' };
  }
  return validateDecisionShape(raw, observation);
}

/** True when the decision was formed against exactly the observation the caller still holds. */
export function matchesObservation(
  decision: AgentDecision,
  observation: AgentObservation,
): boolean {
  return decision.observationTick === observation.tick;
}

/**
 * The deterministic answer, in the same shape the model must produce — only `provider` differs
 * (docs/lv3/02-decision-flow.md §3.6). Without this the offline test suite and the same-seed replay
 * assertion would both be impossible.
 *
 * Thresholds follow Agent.md §46. The `45-69` band deliberately resolves to `wait`: that is exactly
 * the band that *needs* judgement, and standing still is the only choice that cannot do harm.
 *
 * A social option is answered with a social intent (`respond`) carrying the chosen `choiceId`; it is
 * never dressed up as `act`, because `act` means "submit this Action to the engine".
 */
export function fallbackDecision(
  agent: Agent,
  observation: AgentObservation,
  promptVersion = AGENT_PROMPT_VERSION,
): AgentDecision {
  const best = rankCandidates(agent, observation)[0] ?? null;
  const base = {
    promptVersion,
    observationTick: observation.tick,
    provider: 'deterministic' as const,
  };
  if (!best) return { ...base, intent: 'wait', reason: '当前没有可执行的行动。' };
  const score = best.breakdown.score;
  if (isSocialChoiceId(best.candidate.id))
    return {
      ...base,
      intent: 'respond',
      choiceId: best.candidate.id,
      reason: '按确定性的目标与状态评估，先回应收到的消息。',
    };
  // Agent.md §46's "<25 = REJECT" band. `reject` is not one of the seven intents in
  // `schemas/agent-decision.schema.json` and that contract is not ours to edit, so a rejection is
  // expressed the way the flow already routes refusals: as a social response. With no offer on the
  // table there is nothing to refuse, and waiting is the honest answer.
  if (score < 25) {
    const refusal = observation.availableActions.find((c) => c.id === 'reject');
    return refusal
      ? { ...base, intent: 'respond', choiceId: refusal.id, reason: '当前没有值得执行的选择。' }
      : { ...base, intent: 'wait', reason: '当前没有值得执行的选择。' };
  }
  if (score < 45)
    return {
      ...base,
      intent: 'request',
      reason: '这项任务需要额外条件才值得接受。',
      request: { type: 'equipment' },
    };
  if (score < 70) return { ...base, intent: 'wait', reason: '需要更多判断，暂不行动。' };
  return {
    ...base,
    intent: 'act',
    choiceId: best.candidate.id,
    reason: '按确定性的目标与状态评估，这是当前最合适的选择。',
  };
}

/**
 * What the scheduler uses to decide whether a beat deserves a model call at all (Agent.md §35).
 * Low-priority beats resolve straight from `fallbackDecision` and never touch the network.
 */
export function evaluate(
  agent: Agent,
  observation: AgentObservation,
): {
  score: number;
  band: DecisionBand;
  candidate: AgentActionCandidate | null;
  fallback: AgentDecision;
} {
  const best = rankCandidates(agent, observation)[0] ?? null;
  const score = best?.breakdown.score ?? 0;
  return {
    score,
    band: scoreBand(score),
    candidate: best?.candidate ?? null,
    fallback: fallbackDecision(agent, observation),
  };
}
