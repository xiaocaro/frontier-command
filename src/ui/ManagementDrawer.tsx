import { WorkProgress } from './components/WorkProgress';
import { FleetManager } from './FleetManager';
import { PersonnelView } from './PersonnelView';
import { EventsView } from './EventsView';
import { TradeView } from './TradeView';
import { useState } from 'react';
import type { Snapshot, ModuleId, UpgradeId, CargoKind } from '../engine/types';
import type { ShipClassId } from '../engine/definitions/ships';
import { SHIP_CLASSES } from '../engine/definitions/ships';
import { BUILD_COSTS, MODULES, UPGRADES } from '../engine/definitions/progression';
import { capabilities } from '../engine/capabilities';
import type { TimelineStatus } from '../engine/timeline';
import type { Page, CommandSender } from './types';
import type { Selection } from '../StrategicMap';
import { bilingualTitle } from './components/bilingual';
import { LcarsDrawer, LcarsButton, LcarsField, LcarsTextBar } from './components/Lcars';
import type { ComposerRequest } from './OrderComposer';
import { defaultAction } from './OrderComposer';
import { ProductionPrice } from './components/ProductionPrice';
import { ACTION_LABELS } from './format';
export const STARBASE_MODULES = [
  'COMMAND',
  'SHIPYARD',
  'DRYDOCK',
  'ARMORY',
  'ENGINEERING',
  'LOGISTICS',
  'SENSOR CONTROL',
  'DEFENSE GRID',
] as const;
export function ManagementDrawer({
  page,
  world,
  timeline,
  close,
  select,
  create,
  command,
  save,
  newFrontier,
}: {
  page: Page;
  world: Snapshot;
  timeline: TimelineStatus;
  close: () => void;
  select: (s: Selection) => void;
  create: (r: ComposerRequest) => void;
  command: CommandSender;
  save: () => void;
  newFrontier: () => void;
}) {
  const [baseId, setBaseId] = useState('base');
  const [tab, setTab] = useState<(typeof STARBASE_MODULES)[number]>('COMMAND'),
    [classId, setClassId] = useState<keyof typeof BUILD_COSTS>('peregrine'),
    [shipName, setShipName] = useState('边疆号'),
    [selectedShip, setSelectedShip] = useState('verity'),
    [moduleId, setModuleId] = useState<ModuleId>('expandedCargo'),
    [goods, setGoods] = useState<'photon' | 'quantum'>('photon'),
    [amount, setAmount] = useState(10),
    [saleKind, setSaleKind] = useState<CargoKind>('materials');
  const bases = world.locations.filter(
    (l) => l.kind === 'base' && l.owner === 'starfleet' && l.hull > 0 && !l.occupation,
  );
  const base =
      bases.find((l) => l.id === baseId) ??
      bases[0] ??
      world.locations.find((l) => l.id === 'base')!,
    ship = world.ships.find((s) => s.id === selectedShip) ?? world.ships[0],
    shipId = ship?.id ?? '';
  const launch = (type: Parameters<typeof defaultAction>[0], shipId?: string) =>
    create({
      action: ['REPAIR', 'REARM', 'REFIT', 'DOCK', 'UNLOAD'].includes(type)
        ? ({ ...defaultAction(type, world), targetId: base.id } as ReturnType<typeof defaultAction>)
        : defaultAction(type, world),
      shipId,
    });
  const pickShip = (
    <LcarsField>
      VESSEL
      <select
        aria-label="基地舰船"
        value={shipId}
        onChange={(e) => setSelectedShip(e.target.value)}
      >
        {world.ships.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} · {s.current?.action.type ?? 'AVAILABLE'}
          </option>
        ))}
      </select>
    </LcarsField>
  );
  const upgrade = (id: UpgradeId) => (
    <div className="record-row">
      <b>
        {UPGRADES[id].label} / {world.upgrades[id] ? '等级 1／已升级' : '等级 0／基础系统'}
      </b>
      <p>{UPGRADES[id].description}</p>
      <p>
        {UPGRADES[id].cost.credits} 预算 / {UPGRADES[id].cost.materials} 材料 /{' '}
        {UPGRADES[id].cost.specialFinds} 特殊发现
      </p>
      {world.jobs
        .filter((j) => j.kind === 'upgrade' && j.key === id && !j.complete && !j.cancelled)
        .map((j) => (
          <WorkProgress
            key={j.id}
            label={j.name}
            work={j.work}
            duration={j.duration}
            paused={world.paused}
          />
        ))}
      <LcarsButton
        disabled={
          !!world.upgrades[id] ||
          world.jobs.some(
            (j) => j.kind === 'upgrade' && j.key === id && !j.complete && !j.cancelled,
          )
        }
        onClick={() => command({ type: 'upgrade', upgradeId: id, locationId: base.id })}
      >
        升级 {UPGRADES[id].label}
      </LcarsButton>
    </div>
  );
  return (
    <LcarsDrawer
      title={page === 'STARBASE' ? base.name + ' / ' + tab : page + ' / COMMAND RECORDS'}
      label={page + ' 工作面板'}
      onClose={close}
    >
      {page === 'FLEET' && (
        <FleetManager world={world} command={command} select={select} create={create} />
      )}
      {page === 'STARBASE' && (
        <>
          <LcarsField>
            生产与服务基地
            <select
              aria-label="管理基地"
              value={base.id}
              onChange={(e) => setBaseId(e.target.value)}
            >
              {bases.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </LcarsField>
          <div
            className="inline-actions starbase-tabs"
            role="tablist"
            aria-label="Starbase modules"
          >
            {STARBASE_MODULES.map((t) => (
              <LcarsButton
                role="tab"
                aria-selected={tab === t}
                key={bilingualTitle(t)}
                sound="navigation"
                onClick={() => setTab(t)}
              >
                {bilingualTitle(t)}
              </LcarsButton>
            ))}
          </div>
          <LcarsTextBar>
            CREDITS {Math.floor(world.resources.credits)} / MATERIALS{' '}
            {Number(base.stock.materials.toFixed(1))}
          </LcarsTextBar>
          {tab === 'COMMAND' && (
            <>
              <p>
                ADMIRAL / {world.ships.length} SHIPS · {world.systems.length} KNOWN SYSTEMS · BORDER
                TENSION {Math.round(world.tension)}
              </p>
              <p>
                基地资源来自真实前沿物流；殖民地以 Credits
                预算为核心产出。后方贸易需要付费并实际交付。
              </p>
              {world.ships.map((s) => (
                <LcarsButton
                  key={s.id}
                  shape="rail"
                  className="record-row"
                  onClick={() => select({ type: 'ship', id: s.id })}
                >
                  {s.name} · {s.current ? ACTION_LABELS[s.current.action.type] : 'AVAILABLE'} ·
                  QUEUE {s.queue.length}
                </LcarsButton>
              ))}
            </>
          )}
          {tab === 'SHIPYARD' && (
            <>
              {upgrade('shipyard')}
              <LcarsField>
                舰级
                <select
                  aria-label="建造舰级"
                  value={classId}
                  onChange={(e) => setClassId(e.target.value as typeof classId)}
                >
                  {Object.entries(BUILD_COSTS).map(([id, c]) => (
                    <option key={id} value={id}>
                      {SHIP_CLASSES[id as ShipClassId].name} ·{' '}
                      {world.production.ships[id].actual.credits} 预算 /{' '}
                      {world.production.ships[id].actual.materials} 材料
                    </option>
                  ))}
                </select>
              </LcarsField>
              <ProductionPrice
                original={world.production.ships[classId].original}
                actual={world.production.ships[classId].actual}
                discounted={world.production.discounted}
              />
              <LcarsField>
                VESSEL NAME
                <input
                  aria-label="新舰名称"
                  value={shipName}
                  onChange={(e) => setShipName(e.target.value)}
                />
              </LcarsField>
              <LcarsButton
                onClick={() =>
                  command({ type: 'buildShip', classId, name: shipName, locationId: base.id })
                }
              >
                建造新舰
              </LcarsButton>
              {world.jobs
                .filter(
                  (j) =>
                    j.locationId === base.id && j.kind === 'ship' && !j.complete && !j.cancelled,
                )
                .map((j) => (
                  <WorkProgress
                    key={j.id}
                    label={j.name}
                    work={j.work}
                    duration={j.duration}
                    paused={world.paused}
                  />
                ))}
              <p>新舰空弹舱交付；在 Armory 装载真实弹药。最低舰级始终可建。</p>
            </>
          )}
          {tab === 'DRYDOCK' && (
            <>
              {pickShip}
              <p>维修消耗现场 Materials，恢复血量、推进系统和武器系统；可途中改令。</p>
              <LcarsButton onClick={() => launch('REPAIR', shipId)}>Dock & Repair</LcarsButton>
            </>
          )}
          {tab === 'ARMORY' && (
            <>
              {upgrade('armory')}
              <p>
                PHOTON {base.stock.photon} / QUANTUM {base.stock.quantum} · 实物弹药
              </p>
              {pickShip}
              <LcarsButton onClick={() => launch('REARM', shipId)}>指定数量装弹</LcarsButton>
            </>
          )}
          {tab === 'ENGINEERING' && (
            <>
              {pickShip}
              <LcarsField>
                MODULE
                <select
                  aria-label="基地模块"
                  value={moduleId}
                  onChange={(e) => setModuleId(e.target.value as ModuleId)}
                >
                  {Object.entries(MODULES).map(([k, m]) => (
                    <option key={k} value={k}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </LcarsField>
              <p>{MODULES[moduleId].description}</p>
              {ship?.current?.action.type === 'REFIT' && (
                <>
                  <p>
                    {ship.current.phase === 'refitting' ? '现场改装' : '前往基地或等待实物库存'}
                  </p>
                  <WorkProgress
                    label="模块改装"
                    work={ship.current.work}
                    duration={10}
                    paused={world.paused}
                  />
                </>
              )}
              <p>
                {MODULES[moduleId].cost.credits}C / {MODULES[moduleId].cost.materials}M /{' '}
                {MODULES[moduleId].cost.specialFinds} Special Finds · SLOTS{' '}
                {ship?.modules.length ?? 0}/{ship ? capabilities(ship).moduleSlots : 0}
              </p>
              <LcarsButton
                onClick={() =>
                  create({
                    shipId,
                    action: { type: 'REFIT', targetId: base.id, moduleId, remove: false },
                  })
                }
              >
                安装 / 调整模块
              </LcarsButton>
            </>
          )}
          {tab === 'LOGISTICS' && (
            <>
              {upgrade('logistics')}
              <TradeView world={world} command={command} />
              <LcarsTextBar>ACTUAL BASE INVENTORY</LcarsTextBar>
              {Object.entries(base.stock).map(([k, v]) => (
                <p key={k}>
                  {k.toUpperCase()} {Number(v.toFixed(1))}
                </p>
              ))}
              <LcarsButton onClick={() => launch('HAUL')}>规划真实货运 / 循环航线</LcarsButton>
              <LcarsField>
                EXPORT
                <select
                  aria-label="出口货种"
                  value={saleKind}
                  onChange={(e) => setSaleKind(e.target.value as CargoKind)}
                >
                  {Object.keys(base.stock).map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </LcarsField>
              <LcarsButton
                onClick={() => command({ type: 'sellStock', cargoKind: saleKind, amount })}
              >
                出口 {amount} / 消耗库存
              </LcarsButton>
            </>
          )}
          {tab === 'SENSOR CONTROL' && (
            <>
              {upgrade('sensors')}
              <p>
                {world.systems.length} SYSTEMS / {world.bodies.length} KNOWN BODIES /{' '}
                {world.contacts.length} CONTACTS
              </p>
              <LcarsButton onClick={() => launch('EXPLORE')}>Explore UNKNOWN SPACE</LcarsButton>
              <LcarsButton onClick={() => launch('SURVEY')}>Remote / Close / Deep Scan</LcarsButton>
            </>
          )}
          {tab === 'DEFENSE GRID' && (
            <>
              {upgrade('defense')}
              {world.locations
                .filter((l) => l.owner === 'starfleet')
                .map((l) => (
                  <LcarsButton
                    key={l.id}
                    shape="rail"
                    className="record-row"
                    onClick={() => select({ type: 'location', id: l.id })}
                  >
                    {l.name} · SHIELD {Math.ceil(l.shield)} / {l.maxShield} · 血量{' '}
                    {Math.ceil(l.hull)}
                  </LcarsButton>
                ))}
            </>
          )}
          {tab === 'ARMORY' && (
            <>
              <LcarsTextBar>INDUSTRY / PHYSICAL OUTPUT</LcarsTextBar>
              <LcarsField>
                RECIPE
                <select
                  aria-label="制造资源"
                  value={goods}
                  onChange={(e) => setGoods(e.target.value as typeof goods)}
                >
                  <option value="photon">
                    光子鱼雷／每枚 {world.production.ammunition.photon.actual.materials} 材料 +{' '}
                    {world.production.ammunition.photon.actual.credits} 预算
                  </option>
                  <option value="quantum">
                    量子鱼雷／每枚 {world.production.ammunition.quantum.actual.materials} 材料 +{' '}
                    {world.production.ammunition.quantum.actual.credits} 预算
                  </option>
                </select>
              </LcarsField>
              <ProductionPrice
                original={world.production.ammunition[goods].original}
                actual={world.production.ammunition[goods].actual}
                discounted={world.production.discounted}
                amount={amount}
              />
              <LcarsField>
                QUANTITY
                <input
                  aria-label="工业数量"
                  type="number"
                  min="1"
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                />
              </LcarsField>
              <LcarsButton
                disabled={!Number.isInteger(amount) || amount < 1}
                onClick={() =>
                  command({ type: 'manufacture', cargoKind: goods, amount, locationId: base.id })
                }
              >
                开始实物制造
              </LcarsButton>
              {world.jobs
                .filter(
                  (j) =>
                    j.locationId === base.id &&
                    j.kind === 'manufacture' &&
                    !j.complete &&
                    !j.cancelled,
                )
                .map((j) => (
                  <WorkProgress
                    key={j.id}
                    label={j.name}
                    work={j.work}
                    duration={j.duration}
                    paused={world.paused}
                  />
                ))}
            </>
          )}
          <LcarsTextBar>SHIPYARD / INDUSTRY QUEUE</LcarsTextBar>
          {world.jobs
            .filter((j) => j.locationId === base.id && !j.complete && !j.cancelled)
            .map((j) => (
              <WorkProgress
                key={j.id}
                label={j.name}
                work={j.work}
                duration={j.duration}
                paused={world.paused}
              />
            ))}
        </>
      )}
      {page === 'OPERATIONS' && (
        <>
          <EventsView world={world} command={command} create={create} />
          <LcarsTextBar>世界机会与当前原因</LcarsTextBar>
          <div className="inline-actions">
            {(['EXPLORE', 'SURVEY', 'HAUL', 'PATROL'] as const).map((t) => (
              <LcarsButton key={t} onClick={() => launch(t)}>
                {ACTION_LABELS[t]}
              </LcarsButton>
            ))}
          </div>
          {world.opportunities.map((o) => (
            <LcarsButton
              key={o.id}
              shape="rail"
              className="record-row"
              onClick={() => {
                const type = world.bodies.some((b) => b.id === o.targetId)
                  ? 'body'
                  : world.projects.some((p) => p.id === o.targetId)
                    ? 'project'
                    : world.locations.some((l) => l.id === o.targetId)
                      ? 'location'
                      : world.contacts.some((c) => c.id === o.targetId)
                        ? 'contact'
                        : null;
                if (type) select({ type, id: o.targetId });
                else {
                  const parts = o.targetId.split(':');
                  select({ type: 'sector', q: Number(parts[1]), r: Number(parts[2]) });
                }
              }}
            >
              {o.kind.toUpperCase()} · {o.text}
            </LcarsButton>
          ))}
        </>
      )}
      {page === 'PERSONNEL' && <PersonnelView world={world} command={command} />}
      {page === 'COLONIES' && (
        <>
          <LcarsTextBar>FRONTIER / COLONIES / MINES / OUTPOSTS</LcarsTextBar>
          {world.locations
            .filter((l) => l.owner === 'starfleet' && l.id !== 'base')
            .map((l) => (
              <LcarsButton
                key={l.id}
                data-entity-id={l.id}
                shape="rail"
                className="record-row"
                onClick={() => select({ type: 'location', id: l.id })}
              >
                {l.name} / {l.kind} · MATERIALS {Math.floor(l.stock.materials)}
              </LcarsButton>
            ))}
          <LcarsTextBar>CONSTRUCTION PROJECTS</LcarsTextBar>
          {world.projects.map((p) => (
            <LcarsButton
              key={p.id}
              data-entity-id={p.id}
              shape="rail"
              className="record-row"
              onClick={() => select({ type: 'project', id: p.id })}
            >
              {p.name} · {p.complete ? 'COMPLETE' : Math.floor(p.work) + '/' + p.duration + 'm'} · M{' '}
              {Math.floor(p.stock.materials)}/{p.cost.materials}
            </LcarsButton>
          ))}
          <p>在星图选择已调查资源点／系统／宜居星球建立新设施。</p>
        </>
      )}
      {page === 'ARCHIVE' && (
        <>
          <div className="inline-actions">
            <LcarsButton onClick={save}>立即保存</LcarsButton>
            <LcarsButton
              disabled={timeline.previousDay === null}
              onClick={() => command({ type: 'restorePreviousDay' })}
            >
              从昨日建立独立时间线
            </LcarsButton>
            <LcarsButton tone="danger" onClick={newFrontier}>
              BEGIN NEW FRONTIER
            </LcarsButton>
          </div>
          <LcarsTextBar>PERMANENT LOSSES / {world.losses.length}</LcarsTextBar>
          {world.losses.map((l) => (
            <LcarsButton
              key={l.shipId}
              shape="rail"
              className="record-row"
              onClick={() => select({ type: 'loss', id: l.shipId })}
            >
              {l.name} · {l.reason}
            </LcarsButton>
          ))}
          <LcarsTextBar>TIMELINES</LcarsTextBar>
          {timeline.branches.map((b) => (
            <p key={b.id}>
              {b.id} / {b.status} / {b.lossCount} LOSSES
            </p>
          ))}
          <LcarsTextBar>PERSISTENT FRONTIER HISTORY / {world.history.length}</LcarsTextBar>
          {[...world.history].reverse().map((h) => (
            <p key={h.id}>
              <small>
                {Math.floor(h.time)}m / {h.kind}
              </small>{' '}
              {h.text}
            </p>
          ))}
        </>
      )}
    </LcarsDrawer>
  );
}
