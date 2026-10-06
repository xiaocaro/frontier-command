import type { Ammunition, Snapshot } from '../engine/types';
import { capabilities } from '../engine/capabilities';

export function rearmPreview(
  world: Snapshot,
  shipIds: readonly string[],
  targetId: string,
  mode: 'REPLACE' | 'QUEUE' | 'INTERRUPT',
  load: Ammunition,
) {
  const ships = world.ships.filter((s) => shipIds.includes(s.id));
  const immediateCount = ships.filter(
    (s) => !(mode === 'QUEUE' && s.current?.source === 'admiral'),
  ).length;
  const destination = world.locations.find((l) => l.id === targetId);
  const stock = world.inventories.find((i) => i.locationId === targetId);
  const availability = {
    photon: stock?.available.photon ?? 0,
    quantum: stock?.available.quantum ?? 0,
  };
  if (mode === 'REPLACE')
    for (const s of ships)
      for (const d of [s.current, ...s.suspended]) {
        if (d && 'targetId' in d.action && d.action.targetId === targetId) {
          availability.photon += d.reserved.photon;
          availability.quantum += d.reserved.quantum;
        }
      }
  const maximum = { photon: 0, quantum: 0 };
  let error = !destination ? '请选择可用的装弹设施' : ships.length === 0 ? '请选择舰船' : '';
  for (const kind of ['photon', 'quantum'] as const) {
    maximum[kind] = ships.length
      ? Math.max(
          0,
          Math.min(
            immediateCount ? Math.floor(availability[kind] / immediateCount) : Infinity,
            ...ships.map((s) => capabilities(s)[kind] - s[kind]),
          ),
        )
      : 0;
    if (!Number.isInteger(load[kind]) || load[kind] < 0) error = '装弹数量必须是非负整数';
    else if (ships.some((s) => s[kind] + load[kind] > capabilities(s)[kind]))
      error = (kind === 'photon' ? '光子' : '量子') + '装载数量超出弹仓余量';
    else if (load[kind] * immediateCount > availability[kind])
      error = (kind === 'photon' ? '光子' : '量子') + '鱼雷可用库存不足';
  }
  if (!error && load.photon + load.quantum === 0) error = '请选择装弹数量；满仓舰船无需补充弹药';
  return { ships, destination, stock, availability, maximum, immediateCount, error };
}
