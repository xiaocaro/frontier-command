import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SaveStore } from '../../electron/persistence';
import { quietEngine } from '../helpers';
import { makeEnemy } from '../../src/engine/data';
import type { Snapshot } from '../../src/engine/types';
import { inspectTypography, inspectTitleBars } from './typography';
let app: ElectronApplication | undefined;
const output = resolve('docs/verification/v9');
mkdirSync(output, { recursive: true });
async function launch(
  world = quietEngine().state,
  scale = 1,
  directory = mkdtempSync(join(tmpdir(), 'frontier-command-v9-')),
) {
  new SaveStore(directory).write(world);
  app = await electron.launch({
    args: ['--force-device-scale-factor=' + scale, resolve('.')],
    env: { ...process.env, FRONTIER_USER_DATA: directory, FRONTIER_HEADLESS: '0' },
  });
  const p = await app.firstWindow();
  await p.locator('nav[aria-label="主导航"]').waitFor({ state: 'attached' });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1920, 1200),
  );
  await p.context().setOffline(true);
  await p.evaluate(() => document.fonts.ready);
  return { p, directory };
}
test.afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
});
const state = async (p: Page) => (await p.evaluate(() => window.frontier.getState())).state;
const wait = async (p: Page, f: (s: Snapshot) => boolean) =>
  expect.poll(async () => f(await state(p)), { timeout: 45000, intervals: [100] }).toBe(true);
async function run(p: Page) {
  await p.getByRole('button', { name: '16×', exact: true }).click();
  if ((await state(p)).paused) await p.getByRole('button', { name: '继续', exact: true }).click();
}
async function nav(p: Page, name: string) {
  const menu = p.getByRole('button', { name: 'MENU 导航', exact: true });
  if (await menu.isVisible()) await menu.click();
  await p
    .getByRole('navigation')
    .getByRole('button', { name: new RegExp(name) })
    .click();
}
const ship = (p: Page, id: string) => p.locator('.operation-chip[data-ship-id="' + id + '"]');
const marker = (p: Page, id: string) => p.locator('.strategic-map [data-entity-id="' + id + '"]');

test('Ctrl selection survives facility inspection, preselects every task and issues batch moves', async () => {
  const { p } = await launch();
  await ship(p, 'meridian').click();
  await ship(p, 'vigil').click({ modifiers: ['Control'] });
  await expect(ship(p, 'meridian')).toHaveAttribute('aria-pressed', 'true');
  await expect(ship(p, 'vigil')).toHaveAttribute('aria-pressed', 'true');
  await marker(p, 'mine').click();
  await p.getByRole('button', { name: '矿场 → 曙光 运输材料', exact: true }).click();
  const d = p.getByRole('dialog', { name: 'Admiral 指令' });
  await expect(d.getByLabel('分配 meridian', { exact: true })).toBeChecked();
  await expect(d.getByLabel('分配 vigil', { exact: true })).toBeChecked();
  await expect(d).toContainText('每舰数量');
  await expect(d.getByLabel('指令目标', { exact: true })).toHaveValue('base');
  await d.getByLabel('指令类型', { exact: true }).selectOption('PATROL');
  await expect(d.getByLabel('分配 meridian', { exact: true })).toBeChecked();
  await expect(d.getByLabel('分配 vigil', { exact: true })).toBeChecked();
  await p.keyboard.press('Escape');
  const map = p.locator('.strategic-map');
  await map.click({ position: { x: 80, y: 50 } });
  await p.getByRole('button', { name: '前往此处', exact: true }).click();
  const s = await state(p);
  expect(
    s.ships
      .filter((x) => x.current?.action.type === 'MOVE')
      .map((x) => x.id)
      .sort(),
  ).toEqual(['meridian', 'vigil']);
  expect(s.groups).toHaveLength(0);
  await ship(p, 'vigil').click({ modifiers: ['Control'] });
  await expect(ship(p, 'vigil')).toHaveAttribute('aria-pressed', 'false');
  await expect(ship(p, 'meridian')).toHaveAttribute('aria-pressed', 'true');
  await marker(p, 'mine').click();
  await p.getByRole('button', { name: '返回 曙光 并卸货', exact: true }).click();
  await expect(d.getByLabel('指令类型', { exact: true })).toHaveValue('UNLOAD');
  await expect(d.getByLabel('指令目标', { exact: true })).toHaveValue('base');
  await expect(d.getByLabel('分配 meridian', { exact: true })).toBeChecked();
  await expect(d.getByLabel('分配 vigil', { exact: true })).not.toBeChecked();
  await p.screenshot({ path: join(output, 'multi-selection-unload.png'), animations: 'disabled' });
});

test('actual wormhole follow, immediate capture guidance, cloak symbols and persistent marker dismissal', async () => {
  test.setTimeout(120000);
  const { p, directory } = await launch();
  await ship(p, 'verity').click();
  await marker(p, 'wormhole:0:0').click();
  await p.getByRole('button', { name: '穿越 虫洞', exact: true }).click();
  let d = p.getByRole('dialog', { name: 'Admiral 指令' });
  await expect(d.getByLabel('分配 verity', { exact: true })).toBeChecked();
  await d.getByRole('button', { name: '下达 Admiral 指令', exact: true }).click();
  await run(p);
  await wait(p, (s) => s.bodies.some((b) => b.id === 'veil-derelict'));
  await wait(p, (s) => !s.ships.find((s) => s.id === 'verity')!.current);
  const map = p.locator('.strategic-map');
  await expect(map).toHaveAttribute('data-follow-ship-id', 'verity');
  const view = JSON.parse((await map.getAttribute('data-view'))!);
  const explorer = (await state(p)).ships.find((s) => s.id === 'verity')!;
  expect(view.y).toBeCloseTo(explorer.y, 0);
  await p.getByRole('button', { name: '暂停', exact: true }).click();
  await p.screenshot({ path: join(output, 'wormhole-follow.png'), animations: 'disabled' });
  await ship(p, 'verity').click();
  await expect(map).toHaveAttribute('data-follow-ship-id', 'verity');
  await marker(p, 'veil-derelict').click();
  await expect(map).toHaveAttribute('data-follow-ship-id', '');
  await p.getByRole('button', { name: '近距调查无人舰船', exact: true }).click();
  d = p.getByRole('dialog', { name: 'Admiral 指令' });
  await d.getByRole('button', { name: '下达 Admiral 指令', exact: true }).click();
  await run(p);
  await wait(p, (s) =>
    s.events.some((v) => v.subjectId === 'veil-derelict' && v.kind === 'derelict'),
  );
  await p.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(p.getByRole('button', { name: '派舰现场接管', exact: true })).toBeVisible();
  await expect(p.locator('.inspector').getByLabel('设施类型')).toHaveCount(0);
  await p.getByRole('button', { name: '派舰现场接管', exact: true }).click();
  d = p.getByRole('dialog', { name: 'Admiral 指令' });
  await expect(d.getByLabel('指令类型', { exact: true })).toHaveValue('ASSIST_EVENT');
  await d.getByRole('button', { name: '下达 Admiral 指令', exact: true }).click();
  await run(p);
  await wait(p, (s) => s.ships.some((s) => s.id === 'veil'));
  await p.getByRole('button', { name: '暂停', exact: true }).click();
  await ship(p, 'veil').click();
  await p.getByRole('button', { name: '切换隐形' }).click();
  await expect(ship(p, 'veil')).toHaveAttribute('data-cloak', 'on');
  await expect(marker(p, 'veil')).toHaveAttribute('data-cloak', 'on');
  await expect(marker(p, 'veil').locator('.cloak-status-label')).toHaveText('隐形');
  await p.screenshot({ path: join(output, 'veil-captured-cloak.png'), animations: 'disabled' });
  await p.getByRole('button', { name: 'Console Settings', exact: true }).click();
  const textSize = p
    .getByRole('dialog', { name: '控制台设置' })
    .getByLabel('文字大小', { exact: true });
  await textSize.focus();
  await textSize.press('End');
  await p.keyboard.press('Escape');
  await marker(p, 'veil-derelict').click({ button: 'right' });
  const menu = p.getByRole('menu', { name: '地图标记操作' });
  expect(
    await menu.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    }),
  ).toBe(true);
  await p.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
  await marker(p, 'veil-derelict').click({ button: 'right' });
  await menu.getByRole('menuitem', { name: '移除无价值标记', exact: true }).click();
  await expect(marker(p, 'veil-derelict')).toHaveCount(0);
  await p.evaluate(() => window.frontier.save());
  await app!.close();
  app = undefined;
  app = await electron.launch({
    args: [resolve('.')],
    env: { ...process.env, FRONTIER_USER_DATA: directory, FRONTIER_HEADLESS: '0' },
  });
  const restored = await app.firstWindow();
  await restored.locator('nav[aria-label="主导航"]').waitFor({ state: 'attached' });
  expect((await state(restored)).mapMarkers.dismissedIds).toContain('veil-derelict');
  expect((await state(restored)).ships.find((s) => s.id === 'veil')!.cloak).toBe('on');
});

test('new contacts merge into one alert sound, preserve pause through orders, and resume manually', async () => {
  const e = quietEngine();
  e.state.enemies = [
    makeEnemy('new-orion', 'scout', 'orion', { x: e.base.x + 100, y: e.base.y }),
    makeEnemy('new-romulan', 'scout', 'romulan', { x: e.base.x + 105, y: e.base.y }),
  ];
  e.state.enemies.forEach((s) => {
    s.cloak = 'off';
    s.nextDecision = 1e9;
    s.photon = 0;
    s.standing.roe = 'HOLD FIRE';
  });
  const { p } = await launch(e.state);
  await p.evaluate(() => {
    const w = window as unknown as Window & { cues: string[] };
    w.cues = [];
    window.addEventListener('lcars:cue', (e) =>
      w.cues.push((e as CustomEvent<{ cue: string }>).detail.cue),
    );
  });
  await run(p);
  const d = p.getByRole('dialog', { name: '接触警报' });
  await expect(d).toBeVisible();
  const frozen = await state(p);
  expect(frozen.tick).toBe(10);
  expect(frozen.pauseReasons.filter((r) => r.kind === 'newContact')).toHaveLength(2);
  await expect
    .poll(() =>
      p.evaluate(
        () =>
          (window as unknown as Window & { cues: string[] }).cues.filter((c) => c === 'alert')
            .length,
      ),
    )
    .toBe(1);
  await expect(d).toContainText('尚未确认敌对');
  await p.screenshot({ path: join(output, 'contact-alert.png'), animations: 'disabled' });
  await d.getByRole('button', { name: '定位接触 / 保持暂停' }).first().click();
  expect((await state(p)).paused).toBe(true);
  await ship(p, 'vigil').click();
  await p.getByRole('button', { name: '新指令 / 改令', exact: true }).click();
  const order = p.getByRole('dialog', { name: 'Admiral 指令' });
  await order.getByLabel('指令类型', { exact: true }).selectOption('MOVE');
  await order.getByLabel('坐标 x').fill('-260');
  await order.getByLabel('坐标 y').fill('0');
  await order.getByRole('button', { name: '下达 Admiral 指令', exact: true }).click();
  expect((await state(p)).tick).toBe(frozen.tick);
  await p.getByRole('button', { name: '继续', exact: true }).click();
  await wait(p, (s) => s.tick > 10);
  await expect(d).not.toBeVisible();
});

test('five strategic upgrades show actual adjacent progress, pause and ONLINE completion', async () => {
  const e = quietEngine();
  e.state.resources.credits = 10000;
  e.base.stock.materials = 3000;
  e.base.stock.specialFinds = 20;
  const { p } = await launch(e.state);
  await nav(p, 'STARBASE');
  const d = p.getByRole('dialog', { name: 'STARBASE 工作面板' });
  for (const tab of ['SHIPYARD', 'ARMORY', 'LOGISTICS', 'SENSOR CONTROL', 'DEFENSE GRID']) {
    await d.getByRole('tab', { name: new RegExp('^' + tab + ' ') }).click();
    const button = d.getByRole('button', { name: /^升级 / });
    await button.click();
    await expect(button).toBeDisabled();
    await expect(d.locator('.record-row .work-progress')).toContainText('0%');
    await expect(d.locator('.record-row .work-progress')).toContainText('暂停');
  }
  await p.screenshot({ path: join(output, 'upgrade-paused.png'), animations: 'disabled' });
  await run(p);
  await wait(p, (s) => s.jobs.some((j) => j.work > 0 && !j.complete));
  await expect(d.locator('.record-row progress')).not.toHaveAttribute('value', '0');
  await p.screenshot({ path: join(output, 'upgrade-progress.png'), animations: 'disabled' });
  await wait(p, (s) => Object.values(s.upgrades).every(Boolean));
  await expect(d).toContainText('等级 1／已升级');
  await expect(p.getByRole('dialog', { name: 'STARBASE 工作面板' })).toBeVisible();
});

for (const scale of [1.25, 1.5, 2])
  test(
    'native ' +
      scale * 100 +
      '%: text 100–200%, interface zoom, all management surfaces, fonts and title bounds',
    async () => {
      test.setTimeout(180000);
      const { p } = await launch(quietEngine().state, scale);
      const errors: string[] = [];
      p.on('pageerror', (e) => errors.push(e.message));
      const font = await inspectTypography(p);
      const bars = await inspectTitleBars(p);
      for (const text of [1, 1.5, 2]) {
        const opening = p.getByRole('button', { name: 'MENU 导航', exact: true });
        if (await opening.isVisible()) await opening.click();
        await p.getByRole('button', { name: 'Console Settings', exact: true }).click();
        const settings = p.getByRole('dialog', { name: '控制台设置' });
        const slider = settings.getByLabel('文字大小', { exact: true });
        await slider.focus();
        await slider.press('Home');
        for (let i = 0; i < (text - 1) * 20; i++) await slider.press('ArrowRight');
        await p.keyboard.press('Escape');
        expect(
          await p.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)),
        ).toBeCloseTo(18 * text, 1);
        const resource = p.getByRole('region', { name: '基地可用资源' });
        await resource.scrollIntoViewIfNeeded();
        await expect(resource.locator(':scope > div')).toHaveCount(5);
        await expect(resource).toContainText('SPECIAL FINDS');
        await expect(resource).toContainText('0');
        expect(
          await resource.evaluate((el) => {
            const b = el.getBoundingClientRect(),
              main = document.querySelector('.sector-workspace')!.getBoundingClientRect();
            return (
              b.bottom <= main.top &&
              [...el.querySelectorAll(':scope > div')].every((d) => {
                const r = d.getBoundingClientRect();
                return r.top >= b.top && r.bottom <= b.bottom;
              })
            );
          }),
        ).toBe(true);
        await p.screenshot({
          path: join(output, 'native-' + scale * 100 + '-text-' + text * 100 + '.png'),
          animations: 'disabled',
        });
        for (const page of [
          'FLEET',
          'OPERATIONS',
          'PERSONNEL',
          'COLONIES',
          'ARCHIVE',
          'STARBASE',
        ]) {
          await nav(p, page);
          const d = p.getByRole('dialog', { name: page + ' 工作面板' });
          await expect(d).toBeVisible();
          if (page === 'STARBASE')
            for (const tab of [
              'COMMAND',
              'SHIPYARD',
              'DRYDOCK',
              'ARMORY',
              'ENGINEERING',
              'LOGISTICS',
              'SENSOR CONTROL',
              'DEFENSE GRID',
            ]) {
              await d.getByRole('tab', { name: new RegExp('^' + tab + ' ') }).click();
              const title = d.locator('.panel-heading .lcars-text-bar');
              const cut = await title.evaluate((el) => {
                const frame = el.closest('.frame-body')!,
                  a = el.getBoundingClientRect(),
                  b = frame.getBoundingClientRect(),
                  s = getComputedStyle(frame, '::after');
                return a.left - b.left > parseFloat(s.width);
              });
              expect(cut).toBe(true);
            }
          await p.keyboard.press('Escape');
        }
        const menu = p.getByRole('button', { name: 'MENU 导航', exact: true });
        if (await menu.isVisible()) await menu.click();
        await p.getByRole('button', { name: 'Console Settings', exact: true }).click();
        const zoom = p
          .getByRole('dialog', { name: '控制台设置' })
          .getByLabel('界面缩放', { exact: true });
        await zoom.focus();
        await zoom.press('End');
        await expect
          .poll(() =>
            app!.evaluate(({ BrowserWindow }) =>
              BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
            ),
          )
          .toBe(2);
        await expect(p.getByRole('dialog', { name: '控制台设置' })).toBeVisible();
        await zoom.scrollIntoViewIfNeeded();
        await expect(zoom).toBeInViewport();
        await p.keyboard.press('Control+0');
        await expect
          .poll(() =>
            app!.evaluate(({ BrowserWindow }) =>
              BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
            ),
          )
          .toBe(1);
        expect(
          await p.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)),
        ).toBeCloseTo(18 * text, 1);
        await expect.poll(() => p.evaluate(() => innerWidth)).toBeGreaterThanOrEqual(1919);
        await p.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        await p.keyboard.press('Escape');
      }
      expect(errors).toEqual([]);
      writeFileSync(
        join(output, 'display-' + scale * 100 + '.json'),
        JSON.stringify({ scale, font, bars, errors }, null, 2),
      );
    },
  );
