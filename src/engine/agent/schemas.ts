/**
 * Lv3 Agent runtime contracts (Zod).
 *
 * CLAUDE.md §6: JSON Schema under `schemas/` is the cross-tool contract; runtime validation stays
 * in the project's existing Zod layer. These schemas mirror `schemas/agent*.schema.json` field for
 * field, and `tests/agent/schemas.test.ts` compares them structurally (no `ajv` — see
 * docs/lv3/KNOWN_ISSUES.md C-25).
 *
 * Types are derived with `z.infer` so the contract has exactly one source. The one field that
 * cannot be derived is `AgentActionCandidate.action`: it must be the project's existing `Action`
 * union (`src/engine/types.ts`), not a second structurally-similar union, so it is validated with
 * the existing `actionSchema` through `z.custom<Action>`.
 *
 * Pure module: no I/O, no clock, no randomness.
 */
import { z } from 'zod';
import {
  actionSchema,
  agentMessageKindSchema,
  messagePayloadSchema,
  promiseFulfillmentSchema,
  promiseTypeSchema,
} from '../commands';
import type { Action } from '../types';
import { MEMORY_CAP } from './memory';
import { PROMISE_CAP } from './promise';

const id = z.string().min(1).max(160);
const time = z.number().finite().min(0);
const bounded = z.number().finite().min(0).max(100);
const unique = (a: readonly unknown[]) => new Set(a).size === a.length;

export const agentCareerSchema = z.enum(['explorer', 'scientist', 'tactical', 'logistics']);
export const goalKindSchema = z.enum(['discovery', 'research', 'command', 'logistics']);
export const memoryTagSchema = z.enum([
  'admiral-override',
  'promise-kept',
  'promise-broken',
  'mission-success',
  'mission-failure',
  'discovery',
  'team-up',
  'conflict',
  'near-death',
  'risk-taken',
]);
export const promiseStatusSchema = z.enum(['pending', 'fulfilled', 'broken']);
export const agentIntentSchema = z.enum([
  'act',
  'wait',
  'request',
  'invite',
  'respond',
  'rest',
  'quit',
]);
export const agentProviderSchema = z.enum(['llm', 'deterministic']);
export const interactionKindSchema = z.enum([
  'command',
  'ask',
  'negotiate',
  'promise',
  'encourage',
  'override',
  'team-request',
  'team-reply',
]);
export const interactionOutcomeSchema = z.enum([
  'accepted',
  'rejected',
  'countered',
  'pending',
  'forced',
]);

export const agentPersonalitySchema = z
  .object({
    riskTolerance: bounded,
    curiosity: bounded,
    loyalty: bounded,
    cooperation: bounded,
    ambition: bounded,
  })
  .strict();

export const agentStateSchema = z
  .object({
    fatigue: bounded,
    stress: bounded,
    morale: bounded,
    trustInAdmiral: bounded,
    loyaltyToCompany: bounded,
    experience: z.number().finite().min(0),
    reputation: z.number().finite().min(0),
    goalProgress: bounded,
  })
  .strict();

export const agentGoalSchema = z
  .object({
    id,
    title: z.string().max(200),
    kind: goalKindSchema,
    progress: bounded,
    priority: bounded,
  })
  .strict();

const memoryText = z.string().max(400);
export const episodicMemorySchema = z
  .object({
    kind: z.literal('episodic'),
    id,
    at: time,
    text: memoryText,
    tags: z.array(memoryTagSchema).min(1).refine(unique),
    weight: z.number().int().min(0).max(100),
    subjectId: id.nullable().optional(),
  })
  .strict();
export const socialMemorySchema = z
  .object({
    kind: z.literal('social'),
    id,
    at: time,
    aboutAgentId: id,
    text: memoryText,
    weight: z.number().int().min(0).max(100),
  })
  .strict();
export const promiseMemorySchema = z
  .object({
    kind: z.literal('promise'),
    id,
    promiseId: id,
    at: time,
    text: memoryText,
    weight: z.number().int().min(0).max(100),
  })
  .strict();
export const agentMemorySchema = z.union([
  episodicMemorySchema,
  socialMemorySchema,
  promiseMemorySchema,
]);

export const agentRelationshipSchema = z
  .object({
    targetAgentId: id,
    value: z.number().finite().min(-100).max(100),
    trust: bounded,
    cooperation: bounded,
  })
  .strict();

/**
 * Re-exported from `../commands` (see the note there): `agentEventSchema` needs both, and this module
 * already imports from that one, so declaring them twice would be the only way to keep them here.
 */
export { promiseFulfillmentSchema, promiseTypeSchema };

export const agentPromiseSchema = z
  .object({
    id,
    from: z.literal('admiral'),
    to: id,
    type: promiseTypeSchema,
    description: z.string().max(300),
    status: promiseStatusSchema,
    createdAt: time,
    resolvedAt: time.nullable(),
    fulfills: promiseFulfillmentSchema,
  })
  .strict();

export const agentSchema = z
  .object({
    id,
    name: z.string().min(1).max(80),
    career: agentCareerSchema,
    personality: agentPersonalitySchema,
    state: agentStateSchema,
    goal: agentGoalSchema,
    relationships: z.array(agentRelationshipSchema),
    memories: z.array(agentMemorySchema).max(MEMORY_CAP),
    promises: z.array(agentPromiseSchema).max(PROMISE_CAP),
    nextDecisionAt: time,
  })
  .strict();

export const agentActionCandidateSchema = z
  .object({
    id: z.string().min(1).max(160),
    label: z.string().min(1).max(120),
    action: z.custom<Action>((value) => actionSchema.safeParse(value).success, {
      message: '不是既有的合法 Action',
    }),
    risk: bounded,
    reward: bounded,
    goalKinds: z.array(goalKindSchema).refine(unique),
    requirements: z.array(z.string().max(120)),
  })
  .strict();

export const agentRequestSchema = z
  .object({
    type: z.enum(['teammate', 'equipment', 'reward', 'rest', 'extension']),
    targetAgentId: z.string().min(1).optional(),
    value: z.number().finite().optional(),
  })
  .strict();

export const agentDecisionSchema = z
  .object({
    intent: agentIntentSchema,
    choiceId: z.string().min(1).max(160).optional(),
    reason: z.string().max(600),
    say: z.string().max(600).optional(),
    request: agentRequestSchema.optional(),
    promptVersion: z.string().min(1),
    observationTick: z.number().int().min(0),
    provider: agentProviderSchema,
  })
  .strict()
  .refine((d) => d.intent !== 'act' || d.choiceId !== undefined, {
    message: 'intent "act" requires choiceId',
    path: ['choiceId'],
  })
  .refine((d) => d.intent !== 'request' || d.request !== undefined, {
    message: 'intent "request" requires request',
    path: ['request'],
  });

export const agentMessageSchema = z
  .object({
    id,
    at: time,
    from: id,
    to: id,
    kind: agentMessageKindSchema,
    text: z.string().max(800),
    payload: messagePayloadSchema.nullable(),
    read: z.boolean(),
  })
  .strict();

/**
 * `AgentStateDelta` is the *actually applied* change recorded on `AgentInteraction.effects`
 * (docs/lv3/02-domain-model.md §13). It carries §13's five bounded fields plus `goalProgress` and
 * `experience`, which §5 of 02-decision-flow.md requires mission settlement to change and to record
 * in the same audit trail — without them the §59 assertions on Goal Progress have no object to
 * assert against. All seven are required so every recorded delta has a uniform shape; the optional
 * `relationship` mirrors §13.
 */
export const agentStateDeltaSchema = z
  .object({
    trustInAdmiral: z.number().finite(),
    loyaltyToCompany: z.number().finite(),
    morale: z.number().finite(),
    stress: z.number().finite(),
    fatigue: z.number().finite(),
    goalProgress: z.number().finite(),
    experience: z.number().finite(),
    relationship: z.object({ targetAgentId: id, value: z.number().finite() }).strict().optional(),
  })
  .strict();

export const agentInteractionSchema = z
  .object({
    id,
    at: time,
    kind: interactionKindSchema,
    actorId: id,
    targetAgentId: id,
    messageId: id.nullable(),
    outcome: interactionOutcomeSchema,
    effects: agentStateDeltaSchema,
  })
  .strict();

export type AgentCareer = z.infer<typeof agentCareerSchema>;
export type GoalKind = z.infer<typeof goalKindSchema>;
export type MemoryTag = z.infer<typeof memoryTagSchema>;
export type AgentPersonality = z.infer<typeof agentPersonalitySchema>;
export type AgentState = z.infer<typeof agentStateSchema>;
export type AgentGoal = z.infer<typeof agentGoalSchema>;
export type EpisodicMemory = z.infer<typeof episodicMemorySchema>;
export type SocialMemory = z.infer<typeof socialMemorySchema>;
export type PromiseMemory = z.infer<typeof promiseMemorySchema>;
export type AgentMemory = z.infer<typeof agentMemorySchema>;
export type AgentRelationship = z.infer<typeof agentRelationshipSchema>;
export type PromiseFulfillment = z.infer<typeof promiseFulfillmentSchema>;
export type AgentPromise = z.infer<typeof agentPromiseSchema>;
export type Agent = z.infer<typeof agentSchema>;
export type AgentActionCandidate = z.infer<typeof agentActionCandidateSchema>;
export type AgentRequest = z.infer<typeof agentRequestSchema>;
export type AgentDecision = z.infer<typeof agentDecisionSchema>;
export type AgentMessage = z.infer<typeof agentMessageSchema>;
export type AgentStateDelta = z.infer<typeof agentStateDeltaSchema>;
export type AgentInteraction = z.infer<typeof agentInteractionSchema>;
export type InteractionKind = z.infer<typeof interactionKindSchema>;
export type InteractionOutcome = z.infer<typeof interactionOutcomeSchema>;
export type AgentIntent = z.infer<typeof agentIntentSchema>;
export type AgentProvider = z.infer<typeof agentProviderSchema>;
export type PromiseType = z.infer<typeof promiseTypeSchema>;
export type PromiseStatus = z.infer<typeof promiseStatusSchema>;
