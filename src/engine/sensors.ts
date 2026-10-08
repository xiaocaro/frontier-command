import type { SimulationEngine } from './engine';
import type { Enemy, WorldState } from './types';
import { capabilities } from './capabilities';
import { dist } from './navigation';
import { RULES } from './definitions/rules';
import { canDetectShip, updateSiteIntel, TRACKING_RULES } from './tracking';
export const visibleIntel = (w: WorldState) =>
  w.intel.filter((i) => !i.resolved && w.time - i.lastSeen <= RULES.intelTTL);
export function observe(w: WorldState, s: Enemy, strength: number) {
  let i = w.intel.find((i) => i.id === s.id);
  const fresh = !i;
  if (!i) {
    i = {
      id: s.id,
      x: s.x,
      y: s.y,
      level: 'CONTACT',
      strength: 0,
      lastSeen: w.time,
      live: true,
      hostile: false,
      velocity: { x: 0, y: 0 },
      resolved: false,
    };
    w.intel.push(i);
  }
  const elapsed = w.time - i.lastSeen;
  if (elapsed > 0) i.velocity = { x: (s.x - i.x) / elapsed, y: (s.y - i.y) / elapsed };
  i.x = s.x;
  i.y = s.y;
  i.lastSeen = w.time;
  i.live = true;
  i.strength = Math.min(12, i.strength + strength);
  i.level =
    i.strength >= 10
      ? 'TRACKED'
      : i.strength >= 6
        ? 'IDENTIFIED'
        : i.strength >= 3
          ? 'CLASSIFIED'
          : 'CONTACT';
  if (i.strength >= 3) i.factionId = s.factionId;
  if (i.strength >= 6) {
    i.name = s.name;
    i.classId = s.classId;
    i.hull = s.hull;
    i.shield = s.shield;
  }
  if (w.time - s.lastHostileAt < 30) {
    i.hostile = true;
    i.lastAttackAt = s.lastHostileAt;
    i.lastAttackTargetId = s.lastHostileTargetId ?? undefined;
  }
  return { record: i, fresh };
}
export function updateSensors(e: SimulationEngine) {
  const w = e.state;
  for (const i of w.intel) i.live = false;
  const sources = [
    ...[...w.ships, ...w.civilians].map((s) => ({
      ...s,
      range: capabilities(s).sensors,
      active: s.scanUntil > w.time,
    })),
    ...w.locations
      .filter((l) => l.owner === 'starfleet' && l.hull > 0)
      .map((l) => ({
        ...l,
        range:
          l.kind === 'base'
            ? RULES.baseSensors
            : l.kind === 'outpost'
              ? w.upgrades.sensors
                ? 340
                : 160
              : 80,
        active: !!w.upgrades.sensors,
      })),
  ];
  for (const ship of w.ships) {
    if (ship.current?.action.type !== 'SHADOW') {
      ship.tracking = null;
      continue;
    }
    if (ship.tracking) ship.tracking.live = false;
  }
  for (const enemy of [...w.enemies].sort((a, b) => a.id.localeCompare(b.id))) {
    const detecting = sources.filter((source) =>
      'classId' in source
        ? canDetectShip(source, enemy, w.time)
        : dist(source, enemy) <
          source.range * (enemy.cloak === 'on' ? TRACKING_RULES.ordinaryCloakSignature : 1),
    );
    if (!detecting.length) continue;
    const probability =
      enemy.cloak === 'on'
        ? detecting.some((s) => 'classId' in s && s.classId === 'veil')
          ? TRACKING_RULES.veilDetectionChance
          : detecting.some((s) => s.active)
            ? TRACKING_RULES.activeDetectionChance
            : TRACKING_RULES.passiveDetectionChance
        : 1;
    if (probability < 1 && e.random() > probability) continue;
    const source = detecting[0];
    const previousSeen = w.intel.find((i) => i.id === enemy.id)?.lastSeen;
    const result = observe(w, enemy, source.active ? 2 : 1);
    let alert = w.contactAlerts.find((a) => a.contactId === enemy.id);
    if (
      !alert ||
      (previousSeen !== undefined && w.time - previousSeen >= 10) ||
      (result.record.hostile && !alert.hostileAlerted)
    ) {
      const message =
        (result.record.hostile ? '已确认敌对接触' : '发现外部舰船接触') +
        '：' +
        (result.record.name ?? '未知舰船') +
        '，请 Admiral 处置后手动继续';
      e.report(message, result.record.id, 'urgent', 'threat');
      e.critical('newContact', result.record.id, message);
      // Mirrors the alert above rather than deduplicating it: this branch already re-fires for a
      // contact that went quiet for 10 minutes or turned hostile, and each of those is a genuine
      // danger signal. The scheduler coalesces repeats and caps the model budget, so a repeated
      // alert cannot turn into repeated calls.
      e.pendingEvents.push({
        type: 'agentTrigger',
        trigger: { kind: 'danger', contactId: result.record.id },
      });
      if (!alert) {
        alert = { contactId: enemy.id, lastAlertAt: w.time, hostileAlerted: false };
        w.contactAlerts.push(alert);
      }
      alert.lastAlertAt = w.time;
      alert.hostileAlerted ||= result.record.hostile;
    }
    for (const ship of w.ships.filter(
      (s) => s.current?.action.type === 'SHADOW' && s.current.action.targetId === enemy.id,
    )) {
      if (!canDetectShip(ship, enemy, w.time)) continue;
      ship.tracking = {
        targetId: enemy.id,
        position: { x: enemy.x, y: enemy.y },
        lastSeen: w.time,
        live: true,
      };
    }
  }
  updateSiteIntel(e);
  for (const wreck of w.wrecks)
    if (!wreck.discovered && sources.some((s) => dist(s, wreck) < s.range)) {
      wreck.discovered = true;
      e.record('discovery', '发现 ' + wreck.name, wreck.id);
    }
}
