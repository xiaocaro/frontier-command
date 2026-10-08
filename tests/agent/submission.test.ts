/**
 * P2.5 applying a decision (docs/lv3/03-api-contract.md §4.7; docs/lv3/07-scheduler-plan.md SC-4).
 *
 * This is the one place an Agent's decision stops being text and becomes a physical act, so it is
 * the one place the rules that keep an Agent from being an authority have to hold:
 *
 *  - it submits **only** an `act`, and resolves the `choiceId` to an option the engine itself
 *    offered, so no target, coordinate or parameter is ever invented (Rule 3 / Rule 6);
 *  - it goes through the Agent's **own** operator port, never the commander's, which is what stops
 *    an Agent from commanding with a player's powers (`N-3`);
 *  - a refusal from the engine is a value, and nothing is executed behind it.
 *
 * The provider is never consulted here — `applyDecision` works on a decision that has already been
 * validated — so every test passes a client that only ever declines.
 */
import { describe, it, expect } from 'vitest';
import { AGENT_PROMPT_VERSION } from '../../src/engine/agent/decision';
import { agentDecisionSchema } from '../../src/engine/agent/schemas';
import type { ModelClient } from '../../electron/agent/model-client';
import type { AgentDecision, AgentObservation } from '../../src/engine/types';
import { issue } from '../helpers';
import {
  agentByCareer,
  agentEngine,
  agentRuntime,
  engineSubmitter,
  observationFor,
  recordingMessenger,
  recordingSubmitter,
} from './support';

/** `applyDecision` never asks a model, so the client exists only to satisfy the runtime. */
const silent = (): ModelClient => ({
  id: 'silent',
  promptVersion: AGENT_PROMPT_VERSION,
  decide: async () => ({ ok: false, error: 'unavailable', latencyMs: 0 }),
});

/** A non-social option — the only kind `intent: 'act'` is allowed to name. */
function actable(observation: AgentObservation): string {
  const candidate = observation.availableActions.find(
    (option) =>
      !['accept', 'reject', 'counteroffer'].includes(option.id) && !option.id.startsWith('team-'),
  );
  if (!candidate) throw new Error('this world offers nothing an act may choose');
  return candidate.id;
}

const decisionFor = (observation: AgentObservation, fields: Partial<AgentDecision>): AgentDecision => {
  const decision = {
    intent: 'wait',
    reason: '测试',
    promptVersion: AGENT_PROMPT_VERSION,
    observationTick: observation.tick,
    provider: 'llm',
    ...fields,
  } as AgentDecision;
  // Guard the fixture itself: a malformed decision would make the assertions below meaningless.
  expect(agentDecisionSchema.safeParse(decision).success).toBe(true);
  return decision;
};

const setup = () => {
  const engine = agentEngine();
  const explorer = agentByCareer(engine, 'explorer');
  const observation = observationFor(engine, explorer.id);
  const operator = engine.state.operators.find((o) => o.agentId === explorer.id)!;
  const shipId = engine.state.assignments.find((a) => a.operatorId === operator.id)!.shipId;
  const ship = (): (typeof engine.state.ships)[number] => engine.state.ships.find((s) => s.id === shipId)!;
  return { engine, explorer, observation, shipId, ship };
};

describe('only an act is submitted, and only from the menu', () => {
  it('submits an act and the ship really takes the directive', () => {
    const { engine, observation, ship } = setup();
    const choiceId = actable(observation);
    const runtime = agentRuntime(silent(), undefined, engineSubmitter(engine));

    const outcome = runtime.applyDecision(
      observation,
      decisionFor(observation, { intent: 'act', choiceId }),
    );

    expect(outcome).toEqual({ status: 'submitted', choiceId });
    expect(ship().current).not.toBeNull();
  });

  it('submits the engine’s own Action, not one assembled from the decision', () => {
    const { observation } = setup();
    const choiceId = actable(observation);
    const recorder = recordingSubmitter();
    agentRuntime(silent(), undefined, recorder).applyDecision(
      observation,
      decisionFor(observation, { intent: 'act', choiceId }),
    );

    // The Action handed over is byte-for-byte the candidate's. That is the whole point of choosing
    // by id rather than by parameter (Rule 3) — there is no field of the decision that reaches the
    // engine except the id.
    const expected = observation.availableActions.find((option) => option.id === choiceId)!.action;
    expect(recorder.submitted).toHaveLength(1);
    expect(recorder.submitted[0].action).toEqual(expected);
  });

  it('never submits a non-act as a ship order, and says what can be said', () => {
    const { engine, observation } = setup();
    const recorder = recordingSubmitter();
    const messenger = recordingMessenger();
    const runtime = agentRuntime(silent(), undefined, recorder, messenger);
    const before = JSON.stringify(engine.state);

    for (const intent of ['wait', 'rest', 'quit'] as const)
      expect(runtime.applyDecision(observation, decisionFor(observation, { intent }))).toEqual({
        status: 'not-an-action',
        intent,
      });
    // A social option is speech, not a ship order — it must not be dressed up as one (P1 §5.1).
    // Since P3 it must also actually be *said*: before P3 a counteroffer evaporated into
    // `not-an-action` and nobody ever heard it.
    expect(
      runtime.applyDecision(
        observation,
        decisionFor(observation, { intent: 'respond', choiceId: 'accept' }),
      ),
    ).toEqual({ status: 'replied', to: 'admiral', kind: 'report' });

    expect(recorder.submitted).toEqual([]);
    expect(messenger.said).toHaveLength(1);
    expect(messenger.said[0]).toMatchObject({ to: 'admiral', kind: 'report' });
    // The world is untouched: the scaffold messenger is what was reached, never the engine.
    expect(JSON.stringify(engine.state)).toBe(before);
  });

  it('refuses a choiceId that is not on the menu instead of guessing one', () => {
    const { observation } = setup();
    const recorder = recordingSubmitter();

    // Unreachable after validation, which is exactly why it must be a value rather than a throw.
    expect(
      agentRuntime(silent(), undefined, recorder).applyDecision(
        observation,
        decisionFor(observation, { intent: 'act', choiceId: 'explore:99/99' }),
      ),
    ).toEqual({ status: 'unresolved', choiceId: 'explore:99/99' });
    expect(recorder.submitted).toEqual([]);
  });
});

describe('the engine keeps the last word', () => {
  it('reports a refusal and executes nothing when the ship is already busy', () => {
    const { engine, observation, ship } = setup();
    const runtime = agentRuntime(silent(), undefined, engineSubmitter(engine));
    const choiceId = actable(observation);

    // The first one lands, and it lands as the Agent's own directive...
    expect(
      runtime.applyDecision(observation, decisionFor(observation, { intent: 'act', choiceId })),
    ).toEqual({ status: 'submitted', choiceId });
    const busy = ship().current;

    // ...so the second is refused by the engine's busy rule, and changes nothing.
    const outcome = runtime.applyDecision(
      observation,
      decisionFor(observation, { intent: 'act', choiceId }),
    );
    expect(outcome.status).toBe('declined');
    if (outcome.status === 'declined') expect(outcome.reason).toContain('正在完成既有行动');
    expect(ship().current).toBe(busy);
  });

  it('defers to an Admiral directive above anything an Agent wants', () => {
    const { engine, observation, shipId, ship } = setup();
    issue(engine, { type: 'EXPLORE', sector: { q: 0, r: -1 }, approach: 'remote' }, shipId);
    const admiral = ship().current;

    const outcome = agentRuntime(silent(), undefined, engineSubmitter(engine)).applyDecision(
      observation,
      decisionFor(observation, { intent: 'act', choiceId: actable(observation) }),
    );

    // A clear Admiral order outranks a Standing Order — and an Agent's decision is a Standing Order
    // (AGENTS.md: 明确的 Admiral 命令优先于 Standing Orders).
    expect(outcome.status).toBe('declined');
    if (outcome.status === 'declined') expect(outcome.reason).toContain('Admiral');
    expect(ship().current).toBe(admiral);
  });

  it('acts as the Agent, never as the commander (N-3)', () => {
    const { engine, observation, ship } = setup();
    agentRuntime(silent(), undefined, engineSubmitter(engine)).applyDecision(
      observation,
      decisionFor(observation, { intent: 'act', choiceId: actable(observation) }),
    );

    // `command-system` stamps `'admiral'` only when the actor is the commander. `'standing'` here
    // is the proof that the submission carried the Agent's own operator id.
    expect(ship().current!.source).toBe('standing');
  });
});
