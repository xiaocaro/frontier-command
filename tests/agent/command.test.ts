/**
 * P0 `agentMessage` command (docs/lv3/03-test-plan.md §4, DEC-19 … DEC-20).
 *
 * Agent social writes must travel the same road as every other world change — through a structured
 * Command, validated by `validate`, dispatched by `dispatchCommand` (CLAUDE.md §2.1). The whole
 * point of the single permission relaxation is that it must be exactly as wide as "an Agent may
 * speak as itself", so the negative cases matter more than the positive one.
 */
import { describe, it, expect } from 'vitest';
import { commandSchema } from '../../src/engine/commands';
import { worldSchema } from '../../src/engine/save-schema';
import { agentByCareer, agentEngine, observationFor } from './support';
import { AGENT_MESSAGE_CAP } from '../../src/engine/agent/interactions';
import type { Command, CommandResult, WorldState } from '../../src/engine/types';

type Message = Extract<Command, { type: 'agentMessage' }>;

const message = (over: Partial<Message> = {}): Message => ({
  type: 'agentMessage',
  from: 'admiral',
  to: 'agent-1',
  kind: 'command',
  text: '前往未知空域调查异常信号。',
  payload: null,
  ...over,
});

const send = (
  engine: ReturnType<typeof agentEngine>,
  input: Command,
  actorId?: string,
): CommandResult =>
  actorId === undefined
    ? engine.dispatchCommand(input)
    : engine.dispatchCommand(input, actorId);

const lastCommunication = (state: WorldState) => state.communications.at(-1)!;

describe('DEC-19 the permission gate', () => {
  it('lets the Admiral speak, through the renderer path (no actorId)', () => {
    const engine = agentEngine();
    const result = send(engine, message());
    expect(result.ok).toBe(true);
    expect(engine.state.agentMessages).toHaveLength(1);
    expect(engine.state.agentMessages[0].from).toBe('admiral');
    expect(engine.state.agentMessages[0].read).toBe(false);
  });

  it('lets an Agent speak as itself', () => {
    const engine = agentEngine();
    const agent = agentByCareer(engine, 'tactical');
    const result = send(
      engine,
      message({ from: agent.id, to: 'admiral', kind: 'report', text: '就位。' }),
      agent.id,
    );
    expect(result.ok).toBe(true);
    expect(engine.state.agentMessages.at(-1)!.from).toBe(agent.id);
  });

  it('refuses an Agent speaking under another Agent name', () => {
    const engine = agentEngine();
    const tactical = agentByCareer(engine, 'tactical');
    const explorer = agentByCareer(engine, 'explorer');
    const result = send(
      engine,
      message({ from: explorer.id, to: 'admiral', kind: 'report', text: '我是薇拉。' }),
      tactical.id,
    );
    expect(result.ok).toBe(false);
    expect(engine.state.agentMessages).toEqual([]);
  });

  it('refuses an Agent speaking as the Admiral', () => {
    const engine = agentEngine();
    const agent = agentByCareer(engine, 'tactical');
    for (const to of ['admiral', 'agent-2'] as const) {
      expect(send(engine, message({ from: 'admiral', to }), agent.id).ok).toBe(false);
    }
    expect(engine.state.agentMessages).toEqual([]);
  });

  it('refuses unknown participants and self-addressed messages', () => {
    const engine = agentEngine();
    expect(send(engine, message({ to: 'agent-99' })).ok).toBe(false);
    expect(send(engine, message({ from: 'agent-99', to: 'agent-1' })).ok).toBe(false);
    expect(send(engine, message({ to: 'agent-1', from: 'agent-1' })).ok).toBe(false);
    expect(engine.state.agentMessages).toEqual([]);
  });

  it('requires a payload key, nullable but present', () => {
    const engine = agentEngine();
    const { payload: _omitted, ...withoutPayload } = message();
    expect(commandSchema.safeParse(withoutPayload).success).toBe(false);
    expect(send(engine, withoutPayload as Command).ok).toBe(false);
    expect(engine.state.agentMessages).toEqual([]);
  });
});

describe('DEC-20 dispatch writes the world and the existing communication feed', () => {
  it('mirrors Agent speech into the existing Communication stream (UI stays unchanged)', () => {
    const engine = agentEngine();
    const before = engine.state.communications.length;
    expect(send(engine, message({ text: '去调查那个信号。' })).ok).toBe(true);
    expect(engine.state.communications.length).toBe(before + 1);
    const communication = lastCommunication(engine.state);
    expect(communication.text).toContain('去调查那个信号。');
    expect(communication.category).toBe('decision');
    expect(communication.read).toBe(false);
  });

  it('names the speaker and the listener in the feed', () => {
    const engine = agentEngine();
    const agent = agentByCareer(engine, 'explorer');
    send(engine, message({ to: agent.id, text: '指令正文' }));
    expect(lastCommunication(engine.state).text).toContain(agent.name);
    send(engine, message({ from: agent.id, to: 'admiral', kind: 'report', text: '回复正文' }), agent.id);
    expect(lastCommunication(engine.state).text).toContain(agent.name);
  });

  it('records an interaction for a real interaction kind and none for a plain report', () => {
    const engine = agentEngine();
    send(engine, message({ kind: 'ask', text: '你为什么拒绝？' }));
    expect(engine.state.agentInteractions).toHaveLength(1);
    expect(engine.state.agentInteractions[0].outcome).toBe('pending');
    expect(engine.state.agentInteractions[0].messageId).toBe(engine.state.agentMessages[0].id);
    send(engine, message({ kind: 'report', text: '一切正常。' }));
    expect(engine.state.agentInteractions).toHaveLength(1);
    // Nothing addressed to the Admiral records an interaction.
    expect(engine.state.agentInteractions.every((i) => i.targetAgentId === 'agent-1')).toBe(true);
  });

  it('keeps every written record inside the save contract', () => {
    const engine = agentEngine();
    send(engine, message({ kind: 'negotiate', text: '我需要护航。' }));
    send(engine, message({ kind: 'promise', text: '给你 Deep Scan。', payload: { promiseId: 'promise-1' } }));
    expect(worldSchema.safeParse(engine.state).success).toBe(true);
  });

  it('makes the message visible to the recipient observation', () => {
    const engine = agentEngine();
    send(engine, message({ text: '新的任务。' }));
    expect(observationFor(engine, 'agent-1').pendingMessages.map((m) => m.text)).toEqual([
      '新的任务。',
    ]);
  });

  it('bounds the message log deterministically, dropping read messages first', () => {
    const engine = agentEngine();
    for (let i = 0; i < AGENT_MESSAGE_CAP; i++)
      send(engine, message({ kind: 'report', text: 'r' + i }));

    engine.state.agentMessages[0].read = true;
    engine.state.agentMessages[1].read = true;
    const oldestUnread = engine.state.agentMessages[2].id;
    send(engine, message({ kind: 'report', text: 'overflow' }));

    expect(engine.state.agentMessages).toHaveLength(AGENT_MESSAGE_CAP);
    // Only as many entries as needed go, and the already-read ones go first.
    expect(engine.state.agentMessages.some((m) => m.text === 'r0')).toBe(false);
    expect(engine.state.agentMessages.some((m) => m.text === 'r1')).toBe(true);
    expect(engine.state.agentMessages.some((m) => m.id === oldestUnread)).toBe(true);
    expect(engine.state.agentMessages.at(-1)!.text).toBe('overflow');
  });
});

describe('Override: the instruction forces, the message charges', () => {
  it('applies exactly trust -10, morale -5, stress +10 and remembers it', () => {
    const engine = agentEngine();
    const agent = agentByCareer(engine, 'explorer');
    const before = { ...agent.state };
    const result = send(
      engine,
      message({
        kind: 'override',
        text: '你必须继续执行。',
        payload: { directiveActionType: 'TRANSIT' },
      }),
    );
    expect(result.ok).toBe(true);
    const after = engine.state.agents.find((a) => a.id === agent.id)!;
    expect(after.state.trustInAdmiral).toBe(before.trustInAdmiral - 10);
    expect(after.state.morale).toBe(before.morale - 5);
    expect(after.state.stress).toBe(before.stress + 10);
    expect(after.state.loyaltyToCompany).toBe(before.loyaltyToCompany);

    const interaction = engine.state.agentInteractions.at(-1)!;
    expect(interaction.outcome).toBe('forced');
    expect(interaction.kind).toBe('override');
    expect(interaction.actorId).toBe('admiral');
    expect(interaction.effects.trustInAdmiral).toBe(-10);
    expect(interaction.effects.morale).toBe(-5);
    expect(interaction.effects.stress).toBe(10);

    const memory = after.memories.at(-1)!;
    if (memory.kind !== 'episodic') throw new Error('expected an episodic override memory');
    expect(memory.tags).toEqual(['admiral-override']);
    expect(memory.text).toContain('TRANSIT');
    expect(lastCommunication(engine.state).priority).toBe('high');
    expect(worldSchema.safeParse(engine.state).success).toBe(true);
  });

  it('charges nobody when the message is not addressed to an Agent', () => {
    const engine = agentEngine();
    const agent = agentByCareer(engine, 'explorer');
    const before = { ...agent.state };
    expect(
      send(engine, message({ kind: 'override', from: agent.id, to: 'admiral', text: '我不接受。' }), agent.id)
        .ok,
    ).toBe(true);
    expect(engine.state.agents.find((a) => a.id === agent.id)!.state).toEqual(before);
    expect(engine.state.agentInteractions).toEqual([]);
  });
});
