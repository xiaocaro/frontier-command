import { productionQuotes } from './production';
import type { SimulationEngine } from './engine';
import type { AgentObservation, Opportunity, Snapshot, Stock } from './types';
import { availableActions } from './agent/actions';
import { buildObservation } from './agent/observation';
import { visibleIntel } from './sensors';
import { frontierSectors, sectorId } from './world-generation';
import { available } from './command-system';
import { GOODS } from './types';
import { markerRemovalReason } from './map-markers';
import { mineAccidentResponse } from './world-events';
export function opportunities(e: SimulationEngine): Opportunity[] {
  const w = e.state,
    result: Opportunity[] = [];
  for (const s of frontierSectors(w.sectors))
    result.push({
      id: 'explore:' + sectorId(s),
      kind: 'exploration',
      targetId: sectorId(s),
      text: 'UNKNOWN SPACE ' + s.q + '/' + s.r + ' · 可测绘',
    });
  for (const b of w.bodies.filter((b) => b.discovered && b.kind === 'resource' && b.remaining > 0))
    result.push({
      id: 'mine:' + b.id,
      kind: 'mining',
      targetId: b.id,
      text: b.name + (b.survey < 2 ? ' · 需要近距调查' : ' · 可建设矿场'),
    });
  for (const l of w.locations.filter((l) => l.owner === 'starfleet' && l.hull > 0)) {
    if (l.kind === 'mine' && l.stock.materials >= 10)
      result.push({
        id: 'freight:' + l.id,
        kind: 'logistics',
        targetId: l.id,
        text: l.name + ' · ' + Math.floor(l.stock.materials) + ' Materials 等待运输',
      });
    if (l.distress && w.time - l.attackedAt <= 30)
      result.push({
        id: 'defend:' + l.id,
        kind: 'security',
        targetId: l.id,
        text: l.name + ' · 请求防卫',
      });
  }
  for (const c of visibleIntel(w).filter((c) => c.live && c.hostile))
    result.push({
      id: 'threat:' + c.id,
      kind: 'security',
      targetId: c.id,
      text: '已观测敌对接触 · ' + (c.name ?? c.id),
    });
  for (const p of w.projects.filter((p) => !p.complete))
    result.push({
      id: 'build:' + p.id,
      kind: 'construction',
      targetId: p.id,
      text: p.name + ' · 等待现场物资/施工',
    });
  return result;
}
export function snapshot(this: SimulationEngine): Snapshot {
  const w = this.state,
    bodies = w.bodies.filter((b) => b.discovered),
    ids = new Set(bodies.map((b) => b.id));
  const publicPoints = [
    ...w.ships,
    ...w.civilians,
    ...visibleIntel(w),
    ...w.locations.filter((l) => l.owner === 'starfleet' || l.discovered),
  ];
  const knownPoint = (p: { x: number; y: number }) =>
    publicPoints.some((x) => Math.hypot(x.x - p.x, x.y - p.y) < 20);
  return structuredClone({
    version: w.version,
    tick: w.tick,
    time: w.time,
    paused: w.paused,
    speed: w.speed,
    status: w.status,
    pauseReasons: w.pauseReasons,
    commander: w.commander,
    operators: w.operators,
    assignments: w.assignments,
    losses: w.losses,
    ships: w.ships,
    contacts: visibleIntel(w),
    siteContacts: w.siteIntel
      .filter((i) => !w.locations.find((l) => l.id === i.locationId)?.discovered)
      .map(({ id, x, y, progress, lastSeen }) => ({ id, x, y, progress, lastSeen })),
    sectors: w.sectors.filter((s) => s.discovered),
    systems: w.systems
      .filter((s) => s.discovered)
      .map((s) => ({ ...s, bodyIds: s.bodyIds.filter((id) => ids.has(id)) })),
    bodies: bodies.map((b) =>
      b.survey >= 2
        ? b
        : { ...b, remaining: 0, richness: 0, hazard: 0, specialClaimed: false, population: 0 },
    ),
    locations: w.locations
      .filter((l) => l.owner === 'starfleet' || l.discovered)
      .map((l) =>
        l.owner === 'starfleet'
          ? l
          : {
              ...l,
              stock: { materials: 0, photon: 0, quantum: 0, specialFinds: 0 },
              core: 0,
              lastAttackerId: null,
              production: 0,
              capacity: { materials: 0, photon: 0, quantum: 0, specialFinds: 0 },
              colony: null,
              extracted: 0,
              storageFull: false,
            },
      ),
    projects: w.projects,
    jobs: w.jobs,
    wrecks: w.wrecks.filter((x) => x.discovered),
    resources: w.resources,
    baseResources: {
      credits: w.resources.credits,
      stock: this.base.stock,
      available: Object.fromEntries(GOODS.map((k) => [k, available(w, 'base', k)])) as Stock,
      reserved: Object.fromEntries(
        GOODS.map((k) => [k, this.base.stock[k] - available(w, 'base', k)]),
      ) as Stock,
    },
    inventories: w.locations
      .filter((l) => l.owner === 'starfleet' && l.hull > 0)
      .map((l) => ({
        locationId: l.id,
        available: Object.fromEntries(GOODS.map((k) => [k, available(w, l.id, k)])) as Stock,
        reserved: Object.fromEntries(
          GOODS.map((k) => [k, l.stock[k] - available(w, l.id, k)]),
        ) as Stock,
      })),
    production: productionQuotes(w),
    renamedEntityIds: w.renamedEntityIds.filter((id) =>
      [
        ...w.ships,
        ...w.locations.filter((l) => l.owner === 'starfleet' || l.discovered),
        ...w.systems.filter((s) => s.discovered),
        ...bodies,
        ...w.projects,
        ...w.groups,
        ...w.losses.map((l) => ({ id: l.shipId })),
      ].some((e) => e.id === id),
    ),
    mapMarkers: {
      dismissedIds: w.dismissedMarkerIds.filter(
        (id) =>
          bodies.some((b) => b.id === id) || w.wrecks.some((x) => x.id === id && x.discovered),
      ),
      removableIds: [
        ...bodies.filter((b) => b.kind === 'derelict'),
        ...w.wrecks.filter((x) => x.discovered),
      ]
        .filter((x) => !markerRemovalReason(w, x.id))
        .map((x) => x.id)
        .sort(),
    },
    upgrades: w.upgrades,
    tension: w.tension,
    communications: w.communications,
    logs: w.logs,
    history: w.history,
    beams: w.beams.filter((b) => knownPoint(b.from) && knownPoint(b.to)),
    groups: w.groups,
    personnel: w.personnel,
    events: w.events
      .filter((v) =>
        [
          ...w.locations.filter((l) => l.owner === 'starfleet' || l.discovered),
          ...w.ships,
          ...w.civilians,
          ...w.bodies.filter((b) => b.discovered),
          ...w.wrecks.filter((x) => x.discovered),
          ...w.wormholes.filter((h) => h.discovered),
        ].some((x) => x.id === v.subjectId),
      )
      .map((v) => ({
        ...v,
        ...(v.kind === 'accident' ? { accidentResponse: mineAccidentResponse(this, v) } : {}),
        assetIds: v.assetIds.filter((id) => visibleIntel(w).some((i) => i.id === id)),
      })),
    wormholes: w.wormholes
      .filter((h) => h.discovered)
      .map(({ exit, exitSector, ...publicHole }) => publicHole),
    civilians: w.civilians,
    trade: w.trade,
    opportunities: opportunities(this),
    armory: {
      stock: { photon: this.base.stock.photon, quantum: this.base.stock.quantum },
      reserved: {
        photon: this.base.stock.photon - available(w, 'base', 'photon'),
        quantum: this.base.stock.quantum - available(w, 'base', 'quantum'),
      },
    },
  });
}
/**
 * The single observation channel, widened in place to the per-Agent view
 * (docs/lv3/03-implementation-plan.md §4.3).
 *
 * World-level cropping is already done by `snapshot()` and is not repeated here; this adds the
 * "what may *this* Agent know" layer and the affordances it may choose from. An operator with no
 * Agent (`kind: 'rules'`) has no Agent view to hand out, so it returns `null` — callers must treat
 * that as "no decision to make", never as an empty world.
 *
 * `availableActions` is derived from the live world state rather than the cropped snapshot; that is
 * safe because every candidate source is already limited to what is discovered or owned (see
 * `src/engine/agent/actions.ts`).
 */
export function getObservation(
  this: SimulationEngine,
  operatorId: string,
): AgentObservation | null {
  const w = this.state;
  const assignment = w.assignments.find((a) => a.operatorId === operatorId),
    ship = w.ships.find((s) => s.id === assignment?.shipId);
  if (!ship) return null;
  const operator = w.operators.find((o) => o.id === operatorId);
  if (!operator?.agentId) return null;
  const agent = w.agents.find((a) => a.id === operator.agentId);
  if (!agent) return null;
  const snap = this.snapshot();
  return structuredClone(
    buildObservation(agent, {
      time: snap.time,
      tick: snap.tick,
      operatorId,
      agentId: agent.id,
      ship,
      contacts: snap.contacts,
      systems: snap.systems,
      bodies: snap.bodies,
      opportunities: snap.opportunities,
      credits: w.resources.credits,
      tension: w.tension,
      messages: w.agentMessages,
      availableActions: availableActions(w, agent),
    }),
  );
}
