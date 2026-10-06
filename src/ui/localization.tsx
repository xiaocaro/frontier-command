import type { Snapshot } from '../engine/types';
import { createContext } from 'react';

export const ChineseDisplay = createContext(false);
const names: Record<string, string> = {
  'Romulan Border Command': '罗慕伦边境指挥部',
  'D’Deridex': '德德里克斯级战鸟',
  'Valdore-type': '瓦尔多型战鸟',
  'Orion Hideout': '猎户座藏身基地',
  'SS FEDERATION EXCHANGE': '联邦交易商船',
  'USS MERIDIAN-1': '子午线一号',
  'USS MERIDIAN-2': '子午线二号',
  'USS MERIDIAN-3': '子午线三号',
  'VEIL DERELICT': '幽影号残骸',
  'Veil Derelict': '幽影号残骸',
  'Helios 金属矿床': '赫利俄斯金属矿床',
  'New Horizon M-class': '新曙宜居行星',
};
export function displayName(name: string, custom = false): string {
  if (custom) return name;
  if (names[name]) return names[name];
  if (/^DF-/.test(name))
    return name
      .replace(/^DF-/, '边疆星系 ')
      .replace(
        /-([A-Z])$/,
        (_, letter: string) => '／' + ('甲乙丙丁戊己庚辛壬癸'[letter.charCodeAt(0) - 65] ?? letter),
      );
  const parts = name.split(' / ');
  if (parts.length > 1 && /[\u3400-\u9fff]/.test(parts.at(-1)!)) return parts.at(-1)!;
  if (/^Orion (Raider|Scout|Corsair|Surveyor)/i.test(name)) {
    const number = name.match(/(\d+)$/)?.[1] ?? '';
    return (
      (/^Orion (Scout|Surveyor)/i.test(name) ? '猎户座侦察舰' : '猎户座袭击舰') +
      (number ? ' ' + number : '')
    );
  }
  return name
    .replaceAll('M-class', 'M型')
    .replace(/^Commander /, '指挥官 ')
    .replace(/^Cadet /, '学员 ')
    .replace(
      /^Romulan (Scout|Warbird)(.*)$/i,
      (_, role: string, suffix: string) =>
        (role.toLowerCase() === 'scout' ? '罗慕伦侦察舰' : '罗慕伦战鸟') + suffix,
    );
}
export const SHIP_LABELS: Record<string, string> = {
  veil: '幽影级侦察舰',
  antares: '心宿二级运输舰',
  peregrine: '游隼级巡逻舰',
  constitution: '宪法级',
  galaxy: '银河级',
  scout: '罗慕伦侦察舰',
  raider: '猎户座袭击舰',
  warbird: '罗慕伦战鸟',
  corsair: '猎户座掠夺舰',
};
const phrases: Record<string, string> = {
  'Orion Syndicate': '猎户座辛迪加',
  'Neutral Zone': '中立区',
  'Romulan territory': '罗慕伦领地',
  'Dawn Starbase': '曙光基地',
  'DAWN STARBASE': '曙光基地',
  'UNKNOWN SPACE': '未知空间',
  'UNCONFIRMED SITE': '未确认设施',
  'NEXT STEP': '下一步',
  'Deep Scan': '深层扫描',
  'Long Range Sensors': '远程传感器',
  'Precision Targeting': '精确瞄准',
  'Expanded Cargo': '扩展货舱',
  'Special Finds': '特殊发现',
  'Special Find': '特殊发现',
  'M-class': 'M型',
  Veil: '幽影号',
  giant: '巨星',
  neutron: '中子星',
  Wormhole: '虫洞',
  Federation: '联邦',
  Romulan: '罗慕伦',
  Orion: '猎户座',
  Dawn: '曙光',
  Commander: '指挥官',
  Admiral: '舰队司令',
  Credits: '预算',
  Hull: '血量',
  Starbase: '基地',
  Hail: '呼叫',
  SHADOW: '跟踪',
  Cadet: '学员',
  CLOSE: '关闭',
  starting: '准备',
  following: '跟踪中',
  travelling: '航行中',
  delivering: '交付中',
  loading: '装载中',
  refitting: '改装中',
  rearming: '装弹中',
  reserved: '已预留弹药',
  capturing: '接管中',
  unloading: '卸货中',
  Drydock: '维修坞',
  safe: '安全航线',
  direct: '直接航线',
  risky: '危险航线',
  Materials: '工业材料',
  materials: '工业材料',
  photon: '光子鱼雷',
  quantum: '量子鱼雷',
  specialFinds: '特殊发现',
  RETURN: '返回基地',
  HAUL: '运输',
  REFIT: '改装',
  PATROL: '巡逻',
  INTERCEPT: '拦截',
  Engines: '推进系统',
  Weapons: '武器系统',
  Core: '核心',
  LKP: '最后已知位置',
};
export function chineseText(text: string): string {
  let result = text;
  for (const [name, chinese] of Object.entries(names)) result = result.replaceAll(name, chinese);
  // Translate both halves of built-in bilingual names occurring inside engine reports.
  result = result.replace(/[A-Z][A-Z0-9 -]+\s*\/\s*([\u3400-\u9fff][\u3400-\u9fff0-9-]*)/g, '$1');
  for (const [english, chinese] of Object.entries(phrases)) {
    result = result.replace(new RegExp('\\b' + english + '\\b', 'g'), chinese);
  }
  return result.replace(/(下一步|未确认设施)\s+\1/g, '$1');
}

export function displayEntityName(
  world: Snapshot,
  entity: { readonly id: string; readonly name: string },
) {
  return displayName(
    entity.name,
    world.renamedEntityIds.includes(entity.id) ||
      (entity.id.startsWith('wreck:') && world.renamedEntityIds.includes(entity.id.slice(6))),
  );
}
export function worldText(world: Snapshot, text: string, translate = chineseText) {
  const protectedNames = [
    ...world.ships,
    ...world.locations,
    ...world.systems,
    ...world.bodies,
    ...world.projects,
    ...world.groups,
    ...world.losses.map((l) => ({ id: l.shipId, name: l.name })),
  ]
    .filter((e) => world.renamedEntityIds.includes(e.id))
    .map((e) => e.name)
    .sort((a, b) => b.length - a.length);
  let value = text;
  protectedNames.forEach((name, i) => {
    value = value.replaceAll(name, '\uE000' + i + '\uE001');
  });
  value = translate(value);
  protectedNames.forEach((name, i) => {
    value = value.replaceAll('\uE000' + i + '\uE001', name);
  });
  return value;
}
