import { expect, type Page } from '@playwright/test';

export async function inspectTitleBars(page: Page) {
  const bars = await page.locator('.lcars-text-bar:visible').evaluateAll((nodes) =>
    nodes.map((el) => ({
      title: el.textContent,
      weight: getComputedStyle(el).fontWeight,
      ends: ['::before', '::after'].map((part) => {
        const style = getComputedStyle(el, part);
        return {
          background: style.backgroundColor,
          image: style.backgroundImage,
          borders: [
            style.borderTopWidth,
            style.borderRightWidth,
            style.borderBottomWidth,
            style.borderLeftWidth,
          ],
        };
      }),
    })),
  );
  expect(bars.length).toBeGreaterThan(0);
  for (const bar of bars) {
    expect(bar.weight, bar.title ?? '').toBe('700');
    for (const end of bar.ends) {
      expect(end.background, bar.title ?? '').toBe('rgb(234, 156, 114)');
      expect(end.image, bar.title ?? '').toBe('none');
      expect(end.borders, bar.title ?? '').toEqual(['0px', '0px', '0px', '0px']);
    }
  }
  return bars;
}

export async function inspectTypography(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument');
  const fonts: Record<string, unknown> = {};
  for (const [kind, selector, expected] of [
    ['chineseRegular', '.section-nav button span', ['AlibabaPuHuiTiLCARS-Regular']],
    ['englishRegular', '.section-nav button b', ['Antonio-Regular']],
    [
      'mixedBold',
      '.footer-title .lcars-text-bar > span',
      ['Antonio-Bold', 'AlibabaPuHuiTiLCARS-Bold'],
    ],
  ] as const) {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    const result = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    fonts[kind] = result.fonts;
    for (const name of expected)
      expect(
        result.fonts.some((f) => f.isCustomFont && f.postScriptName === name),
        JSON.stringify(result.fonts),
      ).toBe(true);
  }
  await cdp.detach();
  const measured = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 180;
    const ctx = canvas.getContext('2d')!;
    const family = getComputedStyle(document.documentElement).fontFamily;
    const inkMetrics = [400, 700].flatMap((weight) => {
      ctx.font = `${weight} 100px ${family}`;
      return [
        ['FLEET DIRECTIVES', '舰队指令'],
        ['PRIORITY COMMUNICATIONS', '优先通信'],
        ['CONTEXT INSPECTOR', '对象详情'],
        ['STEALTH RECONNAISSANCE', '隐形侦察'],
      ].map(([enText, zhText]) => {
        const en = ctx.measureText(enText),
          zh = ctx.measureText(zhText);
        return {
          weight,
          enText,
          zhText,
          topDifference: Math.abs(en.actualBoundingBoxAscent - zh.actualBoundingBoxAscent),
          bottomDifference: Math.abs(en.actualBoundingBoxDescent - zh.actualBoundingBoxDescent),
          heightDifference: Math.abs(
            en.actualBoundingBoxAscent +
              en.actualBoundingBoxDescent -
              zh.actualBoundingBoxAscent -
              zh.actualBoundingBoxDescent,
          ),
        };
      });
    });
    // Integrate antialiased coverage through real glyph stems. Using only a
    // binary pixel bounding box can turn a subpixel difference into 12% error.
    function strokes(char: string, weight: number) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = `${weight} 100px ${family}`;
      ctx.fillStyle = '#fff';
      ctx.fillText(char, 30, 130);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const alpha = (x: number, y: number) => data[(y * canvas.width + x) * 4 + 3] / 255;
      let left = canvas.width,
        right = 0,
        top = canvas.height,
        bottom = 0;
      for (let y = 0; y < canvas.height; y++)
        for (let x = 0; x < canvas.width; x++) {
          if (alpha(x, y) > 0.5) {
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
        }
      const midX = Math.round((left + right) / 2);
      const quarterY = Math.round(bottom - (bottom - top) * 0.25);
      function spans(vertical: boolean) {
        const widths: number[] = [];
        let sum = 0;
        const size = vertical ? canvas.height : canvas.width;
        for (let i = 0; i < size; i++) {
          const a = vertical ? alpha(midX, i) : alpha(i, quarterY);
          if (a > 0) sum += a;
          else if (sum > 0) {
            widths.push(sum);
            sum = 0;
          }
        }
        widths.sort((a, b) => a - b);
        return widths[Math.floor(widths.length / 2)];
      }
      return { vertical: spans(false), horizontal: spans(true) };
    }
    const strokeMetrics = [400, 700].map((weight) => {
      const en = strokes('H', weight),
        zh = strokes('日', weight);
      return {
        weight,
        en,
        zh,
        verticalDifference: Math.abs(zh.vertical / en.vertical - 1),
        horizontalDifference: Math.abs(zh.horizontal / en.horizontal - 1),
      };
    });
    return {
      inkMetrics,
      strokeMetrics,
      synthesis: getComputedStyle(document.documentElement).fontSynthesis,
    };
  });
  expect(measured.synthesis).toBe('none');
  for (const metrics of measured.inkMetrics) {
    expect(metrics.topDifference, JSON.stringify(metrics)).toBeLessThanOrEqual(2);
    expect(metrics.bottomDifference, JSON.stringify(metrics)).toBeLessThanOrEqual(2);
    expect(metrics.heightDifference, JSON.stringify(metrics)).toBeLessThanOrEqual(2);
  }
  for (const metrics of measured.strokeMetrics) {
    expect(metrics.verticalDifference, JSON.stringify(metrics)).toBeLessThanOrEqual(0.1);
    expect(metrics.horizontalDifference, JSON.stringify(metrics)).toBeLessThanOrEqual(0.1);
  }
  return { fonts, ...measured };
}
