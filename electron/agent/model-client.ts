/**
 * The provider boundary (Agent.md §32, docs/lv3/02-llm-boundary.md §3,
 * docs/lv3/03-api-contract.md §4.4).
 *
 * This module is **contract only**: no implementation, no network, no Node APIs. It exists so the
 * decision runtime depends on an interface rather than on DeepSeek (or any other vendor), which is
 * what makes the mock provider swappable for a live one without touching a single domain rule
 * (Agent.md §32, docs/lv3/03-implementation-plan.md §3.3).
 *
 * Two properties are load-bearing and are enforced by `tests/agent/boundary.test.ts`:
 *  1. `decide` **never throws** — every failure is a value (`{ ok: false, error }`). The one
 *     exception is a provider that genuinely throws, which the runtime must survive; that is a
 *     runtime obligation, not a licence for providers to throw.
 *  2. A provider may only answer with an `AgentDecision` — an intent, a reason, and *which of the
 *     offered options* it picks. It cannot name an `Action`, cannot supply parameters and cannot
 *     reach the engine (Agent.md §55 Rule 2/3).
 *
 * `ModelError` is re-exported from the domain layer rather than redeclared: the failure taxonomy is
 * part of the same contract as `AgentDecision`, and a second copy would drift.
 */
import type { ModelError } from '../../src/engine/agent/decision';
import type { AgentDecision, AgentObservation } from '../../src/engine/agent/types';

export type { ModelError };

/** A JSON Schema document, carried to the provider so it can constrain its own output. */
export type JsonSchema = Readonly<Record<string, unknown>>;

/**
 * Everything a provider is given. Note what is *absent*: no `WorldState`, no engine, no API key,
 * no other Agent's private state. The observation is already cropped by the domain layer
 * (docs/lv3/03-api-contract.md §4.2).
 */
export interface DecisionRequest {
  observation: AgentObservation;
  systemPrompt: string;
  decisionPrompt: string;
  schema: JsonSchema;
  timeoutMs: number;
}

export type ModelResult =
  | { ok: true; decision: AgentDecision; latencyMs: number }
  | { ok: false; error: ModelError; latencyMs: number };

export interface ModelClient {
  /** `'mock'` | `'deepseek'` | … — recorded on traces so a decision can be traced to its source. */
  readonly id: string;
  /** Must match `prompts/agent/*.md`'s `prompt_version` (CLAUDE.md §7). */
  readonly promptVersion: string;
  /**
   * The underlying model name, when the provider has one (`'deepseek-chat'`). Optional because it is
   * a property of a *live* provider: a recorded fixture answers for a model that was chosen once, and
   * naming it on the mock would suggest a precision the mock does not have.
   *
   * Added in P2 for traceability (playbook §19 names `model` alongside `provider`), and optional so
   * that every existing `ModelClient` — including the test stubs — still satisfies the contract.
   */
  readonly model?: string;
  decide(request: DecisionRequest): Promise<ModelResult>;
}

/**
 * Proposal (not yet calibrated): a provider that has not answered within this long is treated as
 * `timeout` and the deterministic fallback takes over (Agent.md §58). P1 never waits on it — only a
 * live provider does (P2).
 */
export const DEFAULT_DECISION_TIMEOUT_MS = 20_000;
