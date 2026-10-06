import type { Enemy, Point, Ship } from './types';
import type { SimulationEngine } from './engine';
import { capabilities } from './capabilities';
import { dist, move, segmentDistance } from './navigation';
import { coordinateRandom } from './world-generation';

export const TRACKING_RULES = Object.freeze({
  cloakSignature: 0.08,
  romulanCounterSensors: 1.5,
  romulanExposure: 1.6,
  detectionThreshold: 25,
  quietMinutes: 15,
  confirmMinutes: 10,
  standOff: 0.55,
  observationMinutes: 1,
  evidenceDecay: 2,
  evidenceTTL: 30,
  movementThreshold: 0.2,
  stableBearingCosine: 0.9,
  matchingHeadingCosine: 0.7,
  behindCosine: -0.1,
  exposureBase: 6,
  exposureProximity: 12,
  recognitionChance: 0.45,
  ordinaryCloakSignature: 0.4,
  veilCounterSignature: 0.8,
  activeSignature: 0.6,
  activeScanRange: 1.15,
  veilDetectionChance: 0.9,
  activeDetectionChance: 0.6,
  passiveDetectionChance: 0.2,
  siteSensorFraction: 0.85,
  decoyClearance: 220,
  decoyAttempts: 32,
  decoyLegs: 2,
  decoyMinimum: 240,
  decoyVariation: 120,
  decoySpread: 1.8,
  decoyFallback: 300,
});
/** Physical visibility is shared by threat intelligence, combat acquisition and counter-tracking. */
export function canDetectShip(observer: Ship, target: Ship, time: number) {
  let range = capabilities(observer).sensors;
  if (target.cloak === 'on') {
    range *=
      target.classId === 'veil'
        ? TRACKING_RULES.cloakSignature
        : observer.classId === 'veil'
          ? TRACKING_RULES.veilCounterSignature
          : TRACKING_RULES.ordinaryCloakSignature;
    if (observer.factionId === 'romulan') range *= TRACKING_RULES.romulanCounterSensors;
    if (target.scanUntil > time)
      range = Math.max(range, capabilities(observer).sensors * TRACKING_RULES.activeSignature);
  }
  if (observer.scanUntil > time) range *= TRACKING_RULES.activeScanRange;
  return dist(observer, target) <= range;
}

function evasiveRoute(e: SimulationEngine, s: Enemy) {
  const home = e.state.locations.find((l) => l.id === s.homeId);
  const c = s.counterTracking;
  const salt = [...s.id].reduce((n, ch) => Math.imul(n, 31) + ch.charCodeAt(0), c.serial++);
  const random = coordinateRandom(
    e.state.initialSeed,
    { q: Math.floor(s.x / 400), r: Math.floor(s.y / 400) },
    salt,
  );
  const away = home ? Math.atan2(s.y - home.y, s.x - home.x) : s.heading + Math.PI / 2;
  const route: Point[] = [];
  let at: Point = s;
  for (let leg = 0; leg < TRACKING_RULES.decoyLegs; leg++) {
    let point: Point | undefined;
    for (let attempt = 0; attempt < TRACKING_RULES.decoyAttempts; attempt++) {
      const heading = away + (random() - 0.5) * TRACKING_RULES.decoySpread,
        length = TRACKING_RULES.decoyMinimum + random() * TRACKING_RULES.decoyVariation;
      const candidate = {
        x: at.x + Math.cos(heading) * length,
        y: at.y + Math.sin(heading) * length,
      };
      if (
        !home ||
        segmentDistance(home, at, candidate) >=
          Math.min(TRACKING_RULES.decoyClearance, dist(at, home)) - 1e-8
      ) {
        point = candidate;
        break;
      }
    }
    point ??= {
      x: at.x + Math.cos(away) * TRACKING_RULES.decoyFallback,
      y: at.y + Math.sin(away) * TRACKING_RULES.decoyFallback,
    };
    route.push(point);
    at = point;
  }
  c.waypoints = route;
}

export function updateCounterTracking(e: SimulationEngine, s: Enemy) {
  const w = e.state,
    c = s.counterTracking;
  if (w.time - c.checkedAt < TRACKING_RULES.observationMinutes - 1e-8) return;
  c.checkedAt = w.time;
  const enemyMoved = dist(s, c.position) > TRACKING_RULES.movementThreshold;
  c.position = { x: s.x, y: s.y };
  for (const watcher of Object.values(c.watchers))
    watcher.exposure = Math.max(0, watcher.exposure - TRACKING_RULES.evidenceDecay);
  for (const ship of [...w.ships, ...w.civilians].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!canDetectShip(s, ship, w.time)) continue;
    const bearing = Math.atan2(ship.y - s.y, ship.x - s.x),
      previous = c.watchers[ship.id];
    if (c.evading && previous?.identified) c.lastSeen = w.time;
    const followerMoved =
      previous && dist(ship, previous.position) > TRACKING_RULES.movementThreshold;
    const stableBearing =
      previous && Math.cos(bearing - previous.bearing) > TRACKING_RULES.stableBearingCosine;
    const followsHeading =
      previous &&
      Math.cos(Math.atan2(ship.y - previous.position.y, ship.x - previous.position.x) - s.heading) >
        TRACKING_RULES.matchingHeadingCosine;
    const behind = Math.cos(bearing - s.heading) < TRACKING_RULES.behindCosine;
    c.watchers[ship.id] = {
      exposure: previous?.exposure ?? 0,
      identified: previous?.identified ?? false,
      lastSeen: w.time,
      position: { x: ship.x, y: ship.y },
      bearing,
    };
    if (!enemyMoved || !followerMoved || !followsHeading || (!behind && !stableBearing)) continue;
    const signature = ship.cloak === 'on' ? TRACKING_RULES.cloakSignature : 1;
    const closeness = Math.max(0, 1 - dist(ship, s) / capabilities(s).sensors);
    const increase =
      (TRACKING_RULES.exposureBase + TRACKING_RULES.exposureProximity * closeness) *
      signature *
      (s.factionId === 'romulan' ? TRACKING_RULES.romulanExposure : 1);
    const observation = {
      exposure: Math.min(100, (previous?.exposure ?? 0) + increase),
      identified: previous?.identified ?? false,
      lastSeen: w.time,
      position: { x: ship.x, y: ship.y },
      bearing,
    };
    c.watchers[ship.id] = observation;
    c.lastSeen = w.time;
    if (
      !c.evading &&
      observation.exposure > TRACKING_RULES.detectionThreshold &&
      e.random() <
        ((observation.exposure - TRACKING_RULES.detectionThreshold) /
          (100 - TRACKING_RULES.detectionThreshold)) *
          TRACKING_RULES.recognitionChance
    ) {
      observation.identified = true;
      c.evading = true;
      evasiveRoute(e, s);
    }
  }
  for (const [id, watcher] of Object.entries(c.watchers))
    if (w.time - watcher.lastSeen > TRACKING_RULES.evidenceTTL) delete c.watchers[id];
  if (c.evading && w.time - c.lastSeen >= TRACKING_RULES.quietMinutes) {
    c.evading = false;
    c.waypoints = [];
    s.nextDecision = w.time;
  }
}

/** This takes priority over every private return/dock branch, including Scout intelligence return. */
export function advanceEvasion(e: SimulationEngine, s: Enemy, dt: number) {
  updateCounterTracking(e, s);
  if (!s.counterTracking.evading) return false;
  if (!s.counterTracking.waypoints.length) evasiveRoute(e, s);
  const point = s.counterTracking.waypoints[0];
  if (move(s, point, dt)) s.counterTracking.waypoints.shift();
  return true;
}

export function updateSiteIntel(e: SimulationEngine) {
  const w = e.state;
  for (const l of w.locations
    .filter((l) => l.owner !== 'starfleet' && !l.discovered && l.hull > 0)
    .sort((a, b) => a.id.localeCompare(b.id))) {
    const source = w.ships.find(
      (s) => dist(s, l) <= capabilities(s).sensors * TRACKING_RULES.siteSensorFraction,
    );
    if (!source) continue;
    let intel = w.siteIntel.find((i) => i.locationId === l.id);
    if (!intel) {
      intel = {
        id: 'site-intel-' + w.nextId++,
        locationId: l.id,
        x: l.x,
        y: l.y,
        progress: 0,
        lastSeen: w.time,
      };
      w.siteIntel.push(intel);
      e.report('探测到未确认设施信号，需要持续现场侦察', intel.id, 'normal', 'report');
    }
    const elapsed = w.time - intel.lastSeen;
    intel.progress =
      elapsed > TRACKING_RULES.observationMinutes + 1e-8
        ? 0
        : Math.min(TRACKING_RULES.confirmMinutes, intel.progress + elapsed);
    intel.lastSeen = w.time;
    if (intel.progress >= TRACKING_RULES.confirmMinutes - 1e-8) {
      intel.progress = TRACKING_RULES.confirmMinutes;
      l.discovered = true;
      e.record('discovery', '持续侦察确认 ' + l.name, l.id);
      e.report('已确认 ' + l.name + '，可下达打击指令', l.id, 'high', 'report');
    }
  }
}
