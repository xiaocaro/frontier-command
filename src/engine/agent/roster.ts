/**
 * The Admiral's read-only view of the Agent roster (docs/lv3/10-agent-demo-channel.md).
 *
 * Until this existed, nothing the Agent layer did was visible to a human: `snapshot()`
 * (`src/engine/projection.ts`) deliberately carries no `agents`, so an Agent's trust, morale, goals,
 * promises and memories never reached the renderer. The MVP's central experience — "why did he
 * refuse?", "did my earlier decision change how much he trusts me?" — had no way to be *seen*.
 *
 * **This is a deliberate amplifier, so the crop is the whole design.** It is written here, in one
 * place, rather than by widening the existing snapshot — a second channel with an explicit shape is
 * easier to audit than a bigger first one.
 *
 * What is withheld and why:
 *
 *  - **memory `text`.** `KNOWN_ISSUES.md` `N-7` names memory text as the new leak vector: it is free
 *    prose that can carry a place name the player has not discovered. The demo does not need it —
 *    Path A and Path B are distinguishable by the *tag* (`promise-kept` vs `admiral-override`), which
 *    is exactly what `memoryContribution` scores. So tags, weight and time go out; text does not.
 *  - **`nextDecisionAt`.** A scheduler stamp. It says when the Agent will next think, which is
 *    machinery rather than character, and nothing in the MVP reads it.
 *
 * Everything else on an Agent is a bounded number, a fixed title, an Agent-authored description, or
 * an id — none of which is hidden state.
 *
 * Pure module: no I/O, no clock, no randomness.
 */
import type { WorldState } from '../types';
import { recentMemories } from './memory';
import type { AgentGoal, AgentMemory, AgentPromise, AgentRelationship, AgentState } from './types';

/** How many memories the panel shows. Bounded so the payload is small and the panel readable. */
export const ROSTER_MEMORY_LIMIT = 6;

/** A memory as the Admiral may see it. Deliberately **without** `text` — see the module comment. */
export interface RosterMemory {
  kind: AgentMemory['kind'];
  /** Empty for `social` and `promise` memories, which carry no tags. */
  tags: string[];
  weight: number;
  at: number;
}

export interface RosterAgent {
  id: string;
  name: string;
  career: string;
  state: AgentState;
  goal: AgentGoal;
  relationships: AgentRelationship[];
  promises: AgentPromise[];
  memories: RosterMemory[];
}

/**
 * What the Agent loop has been doing this session (`KNOWN_ISSUES.md` `C-36`).
 *
 * `dropped` is the number this type exists for. A decision dropped for staleness writes one `info` line
 * into the world log, and **nothing renders that log** — so the Agent layer could stop using the model
 * entirely while the game looked completely normal. That is the same failure shape as `C-33`, and the
 * fix in both cases is the same: make the invisible thing countable.
 */
export interface AgentLoopStats {
  /** Decisions drained this session, from either provider. */
  decisions: number;
  /** Decisions dropped as stale instead of applied. */
  dropped: number;
  /** Ticks the most recent drop was late by, and the window it missed. */
  lastDrop: { ageTicks: number; limit: number } | null;
}

/** Everything the Agent channel shows. Composed by the host, which is the only side that knows both halves. */
export interface AgentChannelView {
  agents: RosterAgent[];
  stats: AgentLoopStats;
  /** So the panel can explain *why* drops happen: the window is one interval of real time (C-36). */
  speed: number;
}

/** Memories worth showing, most important first — the same ordering a decision sees. */
function memoryView(memories: readonly AgentMemory[]): RosterMemory[] {
  return recentMemories(memories, ROSTER_MEMORY_LIMIT).map((memory) => ({
    kind: memory.kind,
    tags: memory.kind === 'episodic' ? [...memory.tags] : [],
    weight: memory.weight,
    at: memory.at,
  }));
}

export function agentRosterView(w: WorldState): RosterAgent[] {
  return w.agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    career: agent.career,
    state: { ...agent.state },
    goal: { ...agent.goal },
    relationships: agent.relationships.map((relationship) => ({ ...relationship })),
    promises: agent.promises.map((promise) => ({ ...promise })),
    memories: memoryView(agent.memories),
  }));
}
