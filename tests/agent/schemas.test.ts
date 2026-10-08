/**
 * Zero-dependency consistency check between `schemas/*.json` (the cross-tool contract) and the Zod
 * runtime contracts in `src/engine/agent/schemas.ts` (docs/lv3/03-test-plan.md §10).
 *
 * `schemas/*.json` is imported by no code, so drift between the two would otherwise be invisible.
 * No declarative JSON Schema validator is available and `ajv` only exists here as a transitive
 * dependency of `app-builder-lib`, which is not ours to depend on (KNOWN_ISSUES C-25). So this test
 * reads the JSON structurally and checks the invariants that would actually hurt if they drifted:
 * required sets, enums, numeric bounds, collection caps and `additionalProperties: false` — plus a
 * live accept/reject round-trip through the Zod contract.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  agentActionCandidateSchema,
  agentCareerSchema,
  agentDecisionSchema,
  agentMessageSchema,
  agentMemorySchema,
  agentPromiseSchema,
  agentRelationshipSchema,
  agentIntentSchema,
  agentSchema,
  memoryTagSchema,
} from '../../src/engine/agent/schemas';
import { actionSchema, agentMessageKindSchema } from '../../src/engine/commands';
import { MEMORY_CAP } from '../../src/engine/agent/memory';
import { PROMISE_CAP } from '../../src/engine/agent/promise';

type JsonSchema = Record<string, any>;

const read = (name: string): JsonSchema =>
  JSON.parse(readFileSync(join('schemas', name), 'utf8')) as JsonSchema;
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join('tests', 'fixtures', 'agent', name), 'utf8'));

const agentJson = read('agent.schema.json');
const decisionJson = read('agent-decision.schema.json');
const memoryJson = read('agent-memory.schema.json');
const messageJson = read('agent-message.schema.json');
const promiseJson = read('agent-promise.schema.json');
const relationshipJson = read('agent-relationship.schema.json');
const candidateJson = read('agent-action-candidate.schema.json');

/** Every object node in a JSON Schema tree, including the root. */
function objectNodes(node: JsonSchema): JsonSchema[] {
  const found: JsonSchema[] = [];
  if (!node || typeof node !== 'object') return found;
  if (node.type === 'object' || node.properties || node.additionalProperties !== undefined)
    found.push(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const item of value) found.push(...objectNodes(item));
    else if (value && typeof value === 'object') found.push(...objectNodes(value as JsonSchema));
  }
  return found;
}

function discriminatorValues(): string[] {
  const options = (actionSchema as unknown as { options: unknown[] }).options;
  return options
    .flatMap((option) => {
      const def = (option as { shape: { type: { _def: Record<string, unknown> } } }).shape.type
        ._def;
      if (def.typeName === 'ZodLiteral') return [String(def.value)];
      if (def.typeName === 'ZodEnum') return [...((def.values ?? []) as string[])];
      return [];
    })
    .sort();
}

describe('schemas/*.json structure', () => {
  it('closes every object to unknown properties', () => {
    for (const [name, schema] of [
      ['agent', agentJson],
      ['agent-decision', decisionJson],
      ['agent-memory', memoryJson],
      ['agent-message', messageJson],
      ['agent-promise', promiseJson],
      ['agent-relationship', relationshipJson],
      ['agent-action-candidate', candidateJson],
    ] as const)
      for (const node of objectNodes(schema)) {
        // The action-candidate `action` node is the one deliberate exception: it is a permissive
        // stand-in for the whole engine Action union (whose per-member strictness lives in
        // `actionSchema`), so it constrains only `type`.
        if (node === candidateJson.properties.action) continue;
        if (node.type === 'object')
          expect(node.additionalProperties, name + ' object node').toBe(false);
      }
  });

  it('bounds the persisted Agent collections', () => {
    expect(agentJson.properties.memories.maxItems).toBe(MEMORY_CAP);
    expect(agentJson.properties.promises.maxItems).toBe(PROMISE_CAP);
    expect(MEMORY_CAP).toBe(40);
    expect(PROMISE_CAP).toBe(20);
    expect(agentSchema.shape.memories._def.maxLength?.value).toBe(MEMORY_CAP);
    expect(agentSchema.shape.promises._def.maxLength?.value).toBe(PROMISE_CAP);
  });

  it('agrees on the Agent career and goal-kind vocabularies', () => {
    expect(agentJson.properties.career.enum).toEqual([...agentCareerSchema.options]);
    expect(agentJson.$defs.goal.properties.kind.enum).toEqual(['discovery', 'research', 'command', 'logistics']);
  });

  it('agrees on the memory tag vocabulary', () => {
    expect(memoryJson.$defs.memoryTag.enum).toEqual([...memoryTagSchema.options]);
    expect(memoryJson.$defs.memoryTag.enum).toHaveLength(10);
  });

  it('agrees on the message kind vocabulary', () => {
    expect(messageJson.properties.kind.enum).toEqual([...agentMessageKindSchema.options]);
    expect(messageJson.required).toContain('payload');
  });

  it('agrees on the decision intent and provider vocabularies', () => {
    expect(decisionJson.properties.intent.enum).toEqual([...agentIntentSchema.options]);
    expect(decisionJson.properties.provider.enum).toEqual(['llm', 'deterministic']);
  });

  it('agrees on the action-candidate discriminator set', () => {
    expect(candidateJson.properties.action.properties.type.enum.slice().sort()).toEqual(
      discriminatorValues(),
    );
  });

  it('keeps the numeric ranges the Zod layer enforces', () => {
    expect(relationshipJson.properties.value.minimum).toBe(-100);
    expect(relationshipJson.properties.value.maximum).toBe(100);
    expect(relationshipJson.properties.trust.minimum).toBe(0);
    expect(relationshipJson.properties.cooperation.maximum).toBe(100);
    expect(candidateJson.properties.risk.maximum).toBe(100);
    for (const key of Object.keys(agentJson.$defs.personality.properties))
      expect(agentJson.$defs.personality.properties[key].maximum).toBe(100);
    expect(promiseJson.properties.status.enum).toEqual(['pending', 'fulfilled', 'broken']);
    expect(promiseJson.properties.from.const).toBe('admiral');
  });

  it('declares the same required fields as the Zod contracts', () => {
    expect(agentJson.required.slice().sort()).toEqual(
      Object.keys(agentSchema.shape).sort(),
    );
    expect(relationshipJson.required.slice().sort()).toEqual(
      Object.keys(agentRelationshipSchema.shape).sort(),
    );
    expect(promiseJson.required.slice().sort()).toEqual(
      Object.keys(agentPromiseSchema.shape).sort(),
    );
    expect(messageJson.required.slice().sort()).toEqual(Object.keys(agentMessageSchema.shape).sort());
    expect(candidateJson.required.slice().sort()).toEqual(
      Object.keys(agentActionCandidateSchema.shape).sort(),
    );
  });
});

describe('Zod contracts accept the approved shape and refuse the broken ones', () => {
  it('accepts every valid fixture', () => {
    expect(agentSchema.safeParse(fixture('valid-agent.json')).success).toBe(true);
    expect(agentDecisionSchema.safeParse(fixture('valid-decision.json')).success).toBe(true);
    expect(agentMessageSchema.safeParse(fixture('valid-message.json')).success).toBe(true);
    expect(agentActionCandidateSchema.safeParse(fixture('valid-action-candidate.json')).success).toBe(
      true,
    );
    const agent = fixture('valid-agent.json') as JsonSchema;
    for (const memory of agent.memories)
      expect(agentMemorySchema.safeParse(memory).success).toBe(true);
    for (const relationship of agent.relationships)
      expect(agentRelationshipSchema.safeParse(relationship).success).toBe(true);
    for (const promise of agent.promises)
      expect(agentPromiseSchema.safeParse(promise).success).toBe(true);
  });

  it('refuses unknown keys on every contract (no silent field invention)', () => {
    const agent = { ...(fixture('valid-agent.json') as JsonSchema), rogue: 1 };
    expect(agentSchema.safeParse(agent).success).toBe(false);
    const decision = { ...(fixture('valid-decision.json') as JsonSchema), action: { type: 'MOVE' } };
    expect(agentDecisionSchema.safeParse(decision).success).toBe(false);
    const message = { ...(fixture('valid-message.json') as JsonSchema), extra: true };
    expect(agentMessageSchema.safeParse(message).success).toBe(false);
  });

  it('refuses a missing required field', () => {
    const agent = fixture('valid-agent.json') as JsonSchema;
    const { nextDecisionAt: _omitted, ...withoutClock } = agent;
    expect(agentSchema.safeParse(withoutClock).success).toBe(false);
  });

  it('refuses out-of-range values', () => {
    const agent = fixture('valid-agent.json') as JsonSchema;
    expect(
      agentSchema.safeParse({
        ...agent,
        personality: { ...agent.personality, riskTolerance: 101 },
      }).success,
    ).toBe(false);
    expect(
      agentSchema.safeParse({
        ...agent,
        relationships: [{ ...agent.relationships[0], value: -101 }],
      }).success,
    ).toBe(false);
    expect(
      agentActionCandidateSchema.safeParse({
        ...(fixture('valid-action-candidate.json') as JsonSchema),
        risk: 101,
      }).success,
    ).toBe(false);
  });

  it('refuses a decision whose intent and payload disagree', () => {
    const base = fixture('valid-decision.json') as JsonSchema;
    const { choiceId: _dropped, ...noChoice } = base;
    expect(agentDecisionSchema.safeParse(noChoice).success).toBe(false);
    expect(
      agentDecisionSchema.safeParse({ ...base, intent: 'request' }).success,
    ).toBe(false);
    expect(
      agentDecisionSchema.safeParse({ ...base, intent: 'request', request: { type: 'teammate', targetAgentId: 'agent-2' } })
        .success,
    ).toBe(true);
  });

  it('refuses an action that is not a real engine Action', () => {
    expect(
      agentActionCandidateSchema.safeParse({
        ...(fixture('valid-action-candidate.json') as JsonSchema),
        action: { type: 'TELEPORT', point: { x: 0, y: 0 } },
      }).success,
    ).toBe(false);
    expect(
      agentActionCandidateSchema.safeParse({
        ...(fixture('valid-action-candidate.json') as JsonSchema),
        action: { type: 'EXPLORE', sector: { q: 0, r: -1 } },
      }).success,
    ).toBe(false);
  });

  it('uses the project Action union rather than a second, similar one', () => {
    const action = (fixture('valid-action-candidate.json') as JsonSchema).action;
    expect(actionSchema.safeParse(action).success).toBe(true);
    expect(z.string().safeParse(action.type).success).toBe(true);
  });
});
