import { BUILD_COSTS, cost } from './definitions/progression';
import type { Cost, WorldState } from './types';
import type { SimulationEngine } from './engine';

export const manufactureCost = (kind: 'photon' | 'quantum', amount: number): Cost =>
  cost(amount * (kind === 'quantum' ? 8 : 2), amount * (kind === 'photon' ? 1 : 2));

export function productionCost(
  world: Pick<WorldState, 'productionDiscountUnlocked'>,
  original: Cost,
): Cost {
  const factor = world.productionDiscountUnlocked ? 0.5 : 1;
  return {
    ...original,
    credits: original.credits * factor,
    materials: original.materials * factor,
  };
}

export function unlockProductionDiscount(e: SimulationEngine) {
  if (e.state.productionDiscountUnlocked) return;
  e.state.productionDiscountUnlocked = true;
  e.record('productionDiscount', '取得特殊发现：船坞与军械库永久享受预算、材料五折', null);
}

export function productionQuotes(world: WorldState) {
  const quote = (original: Cost) => ({ original, actual: productionCost(world, original) });
  return {
    discounted: world.productionDiscountUnlocked,
    ships: Object.fromEntries(Object.entries(BUILD_COSTS).map(([id, price]) => [id, quote(price)])),
    ammunition: {
      photon: quote(manufactureCost('photon', 1)),
      quantum: quote(manufactureCost('quantum', 1)),
    },
  };
}
