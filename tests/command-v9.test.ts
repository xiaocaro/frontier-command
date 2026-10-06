import { describe, expect, it } from 'vitest';
import { quietEngine, issue, run, until } from './helpers';
import { makeEnemy, emptyStock } from '../src/engine/data';
import { SimulationEngine } from '../src/engine/engine';
import { parseSave } from '../src/engine/saves';
import { planRoute, segmentDistance, safeRouteBlocked } from '../src/engine/navigation';
import { updateSensors } from '../src/engine/sensors';
import { materialize, VEIL_SITE } from '../src/engine/world-generation';
import { recoverVeil } from './recon-scenarios';
import { placeLabels } from '../src/ui/map/camera';
import { parsePreferences } from '../src/ui/lcars/preferences';

describe('v9 command and public-state boundaries', () => {
  it('safe routes avoid only observed hazards, with coordinate-only deterministic paths', () => {
    const e = quietEngine(),
      start = { x: 0, y: 0 },
      end = { x: 600, y: 0 };
    const hazard = {
      ...e.state.bodies[0],
      id: 'route-hazard',
      kind: 'anomaly' as const,
      x: 300,
      y: 0,
      discovered: false,
    };
    e.state.bodies.push(hazard);
    e.state.enemies.push(makeEnemy('hidden-route-enemy', 'raider', 'orion', { x: 150, y: 0 }));
    expect(planRoute(e.state, start, end, 'safe')).toEqual([end]);
    hazard.discovered = true;
    const path = planRoute(e.state, start, end, 'safe');
    expect(path.length).toBeGreaterThan(1);
    expect(safeRouteBlocked(e.state, start, path)).toBe(false);
    expect(planRoute(e.snapshot(), start, end, 'safe')).toEqual(path);
    expect(planRoute(e.state, start, end, 'direct')).toEqual([end]);
    let at = start;
    for (const p of path) {
      expect(segmentDistance(hazard, at, p)).toBeGreaterThanOrEqual(85 - 1e-8);
      expect(Object.keys(p).sort()).toEqual(['x', 'y']);
      at = p;
    }
    e.state.bodies.reverse();
    expect(planRoute(e.state, start, end, 'safe')).toEqual(path);
  });
  it('top resources count only Dawn inventory, and subtract held reservations across interruptions', () => {
    const e = quietEngine();
    e.state.ships[0].x = e.base.x;
    e.state.ships[0].y = e.base.y;
    issue(
      e,
      {
        type: 'HAUL',
        sourceId: 'base',
        targetId: 'mine',
        cargoKind: 'materials',
        amount: 40,
        route: 'safe',
        repeat: false,
      },
      'meridian',
    );
    run(e, 0.1);
    expect(e.snapshot().baseResources).toEqual({
      credits: 380,
      stock: { materials: 70, photon: 90, quantum: 20, specialFinds: 0 },
      available: { materials: 30, photon: 90, quantum: 20, specialFinds: 0 },
      reserved: { materials: 40, photon: 0, quantum: 0, specialFinds: 0 },
    });
    issue(e, { type: 'MOVE', point: { x: 0, y: 0 } }, 'meridian', 'INTERRUPT');
    expect(e.snapshot().baseResources.available.materials).toBe(30);
    e.dispatchCommand({ type: 'cancelDirective', shipId: 'meridian' });
    expect(e.snapshot().baseResources.reserved.materials).toBe(0);
    expect(e.snapshot().baseResources.available.materials).toBe(70);
    e.state.ships[0].cargo.materials = 55;
    expect(e.snapshot().baseResources.available.materials).toBe(70);
  });
  it('RETURN preserves real cargo, UNLOAD goes directly to Dawn and deposits it', () => {
    const e = quietEngine(),
      s = e.state.ships.find((s) => s.id === 'meridian')!;
    s.x = 240;
    s.y = -80;
    s.cargo.materials = 25;
    issue(e, { type: 'RETURN' }, s.id);
    run(e, 0.1);
    expect(s.path).toHaveLength(1);
    expect(segmentDistance(s.path[0], s, e.base)).toBeLessThan(1e-8);
    until(e, () => !s.current, 200);
    expect(s.cargo.materials).toBe(25);
    issue(e, { type: 'UNLOAD', targetId: 'base' }, s.id);
    until(e, () => !s.current);
    expect(s.cargo.materials).toBe(0);
    expect(e.base.stock.materials).toBe(95);
    expect(
      e.state.history
        .filter((h) => h.kind === 'cargo')
        .map((h) => h.text)
        .join(),
    ).not.toContain('装载');
  });
  it('close survey creates the existing capture event on the exact completion tick', () => {
    const e = quietEngine();
    materialize(e.state, { q: 0, r: 12 });
    const body = e.state.bodies.find((b) => b.id === VEIL_SITE)!,
      s = e.state.ships.find((s) => s.id === 'verity')!;
    body.discovered = true;
    s.x = body.x;
    s.y = body.y;
    issue(e, { type: 'SURVEY', targetId: body.id, approach: 'close', deep: false }, s.id);
    until(e, () => !s.current, 100);
    expect(body.survey).toBe(2);
    const event = e.state.events.find((v) => v.subjectId === body.id && v.kind === 'derelict')!;
    expect(event.created).toBe(e.state.time);
    expect(issue(e, { type: 'ASSIST_EVENT', targetId: event.id }, s.id).ok).toBe(true);
    expect(
      e.dispatchCommand({
        type: 'startConstruction',
        siteId: body.id,
        kind: 'mine',
        name: 'Invalid mine',
      }).ok,
    ).toBe(false);
  });
  it('claimed Veil markers can be dismissed permanently while identities and history remain', () => {
    const e = quietEngine();
    recoverVeil(e);
    expect(e.snapshot().mapMarkers.removableIds).toContain(VEIL_SITE);
    expect(e.dispatchCommand({ type: 'dismissMapMarker', entityId: VEIL_SITE }).ok).toBe(true);
    const restored = new SimulationEngine(parseSave(JSON.parse(JSON.stringify(e.state))));
    expect(restored.snapshot().mapMarkers.dismissedIds).toContain(VEIL_SITE);
    expect(restored.state.bodies.some((b) => b.id === VEIL_SITE)).toBe(true);
    expect(restored.state.ships.some((s) => s.id === 'veil')).toBe(true);
    expect(restored.state.history.some((h) => h.kind === 'mapCleanup')).toBe(true);
  });
  it('valuable or unfinished wrecks cannot be hidden, but empty wrecks can', () => {
    const e = quietEngine();
    const wreck = {
      id: 'empty-wreck',
      name: 'Empty wreck',
      x: 0,
      y: 0,
      stock: emptyStock(),
      capacity: emptyStock(),
      discovered: true,
    };
    e.state.wrecks.push(wreck);
    wreck.stock.materials = 1;
    expect(e.dispatchCommand({ type: 'dismissMapMarker', entityId: wreck.id }).ok).toBe(false);
    wreck.stock.materials = 0;
    expect(e.dispatchCommand({ type: 'dismissMapMarker', entityId: wreck.id }).ok).toBe(true);
    expect(e.dispatchCommand({ type: 'dismissMapMarker', entityId: 'base' }).ok).toBe(false);
  });
  it('successful transit publishes only the actual own ship, exit and tick', () => {
    const e = quietEngine(),
      ship = e.state.ships.find((s) => s.id === 'verity')!;
    const h = e.state.wormholes.find((h) => h.id === 'wormhole:0:0')!;
    ship.x = h.x;
    ship.y = h.y;
    issue(e, { type: 'TRANSIT', targetId: h.id }, ship.id);
    const events = [];
    while (ship.current) {
      e.dispatchCommand({ type: 'pause', paused: false });
      events.push(...e.step());
    }
    const transit = events.filter((v) => v.type === 'shipTransited');
    expect(transit).toEqual([
      {
        type: 'shipTransited',
        shipId: ship.id,
        destination: { x: ship.x, y: ship.y },
        tick: e.state.tick,
      },
    ]);
    expect(JSON.stringify(transit)).not.toMatch(/homeId|intent|destinationId/);
  });
  it('v8 is rejected, v9 keeps private alert deduplication out of the public snapshot', () => {
    const e = quietEngine();
    expect(() => parseSave({ ...e.state, version: 8 })).toThrow(/Unsupported/);
    const enemy = makeEnemy('private-contact', 'raider', 'orion', {
      x: e.base.x + 100,
      y: e.base.y,
    });
    e.state.enemies = [enemy];
    updateSensors(e);
    e.finishCritical();
    const restored = new SimulationEngine(parseSave(JSON.parse(JSON.stringify(e.state))));
    expect(restored.state.contactAlerts).toEqual(e.state.contactAlerts);
    const json = JSON.stringify(restored.snapshot());
    expect(json).not.toMatch(/contactAlerts|counterTracking|"intent"|"destination"/);
    expect(restored.snapshot().contacts[0].name).toBeUndefined();
  });
});
describe('real contact pauses', () => {
  it.each([1, 4, 16] as const)(
    '%sx stops on the same sensor tick, combines contacts, and acknowledgment never resumes',
    (speed) => {
      const e = quietEngine();
      e.state.speed = speed;
      e.state.enemies = [
        makeEnemy('contact-a', 'raider', 'orion', { x: e.base.x + 100, y: e.base.y }),
        makeEnemy('contact-b', 'scout', 'romulan', { x: e.base.x + 110, y: e.base.y }),
      ];
      e.state.enemies.forEach((s) => {
        s.nextDecision = 1e9;
        s.photon = 0;
      });
      e.dispatchCommand({ type: 'pause', paused: false });
      while (!e.state.paused) e.advanceFrame();
      expect(e.state.tick).toBe(10);
      expect(
        e.state.pauseReasons.filter((r) => r.kind === 'newContact').map((r) => r.entityId),
      ).toEqual(['contact-a', 'contact-b']);
      e.state.communications
        .filter((c) => c.priority === 'urgent')
        .forEach((c) => e.dispatchCommand({ type: 'acknowledge', communicationId: c.id }));
      expect(e.state.paused).toBe(true);
      issue(e, { type: 'MOVE', point: { x: 10, y: 20 } });
      expect(e.state.paused).toBe(true);
      const count = e.state.communications.filter((c) => c.priority === 'urgent').length;
      run(e, 1);
      expect(e.state.communications.filter((c) => c.priority === 'urgent')).toHaveLength(count);
    },
  );
  it('ten minutes without observation retriggers, and first hostile evidence retriggers once', () => {
    const e = quietEngine(),
      enemy = makeEnemy('returning-contact', 'scout', 'romulan', { x: e.base.x + 80, y: e.base.y });
    enemy.cloak = 'off';
    e.state.enemies = [enemy];
    updateSensors(e);
    e.finishCritical();
    const first = e.state.contactAlerts[0].lastAlertAt;
    updateSensors(e);
    expect(e.pending).toHaveLength(0);
    e.state.tick = 101;
    e.state.time = 10.1;
    updateSensors(e);
    expect(e.pending.map((r) => r.kind)).toEqual(['newContact']);
    e.finishCritical();
    expect(e.state.contactAlerts[0].lastAlertAt).toBeGreaterThan(first);
    e.state.tick++;
    e.state.time = e.state.tick / 10;
    enemy.lastHostileAt = e.state.time;
    enemy.lastHostileTargetId = 'base';
    updateSensors(e);
    expect(e.pending).toHaveLength(1);
    e.finishCritical();
    updateSensors(e);
    expect(e.pending).toHaveLength(0);
    expect(e.state.contactAlerts[0].hostileAlerted).toBe(true);
    expect(parseSave(e.state).contactAlerts).toEqual(e.state.contactAlerts);
  });
});
it('dense high priority labels stay local with a four-em maximum connector', () => {
  const labels = Array.from({ length: 30 }, (_, i) => ({
    id: String(i),
    text: 'USS LONG 舰船名字',
    x: 300 + (i % 2),
    y: 250 + (i % 3),
    priority: 200 - i,
    color: '#fff',
    width: 220,
    height: 28,
  }));
  const placed = placeLabels(labels, 800, 600, 1, [], 28);
  expect(placed.length).toBeGreaterThan(0);
  expect(placed.length).toBeLessThan(labels.length);
  for (const label of placed) {
    const original = labels.find((l) => l.id === label.id)!;
    expect(
      Math.hypot(label.connector.x - original.x, label.connector.y - original.y),
    ).toBeLessThanOrEqual(112);
  }
});
it('independent text and interface preferences clamp to supported ranges and survive round trips', () => {
  expect(
    parsePreferences(JSON.stringify({ version: 2, textScale: 3, interfaceZoom: 0.5 })),
  ).toMatchObject({ textScale: 2, interfaceZoom: 1 });
  const p = parsePreferences(JSON.stringify({ version: 2, textScale: 1.75, interfaceZoom: 1.5 }));
  expect(parsePreferences(JSON.stringify(p))).toEqual(p);
});
