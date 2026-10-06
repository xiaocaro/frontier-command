import { SimulationEngine } from '../src/engine/engine';
import { createWorld } from '../src/engine/data';
import type { Action } from '../src/engine/types';
export function quietEngine(seed = 236807) {
  const e = new SimulationEngine(createWorld(seed));
  e.state.enemies = [];
  return e;
}
export function issue(
  e: SimulationEngine,
  action: Action,
  shipId = 'verity',
  mode: 'REPLACE' | 'QUEUE' | 'INTERRUPT' = 'REPLACE',
) {
  return e.dispatchCommand({ type: 'issueDirective', shipIds: [shipId], mode, action });
}
export function run(e: SimulationEngine, minutes: number) {
  for (let i = 0; i < Math.round(minutes * 10); i++) {
    if (e.state.status === 'commandLost') break;
    e.dispatchCommand({ type: 'pause', paused: false });
    e.step();
  }
}
export function until(e: SimulationEngine, predicate: () => boolean, maxMinutes = 600) {
  for (let i = 0; i < maxMinutes * 10 && !predicate(); i++) {
    if (e.state.status === 'commandLost') break;
    e.dispatchCommand({ type: 'pause', paused: false });
    e.step();
  }
  if (!predicate()) throw Error('Simulation predicate timed out at ' + e.state.time);
}
