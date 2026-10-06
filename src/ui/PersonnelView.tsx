import { useState } from 'react';
import { CAREERS, type Career, type Snapshot } from '../engine/types';
import { CAREER_LABELS } from '../engine/definitions/frontier';
import type { CommandSender } from './types';
import { LcarsTextBar, LcarsField, LcarsButton } from './components/Lcars';
const labels = {
  candidate: '候选人',
  training: '培养中',
  available: '可任职',
  assigned: '已任职',
  rejected: '已拒绝',
  missing: '失联',
};
export function PersonnelView({ world, command }: { world: Snapshot; command: CommandSender }) {
  const [careers, setCareers] = useState<Record<string, Career>>({}),
    [targets, setTargets] = useState<Record<string, string>>({});
  return (
    <>
      <LcarsTextBar>人员与 Cadet 培养</LcarsTextBar>
      <p>Commander 推荐候选人；录取培养需要 90 Credits 与 90 游戏分钟。任职需要与目标实际会合。</p>
      {world.personnel.map((p) => (
        <div className="record-row" data-entity-id={p.id} key={p.id}>
          <b>
            {p.name} · {labels[p.status]}
          </b>
          <p>
            {CAREER_LABELS[p.career]} · 经验 {Math.floor(p.experience)} · 所在{' '}
            {world.locations.find((l) => l.id === p.locationId)?.name ??
              world.ships.find((s) => s.id === p.locationId)?.name ??
              p.locationId}
          </p>
          {p.status === 'candidate' && (
            <>
              <LcarsField>
                培养方向
                <select
                  aria-label={'培养方向 ' + p.id}
                  value={careers[p.id] ?? p.career}
                  onChange={(e) => setCareers((a) => ({ ...a, [p.id]: e.target.value as Career }))}
                >
                  {CAREERS.map((k) => (
                    <option key={k} value={k}>
                      {CAREER_LABELS[k]}
                    </option>
                  ))}
                </select>
              </LcarsField>
              <div className="inline-actions">
                <LcarsButton
                  onClick={() =>
                    command({
                      type: 'candidate',
                      personnelId: p.id,
                      accept: true,
                      career: careers[p.id] ?? p.career,
                    })
                  }
                >
                  接受并培养
                </LcarsButton>
                <LcarsButton
                  tone="secondary"
                  onClick={() =>
                    command({
                      type: 'candidate',
                      personnelId: p.id,
                      accept: false,
                      career: p.career,
                    })
                  }
                >
                  拒绝候选
                </LcarsButton>
              </div>
            </>
          )}
          {p.status === 'training' && (
            <progress aria-label="培养进度" value={p.training} max={90} />
          )}
          {['available', 'assigned'].includes(p.status) && (
            <>
              <LcarsField>
                任职目标
                <select
                  aria-label={'任职目标 ' + p.id}
                  value={
                    targets[p.id] ??
                    p.posting?.id ??
                    world.locations.find((l) => l.colony)?.id ??
                    ''
                  }
                  onChange={(e) => setTargets((a) => ({ ...a, [p.id]: e.target.value }))}
                >
                  {[...world.locations.filter((l) => l.colony && l.hull > 0), ...world.ships].map(
                    (x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ),
                  )}
                </select>
              </LcarsField>
              <LcarsButton
                onClick={() => {
                  const id =
                    targets[p.id] ??
                    p.posting?.id ??
                    world.locations.find((l) => l.colony)?.id ??
                    '';
                  return command({
                    type: 'assignPersonnel',
                    personnelId: p.id,
                    targetId: id,
                    targetType: world.ships.some((s) => s.id === id) ? 'ship' : 'colony',
                  });
                }}
              >
                任命人员
              </LcarsButton>
            </>
          )}
        </div>
      ))}
    </>
  );
}
