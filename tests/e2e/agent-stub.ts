/**
 * A local, deterministic OpenAI-compatible provider for the E2E vertical slice.
 *
 * The Playwright spec runs the **real** Electron app, so the Agent layer inside it must be given a
 * provider it can actually reach. Pointing `DEEPSEEK_BASE_URL` at this stub does that without
 * touching a line of source: `createDeepSeekClient(env)` builds the ordinary client, the ordinary
 * request goes out, and the ordinary response parsing, validation and fallback all run. Only the far
 * end is fake — which is the same bargain `MockModelClient` makes in-process, one level lower.
 *
 * It also closes a real hazard: an ambient `DEEPSEEK_API_KEY` in the developer's environment would
 * otherwise send a test run to the live API. `context.setOffline(true)` does not prevent that — the
 * fetch happens in the main process.
 *
 * The answer is derived from the prompt, not from a fixed script. `renderSituation` prints the menu
 * as `- <id>：<label>｜intent：<respond|act>｜…`, so this reads the same menu the model would and
 * picks something the engine has already agreed is legal. It is deliberately not clever: the point is
 * a decision that survives validation, not a good one.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface AgentStub {
  baseUrl: string;
  /** Every decision prompt the app sent, in order — so a spec can prove the model was consulted. */
  readonly prompts: string[];
  close(): Promise<void>;
}

/** The menu line `renderSituation` prints, one per candidate. */
const CANDIDATE = /^- ([^：\n]+)：[^\n]*｜intent：(respond|act)｜/gm;

function chooseAnswer(prompt: string): { intent: string; choiceId?: string; reason: string } {
  const menu = [...prompt.matchAll(CANDIDATE)].map((match) => ({
    id: match[1].trim(),
    intent: match[2],
  }));
  // Answering the Admiral first is what the deterministic band does too, so the stub agrees with it.
  const accept = menu.find((option) => option.id === 'accept');
  if (accept) return { intent: 'respond', choiceId: 'accept', reason: 'E2E stub：接受任务。' };
  const team = menu.find((option) => option.id.startsWith('team-accept:'));
  if (team) return { intent: 'respond', choiceId: team.id, reason: 'E2E stub：接受组队。' };
  // Otherwise do something physical the engine offered, rather than idling the slice away.
  const act = menu.find((option) => option.intent === 'act' && option.id.startsWith('escort:'));
  if (act) return { intent: 'act', choiceId: act.id, reason: 'E2E stub：护航。' };
  return { intent: 'wait', reason: 'E2E stub：没有可选项。' };
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => resolve(body));
  });
}

export async function startAgentStub(): Promise<AgentStub> {
  const prompts: string[] = [];

  const server: Server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const body = await readBody(request);
    let prompt = '';
    try {
      const parsed = JSON.parse(body) as { messages?: { content?: string }[] };
      prompt = (parsed.messages ?? []).map((message) => message.content ?? '').join('\n');
    } catch {
      /* fall through to the "no menu" answer, which is a legal `wait` */
    }
    prompts.push(prompt);
    const answer = chooseAnswer(prompt);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        id: 'stub-1',
        object: 'chat.completion',
        model: 'e2e-stub',
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(answer) } }],
      }),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('stub 未能绑定端口');
  return {
    baseUrl: 'http://127.0.0.1:' + address.port,
    prompts,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
