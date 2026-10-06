import { deposit } from './inventory';
import { loseStock } from './inventory';
import { createEvent } from './world-events';
import type { SimulationEngine } from './engine';
import type { Enemy, ThreatReport } from './types';
import { GOODS } from './types';
import { capabilities, cargoUsed } from './capabilities';
import { regenerate } from './combat';
import { dist, move } from './navigation';
import { RULES } from './definitions/rules';
import { makeEnemy } from './data';
import { advanceEvasion, canDetectShip } from './tracking';
function gather(e: SimulationEngine, s: Enemy) {
  const w = e.state,
    range = capabilities(s).sensors,
    visible = [...w.ships, ...w.civilians].filter((x) => {
      const exposed =
        x.path.length > 0 &&
        x.current?.action.type === 'HAUL' &&
        x.current.action.route === 'risky';
      return (
        canDetectShip(s, x, w.time) || (exposed && x.cloak !== 'on' && dist(x, s) < range * 1.5)
      );
    });
  const reports: ThreatReport[] = [
    ...visible.map((x) => ({
      id: x.id,
      x: x.x,
      y: x.y,
      observerId: s.id,
      seenAt: w.time,
      kind: 'ship' as const,
      value: cargoUsed(x) * 8,
      defense:
        (x.hull + x.shield) * 0.65 +
        visible
          .filter((o) => o.id !== x.id && dist(o, x) < 130)
          .reduce((v, o) => v + (o.hull + o.shield) * 1.4, 0),
    })),
    ...w.locations
      .filter((l) => l.owner === 'starfleet' && l.hull > 0 && dist(l, s) < range)
      .map((l) => ({
        id: l.id,
        x: l.x,
        y: l.y,
        observerId: s.id,
        seenAt: w.time,
        kind: 'facility' as const,
        value:
          l.stock.materials * 5 +
          (l.colony ? l.colony.population * (0.5 + l.colony.industry / 100) * 0.1 : 0),
        defense:
          l.hull +
          l.shield +
          visible.filter((o) => dist(o, l) < 130).reduce((v, o) => v + o.hull + o.shield, 0),
      })),
  ];
  const faction = w.factions[s.factionId as 'orion' | 'romulan'];
  s.localReports = s.localReports.filter(
    (r) => w.time - r.seenAt < RULES.reportTTL && !reports.some((n) => n.id === r.id),
  );
  s.localReports.push(...reports);
  const home = w.locations.find((l) => l.id === s.homeId && l.owner === s.factionId && l.hull > 0);
  if (home && dist(s, home) < 240) {
    const received = s.localReports.filter((r) => w.time - r.seenAt < RULES.reportTTL);
    faction.reports = faction.reports.filter(
      (r) =>
        w.time - r.seenAt < RULES.reportTTL &&
        !received.some((n) => n.id === r.id && n.seenAt >= r.seenAt),
    );
    for (const r of received)
      if (!faction.reports.some((n) => n.id === r.id && n.seenAt >= r.seenAt))
        faction.reports.push(structuredClone(r));
  }
}
export function decideThreat(e: SimulationEngine, s: Enemy) {
  if (s.intent === 'docked') return;
  const w = e.state;
  if (w.time < s.nextDecision) return;
  s.nextDecision = w.time + RULES.decisionInterval;
  gather(e, s);
  const faction = w.factions[s.factionId as 'orion' | 'romulan'],
    home = w.locations.find((l) => l.id === s.homeId && l.owner === s.factionId && l.hull > 0);
  if (
    s.hull < capabilities(s).hull * 0.4 ||
    s.engines < 25 ||
    s.loot > 0 ||
    (s.photon === 0 && s.role === 'raider' && s.core < 20)
  ) {
    s.intent = 'retreat';
    s.targetId = null;
    s.destination = home?.hull ? { x: home.x, y: home.y } : null;
    return;
  }
  if (s.intent === 'retreat') return;
  if (
    s.factionId === 'romulan' &&
    s.role === 'warbird' &&
    (faction.stance === 'withdraw' ||
      (s.id === 'romulan-reserve' && !['reinforce', 'escalate'].includes(faction.stance)))
  ) {
    s.intent = 'retreat';
    s.targetId = null;
    s.destination = home ? { x: home.x, y: home.y } : null;
    return;
  }
  if (s.role === 'scout') {
    if (
      home &&
      dist(s, home) > 240 &&
      s.localReports.some(
        (r) => r.value > 0 && !faction.reports.some((x) => x.id === r.id && x.seenAt >= r.seenAt),
      )
    ) {
      s.intent = 'retreat';
      s.destination = { x: home.x, y: home.y };
      return;
    }
    s.intent = 'observe';
    s.targetId = null;
    // Scouts inspect charted navigation nodes, then investigate locally observed traffic.
    const traffic = [...s.localReports, ...faction.reports]
      .filter((r) => r.kind === 'ship' && w.time - r.seenAt < 30)
      .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))[0];
    const nodes =
      s.factionId === 'orion'
        ? [
            { x: 220, y: -80 },
            { x: 100, y: 150 },
            { x: -30, y: -140 },
          ]
        : [
            { x: 690, y: 120 },
            { x: 740, y: -160 },
            { x: 650, y: 300 },
          ];
    if (traffic && traffic.value > 0) s.destination = { x: traffic.x, y: traffic.y };
    else {
      const index = s.visited.length % nodes.length;
      s.destination = nodes[index];
      if (dist(s, s.destination) < 30) s.visited.push(String(index));
    }
    return;
  }
  const tension = s.factionId === 'romulan' ? w.tension : 0;
  const candidates = faction.reports
    .filter((r) => w.time - r.seenAt < RULES.reportTTL)
    .map((r) => ({
      r,
      score:
        (r.value + (s.factionId === 'romulan' ? tension * 9 : 0)) *
          (1 - (w.time - r.seenAt) / RULES.reportTTL) -
        r.defense * 1.4 -
        dist(s, r) * 0.15,
    }))
    .sort((a, b) => b.score - a.score || a.r.id.localeCompare(b.r.id));
  const best = candidates[0];
  if (
    best &&
    best.score > 15 &&
    (s.factionId === 'orion' || ['probe', 'reinforce', 'escalate'].includes(faction.stance)) &&
    (s.factionId === 'orion' || best.r.x >= 650)
  ) {
    s.targetId = best.r.id;
    s.destination = { x: best.r.x, y: best.r.y };
    s.intent = s.factionId === 'orion' ? 'raid' : 'probe';
  } else {
    s.targetId = null;
    s.intent = s.factionId === 'romulan' && tension > 15 ? 'patrol' : 'observe';
    s.destination =
      s.factionId === 'orion' ? (home ? { x: home.x, y: home.y } : null) : { x: 900, y: 150 };
  }
}
export function advanceEnemy(e: SimulationEngine, s: Enemy, dt: number) {
  const w = e.state;
  regenerate(s, w.time, dt);
  if (advanceEvasion(e, s, dt)) return;
  decideThreat(e, s);
  const home = w.locations.find((l) => l.id === s.homeId && l.owner === s.factionId && l.hull > 0);
  if (s.intent === 'retreat' || s.intent === 'docked') {
    if (!home) {
      s.intent = 'observe';
      s.targetId = null;
      return;
    }
    if (dist(s, home) > 15) {
      move(s, home, dt);
      return;
    }
    if (s.intent !== 'docked') {
      s.intent = 'docked';
      s.nextDecision = w.time + 10;
    }
    if (s.loot > 0) {
      for (const k of GOODS) {
        const sold = Math.floor(s.cargo[k] * 0.25);
        const unloaded = deposit(home, k, s.cargo[k] - sold);
        if (unloaded < s.cargo[k] - sold) {
          s.cargo[k] -= unloaded + sold;
          continue;
        }
        w.factions[s.factionId as 'orion' | 'romulan'].credits += sold * 5;
        s.cargo[k] = 0;
      }
      s.loot = cargoUsed(s);
      if (s.loot > 0) return;
    }
    if (home.stock.materials > 0.05 && s.hull < capabilities(s).hull) {
      const amount = Math.min(home.stock.materials, dt * 0.5, (capabilities(s).hull - s.hull) / 8);
      home.stock.materials -= amount;
      s.hull += amount * 8;
    }
    for (const k of ['engines', 'weapons'] as const) {
      const repair = Math.min(100 - s[k], dt * 4, home.stock.materials * 8);
      home.stock.materials -= repair / 8;
      s[k] += repair;
    }
    if (s.photon < capabilities(s).photon && home.stock.photon >= 1 && w.tick % 10 === 0) {
      home.stock.photon--;
      s.photon++;
    }
    if (
      w.time >= s.nextDecision &&
      s.hull >= capabilities(s).hull * 0.85 &&
      s.photon >= Math.min(2, capabilities(s).photon) &&
      s.core > capabilities(s).core * 0.7 &&
      s.engines >= 25
    ) {
      s.intent = 'observe';
      s.nextDecision = w.time + 5;
    }
    return;
  }
  const report = w.factions[s.factionId as 'orion' | 'romulan'].reports.find(
    (r) => r.id === s.targetId,
  );
  const target =
    report &&
    ([...w.ships, ...w.civilians].find((x) => x.id === report.id) ||
      w.locations.find((l) => l.id === report.id && l.owner === 'starfleet'));
  const targetVisible =
    !!target &&
    ('classId' in target
      ? canDetectShip(s, target, w.time)
      : dist(s, target) < capabilities(s).sensors);
  if (target && targetVisible && ['raid', 'probe'].includes(s.intent)) {
    s.destination = { x: target.x, y: target.y };
    if (s.factionId === 'orion' || w.factions.romulan.stance === 'escalate') e.fire(s, target);
    if (
      s.factionId === 'orion' &&
      dist(s, target) < 90 &&
      target.shield < 15 &&
      (('classId' in target && target.hull < capabilities(target).hull * 0.7) ||
        !('classId' in target))
    ) {
      const stock = 'cargo' in target ? target.cargo : target.stock;
      for (const k of GOODS) {
        const n = Math.min(
          Math.floor(stock[k]),
          Math.max(0, capabilities(s).cargo - cargoUsed(s)),
          8,
        );
        if (n <= 0) continue;
        if ('stock' in target) loseStock(e, target, k, n);
        else stock[k] -= n;
        s.cargo[k] += n;
        s.loot += n;
      }
      if (s.loot > 0) {
        e.record('cargoLoss', s.name + ' 抢走 ' + s.loot + ' 实物货物', target.id);
        s.intent = 'retreat';
        s.targetId = null;
      }
    }
  }
  if (s.destination && (!target || !targetVisible || dist(s, target) > 65))
    move(s, s.destination, dt);
  // A ship can defend itself without acquiring Federation-wide omniscience.
  if (s.lastAttackerId && w.time - s.attackedAt < 12) {
    const attacker = w.ships.find((x) => x.id === s.lastAttackerId && canDetectShip(s, x, w.time));
    if (attacker) e.fire(s, attacker);
  }
}
export function advanceFactions(e: SimulationEngine, dt: number) {
  const w = e.state;
  if (w.tick % 50 === 0) {
    const rom = w.factions.romulan,
      previous = rom.stance;
    const fresh = rom.reports.some((r) => w.time - r.seenAt < RULES.reportTTL && r.x >= 650);
    rom.stance = !fresh
      ? ['probe', 'reinforce', 'escalate', 'withdraw'].includes(previous)
        ? 'withdraw'
        : 'observe'
      : w.tension >= 65
        ? 'escalate'
        : w.tension >= 50
          ? 'reinforce'
          : w.tension >= 35
            ? 'probe'
            : w.tension >= 15
              ? 'patrol'
              : 'observe';
    if (['probe', 'reinforce'].includes(rom.stance)) {
      const intruder = rom.reports.find((r) => r.x >= 780 && w.ships.some((s) => s.id === r.id));
      if (intruder)
        createEvent(
          e,
          'diplomatic',
          intruder.id,
          'Romulan Warning：请撤离 Neutral Zone / Romulan territory',
        );
    }
    if (rom.stance === 'escalate' && previous !== 'escalate') {
      e.record('border', '收到 Romulan 军事升级声明', null);
      const assets = w.enemies.filter((s) => s.factionId === 'romulan' && s.role === 'warbird');
      const subject = rom.reports.filter((r) => r.x >= 650).sort((a, b) => b.seenAt - a.seenAt)[0];
      if (subject && assets.length)
        createEvent(
          e,
          'invasion',
          subject.id,
          'Border Command 基于真实边境报告派出现役军舰',
          assets.map((s) => s.id),
        );
      e.critical('escalation', subject?.id ?? w.commander.id, '收到 Romulan 军事升级声明');
    }
  }
  w.factions.orion.pressure = Math.max(
    0,
    w.factions.orion.pressure +
      dt *
        (w.factions.orion.reports
          .filter((r) => w.time - r.seenAt < RULES.reportTTL)
          .reduce((n, r) => n + r.value * (1 - (w.time - r.seenAt) / RULES.reportTTL), 0) /
          10000 -
          0.05),
  );
  const faction = w.factions.orion,
    home = w.locations.find((l) => l.id === 'orion-base' && l.owner === 'orion' && l.hull > 0);
  if (!home) return;
  // Replacements require returned loot, an industrial basket and actual construction time.
  const raiders = w.enemies.filter((s) => s.factionId === 'orion' && s.role === 'raider').length;
  if (raiders < 2 && home.stock.materials >= 20 && faction.credits >= 100) {
    faction.production += dt;
    if (faction.production >= 30) {
      faction.production = 0;
      home.stock.materials -= 20;
      faction.credits -= 100;
      const s = makeEnemy('orion-built-' + w.nextId++, 'raider', 'orion', home, home.id);
      s.photon = 0;
      for (let i = 0; i < 5 && home.stock.photon > 0; i++) {
        s.photon++;
        home.stock.photon--;
      }
      w.enemies.push(s);
    }
  } else faction.production = 0;
  if (
    home.stock.photon < 4 &&
    home.stock.materials >= 1 &&
    faction.credits >= 4 &&
    w.tick % 50 === 0
  ) {
    home.stock.materials--;
    faction.credits -= 4;
    home.stock.photon++;
  }
}
