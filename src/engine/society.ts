import type { SimulationEngine } from './engine';
import type { Career, Location, Personnel, Ship } from './types';
import { DEVELOPMENT } from './definitions/frontier';
import { available } from './inventory';
import { dist } from './navigation';
export function personnelBonus(e: SimulationEngine, targetId: string, career: Career) {
  return Math.min(
    0.3,
    e.state.personnel
      .filter((p) => p.status === 'assigned' && p.posting?.id === targetId)
      .reduce((n, p) => n + (p.skills[career] + Math.floor(p.experience / 60)) * 0.001, 0),
  );
}
export function appointCommander(e: SimulationEngine, l: Location) {
  if (!l.colony || l.colony.commanderId) return;
  const p: Personnel = {
    id: 'personnel-' + e.state.nextId++,
    name: l.name + ' 指挥官',
    originId: l.id,
    career: 'commander',
    experience: 0,
    skills: { battle: 20, science: 30, diplomacy: 30, logistics: 30, security: 40, commander: 50 },
    status: 'assigned',
    training: 90,
    locationId: l.id,
    posting: { type: 'colony', id: l.id },
  };
  e.state.personnel.push(p);
  l.colony.commanderId = p.id;
  l.colony.nextCandidate = e.state.time + 120;
}
export function advanceSociety(e: SimulationEngine, dt: number) {
  const w = e.state;
  for (const p of w.personnel) {
    if (p.status === 'training') {
      p.training = Math.min(90, p.training + dt);
      if (p.training >= 90 - 1e-8) {
        p.training = 90;
        p.status = 'available';
        e.record('personnel', p.name + ' 完成' + p.career + '培养，可任职', p.id);
      }
    }
    if (p.status === 'assigned') p.experience += dt * 0.1;
    if (p.posting?.type === 'ship') {
      const ship = w.ships.find((s) => s.id === p.posting!.id);
      if (!ship) {
        p.status = 'missing';
        p.posting = null;
        e.record('personnel', p.name + ' 随舰失联，人员档案独立保留', p.id);
      }
    }
  }
  for (const l of w.locations.filter((l) => l.owner === 'starfleet' && l.hull > 0 && l.colony)) {
    const c = l.colony!;
    if (c.development) {
      c.development.work += dt * (1 + personnelBonus(e, l.id, 'commander'));
      if (c.development.work >= DEVELOPMENT.minutes) {
        const kind = c.development.kind;
        if (kind === 'housing') c.housing += 500;
        else c[kind] = Math.min(100, c[kind] + 10);
        c.development = null;
        e.record('colony', l.name + ' ' + kind + '建设完成', l.id);
      }
    }
    if (c.population < c.housing && c.stability > 50 && c.morale > 50 && c.contamination < 20)
      c.population = Math.min(c.housing, c.population + (dt * c.population) / 100000);
    if (
      c.commanderId &&
      w.time >= c.nextCandidate &&
      c.population >= 250 &&
      c.stability >= 50 &&
      c.contamination < 20 &&
      w.personnel.filter((p) => p.originId === l.id && p.status === 'candidate').length < 3
    ) {
      c.nextCandidate = w.time + 360;
      const id = 'personnel-' + w.nextId++;
      const p: Personnel = {
        id,
        name: 'Cadet ' + id.split('-').at(-1),
        originId: l.id,
        career: 'science',
        experience: 0,
        skills: {
          battle: 25,
          science: 35,
          diplomacy: 25,
          logistics: 30,
          security: 25,
          commander: 25,
        },
        status: 'candidate',
        training: 0,
        locationId: l.id,
        posting: null,
      };
      w.personnel.push(p);
      e.record('candidate', l.name + ' Commander 推荐候选人 ' + p.name, p.id);
    }
  }
}
export function canMeet(e: SimulationEngine, p: Personnel, target: Ship | Location) {
  const at = [...e.state.locations, ...e.state.ships].find((x) => x.id === p.locationId);
  return !!at && dist(at, target) < 25;
}
export function fundDevelopment(
  e: SimulationEngine,
  l: Location,
  kind: NonNullable<NonNullable<Location['colony']>['development']>['kind'],
) {
  if (
    !l.colony ||
    l.colony.development ||
    e.state.resources.credits < DEVELOPMENT.credits ||
    available(e.state, l.id, 'materials') < DEVELOPMENT.materials
  )
    return false;
  e.state.resources.credits -= DEVELOPMENT.credits;
  l.stock.materials -= DEVELOPMENT.materials;
  l.colony.development = { kind, work: 0 };
  return true;
}
