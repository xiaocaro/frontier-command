import { app, BrowserWindow, ipcMain, protocol, net } from 'electron';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SimulationEngine } from '../src/engine/engine';
import { createWorld } from '../src/engine/data';
import { HOST_FRAME_MS } from '../src/engine/clock';
import { SaveStore } from './persistence';
import { AgentHost } from './agent-host';
import { agentRosterView } from '../src/engine/agent/roster';
import { z } from 'zod';

protocol.registerSchemesAsPrivileged([
  { scheme: 'frontier', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
if (process.env.FRONTIER_USER_DATA) app.setPath('userData', process.env.FRONTIER_USER_DATA);
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
let window: BrowserWindow | null = null;
let engine: SimulationEngine;
let store: SaveStore;
let saveBlocked = false;
let timer: ReturnType<typeof setInterval> | undefined;
let lastAutoSave = 0;
let saveMessage = '';
let agentHost: AgentHost | undefined;
const send = () => {
  if (window && !window.isDestroyed()) window.webContents.send('world:state', engine.snapshot());
};
function save() {
  if (saveBlocked) return { ok: false, reason: saveMessage };
  try {
    store.write(engine.state);
    lastAutoSave = engine.state.tick;
    return { ok: true, reason: '世界状态已保存至本机' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `保存失败：${message}` };
  }
}
app.whenReady().then(async () => {
  if (!ownsInstance) return;
  const root = resolve(__dirname, '../../dist');
  protocol.handle('frontier', (request) => {
    const url = new URL(request.url);
    const relative = decodeURIComponent(
      url.pathname === '/' ? '/index.html' : url.pathname,
    ).replace(/^\/+/, '');
    const file = resolve(root, relative);
    if (
      url.hostname !== 'app' ||
      !(file.startsWith(root + require('node:path').sep) || file === root)
    )
      return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  store = new SaveStore(app.getPath('userData'));
  const loaded = store.read();
  saveMessage = loaded.message;
  saveBlocked = loaded.blocked;
  engine = new SimulationEngine(loaded.world ?? createWorld());
  if (engine.state.status === 'active') engine.state.paused = true;
  if (!loaded.world && !loaded.blocked) store.write(engine.state);
  try {
    agentHost = new AgentHost(engine, { root: app.getAppPath() });
  } catch (error) {
    // Unreadable or version-mismatched prompts are a packaging fault. Loud, but not fatal: the game
    // runs, it just never asks a model anything.
    engine.log('Agent 运行时装配失败，本局不产生 Agent 决策：' + String(error), 'warning');
  }
  window = new BrowserWindow({
    show: process.env.FRONTIER_HEADLESS !== '1',
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    useContentSize: true,
    backgroundColor: '#000000',
    title: 'STARFLEET · FRONTIER COMMAND',
    icon: join(app.getAppPath(), 'build/icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  window.removeMenu();
  /**
   * A real debug control.
   *
   * The playbook let Lv3 skip a UI on the grounds that "the MVP can be validated through the existing
   * UI or debug controls" — but `window.frontier` was unreachable from a running app (no menu, no
   * shortcut, `sandbox: true`), so that exemption did not actually hold for a human. This makes the
   * debug control real: the console opens, and `window.frontier.command({ type: 'agentMessage', … })`
   * works in it.
   */
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const toggle =
      input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i');
    if (!toggle) return;
    event.preventDefault();
    window?.webContents.toggleDevTools();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (
      !url.startsWith('frontier://app/') &&
      !url.startsWith(process.env.VITE_DEV_SERVER_URL ?? 'frontier://app/')
    )
      event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  const trusted = (event: Electron.IpcMainInvokeEvent) => {
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error('Untrusted IPC sender');
  };
  ipcMain.handle('world:get', (event) => {
    trusted(event);
    return {
      state: engine.snapshot(),
      saveMessage,
      saveBlocked,
      timeline: store.status(engine.state.tick),
    };
  });
  /**
   * The read-only Agent roster (docs/lv3/10-agent-demo-channel.md).
   *
   * A **separate channel**, deliberately, rather than adding `agents` to `snapshot()`: the snapshot is
   * cropped by `projection.ts` and guarded by `tests/recon.test.ts`, and widening it would push Agent
   * memory text toward the renderer — the leak vector `KNOWN_ISSUES.md` `N-7` warns about. A second
   * channel with its own explicit crop (`src/engine/agent/roster.ts`) is easier to audit than a bigger
   * first one. Read-only: the renderer still changes nothing except through `world:command`.
   */
  ipcMain.handle('agents:get', (event) => {
    trusted(event);
    return agentRosterView(engine.state);
  });
  ipcMain.handle('world:command', (event, command: unknown) => {
    trusted(event);
    const session = z
      .object({ type: z.enum(['restorePreviousDay', 'beginNewFrontier']) })
      .strict()
      .safeParse(command);
    if (session.success) {
      try {
        const next =
          session.data.type === 'restorePreviousDay'
            ? store.restorePreviousDay(engine.state)
            : store.beginNew(createWorld(), saveBlocked ? undefined : engine.state);
        engine = new SimulationEngine(next);
        saveBlocked = false;
        lastAutoSave = engine.state.tick;
        send();
        return { ok: true, reason: '已切换至独立时间线，原记录保留' };
      } catch (error) {
        return { ok: false, reason: String(error) };
      }
    }
    if (saveBlocked) return { ok: false, reason: saveMessage };
    const previousReasons = engine.state.pauseReasons.length;
    const result = engine.dispatchCommand(command);
    if (
      result.ok &&
      typeof command === 'object' &&
      command &&
      (engine.state.pauseReasons.length > previousReasons ||
        !['speed', 'pause'].includes((command as { type: string }).type))
    ) {
      const saved = save();
      if (!saved.ok && engine.state.status === 'active') engine.log(saved.reason, 'danger');
    }
    send();
    return result;
  });
  ipcMain.handle('world:save', (event) => {
    trusted(event);
    return save();
  });
  ipcMain.handle('world:timeline', (event) => {
    trusted(event);
    return store.status(engine.state.tick);
  });
  ipcMain.handle('display:zoom', (event, factor: unknown) => {
    trusted(event);
    const zoom = z.number().finite().min(1).max(2).parse(factor);
    if (Math.abs(window!.webContents.getZoomFactor() - zoom) > 1e-8)
      window!.webContents.setZoomFactor(zoom);
    return zoom;
  });
  window.on('close', () => {
    const result = save();
    if (!result.ok) console.error(result.reason);
  });
  await window.loadURL(process.env.VITE_DEV_SERVER_URL ?? 'frontier://app/index.html');
  timer = setInterval(() => {
    const previousLog = engine.state.nextLog;
    let events: ReturnType<SimulationEngine['advanceFrame']> = [];
    try {
      events = engine.advanceFrame((events, state) => {
        if (events.some((e) => e.type === 'dayBoundary')) store.daily(state);
        if (events.some((e) => e.type === 'commandLost')) store.write(state);
      });
    } catch (error) {
      engine.state.paused = true;
      saveMessage = '时间线写入失败：' + String(error);
      saveBlocked = true;
    }
    // The Lv3 Agent beat. Deliberately its own try/catch, outside the one above: a slow or broken
    // provider must never reach the branch that marks the world `saveBlocked` — a model being down
    // is not a broken save (KNOWN_ISSUES `N-9`). `frame()` starts requests and returns; it never
    // awaits, so the network cannot stall this interval (CLAUDE.md §2.4).
    try {
      agentHost?.frame(events);
    } catch (error) {
      engine.log('Agent 调度异常：' + String(error), 'warning');
    }
    // Critical pauses are world events even when they do not add a log entry.

    if (
      engine.state.tick - lastAutoSave >= 100 ||
      engine.state.nextLog !== previousLog ||
      events.some((event) => event.type === 'criticalPause')
    ) {
      const result = save();
      if (!result.ok && !saveBlocked && engine.state.status === 'active') {
        engine.state.paused = true;
        engine.log(result.reason, 'danger');
        lastAutoSave = engine.state.tick;
      }
    }
    send();
    const publicEvents = events.filter((event) => event.type === 'shipTransited');
    if (publicEvents.length && window && !window.isDestroyed())
      window.webContents.send('world:events', publicEvents);
  }, HOST_FRAME_MS);
});
app.on('second-instance', () => {
  if (window) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
});
app.on('window-all-closed', () => {
  if (timer) clearInterval(timer);
  app.quit();
});
