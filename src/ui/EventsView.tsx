import { useContext } from 'react';
import {
  ChineseDisplay,
  chineseText,
  displayName,
  displayEntityName,
  worldText,
} from './localization';
import { useState } from 'react';
import type { Snapshot } from '../engine/types';
import { EVENT_LABELS } from '../engine/world-events';
import type { CommandSender } from './types';
import type { ComposerRequest } from './OrderComposer';
import { LcarsTextBar, LcarsButton, LcarsField } from './components/Lcars';
import { MineAccidentStatus } from './MineAccidentStatus';
export function EventsView({
  world,
  command,
  create,
  eventId,
}: {
  world: Snapshot;
  command: CommandSender;
  create: (r: ComposerRequest) => void;
  eventId?: string;
}) {
  const chinese = useContext(ChineseDisplay);
  const [colony, setColony] = useState(world.locations.find((l) => l.colony)?.id ?? '');
  const events = world.events.filter((v) =>
    eventId ? v.id === eventId : ['reported', 'responding'].includes(v.stage),
  );
  return (
    <>
      <LcarsTextBar>持续世界事件</LcarsTextBar>
      {!events.length && <p>暂无待处置事件。</p>}
      {events.map((v) => (
        <div className="record-row" data-entity-id={v.id} key={v.id}>
          <b>
            {chinese ? chineseText(EVENT_LABELS[v.kind]) : EVENT_LABELS[v.kind]} ·{' '}
            {
              {
                reported: '待处置',
                responding: '行动中',
                resolved: '已解决',
                failed: '后果已发生',
              }[v.stage]
            }
          </b>
          <p>{chinese ? worldText(world, v.evidence) : v.evidence}</p>
          {v.kind === 'accident' ? (
            v.accidentResponse ? (
              <MineAccidentStatus world={world} event={v} create={create} />
            ) : (
              <p>现场工作 {Math.floor(Math.min(v.work, 20))}/20</p>
            )
          ) : (
            <p>
              响应期限 {Math.max(0, Math.ceil(v.deadline - world.time))} 分钟 · 现场工作{' '}
              {Math.floor(v.work)}/20
            </p>
          )}
          {v.outcome && <p>{chinese ? worldText(world, v.outcome) : v.outcome}</p>}
          {['reported', 'responding'].includes(v.stage) && (
            <>
              <div className="inline-actions">
                {!['invasion', 'diplomatic'].includes(v.kind) && (
                  <LcarsButton
                    onClick={() => create({ action: { type: 'ASSIST_EVENT', targetId: v.id } })}
                  >
                    派舰现场响应
                  </LcarsButton>
                )}
                {['invasion', 'diplomatic'].includes(v.kind) && (
                  <span>通过实际防卫、呼叫 或撤离改变局势；确认通信不会结束事件。</span>
                )}
                {v.kind === 'wormhole' && (
                  <LcarsButton
                    onClick={() =>
                      command({ type: 'respondEvent', eventId: v.id, choice: 'stabilize' })
                    }
                  >
                    稳定通道 / 响应舰 5 材料
                  </LcarsButton>
                )}
                {v.kind === 'plague' && (
                  <>
                    <LcarsButton
                      onClick={() =>
                        command({ type: 'respondEvent', eventId: v.id, choice: 'quarantine' })
                      }
                    >
                      隔离殖民地
                    </LcarsButton>
                    <LcarsButton
                      onClick={() =>
                        command({ type: 'respondEvent', eventId: v.id, choice: 'liftQuarantine' })
                      }
                    >
                      解除隔离
                    </LcarsButton>
                  </>
                )}
                {['invasion', 'diplomatic'].includes(v.kind) && (
                  <LcarsButton
                    onClick={() =>
                      command({ type: 'respondEvent', eventId: v.id, choice: 'withdraw' })
                    }
                  >
                    接受撤离要求
                  </LcarsButton>
                )}
              </div>
              {v.kind === 'refugees' && (
                <>
                  <LcarsField>
                    安置殖民地
                    <select value={colony} onChange={(e) => setColony(e.target.value)}>
                      {world.locations
                        .filter((l) => l.colony && l.hull > 0)
                        .map((l) => (
                          <option key={l.id} value={l.id}>
                            {chinese ? displayEntityName(world, l) : l.name}
                          </option>
                        ))}
                    </select>
                  </LcarsField>
                  <LcarsButton
                    onClick={() =>
                      command({
                        type: 'respondEvent',
                        eventId: v.id,
                        choice: 'accept',
                        targetId: colony,
                      })
                    }
                  >
                    接受安置申请
                  </LcarsButton>
                  <LcarsButton
                    tone="secondary"
                    onClick={() =>
                      command({ type: 'respondEvent', eventId: v.id, choice: 'reject' })
                    }
                  >
                    拒绝申请
                  </LcarsButton>
                </>
              )}
            </>
          )}
        </div>
      ))}
    </>
  );
}
