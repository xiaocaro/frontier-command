import { _electron as electron } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Visible native windows, isolated user data, real UI and offline bundled fonts.
const output = resolve('docs/verification/v9');
mkdirSync(output, { recursive: true });
const results = [];
for (const scale of [1.25, 1.5, 2]) {
  const app = await electron.launch({
    args: ['--force-device-scale-factor=' + scale, resolve('.')],
    env: {
      ...process.env,
      FRONTIER_USER_DATA: mkdtempSync(join(tmpdir(), 'frontier-typography-')),
      FRONTIER_HEADLESS: '0',
    },
  });
  try {
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.context().setOffline(true);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1600, 900),
    );
    await page.getByRole('navigation', { name: '主导航' }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    const visible = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isVisible(),
    );
    if (!visible) throw Error('Native window is hidden');
    const pause = page.getByRole('button', { name: '暂停', exact: true });
    if (await pause.isVisible()) await pause.click();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '.footer-title .lcars-text-bar > span',
    });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    for (const name of ['Antonio-Bold', 'AlibabaPuHuiTiLCARS-Bold'])
      if (!fonts.some((font) => font.isCustomFont && font.postScriptName === name))
        throw Error('Missing font ' + name);
    await cdp.detach();
    const bar = page.locator('.footer-title .lcars-text-bar');
    await bar.screenshot({
      path: join(output, `typography-native-bar-${scale * 100}.png`),
      animations: 'disabled',
    });
    const box = await bar.boundingBox();
    await page.screenshot({
      path: join(output, `typography-detail-${scale * 100}.png`),
      clip: { x: box.x, y: box.y, width: Math.min(box.width, 320), height: box.height },
      animations: 'disabled',
    });
    await page.getByRole('navigation').getByRole('button', { name: /FLEET/ }).click();
    const fleet = await page.getByRole('dialog').innerText();
    if (fleet.includes('USS LONG') || fleet.includes('长名称'))
      throw Error('Test ship names leaked into native showcase');
    await page
      .getByRole('dialog')
      .screenshot({
        path: join(output, `typography-management-${scale * 100}.png`),
        animations: 'disabled',
      });
    await page.keyboard.press('Escape');
    await page.locator('.operation-chip[data-ship-id="verity"]').click();
    if ((await page.getByLabel('显示名称', { exact: true }).inputValue()) !== 'USS VERITY / 明理号')
      throw Error('Unexpected default ship name');
    await page.getByLabel('显示名称', { exact: true }).scrollIntoViewIfNeeded();
    await page
      .locator('.inspector')
      .screenshot({
        path: join(output, `typography-native-input-${scale * 100}.png`),
        animations: 'disabled',
      });
    await page.getByRole('button', { name: '新指令 / 改令', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Admiral 指令' })
      .screenshot({
        path: join(output, `typography-directives-${scale * 100}.png`),
        animations: 'disabled',
      });
    await page.keyboard.press('Escape');
    await page
      .getByRole('navigation')
      .getByRole('button', { name: /STARBASE/ })
      .click();
    await page.getByRole('tab', { name: /^ENGINEERING / }).click();
    await page
      .getByRole('dialog')
      .screenshot({
        path: join(output, `typography-native-engineering-${scale * 100}.png`),
        animations: 'disabled',
      });
    if (errors.length) throw Error(errors.join('\n'));
    results.push({ scale, visible, offline: true, fonts, normalFleetNames: true, errors });
    console.log(
      JSON.stringify({ scale, visible, fonts: fonts.map((font) => font.postScriptName), errors }),
    );
  } finally {
    await app.close();
  }
}
writeFileSync(
  join(output, 'typography-native-result.json'),
  JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2),
);
