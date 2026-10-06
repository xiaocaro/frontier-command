import { describe, it, expect } from 'vitest';
import { createWorld } from '../src/engine/data';
import { generatedSector, materialize } from '../src/engine/world-generation';
import { routeEstimate, planRoute, dist } from '../src/engine/navigation';
import { quietEngine } from './helpers';
describe('seeded sparse sectors and physical navigation', () => {
  it('sector content is independent of exploration order and world RNG', () => {
    const a = createWorld(42),
      b = createWorld(42);
    materialize(a, { q: 10, r: -9 });
    materialize(a, { q: -6, r: 5 });
    materialize(b, { q: -6, r: 5 });
    b.seed = 999;
    materialize(b, { q: 10, r: -9 });
    expect(a.systems.filter((s) => s.sectorId === 'sector:10:-9')).toEqual(
      b.systems.filter((s) => s.sectorId === 'sector:10:-9'),
    );
    expect(a.bodies.filter((s) => s.id.startsWith('sector:10:-9'))).toEqual(
      b.bodies.filter((s) => s.id.startsWith('sector:10:-9')),
    );
  });
  it('different seeds change content and barren systems coexist with diverse discoveries', () => {
    expect(generatedSector(1, { q: 0, r: -1 })).not.toEqual(generatedSector(2, { q: 0, r: -1 }));
    const worlds = Array.from({ length: 100 }, (_, q) => generatedSector(42, { q, r: 20 }));
    expect(worlds.some((g) => !g.bodies.some((b) => b.kind === 'resource'))).toBe(true);
    const bodies = worlds.flatMap((g) => g.bodies);
    expect(new Set(bodies.map((b) => b.category)).size).toBeGreaterThan(10);
    expect(bodies.some((b) => b.kind === 'planet' && b.habitable)).toBe(true);
    expect(bodies.some((b) => b.kind === 'resource' && b.remaining > 0)).toBe(true);
  });
  it('safe is direct without observed danger while risky changes ETA/risk without a rectangular edge', () => {
    const e = quietEngine(),
      s = e.state.ships[0],
      to = e.state.locations.find((l) => l.id === 'mine')!,
      w = e.snapshot();
    const safe = routeEstimate(w, s, to, 'safe'),
      direct = routeEstimate(w, s, to, 'direct'),
      risky = routeEstimate(w, s, to, 'risky');
    expect(safe.eta).toBe(direct.eta);
    expect(planRoute(e.state,s,to,'safe')).toEqual([{x:to.x,y:to.y}]);
    expect(risky.eta).toBeLessThan(direct.eta);
    expect(risky.risk).not.toBe(safe.risk);
    const p = planRoute(e.state, s, { x: -100000, y: 200000 }, 'direct');
    expect(p.at(-1)).toEqual({ x: -100000, y: 200000 });
    expect(dist(e.base, to)).toBeGreaterThan(400);
  });
  it('route uncertainty measures actual uncharted portions, including sector-edge overlap', () => {
    const e = quietEngine(),
      s = e.state.ships[0];
    const chart = e.snapshot();
    expect(routeEstimate(chart, s, e.base, 'direct').unknownDistance).toBe(0);
    s.x = -240;
    s.y = 0;
    const estimate = routeEstimate(chart, s, { x: 2000, y: 0 }, 'direct');
    expect(estimate.distance).toBe(2240);
    expect(estimate.unknownDistance).toBeCloseTo(1400);
    s.y = 200;
    expect(routeEstimate(chart, s, { x: 600, y: 200 }, 'direct').unknownDistance).toBeCloseTo(0);
  });
});
