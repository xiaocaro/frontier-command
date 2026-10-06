import type { CargoKind, Directive, Stock, WorldState } from './types';
import type { SimulationEngine } from './engine';
export function inventory(w: WorldState, id: string) {
  const location = w.locations.find((l) => l.id === id && l.owner === 'starfleet' && l.hull > 0);
  if (location) return location;
  const project = w.projects.find((p) => p.id === id);
  return project?.complete
    ? w.locations.find(
        (l) =>
          (project.refitLocationId
            ? l.id === project.refitLocationId
            : l.siteId === project.siteId) &&
          l.kind === project.kind &&
          l.owner === 'starfleet' &&
          l.hull > 0,
      )
    : project;
}
export const heldDirectives = (w: WorldState) =>
  w.ships.flatMap((s) => [s.current, ...s.suspended].filter((d): d is Directive => d !== null));
export function reservationHolder(w: WorldState, d: Directive) {
  const a = d.action;
  const id = 'sourceId' in a ? a.sourceId : 'targetId' in a ? a.targetId : '';
  const project = w.projects.find((p) => p.id === id);
  return project?.complete
    ? w.locations.find(
        (l) =>
          (project.refitLocationId
            ? l.id === project.refitLocationId
            : l.siteId === project.siteId) && l.kind === project.kind,
      )
    : (w.locations.find((l) => l.id === id) ?? project);
}
export function available(w: WorldState, id: string, key: CargoKind) {
  const holder = inventory(w, id);
  if (!holder) return 0;
  return Math.max(
    0,
    holder.stock[key] -
      heldDirectives(w)
        .filter((d) => reservationHolder(w, d)?.id === holder.id)
        .reduce((sum, d) => sum + d.reserved[key], 0),
  );
}
export function space(holder: { stock: Stock; capacity: Stock }, key: CargoKind) {
  return Math.max(0, holder.capacity[key] - holder.stock[key]);
}
export function deposit(holder: { stock: Stock; capacity: Stock }, key: CargoKind, amount: number) {
  const n = Math.max(0, Math.min(amount, space(holder, key)));
  holder.stock[key] += n;
  return n;
}
/** Destructive losses affect real goods, including goods promised to loading ships. */
export function loseStock(
  e: SimulationEngine,
  holder: { id: string; stock: Stock },
  key: CargoKind,
  amount: number,
) {
  const n = Math.min(holder.stock[key], Math.max(0, amount));
  holder.stock[key] -= n;
  const ds = heldDirectives(e.state).filter((d) => reservationHolder(e.state, d)?.id === holder.id);
  let excess = Math.max(0, ds.reduce((sum, d) => sum + d.reserved[key], 0) - holder.stock[key]);
  for (const d of [...ds].reverse()) {
    const lost = Math.min(excess, d.reserved[key]);
    d.reserved[key] -= lost;
    excess -= lost;
    if (lost > 0) {
      d.note = '预留货物损失，按剩余实物继续';
      e.report(d.note, holder.id, 'high');
    }
  }
  return n;
}
