import type { Body, FactionId, FacilityKind, ReadonlyDeep } from '../../engine/types';

/** Object and faction meaning is defined here, independently of alert/selection decoration. */
export const MAP_PALETTE = Object.freeze({
  factions: { starfleet: '#55B9FF', romulan: '#49D17D', orion: '#CBD53A' },
  dawn: '#FFB347',
  facilities: {
    base: '#83CFFF',
    colony: '#8FAFEF',
    mine: '#78C9E5',
    outpost: '#9DDCE6',
    platform: '#638DE0',
  },
  planets: {
    荒芜岩石世界: '#B3A08E',
    气态巨行星: '#C39AE8',
    冰封世界: '#D8E3EC',
    火山世界: '#EE765C',
    海洋世界: '#8C9FD4',
    'M-class 宜居世界': '#DBABC6',
  },
  bodies: {
    planet: '#B3A08E',
    moon: '#B9BAC8',
    belt: '#8F809A',
    resource: '#EBD599',
    anomaly: '#ED80D7',
    ruins: '#BE8EB3',
    derelict: '#D3B2AD',
  },
  wormhole: '#A775FF',
  unknown: '#AAA9B9',
  project: '#C8A57B',
  wreck: '#D3B2AD',
  civilian: '#83CFFF',
  system: '#F1DECB',
  decoration: {
    ink: '#000000',
    grid: '#7C7192',
    charted: '#556B9B',
    unknownSpace: '#7C7192',
    selection: '#FCC19F',
    route: '#8BA1C5',
    danger: '#EF6262',
    sensor: '#55B9FF',
    destination: '#FFB347',
    friendlyBeam: '#FCC19F',
  },
} satisfies {
  factions: Record<FactionId, string>;
  dawn: string;
  facilities: Record<FacilityKind, string>;
  planets: Record<string, string>;
  bodies: Record<Body['kind'], string>;
  wormhole: string;
  unknown: string;
  project: string;
  wreck: string;
  civilian: string;
  system: string;
  decoration: Record<string, string>;
});
export const bodyColor = (body: ReadonlyDeep<Body>) =>
  body.kind === 'planet'
    ? (MAP_PALETTE.planets[body.category as keyof typeof MAP_PALETTE.planets] ??
      MAP_PALETTE.bodies.planet)
    : MAP_PALETTE.bodies[body.kind];
export const facilityColor = (id: string, faction: FactionId, kind: FacilityKind) =>
  id === 'base' && faction === 'starfleet'
    ? MAP_PALETTE.dawn
    : faction === 'starfleet'
      ? MAP_PALETTE.facilities[kind]
      : MAP_PALETTE.factions[faction];
export const MAP_LEGEND = [
  ['Federation 联邦', MAP_PALETTE.factions.starfleet],
  ['Dawn 曙光基地', MAP_PALETTE.dawn],
  ['Romulan 罗慕伦', MAP_PALETTE.factions.romulan],
  ['Orion 猎户座', MAP_PALETTE.factions.orion],
  ['Resource 矿藏', MAP_PALETTE.bodies.resource],
  ['Anomaly 异常', MAP_PALETTE.bodies.anomaly],
  ['Wormhole 虫洞', MAP_PALETTE.wormhole],
] as const;
