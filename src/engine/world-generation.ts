import { pairedSector, fixedPassage } from './wormhole-pairs';
import type { Body, Point, SectorCoord, StarSystem, WorldState, Wormhole } from './types';
import { INITIAL_LOCATIONS, SECTOR_SIZE } from './definitions/locations';
export const VEIL_SITE = 'veil-derelict';
export const sectorId = ({ q, r }: SectorCoord) => 'sector:' + q + ':' + r;
export const sectorCenter = ({ q, r }: SectorCoord) => ({ x: q * SECTOR_SIZE, y: r * SECTOR_SIZE });
export function coordinateRandom(seed: number, coord: SectorCoord, salt = 0) {
  let rng =
    (seed ^ Math.imul(coord.q, 0x45d9f3b) ^ Math.imul(coord.r, 0x27d4eb2d) ^ salt ^ 0x6a09e667) >>>
    0;
  return () => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng / 4294967296;
  };
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const MAP_GENERATION = {
  systemSpacing: 180,
  bodySpacing: 60,
  starClearance: 70,
  maxBodies: 6,
} as const;
export function generatedSector(seed: number, coord: SectorCoord) {
  const random = coordinateRandom(seed, coord),
    id = sectorId(coord),
    center = sectorCenter(coord);
  const systems: StarSystem[] = [],
    bodies: Body[] = [];
  const authored: { id: string; kind: Body['kind']; category: string; x: number; y: number }[] = [];
  if (coord.q === 0 && coord.r === 0)
    authored.push({
      id: 'new-horizon-world',
      kind: 'planet',
      category: 'M-class 宜居世界',
      x: 130,
      y: 140,
    });
  if (coord.q === 1 && coord.r === 0)
    authored.push({ id: 'helios-deposit', kind: 'resource', category: '金属矿床', x: 240, y: -80 });
  if (coord.q === 0 && coord.r === 12)
    authored.push({
      id: VEIL_SITE,
      kind: 'derelict',
      category: '废弃 Veil 侦察舰',
      x: 40,
      y: SECTOR_SIZE * 12 + 35,
    });
  const anchors: Point[] = [
    ...authored,
    ...INITIAL_LOCATIONS.filter(
      (l) => Math.round(l.x / SECTOR_SIZE) === coord.q && Math.round(l.y / SECTOR_SIZE) === coord.r,
    ),
  ];
  if (fixedPassage(coord)) anchors.push({ x: center.x + 90, y: center.y - 80 });
  const stars: StarSystem['starClass'][] = [
    'M',
    'M',
    'K',
    'K',
    'G',
    'G',
    'F',
    'A',
    'giant',
    'neutron',
  ];
  const starCount = 1 + Math.floor(random() * 2);
  const grid: Point[] = [];
  for (let x = -150; x <= 150; x += 75)
    for (let y = -150; y <= 150; y += 75) grid.push({ x: center.x + x, y: center.y + y });
  const choose = (valid: (p: Point) => boolean, extent: number): Point | undefined => {
    for (let attempt = 0; attempt < 256; attempt++) {
      const p = {
        x: center.x + (random() * 2 - 1) * extent,
        y: center.y + (random() * 2 - 1) * extent,
      };
      if (valid(p)) return p;
    }
    // Stable finite fallback; placement never consumes the combat random stream.
    return grid.find(valid);
  };
  for (let index = 0; index < starCount; index++) {
    const position = choose(
      (p) =>
        systems.every((s) => distance(p, s) >= MAP_GENERATION.systemSpacing) &&
        anchors.every((b) => distance(p, b) >= MAP_GENERATION.starClearance),
      135,
    );
    if (!position) break;
    systems.push({
      id: id + ':system:' + index,
      name: 'DF-' + coord.q + '/' + coord.r + '-' + String.fromCharCode(65 + index),
      sectorId: id,
      ...position,
      starClass: stars[Math.floor(random() * stars.length)],
      discovered: false,
      survey: 0,
      bodyIds: [],
    });
  }
  const add = (
    sys: StarSystem,
    kind: Body['kind'],
    category: string,
    hidden = false,
    fixed?: (typeof authored)[number],
  ) => {
    if (sys.bodyIds.length >= MAP_GENERATION.maxBodies) return;
    const position =
      fixed ??
      choose(
        (p) =>
          systems.every((s) => distance(p, s) >= MAP_GENERATION.starClearance) &&
          bodies.every((b) => distance(p, b) >= MAP_GENERATION.bodySpacing) &&
          anchors.every((b) => distance(p, b) >= MAP_GENERATION.bodySpacing) &&
          distance(p, sys) <= 260,
        160,
      );
    if (!position) return;
    const b: Body = {
      id: fixed?.id ?? sys.id + ':body:' + sys.bodyIds.length,
      name:
        fixed?.id === VEIL_SITE
          ? 'VEIL DERELICT / 幽影侦察舰残骸'
          : fixed?.id === 'helios-deposit'
            ? 'Helios 金属矿床'
            : fixed?.id === 'new-horizon-world'
              ? 'New Horizon M-class'
              : category +
                ' ' +
                coord.q +
                '/' +
                coord.r +
                '-' +
                systems.indexOf(sys) +
                '-' +
                sys.bodyIds.length,
      systemId: sys.id,
      kind,
      category,
      population: 0,
      x: position.x,
      y: position.y,
      survey: 0,
      habitable: category === 'M-class 宜居世界',
      remaining: kind === 'resource' ? (fixed ? 3000 : 900 + Math.floor(random() * 2200)) : 0,
      richness: fixed ? 1.2 : 0.7 + random() * 1.4,
      hazard: fixed
        ? fixed.id === VEIL_SITE
          ? 0.05
          : 0.25
        : kind === 'anomaly'
          ? 0.4 + random() * 0.9
          : 0.08 + random() * 0.45,
      hidden,
      specialClaimed: false,
      discovered: false,
    };
    if (b.habitable && random() < 0.25) b.population = 150 + Math.floor(random() * 500);
    bodies.push(b);
    sys.bodyIds.push(b.id);
  };
  for (const b of authored) add(systems[0], b.kind, b.category, false, b);
  const categories = ['荒芜岩石世界', '气态巨行星', '冰封世界', '火山世界', '海洋世界'];
  for (const [index, sys] of systems.entries()) {
    const rare = coordinateRandom(seed, coord, 0x51ce21 ^ index);
    for (
      let p = 0,
        n = Math.max(
          0,
          Math.floor(random() * 4) -
            sys.bodyIds.filter((id) => bodies.find((b) => b.id === id)?.kind === 'planet').length,
        );
      p < n;
      p++
    ) {
      const category =
        random() < 0.1 ? 'M-class 宜居世界' : categories[Math.floor(random() * categories.length)];
      add(sys, 'planet', category);
      if (random() < 0.15) add(sys, 'moon', category.includes('气态') ? '冰质卫星' : '岩石卫星');
    }
    if (random() < 0.4) add(sys, 'belt', '小行星带');
    if (random() < 0.32)
      add(sys, 'resource', ['金属矿床', '高密度矿物带', '晶体矿床'][Math.floor(random() * 3)]);
    if (random() < 0.2)
      add(sys, 'anomaly', ['亚空间剪切', '引力异常', '离子风暴'][Math.floor(random() * 3)]);
    if (rare() < 0.035) add(sys, 'anomaly', '古代空间信号', true);
    if (rare() < 0.04) add(sys, 'ruins', '古代遗迹');
    if (rare() < 0.08) add(sys, 'derelict', '失落研究舰');
  }
  const paired = pairedSector(seed, coord),
    first = coord.q < paired.q || (coord.q === paired.q && coord.r < paired.r) ? coord : paired;
  const pairRandom = coordinateRandom(seed, first, 0x771234),
    wormholes: Wormhole[] = [];
  const fixedHole = fixedPassage(coord);
  if (
    (coord.q !== paired.q || coord.r !== paired.r) &&
    (fixedHole || (!fixedPassage(paired) && pairRandom() < 0.025))
  ) {
    const stability = fixedHole ? 1 : 0.45 + pairRandom() * 0.55;
    wormholes.push({
      id: 'wormhole:' + coord.q + ':' + coord.r,
      name: fixedHole ? 'DAWN PASSAGE / 曙光通道' : '亚空间通道 ' + coord.q + '/' + coord.r,
      sectorId: id,
      x: center.x + 90,
      y: center.y - 80,
      exit: { x: paired.q * SECTOR_SIZE + 90, y: paired.r * SECTOR_SIZE - 80 },
      exitSector: paired,
      discovered: false,
      surveyed: false,
      stability,
      stable: stability >= 0.7,
      transits: 0,
    });
  }
  return {
    sector: { ...coord, id, systemIds: systems.map((s) => s.id), discovered: false },
    systems,
    bodies,
    wormholes,
  };
}
export function materialize(w: WorldState, coord: SectorCoord) {
  const existing = w.sectors.find((s) => s.id === sectorId(coord));
  if (existing) return existing;
  const generated = generatedSector(w.initialSeed, coord);
  w.sectors.push(generated.sector);
  w.systems.push(...generated.systems);
  w.bodies.push(...generated.bodies);
  w.wormholes.push(...generated.wormholes);
  for (const b of generated.bodies.filter((b) => b.kind === 'derelict' && b.id !== VEIL_SITE))
    w.wrecks.push({
      id: 'wreck:' + b.id,
      name: b.name,
      x: b.x,
      y: b.y,
      stock: { materials: 40, photon: 0, quantum: 0, specialFinds: 0 },
      discovered: false,
    });
  return generated.sector;
}
export function frontierSectors(
  sectors: readonly { q: number; r: number; discovered: boolean }[],
): SectorCoord[] {
  const known = new Set(sectors.filter((s) => s.discovered).map(sectorId));
  const result = new Map<string, SectorCoord>();
  for (const s of sectors.filter((s) => s.discovered))
    for (const [dq, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, -1],
      [-1, 1],
    ]) {
      const c = { q: s.q + dq, r: s.r + dr };
      if (!known.has(sectorId(c))) result.set(sectorId(c), c);
    }
  return [...result.values()].sort((a, b) => a.q - b.q || a.r - b.r);
}
