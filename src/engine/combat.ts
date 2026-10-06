import { loseStock } from './inventory';
import { personnelBonus } from './society';
import type { Enemy, Location, Ship } from './types';
import type { SimulationEngine } from './engine';
import { capabilities } from './capabilities';
import { GOODS } from './types';
import { emptyStock } from './data';
import { SHIP_CLASSES, WEAPONS } from './definitions/ships';
import { dist } from './navigation';
import { RULES } from './definitions/rules';
export function regenerate(s: Ship, time: number, dt: number) {
  const d = capabilities(s);
  for (const k of Object.keys(s.cooldowns)) s.cooldowns[k] = Math.max(0, s.cooldowns[k] - dt);
  s.core = Math.min(d.core, s.core + d.coreRegen * dt);
  if (s.cloak === 'on') {
    s.core = Math.max(0, s.core - RULES.cloakDrain * dt);
    if (s.core === 0) s.cloak = 'off';
  }
  if (time - s.attackedAt > 8) s.shield = Math.min(d.shield, s.shield + d.shieldRegen * dt);
  if (s.cloak === 'decloaking' && time >= s.cloakUntil) s.cloak = 'off';
}
export function applyDamage(
  e: SimulationEngine,
  t: Ship | Location,
  amount: number,
  attacker?: Ship,
) {
  if (t.hull <= 0 || amount <= 0) return;
  const before = t.hull,
    absorb = Math.min(t.shield, amount),
    alreadyUnderAttack = e.state.time - t.attackedAt <= 30;
  t.shield -= absorb;
  t.hull = Math.max(0, t.hull - amount + absorb);
  t.attackedAt = e.state.time;
  t.lastAttackerId = attacker?.id ?? null;
  if ('classId' in t) {
    t.lastAttackerId = attacker?.id ?? null;
    if (
      t.factionId === 'starfleet' &&
      before >= SHIP_CLASSES[t.classId].hull * 0.3 &&
      t.hull < SHIP_CLASSES[t.classId].hull * 0.3
    )
      e.critical('lowHull', t.id, t.name + ' 血量低于30%');
    const i = e.state.intel.find((i) => i.id === t.id && i.live);
    if (i) {
      i.hull = t.hull;
      i.shield = t.shield;
    }
    if (t.hull === 0) destroyShip(e, t, attacker ? '交战永久损失' : '环境永久损失');
  } else if (t.owner === 'starfleet') {
    t.distress = true;
    if (!alreadyUnderAttack) {
      e.report(t.name + ' 遭袭，请求增援', t.id, 'urgent', 'threat');
    }
    if (before >= t.maxHull * 0.3 && t.hull < t.maxHull * 0.3)
      e.critical('lowHull', t.id, t.name + ' 设施严重受损');
    if (t.hull === 0) {
      for (const k of GOODS) loseStock(e, t, k, t.stock[k]);
      for (const j of e.state.jobs.filter(
        (j) => j.locationId === t.id && !j.complete && !j.cancelled,
      )) {
        j.cancelled = true;
        e.record('industryLost', t.name + ' 被摧毁，' + j.name + ' 作业永久损失', t.id);
      }
      for (const p of e.state.personnel)
        if (p.posting?.id === t.id) {
          p.posting = null;
          p.status = 'missing';
        }
      if (t.colony) t.colony.commanderId = null;
      e.record('facilityLost', t.name + ' 已摧毁', t.id);
      e.critical('facilityDestroyed', t.id, t.name + ' 已摧毁');
      if (t.id === 'base') {
        e.state.status = 'commandLost';
        e.state.paused = true;
        e.critical('commandLost', t.id, 'COMMAND LOST');
        e.pendingEvents.push({ type: 'commandLost', tick: e.state.tick });
      }
    }
  } else if (t.hull === 0) {
    if (t.kind === 'base' || t.kind === 'outpost') {
      t.occupation = 'ruined';
      t.shield = 0;
      t.core = 0;
      t.cooldown = 0;
    }
    for (const k of GOODS) loseStock(e, t, k, t.stock[k]);
    if (t.discovered) e.record('factionLoss', t.name + ' 已摧毁；基地库存与恢复能力损失', t.id);
  }
}
export function destroyShip(e: SimulationEngine, s: Ship, reason: string) {
  const w = e.state;
  if (s.factionId === 'starfleet') {
    if (w.losses.some((l) => l.shipId === s.id)) return;
    const operatorIds = w.assignments.filter((a) => a.shipId === s.id).map((a) => a.operatorId);
    w.losses.push({
      shipId: s.id,
      name: s.name,
      classId: s.classId,
      tick: w.tick,
      position: { x: s.x, y: s.y },
      reason,
      cargo: structuredClone(s.cargo),
      ammunition: { photon: s.photon, quantum: s.quantum },
      operatorIds,
    });
    w.assignments = w.assignments.filter((a) => a.shipId !== s.id);
    for (const op of w.operators) if (operatorIds.includes(op.id)) op.availability = 'vesselLost';
    for (const p of w.personnel)
      if (p.posting?.id === s.id) {
        p.posting = null;
        p.status = 'missing';
        e.record('personnel', p.name + '随舰永久失联', p.id);
      }
    w.ships = w.ships.filter((x) => x.id !== s.id);
    w.civilians = w.civilians.filter((x) => x.id !== s.id);
    for (const o of w.trade.orders)
      if (o.carrierId === s.id && o.state !== 'complete') o.state = 'lost';
    for (const g of w.groups) {
      g.shipIds = g.shipIds.filter((id) => id !== s.id);
      if (g.flagshipId === s.id) g.flagshipId = g.shipIds[0] ?? '';
    }
    w.groups = w.groups.filter((g) => g.shipIds.length > 0);
    e.record('shipLost', s.name + ' 永久损失', s.id);
    e.critical('shipDestroyed', s.id, s.name + ' 已摧毁');
    e.pendingEvents.push({ type: 'shipDestroyed', shipId: s.id, operatorIds, tick: w.tick });
  } else {
    const faction = w.factions[s.factionId];
    if (faction.losses.includes(s.id)) return;
    faction.losses.push(s.id);
    w.enemies = w.enemies.filter((x) => x.id !== s.id);
    const i = w.intel.find((i) => i.id === s.id);
    if (i) {
      i.resolved = true;
      if (i.live) e.record('factionLoss', '确认 ' + s.name + ' 已摧毁', s.id);
    }
  }
  const stock = emptyStock();
  for (const k of GOODS) stock[k] = Math.floor(s.cargo[k] * 0.65);
  stock.materials += Math.round(SHIP_CLASSES[s.classId].hull * 0.08);
  w.wrecks.push({
    id: 'wreck:' + s.id,
    name: s.name + ' 残骸',
    x: s.x,
    y: s.y,
    stock,
    discovered: s.factionId === 'starfleet' || w.intel.some((i) => i.id === s.id && i.live),
  });
}
export function fire(
  e: SimulationEngine,
  s: Ship,
  t: Ship | Location,
  disable?: 'engines' | 'weapons' | 'suppression' | 'warning',
) {
  const w = e.state;
  if (s.weapons <= 0 || s.hull <= 0 || t.hull <= 0) return;
  if (s.cloak === 'on') {
    s.cloak = 'decloaking';
    s.cloakUntil = w.time + 1;
    return;
  }
  if (s.cloak === 'decloaking') return;
  for (const key of SHIP_CLASSES[s.classId].weapons) {
    const weapon = WEAPONS[key];
    if (disable && weapon.ammo) continue;
    if (
      dist(s, t) > weapon.range ||
      (s.cooldowns[key] ?? 0) > 0 ||
      s.core < weapon.cost ||
      (weapon.ammo && s[weapon.ammo] <= 0)
    )
      continue;
    s.core -= weapon.cost;
    if (weapon.ammo) s[weapon.ammo]--;
    s.cooldowns[key] = weapon.cooldown;
    if (s.factionId !== 'starfleet') {
      const enemy = s as Enemy,
        record = w.intel.find((i) => i.id === s.id);
      if (record) {
        record.hostile = true;
        record.lastAttackAt = w.time;
        record.lastAttackTargetId = t.id;
      }
      enemy.cloak = 'off';
      enemy.lastHostileAt = w.time;
      enemy.lastHostileTargetId = t.id;
    }
    if (s.factionId === 'starfleet' && ('factionId' in t ? t.factionId : t.owner) === 'romulan') {
      const first = !(s.cooldowns['incident:' + t.id] > 0);
      s.cooldowns['incident:' + t.id] = 30;
      if (first) {
        const confirmed = w.intel.find((i) => i.id === t.id)?.hostile,
          amount = confirmed ? 6 : 45;
        w.tension = Math.min(100, w.tension + amount);
        e.record(
          'borderAttack',
          (confirmed ? 'Federation 独立边境交战' : 'Admiral 对未确认敌对 Romulan 开火') +
            '：tension +' +
            amount,
          t.id,
        );
      }
    }
    e.beam(
      s,
      t,
      disable === 'warning'
        ? 'Warning Phaser'
        : disable
          ? 'Precision Phaser / ' + disable
          : weapon.name,
    );
    if (e.random() > Math.min(0.98, weapon.accuracy + personnelBonus(e, s.id, 'battle'))) continue;
    if (disable && disable !== 'warning' && 'classId' in t && t.shield <= 0) {
      const subsystem = disable === 'weapons' ? 'weapons' : 'engines';
      t[subsystem] = Math.max(0, t[subsystem] - (disable === 'suppression' ? 12 : 30));
      t.core = Math.max(0, t.core - 12);
      applyDamage(e, t, weapon.damage * 0.1, s);
    } else applyDamage(e, t, weapon.damage * (disable === 'warning' ? 0.5 : 1), s);
    if (w.status !== 'active') return;
  }
}
