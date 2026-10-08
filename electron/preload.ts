import { contextBridge, ipcRenderer } from 'electron';
import type { Command, SessionCommand, Snapshot, PublicSimulationEvent } from '../src/engine/types';
import type { RosterAgent } from '../src/engine/agent/roster';
contextBridge.exposeInMainWorld('frontier', {
  getState: () => ipcRenderer.invoke('world:get'),
  // The read-only Agent roster. It is the one channel that carries Agent state to the renderer, and
  // it is a separate channel rather than more fields on the snapshot on purpose — see
  // `src/engine/agent/roster.ts` and docs/lv3/10-agent-demo-channel.md.
  agents: () => ipcRenderer.invoke('agents:get') as Promise<RosterAgent[]>,
  command: (command: Command | SessionCommand) => ipcRenderer.invoke('world:command', command),
  save: () => ipcRenderer.invoke('world:save'),
  timeline: () => ipcRenderer.invoke('world:timeline'),
  setDisplayZoom: (factor: number) => ipcRenderer.invoke('display:zoom', factor),
  onEvents: (callback: (events: PublicSimulationEvent[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, events: PublicSimulationEvent[]) =>
      callback(events);
    ipcRenderer.on('world:events', handler);
    return () => ipcRenderer.removeListener('world:events', handler);
  },
  onState: (callback: (state: Snapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: Snapshot) => callback(state);
    ipcRenderer.on('world:state', handler);
    return () => ipcRenderer.removeListener('world:state', handler);
  },
});
