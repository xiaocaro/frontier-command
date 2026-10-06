import { _electron as electron } from '@playwright/test';
import { mkdtempSync, mkdirSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const directory = mkdtempSync(join(tmpdir(), 'frontier-v9-play-'));
const seed = process.argv[2] ? Number(process.argv[2]) : undefined;
if (seed !== undefined) {
  const { createWorld } = require('../dist-electron/src/engine/data.js');
  const { SaveStore } = require('../dist-electron/electron/persistence.js');
  new SaveStore(directory).write(createWorld(seed));
}
const output = resolve('docs/verification/v9');
mkdirSync(output, { recursive: true });
const log = join(output, 'play-' + (seed ?? 'default') + '.jsonl');
const app = await electron.launch({
  args: [resolve('.')],
  env: { ...process.env, FRONTIER_USER_DATA: directory, FRONTIER_HEADLESS: '0' },
});
const page = await app.firstWindow();
page.setDefaultTimeout(7000);
await page.locator('nav[aria-label="主导航"]').waitFor({ state: 'attached' });
const state = async () => (await page.evaluate(() => window.frontier.getState())).state;
const record = (data) => {
  const item = { wall: new Date().toISOString(), ...data };
  appendFileSync(log, JSON.stringify(item) + '\n');
  console.log(JSON.stringify(item));
};
page.on('pageerror', (error) => record({ event: 'pageerror', message: error.message }));
record({ event: 'launched', seed: seed ?? 236807, directory });
async function action(shipId, type, fields = {}, mode = 'REPLACE') {
  const s = (await state()).ships.find((s) => s.id === shipId);
  if (!s) throw Error('Ship unavailable ' + shipId);
  await page.locator('.operation-chip[data-ship-id="' + s.id + '"]').click();
  await page.getByRole('button', { name: '新指令 / 改令', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Admiral 指令' });
  await dialog.getByLabel('指令类型', { exact: true }).selectOption(type);
  await dialog.getByLabel('提交模式').selectOption(mode);
  for (const [label, value] of Object.entries(fields)) {
    const input = dialog.getByLabel(label, { exact: true });
    if (await input.evaluate((el) => el.tagName === 'SELECT'))
      await input.selectOption(String(value));
    else if ((await input.getAttribute('type')) === 'checkbox')
      await input.setChecked(Boolean(value));
    else await input.fill(String(value));
  }
  await dialog.getByRole('button', { name: '下达 Admiral 指令', exact: true }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 5000 });
}
const rl = createInterface({ input: process.stdin, terminal: false });
let busy = Promise.resolve();
rl.on('line', (line) => {
  busy = busy.then(async () => {
    try {
      const q = JSON.parse(line);
      if (q.op === 'state') {
        const s = await state();
        record({ event: 'state', state: s });
      }
      if (q.op === 'summary') {
        const s = await state();
        record({
          event: 'summary',
          tick: s.tick,
          time: s.time,
          paused: s.paused,
          credits: s.resources.credits,
          sectors: s.sectors.map((c) => c.id),
          ships: s.ships.map((s) => ({
            id: s.id,
            hull: s.hull,
            shield: s.shield,
            cargo: s.cargo,
            modules: s.modules,
            current: s.current,
            queue: s.queue,
          })),
          locations: s.locations.map((l) => ({
            id: l.id,
            name: l.name,
            stock: l.stock,
            capacity: l.capacity,
            storageFull: l.storageFull,
            colony: l.colony,
            hull: l.hull,
          })),
          events: s.events,
          personnel: s.personnel,
          groups: s.groups,
          trade: s.trade,
          civilians: s.civilians.map((c) => ({
            id: c.id,
            x: c.x,
            y: c.y,
            phase: c.phase,
            cargo: c.cargo,
          })),
          bodies: s.bodies.filter(
            (b) => b.kind === 'resource' || b.kind === 'derelict' || b.kind === 'ruins',
          ),
          contacts: s.contacts,
          projects: s.projects,
          history: s.history.slice(-20),
        });
      }
      if (q.op === 'act') {
        await action(q.ship, q.type, q.fields, q.mode);
        record({ event: 'action', ...q, time: (await state()).time });
      }
      if (q.op === 'nav') {
        const menu = page.getByRole('button', { name: 'MENU 导航', exact: true });
        if (await menu.isVisible()) await menu.click();
        await page
          .getByRole('navigation')
          .getByRole('button', { name: new RegExp(q.page) })
          .click();
        if (q.tab) await page.getByRole('tab', { name: q.tab, exact: true }).click();
        record({ event: 'navigation', ...q });
      }
      if (q.op === 'select') {
        const s = await state();
        if (q.kind === 'ship')
          await page
            .locator('.operation-chip')
            .filter({ hasText: s.ships.find((s) => s.id === q.id).name.split(' / ')[0] })
            .click();
        else await page.getByRole('button', { name: q.name, exact: true }).click();
        record({ event: 'selection', ...q });
      }
      if (q.op === 'fill') {
        await page.getByLabel(q.label, { exact: true }).fill(String(q.value));
      }
      if (q.op === 'option') {
        await page.getByLabel(q.label, { exact: true }).selectOption(q.value);
      }
      if (q.op === 'click') {
        await page.getByRole(q.role ?? 'button', { name: q.name, exact: true }).click();
        record({ event: 'clicked', ...q, time: (await state()).time });
      }
      if (q.op === 'escape') await page.keyboard.press('Escape');
      if (q.op === 'text')
        record({ event: 'visible', text: await page.locator('body').innerText() });
      if (q.op === 'shot') {
        const path = join(output, q.name + '.png');
        await page.screenshot({ path, animations: 'disabled' });
        record({ event: 'screenshot', path, time: (await state()).time });
      }
      if (q.op === 'check') await page.getByLabel(q.label, { exact: true }).setChecked(q.checked);
      if (q.op === 'groupAct') {
        await page
          .getByRole('button', {
            name:
              '下达 ' +
              {
                HAUL: '运输货物',
                MOVE: '移动',
                PATROL: '巡逻',
                ESCORT: '护航',
                INTERCEPT: '拦截',
                RETREAT: '撤退',
                RETURN: '返回基地',
              }[q.type],
            exact: true,
          })
          .click();
        const dialog = page.getByRole('dialog', { name: 'Admiral 指令' });
        for (const [label, value] of Object.entries(q.fields ?? {})) {
          const field = dialog.getByLabel(label, { exact: true });
          if (await field.evaluate((el) => el.tagName === 'SELECT'))
            await field.selectOption(String(value));
          else await field.fill(String(value));
        }
        await dialog.getByRole('button', { name: '下达 Admiral 指令', exact: true }).click();
        record({ event: 'group-directive', ...q, time: (await state()).time });
      }
      if (q.op === 'close') {
        await page.evaluate(() => window.frontier.save());
        record({ event: 'finished', time: (await state()).time });
        await app.close();
        process.exit(0);
      }
      console.log('READY');
    } catch (error) {
      record({ event: 'error', message: String(error) });
      await page.keyboard.press('Escape').catch(() => {});
      console.log('READY');
    }
  });
});
