import type { SimulationEngine } from './engine';
import type { Command, CommandResult } from './types';
import { validateAction, makeDirective, ok, no } from './command-system';
import { capabilities, cargoUsed } from './capabilities';
import { available } from './inventory';
import { canMeet, fundDevelopment } from './society';
import { DEVELOPMENT } from './definitions/frontier';
import { tradeReason, orderTrade } from './trade';
import { eventAt, finishEvent } from './world-events';
export function validateFrontierCommand(e: SimulationEngine, c: Command): CommandResult | null {
  const w = e.state;
  if (c.type === 'createGroup' || c.type === 'updateGroup') {
    if (c.type === 'updateGroup' && !w.groups.some((g) => g.id === c.groupId))
      return no('编队不存在');
    return !c.shipIds.includes(c.flagshipId) ||
      c.shipIds.some(
        (id) =>
          !w.ships.some((s) => s.id === id) ||
          w.groups.some(
            (g) => g.id !== (c.type === 'updateGroup' ? c.groupId : '') && g.shipIds.includes(id),
          ),
      )
      ? no('成员无效、重复入组或旗舰不在编队')
      : ok();
  }
  if (c.type === 'deleteGroup')
    return w.groups.some((g) => g.id === c.groupId) ? ok() : no('编队不存在');
  if (c.type === 'issueGroupDirective') {
    const g = w.groups.find((g) => g.id === c.groupId),
      ships = w.ships.filter((s) => g?.shipIds.includes(s.id));
    if (!g || !ships.length) return no('编队没有可用舰船');
    if (
      !['MOVE', 'PATROL', 'ESCORT', 'INTERCEPT', 'RETREAT', 'RETURN', 'HAUL'].includes(
        c.action.type,
      )
    )
      return no('此行动请直接选择舰船');
    if (
      c.action.type === 'HAUL' &&
      c.action.amount > ships.reduce((n, s) => n + Math.floor(capabilities(s).cargo), 0)
    )
      return no('总量超过编队货舱容量');
    for (const s of ships) {
      if (
        (c.mode === 'QUEUE' && s.queue.length >= 32) ||
        (c.mode === 'INTERRUPT' && s.suspended.length >= 16)
      )
        return no('成员指令队列已满');
      const a =
        c.action.type === 'HAUL'
          ? { ...c.action, amount: Math.min(c.action.amount, capabilities(s).cargo) }
          : c.action;
      const v = validateAction(e, s, a);
      if (!v.ok) return v;
    }
    return ok();
  }
  if (c.type === 'candidate') {
    const p = w.personnel.find((p) => p.id === c.personnelId && p.status === 'candidate');
    return !p
      ? no('候选人不可用')
      : c.accept && w.resources.credits < 90
        ? no('培养需要 90 Credits')
        : ok();
  }
  if (c.type === 'assignPersonnel') {
    const p = w.personnel.find(
      (p) => p.id === c.personnelId && ['available', 'assigned'].includes(p.status),
    );
    const target =
      c.targetType === 'ship'
        ? w.ships.find((s) => s.id === c.targetId)
        : w.locations.find((l) => l.id === c.targetId && l.colony && l.hull > 0);
    return p && target && canMeet(e, p, target) ? ok() : no('人员未毕业或尚未与目标会合');
  }
  if (c.type === 'developColony') {
    const l = w.locations.find((l) => l.id === c.locationId && l.hull > 0 && l.colony);
    return l &&
      !l.colony!.development &&
      w.resources.credits >= DEVELOPMENT.credits &&
      available(w, l.id, 'materials') >= DEVELOPMENT.materials
      ? ok()
      : no('需要空闲殖民地、60 Credits 与现场 10 Materials');
  }
  if (c.type === 'tradeStock')
    return tradeReason(e, c.direction, c.cargoKind, c.amount)
      ? no(tradeReason(e, c.direction, c.cargoKind, c.amount)!)
      : ok();
  if (c.type === 'sellStock')
    return tradeReason(e, 'sell', c.cargoKind, c.amount)
      ? no(tradeReason(e, 'sell', c.cargoKind, c.amount)!)
      : ok();
  if (c.type === 'respondEvent') {
    const v = w.events.find(
      (v) => v.id === c.eventId && ['reported', 'responding'].includes(v.stage),
    );
    if (!v) return no('事件不可用');
    if (c.choice === 'stabilize' && v.kind !== 'wormhole') return no('只能稳定 Wormhole');
    if (['quarantine', 'liftQuarantine'].includes(c.choice) && v.kind !== 'plague')
      return no('仅疫情可以隔离');
    if (['accept', 'reject'].includes(c.choice) && v.kind !== 'refugees')
      return no('仅难民事件接受或拒绝');
    if (['accept', 'reject'].includes(c.choice) && v.population > 0)
      return no('难民已登舰，必须完成真实运输');
    if (
      c.choice === 'accept' &&
      !w.locations.some((l) => l.id === c.targetId && l.colony && l.hull > 0)
    )
      return no('请选择安置殖民地');
    if (c.choice === 'withdraw' && !['diplomatic', 'invasion'].includes(v.kind))
      return no('事件没有撤离要求');
    return ok();
  }
  return null;
}
export function applyFrontierCommand(e: SimulationEngine, c: Command): CommandResult | null {
  const w = e.state;
  if (c.type === 'createGroup') {
    w.groups.push({
      id: 'group-' + w.nextId++,
      name: c.name,
      shipIds: [...c.shipIds],
      flagshipId: c.flagshipId,
      spacing: c.spacing,
    });
    w.renamedEntityIds.push(w.groups.at(-1)!.id);
    e.record('fleet', '创建编队 ' + c.name, null);
    return ok();
  }
  if (c.type === 'updateGroup') {
    if (!w.renamedEntityIds.includes(c.groupId)) w.renamedEntityIds.push(c.groupId);
    Object.assign(w.groups.find((g) => g.id === c.groupId)!, {
      name: c.name,
      shipIds: [...c.shipIds],
      flagshipId: c.flagshipId,
      spacing: c.spacing,
    });
    e.record('fleet', '更新编队 ' + c.name, c.groupId);
    return ok();
  }
  if (c.type === 'deleteGroup') {
    w.groups = w.groups.filter((g) => g.id !== c.groupId);
    e.record('fleet', '删除编队，已下达指令保留', c.groupId);
    return ok();
  }
  if (c.type === 'issueGroupDirective') {
    const g = w.groups.find((g) => g.id === c.groupId)!,
      id = 'group-order-' + w.nextId++,
      members = [g.flagshipId, ...g.shipIds.filter((id) => id !== g.flagshipId)].map(
        (id) => w.ships.find((s) => s.id === id)!,
      );
    for (const [slot, s] of members.entries()) {
      const a =
          c.action.type === 'HAUL'
            ? { ...c.action, amount: Math.min(c.action.amount, capabilities(s).cargo) }
            : c.action,
        d = makeDirective(e, a);
      d.groupOrderId = id;
      d.groupSpacing = g.spacing;
      d.groupSlot = slot;
      d.groupTotal = c.action.type === 'HAUL' ? c.action.amount : 0;
      d.origin = { x: s.x, y: s.y };
      if (c.mode === 'QUEUE' && s.current?.source === 'admiral') s.queue.push(d);
      else {
        if (c.mode === 'INTERRUPT' && s.current) s.suspended.push(s.current);
        if (c.mode === 'REPLACE') {
          s.queue = [];
          s.suspended = [];
        }
        s.current = d;
        s.tracking = null;
        s.emergencyRetreat = null;
        s.path = [];
        s.status = 'active';
      }
    }
    e.record('fleet', g.name + ' / ' + c.mode + ' / ' + c.action.type, g.id);
    return ok();
  }
  if (c.type === 'candidate') {
    const p = w.personnel.find((p) => p.id === c.personnelId)!;
    p.career = c.career;
    if (c.accept) {
      w.resources.credits -= 90;
      p.status = 'training';
      p.skills[c.career] = 50;
    } else p.status = 'rejected';
    e.record('personnel', p.name + (c.accept ? '获准培养，支付90 Credits' : '候选被拒绝'), p.id);
    return ok();
  }
  if (c.type === 'assignPersonnel') {
    const p = w.personnel.find((p) => p.id === c.personnelId)!;
    for (const l of w.locations) if (l.colony?.commanderId === p.id) l.colony.commanderId = null;
    if (c.targetType === 'colony' && p.career === 'commander') {
      const l = w.locations.find((l) => l.id === c.targetId)!;
      const previous = w.personnel.find((x) => x.id === l.colony!.commanderId);
      if (previous) {
        previous.posting = null;
        previous.status = 'available';
      }
      l.colony!.commanderId = p.id;
    }
    p.posting = { type: c.targetType, id: c.targetId };
    p.locationId = c.targetId;
    p.status = 'assigned';
    e.record('personnel', p.name + '任职 ' + c.targetId, p.id);
    return ok();
  }
  if (c.type === 'developColony') {
    fundDevelopment(e, w.locations.find((l) => l.id === c.locationId)!, c.kind);
    e.record('colony', '殖民地建设已支付真实资源', c.locationId);
    return ok();
  }
  if (c.type === 'tradeStock') {
    orderTrade(e, c.direction, c.cargoKind, c.amount);
    return ok('贸易实物订单已建立');
  }
  if (c.type === 'sellStock') {
    orderTrade(e, 'sell', c.cargoKind, c.amount);
    return ok();
  }
  if (c.type === 'respondEvent') {
    const v = w.events.find((v) => v.id === c.eventId)!;
    v.choice = c.choice;
    v.targetId = c.targetId ?? v.targetId;
    const target = w.locations.find((l) => l.id === v.subjectId);
    if (
      (c.choice === 'quarantine' || c.choice === 'liftQuarantine') &&
      target &&
      'colony' in target &&
      target.colony
    )
      target.colony.quarantine = c.choice === 'quarantine';
    if (c.choice === 'reject') finishEvent(e, v, 'Admiral 拒绝安置，来源人口保留');
    if (c.choice === 'withdraw' && w.ships.some((s) => s.id === v.subjectId))
      e.dispatchCommand({
        type: 'issueDirective',
        shipIds: [v.subjectId],
        mode: 'REPLACE',
        action: { type: 'RETURN' },
      });
    e.record('decision', 'Admiral 响应 ' + v.id + '：' + c.choice, v.id);
    return ok('决策已记录，现场行动决定结果');
  }
  return null;
}
