import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const require = createRequire(import.meta.url);
const { SimulationEngine } = require('../dist-electron/src/engine/engine.js');
const { createWorld } = require('../dist-electron/src/engine/data.js');
const { parseSave } = require('../dist-electron/src/engine/saves.js');
const output = resolve('tests/fixtures/v9');
mkdirSync(output, { recursive: true });
const save = (name, engine) =>
  writeFileSync(
    join(output, name + '.json'),
    JSON.stringify(parseSave(engine.state), null, 2) + '\n',
  );
const command = (engine, input) => {
  const result = engine.dispatchCommand(input);
  if (!result.ok) throw Error(result.reason);
};
const issue = (engine, shipId, action, mode = 'REPLACE') =>
  command(engine, { type: 'issueDirective', shipIds: [shipId], mode, action });
const advance = (engine, minutes) => {
  for (let i = 0; i < minutes * 10; i++) {
    if (engine.state.paused) command(engine, { type: 'pause', paused: false });
    engine.step();
  }
};
const initial = new SimulationEngine(createWorld());
save('initial', initial);
issue(initial, 'verity', { type: 'EXPLORE', sector: { q: 0, r: -1 }, approach: 'close' });
issue(initial, 'meridian', {
  type: 'HAUL',
  sourceId: 'mine',
  targetId: 'base',
  cargoKind: 'materials',
  amount: 600,
  route: 'direct',
  repeat: false,
});
issue(initial, 'horizon', { type: 'PATROL', targetId: 'mine', duration: 400 });
issue(initial, 'vigil', { type: 'MOVE', point: { x: 300, y: 0 } });
issue(initial, 'vigil', { type: 'DOCK', targetId: 'base' }, 'QUEUE');
issue(initial, 'vigil', { type: 'MOVE', point: { x: -180, y: 45 } }, 'INTERRUPT');
advance(initial, 100);
save('in-progress', initial);
const continued = new SimulationEngine(parseSave(structuredClone(initial.state)));
issue(
  continued,
  'vigil',
  {
    type: 'REFIT',
    targetId: 'base',
    moduleId: 'expandedCargo',
    remove: false,
  },
  'INTERRUPT',
);
advance(continued, 300);
continued.state.paused = true;
save('continued', continued);
const terminal = new SimulationEngine(continued.state);
terminal.hit(terminal.base, 10000);
terminal.finishCritical();
save('command-lost', terminal);
console.log('Generated four validated v9 fixtures in ' + output);
