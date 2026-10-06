import { useState } from 'react';
import type { Snapshot, Action } from '../engine/types';
import type { CommandSender } from './types';
import type { Selection } from '../StrategicMap';
import type { ComposerRequest } from './OrderComposer';
import { defaultAction } from './OrderComposer';
import { LcarsField, LcarsTextBar, LcarsButton } from './components/Lcars';
import { ACTION_LABELS } from './format';
export function FleetManager({
  world,
  command,
  select,
  create,
}: {
  world: Snapshot;
  command: CommandSender;
  select: (s: Selection) => void;
  create: (r: ComposerRequest) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null),
    [name, setName] = useState('第一运输编队'),
    [ids, setIds] = useState<string[]>(
      world.ships.filter((s) => s.classId === 'antares').map((s) => s.id),
    ),
    [flag, setFlag] = useState(world.ships[0]?.id ?? ''),
    [spacing, setSpacing] = useState(30),
    [action, setAction] = useState<Action['type']>('HAUL');
  return (
    <>
      <LcarsTextBar>舰队与编队</LcarsTextBar>
      {world.groups.map((g) => (
        <div className="record-row" data-entity-id={g.id} key={g.id}>
          <b>
            {g.name} · {g.shipIds.length} 艘
          </b>
          <p>
            旗舰 {world.ships.find((s) => s.id === g.flagshipId)?.name} · 间距 {g.spacing}
          </p>
          <div className="inline-actions">
            <LcarsButton onClick={() => select({ type: 'group', id: g.id })}>
              在星图选择
            </LcarsButton>
            <LcarsButton
              onClick={() => create({ groupId: g.id, action: defaultAction(action, world) })}
            >
              下达 {ACTION_LABELS[action]}
            </LcarsButton>
            <LcarsButton
              onClick={() => {
                setEditing(g.id);
                setName(g.name);
                setIds([...g.shipIds]);
                setFlag(g.flagshipId);
                setSpacing(g.spacing);
              }}
            >
              编辑编队
            </LcarsButton>
            <LcarsButton
              tone="danger"
              onClick={() => command({ type: 'deleteGroup', groupId: g.id })}
            >
              删除编队
            </LcarsButton>
          </div>
        </div>
      ))}
      <LcarsField>
        编队行动
        <select
          aria-label="编队行动"
          value={action}
          onChange={(e) => setAction(e.target.value as Action['type'])}
        >
          {(['MOVE', 'HAUL', 'PATROL', 'ESCORT', 'INTERCEPT', 'RETREAT', 'RETURN'] as const).map(
            (k) => (
              <option value={k} key={k}>
                {ACTION_LABELS[k]}
              </option>
            ),
          )}
        </select>
      </LcarsField>
      <LcarsTextBar>{editing ? '编辑编队' : '创建编队'}</LcarsTextBar>
      <LcarsField>
        编队名称
        <input
          aria-label="编队名称"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </LcarsField>
      <div className="asset-list">
        {world.ships.map((s) => (
          <LcarsField key={s.id}>
            <input
              type="checkbox"
              aria-label={'编队成员 ' + s.id}
              checked={ids.includes(s.id)}
              onChange={(e) =>
                setIds((a) => (e.target.checked ? [...a, s.id] : a.filter((id) => id !== s.id)))
              }
            />
            {s.name}
          </LcarsField>
        ))}
      </div>
      <LcarsField>
        旗舰
        <select
          aria-label="编队旗舰"
          value={ids.includes(flag) ? flag : (ids[0] ?? '')}
          onChange={(e) => setFlag(e.target.value)}
        >
          {world.ships
            .filter((s) => ids.includes(s.id))
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
      </LcarsField>
      <LcarsField>
        形成间距
        <input
          aria-label="编队间距"
          type="number"
          min={15}
          max={100}
          value={spacing}
          onChange={(e) => setSpacing(Number(e.target.value))}
        />
      </LcarsField>
      <LcarsButton
        onClick={async () => {
          const data = {
            name,
            shipIds: ids,
            flagshipId: ids.includes(flag) ? flag : (ids[0] ?? ''),
            spacing,
          };
          const r = await command(
            editing
              ? { type: 'updateGroup', groupId: editing, ...data }
              : { type: 'createGroup', ...data },
          );
          if (r.ok) setEditing(null);
        }}
      >
        {editing ? '保存编队' : '创建编队'}
      </LcarsButton>
      <p>组令协调航行，运输数量为总量。每艘舰船仍可独立替换或中断指令。</p>
    </>
  );
}
