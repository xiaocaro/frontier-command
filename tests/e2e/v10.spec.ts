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
import { quietEngine } from '../helpers';
import { materialize } from '../../src/engine/world-generation';
import { pairedSector } from '../../src/engine/wormhole-pairs';
import { createEvent } from '../../src/engine/world-events';
import type { WorldState, Action, Snapshot } from '../../src/engine/types';

let app: ElectronApplication | undefined;
const output = resolve('docs/verification/v10');
async function launch(world: WorldState, textScale = 1) {
  mkdirSync(output, { recursive: true });
  const directory = mkdtempSync(join(tmpdir(), 'frontier-v10-ui-'));
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
  await p.evaluate((scale) => {
    const key = 'frontier.lcars.console.v2';
    const existing = JSON.parse(localStorage.getItem(key) ?? '{}');
    localStorage.setItem(
      key,
      JSON.stringify({ ...existing, version: 2, textScale: scale, animations: 'off' }),
    );
  }, textScale);
  await p.reload();
  await p.getByRole('navigation', { name: '主导航' }).waitFor();
  await p.evaluate(() => document.fonts.ready);
  return p;
}
test.afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
});
const state = async (p: Page) => (await p.evaluate(() => window.frontier.getState())).state;
const wait = async (p: Page, predicate: (w: Snapshot) => boolean) =>
  expect
    .poll(async () => predicate(await state(p)), { timeout: 45000, intervals: [100] })
    .toBe(true);
async function run(p: Page) {
  await p.getByRole('button', { name: '16×', exact: true }).click();
  if ((await state(p)).paused) await p.getByRole('button', { name: '继续', exact: true }).click();
}
async function pause(p: Page) {
  if (!(await state(p)).paused) await p.getByRole('button', { name: '暂停', exact: true }).click();
}
async function directive(
  p: Page,
  id: string,
  type: Action['type'],
  fields: Record<string, string>,
) {
  await p.locator('.operation-chip[data-ship-id="' + id + '"]').click();
  await p.getByRole('button', { name: '新指令 / 改令', exact: true }).click();
  const d = p.getByRole('dialog', { name: 'Admiral 指令' });
  await d.getByLabel('指令类型', { exact: true }).selectOption(type);
  for (const [label, value] of Object.entries(fields)) {
    const field = d.getByLabel(label, { exact: true });
    if (await field.evaluate((el) => el.tagName === 'SELECT')) await field.selectOption(value);
    else await field.fill(value);
  }
  await d.getByRole('button', { name: '下达 Admiral 指令', exact: true }).click();
  await expect(d).not.toBeVisible();
}
async function starbase(p: Page, tab: string) {
  await p
    .getByRole('navigation')
    .getByRole('button', { name: /STARBASE/ })
    .click();
  await p.getByRole('tab', { name: new RegExp(tab) }).click();
}
async function closeBase(p: Page) {
  await p.getByRole('button', { name: '关闭管理面板', exact: true }).click();
}

test('Chinese inspector, grouped colony meters, custom names and rearm stock at larger text', async () => {
  const e = quietEngine();
  e.base.stock.materials = 70.5;
  e.dispatchCommand({ type: 'renameEntity', entityId: 'horizon', name: 'My Ship / 自定义' });
  e.state.locations.find((l) => l.id === 'orion-base')!.discovered = true;
  const wormhole = e.state.wormholes.find((h) => h.id === 'wormhole:0:0')!;
  const event = createEvent(e, 'wormhole', wormhole.id, 'Wormhole 调查需要 Commander 响应');
  const p = await launch(e.state, 1.15);
  await expect(p.locator('[data-resource="materials"] b')).toHaveText('70.5');
  await p.locator('.strategic-map [data-entity-id="colony"]').click();
  const sidebar = p.getByRole('complementary', { name: '对象详情' });
  await expect(sidebar.getByRole('progressbar', { name: '人口／住宅', exact: true })).toBeVisible();
  expect(await sidebar.locator('.facility-metrics progress').count()).toBe(9);
  expect(await sidebar.innerText()).not.toMatch(/[A-Za-z]{2,}/);
  await p.screenshot({ path: join(output, 'colony-chinese.png') });
  for (const id of ['mine', 'orion-base', 'wormhole:0:0']) {
    await p.locator('.strategic-map [data-entity-id="' + id + '"]').click();
    expect(await sidebar.innerText()).not.toMatch(/[A-Za-z]{2,}/);
  }
  await sidebar.getByRole('button', { name: '调查 虫洞', exact: true }).click();
  await expect(sidebar).toContainText('虫洞 调查');
  expect(await sidebar.innerText()).not.toMatch(/[A-Za-z]{2,}/);
  expect((await state(p)).events.some((v) => v.id === event.id)).toBe(true);
  await p.locator('.operation-chip[data-ship-id="horizon"]').click();
  await expect(sidebar).toContainText('My Ship / 自定义');
  await sidebar.getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(p.getByRole('button', { name: '关闭通知', exact: true })).toHaveText('关闭');
  await sidebar.getByRole('button', { name: '补充弹药', exact: true }).click();
  const dialog = p.getByRole('dialog', { name: 'Admiral 指令' });
  await expect(dialog.getByLabel('装弹容量与库存')).toContainText('剩余弹仓 214');
  await expect(dialog.getByLabel('装弹容量与库存')).toContainText('基地库存 90');
  await dialog.getByRole('button', { name: '装满可用余量', exact: true }).click();
  await expect(dialog.getByLabel('装载 photon', { exact: true })).toHaveValue('90');
  await expect(dialog.getByLabel('装载 quantum', { exact: true })).toHaveValue('20');
  await p.screenshot({ path: join(output, 'rearm-capacity.png') });
  await dialog.getByLabel('装载 photon', { exact: true }).fill('215');
  await expect(
    dialog.getByRole('button', { name: '下达 Admiral 指令', exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByRole('status')).toContainText('超出弹仓余量');
});

test('actual survey enables visible permanent half-price ship and ammunition production', async () => {
  const e = quietEngine();
  e.state.resources.credits = 5000;
  e.base.stock.materials = 1000;
  e.state.upgrades.shipyard = 1;
  const body = {
    ...e.state.bodies[0],
    id: 'discount-ui-anomaly',
    name: '特殊研究点',
    kind: 'anomaly' as const,
    hidden: false,
    specialClaimed: false,
    hazard: 0,
    discovered: true,
  };
  e.state.bodies.push(body);
  e.state.systems.find((s) => s.id === body.systemId)!.bodyIds.push(body.id);
  const ship = e.state.ships[2];
  ship.x = body.x;
  ship.y = body.y;
  const p = await launch(e.state);
  await directive(p, ship.id, 'SURVEY', { 指令目标: body.id, 调查方式: 'close' });
  await run(p);
  await wait(p, (w) => w.production.discounted);
  await pause(p);
  await starbase(p, 'SHIPYARD');
  await p.getByLabel('建造舰级').selectOption('galaxy');
  await expect(p.getByLabel('生产费用')).toContainText('实付 430 预算／50 材料');
  await p.getByLabel('新舰名称').fill('折扣银河号');
  const before = (await state(p)).baseResources.stock.materials;
  await p.getByRole('button', { name: '建造新舰', exact: true }).click();
  expect((await state(p)).baseResources.stock.materials).toBe(before - 50);
  await p.getByRole('tab', { name: /ARMORY/ }).click();
  await p.getByLabel('制造资源').selectOption('quantum');
  await p.getByLabel('工业数量').fill('3');
  await expect(p.getByLabel('生产费用')).toContainText('实付 12 预算／3 材料');
  await p.screenshot({ path: join(output, 'discount-production.png') });
  await p.getByRole('button', { name: '开始实物制造', exact: true }).click();
  await closeBase(p);
  await run(p);
  await wait(p, (w) => w.ships.some((s) => s.name === '折扣银河号'));
  const built = (await state(p)).ships.find((s) => s.name === '折扣银河号')!;
  expect([built.photon, built.quantum]).toEqual([0, 0]);
  expect((await state(p)).baseResources.stock.quantum).toBe(23);
});

test('ruined enemy base is captured, supplied, rebuilt and used for local production and service', async () => {
  test.setTimeout(90000);
  const e = quietEngine();
  e.state.resources.credits = 8000;
  e.base.stock.materials = 1000;
  const l = e.state.locations.find((l) => l.id === 'orion-base')!;
  l.discovered = true;
  e.hit(l, l.hull + l.shield + 1);
  const ship = e.state.ships[2];
  ship.x = l.x;
  ship.y = l.y;
  ship.hull -= 10;
  ship.photon = 0;
  const p = await launch(e.state);
  await directive(p, ship.id, 'CAPTURE', { 指令目标: l.id });
  await run(p);
  await wait(p, (w) => w.locations.some((x) => x.id === l.id && x.occupation === 'secured'));
  await pause(p);
  await p.locator('.strategic-map [data-entity-id="' + l.id + '"]').click();
  await p.getByRole('button', { name: '建立基地改建项目', exact: true }).click();
  const project = (await state(p)).projects.find((x) => x.refitLocationId === l.id)!;
  await directive(p, 'meridian', 'HAUL', {
    货运起点: 'base',
    指令目标: project.id,
    货物数量: '150',
  });
  await run(p);
  await wait(p, (w) =>
    w.locations.some((x) => x.id === l.id && x.kind === 'base' && !x.occupation),
  );
  await pause(p);
  await starbase(p, 'ARMORY');
  await p.getByLabel('管理基地').selectOption(l.id);
  await p.getByLabel('制造资源').selectOption('photon');
  await p.getByLabel('工业数量').fill('5');
  await p.getByRole('button', { name: '开始实物制造', exact: true }).click();
  await p.getByRole('tab', { name: /SHIPYARD/ }).click();
  await p.getByLabel('建造舰级').selectOption('peregrine');
  await p.getByLabel('新舰名称').fill('前进巡逻号');
  await p.getByRole('button', { name: '建造新舰', exact: true }).click();
  await p.screenshot({ path: join(output, 'captured-base.png') });
  await closeBase(p);
  await run(p);
  await wait(p, (w) => w.ships.some((s) => s.name === '前进巡逻号'));
  await pause(p);
  const w = await state(p),
    base = w.locations.find((x) => x.id === l.id)!;
  expect(base.stock.photon).toBe(5);
  expect(w.ships.find((s) => s.name === '前进巡逻号')!.x).toBe(base.x);
  await directive(p, ship.id, 'REARM', { 指令目标: l.id, '装载 photon': '5' });
  await run(p);
  await wait(p, (w) => w.ships.find((s) => s.id === ship.id)!.photon === ship.photon + 5);
  await pause(p);
  await directive(p, ship.id, 'REPAIR', { 指令目标: l.id });
  await run(p);
  await wait(p, (w) => w.ships.find((s) => s.id === ship.id)!.hull === 200);
});

test('ordinary wormhole goes to a distinct remote region and overview fills viewport with clusters', async () => {
  test.setTimeout(90000);
  const e = quietEngine(),
    origin = { q: 0, r: -1 },
    sector = materialize(e.state, origin),
    exitSector = pairedSector(e.state.initialSeed, origin);
  e.state.wormholes = e.state.wormholes.filter((h) => h.sectorId !== sector.id);
  const h = {
    ...e.state.wormholes[0],
    id: 'wormhole:0:-1',
    name: '亚空间通道 0/-1',
    sectorId: sector.id,
    x: 90,
    y: -480,
    exitSector,
    exit: { x: exitSector.q * 400 + 90, y: exitSector.r * 400 - 80 },
    discovered: true,
    transits: 0,
  };
  e.state.wormholes.push(h);
  const ship = e.state.ships[2];
  ship.x = h.x;
  ship.y = h.y;
  const p = await launch(e.state);
  await directive(p, ship.id, 'TRANSIT', { 指令目标: h.id });
  await run(p);
  await wait(p, (w) => w.ships.find((s) => s.id === ship.id)!.x === h.exit.x);
  await pause(p);
  expect((await state(p)).wormholes.every((portal) => !('exit' in portal))).toBe(true);
  await expect
    .poll(async () => JSON.parse((await p.locator('.strategic-map').getAttribute('data-view'))!).x)
    .toBe(h.exit.x);
  const reverse = 'wormhole:' + exitSector.q + ':' + exitSector.r;
  await directive(p, ship.id, 'TRANSIT', { 指令目标: reverse });
  await run(p);
  await wait(p, (w) => w.ships.find((s) => s.id === ship.id)!.x === h.x);
  await pause(p);
  for (let i = 0; i < 30; i++) {
    const camera = JSON.parse((await p.locator('.strategic-map').getAttribute('data-view'))!);
    if (camera.k <= 0.020001) break;
    await p.getByRole('button', { name: '缩小地图', exact: true }).click();
  }
  const map = p.locator('.strategic-map');
  await expect(map).toHaveAttribute('data-level', 'OVERVIEW');
  expect(await map.locator('[data-cluster-count]').count()).toBeGreaterThan(0);
  const coverage = await map.evaluate((el) => {
    const view = JSON.parse(el.getAttribute('data-view')!);
    const cells = [...el.querySelectorAll<SVGRectElement>('[data-grid-span]')];
    return {
      width: view.width,
      height: view.height,
      left: Math.min(...cells.map((r) => r.x.baseVal.value)),
      right: Math.max(...cells.map((r) => r.x.baseVal.value + r.width.baseVal.value)),
      top: Math.min(...cells.map((r) => r.y.baseVal.value)),
      bottom: Math.max(...cells.map((r) => r.y.baseVal.value + r.height.baseVal.value)),
    };
  });
  expect(coverage.left).toBeLessThanOrEqual(0);
  expect(coverage.right).toBeGreaterThanOrEqual(coverage.width);
  expect(coverage.top).toBeLessThanOrEqual(0);
  expect(coverage.bottom).toBeGreaterThanOrEqual(coverage.height);
  const inspectorLayout = await p
    .getByRole('complementary', { name: '对象详情' })
    .evaluate((el) => {
      const label = el.querySelector('.meter span')!;
      const range = document.createRange();
      range.selectNode(label.firstChild!);
      const text = range.getBoundingClientRect();
      const panel = el.getBoundingClientRect();
      const content = el.querySelector('.inspector-content')!;
      return {
        left: text.left,
        right: text.right,
        panelLeft: panel.left,
        panelRight: panel.right,
        overflow: content.scrollWidth - content.clientWidth,
      };
    });
  expect(inspectorLayout.left).toBeGreaterThanOrEqual(inspectorLayout.panelLeft);
  expect(inspectorLayout.right).toBeLessThanOrEqual(inspectorLayout.panelRight);
  expect(inspectorLayout.overflow).toBeLessThanOrEqual(1);
  await p.screenshot({ path: join(output, 'map-overview.png') });
  await map.locator('[data-cluster-count]').first().click();
  await expect(map).not.toHaveAttribute('data-level', 'OVERVIEW');
});
