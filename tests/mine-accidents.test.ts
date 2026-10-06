import { describe, it, expect } from 'vitest';
import { quietEngine, issue, run, until } from './helpers';
import { createEvent } from '../src/engine/world-events';
import { available } from '../src/engine/inventory';
import { SimulationEngine } from '../src/engine/engine';
import { parseSave } from '../src/engine/saves';

function scenario(siteMaterials = 0, cargoMaterials = 0) {
  const e = quietEngine();
  const mine = e.state.locations.find((l) => l.id === 'mine')!;
  const site = e.state.bodies.find((b) => b.id === mine.siteId)!;
  site.hazard = 0;
  mine.stock.materials = siteMaterials;
  const ship = e.state.ships.find((s) => s.id === 'verity')!;
  ship.x = mine.x;
  ship.y = mine.y;
  ship.cargo.materials = cargoMaterials;
  const event = createEvent(e, 'accident', mine.id, '累计开采暴露超出安全阈值，设备停工');
  expect(issue(e, { type: 'ASSIST_EVENT', targetId: event.id }, ship.id).ok).toBe(true);
  return { e, mine, site, ship, event };
}

describe('mine accident repair and public response state', () => {
  it.each([
    [10, 5, 5, 0],
    [0, 5, 0, 5],
    [3, 2, 3, 2],
  ])(
    'uses local %s and cargo %s, consuming %s locally and %s on ship',
    (local, cargo, localCost, shipCost) => {
      const { e, mine, site, ship, event } = scenario(local, cargo);
      const baseStock = structuredClone(e.base.stock);
      const ore = site.remaining;
      until(e, () => event.stage === 'resolved');
      expect(event.work).toBe(20);
      expect(mine.stock.materials).toBe(local - localCost);
      expect(ship.cargo.materials).toBe(cargo - shipCost);
      expect(e.base.stock).toEqual(baseStock);
      expect(site.remaining).toBe(ore);
      expect(event.outcome).toContain('恢复生产');
      expect(ship.current).toBeNull();
      run(e, 5);
      expect(site.remaining).toBeLessThan(ore);
      expect(() => parseSave(e.state)).not.toThrow();
    },
  );

  it('does not partially debit inadequate supplies or grow work while blocked beyond the deadline', () => {
    const { e, mine, site, ship, event } = scenario(3, 1);
    const ore = site.remaining;
    const baseStock = structuredClone(e.base.stock);
    run(e, 260);
    expect(e.state.time).toBeGreaterThan(event.deadline);
    expect(event.stage).toBe('responding');
    expect(event.work).toBe(20);
    expect(ship.current!.work).toBe(20);
    expect(ship.current!.note).toContain('还缺 1 材料');
    expect(mine.stock.materials).toBe(3);
    expect(ship.cargo.materials).toBe(1);
    expect(site.remaining).toBe(ore);
    expect(e.base.stock).toEqual(baseStock);
    expect(e.snapshot().events.find((v) => v.id === event.id)!.accidentResponse).toMatchObject({
      workRequired: 20,
      materialRequired: 5,
      availableAtSite: 3,
      responders: [
        { shipId: ship.id, phase: 'awaitingMaterials', cargoMaterials: 1, shortfall: 1 },
      ],
    });
  });

  it('honors suspended freight reservations, using only unreserved local stock plus responder cargo', () => {
    const { e, mine, ship, event } = scenario(10, 2);
    const hauler = e.state.ships.find((s) => s.id === 'meridian')!;
    hauler.x = mine.x;
    hauler.y = mine.y;
    expect(
      issue(
        e,
        {
          type: 'HAUL',
          sourceId: mine.id,
          targetId: 'base',
          cargoKind: 'materials',
          amount: 7,
          route: 'direct',
          repeat: false,
        },
        hauler.id,
      ).ok,
    ).toBe(true);
    until(e, () => hauler.current!.reserved.materials === 7);
    expect(
      issue(e, { type: 'MOVE', point: { x: mine.x - 10000, y: mine.y } }, hauler.id, 'INTERRUPT')
        .ok,
    ).toBe(true);
    expect(available(e.state, mine.id, 'materials')).toBe(3);
    expect(
      e.snapshot().events.find((v) => v.id === event.id)!.accidentResponse!.availableAtSite,
    ).toBe(3);
    until(e, () => event.stage === 'resolved');
    expect(mine.stock.materials).toBe(7);
    expect(hauler.suspended[0].reserved.materials).toBe(7);
    expect(ship.cargo.materials).toBe(0);
    expect(() => parseSave(e.state)).not.toThrow();
  });

  it('accepts physical freight delivery after work completes and automatically resumes repair', () => {
    const { e, mine, ship, site, event } = scenario();
    run(e, 15);
    const ore = site.remaining;
    const baseMaterials = e.base.stock.materials;
    expect(event.work).toBe(20);
    expect(
      issue(
        e,
        {
          type: 'HAUL',
          sourceId: 'base',
          targetId: mine.id,
          cargoKind: 'materials',
          amount: 5,
          route: 'safe',
          repeat: false,
        },
        'meridian',
      ).ok,
    ).toBe(true);
    until(e, () => event.stage === 'resolved');
    expect(e.base.stock.materials).toBe(baseMaterials - 5);
    expect(mine.stock.materials).toBe(0);
    expect(ship.cargo.materials).toBe(0);
    expect(e.state.ships.find((s) => s.id === 'meridian')!.cargo.materials).toBe(0);
    run(e, 5);
    expect(site.remaining).toBeLessThan(ore);
  });

  it('multiple responders cannot spend twice or combine cargo across separate ships', () => {
    const { e, mine, ship, event } = scenario(0, 3);
    const other = e.state.ships.find((s) => s.id === 'horizon')!;
    other.x = mine.x;
    other.y = mine.y;
    other.cargo.materials = 2;
    expect(issue(e, { type: 'ASSIST_EVENT', targetId: event.id }, other.id).ok).toBe(true);
    run(e, 15);
    expect(event.stage).toBe('responding');
    expect(ship.cargo.materials).toBe(3);
    expect(other.cargo.materials).toBe(2);
    // Additional real cargo delivered to the site supplies the first completing vessel.
    mine.stock.materials = 2;
    run(e, 0.1);
    expect(event.stage).toBe('resolved');
    expect(mine.stock.materials + ship.cargo.materials + other.cargo.materials).toBe(2);
    expect(
      e.state.history.filter((h) => h.entityId === event.id && h.text.includes('设备修复完成')),
    ).toHaveLength(1);
    run(e, 0.1);
    expect(ship.current).toBeNull();
    expect(other.current).toBeNull();
  });

  it('normalizes old excess work on response, preserving save schema, history and deterministic recovery', () => {
    const { e, ship, event } = scenario();
    event.work = 91;
    ship.current!.work = 91;
    const saved = parseSave(e.state);
    expect(saved.events.find((v) => v.id === event.id)!.work).toBe(91);
    const a = new SimulationEngine(saved);
    const b = new SimulationEngine(parseSave(JSON.parse(JSON.stringify(saved))));
    for (const engine of [a, b]) {
      run(engine, 1);
      const responder = engine.state.ships.find((s) => s.id === ship.id)!;
      expect(engine.state.events.find((v) => v.id === event.id)!.work).toBe(20);
      expect(responder.current!.work).toBe(20);
      expect(
        issue(engine, { type: 'MOVE', point: { x: responder.x, y: responder.y } }, ship.id).ok,
      ).toBe(true);
      run(engine, 0.1);
      expect(
        engine.snapshot().events.find((v) => v.id === event.id)!.accidentResponse!.responders,
      ).toEqual([]);
      responder.cargo.materials = 5;
      expect(issue(engine, { type: 'ASSIST_EVENT', targetId: event.id }, ship.id).ok).toBe(true);
      run(engine, 0.1);
      expect(engine.state.events.find((v) => v.id === event.id)!.stage).toBe('resolved');
      expect(engine.state.version).toBe(10);
      expect(parseSave(engine.state).events.find((v) => v.id === event.id)!.work).toBe(20);
    }
    expect(a.state).toEqual(b.state);
    expect(a.state.history.slice(0, saved.history.length)).toEqual(saved.history);
  });

  it('projects actual current responders and proximity without treating distant cargo as onsite supply', () => {
    const { e, mine, ship, event } = scenario(0, 5);
    ship.x = mine.x + 100;
    expect(
      e.snapshot().events.find((v) => v.id === event.id)!.accidentResponse!.responders[0].phase,
    ).toBe('travelling');
    event.work = 20;
    run(e, 0.1);
    expect(event.stage).toBe('responding');
    expect(ship.cargo.materials).toBe(5);
    expect(
      issue(e, { type: 'MOVE', point: { x: mine.x + 200, y: mine.y } }, ship.id, 'INTERRUPT').ok,
    ).toBe(true);
    expect(
      e.snapshot().events.find((v) => v.id === event.id)!.accidentResponse!.responders,
    ).toEqual([]);
    const snapshot = e.snapshot();
    expect('accidentResponse' in e.state.events.find((v) => v.id === event.id)!).toBe(false);
    expect(snapshot.events.find((v) => v.id === event.id)!.accidentResponse!.availableAtSite).toBe(
      0,
    );
    expect(() => parseSave(e.state)).not.toThrow();
  });
});
