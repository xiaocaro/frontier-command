import { describe, it, expect } from 'vitest';
import { SimulationEngine } from '../src/engine/engine';
import { quietEngine, issue, run } from './helpers';
import { parseSave } from '../src/engine/saves';
import { SHIP_CLASSES } from '../src/engine/definitions/ships';
import { makeEnemy } from '../src/engine/data';
import { updateSensors } from '../src/engine/sensors';
describe('authoritative v9 world, deterministic replay, Agent boundary', () => {
  it('operator ports expose only observations and validated own-ship actions; Admiral takes priority', () => {
    const e = quietEngine(),
      port = e.controllerPort('ops-verity');
    expect(port.getObservation()?.ship.id).toBe('verity');
    expect(Object.keys(port).sort()).toEqual(['getObservation', 'submitAction']);
    expect(port.submitAction({ type: 'MOVE', point: { x: 10, y: 10 } }).ok).toBe(true);
    expect(port.submitAction({ type: 'DOCK', targetId: 'base' }).ok).toBe(false);
    expect(
      e.dispatchCommand(
        {
          type: 'issueDirective',
          shipIds: ['vigil'],
          mode: 'REPLACE',
          action: { type: 'DOCK', targetId: 'base' },
        },
        'ops-verity',
      ).ok,
    ).toBe(false);
    expect(e.controllerPort('unknown').getObservation()).toBeNull();
    const snap = e.snapshot();
    Object.assign(snap.ships[0], { hull: 0 });
    expect(e.state.ships[0].hull).toBeGreaterThan(0);
  });
  it('configuration is immutable and worlds independent', () => {
    expect(Object.isFrozen(SHIP_CLASSES.galaxy.weapons)).toBe(true);
    const a = quietEngine(),
      b = quietEngine();
    a.state.ships[0].hull = 1;
    expect(b.state.ships[0].hull).toBe(110);
  });
  it('same seed and commands replay identically including ecology and losses', () => {
    const a = new SimulationEngine(),
      b = new SimulationEngine();
    for (const e of [a, b]) {
      issue(e, { type: 'EXPLORE', sector: { q: 0, r: -1 }, approach: 'remote' });
      issue(
        e,
        {
          type: 'HAUL',
          sourceId: 'mine',
          targetId: 'base',
          cargoKind: 'materials',
          amount: 50,
          route: 'direct',
          repeat: false,
        },
        'meridian',
      );
      run(e, 600);
    }
    expect(a.state).toEqual(b.state);
  });
  it('save during travel, mining and suspended haul resumes exactly', () => {
    const a = new SimulationEngine();
    issue(
      a,
      {
        type: 'HAUL',
        sourceId: 'base',
        targetId: 'outpost',
        cargoKind: 'materials',
        amount: 40,
        route: 'risky',
        repeat: false,
      },
      'meridian',
    );
    run(a, 8);
    issue(a, { type: 'MOVE', point: { x: 20, y: -100 } }, 'meridian', 'INTERRUPT');
    issue(a, { type: 'EXPLORE', sector: { q: 0, r: 1 }, approach: 'close' });
    run(a, 10);
    const b = new SimulationEngine(parseSave(JSON.parse(JSON.stringify(a.state))));
    run(a, 500);
    run(b, 500);
    expect(b.state).toEqual(a.state);
  });
  it('public snapshot excludes hidden geography, faction stocks, RNG and intentions; lost contacts freeze', () => {
    const e = quietEngine(),
      enemy = makeEnemy('secret', 'raider', 'orion', { x: e.base.x + 20, y: e.base.y });
    e.state.enemies.push(enemy);
    updateSensors(e);
    const p = e.snapshot(),
      i = p.contacts[0];
    expect(i).toBeDefined();
    expect('enemies' in p || 'seed' in p || 'factions' in p).toBe(false);
    expect(p.locations.some((l) => l.id === 'orion-base')).toBe(false);
    expect(p.bodies.some((b) => b.hidden)).toBe(false);
    enemy.x = 9999;
    run(e, 5);
    expect(e.snapshot().contacts[0].x).toBe(i.x);
    expect(e.snapshot().contacts[0].live).toBe(false);
    run(e, 31);
    expect(e.snapshot().contacts).toEqual([]);
  });
  it('unsupported saves and impossible inventories, slots and refs are rejected', () => {
    const e = quietEngine();
    for (const version of [5, 6, 7, 8, 11])
      expect(() => parseSave({ ...e.state, version })).toThrow();
    for (const change of [
      (w: typeof e.state) => {
        w.ships[0].cargo.materials = 9999;
      },
      (w: typeof e.state) => {
        w.bodies[0].systemId = 'unknown';
      },
      (w: typeof e.state) => {
        w.ships[0].modules = ['deepScan', 'longRangeSensors', 'expandedCargo'];
      },
    ]) {
      const w = structuredClone(e.state);
      change(w);
      expect(() => parseSave(w)).toThrow();
    }
  });
});
