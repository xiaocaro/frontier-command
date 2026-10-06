import type { Command, SessionCommand, CommandResult } from '../engine/types';
export type Page =
  | 'SECTOR'
  | 'FLEET'
  | 'OPERATIONS'
  | 'PERSONNEL'
  | 'STARBASE'
  | 'COLONIES'
  | 'ARCHIVE';
export type CommandSender = (
  command: Command | SessionCommand,
  quiet?: boolean,
) => Promise<CommandResult>;
export interface Notice {
  text: string;
  error: boolean;
}
