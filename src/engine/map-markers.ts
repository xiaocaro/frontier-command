import type { WorldState } from './types';
import { GOODS } from './types';
export function markerRemovalReason(w: WorldState, id: string): string | null {
  const wreck = w.wrecks.find((x) => x.id === id && x.discovered);
  const body = w.bodies.find((x) => x.id === id && x.discovered && x.kind === 'derelict');
  if (!wreck && !body) return '仅可移除已发现的无价值残骸标记';
  const ids = new Set([id, ...(body ? ['wreck:' + body.id] : [])]);
  if (w.events.some((v) => ids.has(v.subjectId) && ['reported', 'responding'].includes(v.stage)))
    return '仍有待完成的现场事件';
  if (
    body &&
    (body.survey < 2 ||
      !w.events.some((v) => v.subjectId === id && v.kind === 'derelict' && v.stage === 'resolved'))
  )
    return '仍需调查或接管失落舰船';
  if (
    body &&
    (body.hidden ||
      (body.kind === 'derelict' &&
        w.events.some((v) => v.subjectId === id && v.kind === 'discovery'))) &&
    !body.specialClaimed
  )
    return '仍有未领取的研究奖励';
  if (w.wrecks.some((x) => ids.has(x.id) && GOODS.some((k) => x.stock[k] > 1e-8)))
    return '残骸仍有可打捞货物';
  if (
    w.ships.some((s) =>
      [s.current, ...s.queue, ...s.suspended].some(
        (d) => d?.action.type === 'RECOVER' && ids.has(d.action.targetId),
      ),
    )
  )
    return '仍有打捞指令，请先完成或取消';
  return null;
}
