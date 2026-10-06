import type { SectorCoord } from './types';

export const fixedPassage = (c: SectorCoord) => c.q === 0 && (c.r === 0 || c.r === 12);

/** A seeded affine permutation between nonadjacent 32×32 sector blocks.
 * The inverse maps every remote endpoint back, without consuming simulation RNG.
 */
function ordinaryPair(seed: number, c: SectorCoord): SectorCoord {
  const bq = Math.floor(c.q / 32),
    br = Math.floor(c.r / 32);
  const group = Math.floor(bq / 4) * 4,
    slot = bq - group;
  const upper = slot >= 2,
    canonical = group + (slot % 2);
  let hash = (Math.imul(canonical, 0x45d9f3b) ^ Math.imul(br, 0x27d4eb2d) ^ seed ^ 0x771234) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0;
  const a = ((hash >>> 10) % 512) * 2 + 1,
    b = hash % 1024;
  const local = (c.q - bq * 32) * 32 + c.r - br * 32;
  let inverse = 1;
  for (let i = 0; i < 4; i++) inverse = (inverse * (2 - a * inverse)) & 1023;
  const destination = upper ? ((local - b + 1024) * inverse) % 1024 : (a * local + b) % 1024;
  return {
    q: (bq + (upper ? -2 : 2)) * 32 + Math.floor(destination / 32),
    r: br * 32 + (destination % 32),
  };
}

export function pairedSector(seed: number, c: SectorCoord): SectorCoord {
  if (fixedPassage(c)) return { q: 0, r: c.r === 0 ? 12 : 0 };
  // Reserve Dawn's two endpoints without leaving their ordinary partners orphaned.
  // A third, distant pair provides two equally distant replacement partners.
  const first = ordinaryPair(seed, { q: 0, r: 0 });
  const second = ordinaryPair(seed, { q: 0, r: 12 });
  const third = { q: 128, r: 0 };
  const fourth = ordinaryPair(seed, third);
  const same = (a: SectorCoord, b: SectorCoord) => a.q === b.q && a.r === b.r;
  if (same(c, first)) return third;
  if (same(c, third)) return first;
  if (same(c, second)) return fourth;
  if (same(c, fourth)) return second;
  return ordinaryPair(seed, c);
}
