import type {
  Command,
  SessionCommand,
  CommandResult,
  Snapshot,
  PublicSimulationEvent,
} from './engine/types';
import type { TimelineStatus } from './engine/timeline';
import type { RosterAgent } from './engine/agent/roster';
declare global {
  interface Window {
    frontier: {
      getState(): Promise<{
        state: Snapshot;
        saveMessage: string;
        saveBlocked: boolean;
        timeline: TimelineStatus;
      }>;
      /** Read-only Agent roster. The only channel that carries Agent state to the renderer. */
      agents(): Promise<RosterAgent[]>;
      command(command: Command | SessionCommand): Promise<CommandResult>;
      save(): Promise<CommandResult>;
      timeline(): Promise<TimelineStatus>;
      onState(callback: (state: Snapshot) => void): () => void;
      onEvents(callback: (events: PublicSimulationEvent[]) => void): () => void;
      setDisplayZoom(factor: number): Promise<number>;
    };
  }
}
