import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SaveStore } from '../../electron/persistence';
import { quietEngine } from '../helpers';
import { makeLocation, makeEnemy, emptyStock } from '../../src/engine/data';
import { observe } from '../../src/engine/sensors';
import { createEvent } from '../../src/engine/world-events';
import type { WorldState } from '../../src/engine/types';
let app: ElectronApplication | undefined;
async function launch(world?: WorldState, scale = 1) {
  const dir = mkdtempSync(join(tmpdir(), 'frontier-v9-ui-'));
  if (world) new SaveStore(dir).write(world);
  app = await electron.launch({
    args: ['--force-device-scale-factor=' + scale, resolve('.')],
    // `FRONTIER_READ_HOLD_MS: '0'` — the read hold would freeze the world mid-assertion (`electron/read-hold.ts`).
    env: { ...process.env, FRONTIER_USER_DATA: dir, FRONTIER_HEADLESS: '1', FRONTIER_READ_HOLD_MS: '0' },
  });
  const p = await app.firstWindow();
  await p.locator('nav[aria-label="主导航"]').waitFor({ state: 'attached' });
  await p.evaluate(() => document.fonts.ready);
  return p;
}
test.afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
});
test('precise map points preserve command ship, queue/interruption and drag never orders', async () => {
  const p = await launch();
  const state = async () => (await p.evaluate(() => window.frontier.getState())).state;
  await p.locator('[data-ship-id="vigil"]').click();
  const vigil = (await state()).ships.find((s) => s.id === 'vigil')!;
  await expect
    .poll(async () => JSON.parse((await p.locator('.strategic-map').getAttribute('data-view'))!).x)
    .toBe(vigil.x);
  const map = p.locator('.strategic-map'),
    box = (await map.boundingBox())!,
    view = JSON.parse((await map.getAttribute('data-view'))!);
  const x = box.width * 0.35,
    y = box.height * 0.27;
  // Read the actual pointer coordinate after Chromium rounds the requested CSS point.
  await map.evaluate((el) =>
    el.addEventListener('click', (event) => {
      const pointer = event as MouseEvent,
        box = el.getBoundingClientRect();
      el.setAttribute(
        'data-click-point',
        JSON.stringify({ x: pointer.clientX - box.left, y: pointer.clientY - box.top }),
      );
    }),
  );
  await map.click({ position: { x, y } });
  const clicked = JSON.parse((await map.getAttribute('data-click-point'))!);
  await expect(p.getByTestId('destination-preview')).toBeVisible();
  await expect(map.locator('[data-entity-id="vigil"] .selection-reticle')).toBeVisible();
  await p.getByRole('button', { name: '前往此处', exact: true }).click();
  let s = (await state()).ships.find((s) => s.id === 'vigil')!;
  expect(s.current!.action).toEqual({
    type: 'MOVE',
    point: {
      x: Math.round(view.x + (clicked.x - view.width / 2) / view.k),
      y: Math.round(view.y + (clicked.y - view.height / 2) / view.k),
    },
  });
  const first = s.current!.id;
  await map.click({ position: { x: x + 30, y: y + 10 } });
  await p.getByLabel('地图移动模式').selectOption('QUEUE');
  await p.getByRole('button', { name: '前往此处', exact: true }).click();
  s = (await state()).ships.find((s) => s.id === 'vigil')!;
  expect(s.queue).toHaveLength(1);
  await map.click({ position: { x: x + 60, y: y + 20 } });
  await p.getByLabel('地图移动模式').selectOption('INTERRUPT');
  await p.getByRole('button', { name: '前往此处', exact: true }).click();
  s = (await state()).ships.find((s) => s.id === 'vigil')!;
  expect(s.suspended[0].id).toBe(first);
  const before = s;
  await p.mouse.move(box.x + x, box.y + y);
  await p.mouse.down();
  await p.mouse.move(box.x + x + 80, box.y + y + 40, { steps: 5 });
  await p.mouse.up();
  expect((await state()).ships.find((s) => s.id === 'vigil')).toEqual(before);
  await expect(p.getByTestId('destination-preview')).not.toBeVisible();
  await map.click({ position: { x, y } });
  await p.keyboard.press('Escape');
  await expect(p.getByTestId('destination-preview')).not.toBeVisible();
});
test('Fleet CRUD, membership and group orders use production UI and persist command identity', async () => {
  const p = await launch();
  const nav = p.getByRole('navigation');
  await nav.getByRole('button', { name: /FLEET/ }).click();
  await p.getByLabel('编队名称').fill('测试运输群');
  await p.getByRole('button', { name: '创建编队', exact: true }).click();
  await expect(p.getByRole('button', { name: '编辑编队', exact: true })).toBeVisible();
  await p.getByRole('button', { name: '编辑编队', exact: true }).click();
  await p.getByLabel('编队名称').fill('第二运输群');
  await p.getByLabel('编队成员 meridian-3', { exact: true }).uncheck();
  await p.getByRole('button', { name: '保存编队', exact: true }).click();
  let w = (await p.evaluate(() => window.frontier.getState())).state;
  expect(w.groups[0].name).toBe('第二运输群');
  expect(w.groups[0].shipIds).toEqual(['meridian', 'meridian-2']);
  await p.getByRole('button', { name: '在星图选择', exact: true }).click();
  await expect(p.locator('.inspector')).toContainText('第二运输群');
  await p.locator('.inspector').getByRole('button', { name: '移动', exact: true }).click();
  const d = p.getByRole('dialog', { name: 'Admiral 指令' });
  await d.getByLabel('坐标 x').fill('100');
  await d.getByLabel('坐标 y').fill('-100');
  await d.getByRole('button', { name: '下达 Admiral 指令', exact: true }).click();
  await expect(d).not.toBeVisible();
  w = (await p.evaluate(() => window.frontier.getState())).state;
  expect(w.ships.filter((s) => s.current?.groupOrderId)).toHaveLength(2);
  await nav.getByRole('button', { name: /FLEET/ }).click();
  await p.getByRole('button', { name: '删除编队', exact: true }).click();
  await expect(p.getByRole('button', { name: '编辑编队', exact: true })).not.toBeVisible();
  expect(
    (await p.evaluate(() => window.frontier.getState())).state.ships.filter(
      (s) => s.current?.groupOrderId,
    ),
  ).toHaveLength(2);
});
test('all map entity silhouettes and Chinese Inspector domains render including Personnel and persistent events', async () => {
  test.setTimeout(90000);
  const e = quietEngine();
  const sys = e.state.systems[0];
  sys.survey = 2;
  for (const system of e.state.systems) {
    system.x = 40;
    system.y = -60;
  }
  e.state.locations
    .filter((l) => l.owner === 'starfleet')
    .forEach((l, i) => {
      l.x = -80 + i * 50;
      l.y = 80;
    });
  e.state.ships.forEach((s, i) => {
    s.x = -90 + i * 20;
    s.y = 0;
  });
  e.state.civilians[0].x = 30;
  e.state.civilians[0].y = -120;
  for (const [index, kind] of (
    ['planet', 'moon', 'belt', 'resource', 'anomaly', 'ruins', 'derelict'] as const
  ).entries()) {
    const b = {
      ...e.state.bodies[0],
      id: 'icon-' + kind,
      systemId: sys.id,
      name: '图标 ' + kind,
      kind,
      category: '测试种类',
      hidden: false,
      discovered: true,
      survey: 2,
      x: -80 + index * 45,
      y: -20,
    };
    e.state.bodies.push(b);
    sys.bodyIds.push(b.id);
  }
  e.state.locations.push(
    makeLocation('icon-platform', '防御平台测试', 'platform', { x: 0, y: 90 }),
  );
  e.state.wormholes.push({
    id: 'icon-wormhole',
    name: 'Wormhole 测试',
    sectorId: e.state.sectors[0].id,
    x: -80,
    y: 120,
    exit: { x: 800, y: 800 },
    exitSector: { q: 2, r: 2 },
    discovered: true,
    surveyed: false,
    stability: 0.8,
    stable: true,
    transits: 0,
  });
  e.state.wrecks.push({
    id: 'icon-wreck',
    name: '残骸测试',
    x: 0,
    y: -90,
    stock: { ...emptyStock(), materials: 20 },
    discovered: true,
  });
  const enemy = makeEnemy('unknown-ui', 'raider', 'orion', { x: 110, y: 70 });
  e.state.enemies.push(enemy);
  observe(e.state, enemy, 1);
  e.dispatchCommand({
    type: 'startConstruction',
    kind: 'outpost',
    siteId: sys.id,
    name: '建设测试',
  });
  const event = createEvent(e, 'wormhole', 'icon-wormhole', '真实通道已探测，需要现场调查');
  const p = await launch(e.state),
    errors: string[] = [];
  p.on('pageerror', (error) => errors.push(error.message));
  await app!.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1920, 1200),
  );
  const map = p.locator('.strategic-map');
  for (let n = 0; n < 10 && (await map.getAttribute('data-level')) !== 'LOCAL'; n++) {
    await p.getByRole('button', { name: '放大地图' }).click();
    await p.waitForTimeout(220);
  }
  await expect(map).toHaveAttribute('data-level', 'LOCAL');
  const expected = [
    'ship',
    'freighter',
    'base',
    'colony',
    'mine',
    'outpost',
    'platform',
    'system',
    'planet',
    'moon',
    'belt',
    'resource',
    'anomaly',
    'ruins',
    'derelict',
    'wormhole',
    'wreck',
    'project',
    'contact',
  ];
  for (const kind of expected)
    await expect(map.locator(`[data-symbol="${kind}"]`).first()).toBeAttached();
  for (const name of [
    'DAWN STARBASE / 曙光基地',
    'NEW HORIZON / 新曙殖民地',
    'HELIOS MINE / 赫利俄斯矿场',
    'BEACON OUTPOST / 信标前哨',
    '防御平台测试',
    'Wormhole 测试',
    '残骸测试',
    '建设测试',
    'CONTACT',
    'SS FEDERATION EXCHANGE',
    '图标 planet',
    '图标 moon',
    '图标 belt',
    '图标 resource',
    '图标 anomaly',
    '图标 ruins',
    '图标 derelict',
  ]) {
    await map.getByRole('button', { name, exact: true }).focus();
    await p.keyboard.press('Enter');
    await expect(p.locator('.inspector')).toContainText('对象详情');
  }
  await p
    .getByRole('navigation')
    .getByRole('button', { name: /OPERATIONS/ })
    .click();
  await p
    .locator(`[data-entity-id="${event.id}"]`)
    .getByRole('button', { name: '派舰现场响应', exact: true })
    .click();
  await expect(p.getByRole('dialog', { name: 'Admiral 指令' }).getByLabel('指令目标')).toHaveValue(
    event.id,
  );
  await p.keyboard.press('Escape');
  await p
    .getByRole('navigation')
    .getByRole('button', { name: /PERSONNEL/ })
    .click();
  await expect(p.getByRole('dialog', { name: 'PERSONNEL 工作面板' })).toContainText(
    'Commander 陈星',
  );
  await expect(p.getByLabel('任职目标 commander-colony')).toBeVisible();
  await p.screenshot({ path: 'test-results/v9-personnel-and-inspectors.png' });
  expect(errors).toEqual([]);
});
for (const scale of [1.25, 1.5, 2])
  test(`long Chinese title and 80-character name retain nonshrinking caps at ${scale * 100}%`, async () => {
    const e = quietEngine();
    e.state.ships[0].name = '长名称'.repeat(26) + '终端';
    const p = await launch(e.state, scale);
    await p.locator('[data-ship-id="meridian"]').click();
    const title = p
      .locator('.inspector .lcars-text-bar')
      .filter({ hasText: e.state.ships[0].name });
    await expect(title).toBeVisible();
    const geometry = await title.evaluate((el) => {
      const before = getComputedStyle(el, '::before'),
        after = getComputedStyle(el, '::after'),
        text = el.querySelector('span')!,
        style = getComputedStyle(text);
      return {
        beforeShrink: before.flexShrink,
        afterBasis: parseFloat(after.flexBasis),
        height: parseFloat(before.height),
        overflow: style.textOverflow,
        nowrap: style.whiteSpace,
        textWidth: text.clientWidth,
        textScroll: text.scrollWidth,
        barWidth: el.clientWidth,
      };
    });
    expect(geometry.beforeShrink).toBe('0');
    expect(geometry.afterBasis).toBeGreaterThan(10);
    expect(geometry.height).toBeGreaterThan(5);
    expect(geometry.nowrap).toBe('normal');
    expect(geometry.textScroll).toBeLessThanOrEqual(geometry.textWidth);
    expect(geometry.textWidth).toBeLessThan(geometry.barWidth);
    await p.screenshot({ path: `test-results/v9-long-title-${scale * 100}.png` });
  });
