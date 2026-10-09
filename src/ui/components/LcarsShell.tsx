import { ChineseDisplay } from '../localization';
import { useEffect, useLayoutEffect, useState, useRef, type ReactNode } from 'react';
import type { Snapshot } from '../../engine/types';
import type { CommandSender, Page } from '../types';
import { gameCalendar } from '../../engine/clock';
import { ACTION_LABELS } from '../format';
import { actionProgress } from '../format';
import { LcarsBar, LcarsButton, LcarsElbow, LcarsTextBar } from './Lcars';
import { AgentChannel } from './AgentChannel';
import { DataCascade } from '../lcars/DataCascade';
import { usePanelFocus } from '../lcars/usePanelFocus';
export const PAGES: Page[] = [
  'SECTOR',
  'FLEET',
  'OPERATIONS',
  'PERSONNEL',
  'STARBASE',
  'COLONIES',
  'ARCHIVE',
];
export const LABELS = ['星区', '舰队', '行动', '人员', '基地', '殖民地', '档案'];
const shownResource = (value: number, fractional: boolean) =>
  fractional ? Number(value.toFixed(1)) : Math.floor(value);
export function LcarsShell({
  world,
  page,
  onPage,
  command,
  locate,
  children,
  inspector,
  overlay,
  onSettings,
  contextSerial,
  selectedShipIds,
}: {
  world: Snapshot;
  page: Page;
  onPage: (p: Page) => void;
  command: CommandSender;
  locate: (id: string | null, additive?: boolean) => void;
  children: ReactNode;
  inspector: ReactNode;
  overlay?: ReactNode;
  onSettings: () => void;
  contextSerial: string;
  selectedShipIds: string[];
}) {
  const [showRead, setShowRead] = useState(false),
    [showContext, setShowContext] = useState(false),
    [showNav, setShowNav] = useState(false);
  const contextRef = usePanelFocus(() => setShowContext(false), false, showContext);
  const navRef = usePanelFocus(() => setShowNav(false), true, showNav);
  const workspaceRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const workspace = workspaceRef.current,
      consoleRoot = workspace?.parentElement;
    if (!workspace || !consoleRoot) return;
    const update = () => {
      const box = workspace.getBoundingClientRect();
      document.documentElement.style.setProperty(
        '--workspace-top',
        Math.max(16, Math.min(box.top, innerHeight * 0.45)) + 'px',
      );
      document.documentElement.style.setProperty(
        '--workspace-bottom',
        Math.max(16, Math.min(innerHeight - box.bottom, innerHeight * 0.2)) + 'px',
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(workspace);
    consoleRoot.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    update();
    return () => {
      observer.disconnect();
      consoleRoot.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  const previousContext = useRef(contextSerial);
  useEffect(() => {
    if (previousContext.current === contextSerial) return;
    previousContext.current = contextSerial;
    if (document.documentElement.dataset.consoleLayout !== 'wide') setShowContext(true);
  }, [contextSerial]);
  useEffect(() => {
    if (overlay) setShowContext(false);
  }, [page, !!overlay]);
  const cal = gameCalendar(world.tick),
    active = world.ships,
    lost = world.status === 'commandLost';
  const communications = [...world.communications]
    .filter((c) => showRead || !c.read)
    .sort(
      (a, b) =>
        ({ urgent: 3, high: 2, normal: 1 })[b.priority] -
          { urgent: 3, high: 2, normal: 1 }[a.priority] || b.id - a.id,
    );
  /**
   * The newest line by **creation**, which is not the same as the first row: the sort above puts
   * priority first, so an urgent threat stays on top even when an Agent spoke a moment later. Derived
   * here rather than stored, so the highlight moves by itself — no "clear the previous one" step, and
   * nothing to keep in sync.
   */
  const latestId = communications.reduce<number | null>(
    (newest, c) => (newest === null || c.id > newest ? c.id : newest),
    null,
  );
  const base = world.locations.find((l) => l.id === 'base')!;
  return (
    <div className="admiral-console">
      <header className="command-header">
        <div className="header-rail">
          <div className="identity-panel">
            <span>STARFLEET COMMAND</span>
            <strong>
              DAWN
              <br />
              FRONTIER
            </strong>
          </div>
          <LcarsElbow orientation="upper" className="header-elbow">
            <span>ADMIRAL / 047</span>
          </LcarsElbow>
        </div>
        <div className="header-body">
          <div className="banner">
            <LcarsButton
              className="compact-nav"
              onClick={() => setShowNav((v) => !v)}
              aria-expanded={showNav}
            >
              MENU 导航
            </LcarsButton>
            <span>FEDERATION NETWORK / LCARS 26</span>
            <h1>FRONTIER COMMAND</h1>
          </div>
          <div className="command-deck">
            <DataCascade world={world} />
            <section className="communications" aria-label="Priority Communications">
              <div className="comms-heading">
                <LcarsTextBar className="section-title">PRIORITY COMMUNICATIONS</LcarsTextBar>
                <LcarsButton sound="navigation" onClick={() => setShowRead(!showRead)}>
                  {showRead ? '仅未读' : '全部通信'}
                </LcarsButton>
              </div>
              <div className="comms-list">
                {world.pauseReasons.length > 0 && !lost && (
                  <div className="critical-banner" role="alert">
                    <b>PRIORITY HOLD</b>
                    <span>{world.pauseReasons.map((r) => r.message).join(' · ')}</span>
                    <LcarsButton
                      tone="danger"
                      onClick={() => command({ type: 'pause', paused: false }, true)}
                    >
                      处置后继续
                    </LcarsButton>
                  </div>
                )}

                {communications.length ? (
                  communications.map((c) => (
                    <div
                      key={c.id}
                      className={
                        'comms-item ' + c.priority + (c.id === latestId ? ' is-latest' : '')
                      }
                    >
                      <LcarsButton
                        shape="text"
                        sound="navigation"
                        className="comms-content"
                        onClick={() => locate(c.entityId)}
                      >
                        <span>
                          {c.priority.toUpperCase()} / {Math.floor(c.time)}m
                        </span>
                        {c.text}
                      </LcarsButton>
                      <LcarsButton
                        tone="secondary"
                        className="ack-button"
                        disabled={c.read || lost}
                        aria-label={'确认通信 ' + c.id}
                        onClick={() =>
                          command({ type: 'acknowledge', communicationId: c.id }, true)
                        }
                      >
                        {c.read ? '已读' : '确认'}
                      </LcarsButton>
                    </div>
                  ))
                ) : (
                  <p className="muted">CHANNEL CLEAR · 暂无待处理通信</p>
                )}
              </div>
              <AgentChannel command={command} commanderName={world.commander.name} />
            </section>
            <section className="clock-panel" aria-label="Simulation controls">
              <strong data-testid="game-clock">
                DAY {cal.day}
                <b>
                  {String(cal.hour).padStart(2, '0')}:{String(cal.minute).padStart(2, '0')}
                </b>
              </strong>
              <div className="time-controls">
                <LcarsButton
                  disabled={lost}
                  aria-pressed={world.paused}
                  onClick={() => command({ type: 'pause', paused: !world.paused }, true)}
                >
                  {world.paused ? '继续' : '暂停'}
                </LcarsButton>
                {([1, 4, 16] as const).map((speed) => (
                  <LcarsButton
                    key={speed}
                    disabled={lost}
                    aria-pressed={world.speed === speed}
                    onClick={() => command({ type: 'speed', speed }, true)}
                  >
                    {speed}×
                  </LcarsButton>
                ))}
              </div>
              <div className="strategic-state">
                <span>
                  血量{' '}
                  <b className={lost ? 'danger-text' : ''}>
                    {lost ? 'LOST' : Math.ceil(base.hull)}
                  </b>{' '}
                  / {base.maxHull}
                </span>
                <span>
                  SHIELD <b>{Math.ceil(base.shield)}</b>
                </span>
              </div>
              <div className="strategic-state">
                <span>
                  READY{' '}
                  <b>
                    {world.ships.filter((s) => s.status === 'docked').length}/{world.ships.length}
                  </b>
                </span>
                <span>
                  HOSTILES <b>{world.contacts.filter((c) => c.hostile && c.live).length}</b>
                </span>
              </div>
            </section>
          </div>
          <section className="resource-strip" aria-label="基地可用资源">
            {[
              ['credits', 'CREDITS 信用点'],
              ['materials', 'MATERIALS 材料'],
              ['photon', 'PHOTON 光子鱼雷'],
              ['quantum', 'QUANTUM 量子鱼雷'],
              ['specialFinds', 'SPECIAL FINDS 特殊发现'],
            ].map(([key, label]) => (
              <div key={key} data-resource={key}>
                <span>{label}</span>
                <b>
                  {shownResource(
                    key === 'credits'
                      ? world.baseResources.credits
                      : world.baseResources.available[
                          key as keyof typeof world.baseResources.available
                        ],
                    key === 'materials',
                  ).toLocaleString('en-US')}
                </b>
              </div>
            ))}
            <details>
              <summary>库存 / 预留</summary>
              <div className="resource-details">
                {Object.entries(world.baseResources.stock).map(([key, n]) => (
                  <p key={key}>
                    {key} · 库存 {shownResource(n, key === 'materials')} · 预留{' '}
                    {shownResource(
                      world.baseResources.reserved[
                        key as keyof typeof world.baseResources.reserved
                      ],
                      key === 'materials',
                    )}
                  </p>
                ))}
              </div>
            </details>
          </section>
          <LcarsBar className="header-band" />
        </div>
      </header>
      <nav ref={navRef} className={'section-nav ' + (showNav ? 'is-open' : '')} aria-label="主导航">
        <div className="compact-nav-controls">
          <LcarsButton onClick={() => setShowNav(false)} aria-label="关闭导航">
            CLOSE 关闭导航
          </LcarsButton>
        </div>
        <LcarsElbow className="nav-cap">
          <span>SECTOR</span>
          <strong>047</strong>
        </LcarsElbow>
        {PAGES.map((p, i) => (
          <LcarsButton
            key={p}
            shape="rail"
            tone={i === 1 || i === 4 ? 'orange' : i === 3 ? 'secondary' : 'almond'}
            sound="navigation"
            aria-current={page === p ? 'page' : undefined}
            onClick={() => {
              onPage(page === p ? 'SECTOR' : p);
              setShowNav(false);
            }}
          >
            <small>0{i + 1}</small>
            <b>{p}</b>
            <span>{LABELS[i]}</span>
          </LcarsButton>
        ))}
        <div className="nav-bottom">
          <span>
            LCARS / 2368
            <br />
            RULES AI / LOCAL
          </span>
          <LcarsButton
            shape="flat"
            sound="navigation"
            tone="almond"
            onClick={() => {
              setShowNav(false);
              onSettings();
            }}
            aria-label="Console Settings"
          >
            CONSOLE SETTINGS
          </LcarsButton>
        </div>
      </nav>
      <LcarsBar variant="lower" className="body-band" />
      <main ref={workspaceRef} className="sector-workspace">
        {children}
        <LcarsButton
          className="compact-context"
          sound="navigation"
          onClick={() => setShowContext(true)}
          aria-label="打开对象详情"
        >
          对象详情
        </LcarsButton>
        {overlay}
      </main>
      <ChineseDisplay.Provider value={true}>
        <aside
          ref={contextRef}
          tabIndex={-1}
          className={'inspector ' + (showContext ? 'is-open' : '')}
          aria-label="对象详情"
        >
          <div className="inspector-heading">
            <LcarsTextBar className="section-title">对象详情</LcarsTextBar>
            <LcarsButton
              className="inspector-close"
              aria-label="关闭对象详情"
              sound="navigation"
              onClick={() => setShowContext(false)}
            >
              关闭
            </LcarsButton>
          </div>
          <div className="inspector-content">
            <div key={contextSerial} className="context-transition">
              {inspector}
            </div>
          </div>
        </aside>
      </ChineseDisplay.Provider>
      <footer className="operations-footer">
        <div className="footer-title">
          <LcarsTextBar>FLEET DIRECTIVES</LcarsTextBar>
          <small>
            {lost ? 'COMMAND LOST' : world.paused ? 'SIMULATION PAUSED' : 'SIMULATION ACTIVE'}
          </small>
        </div>
        <div className="operation-strip">
          {active.length ? (
            active.map((o) => (
              <LcarsButton
                sound="navigation"
                key={o.id}
                data-ship-id={o.id}
                aria-pressed={selectedShipIds.includes(o.id)}
                className={'operation-chip ' + (o.current ? 'attention' : '')}
                data-cloak={o.cloak}
                onClick={(e) => locate(o.id, e.ctrlKey)}
              >
                <b>
                  {o.name.split(' / ')[0]}
                  {o.cloak === 'on' ? ' ◇ 隐形' : o.cloak === 'decloaking' ? ' ◇ 解除中' : ''}
                </b>
                <span>
                  {o.current ? ACTION_LABELS[o.current.action.type] : 'AVAILABLE'} ·{' '}
                  {o.queue.length} QUEUED / {o.suspended.length} SUSPENDED
                </span>
                <small>{actionProgress(world, o).text}</small>
              </LcarsButton>
            ))
          ) : (
            <span className="muted">NO FLEET DIRECTIVES · 从星图选择目标下达高层任务</span>
          )}
        </div>
      </footer>
    </div>
  );
}
