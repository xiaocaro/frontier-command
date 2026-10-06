import { ContextGuidance } from './ui/ContextGuidance';
import { ContactAlert } from './ui/ContactAlert';
import { useState, useEffect, useRef } from 'react';
import { useFrontier } from './ui/hooks/useFrontier';
import { StrategicMap, type Selection } from './StrategicMap';
import { Inspector } from './ui/Inspector';
import { OrderComposer, type ComposerRequest } from './ui/OrderComposer';
import { LcarsShell } from './ui/components/LcarsShell';
import { LcarsDialog, LcarsButton, LcarsFrame } from './ui/components/Lcars';
import { CommandLost } from './ui/CommandLost';
import { ManagementDrawer } from './ui/ManagementDrawer';
import type { Point } from './engine/types';
import type { Page } from './ui/types';
import { sectorCenter } from './engine/world-generation';
import { ConsoleSettings } from './ui/lcars/ConsoleSettings';
import { WorldFeedback } from './ui/lcars/WorldFeedback';
import { worldText } from './ui/localization';
export function App() {
  const { world, timeline, notice, command, save, reset, dismissNotice } = useFrontier();
  const [page, setPage] = useState<Page>('SECTOR'),
    [selection, setSelection] = useState<Selection | null>({ type: 'location', id: 'base' });
  const [focus, setFocus] = useState<{ point: Point; serial: number } | null>(null);
  const [selectedShipIds, setSelectedShipIds] = useState<string[]>([]);
  const [followShipId, setFollowShipId] = useState<string | null>(null);
  const followedShip = useRef(followShipId);
  followedShip.current = followShipId;
  const selectedShips = useRef(selectedShipIds);
  selectedShips.current = selectedShipIds;
  const [composer, setComposer] = useState<ComposerRequest | null>(null),
    [confirmReset, setConfirmReset] = useState(false),
    [settings, setSettings] = useState(false);
  const [commandTarget, setCommandTarget] = useState<Selection | null>(null),
    [destination, setDestination] = useState<Point | null>(null),
    [moveMode, setMoveMode] = useState<'REPLACE' | 'QUEUE' | 'INTERRUPT'>('REPLACE');
  useEffect(() => {
    const cancel = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDestination(null);
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);
  useEffect(() => {
    if (!world) return;
    setSelectedShipIds((ids) => {
      const alive = ids.filter((id) => world.ships.some((s) => s.id === id));
      return alive.length === ids.length ? ids : alive;
    });
  }, [world]);
  useEffect(
    () =>
      window.frontier.onEvents((events) => {
        if (
          followedShip.current === selectedShips.current[0] &&
          !events.some((e) => e.shipId === followedShip.current)
        )
          return;
        const event =
          events.find((e) => e.shipId === selectedShips.current[0]) ??
          events.find((e) => selectedShips.current.includes(e.shipId)) ??
          events[0];
        if (event) {
          setFollowShipId(event.shipId);
          setFocus((f) => ({ point: event.destination, serial: (f?.serial ?? 0) + 1 }));
        }
      }),
    [timeline.activeId],
  );
  if (!world)
    return (
      <div className="loading">
        <LcarsFrame title="ESTABLISHING COMMAND LINK">
          <h1>FRONTIER COMMAND</h1>
          <p>正在连接 DAWN STARBASE…</p>
        </LcarsFrame>
      </div>
    );
  const select = (s: Selection, locate = false, additive = false) => {
    if (s.type !== 'ship' || s.id !== followShipId) setFollowShipId(null);
    setSelection(s);
    if (s.type === 'ship' || s.type === 'group') {
      if (s.type === 'ship')
        setSelectedShipIds((ids) =>
          additive
            ? ids.includes(s.id)
              ? ids.filter((id) => id !== s.id)
              : [...ids, s.id]
            : [s.id],
        );
      else setSelectedShipIds([...(world.groups.find((g) => g.id === s.id)?.shipIds ?? [])]);
      setCommandTarget(s);
      setDestination(null);
    }
    if (s.type === 'point') setDestination({ x: s.x, y: s.y });
    if (!locate) return;
    const p =
      s.type === 'siteContact'
        ? world.siteContacts.find((x) => x.id === s.id)
        : s.type === 'group'
          ? world.ships.find((x) => x.id === world.groups.find((g) => g.id === s.id)?.flagshipId)
          : s.type === 'wormhole'
            ? world.wormholes.find((x) => x.id === s.id)
            : s.type === 'civilian'
              ? world.civilians.find((x) => x.id === s.id)
              : s.type === 'event'
                ? world.locations.find(
                    (x) => x.id === world.events.find((v) => v.id === s.id)?.subjectId,
                  )
                : s.type === 'point'
                  ? s
                  : s.type === 'sector'
                    ? sectorCenter(s)
                    : s.type === 'ship'
                      ? world.ships.find((x) => x.id === s.id)
                      : s.type === 'location'
                        ? world.locations.find((x) => x.id === s.id)
                        : s.type === 'contact'
                          ? world.contacts.find((x) => x.id === s.id)
                          : s.type === 'system'
                            ? world.systems.find((x) => x.id === s.id)
                            : s.type === 'body'
                              ? world.bodies.find((x) => x.id === s.id)
                              : s.type === 'project'
                                ? world.projects.find((x) => x.id === s.id)
                                : s.type === 'wreck'
                                  ? world.wrecks.find((x) => x.id === s.id)
                                  : world.losses.find((x) => x.shipId === s.id)?.position;
    if (p) setFocus((f) => ({ point: { x: p.x, y: p.y }, serial: (f?.serial ?? 0) + 1 }));
  };
  const locate = (id: string | null, additive = false) => {
    if (!id) return;
    const type = world.siteContacts.some((x) => x.id === id)
      ? 'siteContact'
      : world.events.some((x) => x.id === id)
        ? 'event'
        : world.wormholes.some((x) => x.id === id)
          ? 'wormhole'
          : world.civilians.some((x) => x.id === id)
            ? 'civilian'
            : world.ships.some((x) => x.id === id)
              ? 'ship'
              : world.locations.some((x) => x.id === id)
                ? 'location'
                : world.systems.some((x) => x.id === id)
                  ? 'system'
                  : world.bodies.some((x) => x.id === id)
                    ? 'body'
                    : world.projects.some((x) => x.id === id)
                      ? 'project'
                      : world.wrecks.some((x) => x.id === id)
                        ? 'wreck'
                        : world.losses.some((x) => x.shipId === id)
                          ? 'loss'
                          : 'contact';
    select({ type, id }, true, additive);
  };
  const changedWorld = () => {
    setSelection({ type: 'location', id: 'base' });
    setPage('SECTOR');
    setComposer(null);
    setSettings(false);
    setFocus(null);
    setDestination(null);
    setCommandTarget(null);
    setSelectedShipIds([]);
    setFollowShipId(null);
  };
  const openComposer = (request: ComposerRequest) => {
    if (request.shipId || request.groupId || request.shipIds) {
      setComposer(request);
      return;
    }
    const groupId =
      commandTarget?.type === 'group' &&
      ['MOVE', 'HAUL', 'PATROL', 'ESCORT', 'INTERCEPT', 'RETREAT', 'RETURN'].includes(
        request.action.type,
      )
        ? commandTarget.id
        : undefined;
    setComposer({
      ...request,
      groupId,
      shipIds: selectedShipIds.length ? [...selectedShipIds] : undefined,
    });
  };
  const serial =
    selection?.type === 'point'
      ? 'point:' + selection.x + ':' + selection.y
      : selection?.type === 'sector'
        ? 'sector:' + selection.q + ':' + selection.r
        : selection?.type + ':' + selection?.id;
  return (
    <>
      <WorldFeedback world={world} branch={timeline.activeId} />
      <LcarsShell
        world={world}
        page={page}
        onPage={(next) => {
          setSettings(false);
          setPage(next);
        }}
        command={command}
        locate={locate}
        contextSerial={serial}
        selectedShipIds={selectedShipIds}
        onSettings={() => setSettings(true)}
        overlay={
          settings ? (
            <ConsoleSettings close={() => setSettings(false)} />
          ) : (
            page !== 'SECTOR' && (
              <ManagementDrawer
                page={page}
                world={world}
                timeline={timeline}
                close={() => setPage('SECTOR')}
                select={(s) => {
                  select(s, true);
                  setPage('SECTOR');
                }}
                create={openComposer}
                command={command}
                save={save}
                newFrontier={() => setConfirmReset(true)}
              />
            )
          )
        }
        inspector={
          <>
            <ContextGuidance
              world={world}
              selection={selection}
              selectedShipIds={selectedShipIds}
              create={openComposer}
              select={select}
            />
            <Inspector
              world={world}
              selection={selection}
              selectedShipIds={selectedShipIds}
              select={select}
              command={command}
              create={openComposer}
            />
          </>
        }
      >
        {destination && selectedShipIds.length > 0 && (
          <div className="map-command-point">
            <b>
              目的点 {destination.x}, {destination.y} · {selectedShipIds.length} 艘已选舰船
            </b>
            <select
              aria-label="地图移动模式"
              value={moveMode}
              onChange={(e) => setMoveMode(e.target.value as typeof moveMode)}
            >
              <option value="REPLACE">替换</option>
              <option value="QUEUE">排队</option>
              <option value="INTERRUPT">中断后接续</option>
            </select>
            <LcarsButton
              onClick={async () => {
                const action = { type: 'MOVE' as const, point: destination };
                const r = await command(
                  commandTarget?.type === 'group'
                    ? {
                        type: 'issueGroupDirective',
                        groupId: commandTarget.id,
                        mode: moveMode,
                        action,
                      }
                    : {
                        type: 'issueDirective',
                        shipIds: selectedShipIds,
                        mode: moveMode,
                        action,
                      },
                );
                if (r.ok) setDestination(null);
              }}
            >
              前往此处
            </LcarsButton>
            <LcarsButton tone="secondary" onClick={() => setDestination(null)}>
              取消选点
            </LcarsButton>
          </div>
        )}
        <StrategicMap
          key={timeline.activeId}
          world={world}
          selection={selection}
          destination={destination}
          commandTarget={commandTarget}
          onSelect={(s, additive) => select(s, false, additive)}
          selectedShipIds={selectedShipIds}
          command={command}
          followShipId={followShipId}
          onManualCamera={() => setFollowShipId(null)}
          focus={focus}
        />
      </LcarsShell>
      {world.status === 'commandLost' &&
        page !== 'ARCHIVE' &&
        selection?.type !== 'loss' &&
        !confirmReset && (
          <CommandLost
            world={world}
            timeline={timeline}
            command={command}
            onRestored={changedWorld}
            onNewFrontier={() => setConfirmReset(true)}
            onArchive={() => setPage('ARCHIVE')}
          />
        )}
      {composer && world.status === 'active' && (
        <OrderComposer
          world={world}
          request={composer}
          command={command}
          onClose={() => {
            setComposer(null);
            setPage('SECTOR');
          }}
        />
      )}
      {confirmReset && (
        <LcarsDialog
          title="BEGIN NEW FRONTIER"
          label="新世界确认"
          onClose={() => setConfirmReset(false)}
        >
          <h2>开始新的边疆世界</h2>
          <p>保留当前时间线，从 DAY 1 00:00 创建独立的 v10 新世界。</p>
          <div className="dialog-actions">
            <LcarsButton tone="secondary" onClick={() => setConfirmReset(false)}>
              取消
            </LcarsButton>
            <LcarsButton
              onClick={async () => {
                const r = await reset();
                if (r.ok) {
                  setConfirmReset(false);
                  changedWorld();
                }
              }}
            >
              保留记录并创建新世界
            </LcarsButton>
          </div>
        </LcarsDialog>
      )}
      <ContactAlert
        world={world}
        branch={timeline.activeId}
        command={command}
        locate={(id) => {
          setPage('SECTOR');
          locate(id);
        }}
      />
      {notice && (
        <div className={'notification ' + (notice.error ? 'error' : '')} role="status">
          <span>{worldText(world, notice.text)}</span>
          <LcarsButton tone="secondary" onClick={dismissNotice} aria-label="关闭通知">
            关闭
          </LcarsButton>
        </div>
      )}
    </>
  );
}
