/**
 * Affordances: the `AgentActionCandidate[]` an Agent may choose from (Agent.md §27/§28,
 * docs/lv3/02-domain-model.md §10).
 *
 * This is the anti-hallucination mechanism. The model returns a `choiceId`; the Agent layer looks it
 * up here and submits the **already constructed, already legal** `Action`. The model never supplies
 * action parameters, never names a target and never widens its own authority. Removing this step
 * would put parameter hallucination back into the system (Agent.md §55 Rule 3).
 *
 * Two properties are load-bearing:
 *  1. **Legal at generation time** — every physical candidate is filtered through the *existing*
 *     `validateActionIn`, so an Agent can never be offered something the engine would reject.
 *     (E.g. `TRANSIT` requires a discovered wormhole — KNOWN_ISSUES N-8.)
 *  2. **Stable across ticks** — same world state in, same candidates in the same order out. A
 *     `choiceId` handed out last tick must still mean the same thing this tick. Every collection is
 *     sorted explicitly and every list is capped, so ordering never depends on Map/Set iteration.
 *
 * Pure module: reads `WorldState`, writes nothing. No I/O, no clock, no randomness.
 */
import { capabilities } from '../capabilities';
import { validateActionIn } from '../command-system';
import { RULES } from '../definitions/rules';
import { available, inventory } from '../inventory';
import { dist } from '../navigation';
import { visibleIntel } from '../sensors';
import { frontierSectors, sectorCenter } from '../world-generation';
import type { Action, Location, ModuleId, Point, Ship, WorldState } from '../types';
import { GOODS } from '../types';
import { isTaskOfferKind } from './interactions';
import { assessReadiness } from './readiness';
import type { Agent, AgentActionCandidate, GoalKind } from './types';

/** Caps keep one decision affordable and the prompt bounded. */
export const CANDIDATE_CAPS = Object.freeze({
  explore: 6,
  survey: 6,
  transit: 2,
  haul: 3,
  escort: 4,
  patrol: 3,
  dock: 2,
  refit: 2,
  recover: 2,
});

/** Which goal kinds each candidate category serves. Feeds `SkillFit` / `GoalAlignment`. */
export const GOAL_KINDS_BY_CATEGORY: Readonly<Record<string, readonly GoalKind[]>> = Object.freeze({
  explore: ['discovery', 'research'],
  survey: ['discovery', 'research'],
  transit: ['discovery', 'research'],
  recover: ['discovery', 'research'],
  haul: ['logistics'],
  escort: ['command'],
  patrol: ['command'],
  social: ['command'],
  maintenance: [],
});

/** Base risk per category, before threat proximity and hull damage are folded in. */
const BASE_RISK: Readonly<Record<string, number>> = Object.freeze({
  explore: 35,
  survey: 25,
  transit: 45,
  haul: 20,
  escort: 25,
  patrol: 20,
  recover: 30,
  return: 10,
  dock: 5,
  refit: 5,
  rearm: 5,
  social: 15,
});

/** Base reward per category, before the opportunity modifiers below. */
const BASE_REWARD: Readonly<Record<string, number>> = Object.freeze({
  explore: 60,
  survey: 50,
  transit: 65,
  haul: 40,
  escort: 30,
  patrol: 25,
  recover: 55,
  return: 10,
  dock: 20,
  refit: 20,
  rearm: 20,
  social: 50,
});

/**
 * Choice ids that are **social decisions**, not physical ones (docs/lv3/03-implementation-plan.md
 * §5). They carry a placeholder action only because `AgentActionCandidate.action` is required by the
 * schema; the runtime must never submit them as `intent: 'act'` — `decision.ts` enforces that.
 */
export const SOCIAL_CHOICE_IDS: readonly string[] = Object.freeze([
  'accept',
  'reject',
  'counteroffer',
]);
export const TEAM_CHOICE_PREFIXES: readonly string[] = Object.freeze([
  'team-accept:',
  'team-decline:',
]);

export function isSocialChoiceId(choiceId: string): boolean {
  return (
    SOCIAL_CHOICE_IDS.includes(choiceId) ||
    TEAM_CHOICE_PREFIXES.some((prefix) => choiceId.startsWith(prefix))
  );
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The ship an Agent currently commands, via the existing `Operator`/`Assignment` binding. */
export function agentShip(w: WorldState, agentId: string): Ship | null {
  const operator = w.operators.find((o) => o.agentId === agentId);
  if (!operator) return null;
  const assignment = w.assignments.find((a) => a.operatorId === operator.id);
  return w.ships.find((s) => s.id === assignment?.shipId) ?? null;
}

/** The Agent bound to an operator id, or `null` for the `'rules'` operators. */
export function agentForOperator(w: WorldState, operatorId: string): Agent | null {
  const operator = w.operators.find((o) => o.id === operatorId);
  if (!operator?.agentId) return null;
  return w.agents.find((a) => a.id === operator.agentId) ?? null;
}

/**
 * An Agent can only act when its ship is completely free (KNOWN_ISSUES N-1: any `current`, queued
 * or suspended directive makes `submitAction` refuse). A busy ship yields no physical candidates —
 * the scheduler defers rather than retries.
 */
export function shipIsBusy(ship: Ship): boolean {
  return Boolean(ship.current) || ship.queue.length > 0 || ship.suspended.length > 0;
}

function threatAt(w: WorldState, point: Point): number {
  return visibleIntel(w).filter(
    (i) => i.hostile && i.live && Math.hypot(i.x - point.x, i.y - point.y) < 250,
  ).length;
}

function riskFor(w: WorldState, ship: Ship, category: string, point: Point | null): number {
  const damage = 1 - Math.min(1, ship.hull / capabilities(ship).hull);
  const exposure = point ? threatAt(w, point) * 15 : 0;
  return clamp(Math.round((BASE_RISK[category] ?? 20) + exposure + damage * 30), 0, 100);
}

function rewardFor(category: string, bonus = 0): number {
  return clamp(Math.round((BASE_REWARD[category] ?? 20) + bonus), 0, 100);
}

/** Placeholder action for a social candidate. Never submitted — see `isSocialChoiceId`. */
function socialPlaceholder(ship: Ship): { type: 'MOVE'; point: Point } {
  return { type: 'MOVE', point: { x: ship.x, y: ship.y } };
}

function make(
  id: string,
  label: string,
  action: AgentActionCandidate['action'],
  options: { risk: number; reward: number; goalKinds: readonly GoalKind[]; requirements?: string[] },
): AgentActionCandidate {
  return {
    id,
    label,
    action,
    risk: options.risk,
    reward: options.reward,
    goalKinds: [...options.goalKinds],
    requirements: [...(options.requirements ?? [])],
  };
}

function socialCandidate(ship: Ship, id: string, label: string): AgentActionCandidate {
  return make(id, label, socialPlaceholder(ship), {
    risk: BASE_RISK.social,
    reward: BASE_REWARD.social,
    goalKinds: GOAL_KINDS_BY_CATEGORY.social,
  });
}

function ownFacilities(w: WorldState): Location[] {
  return w.locations.filter((l) => l.owner === 'starfleet' && l.hull > 0).sort(byId);
}

/**
 * Where an option is headed, when the route to it is something a readiness assessment can use.
 * `null` means "no destination to assess": returning home or acting locally is sustainable by
 * definition, and flagging it would be noise rather than information.
 */
function destinationOf(w: WorldState, action: Action, ship: Ship): Point | null {
  if (action.type === 'MOVE') return action.point;
  if (action.type === 'EXPLORE') return sectorCenter(action.sector);
  if (action.type === 'RETURN') return null;
  if (!('targetId' in action)) return null;
  const id = action.targetId;
  return (
    w.ships.find((x) => x.id === id) ??
    w.civilians.find((x) => x.id === id) ??
    w.locations.find((x) => x.id === id) ??
    w.bodies.find((x) => x.id === id) ??
    w.systems.find((x) => x.id === id) ??
    w.wrecks.find((x) => x.id === id) ??
    null
  );
}

/**
 * EVT-04: an option this ship cannot sustain says so, on the field the decision already reads.
 *
 * The verdict is computed here rather than spoken by the Agent because it is a **world fact** — it
 * needs the route, and the Agent's observation deliberately carries no chart (Rule 1). Attaching it
 * to the candidate is what gets it across that boundary: the model sees it in the prompt, and the
 * deterministic band sees it in the observation.
 */
function withReadiness(
  w: WorldState,
  ship: Ship,
  candidate: AgentActionCandidate,
): AgentActionCandidate {
  const { verdict, reasons } = assessReadiness(w, ship, destinationOf(w, candidate.action, ship));
  return verdict === 'READY'
    ? candidate
    : { ...candidate, requirements: [...candidate.requirements, ...reasons] };
}

/** Physical affordances. Callers must not call this while the ship is busy. */
function physicalCandidates(w: WorldState, ship: Ship): AgentActionCandidate[] {
  const result: AgentActionCandidate[] = [];
  const facilities = ownFacilities(w);
  const base = facilities.find((l) => l.id === 'base') ?? null;

  // --- Exploration: sectors on the frontier of what is already charted.
  for (const sector of frontierSectors(w.sectors).slice(0, CANDIDATE_CAPS.explore)) {
    result.push(
      make(
        'explore:' + sector.q + '/' + sector.r,
        '测绘 UNKNOWN SPACE ' + sector.q + '/' + sector.r,
        { type: 'EXPLORE', sector, approach: 'remote' },
        {
          risk: riskFor(w, ship, 'explore', sectorCenter(sector)),
          reward: rewardFor('explore'),
          goalKinds: GOAL_KINDS_BY_CATEGORY.explore,
          requirements: ['需要已测绘星区在跳跃范围内'],
        },
      ),
    );
  }

  // --- Survey: discovered bodies and systems that are not fully charted.
  const canDeepScan = ship.modules.includes('deepScan');
  const surveyTargets = [
    ...w.bodies
      .filter((b) => b.discovered && !b.hidden && b.survey < 2)
      .map((b) => ({ id: b.id, name: b.name, point: { x: b.x, y: b.y }, special: b.kind === 'anomaly' || b.kind === 'ruins' })),
    ...w.systems
      .filter((s) => s.discovered && s.survey < 2)
      .map((s) => ({ id: s.id, name: s.name, point: { x: s.x, y: s.y }, special: false })),
  ]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, CANDIDATE_CAPS.survey);
  for (const target of surveyTargets) {
    result.push(
      make(
        'survey:' + target.id,
        '近距调查 ' + target.name,
        {
          type: 'SURVEY',
          targetId: target.id,
          approach: dist(ship, target.point) <= RULES.baseSensors ? 'close' : 'remote',
          deep: canDeepScan,
        },
        {
          risk: riskFor(w, ship, 'survey', target.point),
          reward: rewardFor('survey', target.special ? 25 : 0),
          goalKinds: GOAL_KINDS_BY_CATEGORY.survey,
          requirements: canDeepScan ? [] : ['Deep Scan 模块可提高调查等级'],
        },
      ),
    );
  }

  // --- Transit: only wormholes already discovered (KNOWN_ISSUES N-8).
  for (const hole of w.wormholes.filter((h) => h.discovered).sort(byId).slice(0, CANDIDATE_CAPS.transit)) {
    result.push(
      make(
        'transit:' + hole.id,
        '穿越通道 ' + hole.name,
        { type: 'TRANSIT', targetId: hole.id },
        {
          risk: riskFor(w, ship, 'transit', { x: hole.x, y: hole.y }),
          reward: rewardFor('transit'),
          goalKinds: GOAL_KINDS_BY_CATEGORY.transit,
        },
      ),
    );
  }

  // --- Logistics: move real goods between real inventories.
  const holders = [...facilities, ...w.projects.filter((p) => p.complete)].sort(byId);
  const cargo = capabilities(ship).cargo;
  const hauls: AgentActionCandidate[] = [];
  outer: for (const source of holders) {
    for (const good of GOODS) {
      const stock = available(w, source.id, good);
      if (stock <= 0) continue;
      for (const destination of holders) {
        if (destination.id === source.id) continue;
        const holder = inventory(w, destination.id);
        if (!holder) continue;
        const room = Math.max(0, holder.capacity[good] - holder.stock[good]);
        const amount = Math.floor(Math.min(stock, room, cargo));
        if (amount <= 0) continue;
        hauls.push(
          make(
            'haul:' + source.id + '>' + destination.id + ':' + good,
            '运输 ' + amount + ' ' + good + '：' + source.name + ' → ' + destination.name,
            {
              type: 'HAUL',
              sourceId: source.id,
              targetId: destination.id,
              cargoKind: good,
              amount,
              route: 'direct',
              repeat: false,
            },
            {
              risk: riskFor(w, ship, 'haul', { x: destination.x, y: destination.y }),
              reward: rewardFor('haul'),
              goalKinds: GOAL_KINDS_BY_CATEGORY.haul,
            },
          ),
        );
        if (hauls.length >= CANDIDATE_CAPS.haul) break outer;
      }
    }
  }
  result.push(...hauls);

  // --- Escort: fly with somebody else. MVP's only Agent-Agent physical expression (Agent.md §43).
  for (const other of [...w.ships, ...w.civilians]
    .filter((s) => s.id !== ship.id)
    .sort(byId)
    .slice(0, CANDIDATE_CAPS.escort)) {
    result.push(
      make(
        'escort:' + other.id,
        '护航 ' + other.name,
        { type: 'ESCORT', targetId: other.id },
        {
          risk: riskFor(w, ship, 'escort', { x: other.x, y: other.y }),
          reward: rewardFor('escort'),
          goalKinds: GOAL_KINDS_BY_CATEGORY.escort,
        },
      ),
    );
  }

  // --- Patrol / dock: presence at one of our own facilities.
  for (const facility of facilities.slice(0, CANDIDATE_CAPS.patrol)) {
    result.push(
      make(
        'patrol:' + facility.id,
        '巡逻 ' + facility.name,
        { type: 'PATROL', targetId: facility.id, duration: 120 },
        {
          risk: riskFor(w, ship, 'patrol', { x: facility.x, y: facility.y }),
          reward: rewardFor('patrol'),
          goalKinds: GOAL_KINDS_BY_CATEGORY.patrol,
        },
      ),
    );
  }
  for (const facility of facilities.slice(0, CANDIDATE_CAPS.dock)) {
    result.push(
      make(
        'dock:' + facility.id,
        '返回 ' + facility.name + ' 入坞',
        { type: 'DOCK', targetId: facility.id },
        {
          risk: riskFor(w, ship, 'dock', { x: facility.x, y: facility.y }),
          reward: rewardFor('dock'),
          goalKinds: GOAL_KINDS_BY_CATEGORY.maintenance,
        },
      ),
    );
  }

  // --- Refit: spend a free module slot at the base.
  const slotOrder: readonly ModuleId[] = [
    'deepScan',
    'longRangeSensors',
    'precisionTargeting',
    'expandedCargo',
  ];
  if (base && ship.modules.length < capabilities(ship).moduleSlots) {
    for (const moduleId of slotOrder.filter((m) => !ship.modules.includes(m)).slice(0, CANDIDATE_CAPS.refit)) {
      result.push(
        make(
          'refit:' + moduleId,
          '在 ' + base.name + ' 安装模块 ' + moduleId,
          { type: 'REFIT', targetId: base.id, moduleId, remove: false },
          {
            risk: riskFor(w, ship, 'refit', { x: base.x, y: base.y }),
            reward: rewardFor('refit'),
            goalKinds: GOAL_KINDS_BY_CATEGORY.maintenance,
            requirements: ['需要基地且有空闲模块槽'],
          },
        ),
      );
    }
  }

  // --- Rearm: top up the magazines from real stock.
  if (base) {
    const photon = Math.max(
      0,
      Math.floor(Math.min(capabilities(ship).photon - ship.photon, available(w, base.id, 'photon'))),
    );
    const quantum = Math.max(
      0,
      Math.floor(Math.min(capabilities(ship).quantum - ship.quantum, available(w, base.id, 'quantum'))),
    );
    if (photon > 0 || quantum > 0) {
      result.push(
        make(
          'rearm:' + photon + '/' + quantum,
          '装弹：光子 ' + photon + ' / 量子 ' + quantum,
          { type: 'REARM', targetId: base.id, load: { photon, quantum } },
          {
            risk: riskFor(w, ship, 'rearm', { x: base.x, y: base.y }),
            reward: rewardFor('rearm'),
            goalKinds: GOAL_KINDS_BY_CATEGORY.maintenance,
          },
        ),
      );
    }
  }

  // --- Recover: salvaged hulls already found.
  for (const wreck of w.wrecks.filter((x) => x.discovered).sort(byId).slice(0, CANDIDATE_CAPS.recover)) {
    result.push(
      make(
        'recover:' + wreck.id,
        '回收残骸 ' + wreck.name,
        { type: 'RECOVER', targetId: wreck.id },
        {
          risk: riskFor(w, ship, 'recover', { x: wreck.x, y: wreck.y }),
          reward: rewardFor('recover'),
          goalKinds: GOAL_KINDS_BY_CATEGORY.recover,
        },
      ),
    );
  }

  // --- Return home: the safe option when nothing scores.
  result.push(
    make('return', '返回黎明基地', { type: 'RETURN' }, {
      risk: riskFor(w, ship, 'return', { x: ship.x, y: ship.y }),
      reward: rewardFor('return'),
      goalKinds: GOAL_KINDS_BY_CATEGORY.maintenance,
    }),
  );

  return result;
}

/** Social affordances: replies to what the Admiral or another Agent actually said. */
function socialCandidates(w: WorldState, agent: Agent, ship: Ship): AgentActionCandidate[] {
  const unread = w.agentMessages.filter((m) => !m.read && m.to === agent.id);
  const result: AgentActionCandidate[] = [];

  if (unread.some((m) => isTaskOfferKind(m.kind))) {
    result.push(
      socialCandidate(ship, 'accept', '接受 Admiral 的任务'),
      socialCandidate(ship, 'reject', '拒绝 Admiral 的任务'),
      socialCandidate(ship, 'counteroffer', '提出反报价'),
    );
  }

  for (const message of unread.filter((m) => m.kind === 'team-request').sort((a, b) => (a.at !== b.at ? a.at - b.at : a.id < b.id ? -1 : 1))) {
    const requester =
      message.payload && 'requestingAgentId' in message.payload
        ? message.payload.requestingAgentId
        : message.from;
    const peer = w.agents.find((a) => a.id === requester);
    const name = peer?.name ?? requester;
    result.push(
      socialCandidate(ship, 'team-accept:' + requester, '接受 ' + name + ' 的组队请求'),
      socialCandidate(ship, 'team-decline:' + requester, '拒绝 ' + name + ' 的组队请求'),
    );
  }

  return result;
}

/**
 * All candidates an Agent may choose from this decision.
 *
 * A busy ship yields only social candidates: an Agent mid-directive can still answer the Admiral,
 * but it cannot be handed a physical action the engine would refuse (KNOWN_ISSUES N-1).
 */
export function availableActions(w: WorldState, agent: Agent): AgentActionCandidate[] {
  const ship = agentShip(w, agent.id);
  if (!ship) return [];
  const social = socialCandidates(w, agent, ship);
  if (shipIsBusy(ship)) return social;
  const physical = physicalCandidates(w, ship)
    .map((candidate) => withReadiness(w, ship, candidate))
    .filter((c) => validateActionIn(w, ship, c.action).ok);
  return [...physical, ...social];
}

/** Resolves a model-chosen `choiceId` back to the already-constructed action. */
export function resolveChoice(
  candidates: readonly AgentActionCandidate[],
  choiceId: string,
): AgentActionCandidate | null {
  return candidates.find((c) => c.id === choiceId) ?? null;
}
