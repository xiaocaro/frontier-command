import { freezeDefinitions } from './freeze';
export const SECTOR_SIZE = 400;
export const BASE = Object.freeze({ x: -240, y: 0 });
export const INITIAL_LOCATIONS = freezeDefinitions([
  { id: 'base', name: 'DAWN STARBASE / 曙光基地', kind: 'base', x: -240, y: 0 },
  { id: 'colony', name: 'NEW HORIZON / 新曙殖民地', kind: 'colony', x: 130, y: 140 },
  { id: 'mine', name: 'HELIOS MINE / 赫利俄斯矿场', kind: 'mine', x: 240, y: -80 },
  { id: 'outpost', name: 'BEACON OUTPOST / 信标前哨', kind: 'outpost', x: 260, y: 180 },
] as const);
export const regionAt = (x: number, y = 0) =>
  x >= 980 && Math.abs(y) < 650
    ? 'romulan'
    : x >= 780 && Math.abs(y) < 650
      ? 'neutral'
      : x < 0
        ? 'rear'
        : 'frontier';
