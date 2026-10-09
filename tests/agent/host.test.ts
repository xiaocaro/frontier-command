/**
 * P2.5 the host bridge (docs/lv3/07-scheduler-plan.md §4.2/§13.5).
 *
 * `electron/agent-host.ts` is the one module that knows both the engine and the Agent layer, so it
 * is where the two things that could silently go wrong live:
 *
 *  1. **Addressing.** A trigger says what happened, never to whom. Getting a `shipId` or a
 *     `messageId` to the right `agentId` is a lookup, and a wrong lookup is invisible — the Agent
 *     simply never hears about the thing that happened to it.
 *  2. **The read window.** The scheduler is handed a narrow port. Everything it can see is stated
 *     here, and so is the single field it can write.
 *
 * Driven against a real `SimulationEngine`: the addressing is the engine's own binding rules, so a
 * hand-built fake would be testing the fake.
 */
import { describe, it, expect, vi } from 'vitest';
import { AgentHost, agentsForTrigger, agentTriggersOf, schedulerWorld } from '../../electron/agent-host';
import { quietEngine, issue } from '../helpers';
import { makeEnemy } from '../../src/engine/data';
import type { AgentTrigger, SimulationEvent } from '../../src/engine/types';
import { REPO_ROOT } from './support';

const agentForShip = (engine: ReturnType<typeof quietEngine>, shipId: string): string => {
  const assignment = engine.state.assignments.find((a) => a.shipId === shipId);
  const operator = engine.state.operators.find((o) => o.id === assignment?.operatorId);
  if (!operator?.agentId) throw new Error('no Agent commands ' + shipId);
  return operator.agentId;
};

const shipForAgent = (engine: ReturnType<typeof quietEngine>, agentId: string): string => {
  const operator = engine.state.operators.find((o) => o.agentId === agentId);
  const assignment = engine.state.assignments.find((a) => a.operatorId === operator?.id);
  if (!assignment) throw new Error('no ship bound to ' + agentId);
  return assignment.shipId;
};

describe('addressing: a trigger becomes the Agents it concerns', () => {
  it('routes ship-scoped triggers to the Agent commanding that ship', () => {
    const engine = quietEngine();
    const [first, second] = engine.state.agents;
    const ship = shipForAgent(engine, first.id);

    expect(agentsForTrigger(engine.state, { kind: 'ship-idle', shipId: ship })).toEqual([first.id]);
    expect(
      agentsForTrigger(engine.state, { kind: 'directive-completed', shipId: ship, directiveId: 'd-1' }),
    ).toEqual([first.id]);
    expect(
      agentsForTrigger(engine.state, {
        kind: 'directive-failed',
        shipId: ship,
        directiveId: 'd-1',
        reason: 'x',
      }),
    ).toEqual([first.id]);
    expect(agentsForTrigger(engine.state, { kind: 'ship-idle', shipId: ship })).not.toContain(second.id);
  });

  it('routes an admiral-message to the Agent it was addressed to', () => {
    const engine = quietEngine();
    const [, second] = engine.state.agents;
    engine.dispatchCommand({
      type: 'agentMessage',
      from: 'admiral',
      to: second.id,
      kind: 'command',
      text: '去虫洞。',
      payload: null,
    });
    const message = engine.state.agentMessages.at(-1)!;

    expect(agentsForTrigger(engine.state, { kind: 'admiral-message', messageId: message.id })).toEqual([
      second.id,
    ]);
  });

  it('routes an agent-request to the recipient, not the sender', () => {
    const engine = quietEngine();
    const [first, second] = engine.state.agents;
    // The whole reason `toAgentId` was added (KNOWN_ISSUES C-30): §3.3 has the *recipient* decide.
    expect(
      agentsForTrigger(engine.state, {
        kind: 'agent-request',
        fromAgentId: first.id,
        toAgentId: second.id,
      }),
    ).toEqual([second.id]);
  });

  it('broadcasts world-scoped triggers to every Agent', () => {
    const engine = quietEngine();
    const everyone = engine.state.agents.map((agent) => agent.id);
    expect(agentsForTrigger(engine.state, { kind: 'danger', contactId: 'c-1' })).toEqual(everyone);
    expect(agentsForTrigger(engine.state, { kind: 'world-event', eventId: 'e-1' })).toEqual(everyone);
  });

  it('resolves a ship the rules fly — not an Agent — to nobody', () => {
    const engine = quietEngine();
    const unbound = engine.state.ships.find(
      (ship) => !engine.state.assignments.some((a) => a.shipId === ship.id),
    );
    if (!unbound) return; // every ship is crewed in this world; nothing to assert
    expect(agentsForTrigger(engine.state, { kind: 'ship-idle', shipId: unbound.id })).toEqual([]);
  });

  it('drops a message id that no longer exists rather than guessing', () => {
    const engine = quietEngine();
    expect(agentsForTrigger(engine.state, { kind: 'admiral-message', messageId: 'gone' })).toEqual([]);
  });

  it('extracts only the trigger events from a frame', () => {
    const events = [
      { type: 'dayBoundary', day: 1, tick: 10, time: 1 },
      { type: 'agentTrigger', trigger: { kind: 'ship-idle', shipId: 's-1' } },
    ] as SimulationEvent[];
    expect(agentTriggersOf(events)).toEqual([{ kind: 'ship-idle', shipId: 's-1' }]);
  });
});

describe('the read window the scheduler is handed', () => {
  it('reports an idle ship as idle and a working one as busy', () => {
    const engine = quietEngine();
    const agent = engine.state.agents[0];
    const ship = shipForAgent(engine, agent.id);
    const world = schedulerWorld(engine);

    engine.state.ships.find((s) => s.id === ship)!.status = 'idle';
    expect(world.isIdle(agent.id)).toBe(true);

    issue(engine, { type: 'EXPLORE', sector: { q: 0, r: -1 }, approach: 'remote' }, ship);
    expect(world.isIdle(agent.id)).toBe(false);
    expect(world.currentDirectiveId(agent.id)).not.toBeNull();
  });

  it('gives the Agent its own observation, and gives nobody else one', () => {
    const engine = quietEngine();
    const agent = engine.state.agents[0];
    const world = schedulerWorld(engine);
    const observation = world.observe(agent.id);
    expect(observation?.agentId).toBe(agent.id);
    expect(world.observe('agent-does-not-exist')).toBeNull();
  });

  it('mirrors pause and status without inventing them', () => {
    const engine = quietEngine();
    const world = schedulerWorld(engine);
    expect(world.isActive()).toBe(engine.state.status === 'active');
    engine.state.paused = true;
    expect(world.isPaused()).toBe(true);
  });

  it('writes the beat onto the Agent record — the one field, and nothing else', () => {
    const engine = quietEngine();
    const agent = engine.state.agents[0];
    const world = schedulerWorld(engine);
    const before = structuredClone(engine.state);

    world.writeBeat(agent.id, 42);
    expect(engine.state.agents.find((a) => a.id === agent.id)!.nextDecisionAt).toBe(42);
    // Everything else is untouched: this is the scheduler's whole write surface.
    expect({ ...engine.state, agents: engine.state.agents.map((a) => ({ ...a, nextDecisionAt: 0 })) }).toEqual({
      ...before,
      agents: before.agents.map((a) => ({ ...a, nextDecisionAt: 0 })),
    });
  });
});

describe('assembly puts the right provider behind the runtime', () => {
  it('announces which provider mode it is in, and never prints the key', () => {
    // Both modes produce valid decisions and look identical from inside the game, which is how a
    // stage went by with the model contributing nothing while every test stayed green (C-33).
    // `console.error` because stdout from an Electron main process is not delivered to the launching
    // console on Windows — see the note at the emit site.
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });
    const SECRET = 'sk-live-SECRET-abcdef';
    try {
      new AgentHost(quietEngine(), { root: REPO_ROOT, env: {} });
      expect(lines.join('\n')).toContain('确定性模式');

      lines.length = 0;
      new AgentHost(quietEngine(), {
        root: REPO_ROOT,
        env: { DEEPSEEK_API_KEY: SECRET, DEEPSEEK_MODEL: 'deepseek-chat' },
      });
      const said = lines.join('\n');
      expect(said).toContain('模型已配置');
      expect(said).toContain('deepseek-chat');
      // `describeDeepSeekConfig` reduces the key to a boolean, so a startup line cannot leak it.
      expect(said).not.toContain(SECRET);
    } finally {
      spy.mockRestore();
    }
  });

  it('counts what the loop did, and reports it as a snapshot (C-36)', async () => {
    // `dropped` is the number this exists for: it used to be a log line nothing renders. The scheduler
    // test pins that a drop is counted; this pins that the host forwards it and does not hand out a
    // live handle the renderer could mutate.
    const engine = quietEngine();
    const host = new AgentHost(engine, { root: REPO_ROOT, env: {} });
    const agent = engine.state.agents[0];
    agent.nextDecisionAt = 0; // bring the beat due
    engine.state.paused = false;

    expect(host.stats()).toEqual({ decisions: 0, modelCalls: 0, dropped: 0, lastDrop: null });

    host.frame([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    host.frame([]);

    expect(host.stats().decisions).toBe(1);
    expect(host.stats().dropped).toBe(0);

    const taken = host.stats();
    taken.decisions = 999;
    expect(host.stats().decisions).toBe(1);
  });

  it('runs deterministically with no key, but still decides', async () => {
    const engine = quietEngine();
    const host = new AgentHost(engine, { root: REPO_ROOT, env: {} });
    const agent = engine.state.agents[0];
    agent.nextDecisionAt = 0; // bring the beat due so no trigger is needed
    engine.state.paused = false; // a loaded world starts paused; the scheduler is silent while it is

    host.frame([]); // starts a decision; the offline client declines, the runtime falls back
    await new Promise((resolve) => setTimeout(resolve, 0));
    host.frame([]); // drains it

    // The beat advanced, which only happens when a decision was actually produced and drained. A
    // missing API key must mean "no model", never "no Agent loop".
    expect(agent.nextDecisionAt).toBe(engine.state.time + 15);
  });

  it('survives a root with no prompts rather than refusing to start', () => {
    // Construction is the only thing that can throw here; the host guards it.
    expect(() => new AgentHost(quietEngine(), { root: 'no/such/root', env: {} })).toThrow();
  });

  it('never throws out of frame(), even with a hostile world', () => {
    const engine = quietEngine();
    engine.state.enemies = [
      makeEnemy('contact-a', 'raider', 'orion', { x: engine.base.x + 100, y: engine.base.y }),
    ];
    const host = new AgentHost(engine, { root: REPO_ROOT, env: {} });
    engine.dispatchCommand({ type: 'pause', paused: false });
    for (let i = 0; i < 40; i++) {
      const events = engine.advanceFrame();
      expect(() => host.frame(events)).not.toThrow();
    }
  });
});

describe('the host announces an answer to the Admiral — and only that', () => {
  it('fires once for the answer, and not for the Admiral’s own line', async () => {
    // This is the signal the host holds the world on (`electron/read-hold.ts`). It has to be exact:
    // firing on the Admiral's own message would freeze the game every time the player typed, and
    // firing on a refusal would freeze it for something that was never written down.
    const engine = quietEngine();
    const onSpoke = vi.fn();
    const host = new AgentHost(engine, { root: REPO_ROOT, env: {}, onSpoke });
    const agent = engine.state.agents[0];
    expect(
      engine.dispatchCommand({
        type: 'agentMessage',
        from: 'admiral',
        to: agent.id,
        kind: 'command',
        text: '穿越虫洞，寻找失联探测船。',
        payload: null,
      }).ok,
    ).toBe(true);
    // The Admiral speaking is not an Agent speaking.
    expect(onSpoke).not.toHaveBeenCalled();

    // The production-shaped recipe from `vertical-slice.test.ts`: `frame()` never awaits the decision
    // (CLAUDE.md §2.4), so the microtask queue has to run before the next `pump()` can drain it.
    for (let i = 0; i < 200; i++) {
      engine.dispatchCommand({ type: 'pause', paused: false });
      host.frame(engine.step());
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (engine.state.agentMessages.some((message) => message.from === agent.id)) break;
    }

    const answers = engine.state.agentMessages.filter(
      (message) => message.from !== 'admiral' && message.to === 'admiral',
    );
    expect(answers).toHaveLength(1);
    // Exactly one fire per line the Admiral can actually read — the gate is `ok && to === 'admiral'`,
    // not "an Agent did something".
    expect(onSpoke).toHaveBeenCalledTimes(answers.length);
  });
});
