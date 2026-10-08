/**
 * The live provider: an OpenAI-compatible `/chat/completions` client, with DeepSeek as the first
 * concrete target (docs/lv3/03-implementation-plan.md §2/§3.3; docs/lv3/02-llm-boundary.md §3/§6/§7).
 *
 * This is a `ModelClient` and nothing more. It is also the **only** module in `electron/agent/`
 * allowed to reach the network, read a credential or look at `process.env` — `tests/agent/
 * boundary.test.ts` holds that line by asserting every other module in the layer is free of `fetch`,
 * of any `DEEPSEEK`-shaped name and of an ambient environment read. Confining it to one file means
 * "can this code reach the outside world?" has a one-file answer.
 *
 * What it deliberately does not do — each of these belongs to a later stage or another module:
 *
 * ```text
 * does not resolve a choiceId into an Action     ← P3
 * does not submit anything to the engine         ← never (Rule 1/2)
 * does not decide *when* an Agent thinks         ← the scheduler (P3)
 * does not wrap the deterministic fallback       ← the runtime's job; a second copy would drift
 * ```
 *
 * The last one matters most. This provider *will* fail — networks drop, keys expire, models emit
 * prose. When it does it returns `{ ok: false, error }` like every other `ModelClient`, and the
 * existing `DecisionRuntime` turns that into a deterministic decision (docs/lv3/02-decision-flow.md
 * §3.6). There is exactly one fallback path in the system, and P2 does not add a second.
 *
 * **Credentials.** The API key is read from the environment, held in this object, and put in one
 * place: an `authorization` header. It is never written to a trace, a log line, an error, an
 * observation or a prompt. `describeDeepSeekConfig` exists so a host that wants to log its
 * configuration has something safe to log; `tests/agent/deepseek.test.ts` asserts the key does not
 * appear in emitted traces.
 */
import { AGENT_PROMPT_VERSION, validateDecisionShape } from '../../src/engine/agent/decision';
import type { AgentDecision, AgentObservation } from '../../src/engine/agent/types';
import type { DecisionRequest, ModelClient, ModelError, ModelResult } from './model-client';

// --- Configuration -----------------------------------------------------------------------------

/**
 * Everything a DeepSeek call needs. Injected rather than read ambiently inside the request path, so
 * a test can build one without touching the environment and a host can build one from wherever it
 * keeps secrets (CLAUDE.md §5, playbook §5/§6).
 */
export interface DeepSeekConfig {
  apiKey: string;
  /** API root, e.g. `https://api.deepseek.com`. `/chat/completions` is appended. */
  baseUrl: string;
  model: string;
  timeoutMs: number;
  /** Retries *after* the first attempt, so the total number of attempts is `maxRetries + 1`. */
  maxRetries: number;
  temperature: number;
  maxTokens: number;
  /** Consecutive failures before the breaker opens (docs/lv3/02-llm-boundary.md §6). */
  maxConsecutiveFailures: number;
  /** How long the breaker stays open once it trips. See the note on `cooldownMs` below. */
  cooldownMs: number;
}

export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_TEMPERATURE = 0.7;
export const DEFAULT_MAX_TOKENS = 1200;
export const DEFAULT_MAX_CONSECUTIVE_FAILURES = 2;
export const DEFAULT_BACKOFF_BASE_MS = 500;

/**
 * The breaker's cooldown.
 *
 * docs/lv3/02-llm-boundary.md §6 proposes "30 game minutes". This provider cannot express that: it
 * has no `SimulationEngine` and no simulation clock (Rule 1), and inventing one here would put a
 * second notion of time next to the engine's. So the transport-level guard is wall-clock, and the
 * *game-time* version of "stop asking this Agent for 30 minutes" is the P3 scheduler's job, where
 * simulation time actually lives. See `docs/lv3/06-deepseek-runtime-status.md` §5.1.
 */
export const DEFAULT_COOLDOWN_MS = 30_000;

/** The API key's environment variable. Named once, here, so nothing else has to spell it. */
export const DEEPSEEK_API_KEY_ENV = 'DEEPSEEK_API_KEY';

function numeric(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Builds a config from environment variables, or `null` when no key is configured.
 *
 * Injected-but-defaulted: `deepSeekConfigFromEnv()` with no argument reads `process.env`, which is
 * what the host will do. Passing an explicit object is how the tests stay hermetic — and it is also
 * the honest signature, because reading the environment is a dependency like any other.
 *
 * **`null` is not an error.** "No key configured" is the normal state of a checkout, a CI run and a
 * machine whose operator does not want to spend money. The caller treats it as "run deterministically
 * and never construct a provider" (playbook §21: `npm test` must pass with no key). A malformed
 * *value* for a numeric setting is likewise not fatal — it falls back to the default rather than
 * taking the game down over a typo, and the deviation is documented in `KNOWN_ISSUES.md`.
 */
export function deepSeekConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DeepSeekConfig | null {
  const apiKey = env[DEEPSEEK_API_KEY_ENV]?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_DEEPSEEK_BASE_URL).replace(/\/+$/, ''),
    model: env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL,
    timeoutMs: numeric(env.DEEPSEEK_TIMEOUT_MS, 20_000, 1_000, 300_000),
    maxRetries: numeric(env.DEEPSEEK_MAX_RETRIES, DEFAULT_MAX_RETRIES, 0, 5),
    temperature: numeric(env.DEEPSEEK_TEMPERATURE, DEFAULT_TEMPERATURE, 0, 2),
    maxTokens: numeric(env.DEEPSEEK_MAX_TOKENS, DEFAULT_MAX_TOKENS, 64, 8_192),
    maxConsecutiveFailures: DEFAULT_MAX_CONSECUTIVE_FAILURES,
    cooldownMs: DEFAULT_COOLDOWN_MS,
  };
}

/**
 * What a host may safely log. Deliberately a *summary*: the key becomes a boolean, so a log line
 * written with this function cannot leak it even by accident (docs/lv3/02-llm-boundary.md §7).
 */
export function describeDeepSeekConfig(config: DeepSeekConfig): Record<string, unknown> {
  return {
    provider: 'deepseek',
    baseUrl: config.baseUrl,
    model: config.model,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    hasApiKey: config.apiKey.length > 0,
  };
}

// --- Transport ---------------------------------------------------------------------------------

/** The slice of `Response` this client uses. Narrow on purpose: a stub is three fields. */
export interface ResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<ResponseLike>;

/** Resolved late so the module has no import-time dependency on a global being present. */
const defaultFetch: FetchLike = (url, init) =>
  (globalThis as unknown as { fetch: FetchLike }).fetch(url, init);

// --- Traceability ------------------------------------------------------------------------------

/**
 * One HTTP attempt, as the provider saw it (playbook §19).
 *
 * This is deliberately *not* `DecisionTrace`. The runtime's trace answers "what did this Agent
 * decide, and was it used?"; this answers "what did the wire do?". Splitting them keeps retry-level
 * detail out of the decision record — a decision is a decision whether it took one attempt or
 * three — while still making every request auditable. Together the two cover §19's field list.
 *
 * Contains no key, no prompt and no response body. Only categories.
 */
export interface LlmAttemptTrace {
  provider: string;
  model: string;
  /** 1-based. */
  attempt: number;
  maxAttempts: number;
  /** Epoch milliseconds, from the injected clock. */
  startedAt: number;
  endedAt: number;
  latencyMs: number;
  /** `retry` means "this attempt failed and another will follow". */
  outcome: 'ok' | 'retry' | 'fail';
  error: ModelError | null;
  httpStatus: number | null;
}

export interface OpenAiCompatibleOptions {
  /** Recorded on traces and on the decision. Defaults to `'deepseek'`. */
  id?: string;
  /** Must match `prompts/agent/*.md`. Defaults to the domain's current version. */
  promptVersion?: string;
  /** Injected transport. Tests pass a stub and no socket is ever opened (L-15). */
  fetch?: FetchLike;
  /** Injected clock, so backoff and the breaker are testable without waiting. */
  now?: () => number;
  /** Injected sleep, so a retry test does not actually spend the backoff. */
  sleep?: (ms: number) => Promise<void>;
  onAttempt?: (trace: LlmAttemptTrace) => void;
}

// --- Response parsing --------------------------------------------------------------------------

/**
 * Pulls the first balanced `{…}` out of whatever the model actually emitted.
 *
 * `response_format: { type: 'json_object' }` usually means clean JSON, but "usually" is not a
 * contract: models wrap answers in ```json fences, prepend "Here is my decision:", or add a closing
 * remark. Scanning for a balanced object — while respecting strings and escapes, so a `}` inside
 * `reason` does not end the object early — recovers all of those without weakening validation: the
 * extracted text still has to survive `agentDecisionSchema`.
 */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

/** The assistant message from an OpenAI-shaped envelope, or `null` if there is not one. */
function contentOf(body: string): string | null {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return null;
  }
  const choices = (payload as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const content = (choices[0] as { message?: { content?: unknown } })?.message?.content;
  return typeof content === 'string' && content.trim().length > 0 ? content : null;
}

/**
 * A non-2xx status worth trying again: the request was well-formed but the far side was busy.
 * 408/409/425/429 and every 5xx are transient; 400/401/403/404/422 are not, and retrying an invalid
 * key two more times only makes the failure slower (playbook §15).
 */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

type AttemptOutcome =
  | { kind: 'ok'; decision: AgentDecision }
  | { kind: 'fail'; error: ModelError; retryable: boolean; httpStatus: number | null };

// --- The client --------------------------------------------------------------------------------

export class OpenAiCompatibleModelClient implements ModelClient {
  readonly id: string;
  readonly promptVersion: string;
  /** Part of §19's traceability list, and the reason `ModelClient.model` is optional. */
  readonly model: string;

  private readonly config: DeepSeekConfig;
  private readonly fetch: FetchLike;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onAttempt: ((trace: LlmAttemptTrace) => void) | undefined;
  private consecutiveFailures = 0;
  private breakerOpenUntil: number | null = null;

  constructor(config: DeepSeekConfig, options: OpenAiCompatibleOptions = {}) {
    this.config = config;
    this.id = options.id ?? 'deepseek';
    this.promptVersion = options.promptVersion ?? AGENT_PROMPT_VERSION;
    this.model = config.model;
    this.fetch = options.fetch ?? defaultFetch;
    this.now = options.now ?? (() => Date.now());
    this.sleep =
      options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.onAttempt = options.onAttempt;
  }

  /**
   * Never throws — the `ModelClient` contract (electron/agent/model-client.ts). Every failure,
   * including one this method causes by accident, is a value the runtime can fall back from.
   */
  async decide(request: DecisionRequest): Promise<ModelResult> {
    const startedAt = this.now();
    const maxAttempts = this.config.maxRetries + 1;

    if (this.breakerOpenUntil !== null && this.now() < this.breakerOpenUntil) {
      // Tripped: answer without touching the network, so a hard-down provider costs nothing and the
      // runtime goes straight to the deterministic path (playbook §6, L-13).
      this.emit({
        attempt: 0,
        maxAttempts,
        startedAt,
        endedAt: this.now(),
        outcome: 'fail',
        error: 'unavailable',
        httpStatus: null,
      });
      return { ok: false, error: 'unavailable', latencyMs: this.now() - startedAt };
    }

    let lastError: ModelError = 'unavailable';
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptStart = this.now();
      let outcome: AttemptOutcome;
      try {
        outcome = await this.attempt(request);
      } catch {
        // Nothing below is supposed to throw; if it does, it is still a provider failure and not a
        // reason to take the game down.
        outcome = { kind: 'fail', error: 'unavailable', retryable: true, httpStatus: null };
      }
      const endedAt = this.now();

      if (outcome.kind === 'ok') {
        this.consecutiveFailures = 0;
        this.breakerOpenUntil = null;
        this.emit({
          attempt,
          maxAttempts,
          startedAt: attemptStart,
          endedAt,
          outcome: 'ok',
          error: null,
          httpStatus: null,
        });
        return { ok: true, decision: outcome.decision, latencyMs: endedAt - startedAt };
      }

      lastError = outcome.error;
      const willRetry = outcome.retryable && attempt < maxAttempts;
      this.emit({
        attempt,
        maxAttempts,
        startedAt: attemptStart,
        endedAt,
        outcome: willRetry ? 'retry' : 'fail',
        error: outcome.error,
        httpStatus: outcome.httpStatus,
      });
      if (!willRetry) break;

      const backoff = DEFAULT_BACKOFF_BASE_MS * 2 ** (attempt - 1);
      try {
        await this.sleep(backoff);
      } catch {
        break;
      }
    }

    this.recordFailure();
    return { ok: false, error: lastError, latencyMs: this.now() - startedAt };
  }

  /** One HTTP round trip, fully classified. */
  private async attempt(request: DecisionRequest): Promise<AttemptOutcome> {
    const timeoutMs = resolveTimeout(request.timeoutMs, this.config.timeoutMs);
    const controller = new AbortController();
    const timer =
      timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

    let response: ResponseLike;
    try {
      response = await this.fetch(this.endpoint(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + this.config.apiKey,
        },
        body: JSON.stringify(this.body(request)),
        signal: controller.signal,
      });
    } catch {
      // A timeout surfaces here as an abort; anything else is the transport giving up. Both are
      // transient, and both are reported as categories — never as a message that might echo a URL
      // or a header back into a log.
      return controller.signal.aborted
        ? { kind: 'fail', error: 'timeout', retryable: true, httpStatus: null }
        : { kind: 'fail', error: 'unavailable', retryable: true, httpStatus: null };
    } finally {
      if (timer !== null) clearTimeout(timer);
    }

    if (!response.ok)
      return {
        kind: 'fail',
        error: 'http-error',
        retryable: isRetryableStatus(response.status),
        httpStatus: response.status,
      };

    let body: string;
    try {
      body = await response.text();
    } catch {
      // The status line said 200 and the body never arrived. Transient, so worth one more try.
      return { kind: 'fail', error: 'invalid-json', retryable: true, httpStatus: response.status };
    }

    // Past this line the far side answered. A model that produced unusable output will produce the
    // same unusable output again, so none of these are retried (playbook §15: only transient
    // network and temporary provider errors are).
    const content = contentOf(body);
    if (content === null)
      return { kind: 'fail', error: 'invalid-json', retryable: false, httpStatus: response.status };

    const extracted = extractJsonObject(content);
    if (extracted === null)
      return { kind: 'fail', error: 'invalid-json', retryable: false, httpStatus: response.status };

    let raw: unknown;
    try {
      raw = JSON.parse(extracted);
    } catch {
      return { kind: 'fail', error: 'invalid-json', retryable: false, httpStatus: response.status };
    }

    // The model answers with intent/reason/say/choiceId/request — the part it can actually know. The
    // three bookkeeping fields are stamped here, overwriting anything it guessed, because a model
    // cannot know which tick its observation came from or which prompt version produced it. The
    // schema is `strict()`, so a stray extra field still fails, as it should.
    const shaped = validateDecisionShape(
      this.stamp(raw, request.observation),
      request.observation,
    );
    if (!shaped.ok)
      return { kind: 'fail', error: shaped.error, retryable: false, httpStatus: response.status };
    return { kind: 'ok', decision: shaped.decision };
  }

  private stamp(raw: unknown, observation: AgentObservation): unknown {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    return {
      ...(raw as Record<string, unknown>),
      promptVersion: this.promptVersion,
      observationTick: observation.tick,
      provider: 'llm',
    };
  }

  private endpoint(): string {
    return this.config.baseUrl + '/chat/completions';
  }

  private body(request: DecisionRequest): Record<string, unknown> {
    return {
      model: this.config.model,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.decisionPrompt },
      ],
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      // Ask for an object rather than prose. This is a *hint* to the model, not a guarantee — the
      // guarantee is `validateDecisionShape` below, which is why `extractJsonObject` exists at all.
      response_format: { type: 'json_object' },
      stream: false,
    };
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.config.maxConsecutiveFailures)
      this.breakerOpenUntil = this.now() + this.config.cooldownMs;
  }

  private emit(input: {
    attempt: number;
    maxAttempts: number;
    startedAt: number;
    endedAt: number;
    outcome: LlmAttemptTrace['outcome'];
    error: ModelError | null;
    httpStatus: number | null;
  }): void {
    if (!this.onAttempt) return;
    try {
      this.onAttempt({
        provider: this.id,
        model: this.model,
        attempt: input.attempt,
        maxAttempts: input.maxAttempts,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        latencyMs: Math.max(0, input.endedAt - input.startedAt),
        outcome: input.outcome,
        error: input.error,
        httpStatus: input.httpStatus,
      });
    } catch {
      // A trace consumer that throws is not a provider failure. Rule 3 protects the model's output,
      // not the observer's.
    }
  }
}

/**
 * Two upper bounds on one call: the runtime's per-request budget and the provider's own. The tighter
 * one wins, so neither can be silently overridden by the other.
 */
function resolveTimeout(requested: number, configured: number): number {
  if (!Number.isFinite(requested) || requested <= 0) return configured;
  if (!Number.isFinite(configured) || configured <= 0) return requested;
  return Math.min(requested, configured);
}

/** The provider, or `null` when the environment has no key (playbook §21). */
export function createDeepSeekClient(
  env: NodeJS.ProcessEnv = process.env,
  options: OpenAiCompatibleOptions = {},
): OpenAiCompatibleModelClient | null {
  const config = deepSeekConfigFromEnv(env);
  return config ? new OpenAiCompatibleModelClient(config, options) : null;
}
