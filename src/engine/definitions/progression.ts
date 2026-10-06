import type { Cost, FacilityKind, ModuleId, UpgradeId } from '../types';
import { freezeDefinitions } from './freeze';
export const cost = (credits = 0, materials = 0, specialFinds = 0): Cost => ({
  credits,
  materials,
  specialFinds,
});
export const MODULES = freezeDefinitions({
  deepScan: {
    label: 'Deep Scan',
    cost: cost(140, 25, 1),
    description: '发现系统内隐藏异常，深层调查获取特殊发现',
  },
  longRangeSensors: {
    label: 'Long Range Sensors',
    cost: cost(100, 20),
    description: '远距扫描范围翻倍，安全测绘更远 Sector',
  },
  precisionTargeting: {
    label: 'Precision Targeting',
    cost: cost(150, 30),
    description: '定向禁用 Engines / Weapons',
  },
  reinforcedShields: {
    label: 'Reinforced Shields',
    cost: cost(110, 25),
    description: '危险航段损伤减半，增加护盾承受力',
  },
  expandedCargo: {
    label: 'Expanded Cargo',
    cost: cost(80, 15),
    description: '增加50货舱空间，载运更大批次及建设物资',
  },
} satisfies Record<ModuleId, { label: string; cost: Cost; description: string }>);
export const UPGRADES = freezeDefinitions({
  shipyard: {
    label: 'Shipyard',
    cost: cost(220, 45),
    description: '解锁 Constitution / Galaxy 建造',
  },
  armory: {
    label: 'Armory',
    cost: cost(160, 30, 1),
    description: '光子与量子鱼雷制造耗时减半；基础军械库已可生产两种弹药',
  },
  sensors: {
    label: 'Sensor Network',
    cost: cost(140, 30),
    description: '联结前哨；前沿传感器扩大并支持主动扫描',
  },
  logistics: {
    label: 'Logistics',
    cost: cost(120, 25),
    description: '解锁持续货运线路与高速安全中继航段',
  },
  defense: {
    label: 'Defense Grid',
    cost: cost(180, 35),
    description: '解锁前沿防御平台，设施火控强化',
  },
} satisfies Record<UpgradeId, { label: string; cost: Cost; description: string }>);
export const FACILITIES = freezeDefinitions({
  base: { hull: 5000, shield: 3000, damage: 55, range: 230, cost: cost() },
  mine: { hull: 650, shield: 380, damage: 12, range: 110, cost: cost(165, 30) },
  outpost: { hull: 800, shield: 500, damage: 18, range: 160, cost: cost(200, 35) },
  colony: { hull: 1100, shield: 650, damage: 20, range: 170, cost: cost(280, 50) },
  platform: { hull: 850, shield: 600, damage: 35, range: 200, cost: cost(190, 35) },
} satisfies Record<
  FacilityKind,
  { hull: number; shield: number; damage: number; range: number; cost: Cost }
>);
export const BASE_REFIT = freezeDefinitions({
  cost: cost(500, 100),
  minutes: 30,
  captureMinutes: 10,
  captureRange: 12,
});
export const BUILD_COSTS = freezeDefinitions({
  peregrine: cost(220, 20),
  antares: cost(290, 30),
  constitution: cost(550, 65),
  galaxy: cost(860, 100),
});
