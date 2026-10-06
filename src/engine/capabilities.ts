import { SHIP_CLASSES, MODULE_SLOTS } from './definitions/ships';
import type { Ship, ReadonlyDeep } from './types';
export function capabilities(s: ReadonlyDeep<Ship>) {
  const d = SHIP_CLASSES[s.classId];
  return {
    ...d,
    moduleSlots: MODULE_SLOTS[s.classId],
    cargo: d.cargo + (s.modules.includes('expandedCargo') ? 50 : 0),
    shield: d.shield * (s.modules.includes('reinforcedShields') ? 1.6 : 1),
    sensors: d.sensors * (s.modules.includes('longRangeSensors') ? 2 : 1),
    mining: Math.max(0.35, d.science / 45),
    hazardFactor: s.modules.includes('reinforcedShields') ? 0.4 : 1,
    warp: d.warp * Math.max(0.15, s.engines / 100),
  };
}
export const cargoUsed = (s: ReadonlyDeep<Ship>) =>
  Object.values(s.cargo).reduce((a, b) => a + b, 0) + s.passengers / 5;
