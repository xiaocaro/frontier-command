import type { SimulationSpeed } from './clock';
import type { ShipClassId } from './definitions/ships';
import type {
  Agent,
  AgentEvent,
  AgentInteraction,
  AgentMessage,
  AgentMessageKind,
  AgentObservation,
  AgentTrigger,
  MessagePayload,
} from './agent/types';
export type {
  Agent,
  AgentActionCandidate,
  AgentCareer,
  AgentDecision,
  AgentEvent,
  AgentGoal,
  AgentInteraction,
  AgentMemory,
  AgentMessage,
  AgentMessageKind,
  AgentObservation,
  AgentPersonality,
  AgentPromise,
  AgentRelationship,
  AgentState,
  AgentStateDelta,
  AgentTrigger,
  EpisodicMemory,
  GoalKind,
  InteractionKind,
  InteractionOutcome,
  MemoryTag,
  MessagePayload,
  PromiseFulfillment,
  PromiseMemory,
  PromiseStatus,
  PromiseType,
  SocialMemory,
} from './agent/types';
export type Point = { x: number; y: number };
export type FactionId = 'starfleet' | 'orion' | 'romulan';
export const GOODS = ['materials', 'photon', 'quantum', 'specialFinds'] as const;
export type CargoKind = (typeof GOODS)[number];
export type Stock = Record<CargoKind, number>;
export type Ammunition = { photon: number; quantum: number };
export type ROE = 'HOLD FIRE' | 'RETURN FIRE' | 'ENGAGE HOSTILES';
export type ModuleId =
  | 'deepScan'
  | 'longRangeSensors'
  | 'precisionTargeting'
  | 'reinforcedShields'
  | 'expandedCargo';
export type UpgradeId = 'shipyard' | 'armory' | 'sensors' | 'logistics' | 'defense';
export type FacilityKind = 'base' | 'colony' | 'mine' | 'outpost' | 'platform';
export type RouteKind = 'safe' | 'direct' | 'risky';
export type SectorCoord = { q: number; r: number };
export interface Sector extends SectorCoord {
  id: string;
  systemIds: string[];
  discovered: boolean;
}
export interface StarSystem extends Point {
  id: string;
  name: string;
  sectorId: string;
  discovered: boolean;
  survey: number;
  bodyIds: string[];
  starClass: 'M' | 'K' | 'G' | 'F' | 'A' | 'giant' | 'neutron';
}
export interface Body extends Point {
  id: string;
  name: string;
  systemId: string;
  kind: 'planet' | 'moon' | 'belt' | 'resource' | 'anomaly' | 'ruins' | 'derelict';
  category: string;
  population: number;
  survey: number;
  habitable: boolean;
  remaining: number;
  richness: number;
  hazard: number;
  hidden: boolean;
  specialClaimed: boolean;
  discovered: boolean;
}
export interface Location extends Point {
  id: string;
  name: string;
  label: string;
  kind: FacilityKind;
  owner: FactionId;
  siteId: string | null;
  stock: Stock;
  hull: number;
  maxHull: number;
  shield: number;
  maxShield: number;
  core: number;
  attackedAt: number;
  lastAttackerId: string | null;
  cooldown: number;
  distress: boolean;
  discovered: boolean;
  production: number;
  capacity: Stock;

  storageFull: boolean;
  extracted: number;
  colony: ColonyState | null;
  occupation: 'ruined' | 'secured' | 'rebuilding' | null;
}
export const CAREERS = [
  'battle',
  'science',
  'diplomacy',
  'logistics',
  'security',
  'commander',
] as const;
export type Career = (typeof CAREERS)[number];
export interface ColonyState {
  population: number;
  housing: number;
  stability: number;
  morale: number;
  security: number;
  industry: number;
  science: number;
  commanderId: string | null;
  nextCandidate: number;
  contamination: number;
  quarantine: boolean;
  development: { kind: 'housing' | 'industry' | 'science' | 'security'; work: number } | null;
}
export interface Personnel {
  id: string;
  name: string;
  originId: string;
  career: Career;
  experience: number;
  skills: Record<Career, number>;
  status: 'candidate' | 'training' | 'available' | 'assigned' | 'rejected' | 'missing';
  training: number;
  locationId: string;
  posting: { type: 'ship' | 'colony'; id: string } | null;
}
export interface TaskGroup {
  id: string;
  name: string;
  shipIds: string[];
  flagshipId: string;
  spacing: number;
}
export interface StandingOrders {
  roe: ROE;
  retreatHull: number;
  retreatShield: number;
  retreatCore: number;
  photonThreshold: number;
  quantumThreshold: number;
  maxPursuit: number;
  allowNeutral: boolean;
  allowRomulan: boolean;
  autoEscort: boolean;
  respondDistress: boolean;
  protectCivilian: boolean;
  protectFreighter: boolean;
  protectColony: boolean;
  serviceWhenDocked: boolean;
}
export interface Wormhole extends Point {
  id: string;
  name: string;
  sectorId: string;
  discovered: boolean;
  surveyed: boolean;
  exit: Point;
  exitSector: SectorCoord;
  stability: number;
  stable: boolean;
  transits: number;
}
export type WorldEventKind =
  | 'wormhole'
  | 'plague'
  | 'invasion'
  | 'accident'
  | 'distress'
  | 'refugees'
  | 'discovery'
  | 'derelict'
  | 'diplomatic';
export interface WorldEvent {
  id: string;
  kind: WorldEventKind;
  subjectId: string;
  created: number;
  deadline: number;
  stage: 'reported' | 'responding' | 'resolved' | 'failed';
  evidence: string;
  choice: string | null;
  work: number;
  population: number;
  carrierId: string | null;
  targetId: string | null;
  assetIds: string[];
  followUpId: string | null;
  outcome: string;
}
/** Derived public response information; never persisted in WorldState. */
export interface MineAccidentResponse {
  workRequired: number;
  materialRequired: number;
  availableAtSite: number;
  responders: {
    shipId: string;
    phase: 'travelling' | 'working' | 'awaitingMaterials';
    cargoMaterials: number;
    shortfall: number;
  }[];
}
export interface CivilianShip extends Ship {
  homeId: string;
  orderId: string | null;
  phase: 'idle' | 'loading' | 'delivery' | 'return';
  work: number;
}
export interface TradeOrder {
  id: string;
  direction: 'buy' | 'sell';
  cargoKind: CargoKind;
  amount: number;
  delivered: number;
  loaded: number;
  price: number;
  state: 'waiting' | 'loading' | 'delivery' | 'complete' | 'lost';
  carrierId: string | null;
}
export interface TradeState {
  stock: Stock;
  credits: number;
  capacity: Stock;
  depot: Point;
  orders: TradeOrder[];
}
export type Action =
  | { type: 'MOVE'; point: Point }
  | { type: 'EXPLORE'; sector: SectorCoord; approach: 'remote' | 'close' }
  | { type: 'SURVEY'; targetId: string; approach: 'remote' | 'close'; deep: boolean }
  | { type: 'RETURN' }
  | { type: 'ASSIST_EVENT'; targetId: string }
  | { type: 'TRANSIT'; targetId: string }
  | { type: 'CAPTURE'; targetId: string }
  | { type: 'HAIL'; targetId: string; message: 'greeting' | 'withdraw' | 'deescalate' }
  | {
      type: 'HAUL';
      sourceId: string;
      targetId: string;
      cargoKind: CargoKind;
      amount: number;
      route: RouteKind;
      repeat: boolean;
    }
  | {
      type: 'ATTACK' | 'DISABLE' | 'DRIVE_OFF' | 'INTERCEPT' | 'SHADOW';
      targetId: string;
      subsystem?: 'engines' | 'weapons';
    }
  | { type: 'ESCORT'; targetId: string }
  | { type: 'PATROL'; targetId: string; duration: number }
  | { type: 'RETREAT' | 'DOCK'; targetId: string }
  | { type: 'REPAIR'; targetId: string }
  | { type: 'REARM'; targetId: string; load: Ammunition }
  | { type: 'REFIT'; targetId: string; moduleId: ModuleId; remove: boolean }
  | { type: 'UNLOAD'; targetId: string }
  | { type: 'RECOVER'; targetId: string };
export interface Directive {
  id: string;
  action: Action;
  created: number;
  phase: string;
  work: number;
  moved: number;
  carried: number;
  delivered: number;
  reserved: Stock;
  paidCredits: number;
  search: number;
  note: string;
  source: 'admiral' | 'standing';
  groupOrderId: string | null;
  groupSlot: number;
  groupTotal: number;
  groupSpacing: number;
  origin: Point;
}
export interface Ship extends Point {
  id: string;
  name: string;
  classId: ShipClassId;
  factionId: FactionId;
  hull: number;
  shield: number;
  core: number;
  photon: number;
  quantum: number;
  modules: ModuleId[];
  engines: number;
  weapons: number;
  status: 'docked' | 'active' | 'idle';
  current: Directive | null;
  queue: Directive[];
  suspended: Directive[];
  standing: StandingOrders;
  path: Point[];
  heading: number;
  cargo: Stock;
  passengers: number;
  cooldowns: Record<string, number>;
  lastAttackerId: string | null;
  attackedAt: number;
  scanUntil: number;
  cloak: 'off' | 'on' | 'decloaking';
  cloakUntil: number;
  emergencyRetreat: { point: Point; started: number } | null;
  tracking: { targetId: string; position: Point; lastSeen: number; live: boolean } | null;
}
export interface Enemy extends Ship {
  homeId: string;
  role: 'scout' | 'raider' | 'warbird';
  intent: 'observe' | 'raid' | 'probe' | 'patrol' | 'retreat' | 'docked';
  targetId: string | null;
  destination: Point | null;
  nextDecision: number;
  visited: string[];
  loot: number;
  localReports: ThreatReport[];
  lastHostileAt: number;
  lastHostileTargetId: string | null;
  counterTracking: {
    position: Point;
    watchers: Record<
      string,
      { exposure: number; identified: boolean; lastSeen: number; position: Point; bearing: number }
    >;
    evading: boolean;
    waypoints: Point[];
    lastSeen: number;
    checkedAt: number;
    serial: number;
  };
}
export type IntelLevel = 'CONTACT' | 'CLASSIFIED' | 'IDENTIFIED' | 'TRACKED';
export interface IntelRecord extends Point {
  id: string;
  level: IntelLevel;
  strength: number;
  lastSeen: number;
  live: boolean;
  hostile: boolean;
  name?: string;
  factionId?: FactionId;
  classId?: ShipClassId;
  hull?: number;
  shield?: number;
  velocity: Point;
  resolved: boolean;
  lastAttackTargetId?: string;
  lastAttackAt?: number;
}
export interface ThreatReport extends Point {
  id: string;
  observerId: string;
  seenAt: number;
  value: number;
  defense: number;
  kind: 'ship' | 'facility';
}
export interface FactionState {
  reports: ThreatReport[];
  credits: number;
  production: number;
  losses: string[];
  stance: 'observe' | 'probe' | 'patrol' | 'reinforce' | 'escalate' | 'withdraw';
  pressure: number;
}
export interface Cost {
  credits: number;
  materials: number;

  specialFinds: number;
}
export interface Construction extends Point {
  id: string;
  name: string;
  kind: FacilityKind;
  siteId: string;
  refitLocationId: string | null;
  stock: Stock;
  capacity: Stock;
  cost: Cost;
  work: number;
  duration: number;
  complete: boolean;
}
export interface IndustryJob {
  id: string;
  locationId: string;
  kind: 'ship' | 'upgrade' | 'manufacture';
  key: string;
  amount: number;
  work: number;
  duration: number;
  complete: boolean;
  cancelled: boolean;
  name: string;
}
export interface Operator {
  id: string;
  name: string;
  /** `'agent'` operators are driven by an Lv3 Agent; `'rules'` operators keep the Lv1/Lv2 behaviour. */
  kind: 'rules' | 'agent';
  /** Set exactly when `kind === 'agent'`; points at `Agent.id` (docs/lv3/03-implementation-plan.md §4.1). */
  agentId?: string;
  availability: 'available' | 'vesselLost';
}
export interface Assignment {
  operatorId: string;
  shipId: string;
  since: number;
}
export interface LossRecord {
  shipId: string;
  name: string;
  classId: ShipClassId;
  tick: number;
  position: Point;
  reason: string;
  cargo: Stock;
  ammunition: Ammunition;
  operatorIds: string[];
}
export interface HistoryEntry {
  id: number;
  time: number;
  kind: string;
  text: string;
  entityId: string | null;
}
export interface Communication {
  id: number;
  time: number;
  priority: 'normal' | 'high' | 'urgent';
  text: string;
  read: boolean;
  entityId: string | null;
  category: 'request' | 'report' | 'threat' | 'decision';
}
export interface LogEntry {
  id: number;
  time: number;
  level: 'info' | 'success' | 'warning' | 'danger';
  text: string;
}
export interface Beam {
  from: Point;
  to: Point;
  enemy: boolean;
  weapon: string;
  expires: number;
}
export const CRITICAL_KINDS = [
  'newContact',
  'lowHull',
  'shipDestroyed',
  'facilityDestroyed',
  'escalation',
  'commandLost',
] as const;
export interface CriticalReason {
  kind: (typeof CRITICAL_KINDS)[number];
  entityId: string;
  tick: number;
  time: number;
  message: string;
}
export type SimulationEvent =
  | PublicSimulationEvent
  | { type: 'dayBoundary'; day: number; tick: number; time: number }
  | { type: 'criticalPause'; reasons: CriticalReason[] }
  | { type: 'shipDestroyed'; shipId: string; operatorIds: string[]; tick: number }
  | { type: 'commandLost'; tick: number }
  /**
   * Lv3 decision trigger. Carried on the transient `pendingEvents` channel, so it never enters
   * `WorldState` and cannot affect the same-seed replay assertion.
   */
  | { type: 'agentTrigger'; trigger: AgentTrigger }
  /**
   * Lv3 settlement fact. Carried on the same transient `pendingEvents` channel as the trigger above,
   * so it never enters `WorldState` and cannot affect the same-seed replay assertion. The host
   * relaunches it as an `agentEvent` Command, which is what actually writes the Agent roster.
   */
  | { type: 'agentEvent'; event: AgentEvent };
/** Only completed, visible own-ship actions may be delivered as UI events. */
export type PublicSimulationEvent = {
  type: 'shipTransited';
  shipId: string;
  destination: Point;
  tick: number;
};
export interface Wreck extends Point {
  id: string;
  name: string;
  stock: Stock;
  discovered: boolean;
}
/** Authoritative reconnaissance evidence; hidden location identifiers never cross IPC. */
export interface SiteIntel extends Point {
  id: string;
  locationId: string;
  progress: number;
  lastSeen: number;
}
export interface WorldState {
  version: 11;
  tick: number;
  time: number;
  seed: number;
  initialSeed: number;
  paused: boolean;
  speed: SimulationSpeed;
  status: 'active' | 'commandLost';
  pauseReasons: CriticalReason[];
  commander: { id: string; name: string; rank: string };
  operators: Operator[];
  assignments: Assignment[];
  losses: LossRecord[];
  ships: Ship[];
  enemies: Enemy[];
  sectors: Sector[];
  systems: StarSystem[];
  bodies: Body[];
  locations: Location[];
  projects: Construction[];
  jobs: IndustryJob[];
  wrecks: Wreck[];
  intel: IntelRecord[];
  siteIntel: SiteIntel[];
  recoveredVeil: boolean;
  contactAlerts: { contactId: string; lastAlertAt: number; hostileAlerted: boolean }[];
  dismissedMarkerIds: string[];
  factions: { orion: FactionState; romulan: FactionState };
  tension: number;
  resources: { credits: number };
  upgrades: Record<UpgradeId, number>;
  productionDiscountUnlocked: boolean;
  renamedEntityIds: string[];
  groups: TaskGroup[];
  personnel: Personnel[];
  events: WorldEvent[];
  wormholes: Wormhole[];
  civilians: CivilianShip[];
  trade: TradeState;
  communications: Communication[];
  logs: LogEntry[];
  history: HistoryEntry[];
  beams: Beam[];
  /** Lv3 Agent roster (bounded: 4 initial Agents). */
  agents: Agent[];
  /** Lv3 Admiral <-> Agent and Agent <-> Agent messages (bounded: 200). */
  agentMessages: AgentMessage[];
  /** Lv3 interaction audit trail, including the effects actually applied (bounded: 200). */
  agentInteractions: AgentInteraction[];
  nextId: number;
  nextLog: number;
  nextComms: number;
  nextHistory: number;
}
export interface Opportunity {
  id: string;
  kind: 'exploration' | 'mining' | 'logistics' | 'security' | 'construction';
  targetId: string;
  text: string;
}
/** Public read model: faction assets, intentions, seed and unknown geography are deliberately absent. */
interface SnapshotData {
  version: 11;
  tick: number;
  time: number;
  paused: boolean;
  speed: SimulationSpeed;
  status: WorldState['status'];
  pauseReasons: CriticalReason[];
  commander: WorldState['commander'];
  operators: Operator[];
  assignments: Assignment[];
  losses: LossRecord[];
  ships: Ship[];
  contacts: IntelRecord[];
  siteContacts: { id: string; x: number; y: number; progress: number; lastSeen: number }[];
  sectors: Sector[];
  systems: StarSystem[];
  bodies: Body[];
  locations: Location[];
  projects: Construction[];
  jobs: IndustryJob[];
  wrecks: Wreck[];
  resources: WorldState['resources'];
  baseResources: { credits: number; stock: Stock; available: Stock; reserved: Stock };
  inventories: { locationId: string; available: Stock; reserved: Stock }[];
  production: {
    discounted: boolean;
    ships: Record<string, { original: Cost; actual: Cost }>;
    ammunition: Record<'photon' | 'quantum', { original: Cost; actual: Cost }>;
  };
  renamedEntityIds: string[];
  mapMarkers: { dismissedIds: string[]; removableIds: string[] };
  upgrades: WorldState['upgrades'];
  tension: number;
  communications: Communication[];
  logs: LogEntry[];
  history: HistoryEntry[];
  beams: Beam[];
  opportunities: Opportunity[];
  armory: { stock: Ammunition; reserved: Ammunition };
  groups: TaskGroup[];
  personnel: Personnel[];
  events: (WorldEvent & { accidentResponse?: MineAccidentResponse })[];
  wormholes: Omit<Wormhole, 'exit' | 'exitSector'>[];
  civilians: CivilianShip[];
  trade: TradeState;
}
export type Command =
  | { type: 'dismissMapMarker'; entityId: string }
  | {
      type: 'issueDirective';
      shipIds: string[];
      mode: 'REPLACE' | 'QUEUE' | 'INTERRUPT';
      action: Action;
    }
  | { type: 'cancelDirective'; shipId: string }
  | { type: 'standingOrders'; shipId: string; orders: StandingOrders }
  | { type: 'setCloak'; shipId: string; enabled: boolean }
  | { type: 'createGroup'; name: string; shipIds: string[]; flagshipId: string; spacing: number }
  | {
      type: 'updateGroup';
      groupId: string;
      name: string;
      shipIds: string[];
      flagshipId: string;
      spacing: number;
    }
  | { type: 'deleteGroup'; groupId: string }
  | {
      type: 'issueGroupDirective';
      groupId: string;
      mode: 'REPLACE' | 'QUEUE' | 'INTERRUPT';
      action: Action;
    }
  | { type: 'candidate'; personnelId: string; accept: boolean; career: Career }
  | {
      type: 'assignPersonnel';
      personnelId: string;
      targetId: string;
      targetType: 'ship' | 'colony';
    }
  | {
      type: 'developColony';
      locationId: string;
      kind: 'housing' | 'industry' | 'science' | 'security';
    }
  | {
      type: 'respondEvent';
      eventId: string;
      choice:
        | 'assist'
        | 'quarantine'
        | 'liftQuarantine'
        | 'accept'
        | 'reject'
        | 'withdraw'
        | 'stabilize';
      targetId?: string;
    }
  | { type: 'tradeStock'; direction: 'buy' | 'sell'; cargoKind: CargoKind; amount: number }
  | { type: 'renameEntity'; entityId: string; name: string }
  | { type: 'startConstruction'; siteId: string; kind: Exclude<FacilityKind, 'base'>; name: string }
  | { type: 'startBaseRefit'; locationId: string; name: string }
  | { type: 'buildShip'; classId: ShipClassId; name: string; locationId?: string }
  | { type: 'upgrade'; upgradeId: UpgradeId; locationId?: string }
  | { type: 'manufacture'; cargoKind: 'photon' | 'quantum'; amount: number; locationId?: string }
  | { type: 'sellStock'; cargoKind: CargoKind; amount: number }
  | { type: 'repairFacility'; locationId: string }
  | { type: 'acknowledge'; communicationId: number }
  | { type: 'pause'; paused: boolean }
  | { type: 'speed'; speed: SimulationSpeed }
  /**
   * Lv3: the only command through which Agent social writes enter the engine. An Agent may only
   * speak as itself (`from === actorId && from !== 'admiral'`); the Admiral may speak as `'admiral'`
   * (docs/lv3/03-implementation-plan.md §4.5/§4.6).
   */
  | {
      type: 'agentMessage';
      from: 'admiral' | string;
      to: string | 'admiral';
      kind: AgentMessageKind;
      text: string;
      payload: MessagePayload | null;
    }
  /**
   * Lv3: how an engine branch reports a settled fact so Agent state, memory, goals, relationships and
   * promises can be written. The engine applies it through the pure `src/engine/agent/**` functions,
   * which keeps `dispatchCommand` the single write door (CLAUDE.md §2.1) and gives settlement a
   * refusal surface instead of a silent mutation.
   */
  | { type: 'agentEvent'; event: AgentEvent };
export type SessionCommand = { type: 'restorePreviousDay' | 'beginNewFrontier' };
export type CommandResult = { ok: boolean; reason: string };
/**
 * Lv3: `getObservation` is the single observation channel and is widened in place to the per-Agent
 * view (docs/lv3/03-implementation-plan.md §4.3). The deprecated hard-coded `legalActions` list is
 * replaced by `availableActions`, which is built from the world state so every entry is an already
 * constructed, already legal `Action` (docs/lv3/02-domain-model.md §10).
 *
 * The port's key set is deliberately unchanged — `tests/architecture.test.ts` asserts exactly
 * `['getObservation','submitAction']`, so choiceId resolution stays in the Agent layer
 * (docs/lv3/KNOWN_ISSUES.md C-11).
 */
export interface AgentControllerPort {
  getObservation(): AgentObservation | null;
  submitAction(action: Action): CommandResult;
}

/** Renderer and decision-layer observations cannot be mutated by consumers. */
export type ReadonlyDeep<T> = T extends readonly (infer Item)[]
  ? readonly ReadonlyDeep<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: ReadonlyDeep<T[Key]> }
    : T;
export type Snapshot = ReadonlyDeep<SnapshotData>;
