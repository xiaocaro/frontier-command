import { describe, it, expect } from 'vitest';
import { agentEngine, agentsOf } from './support';
import { agentSchema } from '../../src/engine/agent/schemas';
import { INITIAL_PERSONALITIES } from '../../src/engine/agent/personality';
import { CAREER_GOAL } from '../../src/engine/agent/goals';
import { worldSchema } from '../../src/engine/save-schema';
import { parseSave } from '../../src/engine/saves';
import type { AgentCareer } from '../../src/engine/types';

const CAREERS: AgentCareer[] = ['explorer', 'scientist', 'tactical', 'logistics'];

describe('Lv3 initial Agent roster', () => {
  it('creates exactly four Agents, one per career, with stable ids', () => {
    const agents = agentsOf(agentEngine());
    expect(agents).toHaveLength(4);
    expect(agents.map((a) => a.career).sort()).toEqual([...CAREERS].sort());
    expect(agents.map((a) => a.id)).toEqual(['agent-1', 'agent-2', 'agent-3', 'agent-4']);
  });

  it('binds each Agent 1:1 to an operator and a ship', () => {
    const engine = agentEngine();
    const bound = engine.state.operators.filter((o) => o.kind === 'agent');
    expect(bound).toHaveLength(4);
    for (const operator of bound) {
      expect(operator.agentId).toBeDefined();
      expect(engine.state.agents.some((a) => a.id === operator.agentId)).toBe(true);
      const assignment = engine.state.assignments.find((a) => a.operatorId === operator.id);
      expect(assignment).toBeDefined();
      expect(engine.state.ships.some((s) => s.id === assignment!.shipId)).toBe(true);
    }
    // Assignments stay 1:1 in both directions.
    expect(new Set(engine.state.assignments.map((a) => a.operatorId)).size).toBe(
      engine.state.assignments.length,
    );
    expect(new Set(engine.state.assignments.map((a) => a.shipId)).size).toBe(
      engine.state.assignments.length,
    );
  });

  it('leaves the remaining ships on rules operators with no agentId', () => {
    const engine = agentEngine();
    const rules = engine.state.operators.filter((o) => o.kind === 'rules');
    expect(rules).toHaveLength(engine.state.ships.length - 4);
    expect(rules.every((o) => o.agentId === undefined)).toBe(true);
    // A `'rules'` operator is still assigned a ship, but has no Agent view to hand out.
    expect(engine.controllerPort(rules[0].id).getObservation()).toBeNull();
  });

  it('gives every Agent the approved personality and goal for its career', () => {
    for (const agent of agentsOf(agentEngine())) {
      expect(agent.personality).toEqual(INITIAL_PERSONALITIES[agent.career]);
      expect(agent.goal.kind).toBe(CAREER_GOAL[agent.career]);
      expect(agent.goal.progress).toBe(0);
      expect(agent.state.goalProgress).toBe(0);
    }
  });

  it('gives every Agent a complete relationship table that excludes itself', () => {
    const engine = agentEngine();
    const ids = engine.state.agents.map((a) => a.id);
    for (const agent of engine.state.agents) {
      expect(agent.relationships.map((r) => r.targetAgentId)).toEqual(
        ids.filter((id) => id !== agent.id),
      );
    }
  });

  it('starts with empty memory, promises and message logs', () => {
    const engine = agentEngine();
    for (const agent of engine.state.agents) {
      expect(agent.memories).toEqual([]);
      expect(agent.promises).toEqual([]);
    }
    expect(engine.state.agentMessages).toEqual([]);
    expect(engine.state.agentInteractions).toEqual([]);
  });

  it('produces a world that satisfies both the Agent and the world save contracts', () => {
    const engine = agentEngine();
    for (const agent of engine.state.agents) expect(agentSchema.safeParse(agent).success).toBe(true);
    expect(worldSchema.safeParse(engine.state).success).toBe(true);
    expect(parseSave(JSON.parse(JSON.stringify(engine.state)))).toEqual(engine.state);
  });
});
