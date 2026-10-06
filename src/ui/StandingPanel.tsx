import type { ReadonlyDeep, Ship, StandingOrders } from '../engine/types';
import type { CommandSender } from './types';
import { LcarsField, LcarsTextBar } from './components/Lcars';
export function StandingPanel({
  ship,
  command,
}: {
  ship: ReadonlyDeep<Ship>;
  command: CommandSender;
}) {
  const set = (patch: Partial<StandingOrders>) =>
    command({ type: 'standingOrders', shipId: ship.id, orders: { ...ship.standing, ...patch } });
  const numbers: [
    keyof Pick<
      StandingOrders,
      | 'retreatHull'
      | 'retreatShield'
      | 'retreatCore'
      | 'photonThreshold'
      | 'quantumThreshold'
      | 'maxPursuit'
    >,
    string,
  ][] = [
    ['retreatHull', '血量撤退阈值 %'],
    ['retreatShield', '护盾撤退阈值 %'],
    ['retreatCore', '核心撤退阈值 %'],
    ['photonThreshold', '光子鱼雷报告阈值 %'],
    ['quantumThreshold', '量子鱼雷报告阈值 %'],
    ['maxPursuit', '自主追击最大距离'],
  ];
  const toggles: [
    keyof Pick<
      StandingOrders,
      | 'allowNeutral'
      | 'allowRomulan'
      | 'autoEscort'
      | 'respondDistress'
      | 'protectCivilian'
      | 'protectFreighter'
      | 'protectColony'
      | 'serviceWhenDocked'
    >,
    string,
  ][] = [
    ['allowNeutral', '允许自主进入 中立区'],
    ['allowRomulan', '允许自主进入 罗慕伦领地'],
    ['autoEscort', '自动护航'],
    ['respondDistress', '自动响应求救'],
    ['protectCivilian', '保护民用舰船'],
    ['protectFreighter', '保护运输舰'],
    ['protectColony', '保护殖民地'],
    ['serviceWhenDocked', '已停靠时维修与装弹'],
  ];
  return (
    <>
      <LcarsTextBar>常备命令</LcarsTextBar>
      <LcarsField>
        自主交战规则
        <select
          aria-label="自主交战规则"
          value={ship.standing.roe}
          onChange={(e) => set({ roe: e.target.value as StandingOrders['roe'] })}
        >
          <option value="HOLD FIRE">禁止自主开火</option>
          <option value="RETURN FIRE">遭袭或保护对象受袭时还击</option>
          <option value="ENGAGE HOSTILES">交战已确认敌对目标</option>
        </select>
      </LcarsField>
      {numbers.map(([key, label]) => (
        <LcarsField key={key}>
          {label}
          <input
            aria-label={label}
            type="number"
            min={0}
            max={key === 'maxPursuit' ? 2000 : key.startsWith('retreat') ? 90 : 100}
            defaultValue={ship.standing[key]}
            onBlur={(e) => {
              const n = Number(e.target.value);
              if (n !== ship.standing[key]) void set({ [key]: n });
            }}
          />
        </LcarsField>
      ))}
      {toggles.map(([key, label]) => (
        <LcarsField className="check" key={key}>
          <input
            type="checkbox"
            checked={ship.standing[key]}
            onChange={(e) => set({ [key]: e.target.checked })}
          />
          {label}
        </LcarsField>
      ))}
      <p className="muted">舰队司令 的当前、排队和挂起指令优先；常备命令只管理自主行为。</p>
    </>
  );
}
