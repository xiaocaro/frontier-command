/**
 * P2.5 `AgentTrigger` emission (docs/lv3/02-domain-model.md §14; docs/lv3/CODEX_TASKS.md P1-05;
 * `KNOWN_ISSUES.md` `C-16`).
 *
 * The triggers are how an Agent learns that something happened without the engine ever calling a
 * model. Two properties are being defended, and the second is the one that is easy to get wrong:
 *
 *  1. the right trigger comes out of the right branch, exactly once; and
 *  2. **none of it enters `WorldState`.** The triggers ride the transient `pendingEvents` channel,
 *     so a world driven by the same seed and the same commands still replays field-for-field. If
 *     anyone ever moves this channel into `state`, the replay assertion in
 *     `tests/architecture.test.ts` fails — and that assertion is the reason this design was chosen.
 */
import { describe, it, expect } from 'vitest';
import { quietEngine, issue } from '../helpers';
import { makeEnemy } from '../../src/engine/data';
import { createWorld } from '../../src/engine/data';
import { createEvent } from '../../src/engine/world-events';
import { SimulationEngine } from '../../src/engine/engine';
import type { AgentTrigger, SimulationEvent } from '../../src/engine/types';

/** Every trigger the engine emits over `ticks` steps, in order. */
function collect(engine: SimulationEngine, ticks: number): AgentTrigger[] {
  const triggers: AgentTrigger[] = [];
  for (let i = 0; i < ticks; i++) {
    engine.dispatchCommand({ type: 'pause', paused: false });
    for (const event of engine.step() as SimulationEvent[])
      if (event.type === 'agentTrigger') triggers.push(event.trigger);
  }
  return triggers;
}

const kinds = (triggers: AgentTrigger[]): string[] => triggers.map((trigger) => trigger.kind);

describe('a directive that ends tells its ship’s Agent', () => {
  it('emits directive-completed exactly once when a directive finishes on its own', () => {
    const engine = quietEngine();
    const ship = engine.state.ships.find((candidate) => candidate.id === 'verity')!;
    issue(engine, { type: 'EXPLORE', sector: { q: 0, r: -1 }, approach: 'remote' }, ship.id);

    // The completion happens *during* the run, so the events have to be collected as they come —
    // stepping and then looking afterwards would find an already-drained channel.
    const triggers: AgentTrigger[] = [];
    for (let i = 0; i < 6_000 && ship.current !== null; i++) {
      engine.dispatchCommand({ type: 'pause', paused: false });
      for (const event of engine.step() as SimulationEvent[])
        if (event.type === 'agentTrigger') triggers.push(event.trigger);
    }

    expect(ship.current).toBeNull(); // it really did finish
    const completed = triggers.filter((trigger) => trigger.kind === 'directive-completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toEqual({
      kind: 'directive-completed',
      shipId: ship.id,
      directiveId: expect.any(String),
    });
    // The ship was left with nothing queued, so it also went idle.
    expect(kinds(triggers)).toContain('ship-idle');
  });

  it('emits directive-failed with the reason when a directive fails', () => {
    const engine = quietEngine();
    const ship = engine.state.ships.find((candidate) => candidate.id === 'verity')!;
    issue(engine, { type: 'EXPLORE', sector: { q: 0, r: -1 }, approach: 'remote' }, ship.id);

    engine.complete(ship, '目标失效', true); // the engine's own failure exit
    const triggers = collect(engine, 1);

    expect(triggers).toContainEqual({
      kind: 'directive-failed',
      shipId: ship.id,
      directiveId: expect.any(String),
      reason: '目标失效',
    });
  });

  it('emits ship-idle when a directive ends with nothing queued behind it', () => {
    const engine = quietEngine();
    const ship = engine.state.ships.find((candidate) => candidate.id === 'verity')!;
    issue(engine, { type: 'EXPLORE', sector: { q: 0, r: -1 }, approach: 'remote' }, ship.id);

    engine.complete(ship, '完成');
    expect(kinds(collect(engine, 1))).toContain('ship-idle');
  });
});

describe('world events and messages emit their own triggers', () => {
  it('emits world-event when an event is created, once', () => {
    const engine = quietEngine();
    const created = createEvent(engine, 'distress', 'ship-9', '收到求救信号');
    const triggers = collect(engine, 1);

    expect(triggers).toContainEqual({ kind: 'world-event', eventId: created.id });
    // Re-creating the same live event returns the existing one rather than minting a new one, so it
    // must not emit a second trigger *for that event*. Scoped by id on purpose: the engine's own
    // `advanceEvents` may legitimately create other events during these steps.
    createEvent(engine, 'distress', 'ship-9', '收到求救信号');
    const forThatEvent = collect(engine, 1).filter(
      (trigger) => trigger.kind === 'world-event' && trigger.eventId === created.id,
    );
    expect(forThatEvent).toHaveLength(0);
  });

  it('emits admiral-message when the Admiral writes to an Agent', () => {
    const engine = quietEngine();
    const agent = engine.state.agents[0];
    const result = engine.dispatchCommand({
      type: 'agentMessage',
      from: 'admiral',
      to: agent.id,
      kind: 'command',
      text: '穿越虫洞。',
      payload: null,
    });

    expect(result.ok).toBe(true);
    expect(kinds(collect(engine, 1))).toContain('admiral-message');
  });

  it('emits agent-request when an Agent writes to another Agent', () => {
    const engine = quietEngine();
    const [first, second] = engine.state.agents;
    const result = engine.dispatchCommand({
      type: 'agentMessage',
      from: first.id,
      to: second.id,
      kind: 'team-request',
      text: '我需要护航。',
      payload: { requestingAgentId: first.id, accept: false },
    });

    expect(result.ok).toBe(true);
    const triggers = collect(engine, 1);
    expect(triggers).toContainEqual({
      kind: 'agent-request',
      fromAgentId: first.id,
      toAgentId: second.id,
    });
    expect(kinds(triggers)).not.toContain('admiral-message');
  });

  it('emits danger when sensors pick up a new contact', () => {
    const engine = quietEngine();
    engine.state.enemies = [
      makeEnemy('contact-a', 'raider', 'orion', { x: engine.base.x + 100, y: engine.base.y }),
    ];
    engine.state.enemies.forEach((enemy) => {
      enemy.nextDecision = 1e9;
      enemy.photon = 0;
    });

    const triggers = collect(engine, 10);
    expect(triggers.some((trigger) => trigger.kind === 'danger')).toBe(true);
  });

  it('emits nothing for a message addressed to the Admiral', () => {
    const engine = quietEngine();
    const agent = engine.state.agents[0];
    engine.dispatchCommand({
      type: 'agentMessage',
      from: agent.id,
      to: 'admiral',
      kind: 'ask',
      text: '请求指示。',
      payload: null,
    });
    expect(kinds(collect(engine, 1))).toEqual([]);
  });
});

describe('C-16 triggers never enter WorldState', () => {
  it('leaves two identically-driven worlds equal field for field', () => {
    const drive = (): SimulationEngine => {
      const engine = new SimulationEngine(createWorld(236807));
      issue(engine, { type: 'EXPLORE', sector: { q: 0, r: -1 }, approach: 'remote' });
      const agent = engine.state.agents[0];
      engine.dispatchCommand({
        type: 'agentMessage',
        from: 'admiral',
        to: agent.id,
        kind: 'command',
        text: '穿越虫洞。',
        payload: null,
      });
      for (let i = 0; i < 400; i++) {
        engine.dispatchCommand({ type: 'pause', paused: false });
        engine.step();
      }
      return engine;
    };

    const first = drive();
    const second = drive();
    // The load-bearing assertion: emission must not have changed the world at all.
    expect(first.state).toEqual(second.state);
  });

  it('keeps the trigger channel out of a save', () => {
    const engine = quietEngine();
    const ship = engine.state.ships.find((candidate) => candidate.id === 'verity')!;
    issue(engine, { type: 'EXPLORE', sector: { q: 0, r: -1 }, approach: 'remote' }, ship.id);
    engine.complete(ship, '完成');

    // A trigger is sitting in the transient channel right now...
    expect(engine.pendingEvents.length).toBeGreaterThan(0);
    // ...and the serialised world knows nothing about it.
    expect(JSON.stringify(engine.state)).not.toContain('agentTrigger');
  });
});
