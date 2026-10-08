/**
 * Admiral promises to an Agent (Agent.md §18/§19, docs/lv3/02-domain-model.md §7).
 *
 * Agent.md §18 defines `status` but never defines who flips it or what counts as fulfilment.
 * Without `fulfills`, a promise would sit at `pending` forever and §19's trust movement — the core
 * assertion of EVT-07/EVT-09 — could never fire. So a promise carries a machine-decidable
 * fulfilment condition that is matched against changes produced by **existing** commands (a REFIT
 * installing `deepScan`, an upgrade completing, a rest being granted). No new fulfilment mechanism
 * is introduced.
 *
 * Pure module: no I/O, no clock, no randomness.
 */
import type { PromiseFulfillment, PromiseStatus, PromiseType, AgentPromise } from './types';

export const PROMISE_CAP = 20;

export function createPromise(input: {
  id: string;
  to: string;
  type: PromiseType;
  description: string;
  fulfills: PromiseFulfillment;
  createdAt: number;
}): AgentPromise {
  return {
    id: input.id,
    from: 'admiral',
    to: input.to,
    type: input.type,
    description: input.description,
    status: 'pending',
    createdAt: input.createdAt,
    resolvedAt: null,
    fulfills: { ...input.fulfills },
  };
}

/**
 * A world change that can settle a promise. Produced by existing engine commands, never by an LLM.
 */
export type FulfillmentSignal =
  | { kind: 'module-installed'; moduleId: string }
  | { kind: 'upgrade-completed'; upgradeId: string }
  | { kind: 'rest-granted' }
  | { kind: 'credits-granted'; amount: number };

export function matchesFulfillment(
  promise: AgentPromise,
  signal: FulfillmentSignal,
): boolean {
  const f = promise.fulfills;
  if (f.kind === 'grant-module') return signal.kind === 'module-installed' && signal.moduleId === f.key;
  if (f.kind === 'grant-upgrade')
    return signal.kind === 'upgrade-completed' && signal.upgradeId === f.key;
  if (f.kind === 'grant-rest') return signal.kind === 'rest-granted';
  return signal.kind === 'credits-granted' && signal.amount >= f.amount;
}

/** Settles one promise. Unknown ids and already-settled promises are left untouched. */
export function settlePromise(
  promises: readonly AgentPromise[],
  id: string,
  status: Exclude<PromiseStatus, 'pending'>,
  at: number,
): AgentPromise[] {
  return promises.map((p) =>
    p.id === id && p.status === 'pending' ? { ...p, status, resolvedAt: at } : p,
  );
}

/**
 * Settles every pending promise whose condition one of `signals` satisfies. Returns the new list;
 * callers compare ids to learn which promises moved (and can then apply the §19 state effect).
 */
export function resolveFulfillments(
  promises: readonly AgentPromise[],
  signals: readonly FulfillmentSignal[],
  at: number,
): AgentPromise[] {
  return promises.map((p) =>
    p.status === 'pending' && signals.some((signal) => matchesFulfillment(p, signal))
      ? { ...p, status: 'fulfilled', resolvedAt: at }
      : p,
  );
}

export function pendingPromises(promises: readonly AgentPromise[]): AgentPromise[] {
  return promises.filter((p) => p.status === 'pending');
}

/** The promise a decision should most care about: the oldest still-pending one. */
export function activePromise(promises: readonly AgentPromise[]): AgentPromise | null {
  const pending = pendingPromises(promises);
  if (!pending.length) return null;
  return [...pending].sort((a, b) =>
    a.createdAt !== b.createdAt
      ? a.createdAt - b.createdAt
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0,
  )[0];
}

export function idsSettledBy(
  before: readonly AgentPromise[],
  after: readonly AgentPromise[],
): string[] {
  const was = new Map(before.map((p) => [p.id, p.status]));
  return after.filter((p) => was.get(p.id) === 'pending' && p.status !== 'pending').map((p) => p.id);
}

/**
 * Keeps the promise list within `PROMISE_CAP`: every pending promise survives, and resolved ones
 * are kept newest-first until the cap is reached. Relative input order is preserved so the result
 * is a pure function of the input list.
 */
export function boundPromises(
  promises: readonly AgentPromise[],
  cap = PROMISE_CAP,
): AgentPromise[] {
  if (promises.length <= cap) return [...promises];
  const pending = promises.filter((p) => p.status === 'pending');
  const resolved = promises
    .filter((p) => p.status !== 'pending')
    .sort((a, b) => {
      const at = (b.resolvedAt ?? b.createdAt) - (a.resolvedAt ?? a.createdAt);
      return at !== 0 ? at : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, Math.max(0, cap - pending.length));
  const keep = new Set([...pending, ...resolved].map((p) => p.id));
  return promises.filter((p) => keep.has(p.id));
}
