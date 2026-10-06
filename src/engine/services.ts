import { deposit, space } from './inventory';
import { advanceSociety, appointCommander, personnelBonus } from './society';
import type { SimulationEngine } from './engine';
import { BUILD_COSTS, FACILITIES } from './definitions/progression';
import { makeShip, makeLocation } from './data';
import { RULES } from './definitions/rules';
import type { CargoKind, UpgradeId } from './types';
import type { ShipClassId } from './definitions/ships';
import { dist } from './navigation';
import { available } from './command-system';
export function advanceEconomy(e: SimulationEngine, dt: number) {
  const w = e.state,
    base = e.base;
  for (const l of w.locations.filter((l) => l.owner === 'starfleet' && l.hull > 0)) {
    l.core = Math.min(300, l.core + 5 * dt);
    l.cooldown = Math.max(0, l.cooldown - dt);
    if (w.time - l.attackedAt > 10)
      l.shield = Math.min(l.maxShield, l.shield + (l.kind === 'base' ? 12 : 3) * dt);
    l.production += dt;
    if (l.production >= 5 - 1e-8) {
      l.production = Math.max(0, l.production - 5);
      if (l.colony) {
        const c = l.colony,
          population = c.population / 1000,
          prosperity = Math.max(0.1, Math.min(1.2, (c.stability + c.morale + c.security) / 225)),
          industry = 0.5 + c.industry / 100;
        const eventFactor = (c.contamination > 20 ? 0.45 : 1) * (c.quarantine ? 0.6 : 1);
        w.resources.credits +=
          18 *
          population *
          prosperity *
          industry *
          eventFactor *
          (1 + personnelBonus(e, l.id, 'commander'));
      }
      if (
        l.kind === 'mine' &&
        !w.events.some(
          (v) =>
            v.kind === 'accident' &&
            v.subjectId === l.id &&
            ['reported', 'responding'].includes(v.stage),
        )
      ) {
        const site = w.bodies.find((b) => b.id === l.siteId);
        if (site && site.remaining > 0) {
          const n = deposit(l, 'materials', Math.min(site.remaining, 7 * site.richness));
          site.remaining -= n;
          l.extracted += n;
          if (site.remaining === 0) e.record('depletion', l.name + '矿藏已枯竭', l.id);
        }
      }
      const full = l.kind === 'mine' && space(l, 'materials') < 1e-8;
      if (full !== l.storageFull) {
        l.storageFull = full;
        e.report(
          l.name + (full ? '仓库已满，物资产线停产，请安排运输' : '仓位释放，物资产线恢复'),
          l.id,
          full ? 'high' : 'normal',
          'request',
        );
      }
    }
    if (w.time - l.attackedAt > 30) l.distress = false;
    const def = FACILITIES[l.kind],
      target = w.enemies
        .filter((x) => x.hull > 0 && dist(x, l) < def.range)
        .filter((x) => w.intel.some((i) => i.id === x.id && i.live && i.hostile))
        .sort((a, b) => dist(a, l) - dist(b, l) || a.id.localeCompare(b.id))[0];
    if (target && l.cooldown === 0 && l.core >= 8) {
      l.core -= 8;
      l.cooldown = 3;
      e.beam(l, target, 'Facility Phaser');
      e.hit(
        target,
        def.damage *
          (w.upgrades.defense ? 1.2 : 1) *
          (1 + personnelBonus(e, l.id, 'security') + (l.colony?.security ?? 0) / 200),
      );
    }
  }
  for (const l of w.locations.filter((l) => l.owner !== 'starfleet' && l.hull > 0)) {
    l.core = Math.min(300, l.core + 5 * dt);
    l.cooldown = Math.max(0, l.cooldown - dt);
    if (w.time - l.attackedAt > 10) l.shield = Math.min(l.maxShield, l.shield + 3 * dt);
    const def = FACILITIES[l.kind],
      target = w.ships.find(
        (s) => dist(s, l) < def.range && s.id === l.lastAttackerId && w.time - l.attackedAt < 12,
      );
    if (target && l.cooldown === 0 && l.core >= 8) {
      l.core -= 8;
      l.cooldown = 3;
      e.beam(l, target, 'Facility Phaser');
      e.hit(target, def.damage);
    }
  }
  for (const p of w.projects.filter((p) => !p.complete)) {
    if (available(w, p.id, 'materials') + 1e-8 < p.cost.materials) continue;
    if (
      p.refitLocationId &&
      !w.locations.some(
        (l) =>
          l.id === p.refitLocationId && l.owner === 'starfleet' && l.occupation === 'rebuilding',
      )
    )
      continue;
    p.work += dt;
    if (p.work + 1e-8 >= p.duration) {
      p.stock.materials = Math.max(0, p.stock.materials - p.cost.materials);
      let l;
      if (p.refitLocationId) {
        l = w.locations.find((l) => l.id === p.refitLocationId)!;
        if (!l || l.owner !== 'starfleet' || l.occupation !== 'rebuilding') continue;
        const replacement = makeLocation(l.id, p.name, 'base', l, 'starfleet', l.siteId);
        Object.assign(l, replacement);
      } else {
        l = makeLocation('facility-' + w.nextId++, p.name, p.kind, p, 'starfleet', p.siteId);
        w.locations.push(l);
      }
      l.stock = structuredClone(p.stock);
      if (!w.renamedEntityIds.includes(l.id)) w.renamedEntityIds.push(l.id);
      appointCommander(e, l);
      p.stock = { materials: 0, photon: 0, quantum: 0, specialFinds: 0 };
      p.complete = true;
      if (l.x >= 780 && Math.abs(l.y) < 650) w.tension = Math.min(100, w.tension + 12);
      e.record('construction', p.name + ' 建成：独立库存、产出、传感器与自卫上线', l.id);
    }
  }
  advanceSociety(e, dt);
  for (const j of w.jobs.filter((j) => !j.complete && !j.cancelled)) {
    const base = w.locations.find(
      (l) =>
        l.id === j.locationId &&
        l.kind === 'base' &&
        l.owner === 'starfleet' &&
        l.hull > 0 &&
        !l.occupation,
    );
    if (!base) continue;
    j.work += dt;
    if (j.work + 1e-8 < j.duration) continue;
    if (j.kind === 'manufacture' && space(base, j.key as CargoKind) < j.amount) {
      j.work = j.duration;
      continue;
    }
    j.complete = true;
    if (j.kind === 'ship') {
      const s = makeShip('ship-' + w.nextId++, j.name, j.key as ShipClassId, 'starfleet', {
        x: base.x,
        y: base.y + 45,
      });
      // Shipyard builds empty magazines: loading transfers real Armory ammunition separately.
      s.photon = 0;
      s.quantum = 0;
      w.ships.push(s);
      w.renamedEntityIds.push(s.id);
      const operatorId = 'ops-' + s.id;
      w.operators.push({
        id: operatorId,
        name: s.name + ' 值班指挥组',
        kind: 'rules',
        availability: 'available',
      });
      w.assignments.push({ operatorId, shipId: s.id, since: w.tick });
      e.record('growth', s.name + ' 新舰服役，独立舰籍 ' + s.id, s.id);
    } else if (j.kind === 'upgrade') {
      w.upgrades[j.key as UpgradeId] = 1;
      e.record('growth', j.name + ' 战略能力上线', base.id);
    } else {
      deposit(base, j.key as CargoKind, j.amount);
      e.record('industry', '制造 ' + j.amount + ' ' + j.key + ' 实物入库', base.id);
    }
  }
}
