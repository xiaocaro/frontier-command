/**
 * P0 observation (docs/lv3/03-test-plan.md §4, DEC-14 … DEC-16).
 *
 * The observation is the Agent's whole world, so the assertions that matter are about what is *not*
 * in it. The existing world-level cropping is already covered by `recon.test.ts`; what is new here
 * is the single-Agent layer — and memory text, which is the new leak vector.
 */
import { describe, it, expect } from 'vitest';
import { buildObservation, companyPriorities, pendingMessages } from '../../src/engine/agent/observation';
import { episodicMemory, promiseMemory } from '../../src/engine/agent/memory';
import { createPromise } from '../../src/engine/agent/promise';
import { agentByCareer, agentEngine, observationFor, observationForCareer, operatorOf } from './support';
import { issue } from '../helpers';
import type { AgentMessage } from '../../src/engine/types';

const KEYS = [
  'time',
  'tick',
  'operatorId',
  'agentId',
  'ship',
  'self',
  'company',
  'contacts',
  'systems',
  'bodies',
  'opportunities',
  'relationships',
  'recentMemory',
  'pendingMessages',
  'activePromise',
  'activeDirective',
  'availableActions',
];

describe('DEC-14/DEC-15 observation shape and isolation', () => {
  it('carries the widened shape and no remnant of legalActions', () => {
    const engine = agentEngine();
    const agent = agentByCareer(engine, 'explorer');
    const observation = observationFor(engine, agent.id);
    expect(Object.keys(observation).sort()).toEqual([...KEYS].sort());
    expect('legalActions' in observation).toBe(false);
    expect(observation.agentId).toBe(agent.id);
    expect(observation.operatorId).toBe(operatorOf(engine, agent.id));
    expect(observation.ship.id).toBe('vigil');
    expect(observation.self.career).toBe('explorer');
    expect(observation.self.personality.curiosity).toBe(90);
    expect(observation.self.goal.kind).toBe('discovery');
    expect(observation.company.credits).toBe(engine.state.resources.credits);
    expect(observation.company.tension).toBe(engine.state.tension);
  });

  it('never exposes world-level hidden state', () => {
    const engine = agentEngine();
    const json = JSON.stringify(observationForCareer(engine, 'tactical'));
    for (const forbidden of [
      '"enemies"',
      '"counterTracking"',
      '"waypoints"',
      '"destination"',
      '"localReports"',
      '"siteIntel"',
      '"initialSeed"',
      '"factions"',
      '"reports"',
      '"stance"',
    ])
      expect(json).not.toContain(forbidden);
    expect(json).not.toContain('"seed"');
  });

  it('never exposes an undiscovered place by name', () => {
    const engine = agentEngine();
    const hidden = engine.state.locations.filter((l) => !l.discovered);
    expect(hidden.length).toBeGreaterThan(0);
    const json = JSON.stringify(observationForCareer(engine, 'explorer'));
    for (const location of hidden) expect(json).not.toContain(location.name);
  });

  it('keeps one Agent out of another Agent private state', () => {
    const engine = agentEngine();
    const scientist = agentByCareer(engine, 'scientist');
    const secret = 'SENTINEL-MEMORY-TEXT';
    const promise = createPromise({
      id: 'promise-secret',
      to: scientist.id,
      type: 'equipment',
      description: 'SENTINEL-PROMISE-DESCRIPTION',
      fulfills: { kind: 'grant-module', key: 'deepScan' },
      createdAt: 1,
    });
    scientist.memories = [episodicMemory({ id: 'memory-secret', at: 1, text: secret, tags: ['discovery'] })];
    scientist.promises = [promise];
    scientist.state.trustInAdmiral = 13;

    const json = JSON.stringify(observationForCareer(engine, 'explorer'));
    expect(json).not.toContain(secret);
    expect(json).not.toContain('SENTINEL-PROMISE-DESCRIPTION');
    expect(json).not.toContain('promise-secret');
    expect(json).not.toContain('"trustInAdmiral":13');
    // The owning Agent still sees its own state.
    const own = observationFor(engine, scientist.id);
    expect(own.self.state.trustInAdmiral).toBe(13);
    expect(JSON.stringify(own)).toContain(secret);
  });

  it('returns null for an operator with no Agent', () => {
    const engine = agentEngine();
    const rules = engine.state.operators.find((o) => o.kind === 'rules')!;
    expect(engine.getObservation(rules.id)).toBeNull();
    expect(engine.getObservation('ops-nonexistent')).toBeNull();
    expect(engine.controllerPort(rules.id).getObservation()).toBeNull();
  });
});

describe('single-Agent view assembly', () => {
  it('lists only unread messages addressed to this Agent, oldest first', () => {
    const engine = agentEngine();
    const explorer = agentByCareer(engine, 'explorer');
    const scientist = agentByCareer(engine, 'scientist');
    const message = (over: Partial<AgentMessage>): AgentMessage => ({
      id: 'agent-message-1',
      at: 0,
      from: 'admiral',
      to: explorer.id,
      kind: 'ask',
      text: 'hi',
      payload: null,
      read: false,
      ...over,
    });
    engine.state.agentMessages = [
      message({ id: 'agent-message-3', at: 30 }),
      message({ id: 'agent-message-1', at: 10 }),
      message({ id: 'agent-message-4', at: 40, read: true }),
      message({ id: 'agent-message-2', at: 20, to: scientist.id }),
    ];
    const pending = observationFor(engine, explorer.id).pendingMessages;
    expect(pending.map((m) => m.id)).toEqual(['agent-message-1', 'agent-message-3']);
    expect(pendingMessages(engine.state.agentMessages, scientist.id).map((m) => m.id)).toEqual([
      'agent-message-2',
    ]);
  });

  it('surfaces the active promise and the current directive', () => {
    const engine = agentEngine();
    const explorer = agentByCareer(engine, 'explorer');
    expect(observationFor(engine, explorer.id).activePromise).toBeNull();
    expect(observationFor(engine, explorer.id).activeDirective).toBeNull();

    explorer.promises = [
      { ...createPromise({ id: 'promise-late', to: explorer.id, type: 'rest', description: 'later', fulfills: { kind: 'grant-rest' }, createdAt: 90 }) },
      { ...createPromise({ id: 'promise-early', to: explorer.id, type: 'rest', description: 'now', fulfills: { kind: 'grant-rest' }, createdAt: 10 }) },
    ];
    explorer.memories = [
      promiseMemory({ id: 'memory-p', promiseId: 'promise-early', at: 12, text: '答应了' }),
    ];
    expect(observationFor(engine, explorer.id).activePromise?.id).toBe('promise-early');

    issue(engine, { type: 'MOVE', point: { x: 0, y: 0 } }, 'vigil');
    const observation = observationFor(engine, explorer.id);
    expect(observation.activeDirective).toEqual({ actionType: 'MOVE', source: 'admiral', note: '' });
    expect(observation.company.priorities).toEqual(['MOVE']);
    expect(observation.availableActions).toEqual([]);
  });

  it('derives company priorities from the only standing statement the world holds', () => {
    expect(companyPriorities(null)).toEqual([]);
    const engine = agentEngine();
    const ship = engine.state.ships.find((s) => s.id === 'vigil')!;
    issue(engine, { type: 'MOVE', point: { x: 1, y: 1 } }, 'vigil', 'QUEUE');
    expect(companyPriorities(ship.current)).toEqual(['MOVE']);
    ship.current!.source = 'standing';
    expect(companyPriorities(ship.current)).toEqual([]);
  });

  it('hands out a fresh copy so a decision cannot mutate the world through it', () => {
    const engine = agentEngine();
    const observation = observationForCareer(engine, 'logistics');
    const before = engine.state.agents.find((a) => a.career === 'logistics')!.state.fatigue;
    observation.self.state.fatigue = 999;
    observation.availableActions.length = 0;
    const again = observationForCareer(engine, 'logistics');
    expect(again.self.state.fatigue).toBe(before);
    expect(again.availableActions.length).toBeGreaterThan(0);
  });

  it('stamps the observation with the tick that stale detection compares against', () => {
    const engine = agentEngine();
    for (let i = 0; i < 30; i++) {
      engine.dispatchCommand({ type: 'pause', paused: false });
      engine.step();
    }
    const observation = observationForCareer(engine, 'explorer');
    expect(observation.tick).toBe(engine.state.tick);
    expect(observation.time).toBe(engine.state.time);
  });

  it('builds directly from cropped inputs (pure, engine-free)', () => {
    const engine = agentEngine();
    const agent = agentByCareer(engine, 'logistics');
    const observation = buildObservation(agent, {
      time: 5,
      tick: 50,
      operatorId: 'ops-meridian',
      agentId: agent.id,
      ship: engine.state.ships.find((s) => s.id === 'meridian')!,
      contacts: [],
      systems: [],
      bodies: [],
      opportunities: [],
      credits: 7,
      tension: 3,
      messages: [],
      availableActions: [],
    });
    expect(observation.tick).toBe(50);
    expect(observation.company).toEqual({ credits: 7, tension: 3, priorities: [] });
    expect(observation.relationships).toEqual(agent.relationships);
  });
});
