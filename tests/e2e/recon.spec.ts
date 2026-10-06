import { displayName } from '../../src/ui/localization';
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
import { trackingScenario } from '../recon-scenarios';
import { MAP_PALETTE } from '../../src/ui/map/palette';
import type { Snapshot, WorldState, Action } from '../../src/engine/types';
import { inspectTitleBars, inspectTypography } from './typography';
let app: ElectronApplication | undefined;
const output = resolve('docs/verification/v9');
async function launch(world: WorldState, scale = 1, visible = false) {
  mkdirSync(output, { recursive: true });
  const directory = mkdtempSync(join(tmpdir(), 'frontier-recon-v9-'));
  new SaveStore(directory).write(world);
  app = await electron.launch({
    args: ['--force-device-scale-factor=' + scale, resolve('.')],
    env: { ...process.env, FRONTIER_USER_DATA: directory, FRONTIER_HEADLESS: visible ? '0' : '1' },
  });
  const page = await app.firstWindow();
  await page.locator('nav[aria-label="主导航"]').waitFor({ state: 'attached' });
  await page.context().setOffline(true);
  await page.evaluate(() => document.fonts.ready);
  return { page, directory };
}
test.afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
});
const state = async (page: Page) => (await page.evaluate(() => window.frontier.getState())).state;
async function issueUI(page: Page, shipId: string, type: Action['type'], targetId: string) {
  await page.locator('.operation-chip[data-ship-id="' + shipId + '"]').click();
  await page.getByRole('button', { name: '新指令 / 改令', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Admiral 指令' });
  await dialog.getByLabel('指令类型', { exact: true }).selectOption(type);
  await dialog.getByLabel('指令目标', { exact: true }).selectOption(targetId);
  if (type === 'SURVEY') await dialog.getByLabel('调查方式', { exact: true }).selectOption('close');
  await dialog.getByRole('button', { name: '下达 Admiral 指令', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
async function runUI(page: Page) {
  await page.getByRole('button', { name: '16×', exact: true }).click();
  const s = await state(page);
  if (s.paused) await resumeUI(page, s);
}
async function resumeUI(page: Page, s: Snapshot) {
  if (
    s.pauseReasons.some(
      (r) =>
        r.kind === 'newContact' &&
        s.communications.some((c) => !c.read && c.entityId === r.entityId && c.time === r.time),
    )
  ) {
    const alert = page.getByRole('dialog', { name: '接触警报' });
    await expect(alert).toBeVisible();
    await alert.getByRole('button', { name: '确认 / 保持暂停', exact: true }).click();
    await expect(alert).not.toBeVisible();
  }
  await page.getByRole('button', { name: '继续', exact: true }).click();
}
async function waitFor(page: Page, predicate: (s: Snapshot) => boolean, timeout = 45000) {
  await expect
    .poll(
      async () => {
        const s = await state(page);
        if (predicate(s)) return true;
        if (s.paused && s.status === 'active') await resumeUI(page, s);
        return false;
      },
      { timeout, intervals: [150] },
    )
    .toBe(true);
}

test('visible offline Electron: actual passage, survey, Veil recovery, cloak controls and idle restart', async () => {
  test.setTimeout(120000);
  const { page, directory } = await launch(quietEngine().state, 1, true);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  expect(
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
  ).toBe(true);
  await issueUI(page, 'verity', 'TRANSIT', 'wormhole:0:0');
  await runUI(page);
  await waitFor(page, (s) => s.bodies.some((b) => b.id === 'veil-derelict'));
  await waitFor(page, (s) => !s.ships.find((s) => s.id === 'verity')!.current);
  await issueUI(page, 'verity', 'SURVEY', 'veil-derelict');
  await waitFor(page, (s) => s.events.some((v) => v.subjectId === 'veil-derelict'));
  const event = (await state(page)).events.find((v) => v.subjectId === 'veil-derelict')!;
  await issueUI(page, 'verity', 'ASSIST_EVENT', event.id);
  await waitFor(page, (s) => s.ships.some((s) => s.id === 'veil'));
  await page.locator('.operation-chip[data-ship-id="veil"]').click();
  const toggle = page.getByRole('button', { name: '切换隐形' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: join(output, 'veil-recovered.png'), animations: 'disabled' });
  const at = (await state(page)).ships.find((s) => s.id === 'veil')!;
  const start = (await state(page)).time;
  await waitFor(page, (s) => s.time >= start + 60);
  const after = (await state(page)).ships.find((s) => s.id === 'veil')!;
  expect({ x: after.x, y: after.y }).toEqual({ x: at.x, y: at.y });
  expect(after.core).toBeGreaterThan(90);
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.evaluate(() => window.frontier.save());
  const saved = await state(page);
  await app!.close();
  app = undefined;
  app = await electron.launch({
    args: [resolve('.')],
    env: { ...process.env, FRONTIER_USER_DATA: directory, FRONTIER_HEADLESS: '1' },
  });
  const restoredPage = await app.firstWindow();
  await restoredPage.locator('nav[aria-label="主导航"]').waitFor({ state: 'attached' });
  const restored = await state(restoredPage);
  expect(restored.ships).toEqual(saved.ships);
  expect(restored.paused).toBe(true);
  expect(errors).toEqual([]);
  writeFileSync(
    join(output, 'recovery-result.json'),
    JSON.stringify(
      {
        version: restored.version,
        time: restored.time,
        veil: restored.ships.find((s) => s.id === 'veil'),
        errors,
      },
      null,
      2,
    ),
  );
});

for (const faction of ['orion', 'romulan'] as const)
  for (const cloaked of [false, true])
    test(`real Electron: ${faction} ${cloaked ? 'covert destination confirmation' : 'ordinary exposure and evasion'} through SHADOW UI`, async () => {
      test.setTimeout(90000);
      const scenario = trackingScenario(faction, cloaked);
      scenario.e.dispatchCommand({ type: 'cancelDirective', shipId: scenario.ship.id });
      const { page, directory } = await launch(
        scenario.e.state,
        1,
        !cloaked && faction === 'orion',
      );
      await issueUI(page, scenario.ship.id, 'SHADOW', scenario.target.id);
      await runUI(page);
      if (cloaked) {
        await waitFor(page, (s) => s.siteContacts.length > 0);
        expect((await state(page)).locations.some((l) => l.id === scenario.home.id)).toBe(false);
        await page.screenshot({
          path: join(output, `${faction}-site-suspected.png`),
          animations: 'disabled',
        });
        await waitFor(page, (s) => s.locations.some((l) => l.id === scenario.home.id));
        await waitFor(page, (s) => !s.ships.find((s) => s.id === scenario.ship.id)!.current);
        await page.getByRole('button', { name: '暂停', exact: true }).click();
        expect((await state(page)).ships.find((s) => s.id === 'veil')!.cloak).toBe('on');
        await page
          .locator('.comms-content')
          .filter({ hasText: '已确认 ' + scenario.home.name })
          .first()
          .click();
        await expect(
          page
            .locator('.strategic-map')
            .getByRole('button', { name: scenario.home.name, exact: true }),
        ).toBeVisible();
        await expect(page.locator('.inspector')).toContainText(displayName(scenario.home.name));
      } else {
        await expect
          .poll(
            async () => {
              const snapshot = await state(page);
              if (snapshot.paused) await resumeUI(page, snapshot);
              await page.evaluate(() => window.frontier.save());
              return new SaveStore(directory)
                .read()
                .world!.enemies.find((s) => s.id === scenario.target.id)!.counterTracking.evading;
            },
            { timeout: 20000, intervals: [150] },
          )
          .toBe(true);
        await page.getByRole('button', { name: '暂停', exact: true }).click();
        expect((await state(page)).locations.some((l) => l.id === scenario.home.id)).toBe(false);
      }
      await page.screenshot({
        path: join(output, `${faction}-${cloaked ? 'covert-confirmed' : 'ordinary-evasion'}.png`),
        animations: 'disabled',
      });
      const publicState = await state(page);
      expect(JSON.stringify(publicState)).not.toContain('counterTracking');
      writeFileSync(
        join(output, `${faction}-${cloaked ? 'covert' : 'ordinary'}-result.json`),
        JSON.stringify(
          {
            time: publicState.time,
            contacts: publicState.contacts,
            siteContacts: publicState.siteContacts,
            knownEnemyLocations: publicState.locations.filter((l) => l.owner !== 'starfleet'),
            follower: publicState.ships.find((s) => s.id === scenario.ship.id),
          },
          null,
          2,
        ),
      );
    });

for (const scale of [1.25, 1.5, 2])
  test(`map semantics, collision-free labels and real mixed fonts at ${scale * 100}%`, async () => {
    test.setTimeout(90000);
    const e = quietEngine();
    const { page } = await launch(e.state, scale);
    const map = page.locator('.strategic-map');
    await app!.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1600, 900),
    );
    const nav = await page.locator('.section-nav > button').evaluateAll((nodes) =>
      nodes.map((el) => {
        const en = el.querySelector('b')!,
          zh = el.querySelector('span')!,
          a = en.getBoundingClientRect(),
          b = zh.getBoundingClientRect();
        return {
          english: en.textContent,
          chinese: zh.textContent,
          sameSize: getComputedStyle(en).fontSize === getComputedStyle(zh).fontSize,
          sameLine: Math.abs(a.y - b.y) < 3,
          ordered: a.right <= b.left + 1,
          overflow: el.scrollWidth > el.clientWidth,
        };
      }),
    );
    expect(nav).toHaveLength(7);
    expect(nav.every((n) => n.sameSize && n.sameLine && n.ordered && !n.overflow)).toBe(true);
    const typography = await inspectTypography(page);
    const titleBars: Record<string, unknown> = { sector: await inspectTitleBars(page) };
    await page.locator('.footer-title').screenshot({
      path: join(output, `typography-fleet-${scale * 100}.png`),
      animations: 'disabled',
    });
    await page.locator('.comms-list').screenshot({
      path: join(output, `typography-comms-${scale * 100}.png`),
      animations: 'disabled',
    });
    for (const level of ['SECTOR', 'SYSTEM', 'LOCAL']) {
      for (let i = 0; i < 10 && (await map.getAttribute('data-level')) !== level; i++) {
        const current = await map.getAttribute('data-level');
        await page
          .getByRole('button', {
            name: current === 'LOCAL' || level === 'SECTOR' ? '缩小地图' : '放大地图',
          })
          .click();
        await page.waitForTimeout(220);
      }
      await expect(map).toHaveAttribute('data-level', level);
      if (level === 'SECTOR') {
        const ids = await map
          .locator('[data-entity-id]')
          .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-entity-id')));
        expect(e.state.bodies.some((b) => ids.includes(b.id))).toBe(false);
        expect(
          await map.locator('[data-entity-id="base"] [data-symbol]').getAttribute('stroke'),
        ).toBe(MAP_PALETTE.dawn);
      }
      const collisions = await map.locator('.map-label').evaluateAll((nodes) => {
        const boxes = nodes.map((n) => ({
          id: n.getAttribute('data-label-id'),
          box: n.getBoundingClientRect(),
        }));
        const hits: string[] = [];
        for (let a = 0; a < boxes.length; a++)
          for (let b = a + 1; b < boxes.length; b++) {
            const x = boxes[a].box,
              y = boxes[b].box;
            if (x.left < y.right && x.right > y.left && x.top < y.bottom && x.bottom > y.top)
              hits.push(boxes[a].id + ' / ' + boxes[b].id);
          }
        return hits;
      });
      expect(collisions).toEqual([]);
      await page.screenshot({
        path: join(output, `map-${level.toLowerCase()}-${scale * 100}.png`),
        animations: 'disabled',
      });
    }
    await page.getByRole('navigation').getByRole('button', { name: /FLEET/ }).click();
    await expect(page.getByRole('dialog')).toContainText('FLEET / TASK GROUPS 舰队与编队');
    titleBars.fleet = await inspectTitleBars(page);
    await page.getByRole('dialog').screenshot({
      path: join(output, `typography-management-${scale * 100}.png`),
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    for (const nav of ['OPERATIONS', 'PERSONNEL', 'STARBASE', 'COLONIES', 'ARCHIVE']) {
      await page
        .getByRole('navigation')
        .getByRole('button', { name: new RegExp(nav) })
        .click();
      await expect(page.getByRole('dialog', { name: nav + ' 工作面板' })).toBeVisible();
      titleBars[nav] = await inspectTitleBars(page);
      if (nav === 'STARBASE')
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
          await page.getByRole('tab', { name: new RegExp('^' + tab + ' ') }).click();
          titleBars[nav + '/' + tab] = await inspectTitleBars(page);
        }
      await page.keyboard.press('Escape');
    }
    await page.locator('.operation-chip[data-ship-id="meridian"]').click();
    await page.getByRole('button', { name: '新指令 / 改令', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Admiral 指令' })).toContainText(
      'FLEET / ALL OWNED VESSELS 舰队 / 全部己方舰船',
    );
    titleBars.directives = await inspectTitleBars(page);
    await page.getByRole('dialog', { name: 'Admiral 指令' }).screenshot({
      path: join(output, `typography-directives-${scale * 100}.png`),
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    await page.locator('.operation-chip[data-ship-id="verity"]').click();
    await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue(
      displayName(e.state.ships.find((ship) => ship.id === 'verity')!.name),
    );
    await page.locator('.inspector-heading').click();
    await page.locator('.inspector').screenshot({
      path: join(output, `typography-input-${scale * 100}.png`),
      animations: 'disabled',
    });
    writeFileSync(
      join(output, `layout-fonts-${scale * 100}.json`),
      JSON.stringify({ nav, ...typography, titleBars }, null, 2),
    );
  });
