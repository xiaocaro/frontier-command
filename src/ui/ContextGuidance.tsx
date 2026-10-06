import type { Snapshot, Action } from '../engine/types';
import type { Selection } from '../StrategicMap';
import type { ComposerRequest } from './OrderComposer';
import { LcarsButton, LcarsTextBar } from './components/Lcars';
import { capabilities, cargoUsed } from '../engine/capabilities';
import { defaultAction } from './OrderComposer';
import { MineAccidentStatus } from './MineAccidentStatus';
export function ContextGuidance({
  world,
  selection,
  selectedShipIds,
  create,
  select,
}: {
  world: Snapshot;
  selection: Selection | null;
  selectedShipIds: string[];
  create: (r: ComposerRequest) => void;
  select: (s: Selection) => void;
}) {
  const button = (label: string, action: Action) => (
    <LcarsButton onClick={() => create({ action })}>{label}</LcarsButton>
  );
  let content: React.ReactNode = null;
  const id = selection && 'id' in selection ? selection.id : '';
  const body = world.bodies.find((b) => b.id === id),
    location = world.locations.find((l) => l.id === id),
    ship = world.ships.find((s) => s.id === id),
    project = world.projects.find((p) => p.id === id),
    accident = world.events.find(
      (v) =>
        v.kind === 'accident' && v.subjectId === id && ['reported', 'responding'].includes(v.stage),
    );
  if (body?.kind === 'derelict') {
    const event = world.events.find((v) => v.kind === 'derelict' && v.subjectId === body.id);
    const wreck = world.wrecks.find((x) => x.id === 'wreck:' + body.id);
    if (body.survey < 2)
      content = (
        <>
          <p>下一步：近距调查无人舰桥，完成后可现场响应。</p>
          {button('近距调查无人舰船', {
            type: 'SURVEY',
            targetId: id,
            approach: 'close',
            deep: false,
          })}
        </>
      );
    else if (event && ['reported', 'responding'].includes(event.stage))
      content = (
        <>
          <p>
            {event.stage === 'responding'
              ? '现场接管正在执行，可查看下方进度；无需重复调查。'
              : '调查已完成。下一步派舰抵达残骸并接管，无需再做一次调查。'}
          </p>
          {button(body.id === 'veil-derelict' ? '派舰现场接管' : '派舰现场响应', {
            type: 'ASSIST_EVENT',
            targetId: event.id,
          })}
        </>
      );
    else if (wreck && Object.values(wreck.stock).some((n) => n > 0))
      content = (
        <>
          <p>现场事件已完成，下一步打捞剩余真实货物。</p>
          {button('打捞剩余货物', { type: 'RECOVER', targetId: wreck.id })}
        </>
      );
    else
      content = (
        <>
          <p>此地点已完成。可右键移除无价值标记，历史仍保留。</p>
          {body.id === 'veil-derelict' && world.ships.some((s) => s.id === 'veil') && (
            <LcarsButton onClick={() => select({ type: 'ship', id: 'veil' })}>
              选择幽影号 / 开启隐形并跟踪
            </LcarsButton>
          )}
        </>
      );
  } else if (body && body.survey < 2)
    content = (
      <>
        <p>近距调查后才能确认矿藏、宜居性及建设条件。</p>
        {button('近距确认地点', { type: 'SURVEY', targetId: id, approach: 'close', deep: false })}
      </>
    );
  else if (body?.kind === 'resource') {
    const mine = world.locations.find((l) => l.siteId === id && l.kind === 'mine' && l.hull > 0),
      p = world.projects.find((p) => p.siteId === id && !p.complete);
    content = mine ? (
      <>
        <p>已有矿场；下一步把实际工业材料运回曙光。</p>
        <LcarsButton onClick={() => select({ type: 'location', id: mine.id })}>
          查看矿场与运输
        </LcarsButton>
      </>
    ) : p ? (
      <>
        <p>建设项目已建立，需要运送材料到现场。</p>
        <LcarsButton onClick={() => select({ type: 'project', id: p.id })}>
          查看现场材料缺口
        </LcarsButton>
      </>
    ) : (
      <p>
        {body.remaining > 0
          ? '已确认可采矿藏。下一步在下方建立矿场项目，再派货船运入建设材料。'
          : '矿藏已耗尽，继续探索其他资源点。'}
      </p>
    );
  } else if (project && !project.complete)
    content = (
      <p>
        {project.stock.materials < project.cost.materials
          ? '下一步：把 曙光 的材料运入项目，交付后才会施工。'
          : '材料已齐备，施工按游戏时间推进；暂停时进度不会增长。'}
      </p>
    );
  else if (location?.kind === 'mine' && location.owner === 'starfleet' && accident)
    content = (
      <>
        <MineAccidentStatus world={world} event={accident} create={create} />
        {button('派舰现场响应', { type: 'ASSIST_EVENT', targetId: accident.id })}
      </>
    );
  else if (location?.kind === 'mine' && location.owner === 'starfleet')
    content = (
      <>
        <p>
          {location.storageFull
            ? '矿场满仓停产，运输释放仓位后恢复。'
            : '矿场持续产出工业材料；运回基地才能用于造舰和升级。'}
        </p>
        {button('矿场 → 曙光 运输材料', {
          ...(defaultAction('HAUL', world, selection) as Extract<Action, { type: 'HAUL' }>),
          amount: Math.min(
            20,
            ...world.ships
              .filter((s) => selectedShipIds.includes(s.id))
              .map((s) => capabilities(s).cargo),
          ),
        })}
      </>
    );
  else if (location?.id === 'base')
    content = (
      <p>
        预算 是指挥预算；其他资源必须实际存入 曙光。先安排矿场运输，再进入 基地
        建造、升级或制造弹药。
      </p>
    );
  else if (location?.colony) content = null;
  else if (ship?.current?.action.type === 'SHADOW')
    content = (
      <p>
        跟踪只使用本舰真实观测。普通舰可能暴露；幽影号可隐形尾随。失联后搜索最后观测位置；发现疑似地点后持续现场侦察
        10 游戏分钟以确认基地。
      </p>
    );
  else if (ship && cargoUsed(ship) > 0)
    content = (
      <>
        <p>货物仍在舰上；只返回不会自动卸货，需明确下达卸货。</p>
        {button('返回 曙光 并卸货', { type: 'UNLOAD', targetId: 'base' })}
      </>
    );
  else if (ship?.classId === 'veil')
    content = (
      <p>幽影号适合侦察与跟踪。开启隐形后选择 猎户座／罗慕伦 接触并下达 跟踪；开火会解除隐形。</p>
    );
  else if (selection?.type === 'wormhole')
    content = (
      <p>穿越后镜头会跟随实际抵达出口的舰船。手动拖动或缩放地图可取消跟随；出口区域可继续调查。</p>
    );
  else if (selection?.type === 'contact')
    content = (
      <p>先识别接触，再选择跟踪、拦截或外交呼叫。罗慕伦 未确认敌对时，攻击会产生政治后果。</p>
    );
  else if (
    selection?.type === 'point' ||
    selection?.type === 'sector' ||
    selection?.type === 'system'
  )
    content = (
      <p>
        先选舰，再选地点：探索未知星区 → 近距调查 → 建设矿场 → 运输材料 → 造舰与升级，继续拓展边疆。
      </p>
    );
  if (!content) return null;
  return (
    <section className="context-guidance" aria-label="下一步提示">
      <LcarsTextBar>NEXT STEP 下一步</LcarsTextBar>
      {content}
    </section>
  );
}
