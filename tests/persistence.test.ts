import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SaveStore } from '../electron/persistence';
import { createWorld } from '../src/engine/data';
import { worldSchema } from '../src/engine/save-schema';
import { SimulationEngine } from '../src/engine/engine';
import { applyDamage } from '../src/engine/combat';
import { parseSave } from '../src/engine/saves';
import { quietEngine, run, issue } from './helpers';
const dirs: string[] = [];
const dir = () => {
  const p = mkdtempSync(join(tmpdir(), 'frontier-v9-test-'));
  dirs.push(p);
  return p;
};
afterEach(() => {
  for (const p of dirs.splice(0)) rmSync(p, { recursive: true, force: true });
});
describe('v9 timeline persistence', () => {
  it('loads isolated v9 fixtures and resumes the same physical world deterministically', () => {
    const load = (name: string) =>
      parseSave(JSON.parse(readFileSync(join('tests', 'fixtures', 'v9', name + '.json'), 'utf8')));
    const initial = load('initial');
    expect(initial.paused).toBe(true);
    expect(initial.speed).toBe(1);
    expect(initial.ships).toHaveLength(6);
    const progress = load('in-progress');
    expect(progress.ships.some((s) => s.cargo.materials > 0)).toBe(true);
    expect(progress.systems.length).toBeGreaterThan(initial.systems.length);
    const a = new SimulationEngine(progress),
      b = new SimulationEngine(load('in-progress'));
    run(a, 25);
    run(b, 25);
    expect(a.state).toEqual(b.state);
    expect(load('continued').ships.some((s) => s.modules.includes('expandedCargo'))).toBe(true);
    const terminal = new SimulationEngine(load('command-lost'));
    const frozen = structuredClone(terminal.state);
    expect(terminal.state.status).toBe('commandLost');
    terminal.advanceFrame();
    expect(terminal.state).toEqual(frozen);
  });
  it('persists reservations, ammunition and deterministic continuation', () => {
    const e = quietEngine();
    issue(
      e,
      {
        type: 'HAUL',
        sourceId: 'base',
        targetId: 'outpost',
        cargoKind: 'materials',
        amount: 20,
        route: 'direct',
        repeat: false,
      },
      'meridian',
    );
    const store = new SaveStore(dir());
    store.write(e.state);
    expect(store.read().world).toEqual(e.state);
    run(e, 10);
    store.write(e.state);
    expect(store.read().world).toEqual(e.state);
    const resumed = new SimulationEngine(store.read().world!);
    run(e, 200);
    run(resumed, 200);
    expect(resumed.state).toEqual(e.state);
  });
  it('leaves legacy files unchanged and starts an independent v9 branch', () => {
    const p = dir();
    writeFileSync(join(p, 'world-v4.json'), 'legacy');
    mkdirSync(join(p, 'frontiers-v5', 'frontier-000001'), { recursive: true });
    writeFileSync(join(p, 'frontiers-v5', 'frontier-000001', 'head.json'), 'legacy-v5');
    writeFileSync(join(p, 'timeline-v5.json'), 'legacy-v5-index');
    const store = new SaveStore(p);
    expect(store.read().world).toBeNull();
    expect(store.read().blocked).toBe(false);
    store.write(createWorld());
    expect(readFileSync(join(p, 'world-v4.json'), 'utf8')).toBe('legacy');
    expect(readFileSync(join(p, 'frontiers-v5', 'frontier-000001', 'head.json'), 'utf8')).toBe(
      'legacy-v5',
    );
    expect(readFileSync(join(p, 'timeline-v5.json'), 'utf8')).toBe('legacy-v5-index');
    expect(existsSync(store.path)).toBe(true);
    expect(store.status(0).branches).toHaveLength(1);
    expect(existsSync(join(store.root, 'frontier-000001', 'day-1.json'))).toBe(true);
  });
  it('recovers same-generation backup, preserves corrupt head, and rejects future versions', () => {
    const store = new SaveStore(dir()),
      w = createWorld();
    store.write(w);
    store.write(w);
    writeFileSync(store.path, 'bad');
    expect(store.read().world).toEqual(w);
    store.write(w);
    expect(
      readdirSync(join(store.root, 'frontier-000001')).some((n) => n.includes('corrupt')),
    ).toBe(true);
    writeFileSync(store.path, JSON.stringify({ ...w, version: 11 }));
    expect(store.read().blocked).toBe(true);
    expect(() => store.write(w)).toThrow();
  });
  it.each([1, 4, 16] as const)('captures midnight at the exact fixed step at %sx', (speed) => {
    const e = quietEngine(),
      store = new SaveStore(dir());
    store.write(e.state);
    e.state.tick = 14399;
    e.state.time = 1439.9;
    e.state.speed = speed;
    e.state.paused = false;
    e.advanceFrame((events, w) => {
      if (events.some((e) => e.type === 'dayBoundary')) store.daily(w);
    });
    const snap = JSON.parse(
      readFileSync(join(store.root, 'frontier-000001', 'day-2.json'), 'utf8'),
    );
    expect(snap.tick).toBe(14400);
    expect(snap.time).toBe(1440);
    expect(e.state.tick).toBe(14399 + speed);
    const bytes = readFileSync(join(store.root, 'frontier-000001', 'day-2.json'), 'utf8');
    store.write(e.state);
    expect(readFileSync(join(store.root, 'frontier-000001', 'day-2.json'), 'utf8')).toBe(bytes);
  });
  it('forks Day 3 failure to Day 2 midnight without overwriting failed records, including restart', () => {
    const e = quietEngine(),
      p = dir(),
      store = new SaveStore(p);
    store.write(e.state);
    e.state.tick = 14400;
    e.state.time = 1440;
    store.daily(e.state);
    const day2 = structuredClone(e.state);
    e.state.tick = 30000;
    e.state.time = 3000;
    applyDamage(e, e.state.ships[0], 10000);
    applyDamage(e, e.base, 10000);
    e.finishCritical();
    store.write(e.state);
    const failure = readFileSync(join(store.root, 'frontier-000001', 'failure.json'), 'utf8');
    const restored = store.restorePreviousDay(e.state);
    expect(restored).toEqual(day2);
    expect(store.status(restored.tick).activeId).toBe('frontier-000002');
    expect(store.status(restored.tick).branches[0].status).toBe('commandLost');
    expect(store.status(restored.tick).branches[1].parent).toEqual({
      id: 'frontier-000001',
      day: 2,
    });
    store.write(restored);
    expect(readFileSync(join(store.root, 'frontier-000001', 'failure.json'), 'utf8')).toBe(failure);
    expect(new SaveStore(p).read().world).toEqual(restored);
  });
  it('has no previous day on Day 1 and new frontier preserves terminal records', () => {
    const e = quietEngine(),
      store = new SaveStore(dir());
    store.write(e.state);
    applyDamage(e, e.base, 10000);
    e.finishCritical();
    store.write(e.state);
    const old = store.path,
      bytes = readFileSync(old, 'utf8');
    expect(store.status(e.state.tick).previousDay).toBeNull();
    expect(() => store.restorePreviousDay(e.state)).toThrow();
    store.beginNew(createWorld(), e.state);
    expect(readFileSync(old, 'utf8')).toBe(bytes);
    expect(store.status(0).branches).toHaveLength(2);
  });
  it('rejects invalid assignments, clock, live dead ships and ammunition reservations', () => {
    const mutations: ((w: ReturnType<typeof createWorld>) => void)[] = [
      (w) => {
        w.tick = 1;
      },
      (w) => {
        w.ships[0].hull = 0;
      },
      (w) => {
        w.ships[0].core = 9999;
      },
      (w) => {
        w.assignments[0].shipId = w.assignments[1].shipId;
      },
      (w) => {
        w.ships[0].modules = ['expandedCargo', 'longRangeSensors', 'deepScan'];
      },
      (w) => {
        w.locations[0].stock.materials = -2;
      },
    ];
    for (const mutate of mutations) {
      const w = createWorld();
      mutate(w);
      expect(worldSchema.safeParse(w).success).toBe(false);
    }
  });
  it('terminal record takes precedence over a corrupt head and a living backup', () => {
    const e = quietEngine(),
      p = dir(),
      store = new SaveStore(p);
    store.write(e.state);
    applyDamage(e, e.base, 10000);
    e.finishCritical();
    store.write(e.state);
    writeFileSync(store.path, 'corrupt');
    expect(new SaveStore(p).read().world?.status).toBe('commandLost');
    writeFileSync(join(store.root, 'frontier-000001', 'failure.json'), 'corrupt');
    expect(new SaveStore(p).read().blocked).toBe(true);
  });
  it('a failed branch write preserves the active branch and terminal world', () => {
    const e = quietEngine(),
      p = dir(),
      store = new SaveStore(p);
    store.write(e.state);
    e.state.tick = 14400;
    e.state.time = 1440;
    store.daily(e.state);
    e.state.tick = 28800;
    e.state.time = 2880;
    applyDamage(e, e.base, 10000);
    e.finishCritical();
    store.write(e.state);
    const before = structuredClone(e.state),
      index = readFileSync(store.indexPath, 'utf8');
    mkdirSync(store.indexPath + '.tmp');
    expect(() => store.restorePreviousDay(e.state)).toThrow();
    expect(e.state).toEqual(before);
    expect(readFileSync(store.indexPath, 'utf8')).toBe(index);
    expect(store.status(e.state.tick).activeId).toBe('frontier-000001');
  });
  it('supports all ships destroyed and vacant independent operator identities', () => {
    const e = quietEngine();
    for (const s of [...e.state.ships]) applyDamage(e, s, 10000);
    e.finishCritical();
    expect(e.state.ships).toHaveLength(0);
    expect(e.state.losses).toHaveLength(6);
    expect(worldSchema.safeParse(e.state).success).toBe(true);
    const store = new SaveStore(dir());
    store.write(e.state);
    expect(store.read().world?.losses).toHaveLength(6);
  });
});
