import { _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const executablePath =
  process.env.FRONTIER_EXECUTABLE || resolve('release/win-unpacked/Frontier Command.exe');
const userData = mkdtempSync(join(tmpdir(), 'frontier-packaged-v9-'));
const launch = () =>
  electron.launch({
    executablePath,
    args: [],
    env: { ...process.env, FRONTIER_USER_DATA: userData, FRONTIER_HEADLESS: '1' },
  });
let app;
try {
  app = await launch();
  let page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForSelector('.admiral-console');
  assert.equal(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
    false,
  );
  await page.context().setOffline(true);
  const initial = (await page.evaluate(() => window.frontier.getState())).state;
  assert.equal(initial.version, 11);
  assert.equal(initial.ships.length, 6);
  assert.equal(initial.contacts.length, 0);
  const result = await page.evaluate(() =>
    window.frontier.command({
      type: 'issueDirective',
      shipIds: ['meridian'],
      mode: 'REPLACE',
      action: {
        type: 'HAUL',
        sourceId: 'base',
        targetId: 'colony',
        cargoKind: 'materials',
        amount: 20,
        route: 'safe',
        repeat: false,
      },
    }),
  );
  assert.equal(result.ok, true);
  await page.evaluate(() => window.frontier.command({ type: 'pause', paused: false }));
  await new Promise((resolve) => setTimeout(resolve, 1400));
  await page.evaluate(() => window.frontier.command({ type: 'pause', paused: true }));
  const saved = (await page.evaluate(() => window.frontier.getState())).state;
  assert.ok(saved.time > 0);
  assert.equal(saved.ships.filter((s) => s.current).length, 1);
  assert.equal((await page.evaluate(() => window.frontier.save())).ok, true);
  assert.deepEqual(errors, []);
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await page.waitForSelector('.admiral-console');
  const restored = (await page.evaluate(() => window.frontier.getState())).state;
  assert.equal(restored.paused, true);
  assert.equal(restored.time, saved.time);
  assert.deepEqual(restored.ships, saved.ships);
  console.log(
    'PASS: v9 packaged EXE, hidden window, offline directive, fixed-step simulation, save and restart.',
  );
} finally {
  if (app) await app.close().catch(() => {});
}
