/**
 * P0 decision validation, scoring and fallback (docs/lv3/03-test-plan.md §4,
 * DEC-1 … DEC-3, DEC-7 … DEC-13).
 *
 * Everything here runs offline and deterministically: no model, no network, no clock. That is the
 * whole point of the fallback existing at all (docs/lv3/02-decision-flow.md §3.6).
 */
import { describe, it, expect } from 'vitest';
import {
  AGENT_PROMPT_VERSION,
  STALE_TICK_LIMIT,
  evaluate,
  fallbackDecision,
  misreportsObservation,
  matchesObservation,
  parseDecisionText,
  validateDecision,
} from '../../src/engine/agent/decision';
import {
  DECISION_WEIGHTS,
  FATIGUE_PENALTY,
  TAG_GOALS,
  decisionScore,
  isTeamCandidate,
  rankCandidates,
  scoreBand,
} from '../../src/engine/agent/score';
import { agentDecisionSchema } from '../../src/engine/agent/schemas';
import { episodicMemory, recentMemories } from '../../src/engine/agent/memory';
import { activePromise, createPromise } from '../../src/engine/agent/promise';
import { agentByCareer, agentEngine, observationFor } from './support';
import type { Agent, AgentDecision, AgentObservation } from '../../src/engine/types';

const explorer = (e = agentEngine()) => agentByCareer(e, 'explorer');

const decision = (over: Partial<AgentDecision> = {}): AgentDecision => ({
  intent: 'act',
  choiceId: 'return',
  reason: 'r',
  promptVersion: AGENT_PROMPT_VERSION,
  observationTick: 0,
  provider: 'llm',
  ...over,
});

describe('DEC-7/DEC-8/DEC-9/DEC-10 decision validation', () => {
  it('accepts a well-formed decision that chose an offered id', () => {
    const engine = agentEngine();
    const observation = observationFor(engine, explorer(engine).id);
    const offered = observation.availableActions[0].id;
    const result = validateDecision(decision({ choiceId: offered }), observation);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.decision.choiceId).toBe(offered);
  });

  it('refuses an act without a choiceId', () => {
    const engine = agentEngine();
    const observation = observationFor(engine, explorer(engine).id);
    expect(validateDecision({ ...decision(), choiceId: undefined }, observation)).toEqual({
      ok: false,
      error: 'schema-mismatch',
    });
  });

  it('refuses a request without a request payload', () => {
    const engine = agentEngine();
    const observation = observationFor(engine, explorer(engine).id);
    expect(validateDecision(decision({ intent: 'request', choiceId: undefined }), observation)).toEqual(
      { ok: false, error: 'schema-mismatch' },
    );
  });

  it('refuses a choiceId the Agent was never offered', () => {
    const engine = agentEngine();
    const observation = observationFor(engine, explorer(engine).id);
    expect(validateDecision(decision({ choiceId: 'explore:99/99' }), observation)).toEqual({
      ok: false,
      error: 'invalid-choice-id',
    });
  });

  it('never accepts a raw Action in place of a choiceId', () => {
    const engine = agentEngine();
    const observation = observationFor(engine, explorer(engine).id);
    // The strict contract refuses the extra key before choiceId resolution is even reached, so a
    // model cannot smuggle action parameters past the menu.
    const smuggled = {
      ...decision({ choiceId: 'explore:99/99' }),
      action: { type: 'REFIT', targetId: 'base', moduleId: 'deepScan', remove: false },
    };
    expect(validateDecision(smuggled, observation)).toEqual({ ok: false, error: 'schema-mismatch' });
    expect(agentDecisionSchema.safeParse(smuggled).success).toBe(false);
    const actionOnly = {
      intent: 'act',
      reason: 'r',
      promptVersion: AGENT_PROMPT_VERSION,
      observationTick: observation.tick,
      provider: 'llm',
      action: { type: 'RETURN' },
    };
    expect(validateDecision(actionOnly, observation)).toEqual({
      ok: false,
      error: 'schema-mismatch',
    });
  });

  it('refuses a social option dressed up as a physical action', () => {
    const engine = agentEngine();
    const agent = explorer(engine);
    engine.state.agentMessages.push({
      id: 'agent-message-1',
      at: 0,
      from: 'admiral',
      to: agent.id,
      kind: 'command',
      text: '去调查。',
      payload: null,
      read: false,
    });
    const observation = observationFor(engine, agent.id);
    expect(observation.availableActions.map((c) => c.id)).toContain('accept');
    expect(validateDecision(decision({ choiceId: 'accept' }), observation)).toEqual({
      ok: false,
      error: 'invalid-choice-id',
    });
    // As a social intent it is fine.
    expect(validateDecision(decision({ intent: 'respond', choiceId: 'accept' }), observation).ok).toBe(
      true,
    );
  });

  it('maps malformed provider text onto invalid-json', () => {
    const engine = agentEngine();
    const observation = observationFor(engine, explorer(engine).id);
    expect(parseDecisionText('not json', observation)).toEqual({ ok: false, error: 'invalid-json' });
    expect(parseDecisionText(JSON.stringify(decision({ choiceId: 'return' })), observation).ok).toBe(
      true,
    );
  });
});

describe('DEC-12/DEC-13 stale observations are dropped, not guessed at', () => {
  const withTick = (observation: AgentObservation, tick: number): AgentObservation => ({
    ...observation,
    tick,
  });

  it('treats an aged decision as stale', () => {
    const engine = agentEngine();
    const observation = observationFor(engine, explorer(engine).id);
    expect(misreportsObservation(decision({ observationTick: 0 }), withTick(observation, STALE_TICK_LIMIT))).toBe(
      false,
    );
    expect(
      misreportsObservation(decision({ observationTick: 0 }), withTick(observation, STALE_TICK_LIMIT + 1)),
    ).toBe(true);
    expect(validateDecision(decision({ choiceId: 'return' }), withTick(observation, STALE_TICK_LIMIT + 1))).toEqual(
      { ok: false, error: 'stale' },
    );
  });

  it('treats a decision from the future as stale too', () => {
    const engine = agentEngine();
    const observation = observationFor(engine, explorer(engine).id);
    expect(validateDecision(decision({ choiceId: 'return', observationTick: 900 }), observation)).toEqual(
      { ok: false, error: 'stale' },
    );
  });

  it('accepts a decision formed against the very observation in hand', () => {
    const engine = agentEngine();
    const observation = observationFor(engine, explorer(engine).id);
    const fresh = decision({ choiceId: 'return', observationTick: observation.tick });
    expect(validateDecision(fresh, observation).ok).toBe(true);
    expect(matchesObservation(fresh, observation)).toBe(true);
  });

  it('honours the interval-derived staleness limit', () => {
    expect(STALE_TICK_LIMIT).toBeGreaterThan(0);
  });
});

describe('DEC-3 the score is a pure function', () => {
  it('returns identical results for identical inputs', () => {
    const engine = agentEngine();
    const agent = explorer(engine);
    const observation = observationFor(engine, agent.id);
    const first = rankCandidates(agent, observation);
    const second = rankCandidates(agent, observation);
    expect(second).toEqual(first);
    expect(evaluate(agent, observation)).toEqual(evaluate(agent, observation));
  });

  it('never reads a clock or a random source', () => {
    const engine = agentEngine();
    const before = JSON.stringify(engine.state);
    const agent = explorer(engine);
    rankCandidates(agent, observationFor(engine, agent.id));
    fallbackDecision(agent, observationFor(engine, agent.id));
    expect(JSON.stringify(engine.state)).toBe(before);
  });
});

describe('DEC-1/DEC-2 score terms and bands', () => {
  const weights = DECISION_WEIGHTS;

  it('uses the approved weights', () => {
    expect(weights.skillFit).toBe(0.2);
    expect(weights.goalAlignment).toBe(0.2);
    expect(weights.rewardAttractiveness).toBe(0.15);
    expect(weights.ceoTrust).toBe(0.1);
    expect(weights.teamFit).toBe(0.1);
    expect(weights.careerValue).toBe(0.1);
    expect(weights.promiseValue).toBe(0.05);
    expect(weights.recentMemoryScore).toBe(0.15);
    expect(weights.riskDiscomfort).toBe(-0.1);
    expect(weights.fatiguePenalty).toBe(-0.1);
  });

  it('places the band boundaries exactly where Agent.md §46 puts them', () => {
    expect(scoreBand(70)).toBe('accept');
    expect(scoreBand(69)).toBe('consult-llm');
    expect(scoreBand(45)).toBe('consult-llm');
    expect(scoreBand(44)).toBe('request');
    expect(scoreBand(25)).toBe('request');
    expect(scoreBand(24)).toBe('reject');
  });

  it('rewards a candidate that matches the Agent goal', () => {
    const engine = agentEngine();
    const agent = explorer(engine);
    const observation = observationFor(engine, agent.id);
    const explore = observation.availableActions.find((c) => c.id.startsWith('explore:'))!;
    const dock = observation.availableActions.find((c) => c.id.startsWith('dock:'))!;
    const aligned = decisionScore(agent, observation, explore);
    const aligned2 = decisionScore(agent, observation, dock);
    expect(aligned.goalAlignment).toBe(100);
    expect(aligned2.goalAlignment).toBe(0);
    expect(aligned.skillFit).toBe(100);
    expect(aligned2.skillFit).toBe(0);
  });

  it('grows the risk term as risk tolerance falls', () => {
    const engine = agentEngine();
    const agent = explorer(engine);
    const observation = observationFor(engine, agent.id);
    const candidate = observation.availableActions.find((c) => c.id.startsWith('explore:'))!;
    const tolerant = decisionScore({ ...agent, personality: { ...agent.personality, riskTolerance: 100 } }, observation, candidate);
    const cautious = decisionScore({ ...agent, personality: { ...agent.personality, riskTolerance: 0 } }, observation, candidate);
    expect(tolerant.riskDiscomfort).toBe(0);
    expect(cautious.riskDiscomfort).toBe(candidate.risk);
    expect(cautious.score).toBeLessThan(tolerant.score);
  });

  it('penalises fatigue by band', () => {
    const engine = agentEngine();
    const agent = explorer(engine);
    const observation = observationFor(engine, agent.id);
    const candidate = observation.availableActions.find((c) => c.id.startsWith('explore:'))!;
    const rested = decisionScore(agent, observation, candidate);
    const exhausted = decisionScore(
      { ...agent, state: { ...agent.state, fatigue: 90 } },
      observation,
      candidate,
    );
    expect(rested.fatiguePenalty).toBe(FATIGUE_PENALTY.normal);
    expect(exhausted.fatiguePenalty).toBe(FATIGUE_PENALTY['forced-rest']);
    expect(exhausted.score).toBeLessThan(rested.score);
  });

  it('lets matching memory raise the score (Agent.md §50)', () => {
    const engine = agentEngine();
    const agent = explorer(engine);
    const base = observationFor(engine, agent.id);
    const candidate = base.availableActions.find((c) => c.id.startsWith('explore:'))!;
    const withMemory: AgentObservation = {
      ...base,
      recentMemory: recentMemories([
        episodicMemory({ id: 'memory-1', at: 1, text: '上次探索很有收获。', tags: ['discovery'] }),
      ]),
    };
    const without = decisionScore(agent, base, candidate);
    const withRecall = decisionScore(agent, withMemory, candidate);
    expect(without.recentMemoryScore).toBe(0);
    expect(withRecall.recentMemoryScore).toBeGreaterThan(0);
    expect(withRecall.score).toBeGreaterThan(without.score);
  });

  it('only counts memories whose tags speak to the candidate', () => {
    const engine = agentEngine();
    const agent = explorer(engine);
    const base = observationFor(engine, agent.id);
    const maintenance = base.availableActions.find((c) => c.id === 'return')!;
    const withMemory: AgentObservation = {
      ...base,
      recentMemory: recentMemories([
        episodicMemory({ id: 'memory-1', at: 1, text: '发现异常。', tags: ['discovery'] }),
      ]),
    };
    expect(decisionScore(agent, withMemory, maintenance).recentMemoryScore).toBe(0);
    expect(TAG_GOALS.discovery).toContain('discovery');
  });

  it('values a candidate that would keep a pending promise', () => {
    const engine = agentEngine();
    const agent = explorer(engine);
    const base = observationFor(engine, agent.id);
    const refit = base.availableActions.find((c) => c.id.startsWith('refit:'))!;
    const other = base.availableActions.find((c) => c.id === 'return')!;
    const promised: Agent = {
      ...agent,
      promises: [
        createPromise({
          id: 'promise-1',
          to: agent.id,
          type: 'equipment',
          description: '授予 Deep Scan 权限',
          fulfills: { kind: 'grant-module', key: 'deepScan' },
          createdAt: 1,
        }),
      ],
    };
    expect(decisionScore(promised, base, refit).promiseValue).toBe(100);
    expect(decisionScore(promised, base, other).promiseValue).toBe(0);
    expect(decisionScore(agent, base, refit).promiseValue).toBe(0);
    expect(activePromise(promised.promises)?.id).toBe('promise-1');
  });

  it('ranks candidates deterministically with a total order', () => {
    const engine = agentEngine();
    const agent = explorer(engine);
    const ranked = rankCandidates(agent, observationFor(engine, agent.id));
    for (let i = 1; i < ranked.length; i++)
      expect(ranked[i - 1].breakdown.score).toBeGreaterThanOrEqual(ranked[i].breakdown.score);
    expect(ranked.length).toBe(observationFor(engine, agent.id).availableActions.length);
  });

  it('identifies team candidates', () => {
    expect(isTeamCandidate('escort:horizon')).toBe(true);
    expect(isTeamCandidate('team-accept:agent-2')).toBe(true);
    expect(isTeamCandidate('return')).toBe(false);
  });
});

describe('fallback decisions mirror the LLM contract', () => {
  it('produces a schema-valid decision stamped deterministic', () => {
    const engine = agentEngine();
    const agent = explorer(engine);
    const fallback = fallbackDecision(agent, observationFor(engine, agent.id));
    expect(agentDecisionSchema.safeParse(fallback).success).toBe(true);
    expect(fallback.provider).toBe('deterministic');
    expect(fallback.promptVersion).toBe(AGENT_PROMPT_VERSION);
    expect(fallback.reason.length).toBeGreaterThan(0);
  });

  it('picks the highest-scoring candidate when it is worth acting on', () => {
    const engine = agentEngine();
    const agent = explorer(engine);
    const observation = observationFor(engine, agent.id);
    const best = rankCandidates(agent, observation)[0];
    const fallback = fallbackDecision(agent, observation);
    if (best.breakdown.score >= 70) {
      expect(fallback.intent).toBe('act');
      expect(fallback.choiceId).toBe(best.candidate.id);
    }
  });

  it('is stable and never chooses an id that was not offered', () => {
    const engine = agentEngine();
    const agent = explorer(engine);
    const observation = observationFor(engine, agent.id);
    const ids = new Set(observation.availableActions.map((c) => c.id));
    const fallback = fallbackDecision(agent, observation);
    if (fallback.intent === 'act') expect(ids.has(fallback.choiceId!)).toBe(true);
    expect(fallbackDecision(agent, observation)).toEqual(fallback);
  });

  it('waits when the ship is busy and there is nothing social to answer', () => {
    const engine = agentEngine();
    const agent = explorer(engine);
    engine.state.ships.find((s) => s.id === 'vigil')!.current = {
      id: 'directive-1',
      action: { type: 'RETURN' },
      created: 0,
      phase: 'starting',
      work: 0,
      moved: 0,
      carried: 0,
      delivered: 0,
      reserved: { materials: 0, photon: 0, quantum: 0, specialFinds: 0 },
      paidCredits: 0,
      search: 0,
      note: '',
      source: 'admiral',
      groupOrderId: null,
      groupSlot: 0,
      groupTotal: 0,
      groupSpacing: 30,
      origin: { x: 0, y: 0 },
    };
    const observation = observationFor(engine, agent.id);
    expect(observation.availableActions).toEqual([]);
    expect(fallbackDecision(agent, observation)).toEqual({
      intent: 'wait',
      reason: '当前没有可执行的行动。',
      promptVersion: AGENT_PROMPT_VERSION,
      observationTick: observation.tick,
      provider: 'deterministic',
    });
  });

  it('answers with a social intent rather than dressing it up as an action', () => {
    const engine = agentEngine();
    const agent = explorer(engine);
    engine.state.agentMessages.push({
      id: 'agent-message-1',
      at: 0,
      from: 'admiral',
      to: agent.id,
      kind: 'command',
      text: '去调查。',
      payload: null,
      read: false,
    });
    engine.state.ships.find((s) => s.id === 'vigil')!.current = null;
    // Force the social options to dominate by emptying the physical menu.
    const observation = observationFor(engine, agent.id);
    const socialOnly: AgentObservation = {
      ...observation,
      availableActions: observation.availableActions.filter((c) =>
        ['accept', 'reject', 'counteroffer'].includes(c.id),
      ),
    };
    const fallback = fallbackDecision(agent, socialOnly);
    expect(['respond']).toContain(fallback.intent);
    expect(['accept', 'reject', 'counteroffer']).toContain(fallback.choiceId);
    expect(agentDecisionSchema.safeParse(fallback).success).toBe(true);
  });

  it('reports the score and band the scheduler routes on', () => {
    const engine = agentEngine();
    const agent = explorer(engine);
    const result = evaluate(agent, observationFor(engine, agent.id));
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.candidate).not.toBeNull();
    expect(scoreBand(result.score)).toBe(result.band);
  });
});
