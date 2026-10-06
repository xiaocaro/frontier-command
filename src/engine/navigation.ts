import type { Point, RouteKind, Ship, Snapshot, ReadonlyDeep, Directive } from './types';
import { capabilities } from './capabilities';
import { RULES } from './definitions/rules';
import { SECTOR_SIZE } from './definitions/locations';
export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const routeSpeedMultiplier = (upgrades: { readonly logistics: number }, route: RouteKind) =>
  route === 'risky' ? 1.5 : route === 'safe' && upgrades.logistics ? 1.25 : 1;
export function groupMovementFactor(
  w: { readonly ships: readonly ReadonlyDeep<Ship>[] },
  s: ReadonlyDeep<Ship>,
  d: ReadonlyDeep<Directive>,
) {
  const peers = d.groupOrderId
    ? w.ships.filter((p) => p.current?.groupOrderId === d.groupOrderId)
    : [];
  if (peers.length < 2) return 1;
  const speed = Math.min(...peers.map((p) => capabilities(p).warp));
  const destination = s.path.at(-1) ?? peers.find((p) => p.path.length)?.path.at(-1);
  const lead = destination
    ? Math.max(...peers.map((p) => dist(p, destination))) - dist(s, destination)
    : 0;
  return (speed / capabilities(s).warp) * (lead > Math.max(60, d.groupSpacing * 3) ? 0.2 : 1);
}
export function currentMovementSpeed(
  w: Pick<Snapshot, 'ships' | 'upgrades'>,
  s: ReadonlyDeep<Ship>,
) {
  const route = s.current?.note.match(/^航行 \/ (safe|direct|risky)/)?.[1] as RouteKind | undefined;
  return (
    capabilities(s).warp *
    routeSpeedMultiplier(w.upgrades, route ?? 'direct') *
    (s.current ? groupMovementFactor(w, s, s.current) : 1)
  );
}
export function segmentDistance(p: Point, a: Point, b: Point) {
  const l = (b.x - a.x) ** 2 + (b.y - a.y) ** 2,
    t = l
      ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l))
      : 0;
  return dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}
export function move(s: Ship, p: Point, dt: number, factor = 1) {
  const d = dist(s, p),
    step = capabilities(s).warp * dt * factor;
  s.heading = Math.atan2(p.y - s.y, p.x - s.x);
  if (d <= step) {
    s.x = p.x;
    s.y = p.y;
    return true;
  }
  s.x += Math.cos(s.heading) * step;
  s.y += Math.sin(s.heading) * step;
  return false;
}
type Chart = Pick<Snapshot, 'locations' | 'bodies' | 'upgrades' | 'sectors'> & {
  intel?: Snapshot['contacts'];
  contacts?: Snapshot['contacts'];
  time: number;
};
/** Clip each segment against the union of charted sectors; no hidden geography is consulted. */
function unchartedDistance(w: Chart, start: Point, path: Point[]) {
  let at = start,
    unknown = 0;
  for (const end of path) {
    const intervals: [number, number][] = [];
    for (const sector of w.sectors.filter((s) => s.discovered)) {
      let enter = 0,
        exit = 1;
      for (const axis of ['x', 'y'] as const) {
        const center = (axis === 'x' ? sector.q : sector.r) * SECTOR_SIZE;
        const low = center - SECTOR_SIZE / 2,
          high = center + SECTOR_SIZE / 2;
        const delta = end[axis] - at[axis];
        if (delta === 0) {
          if (at[axis] < low || at[axis] > high) exit = -1;
        } else {
          const a = (low - at[axis]) / delta,
            b = (high - at[axis]) / delta;
          enter = Math.max(enter, Math.min(a, b));
          exit = Math.min(exit, Math.max(a, b));
        }
      }
      if (exit > enter) intervals.push([enter, exit]);
    }
    intervals.sort((a, b) => a[0] - b[0]);
    let covered = 0,
      edge = 0;
    for (const [enter, exit] of intervals) {
      covered += Math.max(0, exit - Math.max(edge, enter));
      edge = Math.max(edge, exit);
    }
    unknown += dist(at, end) * Math.max(0, 1 - covered);
    at = end;
  }
  return unknown;
}
export function knownRouteHazards(w: Chart) {
  return [
    ...w.bodies.filter((b) => b.discovered && b.kind === 'anomaly'),
    ...(w.intel ?? w.contacts ?? []).filter(
      (i) => i.hostile && !i.resolved && w.time - i.lastSeen <= RULES.intelTTL,
    ),
  ].sort((a, b) => a.id.localeCompare(b.id));
}
export function safeRouteBlocked(w: Chart, start: Point, path: Point[]) {
  let at = start;
  const hazards = knownRouteHazards(w).filter(
    (h) => dist(h, start) > 85 && dist(h, path.at(-1) ?? start) > 85,
  );
  for (const p of path) {
    if (hazards.some((h) => segmentDistance(h, at, p) < 85 - 1e-8)) return true;
    at = p;
  }
  return false;
}
export function planRoute(w: Chart, start: Point, end: Point, route: RouteKind): Point[] {
  if (route === 'direct') return [{ x: end.x, y: end.y }];
  if (route === 'risky')
    return [
      { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 65 },
      { x: end.x, y: end.y },
    ];
  const hazards = knownRouteHazards(w).filter(
    (h) => dist(h, start) > 85 && dist(h, end) > 85 && segmentDistance(h, start, end) < 240,
  );
  if (!hazards.some((h) => segmentDistance(h, start, end) < 85)) return [{ x: end.x, y: end.y }];
  // Visibility graph: only known hazards, deterministic vertices and tie-breaking.
  const nodes: Point[] = [
    { x: start.x, y: start.y },
    { x: end.x, y: end.y },
  ];
  for (const h of hazards.slice(0, 24))
    for (let i = 0; i < 8; i++) {
      const p = {
        x: h.x + Math.cos((i * Math.PI) / 4) * 112,
        y: h.y + Math.sin((i * Math.PI) / 4) * 112,
      };
      if (!hazards.some((other) => dist(other, p) < 85)) nodes.push(p);
    }
  const lengths = nodes.map(() => Infinity),
    previous = nodes.map(() => -1),
    visited = new Set<number>();
  lengths[0] = 0;
  for (let step = 0; step < nodes.length; step++) {
    let at = -1;
    for (let i = 0; i < nodes.length; i++)
      if (!visited.has(i) && (at < 0 || lengths[i] < lengths[at])) at = i;
    if (at < 0 || !Number.isFinite(lengths[at])) break;
    if (at === 1) {
      const path: Point[] = [];
      for (let i = 1; i !== 0; i = previous[i]) path.unshift(nodes[i]);
      return path;
    }
    visited.add(at);
    for (let i = 1; i < nodes.length; i++) {
      if (
        visited.has(i) ||
        hazards.some((h) => segmentDistance(h, nodes[at], nodes[i]) < 85 - 1e-8)
      )
        continue;
      const candidate = lengths[at] + dist(nodes[at], nodes[i]);
      if (candidate < lengths[i] - 1e-8) {
        lengths[i] = candidate;
        previous[i] = at;
      }
    }
  }
  return [{ x: end.x, y: end.y }];
}
export function routeEstimate(w: Chart, s: ReadonlyDeep<Ship>, end: Point, route: RouteKind) {
  const path = planRoute(w, s, end, route);
  let at: Point = s,
    length = 0;
  for (const p of path) {
    length += dist(at, p);
    at = p;
  }
  const factor = routeSpeedMultiplier(w.upgrades, route);
  const contacts = (w.intel ?? w.contacts ?? []).filter(
    (i) => i.live && i.hostile && segmentDistance(i, s, end) < 200,
  ).length;
  return {
    path,
    distance: length,
    unknownDistance: unchartedDistance(w, s, path),
    eta: Math.ceil(length / (capabilities(s).warp * factor) + 4),
    risk:
      route === 'safe'
        ? safeRouteBlocked(w, s, path)
          ? 'ELEVATED / 无安全通路，需护航或改线'
          : path.length > 1
            ? 'LOW / 绕开已知危险'
            : 'LOW / 直接通路'
        : route === 'risky'
          ? 'HIGH / turbulent, exposed corridor'
          : contacts
            ? 'ELEVATED / observed threat'
            : 'UNVERIFIED / direct space',
  };
}
