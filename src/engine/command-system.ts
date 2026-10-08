import { productionCost, manufactureCost } from './production';
export { manufactureCost } from './production';
import { inventory, available } from './inventory';
import { STORAGE } from './definitions/frontier';
import { validateFrontierCommand, applyFrontierCommand } from './frontier-commands';
import type { SimulationEngine } from './engine';
import type {
  Action,
  AgentInteraction,
  AgentMessage,
  AgentMessageKind,
  Command,
  CommandResult,
  Cost,
  Directive,
  Ship,
  WorldState,
} from './types';
import { GOODS } from './types';
import {
  AGENT_INTERACTION_CAP,
  AGENT_MESSAGE_CAP,
  applyInteraction,
  createMessage,
  createsInteraction,
  interactionOutcomeFor,
  isTaskOfferKind,
  overrideMemory,
} from './agent/interactions';
import { remember } from './agent/memory';
import { settleAgentEvent, agentOfShip } from './agent/events';
import { actionSchema, commandSchema } from './commands';
import { emptyStock } from './data';
import { capabilities, cargoUsed } from './capabilities';
import { BUILD_COSTS, FACILITIES, UPGRADES, BASE_REFIT, cost } from './definitions/progression';
import { RULES } from './definitions/rules';
import { SHIP_CLASSES } from './definitions/ships';
import { markerRemovalReason } from './map-markers';
export const ok = (reason = '命令已接受'): CommandResult => ({ ok: true, reason });
export const no = (reason: string): CommandResult => ({ ok: false, reason });
export { inventory, available } from './inventory';
export function canPay(e: SimulationEngine, c: Cost, locationId = 'base') {
  return (
    e.state.resources.credits + 1e-8 >= c.credits &&
    (['materials', 'specialFinds'] as const).every(
      (k) => available(e.state, locationId, k) + 1e-8 >= c[k],
    )
  );
}
export function pay(e: SimulationEngine, c: Cost, locationId = 'base') {
  e.state.resources.credits = Math.max(0, e.state.resources.credits - c.credits);
  const holder = inventory(e.state, locationId)!;
  for (const k of ['materials', 'specialFinds'] as const) {
    holder.stock[k] = Math.max(0, holder.stock[k] - c[k]);
  }
}
export function validateAction(e: SimulationEngine, s: Ship, a: Action): CommandResult {
  return validateActionIn(e.state, s, a);
}
/**
 * The same rule check, against a `WorldState` instead of an engine.
 *
 * Lv3's candidate generation (`src/engine/agent/actions.ts`) must guarantee at generation time that
 * an Agent is never offered an action the engine would refuse (KNOWN_ISSUES N-8). Routing that
 * through here keeps `validateAction` the single rules authority instead of growing a second,
 * drifting copy of the preconditions. Behaviour is identical — the engine form only unwraps
 * `e.state`.
 */
export function validateActionIn(w: WorldState, s: Ship, a: Action): CommandResult {
  if (a.type === 'MOVE' || a.type === 'RETURN') return ok();
  if (a.type === 'ASSIST_EVENT') {
    const event = w.events.find(
      (v) => v.id === a.targetId && ['reported', 'responding'].includes(v.stage),
    );
    if (!event) return no('事件已结束或不存在');
    if (['invasion', 'diplomatic'].includes(event.kind))
      return no('军事与外交事件需要实际防卫、通信或撤离行动');
    return ok();
  }
  if (a.type === 'CAPTURE') {
    const target = w.locations.find(
      (l) =>
        l.id === a.targetId && l.discovered && l.occupation === 'ruined' && l.owner !== 'starfleet',
    );
    if (!target) return no('目标不是可接管的基地遗址');
    if (
      w.ships.some(
        (other) =>
          other.id !== s.id &&
          [other.current, ...other.suspended].some(
            (d) => d?.action.type === 'CAPTURE' && d.action.targetId === target.id,
          ),
      )
    )
      return no('已有舰船正在接管该遗址');
    return ok();
  }
  if (a.type === 'TRANSIT')
    return w.wormholes.some((h) => h.id === a.targetId && h.discovered) ? ok() : no('通道尚未发现');
  if (a.type === 'HAIL' && (s.cooldowns.hail ?? 0) > 0)
    return no('通信频道正在冷却，请稍后再次呼叫');
  if (a.type === 'HAIL')
    return w.intel.some((i) => i.id === a.targetId && i.live && i.factionId === 'romulan')
      ? ok()
      : no('需要已识别的实时 Romulan 接触');
  if (a.type === 'EXPLORE') {
    if (
      !w.sectors.some(
        (c) =>
          c.discovered &&
          Math.max(Math.abs(c.q - a.sector.q), Math.abs(c.r - a.sector.r)) <=
            (s.modules.includes('longRangeSensors') ? 2 : 1),
      )
    )
      return no('请从已知边疆继续探索；远程传感器可延伸候选范围');
    return ok();
  }
  if (a.type === 'SURVEY') {
    const b = w.bodies.find((b) => b.id === a.targetId && b.discovered),
      sys = w.systems.find((x) => x.id === a.targetId && x.discovered);
    if (!b && !sys) return no('目标尚未发现');
    if (a.deep && !s.modules.includes('deepScan')) return no('需要 Deep Scan 模块');
    return ok();
  }
  if (a.type === 'HAUL') {
    const src = inventory(w, a.sourceId),
      dst = inventory(w, a.targetId);
    if (!src || !dst || src.id === dst.id) return no('请选择不同的己方库存或建设项目');
    if (a.amount > capabilities(s).cargo) return no('货舱容量不足，请分批或安装 Expanded Cargo');
    if (a.repeat && !w.upgrades.logistics) return no('持续货运需要 Logistics 升级');
    return ok();
  }
  if (a.type === 'SHADOW')
    return w.intel.some(
      (i) => i.id === a.targetId && !i.resolved && w.time - i.lastSeen <= RULES.intelTTL,
    )
      ? ok()
      : no('需要已观测的舰船接触');
  if (
    a.type === 'ATTACK' ||
    a.type === 'DISABLE' ||
    a.type === 'DRIVE_OFF' ||
    a.type === 'INTERCEPT'
  ) {
    if (a.subsystem && (a.type !== 'DISABLE' || !s.modules.includes('precisionTargeting')))
      return no('定向禁用需要 Precision Targeting');
    return w.intel.some(
      (i) => i.id === a.targetId && !i.resolved && w.time - i.lastSeen <= RULES.intelTTL,
    ) ||
      w.locations.some(
        (l) => l.id === a.targetId && l.owner !== 'starfleet' && l.discovered && l.hull > 0,
      )
      ? ok()
      : no('目标不存在或情报已过期');
  }
  if (a.type === 'ESCORT')
    return a.targetId !== s.id && [...w.ships, ...w.civilians].some((x) => x.id === a.targetId)
      ? ok()
      : no('请选择其他己方舰船');
  if (a.type === 'RECOVER')
    return w.wrecks.some((x) => x.id === a.targetId && x.discovered) ? ok() : no('残骸尚未发现');
  const dest = w.locations.find(
    (l) => l.id === a.targetId && l.owner === 'starfleet' && l.hull > 0,
  );
  if (!dest) return no('己方设施不可用');
  if (a.type === 'REFIT') {
    const installed = s.modules.includes(a.moduleId);
    if (a.remove && !installed) return no('模块未安装');
    if (!a.remove && (installed || s.modules.length >= capabilities(s).moduleSlots))
      return no('模块已安装或槽位已满');
    if (a.remove && a.moduleId === 'expandedCargo' && cargoUsed(s) > capabilities(s).cargo - 50)
      return no('请先卸货，拆除后货舱容量不足');
  }
  if (
    a.type === 'REARM' &&
    (a.load.photon + s.photon > capabilities(s).photon ||
      a.load.quantum + s.quantum > capabilities(s).quantum ||
      a.load.photon + a.load.quantum === 0)
  )
    return no('装弹数量超出弹舱余量');
  return ok();
}
export function validate(
  this: SimulationEngine,
  input: unknown,
  actorId = 'commander',
): CommandResult {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) return no('命令格式无效或数值越界');
  const c = parsed.data as Command,
    w = this.state;
  if (w.status !== 'active') return no('COMMAND LOST：只能恢复昨日或开始新边疆');
  if (
    actorId !== w.commander.id &&
    !(
      c.type === 'issueDirective' &&
      c.shipIds.length === 1 &&
      w.assignments.some((a) => a.operatorId === actorId && a.shipId === c.shipIds[0])
    ) &&
    // Lv3: the single relaxation, and it is exactly as wide as "an Agent may speak as itself".
    // Widening it further would let an Agent impersonate the Admiral or another Agent.
    !(c.type === 'agentMessage' && c.from === actorId && c.from !== 'admiral')
  )
    return no('该操作者无此命令权限');
  if (c.type === 'issueDirective') {
    for (const id of c.shipIds) {
      const s = w.ships.find((s) => s.id === id);
      if (!s) return no('舰船不存在');
      if (
        (c.mode === 'QUEUE' && s.queue.length >= 32) ||
        (c.mode === 'INTERRUPT' && s.current && s.suspended.length >= 16)
      )
        return no('指令队列已满');
      const v = validateAction(this, s, c.action);
      if (!v.ok) return v;
    }
    if (c.action.type === 'CAPTURE' && c.shipIds.length !== 1) return no('请选择一艘舰船现场接管');
    if (c.action.type === 'REARM') {
      const a = c.action;
      const immediateCount = w.ships.filter(
        (s) => c.shipIds.includes(s.id) && !(c.mode === 'QUEUE' && s.current?.source === 'admiral'),
      ).length;
      const stock = inventory(w, a.targetId);
      if (!stock) return no('装弹设施不可用');
      for (const k of ['photon', 'quantum'] as const) {
        const released =
          c.mode === 'REPLACE'
            ? w.ships
                .filter((s) => c.shipIds.includes(s.id))
                .flatMap((s) => [s.current, ...s.suspended])
                .reduce(
                  (sum, d) =>
                    sum +
                    (d && 'targetId' in d.action && d.action.targetId === a.targetId
                      ? d.reserved[k]
                      : 0),
                  0,
                )
            : 0;
        if (a.load[k] * immediateCount > available(w, a.targetId, k) + released)
          return no((k === 'photon' ? '光子' : '量子') + '鱼雷可用库存不足');
      }
    }
    return ok();
  }
  if (c.type === 'dismissMapMarker') {
    const reason = markerRemovalReason(w, c.entityId);
    return reason ? no(reason) : ok();
  }
  if (c.type === 'agentMessage') {
    if (c.from !== 'admiral' && !w.agents.some((a) => a.id === c.from))
      return no('发送方不是有效的 Agent');
    if (c.to !== 'admiral' && !w.agents.some((a) => a.id === c.to))
      return no('接收方不是有效的 Agent');
    if (c.from === c.to) return no('不能向自己发送消息');
    return ok();
  }
  if (c.type === 'agentEvent') {
    // Settlement facts are engine-originated, but they arrive through the same `dispatchCommand` door
    // as everything else (CLAUDE.md §2.1). Each kind is bounded to facts this world can actually
    // settle; anything else is refused rather than silently ignored.
    const event = c.event;
    switch (event.kind) {
      case 'mission-settled':
      case 'discovery':
        // Addressed by ship — and a ship only settles an Agent if one stands behind it.
        if (!w.ships.some((s) => s.id === event.shipId)) return no('结算目标舰船不存在');
        if (!agentOfShip(w, event.shipId)) return no('该舰船没有对应的 Agent');
        return ok();
      case 'promise-made':
        return w.agents.some((a) => a.id === event.toAgentId)
          ? ok()
          : no('承诺对象不是有效的 Agent');
      case 'team-resolved':
        if (event.aAgentId === event.bAgentId) return no('不能与自己组队');
        return w.agents.some((a) => a.id === event.aAgentId) &&
          w.agents.some((a) => a.id === event.bAgentId)
          ? ok()
          : no('组队双方不是有效的 Agent');
      case 'module-installed':
        // World-scoped: whoever holds the matching pending promise is settled, and it is legitimate
        // for that to be nobody.
        return ok();
    }
  }
  const frontierResult = validateFrontierCommand(this, c);
  if (frontierResult) return frontierResult;
  if (c.type === 'cancelDirective' || c.type === 'standingOrders')
    return w.ships.some((s) => s.id === c.shipId) ? ok() : no('舰船不存在');
  if (c.type === 'setCloak') {
    const s = w.ships.find((s) => s.id === c.shipId);
    return s && SHIP_CLASSES[s.classId].cloak && (!c.enabled || s.core >= 5)
      ? ok()
      : no('舰船没有隐形能力或 Core 不足');
  }
  if (c.type === 'renameEntity')
    return w.ships.some((s) => s.id === c.entityId) ||
      w.locations.some((l) => l.id === c.entityId && l.owner === 'starfleet') ||
      w.systems.some((s) => s.id === c.entityId && s.discovered) ||
      w.bodies.some((b) => b.id === c.entityId && b.discovered && b.kind === 'planet')
      ? ok()
      : no('对象不可命名');
  if (c.type === 'startConstruction') {
    const b = w.bodies.find((b) => b.id === c.siteId && b.discovered),
      sys = w.systems.find((s) => s.id === c.siteId && s.discovered);
    if (!b && !sys) return no('请选择已发现地点');
    if (b?.kind === 'derelict') return no('失落舰船需要调查与接管，不能建设设施');
    if ((b?.survey ?? sys?.survey ?? 0) < 2) return no('建设需要近距调查');
    if (c.kind === 'mine' && (!b || b.kind !== 'resource' || b.remaining <= 0))
      return no('矿场需要可采矿藏');
    if (c.kind === 'colony' && (!b || b.kind !== 'planet' || !b.habitable))
      return no('殖民地需要已确认宜居星球');
    if (c.kind === 'platform' && !w.upgrades.defense) return no('需要 Defense Grid 升级');
    if (
      w.projects.some((p) => p.siteId === c.siteId && p.kind === c.kind) ||
      w.locations.some((l) => l.siteId === c.siteId && l.kind === c.kind && l.hull > 0)
    )
      return no('该地点已有同类设施或项目');
    return w.resources.credits >= FACILITIES[c.kind].cost.credits ? ok() : no('Credits 不足');
  }
  if (c.type === 'buildShip' || c.type === 'manufacture' || c.type === 'upgrade') {
    if (
      !w.locations.some(
        (l) =>
          l.id === (c.locationId ?? 'base') &&
          l.owner === 'starfleet' &&
          l.kind === 'base' &&
          l.hull > 0 &&
          !l.occupation,
      )
    )
      return no('生产基地不可用');
  }
  if (c.type === 'startBaseRefit') {
    const l = w.locations.find(
      (l) => l.id === c.locationId && l.owner === 'starfleet' && l.occupation === 'secured',
    );
    return l && w.resources.credits >= BASE_REFIT.cost.credits
      ? ok()
      : no('遗址尚未接管、已在改建或预算不足');
  }
  if (c.type === 'buildShip') {
    if (!(c.classId in BUILD_COSTS)) return no('不可建造此舰级');
    if ((c.classId === 'constitution' || c.classId === 'galaxy') && !w.upgrades.shipyard)
      return no('需要 Shipyard 升级');
    return canPay(
      this,
      productionCost(w, BUILD_COSTS[c.classId as keyof typeof BUILD_COSTS]),
      c.locationId,
    )
      ? ok()
      : no('造舰预算或实物库存不足');
  }
  if (c.type === 'upgrade') {
    if (
      w.upgrades[c.upgradeId] ||
      w.jobs.some(
        (j) => j.kind === 'upgrade' && j.key === c.upgradeId && !j.complete && !j.cancelled,
      )
    )
      return no('已升级或正在施工');
    return canPay(this, UPGRADES[c.upgradeId].cost, c.locationId) ? ok() : no('升级预算或库存不足');
  }
  if (c.type === 'manufacture') {
    return canPay(this, productionCost(w, manufactureCost(c.cargoKind, c.amount)), c.locationId)
      ? ok()
      : no('制造预算或材料不足');
  }
  if (c.type === 'sellStock')
    return available(w, 'base', c.cargoKind) >= c.amount ? ok() : no('可出售库存不足');
  if (c.type === 'repairFacility') {
    const l = w.locations.find(
      (l) => l.id === c.locationId && l.owner === 'starfleet' && l.hull > 0 && l.hull < l.maxHull,
    );
    return l && available(w, l.id, 'materials') >= 1 ? ok() : no('本地材料不足或设施无需维修');
  }
  if (c.type === 'acknowledge')
    return w.communications.some((m) => m.id === c.communicationId) ? ok() : no('通信不存在');
  return ok();
}
/** Revalidate what remains, rather than charging or loading an interrupted action twice. */
export function validateContinuation(e: SimulationEngine, s: Ship, d: Directive): CommandResult {
  const a = d.action;
  if (a.type === 'REARM' && d.phase === 'rearming')
    return validateAction(e, s, {
      ...a,
      load: { photon: d.reserved.photon, quantum: d.reserved.quantum },
    });
  return validateAction(e, s, a);
}
export function makeDirective(e: SimulationEngine, action: Action): Directive {
  return {
    id: 'directive-' + e.state.nextId++,
    action: structuredClone(action),
    created: e.state.time,
    phase: 'starting',
    work: 0,
    moved: 0,
    carried: 0,
    delivered: 0,
    reserved: emptyStock(),
    paidCredits: 0,
    search: 0,
    note: '',
    source: 'admiral',
    groupOrderId: null,
    groupSlot: 0,
    groupTotal: 0,
    groupSpacing: 30,
    origin: { x: 0, y: 0 },
  };
}
export function dispatchCommand(
  this: SimulationEngine,
  input: unknown,
  actorId = 'commander',
): CommandResult {
  const valid = this.validate(input, actorId);
  if (!valid.ok) return valid;
  const c = commandSchema.parse(input) as Command,
    w = this.state;
  const applied = applyFrontierCommand(this, c);
  if (applied) return applied;
  if (c.type === 'dismissMapMarker') {
    const ids = [c.entityId];
    if (w.bodies.some((b) => b.id === c.entityId)) {
      const wreck = w.wrecks.find((x) => x.id === 'wreck:' + c.entityId);
      if (wreck) ids.push(wreck.id);
    }
    w.dismissedMarkerIds = [...new Set([...w.dismissedMarkerIds, ...ids])].sort();
    this.record('mapCleanup', '已移除无价值标记，历史与实体保留', c.entityId);
    return ok('标记已永久移除');
  }
  if (c.type === 'pause') {
    w.paused = c.paused;
    if (!c.paused) w.pauseReasons = [];
    return ok(c.paused ? '模拟暂停' : '模拟继续');
  }
  if (c.type === 'speed') {
    w.speed = c.speed;
    return ok('时间倍率已更新');
  }
  if (c.type === 'acknowledge') {
    w.communications.find((m) => m.id === c.communicationId)!.read = true;
    return ok('通信已确认');
  }
  if (c.type === 'issueDirective') {
    for (const id of c.shipIds) {
      const s = w.ships.find((s) => s.id === id)!,
        d = makeDirective(this, c.action);
      if (c.mode === 'QUEUE' && s.current?.source === 'admiral') s.queue.push(d);
      else {
        if (c.mode === 'INTERRUPT' && s.current) s.suspended.push(s.current);
        if (c.mode === 'REPLACE') {
          s.current = null;
          s.queue = [];
          s.suspended = [];
        }
        s.current = d;
        s.tracking = null;
        s.emergencyRetreat = null;
        s.path = [];
        s.status = 'active';
      }
      d.origin = { x: s.x, y: s.y };
      d.source = actorId === w.commander.id ? 'admiral' : 'standing';
      if (s.current === d && d.action.type === 'REARM') {
        d.reserved.photon = d.action.load.photon;
        d.reserved.quantum = d.action.load.quantum;
        d.phase = 'reserved';
      }
      this.record('directive', s.name + ' / ' + c.mode + ' / ' + c.action.type, s.id);
    }
    return ok('Admiral 指令已接受：' + c.mode + ' / ' + c.action.type);
  }
  if (c.type === 'cancelDirective') {
    const s = w.ships.find((s) => s.id === c.shipId)!;
    s.current = null;
    s.queue = [];
    s.suspended = [];
    s.tracking = null;
    s.emergencyRetreat = null;
    s.path = [];
    s.status = 'idle';
    this.record('directive', s.name + ' 取消指令；货物保留', s.id);
    return ok();
  }
  if (c.type === 'standingOrders') {
    w.ships.find((s) => s.id === c.shipId)!.standing = structuredClone(c.orders);
    return ok('自主政策已更新');
  }
  if (c.type === 'setCloak') {
    const s = w.ships.find((s) => s.id === c.shipId)!;
    s.cloak = c.enabled ? 'on' : 'off';
    s.cloakUntil = 0;
    if (s.current?.action.type === 'SHADOW' && s.current.phase === 'starting')
      s.current.phase = 'following';
    this.record('cloak', s.name + (c.enabled ? ' 开启隐形' : ' 关闭隐形'), s.id);
    return ok();
  }
  if (c.type === 'renameEntity') {
    const entity =
      w.ships.find((s) => s.id === c.entityId) ??
      w.locations.find((l) => l.id === c.entityId) ??
      w.systems.find((s) => s.id === c.entityId) ??
      w.bodies.find((b) => b.id === c.entityId);
    const old = entity!.name;
    entity!.name = c.name;
    if (!w.renamedEntityIds.includes(c.entityId)) w.renamedEntityIds.push(c.entityId);
    if ('label' in entity!) entity!.label = c.name;
    this.record('rename', old + ' → ' + c.name, c.entityId);
    return ok('名称已保存');
  }
  if (c.type === 'startConstruction') {
    const site =
      w.bodies.find((b) => b.id === c.siteId) ?? w.systems.find((s) => s.id === c.siteId)!;
    const project = {
      id: 'project-' + w.nextId++,
      name: c.name,
      kind: c.kind,
      siteId: c.siteId,
      refitLocationId: null,
      x: site.x,
      y: site.y,
      stock: emptyStock(),
      capacity: structuredClone(STORAGE[c.kind]),
      cost: structuredClone(FACILITIES[c.kind].cost),
      work: 0,
      duration: RULES.constructionMinutes,
      complete: false,
    };
    w.resources.credits -= project.cost.credits;
    w.projects.push(project);
    w.renamedEntityIds.push(project.id);
    this.record('construction', c.name + ' 开工：等待实际材料运抵', project.id);
    return ok('现场项目已建立，请运输材料');
  }
  if (c.type === 'startBaseRefit') {
    const l = w.locations.find((l) => l.id === c.locationId)!;
    w.resources.credits -= BASE_REFIT.cost.credits;
    l.occupation = 'rebuilding';
    w.projects.push({
      id: 'project-' + w.nextId++,
      name: c.name,
      kind: 'base',
      siteId: l.id,
      refitLocationId: l.id,
      x: l.x,
      y: l.y,
      stock: emptyStock(),
      capacity: structuredClone(STORAGE.base),
      cost: structuredClone(BASE_REFIT.cost),
      work: 0,
      duration: BASE_REFIT.minutes,
      complete: false,
    });
    w.renamedEntityIds.push(w.projects.at(-1)!.id);
    this.record('baseRefit', l.name + ' 开始改建：等待现场材料', l.id);
    return ok('基地改建项目已建立，请运输材料');
  }
  if (c.type === 'buildShip') {
    pay(this, productionCost(w, BUILD_COSTS[c.classId as keyof typeof BUILD_COSTS]), c.locationId);
    w.jobs.push({
      id: 'job-' + w.nextId++,
      kind: 'ship',
      locationId: c.locationId ?? 'base',
      key: c.classId,
      name: c.name,
      amount: 1,
      work: 0,
      duration: RULES.shipBuildMinutes,
      complete: false,
      cancelled: false,
    });
    this.record('industry', c.name + ' 进入船坞建造', c.locationId ?? 'base');
    return ok('已支付实物与预算，造舰开始');
  }
  if (c.type === 'upgrade') {
    pay(this, UPGRADES[c.upgradeId].cost, c.locationId);
    w.jobs.push({
      id: 'job-' + w.nextId++,
      kind: 'upgrade',
      locationId: c.locationId ?? 'base',
      key: c.upgradeId,
      name: UPGRADES[c.upgradeId].label,
      amount: 1,
      work: 0,
      duration: 15,
      complete: false,
      cancelled: false,
    });
    return ok('战略升级施工开始');
  }
  if (c.type === 'manufacture') {
    pay(this, productionCost(w, manufactureCost(c.cargoKind, c.amount)), c.locationId);
    w.jobs.push({
      id: 'job-' + w.nextId++,
      kind: 'manufacture',
      locationId: c.locationId ?? 'base',
      key: c.cargoKind,
      name: c.cargoKind,
      amount: c.amount,
      work: 0,
      duration: Math.max(3, c.amount * 0.3) * (w.upgrades.armory ? 0.5 : 1),
      complete: false,
      cancelled: false,
    });
    return ok('制造已使用真实材料');
  }
  if (c.type === 'repairFacility') {
    const l = w.locations.find((l) => l.id === c.locationId)!,
      amount = Math.min(
        Math.ceil((l.maxHull - l.hull) / RULES.repairPerMaterial),
        Math.floor(available(w, l.id, 'materials')),
      );
    l.stock.materials -= amount;
    l.hull = Math.min(l.maxHull, l.hull + amount * RULES.repairPerMaterial);
    this.record('repair', l.name + ' 消耗 ' + amount + ' 本地 Materials', l.id);
    return ok('设施维修完成');
  }
  if (c.type === 'agentMessage') {
    // The only door through which Agent social writes reach the world (CLAUDE.md §2.1). Going
    // through a Command rather than a runtime-side mutation keeps `dispatchCommand` the single
    // validation entry point.
    const from =
      c.from === 'admiral'
        ? w.commander.name
        : (w.agents.find((a) => a.id === c.from)?.name ?? c.from);
    const target = w.agents.find((a) => a.id === c.to) ?? null;
    const to = target?.name ?? w.commander.name;
    const message = createMessage({
      id: 'agent-message-' + w.nextId++,
      at: w.time,
      from: c.from,
      to: c.to,
      kind: c.kind,
      text: c.text,
      payload: c.payload,
    });
    w.agentMessages = boundMessages([...w.agentMessages, message]);
    // An answer consumes the question it answers — see `consumeAnswered`. Only an Agent's own words
    // settle anything: the Admiral is not answerable to anyone here.
    if (c.from !== 'admiral') consumeAnswered(w, c.from, c.to, c.kind);

    // The only door for both social triggers (docs/lv3/02-domain-model.md §14). Emitted only when
    // the message is actually addressed to an Agent — a message to the Admiral wakes nobody.
    //
    // The transient channel is drained by the next `step()`, so a message dispatched from the host
    // is delivered to the scheduler one frame later. That is acceptable: it is a trigger, not a
    // state change, and the game is unsynchronised with it by design (Rule 1).
    if (target)
      this.pendingEvents.push({
        type: 'agentTrigger',
        trigger:
          c.from === 'admiral'
            ? { kind: 'admiral-message', messageId: message.id }
            : { kind: 'agent-request', fromAgentId: c.from, toAgentId: target.id },
      });

    if (target && createsInteraction(c.kind)) {
      const outcome = interactionOutcomeFor(c.kind, c.payload);
      const { agent, effects } = applyInteraction(target, c.kind, outcome);
      const index = w.agents.findIndex((a) => a.id === target.id);
      w.agents[index] = agent;
      w.agentInteractions = boundInteractions([
        ...w.agentInteractions,
        {
          id: 'agent-interaction-' + w.nextId++,
          at: w.time,
          kind: c.kind,
          actorId: c.from,
          targetAgentId: target.id,
          messageId: message.id,
          outcome,
          effects,
        },
      ]);
      // A team reply settles an Agent-to-Agent pairing: both sides' regard moves, in one write
      // (docs/lv3/01-mvp-scenario.md EVT-03). Emitted here because this is where the engine already
      // decided what the answer was — the settlement planner must not re-derive it from the payload.
      if (c.kind === 'team-reply')
        this.pendingEvents.push({
          type: 'agentEvent',
          event: {
            kind: 'team-resolved',
            aAgentId: c.from,
            bAgentId: target.id,
            accepted: outcome === 'accepted',
          },
        });
      if (c.kind === 'override')
        w.agents[index] = {
          ...w.agents[index],
          memories: remember(
            w.agents[index].memories,
            overrideMemory({
              id: 'agent-memory-' + w.nextId++,
              at: w.time,
              actionType:
                c.payload && 'directiveActionType' in c.payload
                  ? c.payload.directiveActionType
                  : 'DIRECTIVE',
            }),
          ),
        };
    }

    // N-6: Agent speech is mirrored into the existing Communication feed so the existing UI shows
    // it with zero UI changes.
    const line =
      c.from === 'admiral' ? from + ' → ' + to + '：' + c.text : to + ' ← ' + from + '：' + c.text;
    this.report(line, target?.id ?? null, c.kind === 'override' ? 'high' : 'normal', 'decision');
    return ok('消息已送达');
  }
  if (c.type === 'agentEvent') {
    // Settlement commits here, from the pure domain functions in `src/engine/agent/**`. This keeps
    // `dispatchCommand` the single write door for Agent state, exactly as the `agentMessage` branch
    // above does for social writes (CLAUDE.md §2.1) — and it gives settlement a refusal surface
    // instead of a silent mutation.
    const settled = settleAgentEvent(w, c.event, () => 'agent-memory-' + w.nextId++);
    if (!settled) return no('结算事件没有对应的 Agent');
    w.agents = settled.agents;
    return ok('Agent 状态已结算');
  }
  return ok();
}
/**
 * Which unread messages a reply settles.
 *
 * An answer consumes the question it answers. Without this an offer stays on the Agent's menu
 * forever, so `actions.ts` keeps offering accept/reject/counteroffer on every beat and the Agent can
 * never get back to its own work — and a policy of "answer the Admiral first" would lock it out
 * permanently (docs/lv3/01-mvp-scenario.md EVT-01).
 *
 * Deliberately blunt: a reply to the Admiral consumes *every* unread task offer that Agent is
 * holding, not only the one being answered. The alternative is the reply carrying a message id, which
 * would mean the Agent layer knowing about the message log it is not allowed to see.
 */
function consumeAnswered(w: WorldState, from: string, to: string, kind: AgentMessageKind): void {
  const answersTask = kind === 'report' || kind === 'negotiate';
  const answersTeam = kind === 'team-reply';
  if (!answersTask && !answersTeam) return;
  w.agentMessages = w.agentMessages.map((message) => {
    if (message.read || message.to !== from) return message;
    const settled =
      (answersTask && isTaskOfferKind(message.kind)) ||
      (answersTeam && message.kind === 'team-request' && message.from === to);
    return settled ? { ...message, read: true } : message;
  });
}

/**
 * Keeps the message log bounded: already-read messages are dropped first, oldest first, and only
 * then the oldest unread ones. Ordering is array order, never Map/Set iteration, so the result is a
 * pure function of the list and cannot destabilise the same-seed replay assertion.
 */
function boundMessages(messages: AgentMessage[]): AgentMessage[] {
  const excess = messages.length - AGENT_MESSAGE_CAP;
  if (excess <= 0) return messages;
  const doomed = new Set<string>();
  for (const m of messages) {
    if (doomed.size >= excess) break;
    if (m.read) doomed.add(m.id);
  }
  for (const m of messages) {
    if (doomed.size >= excess) break;
    doomed.add(m.id);
  }
  return messages.filter((m) => !doomed.has(m.id));
}
/** Bounded FIFO audit trail; oldest interactions are dropped first. */
function boundInteractions(interactions: AgentInteraction[]): AgentInteraction[] {
  const excess = interactions.length - AGENT_INTERACTION_CAP;
  return excess > 0 ? interactions.slice(excess) : interactions;
}
export function submitAction(this: SimulationEngine, operatorId: string, input: Action) {
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) return no('结构化动作格式无效');
  const a = this.state.assignments.find((a) => a.operatorId === operatorId),
    s = this.state.ships.find((s) => s.id === a?.shipId);
  if (!s) return no('执行主体不可用');
  if ([s.current, ...s.queue, ...s.suspended].some((d) => d?.source === 'admiral'))
    return no('Admiral 当前、队列和挂起指令优先');
  if (s.current || s.queue.length || s.suspended.length) return no('执行主体正在完成既有行动');
  return this.dispatchCommand(
    { type: 'issueDirective', shipIds: [s.id], mode: 'QUEUE', action: parsed.data },
    operatorId,
  );
}
