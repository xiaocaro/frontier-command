import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SaveStore } from '../../electron/persistence';
import { quietEngine } from '../helpers';
import { createWorld } from '../../src/engine/data';
import type { Action, Snapshot } from '../../src/engine/types';
let app: ElectronApplication | undefined;
const temp = () => mkdtempSync(join(tmpdir(), 'frontier-e2e-v9-'));
async function launch(directory: string) {
  app = await electron.launch({
    args: [resolve('.')],
    env: { ...process.env, FRONTIER_USER_DATA: directory, FRONTIER_HEADLESS: '1' },
  });
  const p = await app.firstWindow();
  await p.getByRole('navigation', { name: '主导航' }).waitFor();
  return p;
}
test.afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
});
const state = (page: Page) => page.evaluate(() => window.frontier.getState()).then((x) => x.state);
async function nav(page: Page, name: string) {
  await page
    .getByRole('navigation')
    .getByRole('button', { name: new RegExp(name) })
    .click();
}
async function directive(
  page: Page,
  shipId: string,
  type: Action['type'],
  fields: Record<string, string> = {},
  mode = 'REPLACE',
) {
  await page.locator('.operation-chip[data-ship-id="' + shipId + '"]').click();
  await page.getByRole('button', { name: '新指令 / 改令', exact: true }).click();
  const d = page.getByRole('dialog', { name: 'Admiral 指令' });
  await d.getByLabel('指令类型', { exact: true }).selectOption(type);
  await d.getByLabel('提交模式').selectOption(mode);
  for (const [label, value] of Object.entries(fields)) {
    const field = d.getByLabel(label, { exact: true });
    if (await field.evaluate((el) => el.tagName === 'SELECT')) await field.selectOption(value);
    else await field.fill(value);
  }
  await d.getByRole('button', { name: '下达 Admiral 指令', exact: true }).click();
  await expect(d).not.toBeVisible();
}
async function running(page: Page) {
  await page.getByRole('button', { name: '16×', exact: true }).click();
  if ((await state(page)).paused)
    await page.getByRole('button', { name: '继续', exact: true }).click();
}
async function waitFor(page: Page, predicate: (s: Snapshot) => boolean, timeout = 30000) {
  await expect
    .poll(
      async () => {
        const s = await state(page);
        if (s.paused && s.status === 'active')
          await page.getByRole('button', { name: '继续', exact: true }).click();
        return predicate(s);
      },
      { timeout, intervals: [200] },
    )
    .toBe(true);
}
test('real UI: discoveries, construction cargo, directives, refit, strategic upgrade, shipyard and restart', async () => {
  test.setTimeout(210000);
  const dir = temp(),
    e = quietEngine();
  e.state.resources.credits = 1200;
  e.base.stock.materials = 200;
  new SaveStore(dir).write(e.state);
  let page = await launch(dir);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.context().setOffline(true);
  const count = (await state(page)).systems.length;
  await directive(page, 'verity', 'EXPLORE', { 探索星区: 'sector:0:-1', 调查方式: 'close' });
  await directive(page, 'meridian', 'HAUL', {
    指令目标: 'outpost',
    货运起点: 'base',
    货物种类: 'materials',
    货物数量: '20',
    航线: 'direct',
  });
  await directive(page, 'vigil', 'MOVE', { '坐标 x': '100', '坐标 y': '100' });
  await directive(page, 'vigil', 'DOCK', { 指令目标: 'base' }, 'QUEUE');
  await directive(page, 'vigil', 'MOVE', { '坐标 x': '-180', '坐标 y': '45' }, 'INTERRUPT');
  let s = await state(page);
  expect(s.ships.find((s) => s.id === 'vigil')!.suspended).toHaveLength(1);
  expect(s.ships.find((s) => s.id === 'vigil')!.queue).toHaveLength(1);
  await running(page);
  await waitFor(page, (s) => s.systems.length > count);
  s = await state(page);
  const resource = s.bodies.find(
    (b) => b.kind === 'resource' && b.survey === 2 && b.systemId.startsWith('sector:0:-1'),
  )!;
  await nav(page, 'OPERATIONS');
  await page
    .getByRole('dialog', { name: 'OPERATIONS 工作面板' })
    .getByRole('button')
    .filter({ hasText: resource.name })
    .click();
  await page.getByLabel('设施类型', { exact: true }).selectOption('mine');
  await page.getByLabel('新设施名称').fill('Admiral Mine');
  await page.getByRole('button', { name: '建立现场建设项目', exact: true }).click();
  await nav(page, 'COLONIES');
  await page
    .getByRole('dialog', { name: 'COLONIES 工作面板' })
    .getByRole('button')
    .filter({ hasText: 'Admiral Mine' })
    .click();
  await page.getByRole('button', { name: '安排建设物资 / 分批真实货运', exact: true }).click();
  await waitFor(
    page,
    (s) => s.projects.some((p) => p.name === 'Admiral Mine' && p.complete),
    65000,
  );
  await page.locator('.operation-chip').filter({ hasText: 'VERITY' }).click();
  await page.getByLabel('显示名称').fill('USS NAMED');
  await page.getByRole('button', { name: '保存名称', exact: true }).click();
  expect((await state(page)).ships.find((s) => s.id === 'verity')!.name).toBe('USS NAMED');
  await directive(page, 'meridian', 'DOCK', { 指令目标: 'base' });
  await waitFor(page, (s) => s.ships.find((s) => s.id === 'meridian')!.status === 'docked');
  await nav(page, 'STARBASE');
  await page.getByRole('tab', { name: /^ENGINEERING / }).click();
  await page.getByLabel('基地舰船').selectOption('meridian');
  await page.getByLabel('基地模块').selectOption('expandedCargo');
  await page.getByRole('button', { name: '安装 / 调整模块', exact: true }).click();
  const refit = page.getByRole('dialog', { name: 'Admiral 指令' });
  await expect(refit.getByLabel('指令类型', { exact: true })).toHaveValue('REFIT');
  await expect(refit.getByLabel('分配 meridian', { exact: true })).toBeChecked();
  await refit.getByRole('button', { name: '下达 Admiral 指令', exact: true }).click();
  await expect(refit).not.toBeVisible();
  expect(
    (await state(page)).history.some((h) => h.entityId === 'meridian' && h.text.includes('REFIT')),
  ).toBe(true);
  await waitFor(
    page,
    (s) => s.ships.find((s) => s.id === 'meridian')!.modules.includes('expandedCargo'),
    30000,
  );
  await nav(page, 'STARBASE');
  await page.getByRole('tab', { name: /^LOGISTICS / }).click();
  await page.getByRole('button', { name: '升级 Logistics', exact: true }).click();
  await waitFor(page, (s) => s.upgrades.logistics === 1);
  await page.getByRole('tab', { name: /^SHIPYARD / }).click();
  await page.getByLabel('新舰名称').fill('USS REBUILT');
  await page.getByRole('button', { name: '建造新舰', exact: true }).click();
  await waitFor(page, (s) => s.ships.some((s) => s.name === 'USS REBUILT'));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await nav(page, 'ARCHIVE');
  await page.getByRole('button', { name: '立即保存', exact: true }).click();
  const saved = await state(page);
  await page.screenshot({ path: 'test-results/v9-playable.png', animations: 'disabled' });
  expect(errors).toEqual([]);
  await app!.close();
  app = undefined;
  page = await launch(dir);
  const restored = await state(page);
  expect(restored.ships).toEqual(saved.ships);
  expect(restored.projects).toEqual(saved.projects);
  expect(restored.history).toEqual(saved.history);
  expect(restored.version).toBe(11);
  expect(restored.paused).toBe(true);
  expect('factions' in restored || 'seed' in restored || 'enemies' in restored).toBe(false);
});
test('new contacts pause, acknowledgment and focus preserve pause; illegal directives have no mutations', async () => {
  const dir = temp();
  const world = createWorld();
  // Isolated contact regression: a preexisting Scout enters friendly sensor range.
  const scout = world.enemies.find((s) => s.id === 'orion-scout')!;
  scout.x = -50;
  scout.y = 0;
  new SaveStore(dir).write(world);
  const page = await launch(dir),
    before = await state(page);
  const r = await page.evaluate(() =>
    window.frontier.command({
      type: 'issueDirective',
      shipIds: ['verity'],
      mode: 'REPLACE',
      action: { type: 'SURVEY', targetId: 'hidden', approach: 'close', deep: true },
    }),
  );
  expect(r.ok).toBe(false);
  expect((await state(page)).ships).toEqual(before.ships);
  await directive(page, 'meridian', 'HAUL', {
    指令目标: 'colony',
    货运起点: 'base',
    货物数量: '-5',
  }).catch(() => {});
  const d = page.getByRole('dialog', { name: 'Admiral 指令' });
  await expect(d).toBeVisible();
  await expect(page.getByRole('status')).toContainText('命令格式');
  await d.getByLabel('航线', { exact: true }).selectOption('risky');
  await expect(d).toContainText('exposed corridor');
  await expect(d).toContainText('航段已测绘');
  await page.screenshot({ path: 'test-results/v9-risky-route.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await running(page);
  await expect.poll(async () => (await state(page)).contacts.length).toBeGreaterThan(0);
  expect((await state(page)).paused).toBe(true);
  await page
    .getByRole('dialog', { name: '接触警报' })
    .getByRole('button', { name: '确认 / 保持暂停' })
    .click();
  expect((await state(page)).paused).toBe(true);
  const tick = (await state(page)).tick;
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit('blur'));
  await page.waitForTimeout(300);
  expect((await state(page)).tick).toBe(tick);
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect.poll(async () => (await state(page)).tick).toBeGreaterThan(tick);
});
test('midnight snapshot and permanent ship loss survive restart', async () => {
  const dir = temp(),
    e = quietEngine();
  e.hit(e.state.ships[0], 10000);
  e.finishCritical();
  e.state.tick = 14399;
  e.state.time = 1439.9;
  new SaveStore(dir).write(e.state);
  let page = await launch(dir);
  await running(page);
  await waitFor(page, (s) => s.tick >= 14400);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const daily = JSON.parse(
    readFileSync(join(dir, 'frontiers-v11', 'frontier-000001', 'day-2.json'), 'utf8'),
  );
  expect(daily.tick).toBe(14400);
  expect(daily.losses).toHaveLength(1);
  await app!.close();
  app = undefined;
  page = await launch(dir);
  expect((await state(page)).losses).toHaveLength(1);
  expect((await state(page)).ships).toHaveLength(5);
});
test('failed restoration preserves the terminal engine and frozen branch; successful retry creates a branch', async () => {
  const dir = temp(),
    e = quietEngine(),
    store = new SaveStore(dir);
  store.write(e.state);
  e.state.tick = 14400;
  e.state.time = 1440;
  store.daily(e.state);
  e.state.tick = 28800;
  e.state.time = 2880;
  e.hit(e.base, 10000);
  e.finishCritical();
  store.write(e.state);
  const bytes = readFileSync(join(store.root, 'frontier-000001', 'failure.json'), 'utf8');
  const page = await launch(dir);
  await expect(page.getByRole('dialog', { name: 'COMMAND LOST' })).toBeVisible();
  mkdirSync(store.indexPath + '.tmp');
  await page.getByRole('button', { name: 'RESTORE PREVIOUS DAY', exact: true }).click();
  expect((await state(page)).status).toBe('commandLost');
  expect((await page.evaluate(() => window.frontier.timeline())).activeId).toBe('frontier-000001');
  expect(readFileSync(join(store.root, 'frontier-000001', 'failure.json'), 'utf8')).toBe(bytes);
  // The blocked .tmp directory is a deliberate isolated failure fixture.
  const { rmdirSync } = await import('node:fs');
  rmdirSync(store.indexPath + '.tmp');
  await page.getByRole('button', { name: 'RESTORE PREVIOUS DAY', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'COMMAND LOST' })).not.toBeVisible();
  expect((await state(page)).tick).toBe(14400);
  expect(existsSync(join(store.root, 'frontier-000003', 'head.json'))).toBe(true);
});
