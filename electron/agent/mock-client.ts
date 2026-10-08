/**
 * The offline provider (docs/lv3/02-llm-boundary.md §3, §8).
 *
 * Everything in P1 runs against this, and so does every regression test that will ever be written:
 * a provider that reaches the network can only ever produce a *recorded* answer, and a recorded
 * answer is what makes "same observation + same fixture ⇒ same decision" a fact rather than a
 * hope (docs/lv3/03-api-contract.md §7).
 *
 * It is a **scripted** provider, not a smart one. A script is an ordered list of rules; the first
 * rule whose `match` accepts the observation answers. No rule ⇒ `unavailable`. There is no
 * randomness, no clock reading that affects the answer, and no hidden state between calls — the
 * same request always produces the same result.
 *
 * Its errors are as important as its answers. A script can make it report a provider failure
 * (`timeout`, `http-error`, `unavailable`), emit malformed text (`invalid-json`), return a decision
 * that fails the schema, or throw outright — which is how the runtime's fallback path is exercised
 * without a network, and how `Agent.md` §58's "the game must not crash" becomes a test.
 *
 * What it deliberately does **not** do is check staleness: the provider contract is JSON parsing,
 * `AgentDecision` structure and choice ownership (docs/lv3/03-api-contract.md §4.4). Whether an
 * answer is too old to use is the runtime's call (§4.5 ④), and the runtime applies it separately.
 */
import {
  AGENT_PROMPT_VERSION,
  parseDecisionText,
  validateDecisionShape,
} from '../../src/engine/agent/decision';
import type { AgentDecision, AgentObservation } from '../../src/engine/agent/types';
import type { DecisionRequest, ModelClient, ModelError, ModelResult } from './model-client';

export type { ModelError } from './model-client';

/** A canned answer, minus the three fields the provider is responsible for stamping. */
export type MockDecision = Omit<AgentDecision, 'observationTick' | 'promptVersion' | 'provider'>;

export type MockAnswer =
  /** A structured decision. It must survive the provider's own validation to be returned. */
  | { kind: 'decision'; decision: MockDecision }
  /** Raw text, as a real model would emit it. Parsed and validated exactly like a live answer. */
  | { kind: 'text'; text: string }
  /** A provider-level failure, reported the way a live provider would report it. */
  | { kind: 'error'; error: ModelError }
  /** A provider that throws despite the contract. The runtime must survive it. */
  | { kind: 'throw'; message: string };

export interface MockRule {
  /** Appears in test failure output; make it say which scenario the rule is playing. */
  label: string;
  /** Defaults to "matches every observation". */
  match?: (observation: AgentObservation) => boolean;
  answer: MockAnswer;
}

export interface MockClientOptions {
  rules: readonly MockRule[];
  id?: string;
  /** The prompt version this script was recorded against. Defaults to the current domain version. */
  promptVersion?: string;
  /** Reported latency. Zero by default, so it can never leak into a determinism assertion. */
  latencyMs?: number;
  /** Injected clock. It is only ever used to measure latency — never to choose an answer. */
  now?: () => number;
}

export class MockModelClient implements ModelClient {
  readonly id: string;
  readonly promptVersion: string;
  private readonly rules: readonly MockRule[];
  private readonly latencyMs: number;
  private readonly now: () => number;

  constructor(options: MockClientOptions) {
    this.rules = options.rules;
    this.id = options.id ?? 'mock';
    this.promptVersion = options.promptVersion ?? AGENT_PROMPT_VERSION;
    this.latencyMs = options.latencyMs ?? 0;
    this.now = options.now ?? (() => 0);
  }

  async decide(request: DecisionRequest): Promise<ModelResult> {
    const started = this.now();
    const elapsed = (): number => this.latencyMs || Math.max(0, this.now() - started);
    const rule = this.rules.find((r) => !r.match || r.match(request.observation));
    if (!rule) return { ok: false, error: 'unavailable', latencyMs: elapsed() };

    const answer = rule.answer;
    if (answer.kind === 'error') return { ok: false, error: answer.error, latencyMs: elapsed() };
    if (answer.kind === 'throw') throw new Error(answer.message);

    const parsed =
      answer.kind === 'text'
        ? parseDecisionText(answer.text, request.observation)
        : validateDecisionShape(
            {
              ...answer.decision,
              promptVersion: this.promptVersion,
              observationTick: request.observation.tick,
              provider: 'llm' as const,
            },
            request.observation,
          );

    return parsed.ok
      ? { ok: true, decision: parsed.decision, latencyMs: elapsed() }
      : { ok: false, error: parsed.error, latencyMs: elapsed() };
  }
}
