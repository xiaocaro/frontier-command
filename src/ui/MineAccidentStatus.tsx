import type { Snapshot } from '../engine/types';
import type { ComposerRequest } from './OrderComposer';
import { displayEntityName } from './localization';
import { LcarsButton } from './components/Lcars';

export function MineAccidentStatus({
  world,
  event,
  create,
}: {
  world: Snapshot;
  event: Snapshot['events'][number];
  create: (request: ComposerRequest) => void;
}) {
  const response = event.accidentResponse;
  if (!response) return null;
  const number = (n: number) => Math.round(n * 10) / 10;
  const supply = Math.max(0, Math.ceil(response.materialRequired - response.availableAtSite));
  return (
    <div aria-label="矿场事故响应状态">
      <p>
        修复前持续停工 · 现场工作 {Math.floor(Math.min(event.work, response.workRequired))}/
        {response.workRequired}
      </p>
      <p>
        修复需要 {response.materialRequired} 材料 · 矿场可用 {number(response.availableAtSite)}{' '}
        （已扣除运输预留）；优先使用矿场材料，不足由到场响应舰补足。
      </p>
      {!response.responders.length && <p>等待派舰响应；已完成的现场工作保留。</p>}
      {response.responders.map((responder) => {
        const ship = world.ships.find((s) => s.id === responder.shipId);
        return (
          <p key={responder.shipId}>
            响应舰：{ship ? displayEntityName(world, ship) : responder.shipId} ·{' '}
            {
              { travelling: '航行中', working: '现场施工', awaitingMaterials: '等待维修材料' }[
                responder.phase
              ]
            }{' '}
            · 货舱材料 {number(responder.cargoMaterials)} · 还缺 {number(responder.shortfall)} 材料
            {responder.phase === 'travelling' && '（舰上材料抵达后可用）'}
          </p>
        );
      })}
      <LcarsButton
        disabled={supply === 0}
        onClick={() =>
          create({
            action: {
              type: 'HAUL',
              sourceId: 'base',
              targetId: event.subjectId,
              cargoKind: 'materials',
              amount: supply,
              route: 'safe',
              repeat: false,
            },
          })
        }
      >
        运送维修材料到矿场
      </LcarsButton>
    </div>
  );
}
