import { recoverVeil, trackingScenario } from './recon-scenarios';
import { describe, expect, it } from 'vitest';
import { quietEngine, issue, run, until } from './helpers';
import { SimulationEngine } from '../src/engine/engine';
import { makeEnemy } from '../src/engine/data';
import { parseSave } from '../src/engine/saves';
import { capabilities } from '../src/engine/capabilities';
import { generatedSector, VEIL_SITE } from '../src/engine/world-generation';
import { observe } from '../src/engine/sensors';
import { canDetectShip, TRACKING_RULES, updateSiteIntel } from '../src/engine/tracking';
import { assistEvent, createEvent } from '../src/engine/world-events';
import { FACILITIES, BUILD_COSTS } from '../src/engine/definitions/progression';
import { dist, segmentDistance } from '../src/engine/navigation';

describe('v9 command authority and economic boundaries', () => {
  it.each(['idle', 'low ammunition', 'low noncombat condition', 'completion', 'cancel', 'restart'])(
    '%s leaves default ships at their actual position',
    (condition) => {
      let e = quietEngine();
      let ship = e.state.ships[1];
      ship.x = 430;
      ship.y = -900;
      if (condition === 'low ammunition') {
        ship.photon = 0;
        ship.quantum = 0;
        ship.standing.serviceWhenDocked = true;
      }
      if (condition === 'low noncombat condition') {
        ship.hull = 20;
        ship.core = 0;
        ship.shield = 0;
      }
      if (condition === 'completion' || condition === 'cancel') {
        issue(e, { type: 'MOVE', point: { x: 440, y: -900 } }, ship.id);
        if (condition === 'cancel') e.dispatchCommand({ type: 'cancelDirective', shipId: ship.id });
        else until(e, () => !ship.current);
      }
      if (condition === 'restart') {
        e = new SimulationEngine(parseSave(JSON.parse(JSON.stringify(e.state))));
        ship = e.state.ships[1];
      }
      const at = { x: ship.x, y: ship.y };
      run(e, 1440);
      expect({ x: ship.x, y: ship.y }).toEqual(at);
      expect(ship.current).toBeNull();
      expect(ship.path).toEqual([]);
      expect(e.state.history.some((h) => h.text.includes(' / RETURN / '))).toBe(false);
    },
  );
  it('emergency disengagement is local and Admiral commands can interrupt it', () => {
    const e = quietEngine(),
      s = e.state.ships[1],
      r = makeEnemy('attacker', 'raider', 'orion', { x: 740, y: -900 });
    s.x = 700;
    s.y = -900;
    s.shield = 0;
    s.hull = 40;
    observe(e.state, r, 6);
    e.hit(s, 10, r);
    run(e, 0.1);
    expect(s.emergencyRetreat).not.toBeNull();
    expect(s.current).toBeNull();
    expect(dist(s.emergencyRetreat!.point, e.base)).toBeGreaterThan(900);
    until(e, () => !s.emergencyRetreat, 100);
    const at = { x: s.x, y: s.y };
    run(e, 100);
    expect({ x: s.x, y: s.y }).toEqual(at);
    s.hull = 20;
    s.shield = 0;
    e.hit(s, 1, r);
    run(e, 0.1);
    expect(s.emergencyRetreat).not.toBeNull();
    issue(e, { type: 'MOVE', point: { x: 750, y: -930 } }, s.id);
    expect(s.emergencyRetreat).toBeNull();
    until(e, () => !s.current);
    expect(s.x).toBeGreaterThan(740);
  });
  it('inventory keys and strict v9 saves contain only the physical goods, and reject old formats', () => {
    const e = quietEngine();
    const keys = ['materials', 'photon', 'quantum', 'specialFinds'];
    for (const x of [...e.state.locations, ...e.state.ships])
      expect(Object.keys('stock' in x ? x.stock : x.cargo)).toEqual(keys);
    expect(Object.keys(e.state.ships[0].standing)).not.toContain('idle');
    expect(e.state.locations.find((l) => l.id === 'mine')!.capacity.materials).toBe(3000);
    expect(
      Object.values(FACILITIES)
        .slice(1)
        .map((f) => f.cost.credits),
    ).toEqual([165, 200, 280, 190]);
    expect(Object.values(BUILD_COSTS).map((f) => f.credits)).toEqual([220, 290, 550, 860]);
    const old = structuredClone(e.state);
    Object.assign(old.locations[0].stock, { obsoleteResource: 1 });
    expect(() => parseSave(old)).toThrow();
    expect(() => parseSave({ ...e.state, version: 7 })).toThrow();
  });
  it('medical work consumes Credits on site and never distant inventory', () => {
    const e = quietEngine(),
      s = e.state.ships[2],
      l = e.state.locations.find((l) => l.id === 'colony')!;
    l.colony!.contamination = 25;
    const v = createEvent(e, 'plague', l.id, '现场医疗');
    issue(e, { type: 'ASSIST_EVENT', targetId: v.id }, s.id);
    const d = s.current!,
      credits = e.state.resources.credits,
      stock = structuredClone(l.stock);
    assistEvent(e, s, d, 1, () => false);
    expect(e.state.resources.credits).toBe(credits);
    assistEvent(e, s, d, 1, () => true);
    expect(e.state.resources.credits).toBeCloseTo(credits - 0.8);
    expect(l.stock).toEqual(stock);
  });
});

describe('sparse deterministic generation and unique persistent reconnaissance ship', () => {
  it('hundreds of coordinate/seed combinations meet density and clearance bounds', () => {
    for (const seed of [1, 42, 1701, 236807, 713131])
      for (let q = -5; q <= 5; q++)
        for (const r of [-2, 0, 2, 12]) {
          const g = generatedSector(seed, { q, r });
          expect(g.systems.length).toBeGreaterThanOrEqual(1);
          expect(g.systems.length).toBeLessThanOrEqual(2);
          for (const a of g.systems) {
            const bodies = g.bodies.filter((b) => b.systemId === a.id);
            expect(bodies.length).toBeLessThanOrEqual(6);
            expect(bodies.filter((b) => b.kind === 'planet').length).toBeLessThanOrEqual(3);
            for (const b of g.systems.filter((b) => b.id !== a.id))
              expect(dist(a, b)).toBeGreaterThanOrEqual(180 - 1e-8);
            for (const b of g.bodies) expect(dist(a, b)).toBeGreaterThanOrEqual(70 - 1e-8);
          }
          for (const a of g.bodies)
            for (const b of g.bodies.filter((b) => b.id !== a.id))
              expect(dist(a, b)).toBeGreaterThanOrEqual(60 - 1e-8);
          expect(g).toEqual(generatedSector(seed, { q, r }));
        }
  });
  it('fixed passage pairs are independent of seed and the recovery survives delays, saves and permanent loss', () => {
    for (const seed of [1, 42, 1701, 236807]) {
      const entrance = generatedSector(seed, { q: 0, r: 0 }).wormholes[0],
        exit = generatedSector(seed, { q: 0, r: 12 });
      expect(entrance.exitSector).toEqual({ q: 0, r: 12 });
      expect(exit.wormholes[0].exitSector).toEqual({ q: 0, r: 0 });
      expect(exit.bodies.filter((b) => b.id === VEIL_SITE)).toHaveLength(1);
    }
    const e = quietEngine();
    const veil = recoverVeil(e);
    expect(capabilities(veil)).toMatchObject({
      hull: 70,
      shield: 45,
      core: 100,
      warp: 8,
      cargo: 10,
      sensors: 420,
      science: 110,
      moduleSlots: 2,
    });
    expect(veil.photon + veil.quantum).toBe(0);
    const saved = new SimulationEngine(parseSave(JSON.parse(JSON.stringify(e.state))));
    run(saved, 300);
    expect(saved.state.ships.filter((s) => s.classId === 'veil')).toHaveLength(1);
    saved.dispatchCommand({ type: 'renameEntity', entityId: 'veil', name: 'USS SILENCE / 静默号' });
    e.hit(veil, 9999);
    run(e, 300);
    expect(e.state.ships.some((s) => s.id === 'veil')).toBe(false);
    expect(parseSave(e.state).recoveredVeil).toBe(true);
    expect(e.state.losses.some((l) => l.shipId === 'veil')).toBe(true);
    expect(parseSave(saved.state).ships.find((s) => s.id === 'veil')!.name).toContain('静默');
  });
  it('an unclaimed Veil recovery event cannot expire', () => {
    const e = quietEngine();
    recoverVeil(e);
    // Separate unclaimed world follows the real survey route, then waits beyond ordinary deadlines.
    const a = quietEngine(),
      s = a.state.ships[2];
    issue(a, { type: 'TRANSIT', targetId: 'wormhole:0:0' }, s.id);
    until(a, () => !s.current);
    issue(a, { type: 'SURVEY', targetId: VEIL_SITE, approach: 'close', deep: false }, s.id);
    until(a, () => !s.current);
    run(a, 301);
    const v = a.state.events.find((v) => v.subjectId === VEIL_SITE)!;
    expect(v.stage).toBe('reported');
    issue(a, { type: 'ASSIST_EVENT', targetId: v.id }, s.id);
    until(a, () => v.stage === 'resolved');
    expect(a.state.recoveredVeil).toBe(true);
  });
});

describe('physical SHADOW evidence, evasion and progressive location intelligence', () => {
  it('confirmation requires ten elapsed minutes and interruption resets consecutive evidence', () => {
    const e = quietEngine(),
      site = e.state.locations.find((l) => l.id === 'orion-base')!,
      s = e.state.ships[2];
    s.x = site.x;
    s.y = site.y;
    updateSiteIntel(e);
    expect(e.state.siteIntel[0].progress).toBe(0);
    run(e, 9);
    expect(site.discovered).toBe(false);
    expect(e.state.siteIntel[0].progress).toBe(9);
    s.x = -900;
    s.y = 900;
    run(e, 2);
    s.x = site.x;
    s.y = site.y;
    run(e, 1);
    expect(e.state.siteIntel[0].progress).toBe(0);
    expect(site.discovered).toBe(false);
    run(e, 9);
    expect(site.discovered).toBe(false);
    run(e, 1);
    expect(site.discovered).toBe(true);
  });
  it('an identified tail must disappear before evasion can resume the real return route', () => {
    const { e, ship, target, home } = trackingScenario('orion', false);
    until(e, () => target.counterTracking.evading, 60);
    // Canceling the Admiral order cannot erase evidence already physically held by the enemy.
    e.dispatchCommand({ type: 'cancelDirective', shipId: ship.id });
    for (let i = 0; i < 200; i++) {
      ship.x = target.x - 50;
      ship.y = target.y;
      run(e, 0.1);
      expect(target.counterTracking.evading).toBe(true);
    }
    ship.x = -4000;
    ship.y = 4000;
    run(e, TRACKING_RULES.quietMinutes + 1);
    expect(target.counterTracking.evading).toBe(false);
    expect(target.counterTracking.waypoints).toEqual([]);
    expect(home.discovered).toBe(false);
  });
  it('tracking, cloak, counter evidence and partial site progress are independent of host speed', () => {
    const initial = trackingScenario('romulan').e.state;
    const worlds = [];
    for (const speed of [1, 4, 16] as const) {
      const e = new SimulationEngine(parseSave(JSON.parse(JSON.stringify(initial))));
      e.state.speed = speed;
      const end = e.state.tick + 1600;
      while (e.state.tick < end) {
        e.dispatchCommand({ type: 'pause', paused: false });
        e.advanceFrame((_events,state)=>{if(state.tick===end) state.paused=true;});
      }
      worlds.push({ ...e.state, speed: 1, paused: false });
    }
    expect(worlds[1]).toEqual(worlds[0]);
    expect(worlds[2]).toEqual(worlds[0]);
  });
  it.each(['orion', 'romulan'] as const)(
    'ordinary tracking can expose the follower and divert a returning %s scout',
    (faction) => {
      const { e, target, home } = trackingScenario(faction, false);
      until(e, () => target.counterTracking.evading, 60);
      expect(target.counterTracking.watchers.horizon.exposure).toBeGreaterThan(
        TRACKING_RULES.detectionThreshold,
      );
      expect(target.counterTracking.waypoints.length).toBeGreaterThan(0);
      expect(home.discovered).toBe(false);
      const from = { x: target.x, y: target.y };
      for (const waypoint of target.counterTracking.waypoints)
        expect(segmentDistance(home, from, waypoint)).toBeGreaterThan(220);
      const saved = new SimulationEngine(parseSave(JSON.parse(JSON.stringify(e.state))));
      run(e, 20);
      run(saved, 20);
      expect(saved.state).toEqual(e.state);
      expect(dist(target, home)).toBeGreaterThan(dist(from, home));
    },
  );
  it.each(['orion', 'romulan'] as const)(
    'cloaked long-term following reliably confirms the real %s destination and enables strikes',
    (faction) => {
      for (const seed of [42, 1701, 236807]) {
        const { e, ship, target, home } = trackingScenario(faction, true, seed);
        run(e, 1);
        expect(ship.cloak).toBe('on');
        expect(canDetectShip(target, ship, e.state.time)).toBe(false);
        until(e, () => e.state.siteIntel.some((i) => i.locationId === home.id), 150);
        expect(home.discovered).toBe(false);
        expect(e.snapshot().siteContacts[0].progress).toBeLessThan(10);
        const saved = new SimulationEngine(parseSave(JSON.parse(JSON.stringify(e.state))));
        run(e, 5);
        run(saved, 5);
        expect(saved.state).toEqual(e.state);
        until(e, () => home.discovered, 160);
        expect(target.counterTracking.evading).toBe(false);
        until(e, () => !ship.current, 60);
        expect(ship.core).toBeGreaterThan(90);
        expect(ship.cloak).toBe('on');
        const snapshot = e.snapshot();
        expect(snapshot.locations.some((l) => l.id === home.id)).toBe(true);
        expect(issue(e, { type: 'ATTACK', targetId: home.id }, 'horizon').ok).toBe(true);
        const force = e.state.ships.find((s) => s.id === 'horizon')!;
        force.x = home.x - 40;
        force.y = home.y;
        const shield = home.shield;
        run(e, 1);
        expect(home.shield).toBeLessThan(shield);
      }
    },
  );
  it('manual cloak persists through the current SHADOW, firing decloaks, and unsupported hulls reject the command', () => {
    const { e, ship, target } = trackingScenario('orion');
    expect(e.dispatchCommand({ type: 'setCloak', shipId: 'meridian', enabled: true }).ok).toBe(
      false,
    );
    e.dispatchCommand({ type: 'setCloak', shipId: ship.id, enabled: false });
    run(e, 1);
    expect(ship.cloak).toBe('off');
    e.dispatchCommand({ type: 'setCloak', shipId: ship.id, enabled: true });
    run(e, 30);
    expect(ship.cloak).toBe('on');
    const saved = parseSave(JSON.parse(JSON.stringify(e.state)));
    expect(saved.ships.find((s) => s.id === ship.id)!.cloak).toBe('on');
    target.x = ship.x + 30;
    target.y = ship.y;
    e.fire(ship, target);
    expect(ship.cloak).toBe('decloaking');
    run(e, 1.1);
    expect(ship.cloak).toBe('off');
  });
  it('lost followers search their own last observation despite remote network knowledge and then hold', () => {
    const { e, ship, target } = trackingScenario('orion');
    run(e, 2);
    const last = { ...ship.tracking!.position };
    target.x = 5000;
    target.y = -5000;
    target.intent = 'observe';
    target.nextDecision = 1e9;
    target.destination = null;
    const remote = e.state.ships[2];
    remote.x = target.x;
    remote.y = target.y;
    run(e, 3);
    expect(e.state.intel.find((i) => i.id === target.id)!.x).toBe(5000);
    expect(ship.tracking!.position).toEqual(last);
    expect(ship.current!.note).toContain('最后观测');
    until(e, () => !ship.current, 60);
    const at = { x: ship.x, y: ship.y };
    run(e, 100);
    expect({ x: ship.x, y: ship.y }).toEqual(at);
  });
  it('counter-cloak sensing is stronger for Romulans, while Veil exposure remains small', () => {
    const { e, ship } = trackingScenario('orion');
    e.dispatchCommand({ type: 'setCloak', shipId: ship.id, enabled: true });
    const orion = makeEnemy('o', 'raider', 'orion', { x: ship.x + 22, y: ship.y }),
      rom = makeEnemy('r', 'scout', 'romulan', { x: ship.x + 22, y: ship.y });
    expect(canDetectShip(orion, ship, e.state.time)).toBe(false);
    expect(canDetectShip(rom, ship, e.state.time)).toBe(true);
  });
  it('public snapshots and observations never carry unknown bases, private intent, evasion or destination fields', () => {
    const { e, target, home, ship } = trackingScenario('romulan', false);
    until(e, () => target.counterTracking.evading, 60);
    const json = JSON.stringify(e.snapshot());
    for (const key of [
      'counterTracking',
      'waypoints',
      'destination',
      'intent',
      'siteIntel',
      'localReports',
      'romulan-base',
      'orion-base',
    ])
      expect(json).not.toContain('"' + key + '"');
    expect(json).not.toContain(home.name);
    expect(e.snapshot().beams).toEqual([]);
    const operator = e.state.assignments.find((a) => a.shipId === ship.id)!.operatorId;
    expect(JSON.stringify(e.getObservation(operator))).not.toContain(home.name);
    // Docking at home alone does not grant location knowledge to a distant follower.
    target.x = home.x;
    target.y = home.y;
    target.intent = 'docked';
    e.state.ships.forEach((s) => {
      s.x = -900;
      s.y = 900;
    });
    run(e, 5);
    expect(home.discovered).toBe(false);
    expect(e.snapshot().locations.some((l) => l.id === home.id)).toBe(false);
  });
});
