/**
 * Bounded, typed, deterministically retrievable memory (Agent.md §15–§18/§50/§52,
 * docs/lv3/02-domain-model.md §5).
 *
 * Three hard constraints, all of them load-bearing:
 *  1. **Bounded** — `memories.length <= MEMORY_CAP` (40). The save ceiling is 32MB and Agent.md §52
 *     rules out a long-term retrieval system, so memory must not grow without limit.
 *  2. **Structured** — every entry carries `tags` and `weight`, so retrieval is tag matching plus a
 *     total order. No embeddings, no vector store, no semantic search.
 *  3. **Deterministic** — eviction and retrieval are pure functions with an explicit total order
 *     (`weight`, then `at`, then `id`). Insertion-order drift would break the same-seed replay
 *     assertion in `tests/architecture.test.ts`.
 *
 * Memory text is written from *engine settlement*, never from an LLM's `reason` field: `reason` is
 * the Agent's own account, not a fact (docs/lv3/02-domain-model.md §11). Text must also never embed
 * the name of an undiscovered entity — it flows into `AgentObservation` and is covered by the
 * privacy assertion in `tests/recon.test.ts`.
 *
 * Pure module: no I/O, no clock, no randomness.
 */
import type {
  AgentMemory,
  EpisodicMemory,
  MemoryTag,
  PromiseMemory,
  SocialMemory,
} from './types';

export const MEMORY_CAP = 40;
export const MEMORY_TEXT_MAX = 400;

/**
 * Deterministic weight per tag, so writing a memory needs no caller-supplied judgement. Memories
 * that must survive eviction (an Override, a broken promise, a near-death) sit at the top.
 */
export const MEMORY_WEIGHTS: Readonly<Record<MemoryTag, number>> = Object.freeze({
  'admiral-override': 90,
  'promise-broken': 90,
  'near-death': 85,
  'mission-failure': 70,
  'promise-kept': 70,
  discovery: 60,
  'mission-success': 55,
  conflict: 50,
  'team-up': 45,
  'risk-taken': 35,
});

export function memoryWeightFor(tags: readonly MemoryTag[]): number {
  return tags.reduce((max, tag) => Math.max(max, MEMORY_WEIGHTS[tag]), 0);
}

function truncate(text: string): string {
  return text.length <= MEMORY_TEXT_MAX ? text : text.slice(0, MEMORY_TEXT_MAX);
}

export function episodicMemory(input: {
  id: string;
  at: number;
  text: string;
  tags: readonly MemoryTag[];
  subjectId?: string | null;
  weight?: number;
}): EpisodicMemory {
  const memory: EpisodicMemory = {
    kind: 'episodic',
    id: input.id,
    at: input.at,
    text: truncate(input.text),
    tags: [...new Set(input.tags)].sort(),
    weight: input.weight ?? memoryWeightFor(input.tags),
  };
  if (input.subjectId != null) memory.subjectId = input.subjectId;
  return memory;
}

export function socialMemory(input: {
  id: string;
  at: number;
  aboutAgentId: string;
  text: string;
  weight?: number;
}): SocialMemory {
  return {
    kind: 'social',
    id: input.id,
    at: input.at,
    aboutAgentId: input.aboutAgentId,
    text: truncate(input.text),
    weight: input.weight ?? 50,
  };
}

export function promiseMemory(input: {
  id: string;
  promiseId: string;
  at: number;
  text: string;
  weight?: number;
}): PromiseMemory {
  return {
    kind: 'promise',
    id: input.id,
    promiseId: input.promiseId,
    at: input.at,
    text: truncate(input.text),
    weight: input.weight ?? 70,
  };
}

/** Total order used by both eviction and retrieval. Positive means `b` is more important. */
function compareByWeightThenRecencyThenId(a: AgentMemory, b: AgentMemory): number {
  if (a.weight !== b.weight) return a.weight - b.weight;
  if (a.at !== b.at) return a.at - b.at;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Appends a memory and evicts the least important entries until the list is back within
 * `MEMORY_CAP`. Eviction is by ascending `weight`, then ascending `at`, then ascending `id`, so it
 * is a pure function of the list contents and never of insertion order.
 */
export function remember(
  memories: readonly AgentMemory[],
  memory: AgentMemory,
  cap = MEMORY_CAP,
): AgentMemory[] {
  const next = [...memories, memory];
  if (next.length <= cap) return next;
  const doomed = new Set(
    [...next]
      .sort(compareByWeightThenRecencyThenId)
      .slice(0, next.length - cap)
      .map((m) => m.id),
  );
  return next.filter((m) => !doomed.has(m.id));
}

/**
 * Deterministic retrieval: memories carrying any of `tags`, most important first.
 * Ordering is `weight` descending, then `at` descending, then `id` ascending.
 */
export function retrieve(
  memories: readonly AgentMemory[],
  tags: readonly MemoryTag[],
  limit = Number.MAX_SAFE_INTEGER,
): AgentMemory[] {
  if (!tags.length) return [];
  const wanted = new Set(tags);
  return memories
    .filter((m) => m.kind === 'episodic' && m.tags.some((tag) => wanted.has(tag)))
    .sort((a, b) => compareByWeightThenRecencyThenId(b, a))
    .slice(0, limit);
}

/** The bounded memory window handed to a decision, most important first. */
export function recentMemories(
  memories: readonly AgentMemory[],
  limit = 12,
): AgentMemory[] {
  return [...memories]
    .sort((a, b) => compareByWeightThenRecencyThenId(b, a))
    .slice(0, limit)
    .map((m) => ({ ...m }));
}
