import { z } from 'zod';
import { pointSchema, stockSchema, careerSchema } from './commands';
const n = z.number().finite().min(0),
  id = z.string().min(1).max(160),
  integer = n.int();
export const colonySchema = z
  .object({
    population: n,
    housing: n,
    stability: n.max(100),
    morale: n.max(100),
    security: n.max(100),
    industry: n.max(100),
    science: n.max(100),
    commanderId: id.nullable(),
    nextCandidate: n,
    contamination: n.max(100),
    quarantine: z.boolean(),
    development: z
      .object({ kind: z.enum(['housing', 'industry', 'science', 'security']), work: n })
      .strict()
      .nullable(),
  })
  .strict();
export const personnelSchema = z
  .object({
    id,
    name: id,
    originId: id,
    career: careerSchema,
    experience: n,
    skills: z
      .object({
        battle: n.max(100),
        science: n.max(100),
        diplomacy: n.max(100),
        logistics: n.max(100),
        security: n.max(100),
        commander: n.max(100),
      })
      .strict(),
    status: z.enum(['candidate', 'training', 'available', 'assigned', 'rejected', 'missing']),
    training: n.max(90),
    locationId: id,
    posting: z
      .object({ type: z.enum(['ship', 'colony']), id })
      .strict()
      .nullable(),
  })
  .strict();
export const groupSchema = z
  .object({
    id,
    name: id,
    shipIds: z.array(id).min(1).max(100),
    flagshipId: id,
    spacing: n.min(15).max(100),
  })
  .strict();
export const eventSchema = z
  .object({
    id,
    kind: z.enum([
      'wormhole',
      'plague',
      'invasion',
      'accident',
      'distress',
      'refugees',
      'discovery',
      'derelict',
      'diplomatic',
    ]),
    subjectId: id,
    created: n,
    deadline: n,
    stage: z.enum(['reported', 'responding', 'resolved', 'failed']),
    evidence: z.string(),
    choice: z.string().nullable(),
    work: n,
    population: n,
    carrierId: id.nullable(),
    targetId: id.nullable(),
    assetIds: z.array(id),
    followUpId: id.nullable(),
    outcome: z.string(),
  })
  .strict();
export const wormholeSchema = pointSchema
  .extend({
    id,
    name: id,
    sectorId: id,
    discovered: z.boolean(),
    surveyed: z.boolean(),
    exit: pointSchema,
    exitSector: z.object({ q: z.number().int().safe(), r: z.number().int().safe() }).strict(),
    stability: n.max(1),
    stable: z.boolean(),
    transits: integer,
  })
  .strict();
export const tradeOrderSchema = z
  .object({
    id,
    direction: z.enum(['buy', 'sell']),
    cargoKind: z.enum(['materials', 'photon', 'quantum', 'specialFinds']),
    amount: integer.min(1),
    delivered: n,
    loaded: n,
    price: n,
    state: z.enum(['waiting', 'loading', 'delivery', 'complete', 'lost']),
    carrierId: id.nullable(),
  })
  .strict();
export const tradeSchema = z
  .object({
    stock: stockSchema,
    credits: n,
    capacity: stockSchema,
    depot: pointSchema,
    orders: z.array(tradeOrderSchema),
  })
  .strict();
