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
 * What it does **not** do — each of these is a later stage, and doing any of them here would put a
 * second authority next to the engine's:
 *
 * ```text
 * does not resolve a choiceId into an Action     ← P3
 * does not call ControllerPort.submitAction      ← P3
 * does not touch WorldState or SimulationEngine  ← never (Rule 1)
 * does not decide *when* to ask                  ← the scheduler (P3)
 * ```
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

export interface DecisionRuntimeOptions {
  client: ModelClient;
  prompts: PromptTemplates;
  schema: JsonSchema;
  timeoutMs?: number;
  /** Injected so trace ids are reproducible. Defaults to `agentId@tick`. */
  nextDecisionId?: (observation: AgentObservation) => string;
  onTrace?: (trace: DecisionTrace) => void;
}

export class DecisionRuntime {
  private readonly client: ModelClient;
  private readonly prompts: PromptTemplates;
  private readonly schema: JsonSchema;
  private readonly timeoutMs: number | undefined;
  private readonly nextDecisionId: (observation: AgentObservation) => string;
  private readonly onTrace: ((trace: DecisionTrace) => void) | undefined;

  constructor(options: DecisionRuntimeOptions) {
    this.client = options.client;
    this.prompts = options.prompts;
    this.schema = options.schema;
    this.timeoutMs = options.timeoutMs;
    this.nextDecisionId =
      options.nextDecisionId ?? ((observation) => observation.agentId + '@' + observation.tick);
    this.onTrace = options.onTrace;
  }

  /** Deterministic for a given (observation, fixture): the same pair always yields the same answer. */
  async requestDecision(observation: AgentObservation): Promise<DecisionOutcome> {
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

  private fallBack(
    observation: AgentObservation,
    base: DecisionTrace,
    failure: ModelError | ValidationError,
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
