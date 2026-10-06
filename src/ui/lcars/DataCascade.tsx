import type { Snapshot } from '../../engine/types';
export function DataCascade({ world }: { world: Snapshot }) {
  const numbers = [
    world.tick,
    world.ships.length,
    world.projects.length,
    world.contacts.length,
    Math.floor(world.resources.credits),
    world.armory.stock.photon,
    world.armory.stock.quantum,
    world.operators.length,
    world.losses.length,
    world.communications.length,
    ...world.locations
      .slice(0, 6)
      .flatMap((l) => [Math.floor(l.stock.materials), Math.floor(l.hull)]),
  ];
  return (
    <div className="data-cascade-wrapper" aria-hidden="true">
      {[0, 1, 2, 3].map((column) => (
        <div className="data-column" key={column}>
          {[1, 1, 2, 3, 3, 4, 5, 6, 7].map((row, index) => (
            <div className={`dc-row-${row}`} key={index}>
              {String(numbers[(column * 9 + index) % numbers.length]).padStart(
                index % 3 === 0 ? 4 : 2,
                '0',
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
