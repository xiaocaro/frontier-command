import { z } from 'zod';
const id = z.string().min(1).max(160),
  n = z.number().finite(),
  count = n.int().min(1).max(10000);
export const pointSchema = z.object({ x: n, y: n }).strict();
export const stockSchema = z
  .object({
    materials: n.min(0),

    photon: n.int().min(0),
    quantum: n.int().min(0),
    specialFinds: n.int().min(0),
  })
  .strict();
export const ammoSchema = z.object({ photon: n.int().min(0), quantum: n.int().min(0) }).strict();
export const moduleSchema = z.enum([
  'deepScan',
  'longRangeSensors',
  'precisionTargeting',
  'reinforcedShields',
  'expandedCargo',
]);
export const upgradeSchema = z.enum(['shipyard', 'armory', 'sensors', 'logistics', 'defense']);
export const goodsSchema = z.enum(['materials', 'photon', 'quantum', 'specialFinds']);
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('MOVE'), point: pointSchema }).strict(),
  z
    .object({
      type: z.literal('EXPLORE'),
      sector: z.object({ q: n.int().safe(), r: n.int().safe() }).strict(),
      approach: z.enum(['remote', 'close']),
    })
    .strict(),
  z
    .object({
      type: z.literal('SURVEY'),
      targetId: id,
      approach: z.enum(['remote', 'close']),
      deep: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal('RETURN') }).strict(),
  z.object({ type: z.enum(['ASSIST_EVENT', 'TRANSIT', 'CAPTURE']), targetId: id }).strict(),
  z
    .object({
      type: z.literal('HAIL'),
      targetId: id,
      message: z.enum(['greeting', 'withdraw', 'deescalate']),
    })
    .strict(),
  z
    .object({
      type: z.literal('HAUL'),
      sourceId: id,
      targetId: id,
      cargoKind: goodsSchema,
      amount: count,
      route: z.enum(['safe', 'direct', 'risky']),
      repeat: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.enum(['ATTACK', 'DISABLE', 'DRIVE_OFF', 'INTERCEPT', 'SHADOW']),
      targetId: id,
      subsystem: z.enum(['engines', 'weapons']).optional(),
    })
    .strict(),
  z.object({ type: z.literal('ESCORT'), targetId: id }).strict(),
  z.object({ type: z.literal('PATROL'), targetId: id, duration: n.min(1).max(1440) }).strict(),
  z
    .object({ type: z.enum(['RETREAT', 'DOCK', 'REPAIR', 'UNLOAD', 'RECOVER']), targetId: id })
    .strict(),
  z.object({ type: z.literal('REARM'), targetId: id, load: ammoSchema }).strict(),
  z
    .object({ type: z.literal('REFIT'), targetId: id, moduleId: moduleSchema, remove: z.boolean() })
    .strict(),
]);
/**
 * `careerSchema` below is the pre-existing **Personnel** career enum (six values) and is unrelated
 * to the Lv3 `AgentCareer` (explorer/scientist/tactical/logistics). Lv3 defines its own
 * `agentCareerSchema` in `src/engine/agent/schemas.ts` and must not reuse or edit this one
 * (docs/lv3/KNOWN_ISSUES.md C-8).
 */
export const careerSchema = z.enum([
  'battle',
  'science',
  'diplomacy',
  'logistics',
  'security',
  'commander',
]);
export const standingSchema = z
  .object({
    roe: z.enum(['HOLD FIRE', 'RETURN FIRE', 'ENGAGE HOSTILES']),
    retreatHull: n.min(0).max(90),
    retreatShield: n.min(0).max(90),
    retreatCore: n.min(0).max(90),
    photonThreshold: n.min(0).max(100),
    quantumThreshold: n.min(0).max(100),
    maxPursuit: n.min(0).max(2000),
    allowNeutral: z.boolean(),
    allowRomulan: z.boolean(),
    autoEscort: z.boolean(),
    respondDistress: z.boolean(),
    protectCivilian: z.boolean(),
    protectFreighter: z.boolean(),
    protectColony: z.boolean(),
    serviceWhenDocked: z.boolean(),
  })
  .strict();
/**
 * Lv3 structured message payloads. Deliberately declared here rather than in `src/engine/agent/`
 * because `commandSchema` needs them and `src/engine/agent/schemas.ts` imports `actionSchema` from
 * this module — putting them on the agent side would create an evaluation-order cycle
 * (commands -> agent/schemas -> commands) where `actionSchema` would still be in its temporal dead
 * zone. The agent layer re-exports these types, so the domain still owns their meaning.
 * Shape follows `schemas/agent-message.schema.json`.
 */
export const agentMessageKindSchema = z.enum([
  'command',
  'ask',
  'negotiate',
  'promise',
  'encourage',
  'override',
  'team-request',
  'team-reply',
  'report',
]);
export const agentRequestTypeSchema = z.enum([
  'teammate',
  'equipment',
  'reward',
  'rest',
  'extension',
]);
export const messagePayloadSchema = z.union([
  z.object({ promiseId: id }).strict(),
  z.object({ directiveActionType: id }).strict(),
  z.object({ requestingAgentId: id, accept: z.boolean() }).strict(),
  z
    .object({
      requestType: agentRequestTypeSchema,
      targetAgentId: id.optional(),
      value: n.optional(),
    })
    .strict(),
]);
export type AgentMessageKind = z.infer<typeof agentMessageKindSchema>;
export type AgentRequestType = z.infer<typeof agentRequestTypeSchema>;
export type MessagePayload = z.infer<typeof messagePayloadSchema>;
/**
 * Lv3 promise vocabulary. Declared here, like the message payloads above, because `agentEventSchema`
 * needs it and `src/engine/agent/schemas.ts` imports **from** this module — the dependency only ever
 * runs one way, which is what keeps `commandSchema` free of an evaluation-order cycle.
 * `src/engine/agent/schemas.ts` re-exports these, so the domain still owns their meaning.
 */
export const promiseTypeSchema = z.enum(['reward', 'equipment', 'research', 'leadership', 'rest']);
export const promiseFulfillmentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('grant-module'), key: moduleSchema }).strict(),
  z.object({ kind: z.literal('grant-upgrade'), key: upgradeSchema }).strict(),
  z.object({ kind: z.literal('grant-rest') }).strict(),
  z.object({ kind: z.literal('grant-credits'), amount: z.number().finite().min(0) }).strict(),
]);
export type PromiseType = z.infer<typeof promiseTypeSchema>;
export type PromiseFulfillment = z.infer<typeof promiseFulfillmentSchema>;

/**
 * Lv3 settlement events: the **facts** an engine branch reports so that Agent state, memory, goals,
 * relationships and promises can be settled from them (docs/lv3/09-game-integration-status.md).
 *
 * An event carries what happened — "this directive ended", "this module was installed" — and never a
 * precomputed number. Every magnitude stays in `src/engine/agent/**`, so there is one source of truth
 * and the change actually applied can be recorded on `AgentInteraction.effects`.
 */
export const agentEventSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('mission-settled'),
      shipId: id,
      directiveId: id,
      /**
       * The action that ended. Settlement keys on this rather than on the bare existence of a
       * completion, because `complete()` funnels every directive that ends — including the
       * intermediate "目标无法接续" failures (`src/engine/engine.ts`) — through the same path.
       * Only an Admiral-sourced directive is a mission; see the emission guard in `complete()`.
       */
      actionType: id,
      outcome: z.enum(['success', 'failure']),
    })
    .strict(),
  /**
   * The Admiral has promised an Agent something. Carries the whole promise, because
   * `agentMessage{kind:'promise'}` cannot: its payload is a bare `promiseId` with nowhere to put the
   * `fulfills` condition, so on its own it could never express what was actually promised. Following
   * the Override precedent (P3-07), the social record and the state change are two commands.
   */
  z
    .object({
      kind: z.literal('promise-made'),
      toAgentId: id,
      promiseType: promiseTypeSchema,
      description: z.string().max(300),
      fulfills: promiseFulfillmentSchema,
    })
    .strict(),
  /**
   * A module was actually installed on a ship. **World-scoped**, not ship-scoped: a promise names a
   * beneficiary, and the ship that flies the REFIT need not be that beneficiary's — keying the match
   * on the installing ship would silently miss the fulfilment.
   */
  z.object({ kind: z.literal('module-installed'), moduleId: moduleSchema }).strict(),
  /** Two Agents agreed to fly together, or one declined. Both sides move, in one write. */
  z
    .object({
      kind: z.literal('team-resolved'),
      aAgentId: id,
      bAgentId: id,
      accepted: z.boolean(),
    })
    .strict(),
  /** An Agent's ship found something worth remembering. */
  z.object({ kind: z.literal('discovery'), shipId: id, bodyId: id }).strict(),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;
const members = z
  .array(id)
  .min(1)
  .max(100)
  .refine((a) => new Set(a).size === a.length);
const groupFields = {
  name: z.string().trim().min(1).max(80),
  shipIds: members,
  flagshipId: id,
  spacing: n.min(15).max(100),
};
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('dismissMapMarker'), entityId: id }).strict(),
  z
    .object({
      type: z.literal('issueDirective'),
      shipIds: z
        .array(id)
        .min(1)
        .max(100)
        .refine((a) => new Set(a).size === a.length),
      mode: z.enum(['REPLACE', 'QUEUE', 'INTERRUPT']),
      action: actionSchema,
    })
    .strict(),
  z.object({ type: z.literal('cancelDirective'), shipId: id }).strict(),
  z.object({ type: z.literal('standingOrders'), shipId: id, orders: standingSchema }).strict(),
  z.object({ type: z.literal('setCloak'), shipId: id, enabled: z.boolean() }).strict(),
  z.object({ type: z.literal('createGroup'), ...groupFields }).strict(),
  z.object({ type: z.literal('updateGroup'), groupId: id, ...groupFields }).strict(),
  z.object({ type: z.literal('deleteGroup'), groupId: id }).strict(),
  z
    .object({
      type: z.literal('issueGroupDirective'),
      groupId: id,
      mode: z.enum(['REPLACE', 'QUEUE', 'INTERRUPT']),
      action: actionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('candidate'),
      personnelId: id,
      accept: z.boolean(),
      career: careerSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('assignPersonnel'),
      personnelId: id,
      targetId: id,
      targetType: z.enum(['ship', 'colony']),
    })
    .strict(),
  z
    .object({
      type: z.literal('developColony'),
      locationId: id,
      kind: z.enum(['housing', 'industry', 'science', 'security']),
    })
    .strict(),
  z
    .object({
      type: z.literal('respondEvent'),
      eventId: id,
      choice: z.enum([
        'assist',
        'quarantine',
        'liftQuarantine',
        'accept',
        'reject',
        'withdraw',
        'stabilize',
      ]),
      targetId: id.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('tradeStock'),
      direction: z.enum(['buy', 'sell']),
      cargoKind: goodsSchema,
      amount: count,
    })
    .strict(),
  z
    .object({
      type: z.literal('renameEntity'),
      entityId: id,
      name: z.string().trim().min(1).max(80),
    })
    .strict(),
  z
    .object({
      type: z.literal('startConstruction'),
      siteId: id,
      kind: z.enum(['mine', 'outpost', 'colony', 'platform']),
      name: z.string().trim().min(1).max(80),
    })
    .strict(),
  z
    .object({
      type: z.literal('buildShip'),
      locationId: id.optional(),
      classId: z.enum(['antares', 'peregrine', 'constitution', 'galaxy']),
      name: z.string().trim().min(1).max(80),
    })
    .strict(),
  z
    .object({ type: z.literal('upgrade'), upgradeId: upgradeSchema, locationId: id.optional() })
    .strict(),
  z
    .object({
      type: z.literal('manufacture'),
      locationId: id.optional(),
      cargoKind: z.enum(['photon', 'quantum']),
      amount: count,
    })
    .strict(),
  z
    .object({
      type: z.literal('startBaseRefit'),
      locationId: id,
      name: z.string().trim().min(1).max(80),
    })
    .strict(),
  z.object({ type: z.literal('sellStock'), cargoKind: goodsSchema, amount: count }).strict(),
  z.object({ type: z.literal('repairFacility'), locationId: id }).strict(),
  z.object({ type: z.literal('acknowledge'), communicationId: n.int().min(1) }).strict(),
  z.object({ type: z.literal('pause'), paused: z.boolean() }).strict(),
  z
    .object({
      type: z.literal('speed'),
      speed: z.union([z.literal(1), z.literal(4), z.literal(16)]),
    })
    .strict(),
  // Lv3: the single structured entry point for Agent social writes (docs/lv3/03-implementation-plan.md §4.5).
  z
    .object({
      type: z.literal('agentMessage'),
      from: id,
      to: id,
      kind: agentMessageKindSchema,
      text: z.string().max(800),
      payload: messagePayloadSchema.nullable(),
    })
    .strict(),
  /**
   * Lv3: the settlement door. An engine branch reports a fact; the engine's own apply path runs the
   * pure `src/engine/agent/**` functions and writes the Agent roster, so `dispatchCommand` stays the
   * single validation entry point for every Agent-facing write (CLAUDE.md §2.1) — the same rule the
   * `agentMessage` member above already follows.
   */
  z.object({ type: z.literal('agentEvent'), event: agentEventSchema }).strict(),
]);
