import type { CommandSender } from './ui/types';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useLcars } from './ui/lcars/LcarsProvider';
import { MapSymbol, type SymbolKind } from './ui/map/MapSymbol';
import { LcarsButton } from './ui/components/Lcars';
import { MAP_PALETTE, MAP_LEGEND, bodyColor, facilityColor } from './ui/map/palette';
import type { Point, Snapshot } from './engine/types';
import { SECTOR_SIZE, regionAt } from './engine/definitions/locations';
import { sectorCenter } from './engine/world-generation';
import { capabilities } from './engine/capabilities';
import {
  boundsOf,
  fitCamera,
  clampCamera,
  zoomCamera,
  resizeCamera,
  focusCamera,
  project,
  unproject,
  placeLabels,
  viewportGrid,
  clusterMarkers,
  type Camera,
  type MapLabel,
} from './ui/map/camera';
export type Selection =
  | {
      type:
        | 'ship'
        | 'location'
        | 'contact'
        | 'system'
        | 'body'
        | 'project'
        | 'wreck'
        | 'loss'
        | 'group'
        | 'event'
        | 'wormhole'
        | 'civilian'
        | 'siteContact';
      id: string;
    }
  | { type: 'point'; x: number; y: number }
  | { type: 'sector'; q: number; r: number };
export function StrategicMap({
  world,
  selection,
  onSelect,
  focus,
  destination,
  commandTarget,
  selectedShipIds,
  command,
  followShipId,
  onManualCamera,
}: {
  destination: Point | null;
  commandTarget: Selection | null;
  world: Snapshot;
  selection: Selection | null;
  onSelect: (s: Selection, additive?: boolean) => void;
  selectedShipIds: string[];
  command: CommandSender;
  followShipId: string | null;
  onManualCamera: () => void;
  focus: { point: Point; serial: number } | null;
}) {
  const { preferences, audio } = useLcars(),
    motion = useRef(preferences.animations);
  motion.current = preferences.animations;
  const viewport = useRef<HTMLDivElement>(null),
    svg = useRef<SVGSVGElement>(null),
    initialized = useRef(false);
  const [contextMenu, setContextMenu] = useState<{
    id: string;
    name: string;
    x: number;
    y: number;
  } | null>(null);
  const menuElement = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [labelFont, setLabelFont] = useState(18);
  const [fontVersion, setFontVersion] = useState(0);
  const measurement = useRef<CanvasRenderingContext2D | null>(null);
  useEffect(() => {
    let alive = true;
    void document.fonts.ready.then(() => {
      if (alive) {
        measurement.current = document.createElement('canvas').getContext('2d');
        setFontVersion((v) => v + 1);
      }
    });
    return () => {
      alive = false;
    };
  }, []);
  useLayoutEffect(() => {
    setLabelFont(parseFloat(getComputedStyle(document.documentElement).fontSize));
  }, [preferences.textScale]);
  const known = () => [...world.locations, ...world.systems];
  const [camera, setCamera] = useState(() => fitCamera(1, 1, boundsOf(known()))),
    current = useRef(camera),
    target = useRef(camera),
    frame = useRef(0);
  const [layers, setLayers] = useState({ Routes: true, Sensors: false, Intelligence: true });
  useLayoutEffect(() => {
    if (!contextMenu || !menuElement.current) return;
    const bounds = menuElement.current.getBoundingClientRect(),
      margin = labelFont * 0.5;
    setMenuPosition({
      x: Math.max(margin, Math.min(contextMenu.x, innerWidth - bounds.width - margin)),
      y: Math.max(margin, Math.min(contextMenu.y, innerHeight - bounds.height - margin)),
    });
  }, [contextMenu, labelFont, camera.width, camera.height]);
  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [contextMenu]);
  const drag = useRef<{ point: Point; camera: Camera } | null>(null),
    moved = useRef(false);
  const commit = (c: Camera) => {
    current.current = c;
    target.current = c;
    setCamera(c);
  };
  const local = (x: number, y: number) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: x - r.left, y: y - r.top };
  };
  const animate = (next: Camera) => {
    cancelAnimationFrame(frame.current);
    target.current = next;
    if (motion.current !== 'on') {
      commit(next);
      return;
    }
    const start = current.current,
      started = performance.now();
    const tick = () => {
      const t = target.current,
        progress = Math.min(1, (performance.now() - started) / 180),
        ease = 1 - (1 - progress) ** 3;
      if (progress === 1 || motion.current !== 'on') {
        commit(t);
        return;
      }
      const n = clampCamera({
        ...t,
        k: start.k + (t.k - start.k) * ease,
        x: start.x + (t.x - start.x) * ease,
        y: start.y + (t.y - start.y) * ease,
      });
      current.current = n;
      setCamera(n);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  useLayoutEffect(() => {
    const el = viewport.current!;
    const update = () => {
      cancelAnimationFrame(frame.current);
      const next = initialized.current
        ? resizeCamera(current.current, el.clientWidth, el.clientHeight)
        : fitCamera(el.clientWidth, el.clientHeight, boundsOf(known()));
      initialized.current = true;
      commit(next);
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, []);
  useEffect(() => {
    if (focus) animate(focusCamera(current.current, focus.point));
  }, [focus]);
  useEffect(() => {
    const ship = world.ships.find((s) => s.id === followShipId);
    if (ship) {
      cancelAnimationFrame(frame.current);
      commit({ ...current.current, x: ship.x, y: ship.y, k: Math.max(0.85, current.current.k) });
    }
  }, [followShipId, world.time]);
  useEffect(() => {
    const el = svg.current!,
      wheel = (e: WheelEvent) => {
        e.preventDefault();
        onManualCamera();
        setContextMenu(null);
        animate(
          zoomCamera(
            target.current,
            target.current.k * Math.exp(-e.deltaY * 0.0015),
            local(e.clientX, e.clientY),
          ),
        );
      };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  const active = (id: string) =>
      selectedShipIds.includes(id) ||
      (selection && selection.type !== 'ship' && 'id' in selection && selection.id === id),
    level =
      camera.k < 0.15
        ? 'OVERVIEW'
        : camera.k < 0.65
          ? 'SECTOR'
          : camera.k < 1.5
            ? 'SYSTEM'
            : 'LOCAL',
    pos = (p: Point) => project(p, camera);
  const visible = (p: Point) => {
    const n = pos(p);
    return n.x >= -35 && n.y >= -35 && n.x <= camera.width + 35 && n.y <= camera.height + 35;
  };
  const interactive = (s: Selection, name: string) => ({
    role: 'button',
    tabIndex: 0,
    'aria-label': name,
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      moved.current = false;
    },
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!moved.current) {
        audio.play('navigation');
        onSelect(s, e.ctrlKey);
      }
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (
        s.type === 'wreck' ||
        (s.type === 'body' && world.bodies.some((b) => b.id === s.id && b.kind === 'derelict'))
      ) {
        setContextMenu({
          id: s.id,
          name,
          x: e.clientX,
          y: e.clientY,
        });
      }
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        audio.play('navigation');
        onSelect(s);
      }
    },
  });
  type Marker = {
    id: string;
    name: string;
    p: Point;
    selection: Selection;
    kind: SymbolKind;
    color: string;
    cloak?: 'off' | 'on' | 'decloaking';
    clusterCount?: number;
  };
  const rawMarkers: Marker[] = [
    ...world.systems.filter(visible).map((s) => ({
      id: s.id,
      name: s.name,
      p: s,
      selection: { type: 'system', id: s.id } as Selection,
      kind: 'system' as const,
      color: MAP_PALETTE.system,
    })),
    ...world.bodies
      .filter(
        (b) =>
          visible(b) &&
          !world.mapMarkers.dismissedIds.includes(b.id) &&
          (b.kind === 'derelict' || level === 'LOCAL' || active(b.id) || active(b.systemId)) &&
          (!world.locations.some((l) => l.siteId === b.id) || active(b.id)),
      )
      .map((b) => ({
        id: b.id,
        name: b.name,
        p: b,
        selection: { type: 'body', id: b.id } as Selection,
        kind: b.kind,
        color: bodyColor(b),
      })),
    ...world.locations.filter(visible).map((l) => ({
      id: l.id,
      name: l.name,
      p: l,
      selection: { type: 'location', id: l.id } as Selection,
      kind: l.kind,
      color: facilityColor(l.id, l.owner, l.kind),
    })),
    ...world.projects
      .filter((p) => !p.complete && visible(p))
      .map((p) => ({
        id: p.id,
        name: p.name,
        p,
        selection: { type: 'project', id: p.id } as Selection,
        kind: 'project' as const,
        color: MAP_PALETTE.project,
      })),
    ...world.wrecks
      .filter(
        (w) =>
          visible(w) &&
          !world.mapMarkers.dismissedIds.includes(w.id) &&
          (level === 'LOCAL' ||
            !world.bodies.some(
              (b) => b.kind === 'derelict' && Math.hypot(b.x - w.x, b.y - w.y) < 1,
            )),
      )
      .map((p) => ({
        id: p.id,
        name: p.name,
        p,
        selection: { type: 'wreck', id: p.id } as Selection,
        kind: 'wreck' as const,
        color: MAP_PALETTE.wreck,
      })),
    ...world.ships
      .filter(
        (s) =>
          visible(s) &&
          (level === 'LOCAL' ||
            active(s.id) ||
            s.current ||
            !world.locations.some(
              (l) => l.owner === 'starfleet' && Math.hypot(l.x - s.x, l.y - s.y) < 90,
            )),
      )
      .map((s) => ({
        id: s.id,
        name: s.name,
        p: s,
        selection: { type: 'ship', id: s.id } as Selection,
        kind: s.classId === 'antares' ? ('freighter' as const) : ('ship' as const),
        color: MAP_PALETTE.factions.starfleet,
        cloak: s.cloak,
      })),
    ...world.wormholes.filter(visible).map((w) => ({
      id: w.id,
      name: w.name,
      p: w,
      selection: { type: 'wormhole', id: w.id } as Selection,
      kind: 'wormhole' as const,
      color: MAP_PALETTE.wormhole,
    })),
    ...world.civilians.filter(visible).map((s) => ({
      id: s.id,
      name: s.name,
      p: s,
      selection: { type: 'civilian', id: s.id } as Selection,
      kind: 'freighter' as const,
      color: MAP_PALETTE.civilian,
    })),
    ...world.contacts
      .filter((c) => visible(c) && (c.live || layers.Intelligence))
      .map((c) => ({
        id: c.id,
        name: (c.live ? '' : 'LKP ') + (c.name ?? c.level),
        p: c,
        selection: { type: 'contact', id: c.id } as Selection,
        kind: c.classId ? ('ship' as const) : ('contact' as const),
        color: c.factionId ? MAP_PALETTE.factions[c.factionId] : MAP_PALETTE.unknown,
      })),
    ...world.siteContacts.filter(visible).map((c) => ({
      id: c.id,
      name: 'UNCONFIRMED SITE / 未确认设施',
      p: c,
      selection: { type: 'siteContact', id: c.id } as Selection,
      kind: 'contact' as const,
      color: MAP_PALETTE.unknown,
    })),
  ];
  const markers: Marker[] =
    level === 'OVERVIEW'
      ? clusterMarkers(rawMarkers, camera, (id) => !!active(id)).map((group) => {
          if (group.length === 1) return group[0];
          const p = {
            x: group.reduce((n, m) => n + m.p.x, 0) / group.length,
            y: group.reduce((n, m) => n + m.p.y, 0) / group.length,
          };
          return {
            id: 'cluster:' + group[0].id,
            name: group.length + ' 个对象／点击展开',
            p,
            selection: { type: 'point' as const, ...p },
            kind: 'system' as const,
            color: MAP_PALETTE.decoration.charted,
            clusterCount: group.length,
          };
        })
      : rawMarkers;
  const markerScale = Math.min(1.5, Math.max(1, camera.width / 1500));
  const displayPositions = new Map<string, Point>();
  const occupiedMarkers: Point[] = [];
  for (const m of [...markers].sort(
    (a, b) =>
      Number(active(b.id)) - Number(active(a.id)) ||
      Number(b.id === 'base') - Number(a.id === 'base') ||
      a.id.localeCompare(b.id),
  )) {
    const point = pos(m.p);
    let shown = point;
    for (let ring = 0; ring < 8; ring++) {
      const angle = (ring * Math.PI) / 4,
        candidate =
          ring === 0
            ? point
            : {
                x: point.x + Math.cos(angle) * 42 * markerScale,
                y: point.y + Math.sin(angle) * 42 * markerScale,
              };
      if (
        !occupiedMarkers.some(
          (p) => Math.hypot(p.x - candidate.x, p.y - candidate.y) < 34 * markerScale,
        )
      ) {
        shown = candidate;
        break;
      }
    }
    displayPositions.set(m.id, shown);
    occupiedMarkers.push(shown);
  }
  const measure = (text: string) => {
    const context = measurement.current;
    if (context) {
      context.font = `400 ${labelFont * markerScale}px Antonio, "Alibaba PuHuiTi", sans-serif`;
      return context.measureText(text).width + 8 * markerScale;
    }
    return [...text].reduce(
      (n, ch) => n + (/[\u2e80-\uffff]/.test(ch) ? labelFont : labelFont * 0.48) * markerScale,
      8,
    );
  };
  const labels: MapLabel[] = markers.map((m) => {
    let text = m.name.split(' / ')[0];
    const maximum = Math.min(labelFont * 24, camera.width * 0.55);
    if (measure(text) > maximum) {
      while (text.length > 1 && measure(text + '…') > maximum) text = text.slice(0, -1);
      text += '…';
    }
    return {
      ...displayPositions.get(m.id)!,
      id: m.id,
      text,
      width: measure(text),
      height: labelFont * 1.35 * markerScale,
      priority: active(m.id)
        ? 110
        : world.contacts.some((c) => c.id === m.id && c.hostile)
          ? 105
          : m.id === 'base'
            ? 100
            : m.selection.type === 'ship'
              ? 85
              : m.selection.type === 'location'
                ? 70
                : m.kind === 'wormhole'
                  ? 65
                  : m.kind === 'system'
                    ? 35
                    : 25,
      color: m.color,
    };
  });
  const cells = viewportGrid(camera, world.sectors);
  const obstacles = occupiedMarkers.map((p) => ({
    x: p.x - 18 * markerScale,
    y: p.y - 18 * markerScale,
    width: 36 * markerScale,
    height: 36 * markerScale,
  }));
  for (const c of cells) {
    const point = pos({ x: (c.q + (c.span - 1) / 2) * 400, y: c.r * 400 - 200 });
    if (SECTOR_SIZE * c.span * camera.k > labelFont * markerScale * 12)
      obstacles.push({ x: point.x - 110, y: point.y + 12, width: 220, height: 22 * markerScale });
  }
  const placed = placeLabels(
    labels,
    camera.width,
    camera.height,
    markerScale,
    obstacles,
    labelFont * markerScale,
  );
  return (
    <section
      className="map-container"
      aria-label="Strategic Map workspace"
      data-font-version={fontVersion}
      style={
        {
          '--map-label-size': markerScale + 'rem',
          '--map-region-size': 1.2 * markerScale + 'rem',
        } as CSSProperties
      }
    >
      <div className="map-toolbar">
        <span>
          STRATEGIC MAP 战略星图 <b>{level}</b>
        </span>
        <div className="layers">
          {Object.entries(layers).map(([name, on]) => (
            <LcarsButton
              key={name}
              sound="navigation"
              aria-pressed={on}
              onClick={() => setLayers({ ...layers, [name]: !on })}
            >
              {name}
            </LcarsButton>
          ))}
        </div>
      </div>
      <div className="map-viewport" ref={viewport}>
        <svg
          ref={svg}
          className="strategic-map"
          aria-label="战略星图"
          viewBox={'0 0 ' + camera.width + ' ' + camera.height}
          data-follow-ship-id={followShipId ?? ''}
          data-view={JSON.stringify(camera)}
          data-level={level}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            cancelAnimationFrame(frame.current);
            moved.current = false;
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { point: local(e.clientX, e.clientY), camera: current.current };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const p = local(e.clientX, e.clientY);
            if (Math.hypot(p.x - d.point.x, p.y - d.point.y) > 5) {
              moved.current = true;
              onManualCamera();
              setContextMenu(null);
              commit({
                ...d.camera,
                x: d.camera.x - (p.x - d.point.x) / d.camera.k,
                y: d.camera.y - (p.y - d.point.y) / d.camera.k,
              });
            }
          }}
          onPointerUp={(e) => {
            drag.current = null;
            if (svg.current?.hasPointerCapture(e.pointerId))
              svg.current.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onClick={(e) => {
            if (moved.current) return;
            const p = unproject(local(e.clientX, e.clientY), camera);
            onSelect({ type: 'point', x: Math.round(p.x), y: Math.round(p.y) });
          }}
        >
          <rect width={camera.width} height={camera.height} fill={MAP_PALETTE.decoration.ink} />
          {cells.map((c) => {
            const center = { x: (c.q + (c.span - 1) / 2) * 400, y: (c.r + (c.span - 1) / 2) * 400 },
              p = pos({ x: c.q * 400 - 200, y: c.r * 400 - 200 }),
              size = SECTOR_SIZE * c.span * camera.k,
              label =
                level === 'SECTOR'
                  ? c.known
                    ? '星区'
                    : '未知'
                  : c.known
                    ? regionAt(center.x, center.y).toUpperCase()
                    : 'UNKNOWN SPACE';
            return (
              <g key={c.q + ':' + c.r}>
                <rect
                  data-grid-span={c.span}
                  x={p.x}
                  y={p.y}
                  width={size}
                  height={size}
                  fill={
                    c.known ? MAP_PALETTE.decoration.charted : MAP_PALETTE.decoration.unknownSpace
                  }
                  fillOpacity={c.known && c.span === 1 ? 0.045 : 0.015}
                  stroke={MAP_PALETTE.decoration.grid}
                  strokeOpacity=".15"
                />
                {size > labelFont * markerScale * 12 && (
                  <text
                    x={p.x + size / 2}
                    y={p.y + 30}
                    textAnchor="middle"
                    fill={MAP_PALETTE.decoration.grid}
                    opacity=".6"
                    className="region-label"
                  >
                    {c.span > 1 ? '星区群' : label} {c.q}/{c.r}
                  </text>
                )}
              </g>
            );
          })}
          {layers.Routes &&
            world.ships
              .filter((s) => s.path.length)
              .map((s) => (
                <polyline
                  key={s.id}
                  points={[s, ...s.path]
                    .map((p) => {
                      const n = pos(p);
                      return n.x + ',' + n.y;
                    })
                    .join(' ')}
                  fill="none"
                  stroke={
                    active(s.id) ? MAP_PALETTE.decoration.selection : MAP_PALETTE.decoration.route
                  }
                  strokeWidth="2"
                  strokeDasharray="7 5"
                  pointerEvents="none"
                />
              ))}
          {(layers.Sensors || level === 'LOCAL') &&
            world.ships.filter(visible).map((s) => {
              const p = pos(s);
              return (
                <circle
                  key={s.id}
                  cx={p.x}
                  cy={p.y}
                  r={capabilities(s).sensors * camera.k}
                  fill={MAP_PALETTE.decoration.sensor}
                  fillOpacity=".025"
                  stroke={MAP_PALETTE.decoration.sensor}
                  strokeOpacity=".2"
                  strokeDasharray="3 6"
                  pointerEvents="none"
                />
              );
            })}
          {markers.map((m) => {
            const p = displayPositions.get(m.id)!;
            return (
              <g
                key={m.id}
                data-entity-id={m.id}
                data-cloak={m.cloak}
                aria-pressed={!!active(m.id)}
                transform={'translate(' + p.x + ' ' + p.y + ') scale(' + markerScale + ')'}
                {...interactive(m.selection, m.name)}
                data-cluster-count={m.clusterCount}
                onClick={
                  m.clusterCount
                    ? (event) => {
                        event.stopPropagation();
                        if (moved.current) return;
                        onManualCamera();
                        animate({
                          ...current.current,
                          x: m.p.x,
                          y: m.p.y,
                          k: Math.max(0.2, current.current.k * 4),
                        });
                      }
                    : interactive(m.selection, m.name).onClick
                }
              >
                <title>
                  {m.name}
                  {m.cloak === 'on' ? ' / 隐形' : m.cloak === 'decloaking' ? ' / 解除中' : ''}
                </title>
                <circle r="17" fill="transparent" />
                {m.cloak && m.cloak !== 'off' && (
                  <g className="cloak-state" data-testid="cloak-marker">
                    <path
                      d="M-23-9L-17-22H17L23-9V14L0 25 -23 14Z"
                      fill="none"
                      stroke={m.color}
                      strokeWidth="2"
                      strokeDasharray={m.cloak === 'on' ? '4 3' : '2 4'}
                    />
                    <text
                      className="cloak-status-label"
                      x="0"
                      y="-30"
                      textAnchor="middle"
                      fill={m.color}
                    >
                      {m.cloak === 'on' ? '隐形' : '解除中'}
                    </text>
                  </g>
                )}
                {active(m.id) && (
                  <circle
                    className="selection-reticle"
                    r="20"
                    fill="none"
                    stroke={MAP_PALETTE.decoration.selection}
                    strokeWidth="2"
                  />
                )}
                {world.contacts.some((c) => c.id === m.id && c.hostile) && (
                  <circle
                    className="hostile-marker"
                    r="19"
                    fill="none"
                    stroke={MAP_PALETTE.decoration.danger}
                    strokeDasharray="3 3"
                  />
                )}
                {m.clusterCount && (
                  <text
                    x="0"
                    y="6"
                    textAnchor="middle"
                    fill={MAP_PALETTE.decoration.selection}
                    fontSize="16"
                  >
                    {m.clusterCount}
                  </text>
                )}
                <g opacity={m.cloak === 'on' ? 0.7 : 1}>
                  {m.clusterCount ? (
                    <circle
                      r={20}
                      fill="none"
                      stroke={MAP_PALETTE.decoration.selection}
                      strokeWidth={2}
                    />
                  ) : (
                    <MapSymbol kind={m.kind} color={m.color} />
                  )}
                </g>
                {m.selection.type === 'location' &&
                  level !== 'LOCAL' &&
                  world.ships.filter((s) => !s.current && Math.hypot(s.x - m.p.x, s.y - m.p.y) < 90)
                    .length > 1 && (
                    <text x="15" y="-14" fill={m.color} className="fleet-count">
                      {
                        world.ships.filter(
                          (s) => !s.current && Math.hypot(s.x - m.p.x, s.y - m.p.y) < 90,
                        ).length
                      }
                    </text>
                  )}
              </g>
            );
          })}
          {destination &&
            (() => {
              const p = pos(destination);
              const origins = world.ships.filter((s) => selectedShipIds.includes(s.id));
              return (
                <g pointerEvents="none" data-testid="destination-preview">
                  {origins.map((origin) => (
                    <line
                      key={origin.id}
                      x1={pos(origin).x}
                      y1={pos(origin).y}
                      x2={p.x}
                      y2={p.y}
                      stroke={MAP_PALETTE.decoration.destination}
                      strokeDasharray="6 4"
                    />
                  ))}
                  <path
                    d={`M${p.x - 10} ${p.y}H${p.x + 10}M${p.x} ${p.y - 10}V${p.y + 10}`}
                    stroke={MAP_PALETTE.decoration.destination}
                    strokeWidth="2"
                  />
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r="14"
                    fill="none"
                    stroke={MAP_PALETTE.decoration.destination}
                  />
                </g>
              );
            })()}
          {world.beams.map((b, i) => {
            const a = pos(b.from),
              z = pos(b.to);
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={z.x}
                y2={z.y}
                stroke={
                  b.enemy ? MAP_PALETTE.decoration.danger : MAP_PALETTE.decoration.friendlyBeam
                }
                strokeWidth={b.weapon.includes('Torpedo') ? 4 : 2}
                pointerEvents="none"
              />
            );
          })}
          {markers
            .filter(
              (m) =>
                Math.hypot(
                  displayPositions.get(m.id)!.x - pos(m.p).x,
                  displayPositions.get(m.id)!.y - pos(m.p).y,
                ) > 2,
            )
            .map((m) => (
              <line
                key={'marker-line-' + m.id}
                x1={pos(m.p).x}
                y1={pos(m.p).y}
                x2={displayPositions.get(m.id)!.x}
                y2={displayPositions.get(m.id)!.y}
                stroke={m.color}
                opacity=".45"
                pointerEvents="none"
              />
            ))}
          {placed
            .filter(
              (l) =>
                Math.hypot(l.connector.x - l.anchor.x, l.connector.y - l.anchor.y) >
                labelFont * 1.5 * markerScale,
            )
            .map((l) => (
              <line
                key={'label-line-' + l.id}
                x1={l.anchor.x}
                y1={l.anchor.y}
                x2={l.connector.x}
                y2={l.connector.y}
                stroke={l.color}
                opacity=".35"
                pointerEvents="none"
              />
            ))}
          {placed.map((l) => (
            <text
              key={l.id}
              data-label-id={l.id}
              x={l.x}
              y={l.y}
              textAnchor="middle"
              fill={l.color}
              className="map-label"
              pointerEvents="none"
            >
              {l.text}
            </text>
          ))}
        </svg>
      </div>
      {contextMenu && (
        <div
          ref={menuElement}
          className="map-context-menu"
          role="menu"
          aria-label="地图标记操作"
          style={{ left: menuPosition.x, top: menuPosition.y }}
        >
          <p>{contextMenu.name}</p>
          <LcarsButton
            role="menuitem"
            disabled={!world.mapMarkers.removableIds.includes(contextMenu.id)}
            onClick={async () => {
              const result = await command({ type: 'dismissMapMarker', entityId: contextMenu.id });
              if (result.ok) setContextMenu(null);
            }}
          >
            移除无价值标记
          </LcarsButton>
          {!world.mapMarkers.removableIds.includes(contextMenu.id) && (
            <p>仍有货物、奖励或未完成事件，暂不可移除。</p>
          )}
          <LcarsButton role="menuitem" onClick={() => setContextMenu(null)}>
            关闭
          </LcarsButton>
        </div>
      )}
      <details className="map-legend">
        <summary>LEGEND 图例</summary>
        <div>
          {MAP_LEGEND.map(([name, color]) => (
            <span key={name}>
              <i style={{ background: color }} />
              {name}
            </span>
          ))}
          {Object.entries(MAP_PALETTE.planets).map(([name, color]) => (
            <span key={name}>
              <i style={{ background: color }} />
              {name}
            </span>
          ))}
        </div>
      </details>
      <div className="map-status">
        <span>DAWN FRONTIER · DRAG / SEMANTIC ZOOM / SELECT</span>
        <div className="camera-controls">
          <LcarsButton
            sound="navigation"
            aria-label="缩小地图"
            onClick={() => {
              onManualCamera();
              animate(
                zoomCamera(current.current, current.current.k / 1.4, {
                  x: camera.width / 2,
                  y: camera.height / 2,
                }),
              );
            }}
          >
            −
          </LcarsButton>
          <LcarsButton
            sound="navigation"
            aria-label="放大地图"
            onClick={() => {
              onManualCamera();
              animate(
                zoomCamera(current.current, current.current.k * 1.4, {
                  x: camera.width / 2,
                  y: camera.height / 2,
                }),
              );
            }}
          >
            +
          </LcarsButton>
          <LcarsButton
            sound="navigation"
            onClick={() => {
              onManualCamera();
              commit(fitCamera(camera.width, camera.height, boundsOf(known())));
            }}
          >
            FIT
          </LcarsButton>
          <b>{camera.k.toFixed(2)}×</b>
        </div>
      </div>
    </section>
  );
}
