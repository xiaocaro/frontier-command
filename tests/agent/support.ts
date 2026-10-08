/**
 * Shared scaffolding for the Lv3 domain tests.
 *
 * Tests use real `SimulationEngine` worlds rather than hand-built literals wherever possible: the
 * point of P0 is that the Agent layer works against the *actual* world shape, not a convenient
 * mock of it.
 */
import { SimulationEngine } from '../../src/engine/engine';
import { createWorld } from '../../src/engine/data';
import type { Agent, AgentObservation, AgentCareer } from '../../src/engine/types';
import { quietEngine } from '../helpers';

export { quietEngine };

/** A quiet world (no enemies) that already carries the four starting Agents. */
export function agentEngine(seed = 236807): SimulationEngine {
  return quietEngine(seed);
}

export function agentsOf(engine: SimulationEngine): Agent[] {
  return engine.state.agents;
}

export function agentByCareer(engine: SimulationEngine, career: AgentCareer): Agent {
  const agent = engine.state.agents.find((a) => a.career === career);
  if (!agent) throw new Error('no agent with career ' + career);
  return agent;
}

export function agentShipOf(engine: SimulationEngine, agent: Agent): string {
  const operator = engine.state.operators.find((o) => o.agentId === agent.id);
  const assignment = engine.state.assignments.find((a) => a.operatorId === operator?.id);
  if (!assignment) throw new Error('no ship bound to ' + agent.id);
  return assignment.shipId;
}

export function operatorOf(engine: SimulationEngine, agentId: string): string {
  const operator = engine.state.operators.find((o) => o.agentId === agentId);
  if (!operator) throw new Error('no operator bound to ' + agentId);
  return operator.id;
}

export function observationFor(engine: SimulationEngine, agentId: string): AgentObservation {
  const observation = engine.getObservation(operatorOf(engine, agentId));
  if (!observation) throw new Error('no observation for ' + agentId);
  return observation;
}

export function observationForCareer(
  engine: SimulationEngine,
  career: AgentCareer,
): AgentObservation {
  return observationFor(engine, agentByCareer(engine, career).id);
}

/** Replaces one Agent in place and returns the updated record. */
export function patchAgent(
  engine: SimulationEngine,
  agentId: string,
  patch: (agent: Agent) => Agent,
): Agent {
  const index = engine.state.agents.findIndex((a) => a.id === agentId);
  if (index < 0) throw new Error('no agent ' + agentId);
  engine.state.agents[index] = patch(engine.state.agents[index]);
  return engine.state.agents[index];
}

/**
 * A genuine v10-shaped world: the current starting world with every v11 addition removed and the
 * operator binding unwound. `legacyV10Schema` accepts it, which is what makes it a fair migration
 * input rather than a convenient fake.
 */
export function v10World(seed = 236807): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(createWorld(seed))) as Record<string, unknown>;
  delete clone.agents;
  delete clone.agentMessages;
  delete clone.agentInteractions;
  clone.version = 10;
  clone.operators = (clone.operators as Record<string, unknown>[]).map((operator) => {
    const { agentId: _agentId, ...rest } = operator;
    return { ...rest, kind: 'rules' };
  });
  return clone;
}
