import { describe, it, expect } from 'vitest';
import { quietEngine, issue, run, until } from './helpers';
import { SimulationEngine } from '../src/engine/engine';
import { createWorld, makeEnemy } from '../src/engine/data';
import { capabilities } from '../src/engine/capabilities';
import { worldSchema } from '../src/engine/save-schema';
import { parseSave } from '../src/engine/saves';
import { deposit, loseStock } from '../src/engine/inventory';
import { createEvent } from '../src/engine/world-events';
import { personnelBonus } from '../src/engine/society';
import { generatedSector, materialize } from '../src/engine/world-generation';
import { advanceFactions, decideThreat } from '../src/engine/threats';
import { observe } from '../src/engine/sensors';
const group = (e: SimulationEngine, ids = ['meridian', 'meridian-2', 'meridian-3']) => {
  expect(
    e.dispatchCommand({
      type: 'createGroup',
      name: '运输群',
      shipIds: ids,
      flagshipId: ids[0],
      spacing: 30,
    }).ok,
  ).toBe(true);
  return e.state.groups.at(-1)!;
};
const haul = (sourceId = 'mine', amount = 600) => ({
  type: 'HAUL' as const,
  sourceId,
  targetId: 'base',
  cargoKind: 'materials' as const,
  amount,
  route: 'direct' as const,
  repeat: false,
});
const checkSteps = (e: SimulationEngine, n: number) => {
  for (let i = 0; i < n; i++) {
    e.dispatchCommand({ type: 'pause', paused: false });
    e.step();
    expect(worldSchema.safeParse(e.state).success).toBe(true);
  }
};
describe('v9 finite physical economy', () => {
  it('has no rear production or economic vessel mining and starts three bulk freighters', () => {
    const e = quietEngine();
    expect('rearProduction' in e.state).toBe(false);
    expect(e.state.ships.filter((s) => s.classId === 'antares').map((s) => s.name)).toEqual([
      'USS MERIDIAN-1',
      'USS MERIDIAN-2',
      'USS MERIDIAN-3',
    ]);
    expect(capabilities(e.state.ships[0]).cargo).toBe(600);
    expect(
      e.dispatchCommand({
        type: 'issueDirective',
        shipIds: ['meridian'],
        mode: 'REPLACE',
        action: { type: 'MINE', targetId: 'helios-deposit', unloadId: 'base', repeat: false },
      }).ok,
    ).toBe(false);
    const stock = structuredClone(e.base.stock);
    run(e, 120);
    expect(e.base.stock).toEqual(stock);
  });
  it('stops at finite Materials capacity once, permits independent ammunition and resumes after actual haul', () => {
    const e = quietEngine(),
      mine = e.state.locations.find((l) => l.id === 'mine')!,
      body = e.state.bodies.find((b) => b.id === mine.siteId)!;
    mine.stock.materials = 2999;
    body.hazard = 0;
    const ore = body.remaining;
    run(e, 10);
    expect(mine.stock.materials).toBe(3000);
    expect(body.remaining).toBe(ore - 1);
    expect(
      e.state.communications.filter((c) => c.text.includes('仓库已满') && c.entityId === 'mine'),
    ).toHaveLength(1);
    expect(deposit(mine, 'photon', 20)).toBe(20);
    const baseline = e.base.stock.materials;
    issue(e, haul('mine', 100), 'meridian');
    until(e, () => e.state.ships[0].cargo.materials === 100);
    run(e, 5);
    expect(mine.storageFull).toBe(false);
    expect(body.remaining).toBeLessThan(ore - 1);
    until(e, () => !e.state.ships[0].current);
    expect(e.base.stock.materials).toBe(baseline + 100);
  });
  it('production and regeneration need no recurring operating inventory or budget', () => {
    const e = quietEngine(),
      mine = e.state.locations.find((l) => l.id === 'mine')!,
      site = e.state.bodies.find((b) => b.id === mine.siteId)!;
    mine.stock.materials = 0;
    mine.core = 0;
    site.hazard = 0;
    e.state.resources.credits = 0;
    const ore = site.remaining;
    run(e, 5);
    expect(mine.core).toBeCloseTo(25);
    expect(mine.stock.materials).toBeGreaterThan(0);
    expect(site.remaining).toBeLessThan(ore);
  });
  it('partial delivery retains the remainder, is saveable and proceeds when space is released', () => {
    const e = quietEngine(),
      s = e.state.ships[0];
    s.x = e.base.x;
    s.y = e.base.y;
    const out = e.state.locations.find((l) => l.id === 'outpost')!;
    out.stock.materials = 245;
    issue(e, { ...haul('base', 20), targetId: 'outpost' }, s.id);
    until(e, () => s.cargo.materials === 15 && s.current?.delivered === 5);
    expect(out.stock.materials).toBe(250);
    checkSteps(e, 10);
    loseStock(e, out, 'materials', 15);
    until(e, () => !s.current);
    expect(out.stock.materials).toBe(250);
    expect(s.cargo.materials).toBe(0);
  });
  it('theft and destruction reconcile current and interrupted reservations immediately', () => {
    const e = quietEngine(),
      s = e.state.ships[0];
    s.x = e.base.x;
    s.y = e.base.y;
    issue(e, { ...haul('base', 40), targetId: 'outpost' }, s.id);
    run(e, 0.1);
    expect(s.current!.reserved.materials).toBe(40);
    issue(e, { type: 'MOVE', point: { x: -180, y: 0 } }, s.id, 'INTERRUPT');
    loseStock(e, e.base, 'materials', 60);
    expect(s.suspended[0].reserved.materials).toBe(10);
    expect(() => parseSave(e.state)).not.toThrow();
    e.hit(e.base, 100000);
    expect(s.suspended[0].reserved.materials).toBe(0);
    expect(() => parseSave(e.state)).not.toThrow();
  });
  it('Colony produces credits even when Materials output is full and does not consume daily Materials', () => {
    const e = quietEngine(),
      l = e.state.locations.find((l) => l.id === 'colony')!;
    l.stock.materials = l.capacity.materials;
    const credits = e.state.resources.credits;
    run(e, 5);
    expect(l.stock.materials).toBe(300);
    expect(e.state.resources.credits).toBeGreaterThan(credits + 18);
    expect(l.colony!.population).toBeGreaterThan(1000);
  });
  it('full industry output waits without duplicate payment or repeated output', () => {
    const e = quietEngine();
    e.base.stock.photon = 500;
    const m = e.base.stock.materials;
    expect(e.dispatchCommand({ type: 'manufacture', cargoKind: 'photon', amount: 10 }).ok).toBe(
      true,
    );
    run(e, 50);
    expect(e.state.jobs[0].complete).toBe(false);
    expect(e.base.stock.materials).toBe(m - 10);
    loseStock(e, e.base, 'photon', 10);
    run(e, 1);
    expect(e.state.jobs[0].complete).toBe(true);
    expect(e.base.stock.photon).toBe(500);
    run(e, 10);
    expect(e.base.stock.photon).toBe(500);
  });
  it('paid finite imports and exports load, travel and deliver actual cargo', () => {
    const e = quietEngine(),
      t = e.state.trade,
      base = e.base.stock.materials,
      credits = e.state.resources.credits;
    expect(
      e.dispatchCommand({
        type: 'tradeStock',
        direction: 'buy',
        cargoKind: 'materials',
        amount: 20,
      }).ok,
    ).toBe(true);
    expect(e.base.stock.materials).toBe(base);
    expect(t.stock.materials).toBe(380);
    expect(e.state.resources.credits).toBe(credits - 240);
    until(e, () => t.orders[0].state === 'complete');
    expect(e.base.stock.materials).toBe(base + 20);
    expect(
      e.dispatchCommand({
        type: 'tradeStock',
        direction: 'sell',
        cargoKind: 'materials',
        amount: 10,
      }).ok,
    ).toBe(true);
    expect(t.stock.materials).toBe(380);
    until(e, () => t.orders[1].state === 'complete');
    expect(t.stock.materials).toBe(390);
    expect(e.base.stock.materials).toBe(base + 10);
    expect(
      e.dispatchCommand({
        type: 'tradeStock',
        direction: 'buy',
        cargoKind: 'materials',
        amount: 401,
      }).ok,
    ).toBe(false);
  });
  it('merchant loss has no free reimbursement or replacement', () => {
    const e = quietEngine();
    e.dispatchCommand({ type: 'tradeStock', direction: 'buy', cargoKind: 'materials', amount: 10 });
    run(e, 3);
    const stock = e.base.stock.materials,
      credits = e.state.resources.credits;
    e.hit(e.state.civilians[0], 10000);
    expect(e.state.trade.orders[0].state).toBe('lost');
    run(e, 60);
    expect(e.base.stock.materials).toBe(stock);
    expect(e.state.civilians).toHaveLength(0);
    expect(e.state.resources.credits).toBeGreaterThan(credits);
    expect(() => parseSave(e.state)).not.toThrow();
  });
});
describe('coordinated task groups and Admiral priority', () => {
  it('explicit QUEUE takes priority over a current autonomous escort', () => {
    const e = quietEngine(),
      s = e.state.ships[0];
    const f = e.state.ships[4];
    f.x = s.x;
    f.y = s.y;
    s.standing.autoEscort = true;
    issue(e, { ...haul('base', 20), targetId: 'outpost' }, f.id);
    run(e, 0.1);
    expect(s.current!.source).toBe('standing');
    issue(e, { type: 'MOVE', point: { x: 0, y: 0 } }, s.id, 'QUEUE');
    expect(s.current!.source).toBe('admiral');
    expect(s.current!.action.type).toBe('MOVE');
  });
  it('distributes a total manifest, waits for actual stock and preserves a valid save at every load step', () => {
    const e = quietEngine(),
      g = group(e),
      mine = e.state.locations.find((l) => l.id === 'mine')!;
    mine.stock.materials = 0;
    e.state.bodies.find((b) => b.id === mine.siteId)!.remaining = 0;
    e.dispatchCommand({
      type: 'issueGroupDirective',
      groupId: g.id,
      mode: 'REPLACE',
      action: haul('mine', 900),
    });
    run(e, 120);
    expect(
      e.state.ships.filter((s) => g.shipIds.includes(s.id)).every((s) => s.cargo.materials === 0),
    ).toBe(true);
    mine.stock.materials = 600;
    const old = e.base.stock.materials;
    checkSteps(e, 30);
    expect(e.state.ships.reduce((n, s) => n + s.cargo.materials, 0)).toBe(600);
    until(e, () => g.shipIds.every((id) => !e.state.ships.find((s) => s.id === id)!.current));
    expect(e.base.stock.materials).toBe(old + 600);
  });
  it('rejects group atomically, preserves membership on single override and deletion preserves directives', () => {
    const e = quietEngine(),
      g = group(e),
      before = structuredClone(e.state);
    expect(
      e.dispatchCommand({
        type: 'issueGroupDirective',
        groupId: g.id,
        mode: 'REPLACE',
        action: haul('missing', 30),
      }).ok,
    ).toBe(false);
    expect(e.state).toEqual(before);
    e.dispatchCommand({
      type: 'issueGroupDirective',
      groupId: g.id,
      mode: 'REPLACE',
      action: { type: 'MOVE', point: { x: 0, y: -200 } },
    });
    const d = e.state.ships[0].current!;
    issue(e, { type: 'MOVE', point: { x: -200, y: 0 } }, 'meridian', 'INTERRUPT');
    until(e, () => e.state.ships[0].current?.id === d.id);
    issue(e, { type: 'RETURN' }, 'meridian');
    expect(g.shipIds).toContain('meridian');
    expect(e.state.ships[0].current!.groupOrderId).toBeNull();
    e.dispatchCommand({ type: 'deleteGroup', groupId: g.id });
    expect(e.state.ships.find((s) => s.id === 'meridian-2')!.current!.groupOrderId).not.toBeNull();
    expect(() => parseSave(e.state)).not.toThrow();
  });
  it('losing a member does not invalidate its surviving group and personnel archives', () => {
    const e = quietEngine(),
      g = group(e),
      p = e.state.personnel[0];
    p.posting = { type: 'ship', id: 'meridian' };
    p.locationId = 'meridian';
    e.state.locations.find((l) => l.id === 'colony')!.colony!.commanderId = null;
    e.hit(e.state.ships[0], 10000);
    expect(g.shipIds).toHaveLength(2);
    expect(p.status).toBe('missing');
    expect(() => parseSave(e.state)).not.toThrow();
  });
  it('idle holds without unloading or free ammunition and explicit queued work overrides low status', () => {
    const e = quietEngine(),
      s = e.state.ships[0];
    s.cargo.materials = 10;
    s.photon = 0;
    issue(e, { type: 'MOVE', point: { x: 0, y: 0 } }, s.id);
    issue(e, { type: 'MOVE', point: { x: 100, y: 0 } }, s.id, 'QUEUE');
    run(e, 1);
    expect(s.current!.source).toBe('admiral');
    until(e, () => !s.current);
    const at = { x: s.x, y: s.y };
    run(e, 600);
    expect({ x: s.x, y: s.y }).toEqual(at);
    expect(s.status).toBe('idle');
    expect(s.cargo.materials).toBe(10);
    expect(s.photon).toBe(0);
  });
  it('Standing Orders cannot cross forbidden borders and direct Admiral movement can', () => {
    const e = quietEngine(),
      s = e.state.ships[0],
      freighter = e.state.ships[4];
    s.x = 760;
    s.y = 0;
    freighter.x = 800;
    freighter.y = 0;
    issue(e, haul(), freighter.id);
    s.standing.autoEscort = true;
    s.standing.maxPursuit = 100;
    run(e, 0.1);
    expect(s.current).toBeNull();
    issue(e, { type: 'MOVE', point: { x: 820, y: 0 } }, s.id);
    until(e, () => !s.current);
    expect(s.x).toBeGreaterThan(780);
    expect(e.state.tension).toBeGreaterThan(0);
  });
});
describe('personnel and persistent consequences', () => {
  it('Commander reports candidates, acceptance pays training, appointments require a meeting and work gains experience', () => {
    const e = quietEngine(),
      colony = e.state.locations.find((l) => l.id === 'colony')!;
    run(e, 120);
    const p = e.state.personnel.find((p) => p.status === 'candidate')!;
    expect(p.originId).toBe('colony');
    const credits = e.state.resources.credits;
    e.dispatchCommand({ type: 'candidate', personnelId: p.id, accept: true, career: 'science' });
    expect(e.state.resources.credits).toBe(credits - 90);
    run(e, 90);
    expect(p.status).toBe('available');
    expect(
      e.dispatchCommand({
        type: 'assignPersonnel',
        personnelId: p.id,
        targetType: 'ship',
        targetId: 'verity',
      }).ok,
    ).toBe(false);
    const s = e.state.ships.find((s) => s.id === 'verity')!;
    s.x = colony.x;
    s.y = colony.y;
    expect(
      e.dispatchCommand({
        type: 'assignPersonnel',
        personnelId: p.id,
        targetType: 'ship',
        targetId: s.id,
      }).ok,
    ).toBe(true);
    run(e, 5);
    expect(p.experience).toBeGreaterThan(0);
    expect(personnelBonus(e, s.id, 'science')).toBeGreaterThan(0);
  });
  it('development spends local Materials and survives reload', () => {
    const e = quietEngine(),
      l = e.state.locations.find((l) => l.id === 'colony')!;
    l.stock.materials = 10;
    const housing = l.colony!.housing;
    expect(e.dispatchCommand({ type: 'developColony', locationId: l.id, kind: 'housing' }).ok).toBe(
      true,
    );
    expect(l.stock.materials).toBe(0);
    run(e, 10);
    const resumed = new SimulationEngine(parseSave(e.state));
    run(resumed, 30);
    expect(resumed.state.locations.find((x) => x.id === l.id)!.colony!.housing).toBe(housing + 500);
  });
  it('plague is state-triggered, acknowledging does not resolve it, quarantine changes income and treatment spends Credits on site', () => {
    const e = quietEngine(),
      l = e.state.locations.find((l) => l.id === 'colony')!;
    l.colony!.contamination = 25;
    run(e, 1);
    const v = e.state.events.find((v) => v.kind === 'plague')!;
    expect(v.evidence).toContain('污染');
    const comm = e.state.communications.find((c) => c.entityId === v.id)!;
    e.dispatchCommand({ type: 'acknowledge', communicationId: comm.id });
    expect(v.stage).toBe('reported');
    e.dispatchCommand({ type: 'respondEvent', eventId: v.id, choice: 'quarantine' });
    expect(l.colony!.quarantine).toBe(true);
    const stock = l.stock.materials;
    issue(e, { type: 'ASSIST_EVENT', targetId: v.id });
    until(e, () => v.stage === 'resolved');
    expect(l.colony!.contamination).toBe(0);
    expect(v.work).toBeGreaterThanOrEqual(20);
    expect(l.stock.materials).toBe(stock);
    expect(() => parseSave(e.state)).not.toThrow();
  });
  it('mine accident stops production, requires on-site repair and a reported follow-up is persistent', () => {
    const e = quietEngine(),
      l = e.state.locations.find((l) => l.id === 'mine')!;
    l.extracted = 1000;
    run(e, 1);
    const v = e.state.events.find((v) => v.kind === 'accident')!,
      ore = e.state.bodies.find((b) => b.id === l.siteId)!.remaining;
    run(e, 5);
    expect(e.state.bodies.find((b) => b.id === l.siteId)!.remaining).toBe(ore);
    issue(e, { type: 'ASSIST_EVENT', targetId: v.id });
    until(e, () => v.stage === 'resolved');
    run(e, 5);
    expect(e.state.bodies.find((b) => b.id === l.siteId)!.remaining).toBeLessThan(ore);
  });
  it('real distress consumes responder cargo instead of distant base Materials', () => {
    const e = quietEngine(),
      victim = e.state.ships[0],
      s = e.state.ships[2];
    victim.x = 300;
    victim.y = 0;
    victim.shield = 0;
    e.hit(victim, 70);
    run(e, 1);
    const v = e.state.events.find((v) => v.kind === 'distress')!;
    s.cargo.materials = 40;
    const m = e.base.stock.materials;
    issue(e, { type: 'ASSIST_EVENT', targetId: v.id }, s.id);
    until(e, () => v.stage === 'resolved');
    expect(s.cargo.materials).toBeLessThan(40);
    expect(e.base.stock.materials).toBe(m);
  });
  it('refugees transfer a real population once, reject is irreversible after embarkation, and a second ship cannot duplicate them', () => {
    const e = quietEngine(),
      b = e.state.bodies[0];
    b.discovered = true;
    b.population = 200;
    b.hazard = 0.4;
    b.survey = 2;
    run(e, 1);
    const v = e.state.events.find((v) => v.kind === 'refugees')!,
      colony = e.state.locations.find((l) => l.id === 'colony')!;
    e.dispatchCommand({
      type: 'respondEvent',
      eventId: v.id,
      choice: 'accept',
      targetId: colony.id,
    });
    issue(e, { type: 'ASSIST_EVENT', targetId: v.id }, 'meridian');
    issue(e, { type: 'ASSIST_EVENT', targetId: v.id }, 'meridian-2');
    until(e, () => v.population > 0);
    expect(e.dispatchCommand({ type: 'respondEvent', eventId: v.id, choice: 'reject' }).ok).toBe(
      false,
    );
    until(e, () => v.stage === 'resolved');
    expect(b.population).toBe(100);
    expect(colony.colony!.population).toBeGreaterThanOrEqual(1100);
    expect(e.state.ships.every((s) => s.passengers === 0)).toBe(true);
  });
  it('rejected or delayed refugees remain at their source and record consequences', () => {
    const e = quietEngine(),
      b = e.state.bodies[0];
    b.population = 150;
    const v = createEvent(e, 'refugees', b.id, '环境风险');
    e.dispatchCommand({ type: 'respondEvent', eventId: v.id, choice: 'reject' });
    expect(v.stage).toBe('resolved');
    expect(b.population).toBe(150);
    const next = createEvent(e, 'refugees', b.id, '新的撤离申请');
    run(e, 241);
    expect(next.stage).toBe('failed');
    expect(b.population).toBe(150);
  });
  it('scientific investigation yields one finite find and Derelict has an actual cargo and contamination follow-up', () => {
    const e = quietEngine(),
      b = e.state.bodies[0];
    b.hidden = true;
    b.specialClaimed = false;
    b.kind = 'ruins';
    b.discovered = true;
    b.survey = 2;
    run(e, 1);
    const v = e.state.events.find((v) => v.kind === 'discovery')!;
    issue(e, { type: 'ASSIST_EVENT', targetId: v.id });
    until(e, () => v.stage === 'resolved');
    expect(e.state.ships[2].cargo.specialFinds).toBe(1);
    expect(b.specialClaimed).toBe(true);
    const d = { ...b, id: 'derelict-test', kind: 'derelict' as const, hazard: 0.6, hidden: false };
    e.state.bodies.push(d);
    e.state.systems.find((s) => s.id === d.systemId)!.bodyIds.push(d.id);
    e.state.wrecks.push({
      id: 'wreck:' + d.id,
      name: '失落研究舰',
      x: d.x,
      y: d.y,
      discovered: false,
      stock: { materials: 40, photon: 0, quantum: 0, specialFinds: 0 },
    });
    run(e, 1);
    const der = e.state.events.find((v) => v.kind === 'derelict')!;
    issue(e, { type: 'ASSIST_EVENT', targetId: der.id });
    until(e, () => der.stage === 'resolved');
    expect(e.state.wrecks.at(-1)!.discovered).toBe(true);
    expect(e.state.events.find((v) => v.id === der.followUpId)?.kind).toBe('plague');
    expect(() => parseSave(e.state)).not.toThrow();
  });
});
describe('world generation, intelligence and diplomacy', () => {
  it('coordinates and rare discoveries ignore exploration order and combat RNG', () => {
    const a = createWorld(42),
      b = createWorld(42);
    materialize(a, { q: 4, r: 2 });
    materialize(a, { q: -2, r: 3 });
    materialize(b, { q: -2, r: 3 });
    materialize(b, { q: 4, r: 2 });
    expect(a.bodies.filter((x) => x.systemId.startsWith('sector:4:2'))).toEqual(
      b.bodies.filter((x) => x.systemId.startsWith('sector:4:2')),
    );
    const e = new SimulationEngine(a);
    for (let i = 0; i < 50; i++) e.random();
    expect(generatedSector(a.initialSeed, { q: 6, r: 5 })).toEqual(
      generatedSector(b.initialSeed, { q: 6, r: 5 }),
    );
  });
  it('paired Wormholes preserve hidden exits, change actual position and expand exploration', () => {
    const e = quietEngine(42);
    let generated: ReturnType<typeof generatedSector> | undefined;
    for (let q = 1; q < 1000 && !generated; q++) {
      const g = generatedSector(42, { q, r: 0 });
      if (g.wormholes.length) generated = g;
    }
    const h = generated!.wormholes[0];
    materialize(e.state, { q: generated!.sector.q, r: 0 });
    const portal = e.state.wormholes.find((p) => p.id === h.id)!;
    portal.discovered = true;
    const s = e.state.ships[2];
    s.x = h.x;
    s.y = h.y;
    expect('exit' in e.snapshot().wormholes[0]).toBe(false);
    expect(generatedSector(42, h.exitSector).wormholes[0].exit).toEqual({ x: h.x, y: h.y });
    issue(e, { type: 'TRANSIT', targetId: h.id });
    until(e, () => !s.current);
    expect(s.x).toBe(h.exit.x);
    expect(s.y).toBe(h.exit.y);
    expect(
      e.state.sectors.some(
        (p) => p.id === `sector:${h.exitSector.q}:${h.exitSector.r}` && p.discovered,
      ),
    ).toBe(true);
    expect(() => parseSave(e.state)).not.toThrow();
  });
  it('no shared intelligence means no raid, observing returns only actual scout knowledge', () => {
    const e = quietEngine(),
      s = e.state.ships[0],
      scout = makeEnemy('spy', 'raider', 'orion', { x: 200, y: 0 }, 'orion-base', 'scout'),
      r = makeEnemy('r', 'raider', 'orion', { x: 350, y: 0 });
    e.state.enemies = [scout, r];
    s.x = 210;
    s.y = 0;
    s.cargo.materials = 500;
    decideThreat(e, r);
    expect(r.intent).toBe('observe');
    decideThreat(e, scout);
    expect(scout.localReports.length).toBeGreaterThan(0);
    expect(e.state.factions.orion.reports).toHaveLength(0);
    const base = e.state.locations.find((l) => l.id === 'orion-base')!;
    scout.x = base.x;
    scout.y = base.y;
    scout.nextDecision = 0;
    decideThreat(e, scout);
    expect(e.state.factions.orion.reports.some((r) => r.id === s.id)).toBe(true);
    r.nextDecision = 0;
    decideThreat(e, r);
    expect(r.intent).toBe('raid');
  });
  it('Romulan probe is not hostile; political escalation uses existing assets, then withdraws without intelligence', () => {
    const e = quietEngine(),
      r = makeEnemy('political', 'valdore', 'romulan', { x: 700, y: 0 }, 'romulan-base', 'warbird');
    e.state.enemies = [r];
    observe(e.state, r, 6);
    r.intent = 'probe';
    e.state.factions.romulan.stance = 'probe';
    const snapshot = e.snapshot();
    expect(snapshot.contacts.find((c) => c.id === r.id)!.hostile).toBe(false);
    const s = e.state.ships[2];
    s.x = 800;
    s.y = 0;
    e.state.factions.romulan.reports = [
      {
        id: s.id,
        x: s.x,
        y: s.y,
        observerId: r.id,
        seenAt: 0,
        kind: 'ship',
        value: 1000,
        defense: 50,
      },
    ];
    e.state.tension = 70;
    run(e, 5);
    const v = e.state.events.find((v) => v.kind === 'invasion')!;
    expect(v.assetIds).toEqual([r.id]);
    expect(e.state.enemies).toHaveLength(1);
    e.state.factions.romulan.reports = [];
    run(e, 5);
    expect(e.state.factions.romulan.stance).toBe('withdraw');
    expect(e.state.enemies).toHaveLength(1);
  });
  it('Hail has persistent diplomatic consequences and a cooldown', () => {
    const e = quietEngine(),
      r = makeEnemy('diplomat', 'valdore', 'romulan', { x: -120, y: 0 }, 'romulan-base', 'warbird');
    e.state.enemies = [r];
    r.nextDecision = 1e9;
    observe(e.state, r, 6);
    e.state.tension = 30;
    issue(e, { type: 'HAIL', targetId: r.id, message: 'deescalate' });
    until(e, () => !e.state.ships[2].current);
    expect(e.state.tension).toBe(25);
    expect(issue(e, { type: 'HAIL', targetId: r.id, message: 'deescalate' }).ok).toBe(false);
    expect(e.state.history.some((h) => h.kind === 'diplomacy')).toBe(true);
  });
  it('snapshot hides enemy inventories, deployment, new private facility state and unknown wormhole exits', () => {
    const e = quietEngine(),
      l = e.state.locations.find((l) => l.id === 'orion-base')!;
    l.discovered = true;
    l.extracted = 100;
    l.stock.materials = 180;
    const p = e.snapshot().locations.find((p) => p.id === l.id)!;
    expect(p.stock.materials).toBe(0);
    expect(p.extracted).toBe(0);
    expect(p.capacity.materials).toBe(0);
    expect('factions' in e.snapshot()).toBe(false);
    expect('rng' in e.snapshot()).toBe(false);
  });
});

describe('political event consequences', () => {
  it('invasion cannot be resolved by generic science work or acknowledging its report', () => {
    const e = quietEngine(),
      s = e.state.ships[2],
      enemy = makeEnemy(
        'invasion-asset',
        'valdore',
        'romulan',
        { x: 850, y: 0 },
        'romulan-base',
        'warbird',
      );
    enemy.intent = 'observe';
    enemy.nextDecision = 1e9;
    e.state.enemies = [enemy];
    const v = createEvent(e, 'invasion', s.id, '已收到侦察情报，现役资产正在部署', [enemy.id]);
    expect(issue(e, { type: 'ASSIST_EVENT', targetId: v.id }).ok).toBe(false);
    const comm = e.state.communications.find((c) => c.entityId === v.id)!;
    e.dispatchCommand({ type: 'acknowledge', communicationId: comm.id });
    run(e, 1);
    expect(v.stage).toBe('reported');
    enemy.intent = 'retreat';
    run(e, 1);
    expect(v.stage).toBe('resolved');
    expect(v.outcome).toContain('撤退');
    expect(() => parseSave(e.state)).not.toThrow();
  });
});

describe('late-world state constraints', () => {
  it('ignored diplomatic demands cannot create an invasion without real assets or fresh intelligence', () => {
    const e = quietEngine(),
      s = e.state.ships[2];
    s.x = 850;
    const v = createEvent(e, 'diplomatic', s.id, '实际越界警告');
    e.state.tension = 70;
    v.deadline = 0;
    run(e, 1);
    expect(v.stage).toBe('failed');
    expect(v.followUpId).toBeNull();
    expect(e.state.events.some((v) => v.kind === 'invasion')).toBe(false);
    expect(e.state.enemies).toHaveLength(0);
  });
  it('science development improves physical medical response and pollution is bounded in immediate saves', () => {
    const e = quietEngine(),
      c = e.state.locations.find((l) => l.id === 'colony')!;
    c.colony!.contamination = 98;
    c.colony!.science = 90;
    const b = e.state.bodies[0];
    b.population = 100;
    b.hazard = 0.5;
    b.survey = 2;
    b.discovered = true;
    const v = createEvent(e, 'refugees', b.id, '患病难民');
    e.dispatchCommand({ type: 'respondEvent', eventId: v.id, choice: 'accept', targetId: c.id });
    issue(e, { type: 'ASSIST_EVENT', targetId: v.id }, 'meridian');
    until(e, () => v.stage === 'resolved');
    expect(c.colony!.contamination).toBeLessThanOrEqual(100);
    expect(() => parseSave(e.state)).not.toThrow();
  });
});

describe('facility retaliation observes actual attacks', () => {
  it('Romulan facilities cannot read hidden Admiral intent and lose physical stock when destroyed', () => {
    const e = quietEngine(),
      base = e.state.locations.find((l) => l.id === 'romulan-base')!,
      s = e.state.ships[2];
    base.discovered = true;
    s.x = base.x + 30;
    s.y = base.y;
    s.weapons = 0;
    issue(e, { type: 'ATTACK', targetId: base.id }, s.id);
    const shield = s.shield;
    run(e, 1);
    expect(s.shield).toBe(shield);
    e.hit(base, 1, s);
    run(e, 1);
    expect(s.shield).toBeLessThan(shield);
    expect(base.lastAttackerId).toBe(s.id);
    expect(() => parseSave(e.state)).not.toThrow();
    e.hit(base, 99999, s);
    expect(Object.values(base.stock).every((v) => v === 0)).toBe(true);
  });
});

describe('Standing Orders egress and protection categories', () => {
  it('idle holds in distant Romulan space and only explicit RETURN leaves it', () => {
    const e = quietEngine(),
      s = e.state.ships[1];
    s.x = 2200;
    s.y = 0;
    run(e, 1);
    expect(s.current).toBeNull();
    expect(s.x).toBe(2200);
    expect(issue(e, { type: 'RETURN' }, s.id).ok).toBe(true);
    expect(s.current?.source).toBe('admiral');
    until(e, () => s.status === 'docked');
    expect(s.x).toBeLessThan(0);
  });
  it('Civilian protection does not silently enable Federation freight protection', () => {
    const e = quietEngine(),
      s = e.state.ships[1],
      f = e.state.ships[0];
    s.x = f.x;
    s.y = f.y;
    s.standing.protectCivilian = true;
    issue(e, { ...haul('base', 20), targetId: 'outpost' }, f.id);
    run(e, 1);
    expect(s.current).toBeNull();
    s.standing.protectFreighter = true;
    run(e, 1);
    expect(s.current?.action.type).toBe('ESCORT');
  });
});
