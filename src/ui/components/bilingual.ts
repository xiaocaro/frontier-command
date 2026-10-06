const TRANSLATIONS: Record<string, string> = {
  'PRIORITY COMMUNICATIONS': '优先通信',
  'FLEET DIRECTIVES': '舰队指令',
  INTENT: '指挥意图',
  'FINAL COMMAND AUTHORITY': '最终指挥权',
  'ADMIRAL DIRECTIVE': '舰队司令指令',
  FLEET: '舰队',
  'ALL OWNED VESSELS': '全部己方舰船',
  'DAWN STARBASE': '曙光基地',
  SECTOR: '星区',
  OPERATIONS: '行动',
  PERSONNEL: '人员',
  STARBASE: '基地',
  COLONIES: '殖民地',
  ARCHIVE: '档案',
  'COMMAND RECORDS': '指挥记录',
  COMMAND: '指挥',
  SHIPYARD: '船坞',
  DRYDOCK: '维修坞',
  ARMORY: '军械库',
  ENGINEERING: '工程',
  LOGISTICS: '物流',
  'SENSOR CONTROL': '传感器控制',
  'DEFENSE GRID': '防御网络',
  'ACTUAL BASE INVENTORY': '基地实物库存',
  INDUSTRY: '工业',
  'PHYSICAL OUTPUT': '实物产出',
  'INDUSTRY QUEUE': '工业队列',
  FRONTIER: '边疆',
  MINES: '矿场',
  OUTPOSTS: '前哨',
  'CONSTRUCTION PROJECTS': '建设项目',
  'PERMANENT LOSSES': '永久损失',
  TIMELINES: '时间线',
  'PERSISTENT FRONTIER HISTORY': '持久边疆历史',
  'CONSOLE CONFIGURATION': '控制台设置',
  ANIMATIONS: '动画',
  SOUND: '音频',
  'COMMAND LOST': '指挥失效',
  'BEGIN NEW FRONTIER': '开启新边疆',
  'ESTABLISHING COMMAND LINK': '建立指挥连接',
  CREDITS: '预算',
  MATERIALS: '材料',
};
const CHINESE_TITLES: Record<string, string> = {
  未知接触: 'UNKNOWN CONTACT',
  残骸: 'WRECK',
  对象详情: 'CONTEXT INSPECTOR',
  舰队与编队: 'FLEET / TASK GROUPS',
  编辑编队: 'EDIT TASK GROUP',
  创建编队: 'CREATE TASK GROUP',
  常备命令: 'STANDING ORDERS',
  '当前指令 / 队列 / 挂起指令': 'DIRECTIVES / QUEUE / SUSPENDED',
  前沿建设: 'FRONTIER CONSTRUCTION',
  殖民地发展: 'COLONY DEVELOPMENT',
  '人员与 Cadet 培养': 'PERSONNEL / CADET TRAINING',
  持续世界事件: 'PERSISTENT WORLD EVENTS',
  世界机会与当前原因: 'WORLD OPPORTUNITIES',
  永久舰船损失: 'PERMANENT VESSEL LOSSES',
  货舱: 'CARGO',
  模块: 'MODULES',
  实际仓储: 'PHYSICAL STORAGE',
  世界坐标: 'WORLD POSITION',
};
export function bilingualTitle(text: string): string {
  for (const [chinese, english] of Object.entries(CHINESE_TITLES))
    if (text === chinese || text.startsWith(chinese + ' /')) return english + ' ' + text;
  if (/[\u3400-\u9fff]/.test(text)) return text;
  const parts = text.trim().split(/\s*\/\s*/);
  const translated = parts.map(
    (part) =>
      TRANSLATIONS[part] ??
      part.replace(
        /^(CREDITS|MATERIALS|PERMANENT LOSSES|PERSISTENT FRONTIER HISTORY)(\s.*)$/,
        (_, key: string, rest: string) => TRANSLATIONS[key] + rest,
      ),
  );
  return translated.some((part, i) => part !== parts[i])
    ? text + ' ' + translated.join(' / ')
    : text;
}
