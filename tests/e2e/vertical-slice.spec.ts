/**
 * P3 vertical slice, end to end in the real application (playbook Prompt 7 §三十一).
 *
 * `tests/agent/vertical-slice.test.ts` proves the loop in-process against the real `AgentHost`. This
 * proves the same loop through the shipped app: a real Electron main process, a real window, the real
 * IPC surface, and the real provider client — pointed at a local stub so the far end is the only
 * thing that is fake (`tests/e2e/agent-stub.ts`).
 *
 * The world is **seeded through the real `SaveStore` before launch**, which is what lets the spec
 * know the Agent ids: the renderer's `Snapshot` deliberately does not carry the roster (it is frozen,
 * and `tests/recon.test.ts` guards the crop), so a spec cannot look them up from the UI. Seeding also
 * means the fleet is one this process built, not whatever the default world happens to contain.
 *
 * What it does **not** assert is that the model chose a particular answer. LLM behaviour is not a
 * stable test input (playbook §三十二), so the claims are: a *valid* decision was produced, it became
 * a real game state change the player can see, and the app stayed up. Roster-level assertions
 * (`trustInAdmiral`, memories, promises) live in the Vitest slice, where they are deterministic.
 *
 * No new IPC channel: the offer goes through the existing `world:command`, and the reply arrives in
 * the existing Communications panel (`N-6`). The Agent channel also now shows the correspondence —
 * the trigger and the answer, newest first — which is read through the existing `agents:get` crop.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { SaveStore } from '../../electron/persistence';
import { createWorld } from '../../src/engine/data';
import { startAgentStub, type AgentStub } from './agent-stub';

let app: ElectronApplication | undefined;
let stub: AgentStub | undefined;

test.afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
  await stub?.close();
  stub = undefined;
});

const state = (page: Page) => page.evaluate(() => window.frontier.getState()).then((x) => x.state);

/**
 * `readHoldMs` is the in-game pause after an Agent answers the Admiral (`electron/read-hold.ts`).
 * The default is 0 for the same reason the other specs set it: a freeze an Agent can trigger at any
 * moment would make a wall-clock assertion flaky for reasons the test is not about. Only the test
 * that is *about* the hold asks for a real one.
 */
async function launch(readHoldMs = '0') {
  stub = await startAgentStub();
  const directory = mkdtempSync(join(tmpdir(), 'frontier-e2e-p3-'));
  const world = createWorld(236807);
  world.enemies = []; // a quiet frontier, so nothing shoots the slice to pieces
  new SaveStore(directory).write(world);

  app = await electron.launch({
    args: [resolve('.')],
    env: {
      ...process.env,
      FRONTIER_USER_DATA: directory,
      FRONTIER_HEADLESS: '1',
      FRONTIER_READ_HOLD_MS: readHoldMs,
      // The real provider client, aimed at the stub. Overriding the key matters: an ambient
      // DEEPSEEK_API_KEY would otherwise send this run to the live API, and `setOffline` cannot
      // prevent that because the fetch happens in the main process.
      DEEPSEEK_API_KEY: 'e2e-stub',
      DEEPSEEK_BASE_URL: stub.baseUrl,
      DEEPSEEK_MAX_RETRIES: '0',
    },
  });
  const page = await app.firstWindow();
  await page.getByRole('navigation', { name: '主导航' }).waitFor();
  const explorer = world.agents.find((agent) => agent.career === 'explorer');
  if (!explorer) throw new Error('起始世界里没有 explorer');
  return { page, explorerId: explorer.id };
}

/** Un-pause and run fast, then poll. The world loads paused, so the scheduler is silent until then. */
async function runUntil(page: Page, predicate: () => Promise<boolean>, timeout = 60_000) {
  await page.getByRole('button', { name: '16×', exact: true }).click();
  await expect
    .poll(
      async () => {
        const snapshot = await state(page);
        if (snapshot.paused && snapshot.status === 'active')
          await page.getByRole('button', { name: '继续', exact: true }).click();
        return predicate();
      },
      { timeout, intervals: [250] },
    )
    .toBe(true);
}

test('the Admiral offers a mission and the Agent answers it, in the real app', async () => {
  test.setTimeout(180_000);
  const { page, explorerId } = await launch();

  expect((await state(page)).version).toBe(11);

  const offered = await page.evaluate(
    (to) =>
      window.frontier.command({
        type: 'agentMessage',
        from: 'admiral',
        to,
        kind: 'command',
        text: '穿越虫洞，寻找失联探测船。',
        payload: null,
      }),
    explorerId,
  );
  expect(offered.ok).toBe(true);

  // The offer reaches the player through the existing Communications panel — the `N-6` mirror.
  await expect(page.locator('.comms-item').first()).toBeVisible();

  // The Agent answers. `←` is the mirror format for a line spoken *by* an Agent; `→` is the Admiral's.
  await runUntil(page, async () => {
    const text = await page.locator('.communications').innerText();
    return text.includes('←');
  });

  // The provider path really ran inside Electron: an ordinary request went to the ordinary client.
  expect(stub!.prompts.length).toBeGreaterThan(0);
  expect(await page.locator('.communications').innerText()).toContain('←');

  // The panel shows the same conversation, **newest first** — which is the whole reason for the
  // ordering: the answer is a later message than the offer, so reversing chronology puts it above
  // the message it answers. `←` is the Agent speaking, `→` the Admiral.
  await page.locator('.agent-channel > summary').click();
  const thread = page.locator('.agent-thread .agent-line');
  await expect(thread.first()).toContainText('←');
  await expect(thread.nth(1)).toContainText('→');

  // And the app is still a working game afterwards.
  const after = await state(page);
  expect(after.status).toBe('active');
  expect(after.tick).toBeGreaterThan(0);
});

test('an Agent answering the Admiral holds the world for a moment, then lets it go', async () => {
  // The read hold (`electron/read-hold.ts`). It is the project's only automatic resume, so what is
  // worth asserting end to end is that it *lands* — through the real main process, on a real reply —
  // and that it is released rather than leaving the game paused forever.
  test.setTimeout(180_000);
  const { page, explorerId } = await launch('4000');

  await page.evaluate(
    (to) =>
      window.frontier.command({
        type: 'agentMessage',
        from: 'admiral',
        to,
        kind: 'command',
        text: '穿越虫洞，寻找失联探测船。',
        payload: null,
      }),
    explorerId,
  );
  // A loaded world starts paused, so the scheduler is silent until this.
  await page.getByRole('button', { name: '16×', exact: true }).click();
  await page.getByRole('button', { name: '继续', exact: true }).click();

  // The hold is applied without a reason, deliberately: a `pauseReason` would raise the PRIORITY HOLD
  // banner, which asks the player to act. So the assertion is on `paused` alone.
  await expect
    .poll(async () => (await state(page)).paused, { timeout: 90_000, intervals: [100] })
    .toBe(true);

  // …and released on its own, with no banner and no click: the world is running again and nothing is
  // waiting on the player.
  await expect
    .poll(async () => (await state(page)).paused, { timeout: 30_000, intervals: [200] })
    .toBe(false);
  const after = await state(page);
  expect(after.status).toBe('active');
  expect(after.pauseReasons).toHaveLength(0);
});

test('the Agent channel shows the roster, and a message sent from it reaches the engine', async () => {
  // Until this panel existed, none of the above could be done by a human: nothing in the console could
  // speak to an Agent, and no Agent state reached the renderer. This is the check that the door is
  // real — the roster renders through `agents:get`, and the composer's send lands in the same place
  // the harness's does.
  test.setTimeout(120_000);
  const { page } = await launch();

  await page.locator('.agent-channel > summary').click();

  // The roster: four Agents, with the numbers the MVP asks the player to watch.
  await expect(page.locator('.agent-row')).toHaveCount(4);
  await expect(page.locator('.agent-row').first()).toContainText('信任');
  // Memory tags only — the crop withholds text on purpose (`KNOWN_ISSUES.md` N-7).
  await expect(page.locator('.agent-channel')).not.toContainText('我完成了');

  // C-36: the loop's own tally has to be visible. A decision dropped for staleness writes one `info`
  // line into the world log and **nothing renders that log** — so the model could be entirely off while
  // the game looked normal. That is the whole point of surfacing it.
  await expect(page.locator('.agent-loop')).toContainText('本局决策');
  // The two numbers are deliberately separate words in the panel: `decisions` counts what the
  // scheduler drained, `modelCalls` counts the ones the model actually answered (`C-36`).
  await expect(page.locator('.agent-loop')).toContainText('由模型作答');

  // The prefix belongs to the sentence the box holds: it is there while there is text, and it leaves
  // when the text does. (The box starts pre-filled, which is why this asserts presence rather than
  // absence first.)
  await page.locator('.agent-channel .agent-compose input').fill('穿越虫洞，寻找失联探测船。');
  // Built from the same names the engine uses when it mirrors the line into the feed — so what you
  // read above the box is what appears in it.
  await expect(page.locator('.agent-channel .agent-prefix')).toContainText('→');
  await expect(page.locator('.agent-channel .agent-prefix')).toContainText('LYRA VOSS');
  // Empty it without sending: the prefix goes with the text, on its own.
  await page.locator('.agent-channel .agent-compose input').fill('');
  await expect(page.locator('.agent-channel .agent-prefix')).toHaveCount(0);
  await page.locator('.agent-channel .agent-compose input').fill('穿越虫洞，寻找失联探测船。');

  await page.locator('.agent-channel').getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.agent-channel')).toContainText('已发出');

  // …and it really reached the engine: the offer is mirrored into the normal Communications feed.
  await expect(page.locator('.communications')).toContainText('→');

  // Exactly one line is highlighted as the newest, and it is the one that just arrived. Derived from
  // the message ids on every render, so the previous line reverts by itself — which is why there is
  // no "previous latest" to assert against, only the count.
  await expect(page.locator('.comms-item.is-latest')).toHaveCount(1);
  await expect(page.locator('.comms-item.is-latest')).toContainText('→');

  // The box empties on a successful send, so the next message starts from nothing — and the prefix
  // goes with it, rather than sitting there labelling an empty box.
  await expect(page.locator('.agent-channel .agent-compose input')).toHaveValue('');
  await expect(page.locator('.agent-channel .agent-prefix')).toHaveCount(0);

  // …because the message did not vanish, it moved here. The transcript is the panel's own record of
  // the correspondence, so what was sent is still readable after the box let it go — and it arrives
  // without pressing 刷新, because the panel re-reads when the feed it mirrors into grows.
  await expect(page.locator('.agent-thread .agent-line.is-sent').first()).toContainText(
    '穿越虫洞，寻找失联探测船。',
  );
  await expect(page.locator('.agent-thread .agent-line.is-sent').first()).toContainText('→');

  // The promise button is the two-command path (create, then notify). It must not fail silently.
  await page.locator('.agent-channel').getByRole('button', { name: '承诺 Deep Scan 优先权限' }).click();
  await expect(page.locator('.agent-channel')).toContainText('承诺已创建');

  // The highlight has to be **visible**, not merely present: a class whose CSS rule does not match is a
  // silent no-op, and `is-latest` is easy to get right in the markup and wrong in the stylesheet. Two
  // rows now exist, so compare the newest against an older one — colour and size must both differ.
  const computed = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((node) => {
        const style = getComputedStyle(node);
        return style.color + '|' + style.fontSize;
      });
  expect(await computed('.comms-item.is-latest .comms-content')).not.toBe(
    await computed('.comms-item:not(.is-latest) .comms-content'),
  );
});
