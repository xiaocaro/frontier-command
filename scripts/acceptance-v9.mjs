import { _electron as electron, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { createWorld } = require('../dist-electron/src/engine/data.js');
const { SaveStore } = require('../dist-electron/electron/persistence.js');
const seed = Number(process.argv[2] ?? 236807),
  directory = mkdtempSync(join(tmpdir(), 'frontier-v10-acceptance-'));
const output = resolve('docs/verification/v10');
mkdirSync(output, { recursive: true });
new SaveStore(directory).write(createWorld(seed));
const app = await electron.launch({
  args: [resolve('.')],
  env: { ...process.env, FRONTIER_USER_DATA: directory, FRONTIER_HEADLESS: '0' },
});
const page = await app.firstWindow(),
  steps = [],
  errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const state = async () => (await page.evaluate(() => window.frontier.getState())).state;
async function wait(predicate, label, timeout = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const s = await state();
    assert.equal(s.status, 'active');
    if (predicate(s)) return s;
    if (s.paused) {
      const alert = page.getByRole('dialog', { name: '接触警报' });
      if (
        s.pauseReasons.some(
          (r) =>
            r.kind === 'newContact' &&
            s.communications.some((c) => !c.read && c.entityId === r.entityId && c.time === r.time),
        )
      ) {
        await expect(alert).toBeVisible();
        await alert.getByRole('button', { name: '确认 / 保持暂停', exact: true }).click();
        await expect(alert).not.toBeVisible();
      }
      await page.getByRole('button', { name: '继续', exact: true }).click();
    }
    await page.waitForTimeout(150);
  }
  throw Error('Timeout: ' + label);
}
async function action(ship, type, fields = {}) {
  await page.locator(`.operation-chip[data-ship-id="${ship}"]`).click();
  await page.getByRole('button', { name: '新指令 / 改令', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Admiral 指令' });
  await dialog.getByLabel('指令类型', { exact: true }).selectOption(type);
  for (const [label, value] of Object.entries(fields)) {
    const field = dialog.getByLabel(label, { exact: true });
    if (await field.evaluate((el) => el.tagName === 'SELECT')) await field.selectOption(value);
    else await field.fill(value);
  }
  await dialog.getByRole('button', { name: '下达 Admiral 指令', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
}
async function capture(name) {
  const s = await state();
  steps.push({
    name,
    time: s.time,
    version: s.version,
    ships: s.ships.map((s) => ({
      id: s.id,
      x: s.x,
      y: s.y,
      cloak: s.cloak,
      current: s.current?.action,
    })),
    knownEnemyLocations: s.locations.filter((l) => l.owner !== 'starfleet'),
  });
  await page.screenshot({ path: join(output, `${seed}-${name}.png`), animations: 'disabled' });
  console.log('PASS ' + name + ' at ' + s.time + ' game minutes');
}
try {
  await page.locator('nav[aria-label="主导航"]').waitFor({ state: 'attached' });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1920, 1200),
  );
  await page.context().setOffline(true);
  await page.evaluate(() => document.fonts.ready);
  const initial = await state();
  assert.equal(initial.version, 10);
  assert.equal(initial.ships.length, 6);
  assert.equal(initial.locations.find((l) => l.id === 'mine').capacity.materials, 3000);
  await capture('start');
  await action('vigil', 'MOVE', { '坐标 x': '-180', '坐标 y': '-120' });
  await page.getByRole('button', { name: '16×', exact: true }).click();
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await wait((s) => !s.ships.find((s) => s.id === 'vigil').current, 'MOVE');
  const idle = await state(),
    ship = idle.ships.find((s) => s.id === 'vigil');
  await wait((s) => s.time >= idle.time + 60, 'one hour idle');
  const after = (await state()).ships.find((s) => s.id === 'vigil');
  assert.deepEqual({ x: after.x, y: after.y }, { x: ship.x, y: ship.y });
  assert.equal(after.current, null);
  await capture('idle');
  await action('verity', 'TRANSIT', { 指令目标: 'wormhole:0:0' });
  await wait((s) => !s.ships.find((s) => s.id === 'verity').current, 'passage');
  await action('verity', 'SURVEY', { 指令目标: 'veil-derelict', 调查方式: 'close' });
  await wait((s) => s.events.some((v) => v.subjectId === 'veil-derelict'), 'survey');
  const event = (await state()).events.find((v) => v.subjectId === 'veil-derelict');
  await action('verity', 'ASSIST_EVENT', { 指令目标: event.id });
  await wait((s) => s.ships.some((s) => s.id === 'veil'), 'recovery');
  await page.locator('.operation-chip[data-ship-id="veil"]').click();
  await page.getByRole('button', { name: '切换隐形' }).click();
  await capture('veil');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.evaluate(() => window.frontier.save());
  assert.deepEqual(errors, []);
  writeFileSync(
    join(output, `acceptance-${seed}.json`),
    JSON.stringify(
      { seed, version: 10, complete: true, isolatedUserData: directory, steps, errors },
      null,
      2,
    ),
  );
  console.log(
    'PASS: normal persistent world, real visible Electron UI, idle, fixed passage, unique recovery and offline fonts.',
  );
} catch (error) {
  await capture('failure').catch(() => {});
  throw error;
} finally {
  await app.close();
}
