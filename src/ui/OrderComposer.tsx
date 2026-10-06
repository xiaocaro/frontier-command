import { rearmPreview } from './rearm';
import { displayName, displayEntityName } from './localization';
import { LcarsMeter } from './components/Lcars';
import { useState } from 'react';
import type { Action, Snapshot, ModuleId } from '../engine/types';
import type { Selection } from '../StrategicMap';
import type { CommandSender } from './types';
import { LcarsDialog, LcarsButton, LcarsField, LcarsTextBar } from './components/Lcars';
import { ACTION_LABELS } from './format';
import { frontierSectors, sectorId } from '../engine/world-generation';
import { capabilities, cargoUsed } from '../engine/capabilities';
import { MODULES } from '../engine/definitions/progression';
import { routeEstimate } from '../engine/navigation';
export type ComposerRequest = {
  action: Action;
  shipId?: string;
  shipIds?: string[];
  groupId?: string;
};
export function defaultAction(
  type: Action['type'],
  w: Snapshot,
  selection: Selection | null = null,
): Action {
  const id = selection && 'id' in selection ? selection.id : '',
    site = w.bodies.find((b) => b.id === id),
    facility = w.locations.find((l) => l.id === id),
    target = site?.id ?? facility?.id ?? w.contacts[0]?.id ?? 'base';
  switch (type) {
    case 'MOVE':
      return {
        type,
        point: selection?.type === 'point' ? { x: selection.x, y: selection.y } : { x: 200, y: 0 },
      };
    case 'EXPLORE':
      return {
        type,
        sector:
          selection?.type === 'sector'
            ? { q: selection.q, r: selection.r }
            : selection?.type === 'point'
              ? {
                  q: Math.floor((selection.x + 200) / 400),
                  r: Math.floor((selection.y + 200) / 400),
                }
              : { q: 0, r: -1 },
        approach: 'remote',
      };
    case 'SURVEY':
      return {
        type,
        targetId:
          site?.id ??
          w.systems.find((s) => s.id === id)?.id ??
          w.bodies.find((b) => b.kind === 'anomaly')?.id ??
          target,
        approach: 'close',
        deep: false,
      };
    case 'RETURN':
      return { type };
    case 'ASSIST_EVENT':
      return {
        type,
        targetId:
          id || w.events.find((v) => ['reported', 'responding'].includes(v.stage))?.id || '',
      };
    case 'CAPTURE':
      return { type, targetId: id || w.locations.find((l) => l.occupation === 'ruined')?.id || '' };
    case 'TRANSIT':
      return { type, targetId: id || w.wormholes[0]?.id || '' };
    case 'HAIL':
      return {
        type,
        targetId: id || w.contacts.find((c) => c.factionId === 'romulan')?.id || '',
        message: 'greeting',
      };
    case 'HAUL':
      return {
        type,
        sourceId: facility?.kind === 'mine' ? facility.id : 'base',
        targetId:
          facility?.kind === 'mine'
            ? 'base'
            : (w.projects.find((p) => p.id === id)?.id ?? facility?.id ?? 'colony'),
        cargoKind: 'materials',
        amount: 20,
        route: 'safe',
        repeat: false,
      };
    case 'ATTACK':
    case 'DISABLE':
    case 'DRIVE_OFF':
    case 'INTERCEPT':
    case 'SHADOW':
      return { type, targetId: id || w.contacts[0]?.id || '' };
    case 'ESCORT':
      return {
        type,
        targetId:
          selection?.type === 'ship' || selection?.type === 'civilian'
            ? id
            : (w.ships[0]?.id ?? ''),
      };
    case 'PATROL':
      return {
        type,
        targetId: facility?.owner === 'starfleet' ? facility.id : 'colony',
        duration: 60,
      };
    case 'REARM':
      return { type, targetId: 'base', load: { photon: 4, quantum: 0 } };
    case 'REFIT':
      return { type, targetId: 'base', moduleId: 'expandedCargo', remove: false };
    case 'RECOVER':
      return { type, targetId: id || w.wrecks[0]?.id || '' };
    default:
      return { type, targetId: facility?.owner === 'starfleet' ? facility.id : 'base' };
  }
}
export function OrderComposer({
  world,
  request,
  command,
  onClose,
}: {
  world: Snapshot;
  request: ComposerRequest;
  command: CommandSender;
  onClose: () => void;
}) {
  const [action, setAction] = useState<Action>(request.action),
    [shipIds, setShipIds] = useState<string[]>(
      request.groupId
        ? [...(world.groups.find((g) => g.id === request.groupId)?.shipIds ?? [])]
        : request.shipId
          ? [request.shipId]
          : request.shipIds
            ? request.shipIds.filter((id) => world.ships.some((s) => s.id === id))
            : [
                world.ships.find(
                  (s) =>
                    s.id ===
                    (request.shipId ??
                      (request.action.type === 'EXPLORE' || request.action.type === 'SURVEY'
                        ? 'verity'
                        : request.action.type === 'HAUL'
                          ? (world.ships.find((s) => s.classId === 'antares')?.id ?? '')
                          : 'vigil')),
                )?.id ??
                  world.ships[0]?.id ??
                  '',
              ],
    ),
    [mode, setMode] = useState<'REPLACE' | 'QUEUE' | 'INTERRUPT'>('REPLACE');
  const [formError, setFormError] = useState('');
  const update = (patch: Partial<Action>) => {
    setFormError('');
    setAction((a) => ({ ...a, ...patch }) as Action);
  };
  const ships = world.ships.filter((s) => shipIds.includes(s.id)),
    inventory = [
      ...world.locations.filter((l) => l.owner === 'starfleet' && l.hull > 0),
      ...world.projects.filter((p) => !p.complete),
    ];
  const targets =
    action.type === 'CAPTURE'
      ? world.locations.filter((l) => l.occupation === 'ruined' && l.owner !== 'starfleet')
      : action.type === 'SURVEY'
        ? [...world.systems, ...world.bodies]
        : action.type === 'ASSIST_EVENT'
          ? world.events
              .filter(
                (v) =>
                  ['reported', 'responding'].includes(v.stage) &&
                  !['invasion', 'diplomatic'].includes(v.kind),
              )
              .map((v) => ({ ...v, name: v.evidence }))
          : action.type === 'TRANSIT'
            ? world.wormholes
            : action.type === 'RECOVER'
              ? world.wrecks
              : action.type === 'ESCORT'
                ? [...world.ships, ...world.civilians]
                : ['ATTACK', 'DISABLE', 'DRIVE_OFF', 'SHADOW', 'INTERCEPT', 'HAIL'].includes(
                      action.type,
                    )
                  ? [...world.contacts, ...world.locations.filter((l) => l.owner !== 'starfleet')]
                  : action.type === 'REARM' || action.type === 'REPAIR' || action.type === 'REFIT'
                    ? world.locations.filter((l) => l.owner === 'starfleet' && l.hull > 0)
                    : inventory;
  const dest = 'targetId' in action ? inventory.find((l) => l.id === action.targetId) : undefined;
  const origin =
    action.type === 'HAUL' ? inventory.find((l) => l.id === action.sourceId) : undefined;
  const slowest = ships.reduce<(typeof ships)[number] | undefined>(
    (a, b) => (!a || capabilities(b).warp < capabilities(a).warp ? b : a),
    undefined,
  );
  const firstLeg =
    action.type === 'HAUL' && origin && ships.length
      ? ships
          .map((s) => routeEstimate(world, s, origin, action.route))
          .reduce((a, b) => (a.eta > b.eta ? a : b))
      : null;
  const secondLeg =
    action.type === 'HAUL' && slowest && dest && origin
      ? routeEstimate(world, { ...slowest, x: origin.x, y: origin.y }, dest, action.route)
      : null;
  const estimate =
    firstLeg && secondLeg
      ? {
          ...secondLeg,
          eta: firstLeg.eta + secondLeg.eta - 4,
          distance: firstLeg.distance + secondLeg.distance,
          unknownDistance: firstLeg.unknownDistance + secondLeg.unknownDistance,
        }
      : null;
  const rearm =
    action.type === 'REARM'
      ? rearmPreview(world, shipIds, action.targetId, mode, action.load)
      : null;
  const group = world.groups.find((g) => g.id === request.groupId);
  let allocationLeft =
    action.type === 'HAUL' ? Math.min(action.amount, origin?.stock[action.cargoKind] ?? 0) : 0;
  const shares = group
    ? [group.flagshipId, ...group.shipIds.filter((id) => id !== group.flagshipId)].map((id) => {
        const ship = ships.find((s) => s.id === id);
        const amount = ship
          ? Math.min(allocationLeft, Math.floor(capabilities(ship).cargo - cargoUsed(ship)))
          : 0;
        allocationLeft -= amount;
        return { ship, amount };
      })
    : [];
  return (
    <LcarsDialog
      title="ADMIRAL DIRECTIVE"
      label="Admiral 指令"
      className="order-composer"
      onClose={onClose}
    >
      <LcarsTextBar>INTENT / FINAL COMMAND AUTHORITY</LcarsTextBar>
      <div className="composer-grid">
        <LcarsField>
          ACTIVITY
          <select
            aria-label="指令类型"
            value={action.type}
            onChange={(e) => setAction(defaultAction(e.target.value as Action['type'], world))}
          >
            {Object.entries(ACTION_LABELS)
              .filter(
                ([k]) =>
                  !request.groupId ||
                  ['MOVE', 'HAUL', 'PATROL', 'ESCORT', 'INTERCEPT', 'RETREAT', 'RETURN'].includes(
                    k,
                  ),
              )
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </select>
        </LcarsField>
        <LcarsField>
          COMMAND MODE
          <select
            aria-label="提交模式"
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option>REPLACE</option>
            <option>QUEUE</option>
            <option>INTERRUPT</option>
          </select>
        </LcarsField>
        {'targetId' in action && (
          <LcarsField>
            TARGET
            <select
              aria-label="指令目标"
              value={action.targetId}
              onChange={(e) => update({ targetId: e.target.value })}
            >
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {'name' in t ? (t.name ?? t.id) : t.id}
                </option>
              ))}
            </select>
          </LcarsField>
        )}
        {action.type === 'EXPLORE' && (
          <LcarsField>
            UNKNOWN SECTOR
            <select
              aria-label="探索星区"
              value={sectorId(action.sector)}
              onChange={(e) => {
                const c = frontierSectors(world.sectors).find(
                  (c) => sectorId(c) === e.target.value,
                );
                if (c) update({ sector: c });
              }}
            >
              {frontierSectors(world.sectors).map((c) => (
                <option key={sectorId(c)} value={sectorId(c)}>
                  UNKNOWN {c.q}/{c.r}
                </option>
              ))}
            </select>
          </LcarsField>
        )}
        {(action.type === 'EXPLORE' || action.type === 'SURVEY') && (
          <LcarsField>
            SURVEY APPROACH
            <select
              aria-label="调查方式"
              value={action.approach}
              onChange={(e) => update({ approach: e.target.value as 'remote' | 'close' })}
            >
              <option value="remote">REMOTE SCAN / 安全测绘</option>
              <option value="close">CLOSE SURVEY / 现场调查</option>
            </select>
          </LcarsField>
        )}
        {action.type === 'SURVEY' && (
          <LcarsField>
            <input
              aria-label="Deep Scan"
              type="checkbox"
              checked={action.deep}
              onChange={(e) => update({ deep: e.target.checked })}
            />
            DEEP SCAN / 隐藏异常
          </LcarsField>
        )}
        {action.type === 'HAUL' && (
          <>
            <LcarsField>
              ORIGIN
              <select
                aria-label="货运起点"
                value={action.sourceId}
                onChange={(e) => update({ sourceId: e.target.value })}
              >
                {inventory.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </LcarsField>
            <LcarsField>
              CARGO
              <select
                aria-label="货物种类"
                value={action.cargoKind}
                onChange={(e) => update({ cargoKind: e.target.value as typeof action.cargoKind })}
              >
                {['materials', 'photon', 'quantum', 'specialFinds'].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </LcarsField>
            <LcarsField>
              {request.groupId ? 'TOTAL AMOUNT / 编队总量' : 'AMOUNT PER VESSEL / 每舰数量'}
              <input
                aria-label="货物数量"
                type="number"
                min="1"
                value={action.amount}
                onChange={(e) => update({ amount: Number(e.target.value) })}
              />
            </LcarsField>
            <LcarsField>
              ROUTE
              <select
                aria-label="航线"
                value={action.route}
                onChange={(e) => update({ route: e.target.value as typeof action.route })}
              >
                <option value="safe">SAFE / 防御航道</option>
                <option value="direct">DIRECT / 直接航线</option>
                <option value="risky">RISKY / 高速危险航段</option>
              </select>
            </LcarsField>
            <LcarsField>
              <input
                type="checkbox"
                aria-label="循环货运"
                checked={action.repeat}
                onChange={(e) => update({ repeat: e.target.checked })}
              />
              循环货运 / Logistics
            </LcarsField>
            {estimate && (
              <p>
                ETA {estimate.eta}m · {estimate.risk} ·{' '}
                {estimate.unknownDistance > 0.01
                  ? '未知航段约 ' +
                    Math.round((estimate.unknownDistance / estimate.distance) * 100) +
                    '% / 风险不确定'
                  : '航段已测绘 / 接触情报仍可能变化'}
              </p>
            )}
          </>
        )}
        {action.type === 'PATROL' && (
          <LcarsField>
            DURATION
            <input
              aria-label="巡逻时间"
              type="number"
              value={action.duration}
              onChange={(e) => update({ duration: Number(e.target.value) })}
            />
          </LcarsField>
        )}
        {action.type === 'DISABLE' && (
          <LcarsField>
            TARGETING
            <select
              aria-label="禁用子系统"
              value={action.subsystem ?? 'suppression'}
              onChange={(e) =>
                setAction({
                  ...action,
                  subsystem:
                    e.target.value === 'suppression'
                      ? undefined
                      : (e.target.value as 'engines' | 'weapons'),
                })
              }
            >
              <option value="suppression">广域推进压制</option>
              <option value="engines">ENGINES / Precision Targeting</option>
              <option value="weapons">WEAPONS / Precision Targeting</option>
            </select>
          </LcarsField>
        )}
        {action.type === 'REARM' && rearm && (
          <section className="rearm-status" aria-label="装弹容量与库存">
            <LcarsTextBar>弹仓与基地库存</LcarsTextBar>
            <p>
              {rearm.destination ? displayEntityName(world, rearm.destination) : '请选择基地'} ·
              批量装弹使用每舰相同数量，需求按所选舰船总数计算。
            </p>
            {rearm.immediateCount < rearm.ships.length && (
              <p>排队舰船在指令开始时预留弹药；届时库存不足会等待制造或运输补充。</p>
            )}
            {rearm.ships.map((ship) => (
              <div className="record-row" key={ship.id} data-rearm-ship={ship.id}>
                <b>{displayEntityName(world, ship)}</b>
                {(['photon', 'quantum'] as const).map((kind) => {
                  const capacity = capabilities(ship)[kind];
                  return (
                    <div key={kind}>
                      <LcarsMeter
                        label={kind === 'photon' ? '光子鱼雷弹仓' : '量子鱼雷弹仓'}
                        value={ship[kind]}
                        max={capacity || 1}
                      />
                      <p>
                        {capacity === 0
                          ? '不支持该弹种（容量 0）'
                          : `剩余弹仓 ${capacity - ship[kind]} 枚 · 本次装载后 ${ship[kind] + action.load[kind]}／${capacity}`}
                      </p>
                    </div>
                  );
                })}
              </div>
            ))}
            {(['photon', 'quantum'] as const).map((kind) => (
              <div key={kind}>
                <p>
                  {kind === 'photon' ? '光子鱼雷' : '量子鱼雷'}：基地库存{' '}
                  {rearm.destination?.stock[kind] ?? 0}／仓储容量{' '}
                  {rearm.destination?.capacity[kind] ?? 0} · 已预留{' '}
                  {rearm.stock?.reserved[kind] ?? 0} · 本次可用 {rearm.availability[kind]} ·
                  合计需求 {action.load[kind] * rearm.ships.length}
                </p>
                <LcarsField>
                  {kind === 'photon' ? '每舰装载光子鱼雷' : '每舰装载量子鱼雷'}
                  <input
                    aria-label={'装载 ' + kind}
                    type="number"
                    min={0}
                    max={rearm.maximum[kind]}
                    disabled={rearm.maximum[kind] === 0}
                    value={action.load[kind]}
                    onChange={(e) =>
                      update({ load: { ...action.load, [kind]: Number(e.target.value) } })
                    }
                  />
                </LcarsField>
              </div>
            ))}
            <LcarsButton onClick={() => update({ load: { ...rearm.maximum } })}>
              装满可用余量
            </LcarsButton>
            {rearm.error && (
              <p className="inline-error" role="status">
                {rearm.error}
              </p>
            )}
          </section>
        )}
        {action.type === 'REFIT' && (
          <>
            <LcarsField>
              MODULE
              <select
                aria-label="安装模块"
                value={action.moduleId}
                onChange={(e) => update({ moduleId: e.target.value as ModuleId })}
              >
                {Object.entries(MODULES).map(([id, m]) => (
                  <option key={id} value={id}>
                    {m.label} · {m.cost.credits}C / {m.cost.materials}M / {m.cost.specialFinds}F
                  </option>
                ))}
              </select>
            </LcarsField>
            <p>{MODULES[action.moduleId].description}</p>
            <LcarsField>
              <input
                type="checkbox"
                aria-label="拆除模块"
                checked={action.remove}
                onChange={(e) => update({ remove: e.target.checked })}
              />
              拆除 / 消费与货舱校验
            </LcarsField>
          </>
        )}
        {action.type === 'HAIL' && (
          <LcarsField>
            通信内容
            <select
              value={action.message}
              onChange={(e) =>
                setAction({ ...action, message: e.target.value as typeof action.message })
              }
            >
              <option value="greeting">问候与识别</option>
              <option value="deescalate">缓和局势</option>
              <option value="withdraw">要求撤离</option>
            </select>
          </LcarsField>
        )}
        {action.type === 'MOVE' &&
          (['x', 'y'] as const).map((k) => (
            <LcarsField key={k}>
              {k.toUpperCase()}
              <input
                aria-label={'坐标 ' + k}
                type="number"
                value={action.point[k]}
                onChange={(e) =>
                  update({ point: { ...action.point, [k]: Number(e.target.value) } })
                }
              />
            </LcarsField>
          ))}
      </div>
      <LcarsTextBar>FLEET / ALL OWNED VESSELS</LcarsTextBar>
      {request.groupId && <p>编队命令：{group?.name} · 数量为编队总量</p>}
      {action.type === 'HAUL' && group && (
        <p>
          预计一航次份额（以到场可用库存为准）：
          {shares.map((p) => (p.ship?.name ?? '舰船不可用') + ' ' + p.amount).join(' · ')}
          。装载完成后共同出发。
        </p>
      )}
      <div className="asset-list">
        {world.ships.map((s) => (
          <LcarsField key={s.id}>
            <input
              type="checkbox"
              disabled={!!request.groupId}
              aria-label={'分配 ' + s.id}
              checked={shipIds.includes(s.id)}
              onChange={(e) =>
                setShipIds((ids) =>
                  e.target.checked ? [...ids, s.id] : ids.filter((id) => id !== s.id),
                )
              }
            />
            {s.name} · {s.current?.action.type ?? 'AVAILABLE'} · CARGO {Math.floor(cargoUsed(s))}/
            {capabilities(s).cargo}
          </LcarsField>
        ))}
      </div>
      <p className="muted">
        {mode === 'REPLACE'
          ? '替换当前、挂起及排队指令；货物与损伤保留'
          : mode === 'QUEUE'
            ? '当前指令结束后按顺序执行；持续命令需取消或替换'
            : '临时行动结束后自动接续原指令；目标失效会报告'}
        。
      </p>
      {formError && (
        <p role="alert" className="inline-error">
          {formError}
        </p>
      )}
      <div className="dialog-actions">
        <LcarsButton
          disabled={shipIds.length === 0 || !!rearm?.error}
          onClick={async () => {
            const r = await command(
              request.groupId
                ? { type: 'issueGroupDirective', groupId: request.groupId, mode, action }
                : { type: 'issueDirective', shipIds, mode, action },
            );
            if (r.ok) onClose();
            else setFormError(r.reason);
          }}
        >
          下达 Admiral 指令
        </LcarsButton>
        <LcarsButton tone="secondary" onClick={onClose}>
          取消
        </LcarsButton>
      </div>
    </LcarsDialog>
  );
}
