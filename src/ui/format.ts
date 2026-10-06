import { chineseText, worldText } from './localization';
import type { Action, Ship, Snapshot, ReadonlyDeep } from '../engine/types';
import { capabilities } from '../engine/capabilities';
import { dist, currentMovementSpeed } from '../engine/navigation';
export const ACTION_LABELS: Record<Action['type'], string> = {
  MOVE: '移动',
  EXPLORE: '探索星区',
  SURVEY: '调查',
  RETURN: '返回基地',
  ASSIST_EVENT: '响应事件',
  TRANSIT: '穿越虫洞',
  CAPTURE: '接管基地遗址',
  HAIL: '呼叫通信',
  HAUL: '运输货物',
  ATTACK: '攻击',
  DISABLE: '压制子系统',
  DRIVE_OFF: '驱离',
  INTERCEPT: '拦截',
  SHADOW: '跟踪',
  ESCORT: '护航',
  PATROL: '巡逻',
  RETREAT: '撤退',
  DOCK: '停靠',
  REPAIR: '维修',
  REARM: '补充弹药',
  REFIT: '改装',
  UNLOAD: '卸货',
  RECOVER: '打捞货物',
};
export function actionProgress(
  world: Snapshot,
  s: ReadonlyDeep<Ship>,
): { text: string; fraction: number | null } {
  if (!s.current)
    return { text: (s.status === 'docked' ? '已停靠' : '待命') + ' · 可下达指令', fraction: null };
  let at = { x: s.x, y: s.y },
    length = 0;
  for (const p of s.path) {
    length += dist(at, p);
    at = p;
  }
  return {
    text:
      length > 10
        ? '航行约 ' +
          Math.ceil(length / currentMovementSpeed(world, s)) +
          ' 分钟 · ' +
          describe(s.current.note, world)
        : describe(s.current.note || s.current.phase, world),
    fraction: null,
  };
}

export const GOODS_LABELS = {
  materials: '工业材料',
  photon: '光子鱼雷',
  quantum: '量子鱼雷',
  specialFinds: '特殊发现',
};
export const FACILITY_LABELS = {
  base: '基地',
  colony: '殖民地',
  mine: '矿场',
  outpost: '前哨',
  platform: '防御平台',
};
export const BODY_LABELS = {
  planet: '行星',
  moon: '卫星',
  belt: '小行星带',
  resource: '资源点',
  anomaly: '异常',
  ruins: '遗迹',
  derelict: '失落舰船',
};
export function describe(text: string, world?: Snapshot) {
  const words: Record<string, string> = {
    starting: '开始',
    Drydock: '船坞',
    materials: '工业材料',
    photon: '光子鱼雷',
    quantum: '量子鱼雷',
    specialFinds: '特殊发现',
    loading: '装载中',
    delivering: '交付中',
    refitting: '改装中',
    rearming: '装弹中',
    unloading: '卸货中',
    safe: '安全航线',
    direct: '直接航线',
    risky: '危险航线',
    RETURN: '返回基地',
    HAUL: '运输',
    Engineering: '工程',
    REFIT: '改装',
    SHADOW: '跟踪',
    PATROL: '巡逻',
    INTERCEPT: '拦截',
    ENGINES: '推进系统',
    WEAPONS: '武器系统',
    SCAN: '扫描',
    DEEP: '深层',
    Materials: '工业材料',
    Core: '核心',
    Close: '近距',
    Remote: '远距',
    Scan: '扫描',
    Survey: '调查',
    Escort: '护航',
    Patrol: '巡逻',
    Shadow: '跟踪',
    Intercept: '拦截',
    Hull: '血量',
    Engines: '推进系统',
    Weapons: '武器系统',
    engines: '推进系统',
    weapons: '武器系统',
    PHOTON: '光子鱼雷',
    QUANTUM: '量子鱼雷',
  };
  const translate = (value: string) =>
    chineseText(value.replace(/\b[A-Za-z]+\b/g, (word) => words[word] ?? word));
  return world ? worldText(world, text, translate) : translate(text);
}
