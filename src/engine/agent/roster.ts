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
import { ADMIRAL } from './dialogue';
import { recentMemories } from './memory';
import type {
  AgentGoal,
  AgentMemory,
  AgentMessage,
  AgentMessageKind,
  AgentPromise,
  AgentRelationship,
  AgentState,
} from './types';

/** How many memories the panel shows. Bounded so the payload is small and the panel readable. */
export const ROSTER_MEMORY_LIMIT = 6;

/** How many transcript lines the panel shows. Bounded for the same reason, and to match `agentMessages`' own cap. */
export const TRANSCRIPT_LIMIT = 20;

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
  /**
   * Of those, the ones the **model** actually produced.
   *
   * Distinct from `decisions` on purpose, and the distinction is the whole point: a decision whose
   * beat did not warrant a model call, or whose provider failed, is still a decision — it is answered
   * by the deterministic rule. So "how many times did the model contribute?" is this number, and
   * `decisions - modelCalls` is how often the game carried on without it. Reporting `decisions` under
   * a "model calls" label would be the same kind of quiet inaccuracy as `C-33` and `C-36`.
   */
  modelCalls: number;
  /** Decisions dropped as stale instead of applied. */
  dropped: number;
  /** Ticks the most recent drop was late by, and the window it missed. */
  lastDrop: { ageTicks: number; limit: number } | null;
}

/**
 * One line of the Admiral's correspondence with the Agents.
 *
 * The panel had no way to show what had been said. Sending cleared the box, and the answer only ever
 * appeared as a mirrored string in the Communications feed — so "what did I ask, and what did he
 * say?" lived in the feed alone, and a late answer never reached the panel at all.
 *
 * **This is the same conversation as the feed's mirrored line** (`command-system.ts` N-6), read as
 * structure instead of as the display string `NAME ← NAME：text`. That is why it is built from
 * `agentMessages` and not by parsing `communications`: the mirror is built *to be read*, and
 * recovering speaker, listener and text from it means a regex over names that contain spaces and a
 * full-width colon — the demo already carries exactly such a parser, with a fallback.
 *
 * Two fields are withheld, both for the same reason as `nextDecisionAt` below — they are machinery
 * rather than anything the Admiral was told:
 *
 *  - **`payload`** carries ids (a `promiseId`, a `requestingAgentId`) that this panel never shows.
 *  - **`read`** says whether an *Agent* has consumed the line. Note it is deliberately not a filter
 *    either: `consumeAnswered` marks the Admiral's own message read the moment the Agent answers it,
 *    so filtering on `read` would hide precisely the message the answer is about.
 */
export interface AgentTranscriptEntry {
  id: string;
  at: number;
  /** `'admiral'`, or an Agent id. */
  from: string;
  to: string;
  /** Resolved here so the panel does not need the id table, and the names match the feed's. */
  fromName: string;
  toName: string;
  kind: AgentMessageKind;
  text: string;
}

/** Everything the Agent channel shows. Composed by the host, which is the only side that knows both halves. */
export interface AgentChannelView {
  agents: RosterAgent[];
  stats: AgentLoopStats;
  /** So the panel can explain *why* drops happen: the window is one interval of real time (C-36). */
  speed: number;
  /** The Admiral's own correspondence, oldest first. The panel renders it newest-first. */
  messages: AgentTranscriptEntry[];
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

/** A line the Admiral is party to — either he spoke it, or it was spoken to him. */
function isAdmiralLine(message: AgentMessage): boolean {
  return message.from === ADMIRAL || message.to === ADMIRAL;
}

/**
 * The Admiral's correspondence, **oldest first** — the array's own order, which is already
 * chronology, so a reply is simply the line after the message it answers. There is no reply-to id in
 * the message model and this does not invent one: `consumeAnswered` was left deliberately blunt
 * (`command-system.ts`), and ordering is what the feed already relies on.
 *
 * Agent-to-Agent traffic is excluded, because it is not the Admiral's correspondence and the feed
 * carries it only as trivia.
 */
export function agentTranscriptView(w: WorldState): AgentTranscriptEntry[] {
  const names = new Map<string, string>(w.agents.map((agent) => [agent.id, agent.name]));
  names.set(ADMIRAL, w.commander.name);
  return w.agentMessages
    .filter(isAdmiralLine)
    .slice(-TRANSCRIPT_LIMIT)
    .map((message) => ({
      id: message.id,
      at: message.at,
      from: message.from,
      to: message.to,
      fromName: names.get(message.from) ?? message.from,
      toName: names.get(message.to) ?? message.to,
      kind: message.kind,
      text: message.text,
    }));
}
