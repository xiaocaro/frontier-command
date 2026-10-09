/**
 * The watchable UI demo of the Lv3 MVP (docs/lv3/10-agent-demo-channel.md §4).
 *
 * `npm run demo:live` prints the same eight steps to a terminal. This one **shows** them: a real
 * Electron window, a real mouse clicking the real interface, and a recording with a drawn cursor. The
 * two are not alternatives — the terminal version is the reproducible record (it asserts engine facts
 * and prints the model's reasoning), this is the performance.
 *
 * **Not collected by `npm run test:e2e`.** The default `testMatch` is
 * `**\/*.@(spec|test).?(c|m)[jt]s?(x)`, so a `.demo.ts` file needs `playwright.demo.config.ts` — the same
 * trick `vitest.live.config.ts` uses. Naming this `*.spec.ts` would start recording videos on every
 * e2e run.
 *
 * **A demo, not a gate.** A real model may answer, or may decide to just go and do something instead —
 * and that is a result, not a failure. So it asserts only what is true whatever the model chose (the
 * engine's own promise and memory state, the app staying up, every message the Admiral sends actually
 * reaching the engine) and *shows* everything else — including, on a silence, what the world was doing
 * while it waited (`whySilent`): "没有回话" on its own cannot be told apart from a world that was
 * paused the whole time. Same stance as `tests/live/vertical-slice.live.ts`.
 *
 * Two acts, two worlds, two recordings. `electron/main.ts` takes a single-instance lock, so act A must
 * be fully closed before act B launches or act B silently never appears.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page, Video } from '@playwright/test';
import { SaveStore } from '../../electron/persistence';
import { createWorld } from '../../src/engine/data';
import type { WorldState } from '../../src/engine/types';

/**
 * Where the storyboard goes.
 *
 * Deliberately NOT the config's `outputDir`: Playwright wipes that directory, and removes the
 * per-test artifacts inside it when a test **passes** — which silently deleted the first version of
 * this storyboard. Both live under the gitignored `test-results/`, but they must not be the same path.
 */
const SHOT_DIR = resolve('test-results/agent-demo');

/**
 * How much to stretch every deliberate pause (`--pace=`, via `scripts/demo-ui.mjs`). Default ×5.
 *
 * A demo has an audience. The first version used ×1, which reads fine on one screen and is too fast to
 * follow when someone else is watching; ×10 then turned out slower than the story needs, so ×5 is the
 * default — ×10 stays available for a room, ×1 for a quick look. Only the **pauses** scale:
 * `expect.poll` timeouts are ceilings on how long a model may take, not beats in the performance, and
 * shortening those would turn a slow model into a spurious failure.
 *
 * The default lives here as well as in the launcher so that running the spec directly — as the
 * `demo:ui` script does not, but a config-driven test run would — gets the same pace.
 *
 * The app's own read hold (`FRONTIER_READ_HOLD_MS`, `electron/read-hold.ts`) is **not** scaled here.
 * It is a fixed property of the game — the world pauses for two seconds whenever an Agent answers the
 * Admiral — and the demo inherits it rather than restating it, so what the recording shows is what a
 * player sees.
 */
const PACE = Number(process.env.DEMO_PACE ?? '5');
const pause = (page: Page, ms: number) => page.waitForTimeout(Math.round(ms * PACE));
/** Must match `electron/main.ts`'s BrowserWindow, or the recording is scaled to fit 800x450. */
const WINDOW = { width: 1600, height: 900 };
const EXPLORER = 'LYRA VOSS';
const REFIT_SHIP = 'meridian'; // the logistics hull — deliberately NOT the explorer's `vigil`

const launched: ElectronApplication[] = [];
test.afterEach(async () => {
  // Every app, not just the last one: if the test throws between the two launches, the first one leaks
  // and holds the single-instance lock for the next run.
  for (const app of launched) await app.close().catch(() => {});
  launched.length = 0;
});

/**
 * The narration overlay. Terminal output does not appear in the recording, so without this the video
 * is a silent sequence of clicks. **Demo scaffolding, not product** — injected outside the React root
 * so a re-render cannot clobber it, and `pointer-events: none` so it can never swallow a click.
 */
async function installNarration(page: Page) {
  await page.evaluate(() => {
    if (document.getElementById('demo-narration')) return;
    const el = document.createElement('div');
    el.id = 'demo-narration';
    el.setAttribute(
      'style',
      [
        'position:fixed',
        'left:0',
        'top:0',
        'z-index:2147483647',
        'pointer-events:none',
        'background:rgba(0,0,0,.82)',
        'color:#ffcc66',
        'white-space:pre-line',
        'font:600 19px/1.35 system-ui,sans-serif',
        'padding:10px 16px',
        'max-width:70vw',
        'border-bottom-right-radius:12px',
      ].join(';'),
    );
    document.body.appendChild(el);
  });
}

let shot = 0;

/**
 * The opening card: the world, the crew, and what the eight steps are about.
 *
 * **Demo scaffolding, not product** — the same stance as `installNarration`. The game has no intro
 * screen and this does not add one (CLAUDE.md §3): it is injected outside the React root, it is
 * `pointer-events: none` so it can never swallow a click, and the demo removes it before the story
 * starts. Two details make it coexist with the narration instead of fighting it: its `z-index` is one
 * **below** the overlay's, so a caption still reads on top of it, and its content is centred so the
 * caption strip (top-left) never lands on the text.
 *
 * The crew is passed in rather than written here, so the names on the card are the names in the panel
 * and in the feed — read from the real roster, a card that lists the wrong crew is impossible.
 */
async function showOpening(page: Page, crew: { name: string; career: string }[]) {
  await page.evaluate((crew) => {
    document.getElementById('demo-opening')?.remove();
    const LABELS: Record<string, string> = {
      explorer: '探索',
      scientist: '科学',
      tactical: '战术',
      logistics: '后勤',
    };
    const TITLE = 'margin:0 0 8px;font:700 44px/1.15 system-ui,sans-serif;letter-spacing:.05em;color:#ffcc66';
    const SUB = 'margin:0 0 26px;font:600 21px/1.5 system-ui,sans-serif;color:#9fd8ff';
    const SECTION = 'margin:24px 0 4px;font:700 15px/1.2 system-ui,sans-serif;letter-spacing:.22em;color:#6fd3ff';
    const BODY = 'margin:0;font:400 19px/1.7 system-ui,sans-serif;color:#dbe6f0';
    const CREW = 'margin:2px 0;font:600 20px/1.5 system-ui,sans-serif;color:#f0f6fb';
    const FOOT = 'margin:30px 0 0;font:400 15px/1.7 system-ui,sans-serif;color:#8ba3b6';
    const card = document.createElement('div');
    card.id = 'demo-opening';
    card.setAttribute(
      'style',
      [
        'position:fixed',
        'inset:0',
        'z-index:2147483646',
        'pointer-events:none',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'background:linear-gradient(160deg,#070b11,#0e1822 60%,#12242f)',
        'color:#e6eef6',
        'padding:56px 72px',
      ].join(';'),
    );
    const column = document.createElement('div');
    column.setAttribute('style', 'max-width:1000px;width:100%');
    const add = (style: string, text: string) => {
      const node = document.createElement('p');
      node.setAttribute('style', style);
      // `textContent`, never `innerHTML`: part of this text is the roster's names.
      node.textContent = text;
      column.appendChild(node);
    };
    add(TITLE, 'FRONTIER COMMAND · Lv3 AGENT 演示');
    add(SUB, '八步，看同一名 Agent 因为历史不同，给出不同的答复');
    add(SECTION, '世界');
    add(BODY, '你是 Dawn Frontier Command 的 Admiral。边疆在持续运行：舰队、基地、殖民地与补给都真实存在，机会与威胁由世界自己产生。');
    add(BODY, '世界状态由 SimulationEngine 权威结算——Agent 与模型只有「结构化决策」，改不了世界。');
    add(SECTION, '角色');
    for (const member of crew) add(CREW, member.name + '　·　' + (LABELS[member.career] ?? member.career));
    add(SECTION, '任务');
    add(BODY, '一个高风险调查机会。先对 Explorer 许诺并兑现（Path A），另起一局改用命令强行压过去（Path B）——同一个问题，两次历史，两种答复。');
    add(FOOT, '台词全部由 Agent 自己写，出现在 PRIORITY COMMUNICATIONS 里；本演示只断言与模型无关的事实。');
    card.appendChild(column);
    document.body.appendChild(card);
  }, crew);
}

/**
 * Take the opening card down. The story starts on the game's own UI. */
async function hideOpening(page: Page) {
  await page.evaluate(() => document.getElementById('demo-opening')?.remove());
}

/**
 * Start the storyboard from empty.
 *
 * `narrate` numbers the frames from `shot`, and the storyboard is **one** artifact covering both acts:
 * a re-run that narrates the same steps overwrites its own frames, so the directory stays honest by
 * itself. Insert one frame, though — as the opening card did — and every later number shifts, leaving
 * the *previous* run's `01-…` behind as a file this run never wrote. On screen that is
 * indistinguishable from a real frame, which is exactly the kind of "looks fine, means nothing"
 * artifact the rest of this file works to avoid. Playwright's own `outputDir` cleanup cannot help:
 * it is a different directory on purpose (see `SHOT_DIR`).
 */
function clearStoryboard() {
  mkdirSync(SHOT_DIR, { recursive: true });
  for (const entry of readdirSync(SHOT_DIR, { withFileTypes: true }))
    if (entry.isFile() && entry.name.endsWith('.png')) rmSync(join(SHOT_DIR, entry.name));
}

/**
 * Say the same thing to the terminal, to the screen, and to the storyboard.
 *
 * The screenshot is taken **after** the overlay is updated, so each PNG carries its own caption —
 * which is what makes the storyboard readable without the terminal log beside it. This is the
 * artifact in place of a video; see the note on `recordVideo` in `launchVisible`.
 */
async function narrate(page: Page, step: string, detail = '') {
  process.stdout.write('\n[demo] ' + step + (detail ? ' — ' + detail : '') + '\n');
  await page.evaluate(
    ([s, d]) => {
      const el = document.getElementById('demo-narration');
      if (el) el.textContent = s + (d ? '\n' + d : '');
    },
    [step, detail] as const,
  );
  shot += 1;
  const slug =
    String(shot).padStart(2, '0') + '-' + step.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40);
  await page.screenshot({ path: join(SHOT_DIR, slug + '.png'), animations: 'disabled' });
}

interface Act {
  app: ElectronApplication;
  page: Page;
  video: Video | null;
}

async function launchVisible(world: WorldState, label: string): Promise<Act> {
  mkdirSync(SHOT_DIR, { recursive: true });
  // A fresh user-data dir per act: the single-instance lock keys off it, and it keeps world state clean.
  const directory = mkdtempSync(join(tmpdir(), 'frontier-demo-' + label + '-'));
  new SaveStore(directory).write(world);
  const app = await electron.launch({
    args: [resolve('.')],
    env: { ...process.env, FRONTIER_USER_DATA: directory, FRONTIER_HEADLESS: '0' },
    // **No `recordVideo`.** It is what this demo wanted, and it is broken here: `electron.launch({
    // recordVideo })` makes the initial navigation fail with `ERR_FAILED (-2) loading
    // 'frontier://app/index.html'`, and the test then hangs to its 20-minute timeout. Reproduced with
    // the minimal `recordVideo: { dir }` form and with `FRONTIER_HEADLESS: '1'`, so it is the option
    // itself and not the visible window — while the same launch without it passes in 34s. The app
    // serves its bundle through `protocol.handle('frontier', … net.fetch(file://…))`, and that is
    // where it fails. So the artifact is a **storyboard of PNGs** (one per narrated step, with the
    // narration burned in) instead of a video. See `KNOWN_ISSUES.md` `C-38`.
  });
  launched.push(app);
  // Surface both sides of the process. A blank window is otherwise indistinguishable from a slow one,
  // and the main process is where a rejected save or a failed provider assembly would say so.
  app.process().stderr?.on('data', (chunk: Buffer) => process.stdout.write('[main] ' + chunk));
  const page = await app.firstWindow();
  page.on('pageerror', (error) => process.stdout.write('[pageerror] ' + error.message + '\n'));
  page.on('console', (message) => {
    if (message.type() === 'error') process.stdout.write('[console] ' + message.text() + '\n');
  });
  try {
    await page.getByRole('navigation', { name: '主导航' }).waitFor({ timeout: 45_000 });
  } catch (error) {
    const body = await page.evaluate(() => document.body?.innerText?.slice(0, 400) ?? '(no body)');
    process.stdout.write('[demo] 启动失败，页面文本：' + JSON.stringify(body) + '\n');
    throw error;
  }
  // Let the fonts settle so the recording does not show a fallback face — but **bounded**.
  //
  // `document.fonts.ready` never resolves while any single font is still pending, and this app ships a
  // 16MB CJK face; waiting on it unbounded hung the demo until the 20-minute test timeout. A race
  // gives the fonts a moment without making the demo hostage to one of them.
  await page.evaluate(() =>
    Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 5000))]),
  );
  await installNarration(page);
  return { app, page, video: page.video() };
}

const panel = (page: Page) => page.locator('.agent-channel');
const comms = (page: Page) => page.locator('.communications');
const roster = (page: Page) => page.evaluate(() => window.frontier.agents());
/** The loop's own tally - decisions, how many the model answered, how many were dropped. */
const loopStats = async (page: Page) => (await roster(page)).stats;
const agentByCareer = async (page: Page, career: string) =>
  (await roster(page)).agents.find((agent) => agent.career === career)!;

async function selectAgent(page: Page, name: string) {
  await panel(page).locator('.agent-row').filter({ hasText: name }).locator('.agent-pick').click();
  await pause(page, 400);
}

async function speak(page: Page, kind: string, text: string) {
  await panel(page).getByLabel('类型').selectOption(kind);
  await panel(page).getByLabel('发往 Agent 的消息').fill(text);
  await pause(page, 600);
  await panel(page).getByRole('button', { name: '发送', exact: true }).click();
  await expect(panel(page)).toContainText('已发出');
  // `已发出` is the panel's **last note** and survives the next send, so on its own it cannot tell a
  // fresh success from a stale one. The mirrored feed line is written by the engine for a command it
  // actually accepted, and it carries this exact text — which is what makes "the message reached the
  // engine" an assertion rather than an impression. (Step 8 used to send with no check at all, so a
  // message that never went out looked exactly like a model that stayed quiet.)
  await expect(comms(page)).toContainText(text);
  await expect(comms(page)).toContainText('→');
}

/** The most recent line spoken BY an Agent. Reads `.comms-content` — not the whole row, which also
 *  carries the priority prefix and the acknowledge button's label. */
const lastReply = (page: Page) =>
  page.evaluate(() => {
    const spoken = [...document.querySelectorAll('.comms-item .comms-content')]
      .map((node) => node.textContent ?? '')
      .filter((text) => text.includes('←'));
    // `.comms-content` wraps the priority/time span and the text, so strip the prefix and the
    // acknowledge button's label to leave what the Agent actually said.
    const line = spoken.at(-1) ?? null;
    return line === null ? null : line.replace(/^[A-Z]+\s*\/\s*\d+m/, '').replace(/确认$/, '').trim();
  });

/**
 * What the world was doing while we waited for an answer.
 *
 * `null` is a legal answer (see `waitForReply`), but *"the Agent chose to say nothing"* and *"no Agent
 * could have said anything"* are different facts that look identical on screen — and only the first is
 * a result. `AgentScheduler.pump()` returns before it starts anything while the world is paused
 * (`electron/agent/scheduler.ts`, `S-5`), so a paused world silences **every** Agent: that is a
 * property of the world, not of the model. Sampling *during* the wait is what lets the narration say
 * which of the two happened (`KNOWN_ISSUES.md` `C-37`: the layer that drops a decision is not the one
 * the documents point at).
 */
interface WaitWatch {
  /** Whether the world was paused at the last sample. */
  paused: boolean;
  /** Whether it was paused at *any* sample during the wait. */
  everPaused: boolean;
  /** `pauseReasons` at the last sample. A critical alarm names itself; a bare pause does not. */
  reasons: string[];
  /** The loop's counters — to tell "no decision happened" from "one happened and chose silence". */
  decisions: number;
  /** `decisions` when the wait began, or `-1` if the very first sample failed. */
  decisionsAtStart: number;
  modelCalls: number;
  /**
   * The watched Agent's ship, busy or free — `null` when the caller did not name an Agent, or when
   * that Agent has no ship bound.
   *
   * This is the field `N-1` needs: a busy ship means `pump()` defers the beat, so the *model is never
   * asked*. Without it, "the model chose not to speak" and "the question was never put to it" are the
   * same sentence — which is exactly the confusion this whole helper exists to remove.
   */
  agentBusy: boolean | null;
  /** What that ship is executing, when it is busy. */
  agentDirective: string | null;
  /**
   * How many samples succeeded.
   *
   * A sample that throws is swallowed (the wait is what matters, not the sampling), but **silence must
   * not be allowed to masquerade as health**: with zero successful samples every field above is still
   * at its default, which reads exactly like "the world was running the whole time". So the count is
   * carried out and `whySilent` says so instead of guessing.
   */
  samples: number;
}

/**
 * Why an Agent said nothing, read from the engine rather than from the answer.
 *
 * Every branch is model-independent, which is what makes it safe to print in a demo that asserts only
 * what is true whatever the model chose: the world's pause state, the ship's idleness and the loop's
 * counters are all facts.
 *
 * One thing this deliberately does **not** have to allow for: the read-hold. On the *answer* path the
 * world is paused with no reason — that is the hold, and it is why step 2 says 「世界已暂停供阅读」 —
 * so a bare pause is the normal state there. On the *silence* path it cannot be the hold: `arm()` only
 * fires when the engine accepted a message **to the Admiral** (`agent-host.ts` `messengerFor`), and
 * accepting that message writes the mirrored `←` line into the feed, which is exactly what the poll
 * waits for. A hold therefore implies a `←` the poll would already have found — so if we timed out and
 * the world is paused with `pauseReasons` empty, it is a **stuck** bare pause (a failed autosave or the
 * player), not a two-second hold. `C-41`'s "不可分辨的状态" is what makes that reasoning necessary.
 */
function whySilent(name: string, watch: WaitWatch): string {
  const world =
    watch.samples === 0
      ? '采样失败（读不到世界状态与计数）'
      : watch.paused
        ? '世界在等待结束时仍是暂停的（' + (watch.reasons.join('、') || '无 reason：人工暂停或自动存档失败都会这样停') + '）'
        : watch.everPaused
          ? '世界在等待期间暂停过（' + (watch.reasons.join('、') || '无 reason') + '），结束前已恢复'
          : '世界全程在运行';
  const verdict =
    watch.samples === 0
      ? '没有任何证据可判断，不要据此下结论'
      : watch.paused
        ? '世界暂停时调度器不做任何决策，这不是模型的选择'
        : watch.agentBusy === null
          ? '世界在跑：要么这一拍没轮到它（舰船非空闲时调度器只延后，N-1），要么模型选择了不发言——未指名 Agent，无法再细分'
          : watch.agentBusy
            ? '世界在跑，但它的舰船在结束时非空闲' +
              (watch.agentDirective ? '（正在执行 ' + watch.agentDirective + '）' : '') +
              ' ⇒ 调度器按 N-1 只延后不重试，模型这一拍**根本没被问到**'
            : '世界在跑、结束时舰船空闲、菜单上有未读的 offer ⇒ 模型这一拍选择了不发言，这是一个结果';
  const loop =
    '本局决策 ' + (watch.decisionsAtStart < 0 ? '?' : watch.decisionsAtStart) + ' → ' + watch.decisions +
    ' 次 · 其中模型作答 ' + watch.modelCalls + ' 次';
  return '「' + name + '」没有回话 · ' + world + ' · ' + loop + '。' + verdict;
}

/**
 * The Agent's answer, or `null`. **`null` is a result**, not a failure — it may have chosen to act.
 *
 * Returning the words instead of a boolean is what lets the narration show what the model actually
 * said: the storyboard is the artifact, and "出现了答复" is not what a viewer came to read. It also
 * returns a {@link WaitWatch}, because a bare `null` cannot be told apart from a world that was paused
 * the whole time — see {@link whySilent}.
 *
 * When this returns, the world is holding for a couple of seconds (`FRONTIER_READ_HOLD_MS`,
 * `electron/read-hold.ts`), so the screenshot the caller takes next catches the held state with the
 * answer on screen. That hold is the app's own fixed duration and is deliberately **not** scaled by
 * `--pace`: it is a property of the game rather than a beat in the performance, exactly like the
 * `expect.poll` ceilings below. To make the demo's hold longer than the game's, set
 * `FRONTIER_READ_HOLD_MS` from `--pace` in `scripts/demo-ui.mjs`.
 */
async function waitForReply(
  page: Page,
  options: { career?: string; ms?: number } = {},
): Promise<{ said: string | null; watch: WaitWatch }> {
  const { career, ms = 60_000 } = options;
  const watch: WaitWatch = {
    paused: false,
    everPaused: false,
    reasons: [],
    decisions: 0,
    decisionsAtStart: -1,
    modelCalls: 0,
    agentBusy: null,
    agentDirective: null,
    samples: 0,
  };
  const sample = async () => {
    try {
      const facts = await page.evaluate(
        async (career: string | undefined) => {
          const { state } = await window.frontier.getState();
          const roster = await window.frontier.agents();
          // Named by **career**, not by name: the roster's name is the display name (`LYRA VOSS / 薇拉`)
          // while the demo's constants are the call-sign, and `agentByCareer` is what every other step
          // already uses. The chain is `agent-host.ts`'s `shipOfAgent`, read off the snapshot —
          // `operators`, `assignments` and `ships` are already in it (`projection.ts`), so nothing new
          // crosses the boundary and no contract changes.
          const agent = career ? roster.agents.find((a) => a.career === career) : undefined;
          const operator = agent ? state.operators.find((o) => o.agentId === agent.id) : undefined;
          const shipId = operator
            ? state.assignments.find((a) => a.operatorId === operator.id)?.shipId
            : undefined;
          const ship = shipId ? state.ships.find((s) => s.id === shipId) : undefined;
          return {
            paused: state.paused,
            reasons: state.pauseReasons.map((reason) => reason.kind),
            decisions: roster.stats.decisions,
            modelCalls: roster.stats.modelCalls,
            agentBusy:
              career === undefined || !ship
                ? null
                : Boolean(ship.current) || ship.queue.length > 0 || ship.suspended.length > 0,
            agentDirective: ship?.current?.action.type ?? null,
          };
        },
        career,
      );
      watch.samples += 1;
      if (watch.decisionsAtStart < 0) watch.decisionsAtStart = facts.decisions;
      watch.paused = facts.paused;
      watch.everPaused ||= facts.paused;
      watch.reasons = facts.reasons;
      watch.decisions = facts.decisions;
      watch.modelCalls = facts.modelCalls;
      watch.agentBusy = facts.agentBusy;
      watch.agentDirective = facts.agentDirective;
    } catch {
      // A sample that cannot be read is not a reason to fail the demo — the *wait* is the assertion.
      // `samples` is what keeps that tolerance honest; see `WaitWatch`.
    }
  };
  try {
    await expect
      .poll(
        async () => {
          await sample();
          return comms(page).innerText();
        },
        { timeout: ms, intervals: [300] },
      )
      .toContain('←');
    return { said: await lastReply(page), watch };
  } catch {
    return { said: null, watch };
  }
}

/** Path A needs a real REFIT to settle: deepScan costs 1 specialFind, and a fresh world has none. */
function fundedWorld(): WorldState {
  const world = createWorld(236807);
  world.enemies = [];
  world.resources.credits = 10_000;
  const base = world.locations.find((location) => location.id === 'base')!;
  base.stock.materials = 1_000;
  base.stock.specialFinds = 10;
  return world;
}

/**
 * The engine mirrors every message into the Communications feed as `to ← from：text` (for a line an
 * Agent spoke) or `from → to：text` (for the Admiral's). That is the right shape for a feed you read
 * top-down, and the wrong shape to print under a heading that says "the answer": the speaker ends up
 * after an arrow pointing away from them, so a bare line reads as though the *recipient* said it.
 * This turns it back into speaker-first, and labels both ends, because a printed transcript has no
 * context to fall back on.
 */
function parseMirrored(line: string): { speaker: string; listener: string; text: string } | null {
  const match = /^(.*?)\s*(→|←)\s*(.*?)：(.*)$/s.exec(line);
  if (!match) return null;
  const [, left, arrow, right, text] = match;
  return arrow === '→'
    ? { speaker: left, listener: right, text }
    : { speaker: right, listener: left, text };
}

/** A reply, with the speaker named. Falls back to the raw line if it does not parse. */
function describeReply(said: string | null): string {
  if (said === null) return '（没有回话）';
  const parsed = parseMirrored(said);
  if (parsed === null) return said;
  return '说话人 ' + parsed.speaker + ' → 收件人 ' + parsed.listener + '｜' + parsed.text;
}

test('the MVP runbook, clicked through the real interface', async () => {
  test.setTimeout(Math.round(20 * 60_000 * Math.max(1, PACE)));
  const startedAt = Date.now();

  // ══ ACT A · the world where the Admiral keeps a promise ═══════════════════════════════════════
  clearStoryboard();
  const a = await launchVisible(fundedWorld(), 'a');
  const page = a.page;
  const explorerName = (await agentByCareer(page, 'explorer')).name;

  await expect
    .poll(() => a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
    .toBe(true);

  // The opening card lists the crew, so a roster that could not be read would render a heading with
  // nothing under it — the kind of half-empty frame nobody notices in a recording. Asserted here, where
  // the same four are pinned again as panel rows in step 1.
  const crew = (await roster(page)).agents;
  expect(crew.length).toBe(4);
  await showOpening(
    page,
    crew.map((agent) => ({ name: agent.name, career: agent.career })),
  );
  await narrate(page, '开幕', '世界 · 角色 · 这八步要演的事');
  await pause(page, 3500);
  await hideOpening(page);

  await narrate(page, 'ACT A · 准备', '世界已建；基地里预置了预算与一枚特殊发现（改装需要它）· 演示节奏 ×' + PACE);

  await narrate(page, '第 1 步 · Admiral 发布任务', '展开 AGENT CHANNEL，选中 Explorer，发送任务命令');
  await panel(page).locator('> summary').click();
  await expect(page.locator('.agent-row')).toHaveCount(4);
  await pause(page, 900);
  await selectAgent(page, EXPLORER);
  await speak(page, 'command', '穿越虫洞，寻找失联探测船，确认发生了什么。');
  await pause(page, 1200);

  await narrate(page, '第 2 步 · Agent 自主评估', '继续时间，等它决策');
  await page.getByRole('button', { name: '继续', exact: true }).click();
  const answer = await waitForReply(page, { career: 'explorer' });
  await narrate(
    page,
    '第 2 步 · 结果',
    answer.said === null
      ? whySilent(explorerName, answer.watch)
      : '世界已暂停供阅读 · 「' + explorerName + '」答复：' + answer.said,
  );
  await pause(page, 1200);
  await panel(page).getByRole('button', { name: '刷新', exact: true }).click();
  await pause(page, 1000);

  await narrate(page, '第 3 步 · 换一种问法', '类型 negotiate，同一个 Agent，不同问题');
  await speak(page, 'negotiate', '如果装备不足，你希望我提供什么？');
  await waitForReply(page);
  await pause(page, 1800);

  await narrate(
    page,
    '第 4 步 · Agent↔Agent（注入）',
    '⚠ 这一步由演示注入：面板只有 command/ask/negotiate/override，没有任何组队入口',
  );
  const explorerId = (await agentByCareer(page, 'explorer')).id;
  const tacticalId = (await agentByCareer(page, 'tactical')).id;
  const injected = await page.evaluate(
    ([from, to]) =>
      window.frontier.command({
        type: 'agentMessage',
        from,
        to,
        kind: 'team-request',
        text: '我要进那片空域，需要护航。',
        payload: { requestingAgentId: from, accept: false },
      }),
    [explorerId, tacticalId] as const,
  );
  expect(injected.ok).toBe(true);
  await waitForReply(page);
  await pause(page, 1800);

  await narrate(page, '第 5 步 · Path A · Admiral 承诺', '点「承诺 Deep Scan 优先权限」——这是两步命令');
  await selectAgent(page, EXPLORER);
  await panel(page).getByRole('button', { name: '承诺 Deep Scan 优先权限' }).click();
  await expect(panel(page)).toContainText('承诺已创建');
  await panel(page).getByRole('button', { name: '刷新', exact: true }).click();
  await expect(panel(page)).toContainText('有未兑现承诺');
  await pause(page, 1800);

  await narrate(page, '第 6 步 · Path A · 兑现', '对另一艘舰下达 REFIT（改装 → Deep Scan）');
  await page.getByRole('button', { name: '16×', exact: true }).click();
  await page.locator('.operation-chip[data-ship-id="' + REFIT_SHIP + '"]').click();
  await page.getByRole('button', { name: '新指令 / 改令', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Admiral 指令' });
  await dialog.getByLabel('指令类型', { exact: true }).selectOption('REFIT');
  await dialog.getByLabel('安装模块', { exact: true }).selectOption('deepScan');
  await pause(page, 700);
  await dialog.getByRole('button', { name: '下达 Admiral 指令', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  // Engine-driven and model-independent: installing the module settles the matching pending promise.
  await expect
    .poll(
      async () => {
        const explorer = await agentByCareer(page, 'explorer');
        return (
          explorer.promises.some((promise) => promise.status === 'fulfilled') &&
          explorer.memories.some((memory) => memory.tags.includes('promise-kept'))
        );
      },
      { timeout: 120_000, intervals: [500] },
    )
    .toBe(true);
  await panel(page).getByRole('button', { name: '刷新', exact: true }).click();
  await expect(panel(page)).not.toContainText('有未兑现承诺');
  await pause(page, 1800);
  await narrate(page, '第 6 步 · 结果', '承诺已兑现（面板上「有未兑现承诺」消失）');

  await narrate(page, 'Path A · 记下它的下一次答复', '同一个高风险任务问题');
  await page.getByRole('button', { name: '1×', exact: true }).click();
  await speak(page, 'command', '又出现一个高风险调查机会，你去不去？');
  const pathASaid = (await waitForReply(page, { career: 'explorer' })).said;
  await pause(page, 2000);
  const pathA = { trust: (await agentByCareer(page, 'explorer')).state.trustInAdmiral, said: pathASaid };

  await narrate(page, 'ACT A 结束', '下一幕换一局，让同一名 Agent 经历一次 Override');
  const statsA = await loopStats(page);
  await a.app.close();

  // ══ ACT B · the world where the Admiral forces it ════════════════════════════════════════════
  const b = await launchVisible(createWorld(236807), 'b');
  const p2 = b.page;
  await narrate(p2, 'ACT B · 第 7 步 · Path B', '同一名 Agent「' + (await agentByCareer(p2, 'explorer')).name + '」，这次被强制');
  await p2.getByRole('button', { name: '继续', exact: true }).click();
  await p2.waitForTimeout(1500);
  await p2.locator('.agent-channel > summary').click();
  await expect(p2.locator('.agent-row')).toHaveCount(4);
  await p2.waitForTimeout(900);
  await selectAgent(p2, EXPLORER);
  await p2.locator('.agent-channel').getByLabel('类型').selectOption('override');
  await p2.locator('.agent-channel').getByLabel('强制执行').selectOption('RETURN');
  await p2.locator('.agent-channel').getByLabel('发往 Agent 的消息').fill('这是命令，继续执行。');
  await p2.waitForTimeout(700);
  await p2.locator('.agent-channel').getByRole('button', { name: '发送', exact: true }).click();
  await expect(p2.locator('.agent-channel')).toContainText('已发出');
  // The override branch writes this memory unconditionally — not the model's doing.
  await expect
    .poll(
      async () =>
        (await agentByCareer(p2, 'explorer')).memories.some((memory) =>
          memory.tags.includes('admiral-override'),
        ),
      { timeout: 30_000, intervals: [500] },
    )
    .toBe(true);
  await p2.locator('.agent-channel').getByRole('button', { name: '刷新', exact: true }).click();
  await p2.waitForTimeout(1800);
  await narrate(p2, '第 7 步 · 结果', '面板上出现 admiral-override —— 强制的代价被记住了');

  await narrate(p2, '第 8 步 · 历史影响下一次决策', '同一个问题，两次历史——说话人相同，历史不同');
  // Sent through the helper every other step uses, so this one is **asserted** to have reached the
  // engine. It used to be the demo's only unchecked send, which made "the message never went out"
  // indistinguishable from "the model stayed quiet" — in the terminal log and the storyboard alike.
  await speak(p2, 'command', '又出现一个高风险调查机会，你去不去？');
  const pathBAnswer = await waitForReply(p2, { career: 'explorer' });
  // Narrated immediately, so the screenshot catches the read-hold exactly as step 2's does. Until this
  // line existed, a silent Path B left the overlay frozen on the step-8 headline for the whole
  // `waitForReply` ceiling (60s real time, and it is deliberately not scaled by `--pace`), with nothing
  // on screen or in the log to say why.
  await narrate(
    p2,
    '第 8 步 · 结果',
    pathBAnswer.said === null
      ? whySilent(EXPLORER, pathBAnswer.watch)
      : '世界已暂停供阅读 · 「' + EXPLORER + '」答复：' + pathBAnswer.said,
  );
  await p2.waitForTimeout(2200);
  const pathB = { trust: (await agentByCareer(p2, 'explorer')).state.trustInAdmiral, said: pathBAnswer.said };

  // ── Only model-independent facts are asserted. See the header. ────────────────────────────────
  expect((await agentByCareer(p2, 'explorer')).memories.some((m) => m.tags.includes('admiral-override'))).toBe(true);
  expect(await p2.evaluate(() => window.frontier.getState()).then((x) => x.state.status)).toBe('active');

  await p2.waitForTimeout(2000);
  const statsB = await loopStats(p2);
  await b.app.close();

  // The comparison goes to the terminal, where both worlds can be shown at once — and it is shown,
  // never asserted: with a real model the two answers may be identical, and that is itself a result.
  process.stdout.write(
    '\n[demo] ══ 对照（仅供参考，本脚本不断言两者不同）══\n' +
      '[demo] 信任：Path A ' + pathA.trust + ' vs Path B ' + pathB.trust + '\n' +
      '[demo] Path A 的答复：' + describeReply(pathA.said) + '\n' +
      '[demo] Path B 的答复：' + describeReply(pathB.said) + '\n' +
      '\n[demo] ══ 本局计数（来自 AgentHost，不是估算）══\n' +
      '[demo] ACT A：决策 ' + statsA.decisions + ' 次，其中 ' + statsA.modelCalls + ' 次由模型作答' +
      ' · 过期丢弃 ' + statsA.dropped + '\n' +
      '[demo] ACT B：决策 ' + statsB.decisions + ' 次，其中 ' + statsB.modelCalls + ' 次由模型作答' +
      ' · 过期丢弃 ' + statsB.dropped + '\n' +
      '[demo] 合计：决策 ' + (statsA.decisions + statsB.decisions) + ' 次 · 模型作答 ' +
      (statsA.modelCalls + statsB.modelCalls) + ' 次 · 过期丢弃 ' +
      (statsA.dropped + statsB.dropped) + '\n' +
      '[demo] 没有 key 时「模型作答」必然是 0 —— 那是确定性分档在回答，不是故障。\n' +
      '[demo] 耗时 ' + ((Date.now() - startedAt) / 1000).toFixed(1) + 's · 演示节奏 ×' + PACE + '\n' +
      '[demo] 截图故事板：' + SHOT_DIR + '\n',
  );
});
