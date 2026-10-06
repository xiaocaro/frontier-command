import { contextBridge, ipcRenderer } from 'electron';
import type { Command, SessionCommand, Snapshot, PublicSimulationEvent } from '../src/engine/types';
contextBridge.exposeInMainWorld('frontier', {
  getState: () => ipcRenderer.invoke('world:get'),
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
