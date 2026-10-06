import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { quietEngine, issue, run, until } from './helpers';
import { makeLocation, makeEnemy } from '../src/engine/data';
import { SimulationEngine } from '../src/engine/engine';
import { parseSave } from '../src/engine/saves';
import { SaveStore } from '../electron/persistence';
import { capabilities } from '../src/engine/capabilities';
import { pairedSector, fixedPassage } from '../src/engine/wormhole-pairs';
import { materialize } from '../src/engine/world-generation';
import { advanceEnemy, advanceFactions } from '../src/engine/threats';
import { rearmPreview } from '../src/ui/rearm';
import { viewportGrid, fitCamera, project, clusterMarkers } from '../src/ui/map/camera';
import { displayEntityName, worldText } from '../src/ui/localization';
import { describe as describeAction } from '../src/ui/format';

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + '\\')) throw Error('Unsafe test cleanup');
    rmSync(dir, { recursive: true, force: true });
  }
});
function captureWorld() {
  const e = quietEngine();
  e.state.resources.credits = 4000;
  e.base.stock.materials = 600;
  const l = e.state.locations.find((l) => l.id === 'orion-base')!;
  l.discovered = true;
  e.hit(l, l.hull + l.shield + 1);
  const ship = e.state.ships[2];
  ship.x = l.x;
  ship.y = l.y;
  return { e, l, ship };
}
describe('v10 production, capture and persistent world', () => {
  it('manufactures both ammunition types before upgrades and halves upgraded manufacturing time', () => {
    const e = quietEngine();
    for (const cargoKind of ['photon', 'quantum'] as const)
      expect(e.dispatchCommand({ type: 'manufacture', cargoKind, amount: 2 }).ok).toBe(true);
    const duration = e.state.jobs.at(-1)!.duration;
    e.state.upgrades.armory = 1;
    expect(e.dispatchCommand({ type: 'manufacture', cargoKind: 'quantum', amount: 2 }).ok).toBe(
      true,
    );
    expect(e.state.jobs.at(-1)!.duration).toBe(duration / 2);
    run(e, 4);
    expect(e.base.stock.quantum).toBe(24);
  });
  it('actual discovery permanently discounts production only, with exact fractional material payment', () => {
    const e = quietEngine();
    e.state.resources.credits = 3000;
    e.base.stock.materials = 500;
    e.state.upgrades.shipyard = 1;
    const body = {
      ...e.state.bodies[0],
      id: 'discount-anomaly',
      kind: 'anomaly' as const,
      hidden: false,
      discovered: true,
      specialClaimed: false,
      hazard: 0,
    };
    e.state.bodies.push(body);
    e.state.systems.find((s) => s.id === body.systemId)!.bodyIds.push(body.id);
    const ship = e.state.ships[2];
    ship.x = body.x;
    ship.y = body.y;
    issue(e, { type: 'SURVEY', targetId: body.id, approach: 'close', deep: false }, ship.id);
    until(e, () => !ship.current);
    expect(ship.cargo.specialFinds).toBe(1);
    expect(e.state.productionDiscountUnlocked).toBe(true);
    const before = { ...e.base.stock },
      budget = e.state.resources.credits;
    expect(e.dispatchCommand({ type: 'manufacture', cargoKind: 'photon', amount: 3 }).ok).toBe(
      true,
    );
    expect(e.base.stock.materials).toBe(before.materials - 1.5);
    expect(e.state.resources.credits).toBe(budget - 3);
    expect(e.snapshot().production.ships.galaxy.actual).toEqual({
      credits: 430,
      materials: 50,
      specialFinds: 0,
    });
    ship.cargo.specialFinds = 0;
    const restored = new SimulationEngine(parseSave(e.state));
    const b = restored.base.stock.materials;
    expect(
      restored.dispatchCommand({ type: 'buildShip', classId: 'galaxy', name: '测试银河' }).ok,
    ).toBe(true);
    expect(restored.base.stock.materials).toBe(b - 50);
    expect(restored.state.history.filter((h) => h.kind === 'productionDiscount')).toHaveLength(1);
  });
  it('Galaxy capacity is distinct from initial ammunition, and its independent movement is faster', () => {
    const e = quietEngine(),
      galaxy = e.state.ships.find((s) => s.classId === 'galaxy')!;
    expect([galaxy.photon, galaxy.quantum]).toEqual([36, 12]);
    expect([
      capabilities(galaxy).photon,
      capabilities(galaxy).quantum,
      capabilities(galaxy).warp,
    ]).toEqual([250, 50, 10]);
    const patrol = e.state.ships.find((s) => s.classId === 'peregrine')!;
    for (const s of [galaxy, patrol]) {
      s.x = 0;
      s.y = 0;
      issue(e, { type: 'MOVE', point: { x: -1000, y: 0 } }, s.id);
    }
    run(e, 1);
    expect(Math.abs(galaxy.x)).toBeGreaterThan(Math.abs(patrol.x));
    galaxy.engines = 50;
    expect(capabilities(galaxy).warp).toBe(5);
  });
  it('rearm reserves real stock, rejects overcommit, and replacement releases its own reservations', () => {
    const e = quietEngine(),
      ship = e.state.ships.find((s) => s.classId === 'galaxy')!;
    ship.x = e.base.x;
    ship.y = e.base.y;
    expect(
      issue(e, { type: 'REARM', targetId: 'base', load: { photon: 80, quantum: 5 } }, ship.id).ok,
    ).toBe(true);
    expect(e.snapshot().armory.reserved.photon).toBe(80);
    expect(
      issue(e, { type: 'REARM', targetId: 'base', load: { photon: 15, quantum: 0 } }, 'verity').ok,
    ).toBe(false);
    const preview = rearmPreview(e.snapshot(), [ship.id], 'base', 'REPLACE', {
      photon: 90,
      quantum: 0,
    });
    expect(preview.availability.photon).toBe(90);
    expect(preview.maximum.photon).toBe(90);
    expect(
      issue(e, { type: 'REARM', targetId: 'base', load: { photon: 90, quantum: 0 } }, ship.id).ok,
    ).toBe(true);
    until(e, () => !ship.current);
    expect([e.base.stock.photon, ship.photon]).toEqual([0, 126]);
    expect(() => parseSave(e.state)).not.toThrow();
  });
  it('capture pauses under fire, survives interruption and rebuilds the same ID using hauled material', () => {
    const { e, l, ship } = captureWorld();
    expect(l.occupation).toBe('ruined');
    expect(issue(e, { type: 'CAPTURE', targetId: l.id }, ship.id).ok).toBe(true);
    expect(issue(e, { type: 'CAPTURE', targetId: l.id }, 'vigil').ok).toBe(false);
    run(e, 3);
    const work = ship.current!.work;
    ship.attackedAt = e.state.time;
    run(e, 1);
    expect(ship.current!.work).toBe(work);
    issue(e, { type: 'MOVE', point: { x: ship.x, y: ship.y } }, ship.id, 'INTERRUPT');
    run(e, 0.1);
    expect(ship.current?.action.type).toBe('CAPTURE');
    expect(ship.current?.work).toBe(work);
    const resumed = new SimulationEngine(parseSave(e.state));
    run(e, 20);
    run(resumed, 20);
    expect(resumed.state).toEqual(e.state);
    expect(l.owner).toBe('starfleet');
    expect(l.occupation).toBe('secured');
    expect(
      e.dispatchCommand({ type: 'startBaseRefit', locationId: l.id, name: '前进基地' }).ok,
    ).toBe(true);
    expect(e.dispatchCommand({ type: 'startBaseRefit', locationId: l.id, name: '重复' }).ok).toBe(
      false,
    );
    const p = e.state.projects.at(-1)!;
    run(e, 35);
    expect(p.work).toBe(0);
    const transport = e.state.ships[0];
    transport.x = e.base.x;
    transport.y = e.base.y;
    issue(
      e,
      {
        type: 'HAUL',
        sourceId: 'base',
        targetId: p.id,
        cargoKind: 'materials',
        amount: 105,
        route: 'direct',
        repeat: false,
      },
      transport.id,
    );
    until(e, () => p.complete, 500);
    expect(l.kind).toBe('base');
    expect(l.occupation).toBeNull();
    expect(l.stock.materials).toBe(5);
    expect(e.state.locations.filter((x) => x.id === l.id)).toHaveLength(1);
    expect(() => parseSave(e.state)).not.toThrow();
  });
  it('queued rearm waits for actual future stock without reserving goods before it starts', () => {
    const e = quietEngine(),
      ship = e.state.ships.find((s) => s.classId === 'galaxy')!;
    e.base.stock.photon = 0;
    ship.x = e.base.x;
    ship.y = e.base.y;
    issue(e, { type: 'MOVE', point: { x: ship.x, y: ship.y } }, ship.id);
    const load = { photon: 20, quantum: 0 };
    expect(rearmPreview(e.snapshot(), [ship.id], 'base', 'QUEUE', load).error).toBe('');
    expect(issue(e, { type: 'REARM', targetId: 'base', load }, ship.id, 'QUEUE').ok).toBe(true);
    expect(e.snapshot().armory.reserved.photon).toBe(0);
    run(e, 1);
    expect(ship.current?.action.type).toBe('REARM');
    expect(ship.current?.reserved.photon).toBe(0);
    const before = ship.photon;
    expect(e.dispatchCommand({ type: 'manufacture', cargoKind: 'photon', amount: 20 }).ok).toBe(
      true,
    );
    until(e, () => !ship.current);
    expect(ship.photon).toBe(before + 20);
    expect(e.base.stock.photon).toBe(0);
    expect(() => parseSave(e.state)).not.toThrow();
  });
  it('destroyed production cancels permanently and permits retrying its upgrade at a working base', () => {
    const e = quietEngine();
    e.state.resources.credits = 5000;
    e.base.stock.materials = 500;
    const base = makeLocation('secondary', '前进基地', 'base', { x: 2000, y: 2000 });
    base.stock.materials = 500;
    e.state.locations.push(base);
    expect(
      e.dispatchCommand({ type: 'upgrade', upgradeId: 'logistics', locationId: base.id }).ok,
    ).toBe(true);
    run(e, 1);
    const lost = e.state.jobs[0];
    e.hit(base, base.hull + base.shield + 1);
    expect(lost.cancelled).toBe(true);
    expect(lost.complete).toBe(false);
    expect(
      e.dispatchCommand({ type: 'upgrade', upgradeId: 'logistics', locationId: 'base' }).ok,
    ).toBe(true);
    const restored = new SimulationEngine(parseSave(e.state));
    run(e, 20);
    run(restored, 20);
    expect(e.state.upgrades.logistics).toBe(1);
    expect(lost.work).toBeCloseTo(1);
    expect(restored.state).toEqual(e.state);
    expect(e.state.history.filter((h) => h.kind === 'industryLost')).toHaveLength(1);
  });
  it('new ship names are literal in the inspector, history and action notes', () => {
    const e = quietEngine();
    const name = 'Hull / My Galaxy';
    expect(e.dispatchCommand({ type: 'buildShip', classId: 'peregrine', name }).ok).toBe(true);
    until(e, () => e.state.ships.some((s) => s.name === name));
    const w = new SimulationEngine(parseSave(e.state)).snapshot();
    const ship = w.ships.find((s) => s.name === name)!;
    expect(displayEntityName(w, ship)).toBe(name);
    expect(worldText(w, name + ' 新舰服役')).toBe(name + ' 新舰服役');
    expect(describeAction('Escort ' + name, w)).toBe('护航 ' + name);
  });
  it('capturing Romulan facilities persists its political consequence and cannot repeat', () => {
    const e = quietEngine();
    const ruin = makeLocation(
      'romulan-ruin',
      '罗慕伦前哨',
      'outpost',
      { x: 2000, y: 2000 },
      'romulan',
    );
    ruin.discovered = true;
    e.state.locations.push(ruin);
    e.hit(ruin, ruin.hull + ruin.shield + 1);
    const ship = e.state.ships[2];
    ship.x = ruin.x;
    ship.y = ruin.y;
    expect(issue(e, { type: 'CAPTURE', targetId: ruin.id }, ship.id).ok).toBe(true);
    until(e, () => !ship.current);
    expect(e.state.history.find((h) => h.kind === 'diplomacy')?.text).toContain('紧张度提高 20');
    expect(e.state.tension).toBeGreaterThan(0);
    expect(issue(e, { type: 'CAPTURE', targetId: ruin.id }, ship.id).ok).toBe(false);
    expect(new SimulationEngine(parseSave(e.state)).state.history).toEqual(e.state.history);
  });
  it('secondary bases use local stock and cease delivery while destroyed', () => {
    const e = quietEngine();
    e.state.resources.credits = 3000;
    const base = makeLocation('secondary', '前进基地', 'base', { x: 2000, y: 2000 });
    e.state.locations.push(base);
    const stock = e.base.stock.materials;
    expect(
      e.dispatchCommand({
        type: 'manufacture',
        cargoKind: 'quantum',
        amount: 2,
        locationId: base.id,
      }).ok,
    ).toBe(false);
    base.stock.materials = 100;
    expect(
      e.dispatchCommand({
        type: 'manufacture',
        cargoKind: 'quantum',
        amount: 2,
        locationId: base.id,
      }).ok,
    ).toBe(true);
    expect(e.base.stock.materials).toBe(stock);
    expect(base.stock.materials).toBe(96);
    e.hit(base, base.shield + base.hull + 1);
    run(e, 10);
    expect(e.state.jobs[0].work).toBe(0);
    expect(base.stock.quantum).toBe(0);
  });
  it('Orion cannot repair, rearm or manufacture at a captured home', () => {
    const e = quietEngine(),
      base = e.state.locations.find((l) => l.id === 'orion-base')!;
    base.owner = 'starfleet';
    base.stock.materials = 100;
    base.stock.photon = 50;
    const enemy = makeEnemy('orion-survivor', 'raider', 'orion', base, base.id);
    enemy.hull = 1;
    enemy.photon = 0;
    enemy.intent = 'docked';
    enemy.nextDecision = 999;
    e.state.enemies.push(enemy);
    const stock = { ...base.stock };
    for (let i = 0; i < 400; i++) {
      advanceEnemy(e, enemy, 0.1);
      advanceFactions(e, 0.1);
    }
    expect(base.stock).toEqual(stock);
    expect(enemy.hull).toBe(1);
    expect(enemy.photon).toBe(0);
    expect(e.state.enemies).toHaveLength(1);
    expect(() => parseSave(e.state)).not.toThrow();
  });
  it('seeded remote pairing is reversible, dispersed and does not consume mutable RNG', () => {
    const e = quietEngine();
    const seed = e.state.seed;
    const endpoints = new Set<string>();
    for (let q = -5; q < 5; q++)
      for (let r = -5; r < 5; r++) {
        const origin = { q, r };
        if (fixedPassage(origin)) continue;
        const exit = pairedSector(e.state.initialSeed, origin);
        expect(Math.max(Math.abs(exit.q - q), Math.abs(exit.r - r))).toBeGreaterThanOrEqual(8);
        expect(pairedSector(e.state.initialSeed, exit)).toEqual(origin);
        endpoints.add(exit.q + ':' + exit.r);
      }
    expect(endpoints.size).toBe(99);
    expect(e.state.seed).toBe(seed);
    for (const pairingSeed of [0, 1, 42, 236807, 4294967295]) {
      for (let q = 0; q < 224; q++) {
        for (let r = 0; r < 32; r++) {
          const origin = { q, r };
          const exit = pairedSector(pairingSeed, origin);
          expect(pairedSector(pairingSeed, exit)).toEqual(origin);
          if (!fixedPassage(origin)) {
            expect(fixedPassage(exit)).toBe(false);
            expect(Math.max(Math.abs(exit.q - q), Math.abs(exit.r - r))).toBeGreaterThanOrEqual(8);
          }
        }
      }
    }
  });
  it('migrates an entire v9 timeline without changing original files or asset positions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'frontier-v10-migration-'));
    directories.push(dir);
    const original = readFileSync('tests/fixtures/v9/in-progress.json', 'utf8');
    const branch = { id: 'frontier-000001', parent: null };
    const source = join(dir, 'frontiers-v9', branch.id);
    mkdirSync(source, { recursive: true });
    for (const file of ['head.json', 'head.json.bak', 'day-1.json'])
      writeFileSync(join(source, file), original);
    const index = JSON.stringify({ version: 9, activeId: branch.id, branches: [branch] });
    writeFileSync(join(dir, 'timeline-v9.json'), index);
    const store = new SaveStore(dir);
    const loaded = store.read();
    expect(loaded.blocked).toBe(false);
    expect(loaded.world?.version).toBe(10);
    expect(loaded.world?.ships.map((s) => [s.id, s.x, s.y, s.photon, s.quantum])).toEqual(
      JSON.parse(original).ships.map(
        (s: { id: string; x: number; y: number; photon: number; quantum: number }) => [
          s.id,
          s.x,
          s.y,
          s.photon,
          s.quantum,
        ],
      ),
    );
    expect(readFileSync(join(source, 'head.json'), 'utf8')).toBe(original);
    expect(readFileSync(join(dir, 'timeline-v9.json'), 'utf8')).toBe(index);
    expect(store.root).toContain('frontiers-v10');
    const next = new SimulationEngine(loaded.world!);
    run(next, 5);
    store.write(next.state);
    expect(store.read().world).toEqual(next.state);
    expect(store.restorePreviousDay({ ...next.state, tick: 14400, time: 1440 }).version).toBe(10);
  });
  it('legacy ordinary portals are rerouted while explored sectors and fixed passage persist', () => {
    const old: unknown = JSON.parse(readFileSync('tests/fixtures/v9/initial.json', 'utf8'));
    const current = parseSave(old);
    const generation = materialize(current, { q: 0, r: -1 });
    current.wormholes = current.wormholes.filter((h) => h.id !== 'wormhole:0:-1');
    current.wormholes.push({
      ...current.wormholes[0],
      id: 'wormhole:0:-1',
      name: '亚空间通道 0/-1',
      sectorId: generation.id,
      x: 90,
      y: -480,
      exit: { x: 90, y: 5120 },
      exitSector: { q: 0, r: 13 },
      transits: 1,
    });
    const legacy = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
    legacy.version = 9;
    delete legacy.productionDiscountUnlocked;
    delete legacy.renamedEntityIds;
    legacy.locations = current.locations.map(({ occupation: _, ...l }) => l);
    const migrated = parseSave(legacy);
    expect(migrated.wormholes.find((h) => h.id === 'wormhole:0:-1')!.exitSector.q).not.toBe(0);
    expect(migrated.wormholes.find((h) => h.id === 'wormhole:0:0')!.exitSector).toEqual({
      q: 0,
      r: 12,
    });
    expect(migrated.sectors).toEqual(current.sectors);
  });
  it('preserves custom bilingual-looking names and migration failures leave v9 files untouched', () => {
    const e = quietEngine();
    e.dispatchCommand({ type: 'renameEntity', entityId: 'horizon', name: 'My Ship / 自定义' });
    const w = new SimulationEngine(parseSave(e.state)).snapshot();
    expect(displayEntityName(w, w.ships.find((s) => s.id === 'horizon')!)).toBe('My Ship / 自定义');
    const dir = mkdtempSync(join(tmpdir(), 'frontier-v10-bad-migration-'));
    directories.push(dir);
    const branch = { id: 'frontier-000001', parent: null };
    const source = join(dir, 'frontiers-v9', branch.id);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'head.json'), 'invalid saved world');
    const index = JSON.stringify({ version: 9, activeId: branch.id, branches: [branch] });
    writeFileSync(join(dir, 'timeline-v9.json'), index);
    expect(new SaveStore(dir).read().blocked).toBe(true);
    expect(readFileSync(join(source, 'head.json'), 'utf8')).toBe('invalid saved world');
    expect(readFileSync(join(dir, 'timeline-v9.json'), 'utf8')).toBe(index);
  });
  it('overview grid covers the viewport and clusters exclude the selected entity', () => {
    const camera = { ...fitCamera(1000, 600), k: 0.02 };
    const cells = viewportGrid(camera, []);
    expect(cells.length).toBeLessThan(150);
    const corners = cells.flatMap((c) => [
      project({ x: c.q * 400 - 200, y: c.r * 400 - 200 }, camera),
      project({ x: (c.q + c.span) * 400 - 200, y: (c.r + c.span) * 400 - 200 }, camera),
    ]);
    expect(Math.min(...corners.map((p) => p.x))).toBeLessThanOrEqual(0);
    expect(Math.max(...corners.map((p) => p.x))).toBeGreaterThanOrEqual(camera.width);
    const groups = clusterMarkers(
      [
        { id: 'a', p: { x: 0, y: 0 } },
        { id: 'b', p: { x: 1, y: 1 } },
        { id: 'selected', p: { x: 2, y: 2 } },
      ],
      camera,
      (id) => id === 'selected',
    );
    expect(groups.map((g) => g.map((m) => m.id))).toEqual([['a', 'b'], ['selected']]);
  });
});
