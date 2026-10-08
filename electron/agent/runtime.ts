/**
 * The decision runtime (docs/lv3/03-api-contract.md §4.7, §5).
 *
 * One job: turn an `AgentObservation` into a **validated** `AgentDecision`, whatever the provider
 * does. The pipeline is exactly the approved one and nothing more:
 *
 * ```text
 * AgentObservation
 *     ↓ buildDecisionRequest                       (prompt.ts)
 * ModelClient.decide                               (async, the only await in the system)
 *     ↓ AgentDecision | ModelError
 * validateDecision                                 (src/engine/agent/decision.ts)
 *     ↓ ok | schema-mismatch | invalid-choice-id | stale
 * validated AgentDecision  ·  or the deterministic fallback
 * ```
 *
 * Two entry points, split on purpose:
 *
 * ```text
 * requestDecision(observation)   → a validated AgentDecision. Pure: starts nothing, changes nothing.
 * applyDecision(observation, d)  → resolve the choiceId and hand the Action to the engine.
 * ```
 *
 * The split is what lets every P1/P2 test keep asserting that asking for a decision leaves the world
 * untouched, while `applyDecision` is the one place a decision becomes a physical act. What it still
 * does **not** do:
 *
 * ```text
 * does not touch WorldState or SimulationEngine  ← never (Rule 1); it needs no reference to either
 * does not decide *when* to ask                  ← the scheduler
 * does not invent a target or a parameter        ← resolves the choiceId to the option the engine
 *                                                  already offered, and nothing else (Rule 3)
 * ```
 *
 * It reaches the engine through an injected `ActionSubmitter` rather than a controller port, so this
 * module never names the command seam — the host binds it. That is what keeps the agent layer free
 * of any engine reference (see `tests/agent/boundary.test.ts`).
 *
 * Failures are values, never exceptions. A provider that times out, returns malformed JSON, invents
 * a `choiceId`, or throws outright produces the same thing: a deterministic decision in the same
 * shape, differing only in `provider` (docs/lv3/02-decision-flow.md §3.6). The single exception is a
 * **stale** answer — that one is discarded with no fallback, because a deterministic score computed
 * from the same outdated observation would be just as wrong (§3.5).
 */
import {
  fallbackDecision,
  validateDecision,
  type ValidationError,
} from '../../src/engine/agent/decision';
import type { Agent, AgentDecision, AgentObservation } from '../../src/engine/agent/types';
import { replyFor } from '../../src/engine/agent/dialogue';
import type { AgentReply } from '../../src/engine/agent/dialogue';
import type { Action, AgentMessageKind, CommandResult } from '../../src/engine/types';
import type { JsonSchema, ModelClient, ModelError, ModelResult } from './model-client';
import { buildDecisionRequest, type PromptTemplates } from './prompt';

/**
 * The `Agent` facts one observation carries, in the shape `DecisionScore` expects.
 *
 * The runtime never holds a `WorldState` (Rule 1), so the deterministic fallback is computed from
 * the observation alone. That is not a workaround — `AgentObservation` is *designed* to be the
 * Agent's own view of everything scoring needs (career, personality, state, goal, relationships,
 * active promise), which is exactly why observation-carried trust and memory can change the
 * fallback, and why Agent.md §50's loop holds even with no model in the system.
 */
export function scoringAgent(observation: AgentObservation): Agent {
  const { self } = observation;
  return {
    id: observation.agentId,
    name: self.name,
    career: self.career,
    personality: self.personality,
    state: self.state,
    goal: self.goal,
    relationships: observation.relationships,
    memories: observation.recentMemory,
    promises: observation.activePromise ? [observation.activePromise] : [],
    nextDecisionAt: observation.time,
  };
}

/**
 * Runtime-level traceability (Agent.md §55 Rule 8). P1 stops at emitting it — persisting traces is
 * P3, and nothing here writes to the world.
 */
export interface DecisionTrace {
  decisionId: string;
  agentId: string;
  observationTick: number;
  observationTime: number;
  provider: string;
  /** The provider's model name, or `null` for a provider that has none (`mock`, `deterministic`). */
  model: string | null;
  promptVersion: string;
  /** Where the returned decision came from. */
  outcome: 'provider' | 'fallback' | 'discarded';
  /** Why the provider's answer was not used. `null` when it was. */
  providerFailure: ModelError | ValidationError | null;
  fallbackUsed: boolean;
  reason: string | null;
  /** The validated decision, or `null` when the whole attempt was discarded. */
  decision: AgentDecision | null;
}

export type DecisionOutcome =
  | { status: 'decided'; decision: AgentDecision; trace: DecisionTrace }
  | { status: 'discarded'; error: ValidationError; trace: DecisionTrace };

/**
 * The runtime's one route to the engine (docs/lv3/03-api-contract.md §4.7).
 *
 * Deliberately a single method rather than the controller port itself: the port is bound to an
 * operator, and binding it here would mean this module naming the engine's command seam. The host
 * binds both, so the agent layer keeps its "no engine reference at all" property intact.
 */
export interface ActionSubmitter {
  /**
   * Submit an Action on behalf of the Agent whose observation this is. Returns the engine's own
   * verdict — `validateAction`, the busy-ship rule and the permission gate all live behind it, and
   * a refusal is a value, not an exception.
   */
  submit(action: Action, observation: AgentObservation): CommandResult;
}

/**
 * The runtime's second route to the engine: what an Agent **says**.
 *
 * A social decision (`accept`/`reject`/`counteroffer`, `team-accept:<id>`) is not an `Action` and can
 * never be submitted as one — `decision.ts` refuses it. Before P3 that meant such a decision ended in
 * `not-an-action` and evaporated: an Agent could decide to counteroffer and no one ever heard. This is
 * the missing half, and it is a separate port for the same reason `ActionSubmitter` is one — the host
 * binds it, so this module still never names the engine's command seam.
 */
export interface MessageSubmitter {
  /** Say one thing on behalf of the Agent whose observation this is. Returns the engine's verdict. */
  send(reply: AgentReply, observation: AgentObservation): CommandResult;
}

/**
 * What became of a decision once it was applied. Reported rather than assumed: an Agent whose
 * action the engine refused has learned something, and the log should be able to say so.
 */
export type SubmissionOutcome =
  | { status: 'submitted'; choiceId: string }
  /** The engine said no — busy ship, failed `validateAction`, or insufficient permission. */
  | { status: 'declined'; choiceId: string; reason: string }
  /** `intent !== 'act'`. Nothing physical was attempted, which is the common case. */
  | { status: 'not-an-action'; intent: AgentDecision['intent'] }
  /** A social decision was spoken into the world as an `agentMessage`. */
  | { status: 'replied'; to: string; kind: AgentMessageKind }
  /** The engine refused the message — a peer that does not exist, a permission gate. */
  | { status: 'reply-declined'; kind: AgentMessageKind; reason: string }
  /** The choiceId is not on the menu. Unreachable after validation; kept as a value, not a throw. */
  | { status: 'unresolved'; choiceId: string };

export interface DecisionRuntimeOptions {
  client: ModelClient;
  prompts: PromptTemplates;
  schema: JsonSchema;
  /**
   * Required, so that "decisions are never applied" cannot happen by omission. A test that only
   * wants the decision half passes a submitter that records and declines.
   */
  submitter: ActionSubmitter;
  /**
   * Required for the same reason `submitter` is: "a social decision never reached anyone" must not be
   * something that can happen by omission. A test that only wants the decision half passes one that
   * records and declines.
   */
  messenger: MessageSubmitter;
  timeoutMs?: number;
  /** Injected so trace ids are reproducible. Defaults to `agentId@tick`. */
  nextDecisionId?: (observation: AgentObservation) => string;
  onTrace?: (trace: DecisionTrace) => void;
}

export class DecisionRuntime {
  private readonly client: ModelClient;
  private readonly prompts: PromptTemplates;
  private readonly schema: JsonSchema;
  private readonly submitter: ActionSubmitter;
  private readonly messenger: MessageSubmitter;
  private readonly timeoutMs: number | undefined;
  private readonly nextDecisionId: (observation: AgentObservation) => string;
  private readonly onTrace: ((trace: DecisionTrace) => void) | undefined;

  constructor(options: DecisionRuntimeOptions) {
    this.client = options.client;
    this.prompts = options.prompts;
    this.schema = options.schema;
    this.submitter = options.submitter;
    this.messenger = options.messenger;
    this.timeoutMs = options.timeoutMs;
    this.nextDecisionId =
      options.nextDecisionId ?? ((observation) => observation.agentId + '@' + observation.tick);
    this.onTrace = options.onTrace;
  }

  /**
   * Deterministic for a given (observation, fixture): the same pair always yields the same answer.
   *
   * `skipProvider` is how the scheduler says "this beat does not deserve a model call"
   * (docs/lv3/02-decision-flow.md §3.4: low-priority triggers resolve from the deterministic rule).
   * It is **not** a second fallback: it goes through the same private `fallBack` and the same
   * `fallbackDecision`, so there is still exactly one implementation and one trace shape. It is
   * distinguishable after the fact — `trace.providerFailure` is `null` rather than an error, and
   * `trace.reason` says the beat was not worth asking about.
   */
  async requestDecision(
    observation: AgentObservation,
    options: { skipProvider?: boolean; reason?: string } = {},
  ): Promise<DecisionOutcome> {
    const base: DecisionTrace = {
      decisionId: this.nextDecisionId(observation),
      agentId: observation.agentId,
      observationTick: observation.tick,
      observationTime: observation.time,
      provider: this.client.id,
      model: this.client.model ?? null,
      promptVersion: this.client.promptVersion,
      outcome: 'fallback',
      providerFailure: null,
      fallbackUsed: true,
      reason: null,
      decision: null,
    };

    if (options.skipProvider)
      return this.fallBack(
        observation,
        base,
        null,
        options.reason ?? '这一拍不值得调用模型：按确定性规则作答。',
      );

    let result: ModelResult;
    let thrown: string | null = null;
    try {
      result = await this.client.decide(
        buildDecisionRequest({
          observation,
          templates: this.prompts,
          schema: this.schema,
          timeoutMs: this.timeoutMs,
        }),
      );
    } catch (error) {
      // A provider that throws has still failed. Agent.md §58 asks for one thing only: do not crash.
      result = { ok: false, error: 'unavailable', latencyMs: 0 };
      thrown = error instanceof Error ? error.message : String(error);
    }

    if (result.ok) {
      // Re-validated here rather than trusted: `{ ok: true }` is the provider's claim, and the model
      // layer is untrusted by construction (Rule 3). A provider may only *choose*; this is where
      // "chose from the menu" is actually enforced.
      const validated = validateDecision(result.decision, observation);
      if (validated.ok) {
        const trace: DecisionTrace = {
          ...base,
          outcome: 'provider',
          fallbackUsed: false,
          decision: validated.decision,
        };
        this.emit(trace);
        return { status: 'decided', decision: validated.decision, trace };
      }
      if (validated.error === 'stale') {
        const trace: DecisionTrace = {
          ...base,
          outcome: 'discarded',
          providerFailure: 'stale',
          fallbackUsed: false,
          reason: '观测已过期：丢弃且不降级，下一拍基于新观测重新决策。',
        };
        this.emit(trace);
        return { status: 'discarded', error: 'stale', trace };
      }
      return this.fallBack(observation, base, validated.error, '决策未通过校验。');
    }

    return this.fallBack(
      observation,
      base,
      result.error,
      thrown === null ? 'provider 未给出可用决策。' : 'provider 抛出异常：' + thrown,
    );
  }

  /**
   * Turn a validated decision into a world effect — the only place that happens.
   *
   * An `act` resolves its `choiceId` against the options the engine already offered, so the Action
   * submitted is one the engine itself constructed; the model never supplied a target, a coordinate
   * or a parameter, and there is no path here that invents one (Rule 3 / Rule 6).
   *
   * Anything that is not an `act` is **speech, not a ship order** — it is sent as an `agentMessage`
   * through the injected `MessageSubmitter`, never dressed up as an Action. Three intents say
   * something (`respond`, `request`, `invite`); the rest (`wait`, `rest`, `quit`) say nothing and end
   * here. Note the asymmetry that keeps this safe: what an Agent *may* say is bounded by `replyFor`,
   * which only accepts choice ids `actions.ts` already put on the menu.
   *
   * Synchronous, and it never throws: the engine's own verdict comes back as a value.
   */
  applyDecision(observation: AgentObservation, decision: AgentDecision): SubmissionOutcome {
    if (decision.intent !== 'act') {
      // A social decision is speech, and speech is now a world effect too (P3). `replyFor` returns
      // `null` for the intents that genuinely say nothing — `wait`, `rest`, `quit` — and those end
      // here exactly as they always did.
      const reply = replyFor(decision);
      if (!reply) return { status: 'not-an-action', intent: decision.intent };
      const result = this.messenger.send(reply, observation);
      return result.ok
        ? { status: 'replied', to: reply.to, kind: reply.kind }
        : { status: 'reply-declined', kind: reply.kind, reason: result.reason };
    }
    const choiceId = decision.choiceId;
    if (choiceId === undefined) return { status: 'unresolved', choiceId: '' };
    const candidate = observation.availableActions.find((option) => option.id === choiceId);
    if (!candidate) return { status: 'unresolved', choiceId };
    const result = this.submitter.submit(candidate.action, observation);
    return result.ok
      ? { status: 'submitted', choiceId }
      : { status: 'declined', choiceId, reason: result.reason };
  }

  /** `failure` is `null` when the deterministic answer was *chosen* rather than fallen back to. */
  private fallBack(
    observation: AgentObservation,
    base: DecisionTrace,
    failure: ModelError | ValidationError | null,
    reason: string,
  ): DecisionOutcome {
    const decision = fallbackDecision(
      scoringAgent(observation),
      observation,
      base.promptVersion,
    );
    const trace: DecisionTrace = {
      ...base,
      outcome: 'fallback',
      providerFailure: failure,
      fallbackUsed: true,
      reason,
      decision,
    };
    this.emit(trace);
    return { status: 'decided', decision, trace };
  }

  private emit(trace: DecisionTrace): void {
    if (this.onTrace) this.onTrace(trace);
  }
}
