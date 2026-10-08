import type {
  Agent,
  AgentState,
  Enemy,
  FacilityKind,
  FactionId,
  GoalKind,
  Location,
  Operator,
  Point,
  Ship,
  Stock,
  WorldState,
} from './types';
import { BASE, INITIAL_LOCATIONS } from './definitions/locations';
import { INITIAL_FLEET, SHIP_CLASSES, type ShipClassId } from './definitions/ships';
import { FACILITIES } from './definitions/progression';
import { materialize } from './world-generation';
import { DEFAULT_STANDING, STORAGE } from './definitions/frontier';
import { createGoal } from './agent/goals';
import { initialPersonality } from './agent/personality';
import { blankRelationships } from './agent/relationship';
export { BASE } from './definitions/locations';
export const emptyStock = (): Stock => ({
  materials: 0,

  photon: 0,
  quantum: 0,
  specialFinds: 0,
});
export function makeShip(
  id: string,
  name: string,
  classId: ShipClassId,
  factionId: FactionId,
  p: Point,
): Ship {
  const d = SHIP_CLASSES[classId];
  return {
    id,
    name,
    classId,
    factionId,
    x: p.x,
    y: p.y,
    hull: d.hull,
    shield: d.shield,
    core: d.core,
    photon: classId === 'galaxy' ? 36 : d.photon,
    quantum: classId === 'galaxy' ? 12 : d.quantum,
    modules: [],
    engines: 100,
    weapons: 100,
    status: factionId === 'starfleet' ? 'docked' : 'active',
    current: null,
    queue: [],
    suspended: [],
    standing: structuredClone(DEFAULT_STANDING),
    path: [],
    heading: 0,
    cargo: emptyStock(),
    passengers: 0,
    cooldowns: {},
    lastAttackerId: null,
    attackedAt: -1000,
    scanUntil: 0,
    cloak: d.cloak ? 'on' : 'off',
    cloakUntil: 0,
    emergencyRetreat: null,
    tracking: null,
  };
}
export function makeEnemy(
  id: string,
  classId: ShipClassId,
  factionId: 'orion' | 'romulan',
  p: Point,
  homeId = factionId + '-base',
  role: Enemy['role'] = 'raider',
): Enemy {
  return {
    ...makeShip(
      id,
      factionId === 'orion'
        ? 'Orion ' + (role === 'scout' ? 'Surveyor' : 'Raider') + ' ' + id
        : SHIP_CLASSES[classId].name,
      classId,
      factionId,
      p,
    ),
    homeId,
    role,
    intent: 'observe',
    targetId: null,
    destination: null,
    nextDecision: 0,
    visited: [],
    loot: 0,
    localReports: [],
    lastHostileAt: -1000,
    lastHostileTargetId: null,
    counterTracking: {
      position: { x: p.x, y: p.y },
      watchers: {},
      evading: false,
      waypoints: [],
      lastSeen: 0,
      checkedAt: 0,
      serial: 0,
    },
  };
}
export function makeLocation(
  id: string,
  name: string,
  kind: FacilityKind,
  p: Point,
  owner: FactionId = 'starfleet',
  siteId: string | null = null,
): Location {
  const def = FACILITIES[kind];
  return {
    id,
    name,
    label: name,
    kind,
    owner,
    siteId,
    x: p.x,
    y: p.y,
    stock: emptyStock(),
    hull: def.hull,
    maxHull: def.hull,
    shield: def.shield,
    maxShield: def.shield,
    core: 300,
    attackedAt: -1000,
    lastAttackerId: null,
    cooldown: 0,
    distress: false,
    discovered: owner === 'starfleet',
    production: 0,
    capacity: structuredClone(STORAGE[kind]),

    storageFull: false,
    extracted: 0,
    occupation: null,
    colony:
      kind === 'colony'
        ? {
            population: 250,
            housing: 1000,
            stability: 75,
            morale: 75,
            security: 75,
            industry: 50,
            science: 50,
            commanderId: null,
            nextCandidate: 120,
            contamination: 0,
            quarantine: false,
            development: null,
          }
        : null,
  };
}
/**
 * The Lv3 starting roster (Agent.md §9–§12, docs/lv3/01-mvp-scenario.md §3).
 *
 * Four careers, four personalities, one ship each. The remaining two ships keep `kind: 'rules'`
 * operators and act as the control group: nothing in Lv3 changes how a rules-driven ship behaves.
 *
 * Binding is `Operator.agentId` rather than a naming convention, because `Agent.id` is `'agent-<n>'`
 * and shares no name with `operatorId` (docs/lv3/03-implementation-plan.md §4.1).
 */
const INITIAL_AGENTS: readonly {
  career: Agent['career'];
  name: string;
  shipId: string;
  goalKind: GoalKind;
}[] = [
  { career: 'explorer', name: 'LYRA VOSS / 薇拉', shipId: 'vigil', goalKind: 'discovery' },
  { career: 'tactical', name: 'NOAH KESTREL / 诺亚', shipId: 'verity', goalKind: 'command' },
  { career: 'scientist', name: 'IRIS NAKAMURA / 艾瑞斯', shipId: 'horizon', goalKind: 'research' },
  { career: 'logistics', name: 'OMAR ZAYID / 奥马尔', shipId: 'meridian', goalKind: 'logistics' },
];

/**
 * Starting psychological state. Agent.md fixes the variables and their ranges but not their initial
 * values; these are proposals (a fresh crew, rested, cautiously trusting) to be calibrated in P3.
 */
function initialAgentState(): AgentState {
  return {
    fatigue: 0,
    stress: 0,
    morale: 75,
    trustInAdmiral: 60,
    loyaltyToCompany: 75,
    experience: 0,
    reputation: 0,
    goalProgress: 0,
  };
}

export function createWorld(seed = 236807): WorldState {
  const ships = INITIAL_FLEET.map((s, i) =>
    makeShip(s.id, s.name, s.classId, 'starfleet', { x: BASE.x + (i - 1.5) * 28, y: BASE.y + 45 }),
  );
  // Agent ids are allocated after every pre-existing id in this function, and the relationships are
  // filled in a second pass because each Agent needs the whole roster. `nextId` therefore advances
  // by exactly four, shifting later runtime ids (`directive-5`, ...) — no existing save or test
  // depends on a new world's first generated id.
  let nextId = 1;
  const agents: Agent[] = INITIAL_AGENTS.map((definition, index) => {
    const id = 'agent-' + nextId++;
    return {
      id,
      name: definition.name,
      career: definition.career,
      personality: initialPersonality(definition.career),
      state: initialAgentState(),
      goal: createGoal('goal:' + id, definition.goalKind),
      relationships: [],
      memories: [],
      promises: [],
      // Staggered so a fresh load does not fire the whole roster on the same beat (analogous to
      // Enemy.nextDecision).
      nextDecisionAt: (index + 1) * 5,
    };
  });
  const agentIds = agents.map((a) => a.id);
  for (const agent of agents) agent.relationships = blankRelationships(agent.id, agentIds);
  const agentByShip = new Map(
    INITIAL_AGENTS.map((definition, index) => [definition.shipId, agents[index].id]),
  );
  const operators: Operator[] = ships.map((s) => {
    const agentId = agentByShip.get(s.id);
    return agentId
      ? {
          id: 'ops-' + s.id,
          name: s.name + ' · 值班指挥组',
          kind: 'agent',
          agentId,
          availability: 'available',
        }
      : {
          id: 'ops-' + s.id,
          name: s.name + ' · 值班指挥组',
          kind: 'rules',
          availability: 'available',
        };
  });
  const w: WorldState = {
    version: 11,
    tick: 0,
    time: 0,
    seed: seed >>> 0,
    initialSeed: seed >>> 0,
    paused: true,
    speed: 1,
    status: 'active',
    pauseReasons: [],
    commander: { id: 'commander', name: 'Dawn Frontier Command', rank: 'ADMIRAL' },
    operators,
    assignments: ships.map((s) => ({ operatorId: 'ops-' + s.id, shipId: s.id, since: 0 })),
    losses: [],
    ships,
    enemies: [],
    sectors: [],
    systems: [],
    bodies: [],
    locations: INITIAL_LOCATIONS.map((l) => makeLocation(l.id, l.name, l.kind, l)),
    projects: [],
    jobs: [],
    wrecks: [],
    intel: [],
    siteIntel: [],
    recoveredVeil: false,
    contactAlerts: [],
    dismissedMarkerIds: [],
    factions: {
      orion: {
        reports: [],
        credits: 40,
        production: 0,
        losses: [],
        stance: 'observe',
        pressure: 0,
      },
      romulan: {
        reports: [],
        credits: 150,
        production: 0,
        losses: [],
        stance: 'observe',
        pressure: 0,
      },
    },
    tension: 0,
    resources: { credits: 380 },
    productionDiscountUnlocked: false,
    renamedEntityIds: [],
    upgrades: { shipyard: 0, armory: 0, sensors: 0, logistics: 0, defense: 0 },
    groups: [],
    personnel: [],
    events: [],
    wormholes: [],
    civilians: [],
    trade: {
      stock: { materials: 400, photon: 60, quantum: 10, specialFinds: 0 },
      credits: 2000,
      capacity: { materials: 1000, photon: 300, quantum: 100, specialFinds: 50 },
      depot: { x: -640, y: -140 },
      orders: [],
    },
    communications: [],
    logs: [],
    history: [],
    beams: [],
    agents,
    agentMessages: [],
    agentInteractions: [],
    nextId,
    nextLog: 1,
    nextComms: 1,
    nextHistory: 1,
  };
  const base = w.locations[0];
  base.stock = { materials: 70, photon: 90, quantum: 20, specialFinds: 0 };
  w.locations.find((l) => l.id === 'colony')!.colony!.population = 1000;
  w.locations.find((l) => l.id === 'colony')!.colony!.housing = 1500;
  w.locations.find((l) => l.id === 'mine')!.stock = {
    ...emptyStock(),
    materials: 120,
  };
  for (const coord of [
    { q: -1, r: 0 },
    { q: 0, r: 0 },
    { q: 1, r: 0 },
  ]) {
    const sec = materialize(w, coord);
    sec.discovered = true;
    for (const sys of w.systems.filter((s) => s.sectorId === sec.id)) {
      sys.discovered = true;
      sys.survey = 1;
      for (const b of w.bodies.filter((b) => b.systemId === sys.id)) {
        b.discovered = !b.hidden;
        b.survey = b.hidden ? 0 : 1;
      }
    }
  }
  w.locations.find((l) => l.id === 'mine')!.siteId = 'helios-deposit';
  w.locations.find((l) => l.id === 'colony')!.siteId = 'new-horizon-world';
  for (const id of ['helios-deposit', 'new-horizon-world'])
    w.bodies.find((b) => b.id === id)!.survey = 2;
  for (const h of w.wormholes)
    h.discovered = w.sectors.some((s) => s.id === h.sectorId && s.discovered);
  w.personnel.push({
    id: 'commander-colony',
    name: 'Commander 陈星',
    originId: 'colony',
    career: 'commander',
    experience: 0,
    skills: { battle: 20, science: 30, diplomacy: 40, logistics: 35, security: 40, commander: 60 },
    status: 'assigned',
    training: 90,
    locationId: 'colony',
    posting: { type: 'colony', id: 'colony' },
  });
  w.locations.find((l) => l.id === 'colony')!.colony!.commanderId = 'commander-colony';
  w.civilians.push({
    ...makeShip(
      'federation-carrier',
      'SS FEDERATION EXCHANGE',
      'antares',
      'starfleet',
      w.trade.depot,
    ),
    homeId: 'exchange',
    orderId: null,
    phase: 'idle',
    work: 0,
  });
  const orion = makeLocation(
    'orion-base',
    'Orion Hideout',
    'outpost',
    { x: 500, y: -530 },
    'orion',
  );
  orion.stock = { ...emptyStock(), materials: 15, photon: 12 };
  w.locations.push(orion);
  const romulan = makeLocation(
    'romulan-base',
    'Romulan Border Command',
    'base',
    { x: 1180, y: 150 },
    'romulan',
  );
  romulan.stock = { ...emptyStock(), materials: 40, photon: 60 };
  w.locations.push(romulan);
  w.enemies = [
    makeEnemy('orion-scout', 'raider', 'orion', { x: 400, y: -250 }, orion.id, 'scout'),
    makeEnemy('orion-raider-1', 'raider', 'orion', { x: 500, y: -480 }, orion.id),
    makeEnemy('orion-raider-2', 'raider', 'orion', { x: 540, y: -510 }, orion.id),
    makeEnemy('romulan-scout', 'scout', 'romulan', { x: 820, y: 50 }, romulan.id, 'scout'),
    makeEnemy('romulan-reserve', 'dderidex', 'romulan', { x: 1200, y: 200 }, romulan.id, 'warbird'),
    makeEnemy('romulan-warbird', 'valdore', 'romulan', { x: 1060, y: 180 }, romulan.id, 'warbird'),
  ];
  w.communications.push({
    id: w.nextComms++,
    time: 0,
    priority: 'high',
    text: 'ADMIRAL：六舰待命。向 UNKNOWN SPACE 测绘，矿场已有材料等待运回；新曙殖民地提供 Credits 收益，矿场满仓时需要运输材料。',
    read: false,
    entityId: 'mine',
    category: 'request',
  });
  return w;
}
