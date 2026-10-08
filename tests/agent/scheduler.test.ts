/**
 * P2.5 the scheduler (docs/lv3/03-test-plan.md §6 `S-1` … `S-11`;
 * docs/lv3/03-api-contract.md §4.6; docs/lv3/07-scheduler-plan.md).
 *
 * Every case here runs against a **fake world** and a **fake clock**, with the real `DecisionRuntime`
 * driven by a stub `ModelClient` (`S-11`). No Electron, no `SimulationEngine`, no network, no
 * wall-clock waiting — so the eleven cases that decide whether the Agent loop is well-behaved are
 * fast, deterministic, and can be run on every commit.
 *
 * The world is a port (`SchedulerWorld`) rather than the engine, which is what makes that possible
 * and what keeps the scheduler's write surface down to a single method the tests can count.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentScheduler, type SchedulerWorld, type ScheduledAgent } from '../../electron/agent/scheduler';
import {
  DecisionRuntime as Runtime,
  scoringAgent,
  type DecisionOutcome,
} from '../../electron/agent/runtime';
import { MockModelClient } from '../../electron/agent/mock-client';
import type { ModelClient, ModelResult } from '../../electron/agent/model-client';
import { loadDecisionSchema, loadPromptTemplates } from '../../electron/agent/prompt';
import { AGENT_PROMPT_VERSION, evaluate } from '../../src/engine/agent/decision';
import type { DecisionBand } from '../../src/engine/agent/score';
import { RULES } from '../../src/engine/definitions/rules';
import type { AgentCareer, AgentObservation, AgentTrigger } from '../../src/engine/types';
import {
  REPO_ROOT,
  agentByCareer,
  agentEngine,
  agentRuntime,
  observationFor,
  recordingSubmitter,
} from './support';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// --- fixtures ----------------------------------------------------------------------------------

/**
 * An observation whose best candidate scores into `band`.
 *
 * Found by probing the real scoring function over a risk/reward grid rather than by guessing at its
 * weights — the point of the test is the scheduler's rule, not the score's shape, and hard-coding a
 * weight-dependent fixture would break every time the score is calibrated.
 */
function observationWithBand(band: DecisionBand, career: AgentCareer = 'explorer'): AgentObservation {
  const engine = agentEngine();
  const agent = agentByCareer(engine, career);
  const base = observationFor(engine, agent.id);
  const template = base.availableActions[0];
  if (!template) throw new Error('this world offers no candidate to probe with');

  // Three levers, because risk/reward alone cannot span the range: the goal-alignment terms carry
  // 0.2 + 0.2 + 0.1 of the weight and are fixed by the career, so an unaligned candidate and a
  // worn-down Agent are what actually reach the low bands.
  const goalKindVariants: (typeof template)['goalKinds'][] = [[], template.goalKinds];
  const stateVariants = [
    base.self.state,
    { ...base.self.state, fatigue: 100, trustInAdmiral: 0, morale: 0 },
  ];

  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (const goalKinds of goalKindVariants)
    for (const state of stateVariants)
      for (let risk = 0; risk <= 100; risk += 5)
        for (let reward = 0; reward <= 100; reward += 5) {
          const observation: AgentObservation = {
            ...base,
            self: { ...base.self, state },
            availableActions: [{ ...template, id: 'probe', risk, reward, goalKinds }],
          };
          const { score, band: found } = evaluate(scoringAgent(observation), observation);
          lowest = Math.min(lowest, score);
          highest = Math.max(highest, score);
          if (found === band) return observation;
        }
  throw new Error(
    'could not construct an observation in band ' + band + ' (scores seen: ' + lowest + ' … ' + highest + ')',
  );
}

interface Seat {
  id: string;
  observation: AgentObservation;
  idle: boolean;
  directive: string | null;
  nextDecisionAt: number;
}

/** A world the scheduler can read and (almost) not write. */
class FakeWorld implements SchedulerWorld {
  clock = 0;
  paused = false;
  active = true;
  seats: Seat[] = [];
  /** Every `writeBeat` call, in order — `S-9` asserts on these. */
  beats: { agentId: string; at: number }[] = [];
  logs: string[] = [];
  /** Which Agents a trigger reaches. Defaults to everyone; override for addressing tests. */
  addressing: (trigger: AgentTrigger) => string[] = () => this.seats.map((seat) => seat.id);

  time(): number {
    return this.clock;
  }
  isPaused(): boolean {
    return this.paused;
  }
  isActive(): boolean {
    return this.active;
  }
  agents(): ScheduledAgent[] {
    return this.seats.map((seat) => ({ id: seat.id, nextDecisionAt: seat.nextDecisionAt }));
  }
  agentsForTrigger(trigger: AgentTrigger): string[] {
    return this.addressing(trigger);
  }
  isIdle(agentId: string): boolean {
    return this.seat(agentId)?.idle ?? false;
  }
  observe(agentId: string): AgentObservation | null {
    return this.seat(agentId)?.observation ?? null;
  }
  currentDirectiveId(agentId: string): string | null {
    return this.seat(agentId)?.directive ?? null;
  }
  writeBeat(agentId: string, at: number): void {
    const seat = this.seat(agentId);
    if (seat) seat.nextDecisionAt = at;
    this.beats.push({ agentId, at });
  }
  log(message: string): void {
    this.logs.push(message);
  }

  seat(agentId: string): Seat | undefined {
    return this.seats.find((candidate) => candidate.id === agentId);
  }
  add(seat: Partial<Seat> & { id: string; observation: AgentObservation }): Seat {
    const full: Seat = { idle: true, directive: null, nextDecisionAt: 0, ...seat };
    this.seats.push(full);
    return full;
  }
}

/** Counts provider calls and answers however the test needs. */
function spyClient(answer?: () => Promise<ModelResult>): { client: ModelClient; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    client: {
      id: 'spy',
      promptVersion: AGENT_PROMPT_VERSION,
      decide: (): Promise<ModelResult> => {
        calls += 1;
        return answer ? answer() : Promise.resolve({ ok: false, error: 'unavailable', latencyMs: 0 });
      },
    },
  };
}

function build(world: FakeWorld, client: ModelClient, options: { callsPerMinute?: number } = {}) {
  const decisions: { agentId: string; outcome: DecisionOutcome }[] = [];
  const scheduler = new AgentScheduler({
    world,
    runtime: agentRuntime(client),
    ...(options.callsPerMinute !== undefined ? { callsPerMinute: options.callsPerMinute } : {}),
    onDecision: (agentId, outcome) => decisions.push({ agentId, outcome }),
  });
  return { scheduler, decisions };
}

const trigger = (kind: AgentTrigger['kind']): AgentTrigger =>
  kind === 'ship-idle'
    ? { kind, shipId: 'ship-1' }
    : kind === 'directive-failed'
      ? { kind, shipId: 'ship-1', directiveId: 'd-1', reason: '被清除' }
      : kind === 'directive-completed'
        ? { kind, shipId: 'ship-1', directiveId: 'd-1' }
        : kind === 'danger'
          ? { kind, contactId: 'c-1' }
          : kind === 'admiral-message'
            ? { kind, messageId: 'm-1' }
            : kind === 'agent-request'
              ? { kind, fromAgentId: 'a-1', toAgentId: 'a-2' }
              : kind === 'world-event'
                ? { kind, eventId: 'e-1' }
                : kind === 'promise-changed'
                  ? { kind, promiseId: 'p-1' }
                  : kind === 'high-value-opportunity'
                    ? { kind, opportunityId: 'o-1' }
                    : { kind, minutes: 15 };

// --- S-1 … S-11 ---------------------------------------------------------------------------------

describe('S-1 at most one in-flight decision per Agent', () => {
  it('does not start a second one while the first is pending', async () => {
    const world = new FakeWorld();
    const engine = agentEngine();
    const explorer = agentByCareer(engine, 'explorer');
    world.add({ id: explorer.id, observation: observationWithBand('reject') });

    let release!: (result: ModelResult) => void;
    const spy = spyClient(() => new Promise<ModelResult>((resolve) => (release = resolve)));
    const { scheduler, decisions } = build(world, spy.client, { callsPerMinute: 5 });

    scheduler.notify([trigger('admiral-message')]);
    scheduler.pump();
    expect(scheduler.inFlightCount()).toBe(1);
    expect(spy.calls()).toBe(1);

    // Later frames, while the first request is still out: the slot is taken, so nothing new starts.
    for (let frame = 0; frame < 5; frame++) {
      world.clock += 1;
      scheduler.pump();
      expect(scheduler.inFlightCount()).toBe(1);
    }
    expect(spy.calls()).toBe(1);

    release({ ok: false, error: 'unavailable', latencyMs: 0 });
    await settle();
    scheduler.pump();
    expect(scheduler.inFlightCount()).toBe(0);
    expect(decisions).toHaveLength(1);
  });
});

describe('S-2 triggers inside a cooldown merge into one marker', () => {
  it('collapses a burst of triggers into exactly one decision', async () => {
    const world = new FakeWorld();
    const engine = agentEngine();
    const explorer = agentByCareer(engine, 'explorer');
    world.add({ id: explorer.id, observation: observationWithBand('reject') });

    const spy = spyClient();
    const { scheduler, decisions } = build(world, spy.client, { callsPerMinute: 5 });

    // First decision, then we are inside its cooldown.
    scheduler.notify([trigger('ship-idle')]);
    scheduler.pump();
    await settle();
    scheduler.pump();
    expect(decisions).toHaveLength(1);
    const beat = world.seat(explorer.id)!.nextDecisionAt;
    expect(beat).toBe(RULES.agentDecisionInterval);

    // Three more triggers arrive during the cooldown.
    world.clock = 1;
    scheduler.notify([trigger('ship-idle'), trigger('directive-completed'), trigger('ship-idle')]);
    scheduler.pump();
    expect(scheduler.queuedCount()).toBe(1); // one marker, not three
    expect(decisions).toHaveLength(1); // and nothing fired yet

    world.clock = beat;
    scheduler.pump();
    await settle();
    scheduler.pump();
    expect(decisions).toHaveLength(2); // merged into a single decision
  });
});

describe('S-3 a low-priority trigger does not reach the model', () => {
  it('answers deterministically when the score is not in the judgement band', async () => {
    const world = new FakeWorld();
    const engine = agentEngine();
    const explorer = agentByCareer(engine, 'explorer');
    const observation = observationWithBand('reject');
    expect(evaluate(scoringAgent(observation), observation).band).toBe('reject'); // precondition
    world.add({ id: explorer.id, observation });

    const spy = spyClient();
    const { scheduler, decisions } = build(world, spy.client);

    scheduler.notify([trigger('ship-idle')]); // low priority
    scheduler.pump();
    await settle();
    scheduler.pump();

    expect(spy.calls()).toBe(0);
    expect(decisions).toHaveLength(1);
    if (decisions[0].outcome.status === 'decided')
      expect(decisions[0].outcome.decision.provider).toBe('deterministic');
  });

  it('does reach the model when a low-priority trigger lands in the judgement band', async () => {
    const world = new FakeWorld();
    const engine = agentEngine();
    const explorer = agentByCareer(engine, 'explorer');
    const observation = observationWithBand('consult-llm');
    world.add({ id: explorer.id, observation });

    const spy = spyClient();
    const { scheduler } = build(world, spy.client);

    scheduler.notify([trigger('ship-idle')]); // low priority, ambiguous score
    scheduler.pump();
    await settle();

    expect(spy.calls()).toBe(1);
  });

  it('a high-priority trigger reaches the model whatever the score says', async () => {
    const world = new FakeWorld();
    const engine = agentEngine();
    const explorer = agentByCareer(engine, 'explorer');
    world.add({ id: explorer.id, observation: observationWithBand('reject') });

    const spy = spyClient();
    const { scheduler } = build(world, spy.client);

    scheduler.notify([trigger('admiral-message')]);
    scheduler.pump();
    await settle();

    expect(spy.calls()).toBe(1);
  });
});

describe('S-4 the per-game-minute model budget', () => {
  it('admits one call a minute and answers the rest deterministically', async () => {
    const world = new FakeWorld();
    const engine = agentEngine();
    const careers: AgentCareer[] = ['explorer', 'scientist'];
    for (const career of careers) {
      const agent = agentByCareer(engine, career);
      world.add({ id: agent.id, observation: observationWithBand('reject', career) });
    }

    const spy = spyClient();
    const { scheduler, decisions } = build(world, spy.client, { callsPerMinute: 1 });

    scheduler.notify([trigger('admiral-message')]); // urgent for both Agents
    scheduler.pump();
    await settle();
    scheduler.pump();

    expect(spy.calls()).toBe(1); // the budget, not the Agent count
    expect(decisions).toHaveLength(2); // and nobody is left without an answer
  });
});

describe('S-5 a paused or inactive world does nothing', () => {
  it('starts no decision while paused', async () => {
    const world = new FakeWorld();
    const engine = agentEngine();
    const explorer = agentByCareer(engine, 'explorer');
    world.add({ id: explorer.id, observation: observationWithBand('reject') });
    world.paused = true;

    const spy = spyClient();
    const { scheduler } = build(world, spy.client);
    scheduler.notify([trigger('admiral-message')]);
    scheduler.pump();

    expect(scheduler.inFlightCount()).toBe(0);
    expect(spy.calls()).toBe(0);
    expect(world.beats).toHaveLength(0);
  });

  it('starts no decision while the world is not active', async () => {
    const world = new FakeWorld();
    const engine = agentEngine();
    const explorer = agentByCareer(engine, 'explorer');
    world.add({ id: explorer.id, observation: observationWithBand('reject') });
    world.active = false;

    const { scheduler } = build(world, spyClient().client);
    scheduler.notify([trigger('admiral-message')]);
    scheduler.pump();
    expect(scheduler.inFlightCount()).toBe(0);
  });
});

describe('S-6 a busy ship is deferred, never retried', () => {
  it('holds the marker until the ship is free', async () => {
    const world = new FakeWorld();
    const engine = agentEngine();
    const explorer = agentByCareer(engine, 'explorer');
    world.add({ id: explorer.id, observation: observationWithBand('reject'), idle: false });

    const spy = spyClient();
    const { scheduler, decisions } = build(world, spy.client);

    scheduler.notify([trigger('admiral-message')]);
    scheduler.pump();
    expect(scheduler.inFlightCount()).toBe(0);
    expect(spy.calls()).toBe(0);
    expect(scheduler.queuedCount()).toBe(1); // the marker survives, so nothing is lost

    world.seat(explorer.id)!.idle = true;
    scheduler.pump();
    await settle();
    scheduler.pump();
    expect(decisions).toHaveLength(1);
  });

  it('does not consult the model while the ship is busy, however long it stays busy', async () => {
    const world = new FakeWorld();
    const engine = agentEngine();
    const explorer = agentByCareer(engine, 'explorer');
    world.add({ id: explorer.id, observation: observationWithBand('consult-llm'), idle: false });

    const spy = spyClient();
    const { scheduler } = build(world, spy.client);
    scheduler.notify([trigger('admiral-message')]);
    for (let frame = 0; frame < 50; frame++) {
      world.clock += 1;
      scheduler.pump();
    }
    expect(spy.calls()).toBe(0);
  });
});

describe('S-7 a failing provider is contained', () => {
  it('does not throw out of pump() when the provider throws', async () => {
    const world = new FakeWorld();
    const engine = agentEngine();
    const explorer = agentByCareer(engine, 'explorer');
    world.add({ id: explorer.id, observation: observationWithBand('reject') });

    const spy = spyClient(() => Promise.reject(new Error('socket hang up')));
    const { scheduler, decisions } = build(world, spy.client);

    scheduler.notify([trigger('admiral-message')]);
    expect(() => scheduler.pump()).not.toThrow();
    await settle();
    expect(() => scheduler.pump()).not.toThrow();

    // The runtime turns the throw into a deterministic answer, so the Agent still decides.
    expect(decisions).toHaveLength(1);
    if (decisions[0].outcome.status === 'decided')
      expect(decisions[0].outcome.decision.provider).toBe('deterministic');
  });

  it('survives a runtime that rejects, and records it rather than dying', async () => {
    const world = new FakeWorld();
    const engine = agentEngine();
    const explorer = agentByCareer(engine, 'explorer');
    world.add({ id: explorer.id, observation: observationWithBand('reject') });

    /** A runtime whose one job is to fail — the scheduler must not depend on it not doing so. */
    class RejectingRuntime extends Runtime {
      override async requestDecision(): Promise<DecisionOutcome> {
        throw new Error('runtime exploded');
      }
    }
    const scheduler = new AgentScheduler({
      world,
      runtime: new RejectingRuntime({
        client: spyClient().client,
        prompts: loadPromptTemplates(REPO_ROOT),
        schema: loadDecisionSchema(REPO_ROOT),
        submitter: { submit: () => ({ ok: false, reason: 'unused' }) },
        messenger: { send: () => ({ ok: false, reason: 'unused' }) },
      }),
    });

    scheduler.notify([trigger('admiral-message')]);
    expect(() => scheduler.pump()).not.toThrow();
    await settle();
    expect(() => scheduler.pump()).not.toThrow();
    expect(world.logs.join('\n')).toContain('runtime exploded');
  });
});

describe('S-8 pump() returns without waiting for the model', () => {
  it('is synchronous even when the provider never resolves', () => {
    const world = new FakeWorld();
    const engine = agentEngine();
    const explorer = agentByCareer(engine, 'explorer');
    world.add({ id: explorer.id, observation: observationWithBand('reject') });

    const spy = spyClient(() => new Promise<ModelResult>(() => {})); // never settles
    const { scheduler } = build(world, spy.client);

    scheduler.notify([trigger('admiral-message')]);
    scheduler.pump();

    // Reaching this line at all is the assertion: an `await` inside pump() would hang the test.
    expect(scheduler.inFlightCount()).toBe(1);
    expect(spy.calls()).toBe(1);
  });
});

describe('S-9 the beat advances only on drain, and by one interval', () => {
  it('writes now + agentDecisionInterval, once, when the decision is drained', async () => {
    const world = new FakeWorld();
    const engine = agentEngine();
    const explorer = agentByCareer(engine, 'explorer');
    world.add({ id: explorer.id, observation: observationWithBand('reject') });
    world.clock = 7;

    const { scheduler } = build(world, spyClient().client);
    scheduler.notify([trigger('ship-idle')]);
    scheduler.pump();
    await settle();

    // Nothing is written while the decision is still in flight.
    expect(world.beats).toHaveLength(0);
    scheduler.pump();
    expect(world.beats).toEqual([{ agentId: explorer.id, at: 7 + RULES.agentDecisionInterval }]);
    expect(world.seat(explorer.id)!.nextDecisionAt).toBe(7 + RULES.agentDecisionInterval);
  });
});

describe('S-10 a restored world does not fire the whole roster at once', () => {
  it('lets only the Agent whose staggered beat is due decide', async () => {
    const world = new FakeWorld();
    const engine = agentEngine();
    const careers: AgentCareer[] = ['explorer', 'scientist', 'tactical', 'logistics'];
    careers.forEach((career, index) => {
      const agent = agentByCareer(engine, career);
      // The shape `data.ts` bootstraps: staggered, so a load cannot fire everyone on one beat.
      world.add({
        id: agent.id,
        observation: observationWithBand('reject', career),
        nextDecisionAt: (index + 1) * 5,
      });
    });

    const { scheduler, decisions } = build(world, spyClient().client, { callsPerMinute: 5 });

    scheduler.pump(); // clock 0: nobody is due
    expect(decisions).toHaveLength(0);
    expect(scheduler.inFlightCount()).toBe(0);

    world.clock = 5; // exactly the first Agent's beat
    scheduler.pump();
    await settle();
    scheduler.pump();
    expect(decisions).toHaveLength(1);
    expect(decisions[0].agentId).toBe(agentByCareer(engine, 'explorer').id);
  });
});

describe('S-11 the scheduler is testable without Electron and without the engine', () => {
  it('imports neither, so this whole file can run on a fake world', () => {
    const source = readFileSync(join(REPO_ROOT, 'electron', 'agent', 'scheduler.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
    // It may not reach for the engine, and it may not reach for the host: the only way in is the
    // `SchedulerWorld` port.
    for (const forbidden of ['SimulationEngine', 'controllerPort', 'submitAction', 'electron/'])
      expect({ forbidden, hit: code.includes(forbidden) }).toEqual({ forbidden, hit: false });
  });
});

describe('C-17 a directive that vanishes without an event is a failure the Agent can act on', () => {
  it('wakes the Agent when its directive disappears silently', async () => {
    const world = new FakeWorld();
    const engine = agentEngine();
    const explorer = agentByCareer(engine, 'explorer');
    world.add({
      id: explorer.id,
      observation: observationWithBand('reject'),
      idle: false,
      directive: 'd-1',
    });

    const spy = spyClient();
    const { scheduler, decisions } = build(world, spy.client, { callsPerMinute: 5 });

    // The directive is observed, and the busy ship means nothing is started.
    scheduler.pump();
    expect(scheduler.inFlightCount()).toBe(0);
    expect(spy.calls()).toBe(0);

    // Now the engine clears it with no completion event (fleet.ts's emergency break-off), and
    // **not a single trigger arrives** — the wake-up has to come from the liveness check alone.
    world.seat(explorer.id)!.directive = null;
    world.seat(explorer.id)!.idle = true;
    scheduler.pump();
    await settle();
    scheduler.pump();

    expect(spy.calls()).toBe(1); // urgent: a lost task is worth the model's time
    expect(decisions).toHaveLength(1);
    if (decisions[0].outcome.status === 'decided')
      expect(decisions[0].outcome.trace.provider).toBe('spy');
  });

  it('does not cry wolf when the directive completed normally', async () => {
    const world = new FakeWorld();
    const engine = agentEngine();
    const explorer = agentByCareer(engine, 'explorer');
    world.add({
      id: explorer.id,
      observation: observationWithBand('reject'),
      idle: false,
      directive: 'd-1',
    });

    const spy = spyClient();
    const { scheduler, decisions } = build(world, spy.client, { callsPerMinute: 5 });
    scheduler.pump();

    world.seat(explorer.id)!.directive = null;
    world.seat(explorer.id)!.idle = true;
    scheduler.notify([trigger('directive-completed')]); // the proper event
    scheduler.pump();
    await settle();
    scheduler.pump();

    expect(decisions).toHaveLength(1); // the completion, not a spurious failure
  });
});

describe('SC-4 a drained decision is applied, and a stale one is not', () => {
  /** A provider that answers with a real `act`, so the flow reaches submission. */
  const actingClient = (): ModelClient =>
    new MockModelClient({
      rules: [
        {
          label: 'act',
          answer: { kind: 'decision', decision: { intent: 'act', choiceId: 'probe', reason: '去做。' } },
        },
      ],
    });

  const worldFor = () => {
    const world = new FakeWorld();
    const engine = agentEngine();
    const explorer = agentByCareer(engine, 'explorer');
    world.add({ id: explorer.id, observation: observationWithBand('reject') });
    return { world, explorer };
  };

  it('submits the decision through the runtime and reports the result', async () => {
    const { world, explorer } = worldFor();
    const recorder = recordingSubmitter({ ok: true, reason: '' });
    const applied: { agentId: string; status: string }[] = [];
    const scheduler = new AgentScheduler({
      world,
      runtime: agentRuntime(actingClient(), undefined, recorder),
      callsPerMinute: 5,
      onApplied: (agentId, submission) => applied.push({ agentId, status: submission.status }),
    });

    scheduler.notify([trigger('admiral-message')]);
    scheduler.pump();
    await settle();
    scheduler.pump();

    expect(recorder.submitted).toHaveLength(1);
    expect(recorder.submitted[0].agentId).toBe(explorer.id);
    expect(applied).toEqual([{ agentId: explorer.id, status: 'submitted' }]);
  });

  it('does not submit an answer that arrived after the world moved on (§4.7)', async () => {
    const { world } = worldFor();
    const recorder = recordingSubmitter({ ok: true, reason: '' });
    const applied: unknown[] = [];
    const scheduler = new AgentScheduler({
      world,
      runtime: agentRuntime(actingClient(), undefined, recorder),
      callsPerMinute: 5,
      onApplied: (_agentId, submission) => applied.push(submission),
    });

    scheduler.notify([trigger('admiral-message')]);
    scheduler.pump();
    await settle();

    // The model took real time. At 16x that is minutes of game time — far past the stale limit —
    // and acting on an answer formed against the old world is the mistake the rule exists to stop.
    world.clock = 100;
    scheduler.pump();

    expect(recorder.submitted).toEqual([]);
    expect(applied).toEqual([]);
    expect(world.logs.join(' ')).toContain('已过期');
  });
});
