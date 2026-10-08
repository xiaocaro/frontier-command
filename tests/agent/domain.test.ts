/**
 * P0 domain rules (docs/lv3/03-test-plan.md §3, D-1 … D-17).
 *
 * Every assertion here is a pure-function assertion: no engine, no network, no clock. These are the
 * numbers Agent.md §59 requires to be stable enough to assert at all.
 */
import { describe, it, expect } from 'vitest';
import {
  MEMORY_CAP,
  episodicMemory,
  memoryWeightFor,
  promiseMemory,
  recentMemories,
  remember,
  retrieve,
  socialMemory,
} from '../../src/engine/agent/memory';
import {
  PROMISE_CAP,
  boundPromises,
  createPromise,
  idsSettledBy,
  pendingPromises,
  resolveFulfillments,
  settlePromise,
} from '../../src/engine/agent/promise';
import {
  INITIAL_PERSONALITIES,
  clampPersonality,
  initialPersonality,
  personalityDistance,
} from '../../src/engine/agent/personality';
import {
  applyGoalProgress,
  createGoal,
  goalAlignment,
  GOAL_PROGRESS,
} from '../../src/engine/agent/goals';
import {
  HIGH_RISK_FATIGUE,
  OVERRIDE_EFFECT,
  PROMISE_KEPT_EFFECT,
  REST_RECOVERY,
  applyStateDelta,
  emptyDelta,
  fatigueBand,
  missionFailure,
  missionSuccess,
  rest,
} from '../../src/engine/agent/state';
import {
  CONFLICT_VALUE,
  TEAM_UP_COOPERATION,
  TEAM_UP_VALUE,
  adjustRelationship,
  blankRelationships,
  conflict,
  teamUp,
} from '../../src/engine/agent/relationship';
import { applyInteraction, interactionEffect } from '../../src/engine/agent/interactions';
import type {
  Agent,
  AgentMemory,
  AgentState,
  EpisodicMemory,
  MemoryTag,
  PromiseMemory,
} from '../../src/engine/types';
import { agentByCareer, agentEngine } from './support';

const baseState = (over: Partial<AgentState> = {}): AgentState => ({
  fatigue: 0,
  stress: 0,
  morale: 50,
  trustInAdmiral: 50,
  loyaltyToCompany: 50,
  experience: 0,
  reputation: 0,
  goalProgress: 0,
  ...over,
});

describe('D-1 personality', () => {
  it('clamps all five dimensions into [0, 100]', () => {
    expect(
      clampPersonality({
        riskTolerance: -20,
        curiosity: 250,
        loyalty: 0,
        cooperation: 100,
        ambition: 55.5,
      }),
    ).toEqual({
      riskTolerance: 0,
      curiosity: 100,
      loyalty: 0,
      cooperation: 100,
      ambition: 55.5,
    });
  });

  it('matches the approved roster table (docs/lv3/02-domain-model.md §2)', () => {
    expect(INITIAL_PERSONALITIES.explorer).toEqual({
      riskTolerance: 75,
      curiosity: 90,
      loyalty: 55,
      cooperation: 55,
      ambition: 70,
    });
    expect(INITIAL_PERSONALITIES.scientist).toEqual({
      riskTolerance: 50,
      curiosity: 75,
      loyalty: 55,
      cooperation: 55,
      ambition: 70,
    });
    expect(INITIAL_PERSONALITIES.tactical).toEqual({
      riskTolerance: 70,
      curiosity: 25,
      loyalty: 85,
      cooperation: 80,
      ambition: 70,
    });
    expect(INITIAL_PERSONALITIES.logistics).toEqual({
      riskTolerance: 25,
      curiosity: 25,
      loyalty: 85,
      cooperation: 80,
      ambition: 50,
    });
  });

  it('keeps the four starting personalities distinguishable', () => {
    const careers = ['explorer', 'scientist', 'tactical', 'logistics'] as const;
    for (const a of careers)
      for (const b of careers)
        if (a !== b)
          expect(personalityDistance(initialPersonality(a), initialPersonality(b))).toBeGreaterThan(
            0,
          );
  });

  it('returns a fresh copy so callers cannot mutate the frozen table', () => {
    const copy = initialPersonality('explorer');
    copy.curiosity = 0;
    expect(INITIAL_PERSONALITIES.explorer.curiosity).toBe(90);
  });
});

describe('D-2 goals', () => {
  it('aligns a candidate only when its goal kinds contain the goal kind', () => {
    const goal = createGoal('goal:test', 'discovery');
    expect(goalAlignment(goal, ['discovery'])).toBe(100);
    expect(goalAlignment(goal, ['logistics', 'discovery'])).toBe(100);
    expect(goalAlignment(goal, ['logistics'])).toBe(0);
    expect(goalAlignment(goal, [])).toBe(0);
  });

  it('applies the Agent.md §48 progress moves', () => {
    const agent = agentByCareer(agentEngine(), 'explorer');
    const anomaly = applyGoalProgress(agent, GOAL_PROGRESS.anomalyDiscovered);
    expect(anomaly.applied).toBe(10);
    expect(anomaly.agent.goal.progress).toBe(10);
    const deepScan = applyGoalProgress(anomaly.agent, GOAL_PROGRESS.deepScanCompleted);
    expect(deepScan.agent.goal.progress).toBe(25);
    const lead = applyGoalProgress(deepScan.agent, GOAL_PROGRESS.majorLead);
    expect(lead.agent.goal.progress).toBe(55);
    // A forced stop moves nothing.
    expect(applyGoalProgress(lead.agent, GOAL_PROGRESS.forcedStop).applied).toBe(0);
  });

  it('keeps goal.progress and state.goalProgress in step and clamps at 100', () => {
    const agent = agentByCareer(agentEngine(), 'scientist');
    const { agent: next, applied } = applyGoalProgress(agent, 250);
    expect(applied).toBe(100);
    expect(next.goal.progress).toBe(100);
    expect(next.state.goalProgress).toBe(100);
  });
});

describe('D-3/D-4 fatigue', () => {
  it('bands exactly at the Agent.md §21 boundaries', () => {
    expect(fatigueBand(0)).toBe('normal');
    expect(fatigueBand(39)).toBe('normal');
    expect(fatigueBand(40)).toBe('fatigued');
    expect(fatigueBand(69)).toBe('fatigued');
    expect(fatigueBand(70)).toBe('severe-fatigue');
    expect(fatigueBand(84)).toBe('severe-fatigue');
    expect(fatigueBand(85)).toBe('forced-rest');
    expect(fatigueBand(100)).toBe('forced-rest');
  });

  it('costs +10 for a normal mission, +15 for a high-risk one and +15 on failure', () => {
    const normal = missionSuccess(baseState());
    expect(normal.effects.fatigue).toBe(10);
    const risky = missionSuccess(baseState(), { highRisk: true });
    expect(risky.effects.fatigue).toBe(HIGH_RISK_FATIGUE);
    const failed = missionFailure(baseState());
    expect(failed.effects.fatigue).toBe(15);
  });

  it('recovers 20 fatigue on rest', () => {
    const rested = rest(baseState({ fatigue: 50 }));
    expect(rested.effects.fatigue).toBe(-REST_RECOVERY);
    expect(rested.state.fatigue).toBe(30);
  });
});

describe('D-5 Override cost', () => {
  it('is exactly trust -10, morale -5, stress +10 and nothing else', () => {
    const before = baseState({ trustInAdmiral: 80, morale: 80, stress: 10 });
    const { state, effects } = applyStateDelta(before, OVERRIDE_EFFECT);
    expect(state.trustInAdmiral).toBe(70);
    expect(state.morale).toBe(75);
    expect(state.stress).toBe(20);
    expect(state.loyaltyToCompany).toBe(before.loyaltyToCompany);
    expect(state.fatigue).toBe(before.fatigue);
    expect(effects).toEqual({ ...OVERRIDE_EFFECT });
  });

  it('is the effect an override interaction actually applies', () => {
    const agent = agentByCareer(agentEngine(), 'explorer');
    const { agent: next, effects } = applyInteraction(agent, 'override', 'forced');
    expect(effects.trustInAdmiral).toBe(-10);
    expect(effects.morale).toBe(-5);
    expect(effects.stress).toBe(10);
    expect(next.state.trustInAdmiral).toBe(agent.state.trustInAdmiral - 10);
    expect(next.state.stress).toBe(agent.state.stress + 10);
  });

  it('leaves non-override interactions psychologically neutral (Agent.md §41)', () => {
    for (const kind of ['command', 'ask', 'negotiate', 'encourage', 'promise'] as const)
      expect(interactionEffect(kind, 'pending')).toEqual(emptyDelta());
  });
});

describe('D-6/D-7/D-8 promises and the trust/loyalty split', () => {
  it('raises trust, loyalty, morale and goal progress when a promise is kept', () => {
    const { state, effects } = applyStateDelta(baseState({ morale: 10 }), PROMISE_KEPT_EFFECT);
    expect(effects.trustInAdmiral).toBeGreaterThan(0);
    expect(effects.loyaltyToCompany).toBeGreaterThan(0);
    expect(effects.morale).toBeGreaterThan(0);
    expect(effects.goalProgress).toBeGreaterThan(0);
    expect(state.trustInAdmiral).toBeGreaterThan(50);
  });

  it('lowers trust and loyalty and raises stress when a promise is broken', () => {
    const { state, effects } = applyStateDelta(baseState({ trustInAdmiral: 90 }), {
      ...emptyDelta(),
      trustInAdmiral: -15,
      loyaltyToCompany: -5,
      stress: 10,
    });
    expect(effects.trustInAdmiral).toBeLessThan(0);
    expect(effects.loyaltyToCompany).toBeLessThan(0);
    expect(effects.stress).toBeGreaterThan(0);
    expect(state.loyaltyToCompany).toBeLessThan(50);
  });

  it('moves trust without touching loyalty', () => {
    const before = baseState({ trustInAdmiral: 90, loyaltyToCompany: 80 });
    const { state } = applyStateDelta(before, { ...emptyDelta(), trustInAdmiral: -10 });
    expect(state.trustInAdmiral).toBe(80);
    expect(state.loyaltyToCompany).toBe(80);
    const other = applyStateDelta(before, { ...emptyDelta(), loyaltyToCompany: -10 });
    expect(other.state.trustInAdmiral).toBe(90);
    expect(other.state.loyaltyToCompany).toBe(70);
  });
});

describe('D-9 clamping', () => {
  it('saturates every bounded field and reports the applied change, not the nominal one', () => {
    const before = baseState({ trustInAdmiral: 5, morale: 98, fatigue: 0, goalProgress: 0 });
    const { state, effects } = applyStateDelta(before, {
      ...emptyDelta(),
      trustInAdmiral: -50,
      morale: 50,
      fatigue: -30,
      goalProgress: 200,
    });
    expect(state.trustInAdmiral).toBe(0);
    expect(state.morale).toBe(100);
    expect(state.fatigue).toBe(0);
    expect(state.goalProgress).toBe(100);
    expect(effects.trustInAdmiral).toBe(-5);
    expect(effects.morale).toBe(2);
    expect(effects.fatigue).toBe(0);
    expect(effects.goalProgress).toBe(100);
  });

  it('floors experience at zero and leaves reputation alone', () => {
    const { state } = applyStateDelta(baseState({ experience: 3, reputation: 4 }), {
      ...emptyDelta(),
      experience: -100,
    });
    expect(state.experience).toBe(0);
    expect(state.reputation).toBe(4);
  });
});

describe('D-10 relationships', () => {
  const roster = ['a', 'b', 'c'];

  it('builds a complete table with no self-reference, sorted by target', () => {
    expect(blankRelationships('a', ['c', 'a', 'b']).map((r) => r.targetAgentId)).toEqual([
      'b',
      'c',
    ]);
  });

  it('clamps value to [-100, 100] and trust/cooperation to [0, 100]', () => {
    let list = blankRelationships('a', roster);
    list = adjustRelationship(list, 'a', 'b', { value: 500, trust: 500, cooperation: -500 });
    const b = list.find((r) => r.targetAgentId === 'b')!;
    expect(b.value).toBe(100);
    expect(b.trust).toBe(100);
    expect(b.cooperation).toBe(0);
  });

  it('never creates a relationship pointing at the Agent itself', () => {
    const list = blankRelationships('a', roster);
    expect(adjustRelationship(list, 'a', 'a', { value: 50 })).toEqual(list);
  });

  it('raises value and cooperation on both sides after a successful team-up', () => {
    const a = { id: 'a', relationships: blankRelationships('a', roster) };
    const b = { id: 'b', relationships: blankRelationships('b', roster) };
    const after = teamUp(a, b);
    expect(after.a.find((r) => r.targetAgentId === 'b')).toEqual({
      targetAgentId: 'b',
      value: TEAM_UP_VALUE,
      trust: 50,
      cooperation: 50 + TEAM_UP_COOPERATION,
    });
    expect(after.b.find((r) => r.targetAgentId === 'a')!.value).toBe(TEAM_UP_VALUE);
    expect(after.b.find((r) => r.targetAgentId === 'a')!.cooperation).toBe(
      50 + TEAM_UP_COOPERATION,
    );
  });

  it('lowers value and cooperation on both sides after a conflict', () => {
    const a = { id: 'a', relationships: blankRelationships('a', roster) };
    const b = { id: 'b', relationships: blankRelationships('b', roster) };
    const after = conflict(a, b);
    expect(after.a.find((r) => r.targetAgentId === 'b')!.value).toBe(CONFLICT_VALUE);
    expect(after.b.find((r) => r.targetAgentId === 'a')!.value).toBe(CONFLICT_VALUE);
  });
});

describe('D-11/D-12/D-13 memory bounds, determinism and retrieval', () => {
  const seedMemories = (count: number): EpisodicMemory[] =>
    Array.from({ length: count }, (_, i) =>
      episodicMemory({ id: 'm' + i, at: i, text: 'memory ' + i, tags: ['discovery'], weight: 10 + i }),
    );

  it('evicts exactly one entry when the cap is exceeded', () => {
    const full = seedMemories(MEMORY_CAP);
    const overflowed = remember(full, episodicMemory({ id: 'm40', at: 999, text: 'new' , tags: ['discovery'], weight: 99 }));
    expect(overflowed).toHaveLength(MEMORY_CAP);
    expect(overflowed.some((m) => m.id === 'm40')).toBe(true);
    // The lightest memory is the one that goes.
    expect(overflowed.some((m) => m.id === 'm0')).toBe(false);
  });

  it('evicts the new entry itself when it is the lightest', () => {
    const full = seedMemories(MEMORY_CAP);
    const overflowed = remember(full, episodicMemory({ id: 'm40', at: 999, text: 'new', tags: ['discovery'], weight: 0 }));
    expect(overflowed).toHaveLength(MEMORY_CAP);
    expect(overflowed.some((m) => m.id === 'm40')).toBe(false);
    expect(overflowed.map((m) => m.id)).toEqual(full.map((m) => m.id));
  });

  it('is deterministic: the same write sequence twice gives deeply equal results', () => {
    const run = (): AgentMemory[] => {
      let list: AgentMemory[] = [];
      for (let i = 0; i < MEMORY_CAP * 2; i++)
        list = remember(list, episodicMemory({ id: 'm' + i, at: i, text: 'x' + i, tags: ['discovery'], weight: i % 7 }));
      return list;
    };
    expect(run()).toEqual(run());
  });

  it('retrieves by tag with a deterministic order', () => {
    const memories = [
      episodicMemory({ id: 'a', at: 1, text: 'low', tags: ['discovery'], weight: 10 }),
      episodicMemory({ id: 'b', at: 1, text: 'high', tags: ['discovery'], weight: 90 }),
      episodicMemory({ id: 'c', at: 1, text: 'other', tags: ['conflict'], weight: 99 }),
      episodicMemory({ id: 'd', at: 2, text: 'tie', tags: ['discovery'], weight: 90 }),
    ];
    // Weight descending, then recency descending, then id ascending.
    expect(retrieve(memories, ['discovery']).map((m) => m.id)).toEqual(['d', 'b', 'a']);
    expect(retrieve(memories, ['conflict']).map((m) => m.id)).toEqual(['c']);
    expect(retrieve(memories, ['team-up'])).toEqual([]);
    expect(retrieve(memories, ['discovery'], 2).map((m) => m.id)).toEqual(['d', 'b']);
  });

  it('hands the prompt window its most important memories first', () => {
    const memories = seedMemories(30);
    const recent = recentMemories(memories, 5);
    expect(recent).toHaveLength(5);
    expect(recent.map((m) => m.weight)).toEqual([39, 38, 37, 36, 35]);
  });
});

describe('D-14/D-15/D-16 promise domain', () => {
  const deepScanPromise = (over: Partial<Parameters<typeof createPromise>[0]> = {}) =>
    createPromise({
      id: 'promise-1',
      to: 'agent-1',
      type: 'equipment',
      description: 'Deep Scan 权限',
      fulfills: { kind: 'grant-module', key: 'deepScan' },
      createdAt: 10,
      ...over,
    });

  it('discriminates the three memory kinds and keeps the promise link', () => {
    const promise = deepScanPromise();
    const memories = [
      episodicMemory({ id: 'e', at: 1, text: 'saw something', tags: ['discovery'] }),
      socialMemory({ id: 's', at: 2, aboutAgentId: 'agent-2', text: 'good wingman' }),
      promiseMemory({ id: 'p', promiseId: promise.id, at: 3, text: 'promised' }),
    ];
    expect(memories.map((m) => m.kind)).toEqual(['episodic', 'social', 'promise']);
    const linked = memories[2] as PromiseMemory;
    expect(promise.id).toBe(linked.promiseId);
    expect(memories.filter((m) => m.kind === 'promise')).toHaveLength(1);
    expect(retrieve(memories, ['discovery']).map((m) => m.id)).toEqual(['e']);
  });

  it('fulfils grant-module/deepScan once the existing REFIT installs it', () => {
    const before = [deepScanPromise()];
    const untouched = resolveFulfillments(before, [{ kind: 'module-installed', moduleId: 'expandedCargo' }], 50);
    expect(untouched[0].status).toBe('pending');
    const after = resolveFulfillments(before, [{ kind: 'module-installed', moduleId: 'deepScan' }], 50);
    expect(after[0].status).toBe('fulfilled');
    expect(after[0].resolvedAt).toBe(50);
    expect(idsSettledBy(before, after)).toEqual(['promise-1']);
  });

  it('matches the other three fulfilment kinds', () => {
    const upgrade = createPromise({
      id: 'p2',
      to: 'agent-1',
      type: 'research',
      description: 'Armory',
      fulfills: { kind: 'grant-upgrade', key: 'armory' },
      createdAt: 0,
    });
    const leave = createPromise({
      id: 'p3',
      to: 'agent-1',
      type: 'rest',
      description: '休整',
      fulfills: { kind: 'grant-rest' },
      createdAt: 0,
    });
    const bonus = createPromise({
      id: 'p4',
      to: 'agent-1',
      type: 'reward',
      description: '奖金',
      fulfills: { kind: 'grant-credits', amount: 100 },
      createdAt: 0,
    });
    const settled = resolveFulfillments(
      [upgrade, leave, bonus],
      [{ kind: 'upgrade-completed', upgradeId: 'armory' }, { kind: 'rest-granted' }, { kind: 'credits-granted', amount: 150 }],
      7,
    );
    expect(settled.map((p) => p.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    expect(settled.every((p) => p.resolvedAt === 7)).toBe(true);
    expect(resolveFulfillments([bonus], [{ kind: 'credits-granted', amount: 50 }], 7)[0].status).toBe(
      'pending',
    );
  });

  it('can break a pending promise and never re-settles one', () => {
    const broken = settlePromise([deepScanPromise()], 'promise-1', 'broken', 20);
    expect(broken[0].status).toBe('broken');
    expect(broken[0].resolvedAt).toBe(20);
    const twice = settlePromise(broken, 'promise-1', 'fulfilled', 30);
    expect(twice[0].status).toBe('broken');
    expect(twice[0].resolvedAt).toBe(20);
    expect(pendingPromises(broken)).toEqual([]);
  });

  it('keeps every pending promise and the newest resolved ones under the cap', () => {
    const pending = Array.from({ length: 5 }, (_, i) =>
      createPromise({
        id: 'pend-' + i,
        to: 'agent-1',
        type: 'reward',
        description: 'p',
        fulfills: { kind: 'grant-rest' },
        createdAt: i,
      }),
    );
    const resolved = Array.from({ length: PROMISE_CAP }, (_, i) => ({
      ...createPromise({
        id: 'done-' + i,
        to: 'agent-1',
        type: 'reward',
        description: 'd',
        fulfills: { kind: 'grant-rest' },
        createdAt: i,
      }),
      status: 'fulfilled' as const,
      resolvedAt: i,
    }));
    const bounded = boundPromises([...resolved, ...pending]);
    expect(bounded).toHaveLength(PROMISE_CAP);
    for (const p of pending) expect(bounded.some((x) => x.id === p.id)).toBe(true);
    // The newest resolved survive; the oldest do not.
    expect(bounded.some((x) => x.id === 'done-' + (PROMISE_CAP - 1))).toBe(true);
    expect(bounded.some((x) => x.id === 'done-0')).toBe(false);
    expect(boundPromises(bounded)).toEqual(bounded);
  });
});

describe('D-17 interaction effects', () => {
  it('records the change that actually applied, not the nominal one', () => {
    const agent = {
      ...agentByCareer(agentEngine(), 'logistics'),
      state: baseState({ trustInAdmiral: 4, morale: 3 }),
    } as Agent;
    const { effects } = applyInteraction(agent, 'override', 'forced');
    expect(effects.trustInAdmiral).toBe(-4);
    expect(effects.morale).toBe(-3);
    expect(effects.stress).toBe(10);
  });
});

describe('memory weights', () => {
  it('ranks the tags that must survive eviction highest', () => {
    const tags: MemoryTag[] = ['admiral-override', 'promise-broken', 'near-death', 'risk-taken'];
    const weights = tags.map((tag) => memoryWeightFor([tag]));
    expect(weights[0]).toBeGreaterThanOrEqual(weights[1]);
    expect(Math.min(...weights)).toBeGreaterThan(0);
    expect(memoryWeightFor(['risk-taken'])).toBeLessThan(memoryWeightFor(['admiral-override']));
    expect(memoryWeightFor([])).toBe(0);
  });
});
