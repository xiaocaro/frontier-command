import assert from 'node:assert/strict';
import { quietEngine, issue, run, until } from './helpers';
import type { SimulationEngine } from '../src/engine/engine';
import { makeEnemy } from '../src/engine/data';
import { observe } from '../src/engine/sensors';
import { VEIL_SITE } from '../src/engine/world-generation';
export function recoverVeil(e: SimulationEngine) {
  const ship = e.state.ships.find((s) => s.id === 'verity')!;
  assert.ok(e.snapshot().wormholes.some((h) => h.id === 'wormhole:0:0'));
  assert.equal(
    e.snapshot().bodies.some((b) => b.id === VEIL_SITE),
    false,
  );
  assert.equal(issue(e, { type: 'TRANSIT', targetId: 'wormhole:0:0' }, ship.id).ok, true);
  until(e, () => !ship.current, 200);
  assert.equal(
    issue(e, { type: 'SURVEY', targetId: VEIL_SITE, approach: 'close', deep: false }, ship.id).ok,
    true,
  );
  until(e, () => !ship.current, 100);
  run(e, 1);
  const event = e.state.events.find((v) => v.subjectId === VEIL_SITE)!;
  assert.ok(event);
  assert.equal(issue(e, { type: 'ASSIST_EVENT', targetId: event.id }, ship.id).ok, true);
  until(e, () => event.stage === 'resolved', 100);
  return e.state.ships.find((s) => s.id === 'veil')!;
}

export function trackingScenario(faction: 'orion' | 'romulan', cloaked = true, seed = 42) {
  const e = quietEngine(seed),
    veil = recoverVeil(e),
    home = e.state.locations.find((l) => l.id === faction + '-base')!;
  home.x = 1200;
  home.y = -1400;
  home.discovered = false;
  home.stock.photon = 0;
  const target = makeEnemy(
    'returning-' + faction,
    faction === 'orion' ? 'raider' : 'scout',
    faction,
    { x: 650, y: -1400 },
    home.id,
    'scout',
  );
  target.intent = 'retreat';
  target.nextDecision = 1e9;
  target.cloak = 'off';
  target.photon = 0;
  // Empty ammunition keeps the scout physically docked for the confirmation interval.
  target.cargo.materials = 8;
  target.loot = 8;
  e.state.enemies = [target];
  const ship = cloaked ? veil : e.state.ships.find((s) => s.id === 'horizon')!;
  ship.x = target.x - 80;
  ship.y = target.y;
  ship.standing.roe = 'HOLD FIRE';
  observe(e.state, target, 6);
  assert.equal(issue(e, { type: 'SHADOW', targetId: target.id }, ship.id).ok, true);
  return { e, ship, target, home };
}
