import { worldSchema } from './save-schema';
import type { WorldState } from './types';
import { worldSchema as legacyV9Schema } from './legacy-v9/save-schema';
import { worldSchema as legacyV10Schema } from './legacy-v10/save-schema';
import { pairedSector, fixedPassage } from './wormhole-pairs';
export const CURRENT_SAVE_VERSION = 11;
export class UnsupportedSaveVersionError extends Error {}
/**
 * v9 -> v10. The v9 shape is upgraded exactly as before; the only Lv3 change is the tail, which now
 * hands the v10 result to `migrateV10` instead of validating it against the **live** schema.
 *
 * That tail is load-bearing (KNOWN_ISSUES C-14): once `worldSchema` is v11, validating a v10 object
 * against it would demand `agents`/`agentMessages`/`agentInteractions` and every v9 save would fail
 * to migrate.
 */
export function migrateV9(input: unknown): WorldState {
  const old = legacyV9Schema.parse(input);
  const w = {
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
  return migrateV10(w);
}
/**
 * v10 -> v11. Purely additive: the Agent collections start empty and every existing field is
 * carried over untouched, so a v10 save keeps behaving exactly as it did. The three `agents`-era
 * collections are **not** back-filled with a starting roster — a migrated world has no Agents until
 * a new world is created, which keeps the migration a data change rather than a gameplay change.
 */
export function migrateV10(input: unknown): WorldState {
  const old = legacyV10Schema.parse(input);
  return worldSchema.parse({
    ...old,
    version: 11,
    agents: [],
    agentMessages: [],
    agentInteractions: [],
  });
}
export function parseSave(input: unknown): WorldState {
  const version =
    input && typeof input === 'object' && 'version' in input ? input.version : undefined;
  if (version === 9) return migrateV9(input);
  if (version === 10) return migrateV10(input);
  if (version !== CURRENT_SAVE_VERSION)
    throw new UnsupportedSaveVersionError('Unsupported save version: ' + version);
  return worldSchema.parse(input);
}
