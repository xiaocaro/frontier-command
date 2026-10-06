import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SaveStore } from '../../electron/persistence';
import { quietEngine, issue } from '../helpers';
import { createEvent } from '../../src/engine/world-events';
import type { WorldState } from '../../src/engine/types';

let app: ElectronApplication | undefined;
const output = resolve('docs/verification/mine-accidents');
const state = async (p: Page) => (await p.evaluate(() => window.frontier.getState())).state;
async function launch(world: WorldState) {
  const directory = mkdtempSync(join(tmpdir(), 'frontier-mine-repair-'));
  new SaveStore(directory).write(world);
  app = await electron.launch({
    args: [resolve('.')],
    env: { ...process.env, FRONTIER_USER_DATA: directory, FRONTIER_HEADLESS: '1' },
  });
  const p = await app.firstWindow();
  await p.getByRole('navigation', { name: '主导航' }).waitFor();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1920, 1200),
  );
  await p.context().setOffline(true);
  await p.evaluate(() => {
    const key = 'frontier.lcars.console.v2';
    const preferences = JSON.parse(localStorage.getItem(key) ?? '{}');
    localStorage.setItem(key, JSON.stringify({ ...preferences, version: 2, animations: 'off' }));
  });
  await p.reload();
  await p.getByRole('navigation', { name: '主导航' }).waitFor();
  await p.evaluate(() => document.fonts.ready);
  mkdirSync(output, { recursive: true });
  return p;
}
test.afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
});

test('old blocked mine exposes repair shortage, prefilled real freight, and restored production in Electron', async () => {
  const e = quietEngine();
  const mine = e.state.locations.find((l) => l.id === 'mine')!;
  const site = e.state.bodies.find((b) => b.id === mine.siteId)!;
  site.hazard = 0;
  mine.stock.materials = 0;
  const ship = e.state.ships.find((s) => s.id === 'verity')!;
  ship.x = mine.x;
  ship.y = mine.y;
  ship.cargo.materials = 0;
  const event = createEvent(e, 'accident', mine.id, '累计开采暴露超出安全阈值，设备停工');
  issue(e, { type: 'ASSIST_EVENT', targetId: event.id }, ship.id);
  event.work = 91;
  event.deadline = 0;
  event.stage = 'responding';
  ship.current!.work = 91;
  const ore = site.remaining;
  const baseMaterials = e.base.stock.materials;
  const p = await launch(e.state);
  await p.locator('.strategic-map [data-entity-id="mine"]').click();
  const inspector = p.getByRole('complementary', { name: '对象详情' });
  await expect(inspector).toContainText('事故停工：等待设备修复');
  await expect(inspector.getByLabel('矿场事故响应状态')).toContainText('等待维修材料');
  await expect(inspector.getByLabel('矿场事故响应状态')).toContainText('20/20');
  await expect(inspector.getByLabel('矿场事故响应状态')).toContainText('还缺 5 材料');
  await expect(inspector).not.toContainText('响应期限');
  await p.screenshot({ path: join(output, 'blocked-mine.png') });

  await p
    .getByRole('navigation')
    .getByRole('button', { name: /OPERATIONS/ })
    .click();
  const row = p.locator('.record-row[data-entity-id="' + event.id + '"]');
  await expect(row).toContainText('修复前持续停工');
  await expect(row).not.toContainText('响应期限');
  await row.getByRole('button', { name: '运送维修材料到矿场', exact: true }).click();
  const dialog = p.getByRole('dialog', { name: 'Admiral 指令' });
  await expect(dialog.getByLabel('指令类型', { exact: true })).toHaveValue('HAUL');
  await expect(dialog.getByLabel('货运起点', { exact: true })).toHaveValue('base');
  await expect(dialog.getByLabel('指令目标', { exact: true })).toHaveValue(mine.id);
  await expect(dialog.getByLabel('货物种类', { exact: true })).toHaveValue('materials');
  await expect(dialog.getByLabel('货物数量', { exact: true })).toHaveValue('5');
  await expect(dialog.getByLabel('循环货运', { exact: true })).not.toBeChecked();
  // The supply entry opens a composer; it has not issued or replaced any directive.
  expect((await state(p)).ships.find((s) => s.id === ship.id)!.current!.action.type).toBe(
    'ASSIST_EVENT',
  );
  for (const vessel of e.state.ships) {
    await dialog
      .getByLabel('分配 ' + vessel.id, { exact: true })
      .setChecked(vessel.id === 'meridian');
  }
  await p.screenshot({ path: join(output, 'supply-composer.png') });
  await dialog.getByRole('button', { name: '下达 Admiral 指令', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await p.getByRole('button', { name: '16×', exact: true }).click();
  await p.getByRole('button', { name: '继续', exact: true }).click();
  await expect
    .poll(async () => (await state(p)).events.find((v) => v.id === event.id)!.stage, {
      timeout: 45000,
      intervals: [100],
    })
    .toBe('resolved');
  await expect
    .poll(async () => (await state(p)).bodies.find((b) => b.id === site.id)!.remaining, {
      timeout: 10000,
      intervals: [100],
    })
    .toBeLessThan(ore);
  if (!(await state(p)).paused) await p.getByRole('button', { name: '暂停', exact: true }).click();
  expect((await state(p)).baseResources.stock.materials).toBe(baseMaterials - 5);
  expect((await state(p)).events.find((v) => v.id === event.id)!.work).toBe(20);
  await p
    .getByRole('navigation')
    .getByRole('button', { name: /SECTOR/ })
    .click();
  await p.locator('.strategic-map [data-entity-id="mine"]').click();
  await expect(inspector).toContainText('实际仓储 / 运行中');
  await expect(inspector.getByLabel('矿场事故响应状态')).toHaveCount(0);
  await p.screenshot({ path: join(output, 'restored-mine.png') });
});

test('onsite responder cargo repairs without remote inventory and renders travelling and working states', async () => {
  const e = quietEngine();
  const mine = e.state.locations.find((l) => l.id === 'mine')!;
  const site = e.state.bodies.find((b) => b.id === mine.siteId)!;
  site.hazard = 0;
  mine.stock.materials = 0;
  const ship = e.state.ships.find((s) => s.id === 'verity')!;
  ship.x = mine.x + 100;
  ship.y = mine.y;
  ship.cargo.materials = 5;
  const event = createEvent(e, 'accident', mine.id, '设备停工');
  issue(e, { type: 'ASSIST_EVENT', targetId: event.id }, ship.id);
  const baseStock = structuredClone(e.base.stock);
  const p = await launch(e.state);
  await p.locator('.strategic-map [data-entity-id="mine"]').click();
  const status = p.getByRole('complementary', { name: '对象详情' }).getByLabel('矿场事故响应状态');
  await expect(status).toContainText('航行中');
  await expect(status).toContainText('舰上材料抵达后可用');
  await p.getByRole('button', { name: '继续', exact: true }).click();
  await expect(status).toContainText('现场施工', { timeout: 15000 });
  await expect
    .poll(async () => (await state(p)).events.find((v) => v.id === event.id)!.stage, {
      timeout: 30000,
      intervals: [100],
    })
    .toBe('resolved');
  expect((await state(p)).ships.find((s) => s.id === ship.id)!.cargo.materials).toBe(0);
  expect((await state(p)).baseResources.stock).toEqual(baseStock);
});
