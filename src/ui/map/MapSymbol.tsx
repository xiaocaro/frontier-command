import { MAP_PALETTE } from './palette';
import type { ReactNode } from 'react';
export const SYMBOLS = {
  ship: (
    <>
      <ellipse cx="0" cy="-4" rx="9" ry="5" />
      <path d="M0 1V10M-12-1V10M12-1V10M-12 5H12" />
    </>
  ),
  freighter: (
    <>
      <path d="M-7-10H7V10H-7ZM-13-5H-7M7-5H13M-13 6H-7M7 6H13M-3-6H3M-3 0H3M-3 6H3" />
    </>
  ),
  base: (
    <>
      <path d="M-15-3L0-11 15-3 0 5ZM-10 2V9L0 14 10 9V2M0-16V-11M-19-3H-15M15-3H19" />
    </>
  ),
  colony: (
    <>
      <path d="M-14 10V-1L-7-7 0-1 7-7 14-1V10ZM-7 10V2H7V10" />
      <path d="M0-15V-7M-4-11H4" />
    </>
  ),
  mine: (
    <>
      <path d="M-14 11H14L7 2H-7ZM-9-13L11 7M-14-7Q-4-16 5-14M-5-8L-10 0" />
    </>
  ),
  outpost: (
    <>
      <path d="M-11 11H11M-5 11V-7H5V11M-12-13L0-6 12-13M-15-7Q0 6 15-7" />
    </>
  ),
  platform: (
    <>
      <path d="M-10-11H10L14 0 0 13 -14 0ZM0-7V5M-6-1H6M-20-3H-12M12-3H20" />
    </>
  ),
  system: (
    <>
      <circle r="6" />
      <path d="M0-17V-10M0 10V17M-17 0H-10M10 0H17M-12-12L-7-7M7 7L12 12M12-12L7-7M-7 7L-12 12" />
    </>
  ),
  planet: (
    <>
      <circle r="11" />
      <path d="M-9-5Q-2-9 1-3L-3 3 0 10M5-9L7-3 3 2 9 5" />
    </>
  ),
  moon: (
    <>
      <path d="M6-11A12 12 0 1 0 6 11A14 14 0 0 1 6-11Z" />
    </>
  ),
  belt: (
    <>
      <path d="M-15-3L-9-8 -4-3 -9 3ZM0 4L5-1 12 3 8 10ZM6-12L11-16 16-10 11-7ZM-14 10L-10 6 -6 11 -11 14Z" />
    </>
  ),
  resource: (
    <>
      <path d="M-8 9L-10-4 -4-12 3-5 4 9ZM4 9L5-5 11-9 15 1 11 9ZM-15 13H16" />
    </>
  ),
  anomaly: (
    <>
      <path d="M-16 1Q-5-15 9-10Q19-1 3 10Q-12 18-11 3Q-8-7 4-4Q12-1 1 5" />
    </>
  ),
  wormhole: (
    <>
      <ellipse rx="15" ry="10" />
      <ellipse rx="9" ry="6" />
      <path d="M-20-5L-15 0 -20 5M20-5L15 0 20 5" />
    </>
  ),
  wreck: (
    <>
      <path d="M-14-9L-5-11 0-4 -5 1 -2 10 -9 13 -13 5M5-7L14-3 9 3 14 8 5 11M-2-16L2-11M-18 0L-15 2M1 16L4 13" />
    </>
  ),
  derelict: (
    <>
      <path d="M-14-9L-5-11 0-4 -5 1 -2 10 -9 13 -13 5M5-7L14-3 9 3 14 8 5 11" />
    </>
  ),
  ruins: (
    <>
      <path d="M-14 12H14M-11 12V-7H-5V12M2 12V-3H8V12M-14-7L0-15 14-7" />
    </>
  ),
  project: (
    <>
      <path strokeDasharray="3 3" d="M-12-12H12V12H-12Z" />
      <path d="M-6 0H6M0-6V6" />
    </>
  ),
  contact: (
    <>
      <path strokeDasharray="3 2" d="M-14-4V-13H-5M5-13H14V-4M14 4V13H5M-5 13H-14V4" />
      <path d="M-4-5Q-2-10 3-7Q8-4 1 1V4M1 8V10" />
    </>
  ),
} satisfies Record<string, ReactNode>;
export type SymbolKind = keyof typeof SYMBOLS;
export function MapSymbol({ kind, color }: { kind: SymbolKind; color: string }) {
  return (
    <g
      data-symbol={kind}
      stroke={color}
      fill={MAP_PALETTE.decoration.ink}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {SYMBOLS[kind]}
    </g>
  );
}
