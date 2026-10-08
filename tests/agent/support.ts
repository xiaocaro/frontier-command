/**
 * Shared scaffolding for the Lv3 domain tests.
 *
 * Tests use real `SimulationEngine` worlds rather than hand-built literals wherever possible: the
 * point of P0 is that the Agent layer works against the *actual* world shape, not a convenient
 * mock of it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimulationEngine } from '../../src/engine/engine';
import { createWorld } from '../../src/engine/data';
import type { Action, Agent, AgentObservation, AgentCareer, CommandResult } from '../../src/engine/types';
import type { MockAnswer, MockDecision, MockRule, ModelError } from '../../electron/agent/mock-client';
import { loadDecisionSchema, loadPromptTemplates } from '../../electron/agent/prompt';
import { DecisionRuntime, type DecisionTrace } from '../../electron/agent/runtime';
import type { ModelClient } from '../../electron/agent/model-client';
import type { ActionSubmitter, MessageSubmitter } from '../../electron/agent/runtime';
import type { AgentReply } from '../../src/engine/agent/dialogue';
import { quietEngine } from '../helpers';

export { quietEngine };

/** Repository root, derived from this file's location so it does not depend on the caller's cwd. */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * A `DecisionRuntime` wired to the real prompt files and the real JSON Schema, exactly as a host
 * would build it — so the tests exercise the actual assets rather than a convenient stub.
 */
export function agentRuntime(
  client: ModelClient,
  onTrace?: (trace: DecisionTrace) => void,
  submitter?: ActionSubmitter,
  messenger?: MessageSubmitter,
): DecisionRuntime {
  return new DecisionRuntime({
    client,
    prompts: loadPromptTemplates(REPO_ROOT),
    schema: loadDecisionSchema(REPO_ROOT),
    onTrace,
    // Defaults to one that declines. Every P1/P2 test asserts that *asking* for a decision leaves
    // the world alone, so the scaffold must not quietly start submitting things.
    submitter: submitter ?? { submit: () => ({ ok: false, reason: '测试脚手架未接线提交' }) },
    // Same reasoning for speech: a test that wants an Agent to actually be heard passes a real one.
    messenger: messenger ?? { send: () => ({ ok: false, reason: '测试脚手架未接线喊话' }) },
  });
}

/** A messenger that actually reaches the engine, speaking as the Agent itself. */
export function engineMessenger(engine: SimulationEngine): MessageSubmitter {
  return {
    send: (reply, observation) =>
      engine.dispatchCommand(
        {
          type: 'agentMessage',
          from: observation.agentId,
          to: reply.to,
          kind: reply.kind,
          text: reply.text,
          payload: reply.payload,
        },
        observation.agentId,
      ),
  };
}

/** Records what an Agent tried to say, without letting it reach the world. */
export function recordingMessenger(
  verdict: CommandResult = { ok: true, reason: '记录' },
): MessageSubmitter & { said: AgentReply[] } {
  const said: AgentReply[] = [];
  return {
    said,
    send: (reply) => {
      said.push(reply);
      return verdict;
    },
  };
}

/** A submitter that actually reaches the engine, through the Agent's own operator port. */
export function engineSubmitter(engine: SimulationEngine): ActionSubmitter {
  return {
    submit: (action, observation) =>
      engine.controllerPort(observation.operatorId).submitAction(action),
  };
}

/** Records what a decision tried to submit, without letting it reach the world. */
export function recordingSubmitter(verdict: CommandResult = { ok: false, reason: '未提交' }): ActionSubmitter & {
  submitted: { action: Action; agentId: string }[];
} {
  const submitted: { action: Action; agentId: string }[] = [];
  return {
    submitted,
    submit: (action, observation) => {
      submitted.push({ action, agentId: observation.agentId });
      return verdict;
    },
  };
}

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

// --- World situations the MVP scenario needs ---------------------------------------------------

let nextFixtureMessage = 1;

/**
 * An unread Admiral task offer. This is what puts `accept` / `reject` / `counteroffer` on an
 * Agent's menu at all (`src/engine/agent/actions.ts` only offers them when a task-like message is
 * waiting), so every scenario that starts with "the Admiral issues a mission" needs one.
 */
export function offerMission(
  engine: SimulationEngine,
  toAgentId: string,
  text = '穿越虫洞，寻找失联探测船，确认发生了什么。',
  kind: 'command' | 'ask' | 'negotiate' | 'promise' = 'command',
): void {
  engine.state.agentMessages.push({
    id: 'agent-message-fixture-' + nextFixtureMessage++,
    at: engine.state.time,
    from: 'admiral',
    to: toAgentId,
    kind,
    text,
    payload: null,
    read: false,
  });
}

/** Another Agent asking this one to fly with them (MVP EVT-03's only Agent-Agent interaction). */
export function requestTeamUp(
  engine: SimulationEngine,
  fromAgentId: string,
  toAgentId: string,
  text = '我要进那片空域，需要护航。',
): void {
  engine.state.agentMessages.push({
    id: 'agent-message-fixture-' + nextFixtureMessage++,
    at: engine.state.time,
    from: fromAgentId,
    to: toAgentId,
    kind: 'team-request',
    text,
    payload: { requestingAgentId: fromAgentId, accept: false },
    read: false,
  });
}

// --- Scenario fixtures (docs/lv3/01-mvp-scenario.md) -------------------------------------------
//
// `tests/fixtures/agent/scenarios.json` is a library of *recorded* decisions keyed by event id.
// The runtime knows nothing about scenarios — that is the point. A test arms a `MockModelClient`
// with a recording and then asks the runtime the same question it would ask a live model; the
// scenario ids exist only so a failing assertion can name the situation it came from.

const CAREERS: readonly AgentCareer[] = ['explorer', 'scientist', 'tactical', 'logistics'];

/** A canned decision as written in the fixture, before token resolution. */
interface FixtureDecision {
  intent: MockDecision['intent'];
  choice?: string;
  reason: string;
  say?: string;
  request?: NonNullable<MockDecision['request']>;
}

type FixtureFailure = { kind: 'error'; error: string } | { kind: 'throw'; message: string } | { kind: 'text'; text: string } | { kind: 'decision'; decision: MockDecision };

export interface AgentScenarioFixture {
  version: number;
  promptVersion: string;
  /** Keyed by `EVT-01` or `EVT-07:override`; the inner key is a career. */
  decisions: Record<string, Partial<Record<AgentCareer, FixtureDecision>>>;
  failures: Record<string, FixtureFailure>;
}

let cached: AgentScenarioFixture | undefined;

/**
 * Loads the recording. The fixture nested one level deeper for events with variants (`EVT-07` has
 * `promise` and `override`), so this flattens it into one `scenarioId[:variant] → career → case`
 * map — callers should not have to care which shape the JSON happened to use.
 */
export function scenarioFixture(): AgentScenarioFixture {
  if (cached) return cached;
  const raw = JSON.parse(
    readFileSync(join('tests', 'fixtures', 'agent', 'scenarios.json'), 'utf8'),
  ) as { version: number; promptVersion: string; decisions: Record<string, Record<string, unknown>>; failures: Record<string, FixtureFailure> };
  const decisions: AgentScenarioFixture['decisions'] = {};
  for (const [id, body] of Object.entries(raw.decisions)) {
    const isFlat = Object.keys(body).some((key) => CAREERS.includes(key as AgentCareer));
    if (isFlat) decisions[id] = body as Partial<Record<AgentCareer, FixtureDecision>>;
    else
      for (const [variant, cases] of Object.entries(body))
        decisions[id + ':' + variant] = cases as Partial<Record<AgentCareer, FixtureDecision>>;
  }
  cached = { version: raw.version, promptVersion: raw.promptVersion, decisions, failures: raw.failures };
  return cached;
}

/** Career → agent id, for resolving `#agent:*` / `#team-accept:*` tokens. */
export function careerIds(engine: SimulationEngine): Record<AgentCareer, string> {
  const map = {} as Record<AgentCareer, string>;
  for (const agent of engine.state.agents) map[agent.career] = agent.id;
  return map;
}

/**
 * Resolves a fixture token against the observation it will be replayed against. Tokens exist so a
 * recording never hard-codes a world-generated id (`survey:<bodyId>`, `explore:<q>/<r>`) — those
 * ids differ per seed, and a recording that only replays on one seed would be worthless.
 */
export function resolveToken(
  token: string,
  observation: AgentObservation,
  ids: Record<AgentCareer, string>,
): string {
  if (!token.startsWith('#')) return token;
  const body = token.slice(1);
  if (body.startsWith('first:')) {
    const prefix = body.slice('first:'.length);
    const found = observation.availableActions.find((candidate) => candidate.id.startsWith(prefix));
    if (!found) throw new Error('fixture 无法解析 ' + token + '：当前菜单里没有该前缀的选项');
    return found.id;
  }
  const named = /^(team-accept|team-decline|agent):(.+)$/.exec(body);
  if (named) {
    const id = ids[named[2] as AgentCareer];
    if (!id) throw new Error('fixture 引用了未知职业：' + named[2]);
    return named[1] === 'agent' ? id : named[1] + ':' + id;
  }
  throw new Error('未知 fixture token：' + token);
}

function resolveDecision(
  canned: FixtureDecision,
  observation: AgentObservation,
  ids: Record<AgentCareer, string>,
): MockDecision {
  const decision: Record<string, unknown> = { intent: canned.intent, reason: canned.reason };
  if (canned.say !== undefined) decision.say = canned.say;
  if (canned.choice !== undefined) decision.choiceId = resolveToken(canned.choice, observation, ids);
  if (canned.request)
    decision.request = {
      ...canned.request,
      ...(canned.request.targetAgentId
        ? { targetAgentId: resolveToken(canned.request.targetAgentId, observation, ids) }
        : {}),
    };
  return decision as MockDecision;
}

/**
 * One rule replaying a recorded decision for one career. `match` defaults to "this career" — pass
 * your own to key a recording on state instead (that is how EVT-09's two histories are told apart).
 */
export function scenarioRule(
  key: string,
  career: AgentCareer,
  observation: AgentObservation,
  ids: Record<AgentCareer, string>,
  match?: (observation: AgentObservation) => boolean,
): MockRule {
  const canned = scenarioFixture().decisions[key]?.[career];
  if (!canned) throw new Error('fixture 里没有 ' + key + '/' + career);
  return {
    label: key + '/' + career,
    match: match ?? ((o) => o.self.career === career),
    answer: { kind: 'decision', decision: resolveDecision(canned, observation, ids) },
  };
}

/** Every career the fixture records for one scenario, as rules. Used by EVT-06's four-way split. */
export function scenarioRules(
  key: string,
  observation: AgentObservation,
  ids: Record<AgentCareer, string>,
): MockRule[] {
  const cases = scenarioFixture().decisions[key];
  if (!cases) throw new Error('fixture 里没有 ' + key);
  return (Object.keys(cases) as AgentCareer[]).map((career) =>
    scenarioRule(key, career, observation, ids),
  );
}

/** A rule that makes the provider fail exactly the way a live one could. */
export function failureRule(label: string): MockRule {
  const failure = scenarioFixture().failures[label];
  if (!failure) throw new Error('fixture 里没有失败样本 ' + label);
  const answer: MockAnswer =
    failure.kind === 'decision'
      ? { kind: 'decision', decision: failure.decision }
      : failure.kind === 'error'
        ? { kind: 'error', error: failure.error as ModelError }
        : failure.kind === 'throw'
          ? { kind: 'throw', message: failure.message }
          : { kind: 'text', text: failure.text };
  return { label: 'failure:' + label, answer };
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
