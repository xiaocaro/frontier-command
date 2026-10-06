import { freezeDefinitions } from './freeze';
export interface WeaponDefinition {
  id: string;
  name: string;
  range: number;
  cooldown: number;
  damage: number;
  cost: number;
  accuracy: number;
  ammo: 'photon' | 'quantum' | null;
}
export const WEAPONS = freezeDefinitions({
  phaser: {
    id: 'phaser',
    name: 'Phaser',
    range: 110,
    cooldown: 3,
    damage: 16,
    cost: 9,
    accuracy: 0.9,
    ammo: null,
  },
  arrays: {
    id: 'arrays',
    name: 'Phaser Arrays',
    range: 140,
    cooldown: 3,
    damage: 24,
    cost: 14,
    accuracy: 0.92,
    ammo: null,
  },
  pulse: {
    id: 'pulse',
    name: 'Pulse Phaser',
    range: 85,
    cooldown: 2,
    damage: 12,
    cost: 8,
    accuracy: 0.88,
    ammo: null,
  },
  disruptor: {
    id: 'disruptor',
    name: 'Disruptor',
    range: 105,
    cooldown: 3,
    damage: 19,
    cost: 10,
    accuracy: 0.82,
    ammo: null,
  },
  photon: {
    id: 'photon',
    name: 'Photon Torpedo',
    range: 155,
    cooldown: 10,
    damage: 35,
    cost: 2,
    accuracy: 0.78,
    ammo: 'photon',
  },
  quantum: {
    id: 'quantum',
    name: 'Quantum Torpedo',
    range: 165,
    cooldown: 12,
    damage: 55,
    cost: 3,
    accuracy: 0.84,
    ammo: 'quantum',
  },
} satisfies Record<string, WeaponDefinition>);
export interface ShipClassDefinition {
  name: string;
  hull: number;
  shield: number;
  shieldRegen: number;
  core: number;
  coreRegen: number;
  warp: number;
  cargo: number;
  sensors: number;
  science: number;
  weapons: (keyof typeof WEAPONS)[];
  photon: number;
  quantum: number;
  cloak: boolean;
}
export const SHIP_CLASSES = freezeDefinitions({
  veil: {
    name: 'Veil Recon Scout',
    hull: 70,
    shield: 45,
    shieldRegen: 0.6,
    core: 100,
    coreRegen: 3,
    warp: 8,
    cargo: 10,
    sensors: 420,
    science: 110,
    weapons: ['phaser'],
    photon: 0,
    quantum: 0,
    cloak: true,
  },
  antares: {
    name: 'Antares Transport',
    hull: 110,
    shield: 65,
    shieldRegen: 0.5,
    core: 75,
    coreRegen: 2,
    warp: 5.5,
    cargo: 600,
    sensors: 125,
    science: 30,
    weapons: ['phaser'],
    photon: 0,
    quantum: 0,
    cloak: false,
  },
  peregrine: {
    name: 'Peregrine Patrol Craft',
    hull: 85,
    shield: 90,
    shieldRegen: 1,
    core: 90,
    coreRegen: 3,
    warp: 8,
    cargo: 12,
    sensors: 175,
    science: 45,
    weapons: ['pulse'],
    photon: 0,
    quantum: 0,
    cloak: false,
  },
  constitution: {
    name: 'Constitution',
    hull: 200,
    shield: 170,
    shieldRegen: 1.5,
    core: 150,
    coreRegen: 4,
    warp: 6.5,
    cargo: 35,
    sensors: 240,
    science: 90,
    weapons: ['phaser', 'photon'],
    photon: 24,
    quantum: 0,
    cloak: false,
  },
  galaxy: {
    name: 'Galaxy',
    hull: 380,
    shield: 330,
    shieldRegen: 2,
    core: 240,
    coreRegen: 4.5,
    warp: 10,
    cargo: 65,
    sensors: 210,
    science: 75,
    weapons: ['arrays', 'photon', 'quantum'],
    photon: 250,
    quantum: 50,
    cloak: false,
  },
  scout: {
    name: 'Romulan Scout',
    hull: 80,
    shield: 65,
    shieldRegen: 0.7,
    core: 100,
    coreRegen: 2,
    warp: 7,
    cargo: 10,
    sensors: 220,
    science: 70,
    weapons: ['disruptor'],
    photon: 0,
    quantum: 0,
    cloak: true,
  },
  valdore: {
    name: 'Valdore-type',
    hull: 210,
    shield: 190,
    shieldRegen: 1.4,
    core: 175,
    coreRegen: 3.5,
    warp: 6,
    cargo: 25,
    sensors: 200,
    science: 55,
    weapons: ['disruptor', 'photon'],
    photon: 20,
    quantum: 0,
    cloak: true,
  },
  dderidex: {
    name: 'D’Deridex',
    hull: 350,
    shield: 290,
    shieldRegen: 1.8,
    core: 240,
    coreRegen: 4,
    warp: 4,
    cargo: 50,
    sensors: 210,
    science: 60,
    weapons: ['disruptor', 'photon'],
    photon: 32,
    quantum: 0,
    cloak: true,
  },
  raider: {
    name: 'Orion Raider',
    hull: 95,
    shield: 55,
    shieldRegen: 0.4,
    core: 70,
    coreRegen: 2.5,
    warp: 6,
    cargo: 30,
    sensors: 210,
    science: 20,
    weapons: ['pulse', 'photon'],
    photon: 5,
    quantum: 0,
    cloak: false,
  },
} satisfies Record<string, ShipClassDefinition>);
export type ShipClassId = keyof typeof SHIP_CLASSES;
export const MODULE_SLOTS = freezeDefinitions({
  veil: 2,
  antares: 2,
  peregrine: 2,
  constitution: 3,
  galaxy: 4,
  scout: 2,
  valdore: 3,
  dderidex: 4,
  raider: 2,
});
export const INITIAL_FLEET = freezeDefinitions([
  { id: 'meridian', name: 'USS MERIDIAN-1', classId: 'antares' },
  { id: 'vigil', name: 'USS VIGIL / 守望号', classId: 'peregrine' },
  { id: 'verity', name: 'USS VERITY / 明理号', classId: 'constitution' },
  { id: 'horizon', name: 'USS HORIZON / 地平线号', classId: 'galaxy' },
  { id: 'meridian-2', name: 'USS MERIDIAN-2', classId: 'antares' },
  { id: 'meridian-3', name: 'USS MERIDIAN-3', classId: 'antares' },
] as const);
