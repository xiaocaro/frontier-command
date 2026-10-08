/**
 * P2 the live DeepSeek provider (docs/lv3/03-test-plan.md §5 L-7 … L-15; §11 B-11;
 * playbook §5/§6/§10/§14/§15/§16/§19/§21).
 *
 * Every test here runs against a **stub transport**. That is not a shortcut, it is the requirement
 * (L-15): the default suite must pass with no API key, no outbound socket, no spend and no
 * dependence on what a model happened to say. The client takes its `fetch` as a dependency precisely
 * so that "what happens when the wire misbehaves?" can be asked deterministically — a 500, a hang, a
 * truncated body and a model that answers in prose are all reproducible here, and none of them can
 * be reproduced reliably against a real endpoint.
 *
 * The other half of the file is the *negative* space: the key must not leak (L-12), a failure must
 * never throw (L-11), and none of it may reach a `SimulationEngine` (the boundary suite's job, but
 * asserted here too because this is the module that could).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_COOLDOWN_MS,
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TEMPERATURE,
  OpenAiCompatibleModelClient,
  createDeepSeekClient,
  deepSeekConfigFromEnv,
  describeDeepSeekConfig,
  extractJsonObject,
  type DeepSeekConfig,
  type FetchLike,
  type LlmAttemptTrace,
  type ResponseLike,
} from '../../electron/agent/openai-compatible';
import { MockModelClient } from '../../electron/agent/mock-client';
import { buildDecisionRequest, loadDecisionSchema, loadPromptTemplates } from '../../electron/agent/prompt';
import type { DecisionRequest } from '../../electron/agent/model-client';
import { AGENT_PROMPT_VERSION } from '../../src/engine/agent/decision';
import { agentDecisionSchema } from '../../src/engine/agent/schemas';
import type { AgentObservation } from '../../src/engine/types';
import {
  REPO_ROOT,
  agentByCareer,
  agentEngine,
  agentRuntime,
  observationFor,
  offerMission,
} from './support';

const KEY = 'sk-test-key-do-not-log-me';

type FetchInit = Parameters<FetchLike>[1];
interface StubCall {
  url: string;
  init: FetchInit;
}

/** A transport that records what it was asked, so the request shape is assertable. */
function stubTransport(
  handler: (call: StubCall & { index: number }) => Promise<ResponseLike> | ResponseLike,
): { fetch: FetchLike; calls: StubCall[] } {
  const calls: StubCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    return handler({ ...call, index: calls.length });
  };
  return { fetch, calls };
}

/** A well-formed OpenAI-shaped answer carrying `content`. */
const answering = (content: string): ResponseLike => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }),
});

/** A raw body, so envelope-level problems can be exercised. */
const rawBody = (body: string, status = 200): ResponseLike => ({
  ok: true,
  status,
  text: async () => body,
});

const failing = (status: number): ResponseLike => ({
  ok: false,
  status,
  text: async () => JSON.stringify({ error: { message: 'denied' } }),
});

function config(overrides: Partial<DeepSeekConfig> = {}): DeepSeekConfig {
  return {
    apiKey: KEY,
    baseUrl: DEFAULT_DEEPSEEK_BASE_URL,
    model: DEFAULT_DEEPSEEK_MODEL,
    timeoutMs: 20_000,
    // Zero by default: a test that is not about retries should make exactly one call, so an
    // accidental retry shows up as a failing assertion rather than as a slower pass.
    maxRetries: 0,
    temperature: DEFAULT_TEMPERATURE,
    maxTokens: 1200,
    maxConsecutiveFailures: 2,
    cooldownMs: DEFAULT_COOLDOWN_MS,
    ...overrides,
  };
}

/**
 * A client wired for a deterministic assertion: the transport is a stub and the clock is frozen, so
 * `latencyMs` is always exactly 0 and cannot turn a classification test into a timing test.
 */
function clientWith(
  fetch: FetchLike,
  overrides: Partial<DeepSeekConfig> = {},
  options: { onAttempt?: (trace: LlmAttemptTrace) => void; sleep?: (ms: number) => Promise<void> } = {},
): OpenAiCompatibleModelClient {
  return new OpenAiCompatibleModelClient(config(overrides), {
    fetch,
    now: () => 0,
    sleep: options.sleep ?? (async () => {}),
    ...(options.onAttempt ? { onAttempt: options.onAttempt } : {}),
  });
}

const templates = loadPromptTemplates(REPO_ROOT);
const schema = loadDecisionSchema(REPO_ROOT);

/** The EVT-01 situation: a mission is waiting, so social options exist on the menu. */
function explorerWithOffer(): { observation: AgentObservation; request: DecisionRequest } {
  const engine = agentEngine();
  const explorer = agentByCareer(engine, 'explorer');
  offerMission(engine, explorer.id);
  const observation = observationFor(engine, explorer.id);
  return {
    observation,
    request: buildDecisionRequest({ observation, templates, schema }),
  };
}

/** A non-social candidate, i.e. one `intent: 'act'` is allowed to name. */
function actChoice(observation: AgentObservation): string {
  const candidate = observation.availableActions.find(
    (c) => !['accept', 'reject', 'counteroffer'].includes(c.id) && !c.id.startsWith('team-'),
  );
  if (!candidate) throw new Error('this observation offers nothing an "act" may choose');
  return candidate.id;
}

/** What a model actually emits: only the fields it can know. */
const modelSays = (fields: Record<string, unknown>): string => JSON.stringify(fields);

// --- Configuration (playbook §5/§6) ------------------------------------------------------------

describe('configuration is injected, never ambient (§5)', () => {
  it('is absent, not broken, when no key is configured', () => {
    expect(deepSeekConfigFromEnv({})).toBeNull();
    expect(deepSeekConfigFromEnv({ DEEPSEEK_API_KEY: '   ' })).toBeNull();
    expect(createDeepSeekClient({})).toBeNull();
  });

  it('reads every setting from the environment, with usable defaults', () => {
    const bare = deepSeekConfigFromEnv({ DEEPSEEK_API_KEY: KEY })!;
    expect(bare.baseUrl).toBe(DEFAULT_DEEPSEEK_BASE_URL);
    expect(bare.model).toBe(DEFAULT_DEEPSEEK_MODEL);
    expect(bare.maxRetries).toBe(DEFAULT_MAX_RETRIES);
    expect(bare.temperature).toBe(DEFAULT_TEMPERATURE);

    const tuned = deepSeekConfigFromEnv({
      DEEPSEEK_API_KEY: KEY,
      DEEPSEEK_BASE_URL: 'https://api.deepseek.com/v1/',
      DEEPSEEK_MODEL: 'deepseek-reasoner',
      DEEPSEEK_TIMEOUT_MS: '5000',
      DEEPSEEK_MAX_RETRIES: '3',
      DEEPSEEK_TEMPERATURE: '0.2',
      DEEPSEEK_MAX_TOKENS: '256',
    })!;
    expect(tuned.baseUrl).toBe('https://api.deepseek.com/v1'); // trailing slash normalised
    expect(tuned.model).toBe('deepseek-reasoner');
    expect(tuned.timeoutMs).toBe(5_000);
    expect(tuned.maxRetries).toBe(3);
    expect(tuned.temperature).toBe(0.2);
    expect(tuned.maxTokens).toBe(256);
  });

  it('falls back to the default for an unusable number instead of taking the game down', () => {
    const parsed = deepSeekConfigFromEnv({
      DEEPSEEK_API_KEY: KEY,
      DEEPSEEK_TIMEOUT_MS: 'soon',
      DEEPSEEK_MAX_RETRIES: '-4',
    })!;
    expect(parsed.timeoutMs).toBe(20_000);
    expect(parsed.maxRetries).toBe(0); // clamped, not negative
  });

  it('has a safe summary to log, and the summary cannot contain the key', () => {
    const summary = describeDeepSeekConfig(config());
    expect(summary).toMatchObject({ provider: 'deepseek', hasApiKey: true });
    expect(JSON.stringify(summary)).not.toContain(KEY);
  });
});

// --- Request shape (§7/§10) ---------------------------------------------------------------------

describe('the request carries the situation and the model settings', () => {
  it('POSTs to the chat-completions endpoint with the configured model', async () => {
    const { request } = explorerWithOffer();
    const { fetch, calls } = stubTransport(() =>
      answering(modelSays({ intent: 'wait', reason: '先看看。' })),
    );
    await clientWith(fetch).decide(request);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.deepseek.com/chat/completions');
    expect(calls[0].init.method).toBe('POST');
    const body = JSON.parse(calls[0].init.body) as Record<string, unknown>;
    expect(body.model).toBe(DEFAULT_DEEPSEEK_MODEL);
    expect(body.temperature).toBe(DEFAULT_TEMPERATURE);
    expect(body.max_tokens).toBe(1200);
    expect(body.stream).toBe(false);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('sends the Agent’s own situation as the user turn, and the versioned system prompt', async () => {
    const { observation, request } = explorerWithOffer();
    const { fetch, calls } = stubTransport(() =>
      answering(modelSays({ intent: 'wait', reason: '先看看。' })),
    );
    await clientWith(fetch).decide(request);

    const messages = (JSON.parse(calls[0].init.body) as { messages: { role: string; content: string }[] })
      .messages;
    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(messages[0].content).toBe(templates.system);
    // The situation — not the world. What the model is told is exactly what the observation holds.
    expect(messages[1].content).toContain(observation.self.name);
    expect(messages[1].content).toContain(observation.availableActions[0].id);
    expect(messages[1].content).toContain('可选项');
  });

  it('puts the credential in the authorization header and nowhere else', async () => {
    const { request } = explorerWithOffer();
    const { fetch, calls } = stubTransport(() =>
      answering(modelSays({ intent: 'wait', reason: '先看看。' })),
    );
    await clientWith(fetch).decide(request);

    expect(calls[0].init.headers.authorization).toBe('Bearer ' + KEY);
    expect(calls[0].init.body).not.toContain(KEY);
    expect(calls[0].url).not.toContain(KEY);
  });
});

// --- Structured output (§10/§11) ----------------------------------------------------------------

describe('L-7/L-9/L-10 the answer is turned into an AgentDecision or a classified failure', () => {
  it('accepts a valid decision and stamps the bookkeeping the model cannot know', async () => {
    const { observation, request } = explorerWithOffer();
    const choiceId = actChoice(observation);
    const { fetch } = stubTransport(() =>
      answering(modelSays({ intent: 'act', choiceId, reason: '值得一试。', say: '我去看看。' })),
    );
    const client = clientWith(fetch);
    const result = await client.decide(request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.intent).toBe('act');
    expect(result.decision.choiceId).toBe(choiceId);
    expect(result.decision.observationTick).toBe(observation.tick);
    expect(result.decision.provider).toBe('llm');
    expect(result.decision.promptVersion).toBe(client.promptVersion);
  });

  it('overwrites bookkeeping fields the model invented', async () => {
    const { observation, request } = explorerWithOffer();
    const { fetch } = stubTransport(() =>
      answering(
        modelSays({
          intent: 'wait',
          reason: '先看看。',
          observationTick: 999_999,
          promptVersion: 'made-up-v9',
          provider: 'deterministic',
        }),
      ),
    );
    const result = await clientWith(fetch).decide(request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.observationTick).toBe(observation.tick);
    expect(result.decision.promptVersion).toBe(AGENT_PROMPT_VERSION);
    expect(result.decision.provider).toBe('llm');
  });

  it('L-7 reports timeout when the request outlives its budget', async () => {
    vi.useFakeTimers();
    try {
      const { request } = explorerWithOffer();
      const { fetch } = stubTransport(
        ({ init }) =>
          new Promise<ResponseLike>((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      );
      const client = new OpenAiCompatibleModelClient(config({ timeoutMs: 50 }), {
        fetch,
        now: () => 0,
      });
      const pending = client.decide(request);
      await vi.advanceTimersByTimeAsync(60);
      expect(await pending).toEqual({ ok: false, error: 'timeout', latencyMs: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('L-9 reports invalid-json when there is no object to extract', async () => {
    for (const content of [
      '我决定先观察。', // prose, no braces at all
      '{"intent": "act", "reason":', // truncated before the object closes
    ]) {
      const { request } = explorerWithOffer();
      const { fetch } = stubTransport(() => answering(content));
      const result = await clientWith(fetch).decide(request);
      expect({ content, result }).toEqual({
        content,
        result: { ok: false, error: 'invalid-json', latencyMs: 0 },
      });
    }
  });

  it('L-9 reports invalid-json when the envelope itself is unusable', async () => {
    for (const body of [
      'not json at all',
      JSON.stringify({ choices: [] }),
      JSON.stringify({ choices: [{ message: { content: '' } }] }),
    ]) {
      const { request } = explorerWithOffer();
      const { fetch } = stubTransport(() => rawBody(body));
      const result = await clientWith(fetch).decide(request);
      expect({ body, result }).toEqual({ body, result: { ok: false, error: 'invalid-json', latencyMs: 0 } });
    }
  });

  it('L-10 reports schema-mismatch for a structurally wrong decision', async () => {
    for (const fields of [
      { intent: 'act', reason: '忘了给 choiceId。' }, // act requires a choiceId
      { intent: 'request', reason: '忘了给 request。' }, // request requires a request
      { intent: 'teleport', reason: '不在枚举里。' }, // invalid enum
      { intent: 'wait', reason: '多了一个字段。', confidence: 0.9 }, // strict schema
    ]) {
      const { request } = explorerWithOffer();
      const { fetch } = stubTransport(() => answering(modelSays(fields)));
      const result = await clientWith(fetch).decide(request);
      expect({ fields, result }).toEqual({
        fields,
        result: { ok: false, error: 'schema-mismatch', latencyMs: 0 },
      });
    }
  });

  it('reports invalid-choice-id for an option that was never offered', async () => {
    const { request } = explorerWithOffer();
    const { fetch } = stubTransport(() =>
      answering(modelSays({ intent: 'act', choiceId: 'explore:99/99', reason: '幻觉出来的选项。' })),
    );
    const result = await clientWith(fetch).decide(request);
    expect(result).toEqual({ ok: false, error: 'invalid-choice-id', latencyMs: 0 });
  });

  it('reports invalid-choice-id for a teammate the Agent cannot address', async () => {
    const { request } = explorerWithOffer();
    const { fetch } = stubTransport(() =>
      answering(
        modelSays({
          intent: 'request',
          reason: '我要一个不存在的人。',
          request: { type: 'teammate', targetAgentId: 'agent-999' },
        }),
      ),
    );
    const result = await clientWith(fetch).decide(request);
    expect(result).toEqual({ ok: false, error: 'invalid-choice-id', latencyMs: 0 });
  });
});

describe('extractJsonObject recovers an object from realistic model prose', () => {
  it.each([
    ['bare', '{"intent":"wait"}'],
    ['fenced', '```json\n{"intent":"wait"}\n```'],
    ['fenced without a language', '```\n{"intent":"wait"}\n```'],
    ['prefixed', 'Here is my decision:\n{"intent":"wait"}'],
    ['surrounded', '好的。\n{"intent":"wait"}\n以上。'],
    ['nested', '{"intent":"request","request":{"type":"equipment"}}'],
  ])('handles %s', (_label, text) => {
    expect(extractJsonObject(text)).toBe(
      _label === 'nested' ? '{"intent":"request","request":{"type":"equipment"}}' : '{"intent":"wait"}',
    );
  });

  it('does not stop early on a brace inside a string', () => {
    expect(extractJsonObject('{"reason":"用了 } 这个符号","intent":"wait"}')).toBe(
      '{"reason":"用了 } 这个符号","intent":"wait"}',
    );
    expect(extractJsonObject('{"reason":"转义 \\" 引号 {","intent":"wait"}')).toBe(
      '{"reason":"转义 \\" 引号 {","intent":"wait"}',
    );
  });

  it('returns null when there is no object, or no end to one', () => {
    expect(extractJsonObject('没有对象')).toBeNull();
    expect(extractJsonObject('{"intent":')).toBeNull();
  });

  it('accepts a fenced answer end to end', async () => {
    const { request } = explorerWithOffer();
    const { fetch } = stubTransport(() =>
      answering('```json\n' + modelSays({ intent: 'wait', reason: '先看看。' }) + '\n```'),
    );
    const result = await clientWith(fetch).decide(request);
    expect(result.ok).toBe(true);
  });
});

// --- Reliability (§14/§15/§16) ------------------------------------------------------------------

describe('L-8 the HTTP status decides both the error and whether to try again', () => {
  it('reports http-error without retrying a status that will not improve', async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      const { request } = explorerWithOffer();
      const { fetch, calls } = stubTransport(() => failing(status));
      const result = await new OpenAiCompatibleModelClient(
        config({ maxRetries: 2 }),
        { fetch, now: () => 0 },
      ).decide(request);
      expect({ status, result, calls: calls.length }).toEqual({
        status,
        result: { ok: false, error: 'http-error', latencyMs: 0 },
        calls: 1,
      });
    }
  });

  it('retries a status that might improve, then gives up', async () => {
    for (const status of [408, 429, 500, 503]) {
      const { request } = explorerWithOffer();
      const { fetch, calls } = stubTransport(() => failing(status));
      const result = await new OpenAiCompatibleModelClient(
        config({ maxRetries: 2 }),
        { fetch, now: () => 0, sleep: async () => {} },
      ).decide(request);
      expect({ status, result, calls: calls.length }).toEqual({
        status,
        result: { ok: false, error: 'http-error', latencyMs: 0 },
        calls: 3,
      });
    }
  });

  it('recovers when a retry succeeds', async () => {
    const { observation, request } = explorerWithOffer();
    const { fetch, calls } = stubTransport(({ index }) =>
      index === 1 ? failing(503) : answering(modelSays({ intent: 'wait', reason: '先看看。' })),
    );
    const result = await new OpenAiCompatibleModelClient(config({ maxRetries: 1 }), {
      fetch,
      now: () => 0,
      sleep: async () => {},
    }).decide(request);
    expect(calls).toHaveLength(2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.decision.observationTick).toBe(observation.tick);
  });

  it('never retries an answer the model actually gave', async () => {
    const { request } = explorerWithOffer();
    const { fetch, calls } = stubTransport(() => answering('我决定先观察。'));
    await new OpenAiCompatibleModelClient(config({ maxRetries: 3 }), { fetch }).decide(request);
    expect(calls).toHaveLength(1);
  });

  it('backs off exponentially between attempts', async () => {
    const { request } = explorerWithOffer();
    const delays: number[] = [];
    const { fetch } = stubTransport(() => failing(500));
    await new OpenAiCompatibleModelClient(config({ maxRetries: 2 }), {
      fetch,
      now: () => 0,
      sleep: async (ms) => {
        delays.push(ms);
      },
    }).decide(request);
    expect(delays).toEqual([500, 1_000]);
  });

  it('reports every attempt, so a retry is visible after the fact (§19)', async () => {
    const { request } = explorerWithOffer();
    const traces: LlmAttemptTrace[] = [];
    const { fetch } = stubTransport(({ index }) =>
      index < 4 ? failing(503) : answering(modelSays({ intent: 'wait', reason: '先看看。' })),
    );
    await new OpenAiCompatibleModelClient(config({ maxRetries: 3 }), {
      fetch,
      now: () => 0,
      sleep: async () => {},
      onAttempt: (trace) => traces.push(trace),
    }).decide(request);

    expect(traces.map((t) => t.outcome)).toEqual(['retry', 'retry', 'retry', 'ok']);
    expect(traces.map((t) => t.attempt)).toEqual([1, 2, 3, 4]);
    expect(traces.every((t) => t.maxAttempts === 4)).toBe(true);
    expect(traces.every((t) => t.model === DEFAULT_DEEPSEEK_MODEL)).toBe(true);
    expect(traces.every((t) => t.provider === 'deepseek')).toBe(true);
    expect(traces[0]).toMatchObject({ error: 'http-error', httpStatus: 503, startedAt: 0, endedAt: 0 });
    expect(traces[3]).toMatchObject({ error: null, outcome: 'ok' });
  });
});

describe('L-13 consecutive failures open a breaker instead of retrying forever', () => {
  it('stops calling out once the failure budget is spent', async () => {
    const { request } = explorerWithOffer();
    const { fetch, calls } = stubTransport(() => failing(401));
    const client = new OpenAiCompatibleModelClient(config({ maxConsecutiveFailures: 2 }), {
      fetch,
      now: () => 0,
    });

    await client.decide(request);
    await client.decide(request);
    expect(calls).toHaveLength(2);

    // Third call: the breaker is open, so the network is not touched at all.
    const tripped = await client.decide(request);
    expect(tripped).toEqual({ ok: false, error: 'unavailable', latencyMs: 0 });
    expect(calls).toHaveLength(2);
  });

  it('lets a call through again once the cooldown has passed', async () => {
    const { request } = explorerWithOffer();
    let clock = 0;
    const { fetch, calls } = stubTransport(() => failing(401));
    const client = new OpenAiCompatibleModelClient(config({ maxConsecutiveFailures: 1 }), {
      fetch,
      now: () => clock,
    });

    await client.decide(request);
    expect(calls).toHaveLength(1);
    await client.decide(request); // breaker open
    expect(calls).toHaveLength(1);

    clock += DEFAULT_COOLDOWN_MS + 1;
    await client.decide(request);
    expect(calls).toHaveLength(2);
  });

  it('forgets the failures as soon as one call succeeds', async () => {
    const { request } = explorerWithOffer();
    // Fails, succeeds, fails, succeeds. Without the reset the two failures would be "consecutive"
    // and the budget of 2 would trip the breaker before the fourth call — so `calls === 4` is the
    // assertion that proves the counter was cleared, and the frozen clock means a cooldown could
    // not have rescued it.
    const { fetch, calls } = stubTransport(({ index }) =>
      index === 1 || index === 3
        ? failing(500)
        : answering(modelSays({ intent: 'wait', reason: '先看看。' })),
    );
    const client = clientWith(fetch, { maxConsecutiveFailures: 2 });

    expect(await client.decide(request)).toMatchObject({ ok: false });
    expect(await client.decide(request)).toMatchObject({ ok: true });
    expect(await client.decide(request)).toMatchObject({ ok: false });
    expect(await client.decide(request)).toMatchObject({ ok: true });
    expect(calls).toHaveLength(4);
  });
});

describe('L-11/§16 a provider misbehaving is an inconvenience, never an outage', () => {
  it('survives a transport that throws', async () => {
    const { request } = explorerWithOffer();
    const client = new OpenAiCompatibleModelClient(config(), {
      fetch: () => {
        throw new Error('socket hang up');
      },
      now: () => 0,
    });
    expect(await client.decide(request)).toEqual({ ok: false, error: 'unavailable', latencyMs: 0 });
  });

  it('survives a body that cannot be read', async () => {
    const { request } = explorerWithOffer();
    const client = new OpenAiCompatibleModelClient(config(), {
      fetch: async () => ({
        ok: true,
        status: 200,
        text: async () => {
          throw new Error('stream reset');
        },
      }),
      now: () => 0,
    });
    expect(await client.decide(request)).toEqual({ ok: false, error: 'invalid-json', latencyMs: 0 });
  });

  it('survives a trace consumer that throws', async () => {
    const { request } = explorerWithOffer();
    const client = new OpenAiCompatibleModelClient(config(), {
      fetch: stubTransport(() => answering(modelSays({ intent: 'wait', reason: '先看看。' }))).fetch,
      now: () => 0,
      onAttempt: () => {
        throw new Error('logger exploded');
      },
    });
    expect(await client.decide(request)).toMatchObject({ ok: true });
  });
});

// --- L-12 credentials ---------------------------------------------------------------------------

describe('L-12 the API key never leaves the header', () => {
  it('does not appear in any trace, on success or on failure', async () => {
    const { request } = explorerWithOffer();
    for (const respond of [
      () => answering(modelSays({ intent: 'wait', reason: '先看看。' })),
      () => failing(401),
    ]) {
      const traces: LlmAttemptTrace[] = [];
      const { fetch } = stubTransport(respond);
      const client = new OpenAiCompatibleModelClient(config(), {
        fetch,
        now: () => 0,
        onAttempt: (trace) => traces.push(trace),
      });
      const result = await client.decide(request);
      expect(JSON.stringify(traces)).not.toContain(KEY);
      expect(JSON.stringify(result)).not.toContain(KEY);
    }
  });
});

// --- Isolation (§28) ----------------------------------------------------------------------------

describe('the provider is isolated from the world', () => {
  it('does not mutate the observation it was asked about', async () => {
    const { observation, request } = explorerWithOffer();
    const before = structuredClone(observation);
    const { fetch } = stubTransport(() =>
      answering(modelSays({ intent: 'act', choiceId: actChoice(observation), reason: '去。' })),
    );
    await clientWith(fetch).decide(request);
    expect(observation).toEqual(before);
  });

  it('L-15 opens no real socket: the injected transport is the only one used', async () => {
    const { request } = explorerWithOffer();
    const realFetch = vi.spyOn(globalThis, 'fetch');
    try {
      const { fetch, calls } = stubTransport(() =>
        answering(modelSays({ intent: 'wait', reason: '先看看。' })),
      );
      await clientWith(fetch).decide(request);
      expect(calls).toHaveLength(1);
      expect(realFetch).not.toHaveBeenCalled();
    } finally {
      realFetch.mockRestore();
    }
  });

  it('naming the model is part of the contract, so a trace can say which one answered', () => {
    const client = new OpenAiCompatibleModelClient(config({ model: 'deepseek-reasoner' }), {});
    expect(client.id).toBe('deepseek');
    expect(client.model).toBe('deepseek-reasoner');
    expect(client.promptVersion).toBe(AGENT_PROMPT_VERSION);
  });
});

// --- The P2 exit criterion (§31) ---------------------------------------------------------------

describe('§31 an unavailable DeepSeek degrades to the fallback that already existed', () => {
  it('produces a valid deterministic decision when every attempt fails', async () => {
    const { observation } = explorerWithOffer();
    const { fetch, calls } = stubTransport(() => failing(503));
    const client = clientWith(fetch, { maxRetries: 1 });

    const outcome = await agentRuntime(client).requestDecision(observation);

    expect(calls).toHaveLength(2); // it tried, and tried once more
    expect(outcome.status).toBe('decided'); // …and the game still got an answer
    if (outcome.status !== 'decided') return;
    expect(outcome.decision.provider).toBe('deterministic');
    expect(agentDecisionSchema.safeParse(outcome.decision).success).toBe(true);
    expect(outcome.decision.observationTick).toBe(observation.tick);
    // The trace names the provider that failed and the model it would have used — which is what
    // makes "why did this Agent do that?" answerable after the fact.
    expect(outcome.trace.provider).toBe('deepseek');
    expect(outcome.trace.model).toBe(DEFAULT_DEEPSEEK_MODEL);
    expect(outcome.trace.fallbackUsed).toBe(true);
    expect(outcome.trace.providerFailure).toBe('http-error');
  });

  it('running with no key configured means no provider at all, and still a decision', async () => {
    // The host's branch, in one line: `createDeepSeekClient()` returns null and the runtime is built
    // around the mock or the deterministic path instead (playbook §21, L-11).
    expect(createDeepSeekClient({})).toBeNull();
    const { observation } = explorerWithOffer();
    const outcome = await agentRuntime(new MockModelClient({ rules: [] })).requestDecision(
      observation,
    );
    expect(outcome.status).toBe('decided');
    if (outcome.status === 'decided') expect(outcome.decision.provider).toBe('deterministic');
  });
});
