import { describe, it, expect } from 'vitest';
import { quietEngine, issue, run, until } from './helpers';
import { makeEnemy } from '../src/engine/data';
import { observe } from '../src/engine/sensors';
import { capabilities, cargoUsed } from '../src/engine/capabilities';
import { available } from '../src/engine/command-system';
describe('Admiral directives and four physical activities', () => {
  it('REPLACE discards queue and suspended directives, preserving loaded cargo and damage', () => {
    const e = quietEngine(),
      s = e.state.ships[0];
    s.cargo.materials = 8;
    s.hull = 50;
    issue(e, { type: 'MOVE', point: { x: 500, y: 0 } }, s.id);
    issue(e, { type: 'DOCK', targetId: 'base' }, s.id, 'QUEUE');
    issue(e, { type: 'MOVE', point: { x: 100, y: 300 } }, s.id, 'INTERRUPT');
    expect(s.queue).toHaveLength(1);
    expect(s.suspended).toHaveLength(1);
    issue(e, { type: 'RETREAT', targetId: 'base' }, s.id);
    expect(s.queue).toEqual([]);
    expect(s.suspended).toEqual([]);
    expect(s.cargo.materials).toBe(8);
    expect(s.hull).toBe(50);
  });
  it('QUEUE is FIFO; INTERRUPT resumes its actual progress before the queue', () => {
    const e = quietEngine(),
      s = e.state.ships[1];
    issue(e, { type: 'MOVE', point: { x: 200, y: 0 } }, s.id);
    const id = s.current!.id;
    run(e, 3);
    const moved = s.current!.moved;
    issue(e, { type: 'MOVE', point: { x: -200, y: 45 } }, s.id, 'INTERRUPT');
    issue(e, { type: 'DOCK', targetId: 'base' }, s.id, 'QUEUE');
    until(e, () => s.current?.id === id);
    expect(s.current!.moved).toBe(moved);
    expect(s.queue).toHaveLength(1);
    until(e, () => !s.current);
    expect(s.status).toBe('docked');
    const actions = e.state.history.filter((h) => h.kind === 'action');
    expect(actions.map((h) => h.text.split(' / ')[2])).toEqual(['MOVE', 'MOVE', 'DOCK']);
  });
  it('invalid multi-ship action has no side effects', () => {
    const e = quietEngine(),
      before = structuredClone(e.state);
    expect(
      e.dispatchCommand({
        type: 'issueDirective',
        shipIds: ['verity', 'missing'],
        mode: 'REPLACE',
        action: { type: 'MOVE', point: { x: 2, y: 0 } },
      }).ok,
    ).toBe(false);
    expect(e.state).toEqual(before);
    for (const command of [
      {
        type: 'issueDirective',
        shipIds: ['verity'],
        mode: 'REPLACE',
        action: {
          type: 'HAUL',
          sourceId: 'base',
          targetId: 'colony',
          amount: -5,
          cargoKind: 'materials',
          route: 'safe',
          repeat: false,
        },
      },
      { type: 'renameEntity', entityId: 'base', name: '' },
      { type: 'speed', speed: 99 },
    ])
      expect(e.dispatchCommand(command).ok).toBe(false);
    expect(e.state).toEqual(before);
  });
  it('REPLACE releases unused inventory reservations, never unloads implicitly', () => {
    const e = quietEngine(),
      s = e.state.ships[0];
    s.x = e.base.x;
    s.y = e.base.y;
    issue(
      e,
      {
        type: 'HAUL',
        sourceId: 'base',
        targetId: 'colony',
        cargoKind: 'materials',
        amount: 20,
        route: 'direct',
        repeat: false,
      },
      s.id,
    );
    run(e, 0.1);
    expect(s.current!.reserved.materials).toBe(20);
    const stock = e.base.stock.materials;
    expect(available(e.state, 'base', 'materials')).toBeCloseTo(stock - 20);
    issue(e, { type: 'MOVE', point: { x: 0, y: 0 } }, s.id);
    expect(available(e.state, 'base', 'materials')).toBeCloseTo(stock);
  });
  it('interrupting a loaded freighter preserves its manifest and continues delivery exactly once', () => {
    const e = quietEngine(),
      s = e.state.ships[0];
    s.x = e.base.x;
    s.y = e.base.y;
    issue(
      e,
      {
        type: 'HAUL',
        sourceId: 'base',
        targetId: 'outpost',
        cargoKind: 'photon',
        amount: 8,
        route: 'direct',
        repeat: false,
      },
      s.id,
    );
    until(e, () => s.current?.phase === 'delivering');
    expect(s.cargo.photon).toBe(8);
    issue(e, { type: 'MOVE', point: { x: s.x + 5, y: s.y } }, s.id, 'INTERRUPT');
    until(e, () => !s.current);
    expect(s.cargo.photon).toBe(0);
    expect(e.state.locations.find((l) => l.id === 'outpost')!.stock.photon).toBe(8);
    expect(e.base.stock.photon).toBe(82);
  });
  it.each(['meridian', 'vigil', 'verity', 'horizon'])(
    '%s can explore, survey, transport and explicitly attack',
    (id) => {
      const e = quietEngine(),
        s = e.state.ships.find((s) => s.id === id)!,
        b = e.state.bodies.find((b) => b.kind === 'resource' && b.survey === 2)!;
      expect(
        issue(e, { type: 'EXPLORE', sector: { q: 0, r: -1 }, approach: 'remote' }, id).ok,
      ).toBe(true);
      expect(
        issue(e, { type: 'SURVEY', targetId: b.id, approach: 'close', deep: false }, id).ok,
      ).toBe(true);
      s.x = b.x;
      s.y = b.y;
      run(e, 2);
      expect(s.current!.work).toBeGreaterThan(0);
      expect(s.cargo.materials).toBe(0);
      expect(
        issue(
          e,
          {
            type: 'HAUL',
            sourceId: 'base',
            targetId: 'colony',
            cargoKind: 'materials',
            amount: Math.min(8, capabilities(s).cargo),
            route: 'safe',
            repeat: false,
          },
          id,
        ).ok,
      ).toBe(true);
      const enemy = makeEnemy('test-raider', 'raider', 'orion', { x: s.x + 20, y: s.y });
      e.state.enemies.push(enemy);
      observe(e.state, enemy, 6);
      s.standing.roe = 'HOLD FIRE';
      expect(issue(e, { type: 'ATTACK', targetId: enemy.id }, id).ok).toBe(true);
      run(e, 0.1);
      expect(enemy.shield).toBeLessThan(capabilities(enemy).shield);
    },
  );
  it('only a supplied mine extracts finite ore and HAUL delivers the actual output', () => {
    const e = quietEngine(),
      s = e.state.ships[0],
      mine = e.state.locations.find((l) => l.id === 'mine')!,
      b = e.state.bodies.find((b) => b.id === mine.siteId)!;
    b.remaining = 5;
    const old = mine.stock.materials,
      base = e.base.stock.materials;
    run(e, 5);
    expect(b.remaining).toBe(0);
    expect(mine.stock.materials).toBe(old + 5);
    expect(e.base.stock.materials).toBe(base);
    issue(
      e,
      {
        type: 'HAUL',
        sourceId: mine.id,
        targetId: 'base',
        cargoKind: 'materials',
        amount: 5,
        route: 'direct',
        repeat: false,
      },
      s.id,
    );
    until(e, () => !s.current);
    expect(e.base.stock.materials).toBe(base + 5);
    expect(s.cargo.materials).toBe(0);
  });
  it('remote discovery creates real permanent geography; close survey and Special Finds are one-time', () => {
    const e = quietEngine(),
      s = e.state.ships[2],
      count = e.state.systems.length;
    issue(e, { type: 'EXPLORE', sector: { q: 0, r: -1 }, approach: 'remote' }, s.id);
    until(e, () => !s.current, 120);
    expect(e.state.systems.length).toBeGreaterThan(count);
    const ids = e.state.systems.map((x) => x.id),
      b = {
        ...e.state.bodies[0],
        id: 'sample-anomaly',
        kind: 'anomaly' as const,
        discovered: true,
        hidden: false,
        specialClaimed: false,
      };
    e.state.bodies.push(b);
    e.state.systems.find((x) => x.id === b.systemId)!.bodyIds.push(b.id);
    e.state.locations.find((l) => l.id === 'colony')!.colony!.population = 0;
    const before = e.state.resources.credits;
    issue(e, { type: 'EXPLORE', sector: { q: 0, r: -1 }, approach: 'remote' }, s.id);
    until(e, () => !s.current);
    expect(e.state.systems.map((x) => x.id)).toEqual(ids);
    expect(
      e.state.history.filter((h) => h.kind === 'discovery' && h.entityId === ids[count]),
    ).toHaveLength(1);
    expect(e.state.resources.credits - before).toBeLessThan(60);
    issue(e, { type: 'SURVEY', targetId: b.id, approach: 'close', deep: false }, s.id);
    until(e, () => !s.current);
    expect(s.cargo.specialFinds).toBe(1);
    issue(e, { type: 'SURVEY', targetId: b.id, approach: 'close', deep: false }, s.id);
    until(e, () => !s.current);
    expect(s.cargo.specialFinds).toBe(1);
  });
  it('transport conserves goods and selling consumes inventory instead of rewarding repeated transfers', () => {
    const e = quietEngine(),
      s = e.state.ships[0],
      dest = e.state.locations.find((l) => l.id === 'outpost')!;
    const total = e.base.stock.photon + dest.stock.photon;
    issue(
      e,
      {
        type: 'HAUL',
        sourceId: 'base',
        targetId: dest.id,
        cargoKind: 'photon',
        amount: 12,
        route: 'direct',
        repeat: false,
      },
      s.id,
    );
    until(e, () => !s.current);
    expect(e.base.stock.photon + dest.stock.photon + s.cargo.photon).toBe(total);
    const c = e.state.resources.credits;
    expect(e.dispatchCommand({ type: 'sellStock', cargoKind: 'photon', amount: 10 }).ok).toBe(true);
    expect(e.base.stock.photon + dest.stock.photon).toBe(total - 10);
    expect(e.state.resources.credits).toBe(c + 120);
  });
  it('a lost target fails safely and runs the next directive', () => {
    const e = quietEngine(),
      s = e.state.ships[2],
      target = makeEnemy('target', 'raider', 'orion', { x: 400, y: 400 });
    e.state.enemies.push(target);
    observe(e.state, target, 6);
    issue(e, { type: 'SHADOW', targetId: target.id }, s.id);
    issue(e, { type: 'DOCK', targetId: 'base' }, s.id, 'QUEUE');
    e.state.enemies = [];
    run(e, 31);
    expect(s.current?.action.type === 'DOCK' || !s.current).toBe(true);
    expect(e.state.history.some((h) => h.kind === 'actionFailed')).toBe(true);
  });
});

describe('continuation and security edge cases', () => {
  it('partly completed rearm can be interrupted and resumes remaining rounds without overfilling', () => {
    const e = quietEngine(),
      s = e.state.ships[2];
    s.x = e.base.x;
    s.y = e.base.y;
    s.photon = 20;
    issue(e, { type: 'REARM', targetId: 'base', load: { photon: 4, quantum: 0 } }, s.id);
    run(e, 0.7);
    expect(s.photon).toBe(21);
    issue(e, { type: 'MOVE', point: { x: s.x, y: s.y } }, s.id, 'INTERRUPT');
    until(e, () => !s.current);
    expect(s.photon).toBe(24);
    expect(e.base.stock.photon).toBe(86);
  });
  it('a depleted deposit does not invalidate a suspended physical delivery', () => {
    const e = quietEngine(),
      s = e.state.ships[0],
      mine = e.state.locations.find((l) => l.id === 'mine')!;
    e.state.bodies.find((b) => b.id === mine.siteId)!.remaining = 0;
    s.x = mine.x;
    s.y = mine.y;
    issue(
      e,
      {
        type: 'HAUL',
        sourceId: mine.id,
        targetId: 'base',
        cargoKind: 'materials',
        amount: 2,
        route: 'direct',
        repeat: false,
      },
      s.id,
    );
    until(e, () => s.current?.phase === 'delivering');
    issue(e, { type: 'MOVE', point: { x: s.x + 2, y: s.y } }, s.id, 'INTERRUPT');
    until(e, () => !s.current);
    expect(s.cargo.materials).toBe(0);
    expect(e.state.history.filter((h) => h.kind === 'actionFailed')).toEqual([]);
  });
  it('REPLACE remains legal even at maximum queue and interrupt depth', () => {
    const e = quietEngine(),
      s = e.state.ships[0];
    issue(e, { type: 'MOVE', point: { x: 500, y: 0 } }, s.id);
    for (let i = 0; i < 32; i++) issue(e, { type: 'DOCK', targetId: 'base' }, s.id, 'QUEUE');
    expect(issue(e, { type: 'DOCK', targetId: 'base' }, s.id, 'QUEUE').ok).toBe(false);
    for (let i = 0; i < 16; i++)
      expect(issue(e, { type: 'MOVE', point: { x: 100, y: i } }, s.id, 'INTERRUPT').ok).toBe(true);
    expect(issue(e, { type: 'DOCK', targetId: 'base' }, s.id, 'INTERRUPT').ok).toBe(false);
    expect(issue(e, { type: 'DOCK', targetId: 'base' }, s.id).ok).toBe(true);
    expect(s.queue).toEqual([]);
    expect(s.suspended).toEqual([]);
  });
  it('arriving at the edge of a safe delivery radius unloads instead of starting another detour', () => {
    const e = quietEngine(),
      s = e.state.ships[0],
      dest = e.state.locations.find((l) => l.id === 'outpost')!;
    s.x = dest.x + 8.00000000000002;
    s.y = dest.y;
    s.cargo.photon = 4;
    issue(
      e,
      {
        type: 'HAUL',
        sourceId: 'base',
        targetId: dest.id,
        cargoKind: 'photon',
        amount: 4,
        route: 'safe',
        repeat: false,
      },
      s.id,
    );
    s.current!.phase = 'delivering';
    s.current!.carried = 4;
    run(e, 2.1);
    expect(s.current).toBeNull();
    expect(dest.stock.photon).toBe(4);
    expect(s.path).toEqual([]);
  });
  it('Escort follows a moving vessel and protected-object ROE reacts to an actual attacker', () => {
    const e = quietEngine(),
      s = e.state.ships[1],
      freighter = e.state.ships[0],
      r = makeEnemy('escort-raider', 'raider', 'orion', { x: 100, y: 500 });
    e.state.enemies = [r];
    s.x = 90;
    s.y = 500;
    freighter.x = 110;
    freighter.y = 500;
    r.intent = 'raid';
    r.targetId = freighter.id;
    r.nextDecision = 1e9;
    observe(e.state, r, 6);
    issue(e, { type: 'MOVE', point: { x: 300, y: 500 } }, freighter.id);
    issue(e, { type: 'ESCORT', targetId: freighter.id }, s.id);
    e.fire(r, freighter);
    run(e, 3);
    expect(s.x).toBeGreaterThan(90);
    expect(r.shield).toBeLessThan(capabilities(r).shield);
  });
  it('Intercept resolves a real contact and Drive Off ends on observed risk-driven retreat', () => {
    const e = quietEngine(),
      s = e.state.ships[2],
      r = makeEnemy('intercept-raider', 'raider', 'orion', { x: 300, y: 500 });
    s.x = 250;
    s.y = 500;
    r.nextDecision = 1e9;
    e.state.enemies = [r];
    observe(e.state, r, 6);
    issue(e, { type: 'INTERCEPT', targetId: r.id }, s.id);
    until(e, () => !s.current, 10);
    expect(e.state.history.some((h) => h.text.includes('已截获接触'))).toBe(true);
    r.hull = 35;
    r.shield = 0;
    r.nextDecision = 0;
    issue(e, { type: 'DRIVE_OFF', targetId: r.id }, s.id);
    until(e, () => !s.current, 30);
    expect(r.intent).toBe('retreat');
    expect(e.state.history.some((h) => h.text.includes('已观测到目标撤退'))).toBe(true);
  });
});
