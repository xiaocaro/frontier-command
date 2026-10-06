import { currentMovementSpeed } from '../engine/navigation';
import {
  displayName,
  displayEntityName,
  SHIP_LABELS,
  chineseText,
  worldText,
} from './localization';
import { BASE_REFIT } from '../engine/definitions/progression';
import { StandingPanel } from './StandingPanel';
import { EventsView } from './EventsView';
import { useState, useEffect } from 'react';
import type { Snapshot, Action, FacilityKind } from '../engine/types';
import type { Selection } from '../StrategicMap';
import type { CommandSender } from './types';
import type { ComposerRequest } from './OrderComposer';
import { defaultAction } from './OrderComposer';
import { LcarsButton, LcarsField, LcarsMeter, LcarsTextBar } from './components/Lcars';
import { capabilities, cargoUsed } from '../engine/capabilities';
import { FACILITIES, MODULES } from '../engine/definitions/progression';
import {
  ACTION_LABELS,
  actionProgress,
  GOODS_LABELS,
  FACILITY_LABELS,
  BODY_LABELS,
} from './format';
function Rename({ id, name, command }: { id: string; name: string; command: CommandSender }) {
  const [value, setValue] = useState(name);
  return (
    <div className="inline-actions">
      <LcarsField>
        显示名称
        <input
          aria-label="显示名称"
          value={value}
          maxLength={80}
          onChange={(e) => setValue(e.target.value)}
        />
      </LcarsField>
      <LcarsButton onClick={() => command({ type: 'renameEntity', entityId: id, name: value })}>
        保存名称
      </LcarsButton>
    </div>
  );
}
export function Inspector({
  world,
  selection,
  selectedShipIds,
  select,
  command,
  create,
}: {
  world: Snapshot;
  selection: Selection | null;
  selectedShipIds: string[];
  select: (s: Selection) => void;
  command: CommandSender;
  create: (r: ComposerRequest) => void;
}) {
  const [buildKind, setBuildKind] = useState<Exclude<FacilityKind, 'base'>>('mine'),
    [projectName, setProjectName] = useState(''),
    [freighter, setFreighter] = useState(
      world.ships.find((s) => s.classId === 'antares')?.id ?? world.ships[0]?.id ?? '',
    );
  useEffect(() => {
    if (selectedShipIds[0]) setFreighter(selectedShipIds[0]);
  }, [selectedShipIds]);
  const name = (entity: { readonly id: string; readonly name: string }) =>
    displayEntityName(world, entity);
  const launch = (type: Action['type'], shipId?: string) =>
    create({
      action: defaultAction(type, world, selection),
      ...(shipId && selectedShipIds.length > 1 && selectedShipIds.includes(shipId)
        ? { shipIds: selectedShipIds }
        : { shipId }),
    });
  const returnActions = (
    <div className="inline-actions">
      <LcarsButton onClick={() => create({ action: { type: 'RETURN' } })}>
        返回 曙光 / 保留货物
      </LcarsButton>
      <LcarsButton onClick={() => create({ action: { type: 'UNLOAD', targetId: 'base' } })}>
        返回 曙光 并卸货
      </LcarsButton>
    </div>
  );
  if (!selection) return <p>选择舰船、设施、恒星系或 未知空间，下达 舰队司令 意图。</p>;
  if (selection.type === 'siteContact') {
    const site = world.siteContacts.find((s) => s.id === selection.id);
    return site ? (
      <>
        <LcarsTextBar>UNCONFIRMED SITE 未确认设施</LcarsTextBar>
        <p>来自现场传感器观测；尚未确认设施身份，不能作为打击目标。</p>
        <LcarsMeter label="持续侦察" value={site.progress} max={10} />
        <p>派舰保持传感器覆盖，连续侦察 10 游戏分钟后确认。</p>
        <LcarsButton
          onClick={() => create({ action: { type: 'MOVE', point: { x: site.x, y: site.y } } })}
        >
          前往侦察
        </LcarsButton>
      </>
    ) : (
      <p>地点情报已更新，请从星图选择已确认设施。</p>
    );
  }
  if (selection.type === 'point' || selection.type === 'sector')
    return (
      <>
        <LcarsTextBar>
          {selection.type === 'sector' ? '星区 ' + selection.q + '/' + selection.r : '世界坐标'}
        </LcarsTextBar>
        <p>持续边疆 · 未知区域可测绘，世界没有固定地图尽头。</p>
        <LcarsButton onClick={() => launch('EXPLORE')}>探索星区</LcarsButton>
        <LcarsButton onClick={() => launch('MOVE')}>移动</LcarsButton>
      </>
    );
  if (selection.type === 'event')
    return <EventsView world={world} command={command} create={create} eventId={selection.id} />;
  if (selection.type === 'group') {
    const g = world.groups.find((g) => g.id === selection.id);
    return g ? (
      <>
        <LcarsTextBar literal>{name(g)}</LcarsTextBar>
        <p>
          编队 · {g.shipIds.length} 艘 · 间距 {g.spacing}
        </p>
        {g.shipIds.map((id) => {
          const s = world.ships.find((s) => s.id === id);
          return (
            s && (
              <p key={id}>
                {name(s)} · {s.current ? ACTION_LABELS[s.current.action.type] : '待命'}
                {s.current?.groupOrderId
                  ? ` · 分配 ${Math.floor(Object.values(s.current.reserved).reduce((a, b) => a + b, 0) || s.current.carried)} 货物`
                  : ''}
              </p>
            )
          );
        })}
        <div className="inline-actions">
          {(['MOVE', 'HAUL', 'PATROL', 'ESCORT', 'INTERCEPT', 'RETREAT', 'RETURN'] as const).map(
            (t) => (
              <LcarsButton
                key={t}
                onClick={() => create({ groupId: g.id, action: defaultAction(t, world) })}
              >
                {ACTION_LABELS[t]}
              </LcarsButton>
            ),
          )}
        </div>
        <p>可随时选取成员进行单舰改令。</p>
      </>
    ) : (
      <p>编队已解散，已下达指令继续执行。</p>
    );
  }
  if (selection.type === 'wormhole') {
    const w = world.wormholes.find((w) => w.id === selection.id);
    return (
      w && (
        <>
          <LcarsTextBar literal>{name(w)}</LcarsTextBar>
          <p>
            虫洞 · {w.stable ? '稳定' : '不稳定'} · 稳定度 {Math.round(w.stability * 100)}%
          </p>
          <p>{w.surveyed ? '已调查：可以通行' : '出口未知，建议先派舰调查。'}</p>
          <LcarsButton onClick={() => launch('TRANSIT')}>穿越 虫洞</LcarsButton>
          {world.events
            .filter((v) => v.subjectId === w.id)
            .map((v) => (
              <LcarsButton key={v.id} onClick={() => select({ type: 'event', id: v.id })}>
                调查 虫洞
              </LcarsButton>
            ))}
        </>
      )
    );
  }
  if (selection.type === 'civilian') {
    const s = world.civilians.find((s) => s.id === selection.id);
    return (
      s && (
        <>
          <LcarsTextBar literal>{name(s)}</LcarsTextBar>
          <p>
            后方商船 ·{' '}
            {{ idle: '等待订单', loading: '装载', delivery: '交付', return: '返航' }[s.phase]}
          </p>
          <p>
            实际货物 {Math.floor(cargoUsed(s))} / {capabilities(s).cargo}
          </p>
          <LcarsButton onClick={() => launch('ESCORT')}>安排护航</LcarsButton>
        </>
      )
    );
  }
  if (selection.type === 'ship') {
    const s = world.ships.find((s) => s.id === selection.id);
    if (!s) return <p>舰船已进入永久损失档案。</p>;
    const c = capabilities(s);
    return (
      <>
        <LcarsTextBar literal>{name(s)}</LcarsTextBar>
        <p>{SHIP_LABELS[s.classId]} · 舰队司令拥有最终指挥权</p>
        {c.cloak && (
          <>
            <LcarsButton
              aria-label="切换隐形"
              aria-pressed={s.cloak === 'on'}
              onClick={() => command({ type: 'setCloak', shipId: s.id, enabled: s.cloak !== 'on' })}
            >
              {s.cloak === 'on' ? '关闭隐形' : '开启隐形'}
            </LcarsButton>
            <p>
              隐形状态：
              {s.cloak === 'on'
                ? '持续隐形'
                : s.cloak === 'decloaking'
                  ? '解除隐形中'
                  : '可被探测'}{' '}
              · 开始跟踪时自动开启，开火解除隐形。
            </p>
          </>
        )}
        {s.tracking && (
          <p>
            跟踪：{s.tracking.live ? '持续观测' : '搜索最后观测位置'} ·{' '}
            {s.cloak === 'on' ? '低信号被动尾随' : '存在被发现风险'}
          </p>
        )}
        {s.emergencyRetreat && <p>正在紧急脱离战斗，脱离后原地待命。</p>}
        <LcarsMeter label="血量" value={s.hull} max={c.hull} />
        <LcarsMeter label="护盾" value={s.shield} max={c.shield} />
        <LcarsMeter label="核心" value={s.core} max={c.core} />
        <p>
          基础速度 {SHIP_LABELS[s.classId]}：{(c.warp / Math.max(0.15, s.engines / 100)).toFixed(1)}{' '}
          · 当前速度 {currentMovementSpeed(world, s).toFixed(1)}
        </p>
        <p>
          推进系统 {Math.round(s.engines)} / 武器系统 {Math.round(s.weapons)} · 光子鱼雷 {s.photon}{' '}
          / 量子鱼雷 {s.quantum}
        </p>
        <LcarsTextBar>当前指令 / 队列 / 挂起指令</LcarsTextBar>
        <p>
          {s.current ? ACTION_LABELS[s.current.action.type] : '待命'} ·{' '}
          {actionProgress(world, s).text}
        </p>
        {s.queue.map((d) => (
          <p key={d.id}>排队 · {ACTION_LABELS[d.action.type]}</p>
        ))}
        {s.suspended.map((d) => (
          <p key={d.id}>挂起 · {ACTION_LABELS[d.action.type]} / 保留进度</p>
        ))}
        <div className="inline-actions">
          <LcarsButton onClick={() => launch('MOVE', s.id)}>新指令 / 改令</LcarsButton>
          <LcarsButton
            tone="danger"
            onClick={() => command({ type: 'cancelDirective', shipId: s.id })}
          >
            取消全部指令
          </LcarsButton>
          <LcarsButton onClick={() => launch('RETREAT', s.id)}>撤退</LcarsButton>
        </div>
        <LcarsTextBar>
          货舱 / {Math.floor(cargoUsed(s))} / {c.cargo}
        </LcarsTextBar>
        {Object.entries(s.cargo).map(([k, v]) => (
          <p key={k}>
            {GOODS_LABELS[k as keyof typeof GOODS_LABELS]} {Math.floor(v)}
          </p>
        ))}
        <LcarsButton onClick={() => launch('UNLOAD', s.id)}>卸货入库</LcarsButton>
        {returnActions}
        <LcarsTextBar>
          模块 / {s.modules.length} / {c.moduleSlots}
        </LcarsTextBar>
        {s.modules.map((k) => (
          <p key={k}>
            {
              {
                deepScan: '深层扫描',
                longRangeSensors: '远程传感器',
                precisionTargeting: '精确瞄准',
                expandedCargo: '扩展货舱',
                reinforcedShields: '强化护盾',
              }[k]
            }
          </p>
        ))}
        <div className="inline-actions">
          {(['REPAIR', 'REARM', 'REFIT'] as const).map((t) => (
            <LcarsButton key={t} onClick={() => launch(t, s.id)}>
              {ACTION_LABELS[t]}
            </LcarsButton>
          ))}
        </div>
        <StandingPanel ship={s} command={command} />
        <Rename key={s.id} id={s.id} name={name(s)} command={command} />
      </>
    );
  }
  if (selection.type === 'body' || selection.type === 'system') {
    const b = world.bodies.find((b) => b.id === selection.id),
      sys = world.systems.find((s) => s.id === selection.id),
      entity = b ?? sys;
    if (!entity) return <p>当前情报不可用。</p>;
    if (b?.kind === 'derelict') {
      const event = world.events.find((v) => v.subjectId === b.id && v.kind === 'derelict');
      return (
        <>
          <LcarsTextBar literal>{name(b)}</LcarsTextBar>
          <p>失落舰船 · 调查 {b.survey}/2</p>
          {event && (
            <>
              <LcarsMeter label="现场接管进度" value={event.work} max={20} />
              <p>
                {worldText(world, event.outcome) ||
                  (event.stage === 'responding' ? '接管执行中' : '等待现场接管')}
              </p>
            </>
          )}
        </>
      );
    }
    const buildOptions = [
      ...(b?.kind === 'resource' && b.remaining > 0 ? ['mine' as const] : []),
      ...(b?.kind === 'planet' && b.habitable ? ['colony' as const] : []),
      'outpost' as const,
      ...(world.upgrades.defense ? ['platform' as const] : []),
    ].filter(
      (kind) =>
        !world.locations.some((l) => l.siteId === entity.id && l.kind === kind && l.hull > 0) &&
        !world.projects.some((p) => p.siteId === entity.id && p.kind === kind),
    );
    const chosenBuild = buildOptions.includes(buildKind) ? buildKind : buildOptions[0];
    return (
      <>
        <LcarsTextBar literal>{name(entity)}</LcarsTextBar>
        <p>
          {b
            ? BODY_LABELS[b.kind] + ' / ' + chineseText(b.category)
            : '恒星系 / ' + chineseText(sys?.starClass ?? '')}{' '}
          · 调查 {entity.survey}/2
        </p>
        {b && (
          <p>
            {b.survey >= 2
              ? b.kind === 'resource'
                ? '余矿 ' + Math.floor(b.remaining) + ' · 丰富度 ' + b.richness.toFixed(2)
                : b.kind === 'planet'
                  ? '宜居 ' + (b.habitable ? '是' : '否')
                  : '异常 / ' + (b.hidden ? '深层' : '普通')
              : '远距轮廓，需要近距确认'}{' '}
            · 危险程度 {b.survey >= 2 ? b.hazard.toFixed(2) : '未知'}
          </p>
        )}
        <div className="inline-actions">
          <LcarsButton onClick={() => launch('SURVEY')}>远距 / 近距调查</LcarsButton>
        </div>
        {sys &&
          sys.bodyIds.map((id) => {
            const child = world.bodies.find((b) => b.id === id);
            return (
              child && (
                <LcarsButton
                  key={id}
                  shape="rail"
                  className="record-row"
                  onClick={() => select({ type: 'body', id })}
                >
                  {name(child)} / {BODY_LABELS[child.kind]}
                </LcarsButton>
              )
            );
          })}
        {buildOptions.length > 0 && (
          <>
            <LcarsTextBar>前沿建设</LcarsTextBar>
            <LcarsField>
              设施类型
              <select
                aria-label="设施类型"
                value={chosenBuild}
                onChange={(e) => setBuildKind(e.target.value as typeof buildKind)}
              >
                {buildOptions.map((kind) => (
                  <option key={kind} value={kind}>
                    {FACILITY_LABELS[kind]}
                  </option>
                ))}
              </select>
            </LcarsField>
            <LcarsField>
              设施名称
              <input
                aria-label="新设施名称"
                value={projectName}
                placeholder={name(entity) + ' ' + FACILITY_LABELS[chosenBuild]}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </LcarsField>
            <p>
              {FACILITIES[chosenBuild].cost.credits} 预算 · {FACILITIES[chosenBuild].cost.materials}{' '}
              材料 / 必须运到现场
            </p>
            <LcarsButton
              onClick={() =>
                command({
                  type: 'startConstruction',
                  siteId: entity.id,
                  kind: chosenBuild,
                  name: projectName.trim() || name(entity) + ' ' + FACILITY_LABELS[chosenBuild],
                })
              }
            >
              建立现场建设项目
            </LcarsButton>
          </>
        )}
        {(!b || b.kind === 'planet') && (
          <Rename key={entity.id} id={entity.id} name={name(entity)} command={command} />
        )}
      </>
    );
  }
  if (selection.type === 'project') {
    const p = world.projects.find((p) => p.id === selection.id);
    if (!p) return <p>项目不可用。</p>;
    return (
      <>
        <LcarsTextBar literal>{name(p)}</LcarsTextBar>
        <p>{p.complete ? '已完成' : '等待实物物资'}</p>
        <p>
          材料 {Math.floor(p.stock.materials)} / {p.cost.materials}
        </p>
        <LcarsMeter label="建设进度" value={p.work} max={p.duration} />
        <LcarsField>
          运输舰
          <select
            aria-label="建设货运舰"
            value={freighter}
            onChange={(e) => setFreighter(e.target.value)}
          >
            {world.ships.map((s) => (
              <option key={s.id} value={s.id}>
                {name(s)}
              </option>
            ))}
          </select>
        </LcarsField>
        <LcarsButton
          disabled={p.complete}
          onClick={async () => {
            const ids = selectedShipIds.length > 0 ? selectedShipIds : [freighter];
            const ships = world.ships.filter((s) => ids.includes(s.id));
            let left = Math.max(0, Math.ceil(p.cost.materials - p.stock.materials));
            const started = new Set<string>();
            while (left > 0 && ships.length > 0) {
              for (const ship of ships) {
                if (left <= 0) break;
                const amount = Math.min(capabilities(ship).cargo, left);
                if (amount <= 0) continue;
                const result = await command({
                  type: 'issueDirective',
                  shipIds: [ship.id],
                  mode: started.has(ship.id) ? 'QUEUE' : 'REPLACE',
                  action: {
                    type: 'HAUL',
                    sourceId: 'base',
                    targetId: p.id,
                    cargoKind: 'materials',
                    amount,
                    route: 'safe',
                    repeat: false,
                  },
                });
                if (!result.ok) return;
                started.add(ship.id);
                left -= amount;
              }
              if (!ships.some((s) => capabilities(s).cargo > 0)) break;
            }
          }}
        >
          安排建设物资 / 分批真实货运
        </LcarsButton>
        <LcarsButton onClick={() => launch('HAUL')}>自定义运输</LcarsButton>
      </>
    );
  }
  if (selection.type === 'location') {
    const l = world.locations.find((l) => l.id === selection.id);
    if (!l) return <p>设施不可见。</p>;
    return (
      <>
        <LcarsTextBar literal>{name(l)}</LcarsTextBar>
        <p>
          {FACILITY_LABELS[l.kind]} /{' '}
          {l.owner === 'starfleet' ? '联邦' : l.owner === 'orion' ? '猎户座辛迪加' : '罗慕伦'}{' '}
          {l.distress ? ' / 求救中' : ''}
        </p>
        <div className="facility-metrics" aria-label="设施状态与发展">
          <LcarsMeter label="血量" value={l.hull} max={l.maxHull} />
          <LcarsMeter label="护盾" value={l.shield} max={l.maxShield} />
          {l.colony && (
            <>
              <LcarsMeter label="人口／住宅" value={l.colony.population} max={l.colony.housing} />
              {(
                ['stability', 'morale', 'security', 'industry', 'science', 'contamination'] as const
              ).map((key) => (
                <LcarsMeter
                  key={key}
                  label={
                    {
                      stability: '稳定',
                      morale: '士气',
                      security: '安全',
                      industry: '工业',
                      science: '科研',
                      contamination: '污染',
                    }[key]
                  }
                  value={l.colony![key]}
                  max={100}
                  danger={key === 'contamination'}
                />
              ))}
              <p>
                指挥官：
                {displayName(
                  world.personnel.find((p) => p.id === l.colony?.commanderId)?.name ?? '岗位空缺',
                )}
              </p>
              <p>预算收益：每千人口每 5 游戏分钟基准 18，受工业、稳定、指挥官和事件影响。</p>
            </>
          )}
        </div>
        <p>
          相位炮射程 {FACILITIES[l.kind].range} · {l.hull > 0 ? '自卫火控在线' : '火控离线'}
        </p>
        {l.occupation ? (
          <>
            <LcarsTextBar>
              {l.occupation === 'ruined'
                ? '基地遗址／待接管'
                : l.occupation === 'secured'
                  ? '已接管／待改建'
                  : '基地改建中'}
            </LcarsTextBar>
            {l.occupation === 'ruined' && (
              <>
                <p>派舰抵达现场接管，耗时 {BASE_REFIT.captureMinutes} 游戏分钟；遭袭时暂停。</p>
                <LcarsButton onClick={() => launch('CAPTURE')}>派舰现场接管</LcarsButton>
                {world.ships
                  .filter(
                    (ship) =>
                      ship.current?.action.type === 'CAPTURE' &&
                      ship.current.action.targetId === l.id,
                  )
                  .map((ship) => (
                    <LcarsMeter
                      key={ship.id}
                      label={name(ship) + ' 接管进度'}
                      value={ship.current!.work}
                      max={BASE_REFIT.captureMinutes}
                    />
                  ))}
              </>
            )}
            {l.occupation === 'secured' && (
              <>
                <p>
                  改建费用：{BASE_REFIT.cost.credits} 预算、{BASE_REFIT.cost.materials}{' '}
                  现场材料；施工 {BASE_REFIT.minutes} 游戏分钟。
                </p>
                <LcarsButton
                  onClick={() =>
                    command({
                      type: 'startBaseRefit',
                      locationId: l.id,
                      name: name(l).replace('藏身基地', '前进基地').slice(0, 80),
                    })
                  }
                >
                  建立基地改建项目
                </LcarsButton>
              </>
            )}
            {world.projects
              .filter((p) => p.refitLocationId === l.id && !p.complete)
              .map((p) => (
                <LcarsButton key={p.id} onClick={() => select({ type: 'project', id: p.id })}>
                  运输材料与查看施工进度
                </LcarsButton>
              ))}
            {l.owner === 'starfleet' && (
              <Rename key={l.id} id={l.id} name={name(l)} command={command} />
            )}
          </>
        ) : l.owner === 'starfleet' ? (
          <>
            {world.ships.some((s) => Math.hypot(s.x - l.x, s.y - l.y) < 90) && (
              <div className="inline-actions">
                {world.ships
                  .filter((s) => Math.hypot(s.x - l.x, s.y - l.y) < 90)
                  .map((s) => (
                    <LcarsButton key={s.id} onClick={() => select({ type: 'ship', id: s.id })}>
                      {name(s)}
                    </LcarsButton>
                  ))}
              </div>
            )}
            {l.kind === 'mine' && returnActions}
            <LcarsTextBar>
              实际仓储 /{' '}
              {world.events.some(
                (v) =>
                  v.kind === 'accident' &&
                  v.subjectId === l.id &&
                  ['reported', 'responding'].includes(v.stage),
              )
                ? '事故停工：等待设备修复'
                : l.storageFull
                  ? '仓满：产线等待运输'
                  : '运行中'}
            </LcarsTextBar>
            {Object.entries(l.stock).map(([k, v]) => (
              <LcarsMeter
                key={k}
                label={GOODS_LABELS[k as keyof typeof GOODS_LABELS]}
                value={v}
                max={l.capacity[k as keyof typeof l.capacity]}
                decimals={1}
              />
            ))}
            <div className="inline-actions">
              <LcarsButton onClick={() => launch('HAUL')}>运输 / 物流</LcarsButton>
              <LcarsButton onClick={() => launch('PATROL')}>巡逻 / 防卫</LcarsButton>
              <LcarsButton onClick={() => command({ type: 'repairFacility', locationId: l.id })}>
                使用本地材料维修
              </LcarsButton>
            </div>
            {l.colony && (
              <>
                <LcarsTextBar>殖民地发展</LcarsTextBar>
                <div className="inline-actions">
                  {(['housing', 'industry', 'science', 'security'] as const).map((kind) => (
                    <LcarsButton
                      key={kind}
                      disabled={!!l.colony?.development}
                      onClick={() => command({ type: 'developColony', locationId: l.id, kind })}
                    >
                      {
                        { housing: '住宅', industry: '工业', science: '科研', security: '安全' }[
                          kind
                        ]
                      }
                      建设 / 60 预算 + 10 本地材料
                    </LcarsButton>
                  ))}
                </div>
                {l.colony.development && (
                  <p>正在建设：{Math.floor(l.colony.development.work)} / 30 分钟</p>
                )}
              </>
            )}
            {world.events
              .filter((v) => v.subjectId === l.id && ['reported', 'responding'].includes(v.stage))
              .map((v) => (
                <LcarsButton key={v.id} onClick={() => select({ type: 'event', id: v.id })}>
                  处置：{worldText(world, v.evidence)}
                </LcarsButton>
              ))}
            <Rename key={l.id} id={l.id} name={name(l)} command={command} />
          </>
        ) : (
          <>
            <p>敌方库存与意图未知</p>
            <LcarsButton tone="danger" onClick={() => launch('ATTACK')}>
              攻击
            </LcarsButton>
          </>
        )}
      </>
    );
  }
  if (selection.type === 'contact') {
    const c = world.contacts.find((c) => c.id === selection.id);
    if (!c) return <p>接触已过期；未确认击毁。</p>;
    return (
      <>
        <LcarsTextBar>{displayName(c.name ?? '未知接触')}</LcarsTextBar>
        <p>
          情报级别：
          {
            {
              CONTACT: '未分类接触',
              CLASSIFIED: '已分类',
              IDENTIFIED: '已识别',
              TRACKED: '持续跟踪',
            }[c.level]
          }
        </p>
        <p>
          {c.factionId === 'orion'
            ? '猎户座辛迪加'
            : c.factionId === 'romulan'
              ? '罗慕伦'
              : '未知势力'}{' '}
          · {c.hostile ? '已确认敌对' : '尚未确认敌对'} · {c.live ? '实时接触' : '最后已知位置'}
        </p>
        <p>
          上次目击距今 {Math.floor(world.time - c.lastSeen)} 分钟 · {Math.round(c.x)},{' '}
          {Math.round(c.y)}
        </p>
        <div className="inline-actions">
          {(['INTERCEPT', 'SHADOW', 'ATTACK', 'DISABLE', 'DRIVE_OFF'] as const).map((t) => (
            <LcarsButton
              key={t}
              tone={t === 'ATTACK' ? 'danger' : 'primary'}
              onClick={() => launch(t)}
            >
              {ACTION_LABELS[t]}
            </LcarsButton>
          ))}
        </div>
        {c.factionId === 'romulan' && (
          <LcarsButton onClick={() => launch('HAIL')}>呼叫 罗慕伦 / 外交通信</LcarsButton>
        )}
        <p className="muted">攻击未确认敌对 罗慕伦 会产生政治后果。</p>
      </>
    );
  }
  if (selection.type === 'wreck') {
    const x = world.wrecks.find((x) => x.id === selection.id);
    return (
      <>
        <LcarsTextBar literal>{x ? name(x) : '残骸'}</LcarsTextBar>
        {x &&
          Object.entries(x.stock).map(([k, v]) => (
            <p key={k}>
              {GOODS_LABELS[k as keyof typeof GOODS_LABELS]} {Math.floor(v)}
            </p>
          ))}
        <LcarsButton onClick={() => launch('RECOVER')}>打捞实物货物</LcarsButton>
      </>
    );
  }
  const loss = world.losses.find((l) => l.shipId === selection.id);
  return (
    <>
      <LcarsTextBar>永久舰船损失</LcarsTextBar>
      <p>
        {displayName(loss?.name ?? '', world.renamedEntityIds.includes(selection.id))} ·{' '}
        {chineseText(loss?.reason ?? '')}
      </p>
      <p>新造舰有独立舰籍，原舰不会复活。</p>
    </>
  );
}
