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
 * engine's own promise and memory state, the app staying up) and *shows* everything else. Same stance
 * as `tests/live/vertical-slice.live.ts`.
 *
 * Two acts, two worlds, two recordings. `electron/main.ts` takes a single-instance lock, so act A must
 * be fully closed before act B launches or act B silently never appears.
 */
import { mkdirSync, mkdtempSync } from 'node:fs';
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

/** True when an Agent actually spoke. **False is a result** — it may have chosen to act instead. */
async function waitForReply(page: Page, ms = 60_000) {
  try {
    await expect
      .poll(() => comms(page).innerText(), { timeout: ms, intervals: [300] })
      .toContain('←');
    return true;
  } catch {
    return false;
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
  const a = await launchVisible(fundedWorld(), 'a');
  const page = a.page;
  const explorerName = (await agentByCareer(page, 'explorer')).name;

  await narrate(page, 'ACT A · 准备', '世界已建；基地里预置了预算与一枚特殊发现（改装需要它）· 演示节奏 ×' + PACE);
  await expect
    .poll(() => a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
    .toBe(true);

  await narrate(page, '第 1 步 · Admiral 发布任务', '展开 AGENT CHANNEL，选中 Explorer，发送任务命令');
  await panel(page).locator('> summary').click();
  await expect(page.locator('.agent-row')).toHaveCount(4);
  await pause(page, 900);
  await selectAgent(page, EXPLORER);
  await speak(page, 'command', '穿越虫洞，寻找失联探测船，确认发生了什么。');
  await pause(page, 1200);

  await narrate(page, '第 2 步 · Agent 自主评估', '继续时间，等它决策');
  await page.getByRole('button', { name: '继续', exact: true }).click();
  const spoke = await waitForReply(page);
  await narrate(
    page,
    '第 2 步 · 结果',
    spoke
      ? '通信栏出现了「' + explorerName + '」的答复'
      : '「' + explorerName + '」没有回话——模型很可能选择了直接行动，这也是一个结果',
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
  await waitForReply(page);
  await pause(page, 2000);
  const pathA = { trust: (await agentByCareer(page, 'explorer')).state.trustInAdmiral, said: await lastReply(page) };

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
  await p2.locator('.agent-channel').getByLabel('类型').selectOption('command');
  await p2.locator('.agent-channel').getByLabel('发往 Agent 的消息').fill('又出现一个高风险调查机会，你去不去？');
  await p2.locator('.agent-channel').getByRole('button', { name: '发送', exact: true }).click();
  await waitForReply(p2);
  await p2.waitForTimeout(2200);
  const pathB = { trust: (await agentByCareer(p2, 'explorer')).state.trustInAdmiral, said: await lastReply(p2) };

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
