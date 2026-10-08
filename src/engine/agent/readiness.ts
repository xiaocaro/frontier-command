/**
 * Deterministic readiness (MVP EVT-04, docs/lv3/CODEX_TASKS.md P3-04).
 *
 * The question this answers is Logistics' question before any departure: *can this ship do the trip
 * and still get home?* The card names three inputs — ammunition, hull, route — and forbids the
 * fourth: **there is no fuel system** (`02-mvp-traceability.md` CONFLICT-1), so the return margin is
 * expressed with what actually exists.
 *
 * **Where it attaches, and why it is not attached to the offer.** A task offer is free text; it
 * carries no structured target, so "assess the mission" has no decidable input. A *candidate* does:
 * every option on the menu names a real destination the engine already knows. So readiness is a
 * property of an option — "if I say yes to this, can I sustain it?" — and rides to the Agent on the
 * option's existing `requirements` field, where both the decision and the prompt can see it.
 *
 * **Not the model's job.** The card's API contract is that READY/WARNING must be reproducible. The
 * LLM may narrate the verdict; it never computes it.
 *
 * Pure module: no I/O, no clock, no randomness.
 */
import { capabilities } from '../capabilities';
import { routeEstimate } from '../navigation';
import type { Point, RouteKind, Ship, WorldState } from '../types';

export type ReadinessVerdict = 'READY' | 'WARNING';

export interface Readiness {
  verdict: ReadinessVerdict;
  /** Short, model-facing shortfalls. Empty when READY. */
  reasons: string[];
}

/** Below this share of the class's full hull, the ship should not be sent out. */
export const HULL_WARNING_FRACTION = 0.6;
/** A one-way estimate beyond this leaves no believable margin to come back on. */
export const RANGE_WARNING_MINUTES = 120;
/** Fewer rounds than this across both launchers is no answer at all if the trip turns hostile. */
export const AMMO_WARNING_ROUNDS = 2;

export function assessReadiness(
  w: WorldState,
  ship: Ship,
  destination: Point | null,
  route: RouteKind = 'safe',
): Readiness {
  const reasons: string[] = [];

  const fullHull = capabilities(ship).hull;
  if (fullHull > 0 && ship.hull < fullHull * HULL_WARNING_FRACTION)
    reasons.push('船体 ' + Math.round(ship.hull) + '/' + fullHull + '，不适合远航');

  const rounds = ship.photon + ship.quantum;
  if (rounds < AMMO_WARNING_ROUNDS) reasons.push('弹药 ' + rounds + ' 发，途中遇敌无法自保');

  if (destination) {
    const estimate = routeEstimate(w, ship, destination, route);
    if (estimate.eta > RANGE_WARNING_MINUTES)
      reasons.push('单程约 ' + estimate.eta + ' 分钟，返航余量不足');
  }

  return { verdict: reasons.length ? 'WARNING' : 'READY', reasons };
}
