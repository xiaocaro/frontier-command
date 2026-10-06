import { describe, it, expect } from 'vitest';
import {
  fitCamera,
  clampCamera,
  zoomCamera,
  resizeCamera,
  project,
  unproject,
  placeLabels,
  boundsOf,
} from '../src/ui/map/camera';
describe('unbounded semantic camera', () => {
  it.each([
    [1360, 740],
    [1100, 550],
    [900, 700],
  ])('fits known space and accepts negative coordinates %sx%s', (w, h) => {
    const b = boundsOf([
        { x: -2000, y: 3000 },
        { x: 2500, y: -3000 },
      ]),
      c = fitCamera(w, h, b);
    for (const p of [
      { x: -2000, y: 3000 },
      { x: 2500, y: -3000 },
    ]) {
      const view = project(p, c);
      expect(view.x).toBeGreaterThan(0);
      expect(view.y).toBeGreaterThan(0);
      expect(view.x).toBeLessThan(w);
      expect(view.y).toBeLessThan(h);
    }
  });
  it('zoom preserves pointed world coordinate; pans have no world boundaries', () => {
    const c = fitCamera(1100, 600),
      p = { x: 413, y: 290 },
      z = zoomCamera(c, c.k * 3, p);
    expect(unproject(p, z).x).toBeCloseTo(unproject(p, c).x, 8);
    expect(unproject(p, z).y).toBeCloseTo(unproject(p, c).y, 8);
    const a = clampCamera({ ...z, x: 1e6, y: -1e6 });
    expect(a.x).toBe(1e6);
    expect(a.y).toBe(-1e6);
  });
  it('resize preserves world center and scale', () => {
    const c = zoomCamera(fitCamera(1100, 600), 3, { x: 550, y: 300 }),
      r = resizeCamera(c, 800, 700);
    expect(unproject({ x: 400, y: 350 }, r)).toEqual(unproject({ x: 550, y: 300 }, c));
    expect(r.k).toBe(3);
  });
  it('labels avoid overlapping viewport entries', () => {
    const labels = placeLabels(
      Array.from({ length: 20 }, (_, i) => ({
        id: String(i),
        text: 'SHIP ' + i,
        x: 200,
        y: 200,
        priority: i,
        color: '#fff',
      })),
      400,
      400,
    );
    expect(labels.length).toBeLessThan(20);
    for (let i = 0; i < labels.length; i++)
      for (let j = i + 1; j < labels.length; j++)
        expect(
          Math.abs(labels[i].y - labels[j].y) >= 20 ||
            Math.abs(labels[i].x - labels[j].x) >= (labels[i].width + labels[j].width) / 2,
        ).toBe(true);
  });
});
