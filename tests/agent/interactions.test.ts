/**
 * P0 interactions and messages (docs/lv3/03-test-plan.md §3 D-17, §4 DEC-11).
 *
 * `AgentInteraction.effects` is the object Agent.md §59's assertions are written against, so the
 * important property is that it holds what *actually* happened rather than what was intended.
 */
import { describe, it, expect } from 'vitest';
import {
  INTERACTION_KINDS,
  createMessage,
  createsInteraction,
  interactionEffect,
  interactionOutcomeFor,
  isTaskOfferKind,
  overrideMemory,
  overrideMemoryText,
  applyInteraction,
} from '../../src/engine/agent/interactions';
import { agentInteractionSchema, agentMessageSchema } from '../../src/engine/agent/schemas';
import { emptyDelta, OVERRIDE_EFFECT } from '../../src/engine/agent/state';
import { agentByCareer, agentEngine } from './support';

const explorer = (e = agentEngine()) => agentByCareer(e, 'explorer');

describe('interaction kinds and outcomes', () => {
  it('separates speech-only messages from recorded interactions', () => {
    expect(createsInteraction('report')).toBe(false);
    for (const kind of INTERACTION_KINDS) expect(createsInteraction(kind)).toBe(true);
    expect(INTERACTION_KINDS).toHaveLength(8);
  });

  it('derives the outcome from the kind and payload', () => {
    expect(interactionOutcomeFor('override', null)).toBe('forced');
    expect(interactionOutcomeFor('negotiate', null)).toBe('countered');
    expect(interactionOutcomeFor('promise', { promiseId: 'promise-1' })).toBe('accepted');
    expect(
      interactionOutcomeFor('team-reply', { requestingAgentId: 'agent-2', accept: true }),
    ).toBe('accepted');
    expect(
      interactionOutcomeFor('team-reply', { requestingAgentId: 'agent-2', accept: false }),
    ).toBe('rejected');
    expect(interactionOutcomeFor('ask', null)).toBe('pending');
  });

  it('recognises the message kinds that answer a task offer', () => {
    for (const kind of ['command', 'ask', 'negotiate', 'promise'] as const)
      expect(isTaskOfferKind(kind)).toBe(true);
    expect(isTaskOfferKind('report')).toBe(false);
  });
});

describe('interaction effects', () => {
  it('charges exactly the Agent.md §42 price for an Override and nothing for the rest', () => {
    expect(interactionEffect('override', 'forced')).toEqual(OVERRIDE_EFFECT);
    for (const kind of INTERACTION_KINDS.filter((k) => k !== 'override'))
      expect(interactionEffect(kind, 'pending')).toEqual(emptyDelta());
    // An override that did not actually happen costs nothing.
    expect(interactionEffect('override', 'rejected')).toEqual(emptyDelta());
  });

  it('records the applied delta, saturating at the state bounds', () => {
    const agent = { ...explorer(), state: { ...explorer().state, trustInAdmiral: 6, morale: 2 } };
    const { agent: next, effects } = applyInteraction(agent, 'override', 'forced');
    expect(effects.trustInAdmiral).toBe(-6);
    expect(effects.morale).toBe(-2);
    expect(effects.stress).toBe(10);
    expect(next.state.trustInAdmiral).toBe(0);
    expect(next.state.morale).toBe(0);
  });

  it('leaves the Agent untouched for a neutral interaction', () => {
    const agent = explorer();
    const { agent: next, effects } = applyInteraction(agent, 'ask', 'pending');
    expect(next.state).toEqual(agent.state);
    expect(effects).toEqual(emptyDelta());
    expect(next).toEqual(agent);
  });
});

describe('messages and audit records', () => {
  it('builds an unread message that satisfies the message contract', () => {
    const message = createMessage({
      id: 'agent-message-1',
      at: 12,
      from: 'admiral',
      to: 'agent-1',
      kind: 'promise',
      text: '任务完成后授予 Deep Scan。',
      payload: { promiseId: 'promise-1' },
    });
    expect(message.read).toBe(false);
    expect(agentMessageSchema.safeParse(message).success).toBe(true);
  });

  it('produces an interaction record the save contract accepts', () => {
    const agent = explorer();
    const { effects } = applyInteraction(agent, 'override', 'forced');
    const interaction = {
      id: 'agent-interaction-1',
      at: 30,
      kind: 'override' as const,
      actorId: 'admiral',
      targetAgentId: agent.id,
      messageId: 'agent-message-1',
      outcome: 'forced' as const,
      effects,
    };
    expect(agentInteractionSchema.safeParse(interaction).success).toBe(true);
    expect(interaction.effects).toEqual(OVERRIDE_EFFECT);
  });

  it('writes the Override to memory so it can shape the next decision', () => {
    const memory = overrideMemory({ id: 'agent-memory-1', at: 40, actionType: 'TRANSIT' });
    expect(memory.kind).toBe('episodic');
    expect(memory.tags).toEqual(['admiral-override']);
    expect(memory.text).toBe(overrideMemoryText('TRANSIT'));
    expect(memory.text).toContain('TRANSIT');
    // The tag is one of the heaviest, so an Override survives memory eviction.
    expect(memory.weight).toBeGreaterThanOrEqual(90);
  });
});
