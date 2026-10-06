import { worldSchema } from './save-schema';
import type { WorldState } from './types';
import { worldSchema as legacyV9Schema } from './legacy-v9/save-schema';
import { pairedSector, fixedPassage } from './wormhole-pairs';
export const CURRENT_SAVE_VERSION = 10;
export class UnsupportedSaveVersionError extends Error {}
export function migrateV9(input: unknown): WorldState {
  const old = legacyV9Schema.parse(input);
  const w: WorldState = {
    ...old,
    version: 10,
    renamedEntityIds: [
      ...new Set([
        ...old.history.filter((h) => h.kind === 'rename' && h.entityId).map((h) => h.entityId!),
        ...old.ships.filter((s) => s.id.startsWith('ship-')).map((s) => s.id),
        ...old.losses.filter((l) => l.shipId.startsWith('ship-')).map((l) => l.shipId),
        ...old.locations.filter((l) => l.id.startsWith('facility-')).map((l) => l.id),
        ...old.projects.map((p) => p.id),
        ...old.groups.map((g) => g.id),
      ]),
    ],
    productionDiscountUnlocked:
      [...old.ships, ...old.civilians].some((s) => s.cargo.specialFinds > 0) ||
      old.locations.some((l) => l.owner === 'starfleet' && l.stock.specialFinds > 0) ||
      old.bodies.some((b) => b.specialClaimed && ['anomaly', 'ruins'].includes(b.kind)) ||
      old.events.some((v) => v.kind === 'discovery' && v.stage === 'resolved'),
    locations: old.locations.map((l) => ({
      ...l,
      occupation:
        l.owner !== 'starfleet' && l.hull === 0 && ['base', 'outpost'].includes(l.kind)
          ? 'ruined'
          : null,
    })),
    projects: old.projects.map((p) => ({ ...p, refitLocationId: null })),
    jobs: old.jobs.map((j) => ({
      ...j,
      locationId: 'base',
      cancelled: !j.complete && old.locations.some((l) => l.id === 'base' && l.hull === 0),
    })),
    wormholes: old.wormholes.map((h) => {
      const origin = old.sectors.find((s) => s.id === h.sectorId)!;
      if (fixedPassage(origin)) return h;
      const exitSector = pairedSector(old.initialSeed, origin);
      return { ...h, exitSector, exit: { x: exitSector.q * 400 + 90, y: exitSector.r * 400 - 80 } };
    }),
  };
  return worldSchema.parse(w);
}
export function parseSave(input: unknown): WorldState {
  const version =
    input && typeof input === 'object' && 'version' in input ? input.version : undefined;
  if (version === 9) return migrateV9(input);
  if (version !== CURRENT_SAVE_VERSION)
    throw new UnsupportedSaveVersionError('Unsupported save version: ' + version);
  return worldSchema.parse(input);
}
