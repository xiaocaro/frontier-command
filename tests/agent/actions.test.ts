/**
 * P0 affordances (docs/lv3/03-test-plan.md §4, DEC-4 … DEC-6, DEC-17).
 *
 * The candidate list is the anti-hallucination mechanism, so the two properties that matter are
 * "never offer something the engine would refuse" and "the same world always produces the same menu
 * in the same order".
 */
import { describe, it, expect } from 'vitest';
import { actionSchema } from '../../src/engine/commands';
import { validateActionIn } from '../../src/engine/command-system';
import {
  CANDIDATE_CAPS,
  GOAL_KINDS_BY_CATEGORY,
  agentForOperator,
  agentShip,
  availableActions,
  isSocialChoiceId,
  resolveChoice,
} from '../../src/engine/agent/actions';
import { emptyStock } from '../../src/engine/data';
import { issue } from '../helpers';
import { agentByCareer, agentEngine, agentShipOf } from './support';
import type { Agent, AgentMessage } from '../../src/engine/types';

const explorer = (e = agentEngine()) => agentByCareer(e, 'explorer');

/** The choiceId prefixes the approved table in docs/lv3/03-implementation-plan.md §5 must cover. */
const REQUIRED_FORMS = [
  'explore:',
  'survey:',
  'transit:',
  'haul:',
  'escort:',
  'patrol:',
  'dock:',
  'refit:',
  'return',
];

describe('DEC-4 every candidate is legal at generation time', () => {
  it('parses against the engine action schema and passes the engine rule check', () => {
    const engine = agentEngine();
    for (const agent of engine.state.agents) {
      const ship = agentShip(engine.state, agent.id)!;
      const candidates = availableActions(engine.state, agent);
      expect(candidates.length).toBeGreaterThan(0);
      for (const candidate of candidates) {
        expect(actionSchema.safeParse(candidate.action).success, candidate.id).toBe(true);
        if (!isSocialChoiceId(candidate.id))
          expect(validateActionIn(engine.state, ship, candidate.action).ok, candidate.id).toBe(true);
      }
    }
  });

  it('covers the approved choiceId forms on a fresh world', () => {
    const engine = agentEngine();
    const ids = availableActions(engine.state, explorer(engine)).map((c) => c.id);
    for (const form of REQUIRED_FORMS)
      expect(ids.some((id) => id === form || id.startsWith(form)), form).toBe(true);
  });

  it('offers a recover candidate only once a wreck has actually been found', () => {
    const engine = agentEngine();
    const agent = explorer(engine);
    expect(availableActions(engine.state, agent).some((c) => c.id.startsWith('recover:'))).toBe(false);
    engine.state.wrecks.push({
      id: 'wreck:test',
      name: '残骸 TEST',
      x: engine.state.ships[0].x + 20,
      y: engine.state.ships[0].y,
      stock: emptyStock(),
      discovered: true,
    });
    const candidate = availableActions(engine.state, agent).find((c) => c.id.startsWith('recover:'));
    expect(candidate?.action).toEqual({ type: 'RECOVER', targetId: 'wreck:test' });
  });

  it('never offers an undiscovered wormhole for transit (KNOWN_ISSUES N-8)', () => {
    const engine = agentEngine();
    const agent = explorer(engine);
    for (const hole of engine.state.wormholes) hole.discovered = false;
    expect(availableActions(engine.state, agent).some((c) => c.id.startsWith('transit:'))).toBe(
      false,
    );
  });
});

describe('DEC-5 candidate ids are stable across ticks', () => {
  it('produces the identical ordered set from the same world state', () => {
    const engine = agentEngine();
    const agent = explorer(engine);
    const first = availableActions(engine.state, agent).map((c) => c.id);
    const second = availableActions(engine.state, agent).map((c) => c.id);
    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(first.length);
  });

  it('produces the identical set in a second, independently seeded world', () => {
    const a = availableActions(agentEngine(4242).state, explorer(agentEngine(4242)));
    const b = availableActions(agentEngine(4242).state, explorer(agentEngine(4242)));
    expect(b.map((c) => c.id)).toEqual(a.map((c) => c.id));
  });

  it('caps every category so one decision stays affordable', () => {
    const engine = agentEngine();
    for (const agent of engine.state.agents) {
      const ids = availableActions(engine.state, agent).map((c) => c.id);
      for (const [category, cap] of Object.entries(CANDIDATE_CAPS))
        expect(ids.filter((id) => id.startsWith(category + ':')).length, category).toBeLessThanOrEqual(
          cap,
        );
    }
  });
});

describe('DEC-6 social candidates', () => {
  const message = (over: Partial<AgentMessage>): AgentMessage => ({
    id: 'agent-message-1',
    at: 10,
    from: 'admiral',
    to: 'agent-1',
    kind: 'command',
    text: '去调查那个信号。',
    payload: null,
    read: false,
    ...over,
  });

  it('offers accept / reject / counteroffer while a task offer is unanswered', () => {
    const engine = agentEngine();
    const agent = explorer(engine);
    engine.state.agentMessages.push(message({ to: agent.id }));
    const ids = availableActions(engine.state, agent).map((c) => c.id);
    expect(ids).toContain('accept');
    expect(ids).toContain('reject');
    expect(ids).toContain('counteroffer');
  });

  it('offers team replies while a team request is unanswered', () => {
    const engine = agentEngine();
    const agent = explorer(engine);
    engine.state.agentMessages.push(
      message({
        kind: 'team-request',
        from: 'agent-2',
        to: agent.id,
        payload: { requestingAgentId: 'agent-2', accept: false },
      }),
    );
    const ids = availableActions(engine.state, agent).map((c) => c.id);
    expect(ids).toContain('team-accept:agent-2');
    expect(ids).toContain('team-decline:agent-2');
  });

  it('stops offering replies once the message has been read', () => {
    const engine = agentEngine();
    const agent = explorer(engine);
    engine.state.agentMessages.push(message({ to: agent.id, read: true }));
    const ids = availableActions(engine.state, agent).map((c) => c.id);
    expect(ids).not.toContain('accept');
    expect(ids).not.toContain('team-accept:agent-2');
  });

  it('classifies social ids as social', () => {
    for (const id of ['accept', 'reject', 'counteroffer', 'team-accept:agent-2'])
      expect(isSocialChoiceId(id), id).toBe(true);
    for (const id of ['return', 'explore:0/-1', 'escort:agent-2'])
      expect(isSocialChoiceId(id), id).toBe(false);
  });
});

describe('DEC-17 a busy ship is offered no physical action', () => {
  it('returns only social candidates while a directive is running', () => {
    const engine = agentEngine();
    const agent = explorer(engine);
    const before = availableActions(engine.state, agent);
    expect(before.some((c) => !isSocialChoiceId(c.id))).toBe(true);

    issue(engine, { type: 'MOVE', point: { x: 0, y: 0 } }, 'vigil');
    expect(engine.state.ships.find((s) => s.id === 'vigil')!.current).not.toBeNull();
    expect(availableActions(engine.state, agent)).toEqual([]);

    engine.state.agentMessages.push({
      id: 'agent-message-1',
      at: 0,
      from: 'admiral',
      to: agent.id,
      kind: 'ask',
      text: '情况如何？',
      payload: null,
      read: false,
    });
    const busy = availableActions(engine.state, agent);
    expect(busy.map((c) => c.id)).toEqual(['accept', 'reject', 'counteroffer']);
  });
});

describe('resolution and binding lookup', () => {
  it('resolves a choiceId back to the already-constructed action', () => {
    const engine = agentEngine();
    const agent = explorer(engine);
    const candidates = availableActions(engine.state, agent);
    const target = candidates.find((c) => c.id.startsWith('explore:'))!;
    expect(resolveChoice(candidates, target.id)?.action).toEqual(target.action);
    expect(resolveChoice(candidates, 'explore:99/99')).toBeNull();
  });

  it('maps operator -> agent and agent -> ship only through the explicit binding', () => {
    const engine = agentEngine();
    const agent = explorer(engine);
    const operator = engine.state.operators.find((o) => o.agentId === agent.id)!;
    expect(agentForOperator(engine.state, operator.id)?.id).toBe(agent.id);
    expect(agentForOperator(engine.state, 'ops-meridian-2')).toBeNull();
    expect(agentShipOf(engine, agent)).toBe('vigil');
    expect(agentShip(engine.state, agent.id)?.id).toBe('vigil');
  });

  it('gives every candidate a non-empty label and goal-kind set where expected', () => {
    const engine = agentEngine();
    for (const candidate of availableActions(engine.state, explorer(engine))) {
      expect(candidate.label.length).toBeGreaterThan(0);
      expect(candidate.risk).toBeGreaterThanOrEqual(0);
      expect(candidate.risk).toBeLessThanOrEqual(100);
      expect(candidate.reward).toBeGreaterThanOrEqual(0);
      expect(candidate.reward).toBeLessThanOrEqual(100);
      if (candidate.id.startsWith('explore:'))
        expect(candidate.goalKinds).toEqual([...GOAL_KINDS_BY_CATEGORY.explore]);
    }
  });

  it('returns nothing for an Agent with no ship binding', () => {
    const engine = agentEngine();
    const orphan: Agent = { ...explorer(engine), id: 'agent-99' };
    expect(availableActions(engine.state, orphan)).toEqual([]);
  });
});
