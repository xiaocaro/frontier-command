/**
 * The scheduler (docs/lv3/03-api-contract.md §4.6, docs/lv3/02-decision-flow.md §3).
 *
 * One question, and only one: **when should an Agent think?** Not *what* it should think (the runtime
 * and the model own that), not *whether the answer is legal* (the engine owns that). Everything here
 * is about not asking too often, not asking twice at once, and not asking when the answer would be
 * worthless.
 *
 * ```text
 * engine branches ──AgentTrigger──▶ notify()      merge into one marker per Agent
 * host frame       ──pump()──────▶                drain finished · start due · advance the beat
 *                                      │
 *                                      └──▶ DecisionRuntime.requestDecision()   async, never awaited
 * ```
 *
 * Three properties are load-bearing:
 *
 *  1. **`pump()` never awaits** (§8.3). It starts requests and returns. The host calls it from a
 *     `setInterval`; blocking there would stall the simulation behind the network.
 *  2. **The async continuation touches only this object's own queue.** A resolved promise sets a
 *     flag; the *next* `pump()`, on the host thread, is what advances anything.
 *  3. **Exactly one field of the world is written, and only from `pump()`** — `Agent.nextDecisionAt`
 *     (§13.2 of the plan). It has to be written somewhere: it is the cooldown, and it must persist so
 *     that loading a save does not fire the whole roster at once (`S-9`, `S-10`).
 *
 * The world arrives as a **port** rather than as the engine. That keeps this module free of any
 * engine import (the boundary suite forbids it), keeps the write scope down to one named method
 * (`writeBeat`), and lets the tests drive all eleven scheduler cases from a fake world with a fake
 * clock — no Electron, no `SimulationEngine`, no network (`S-11`).
 */
import { evaluate } from '../../src/engine/agent/decision';
import { RULES } from '../../src/engine/definitions/rules';
import type { AgentObservation, AgentTrigger } from '../../src/engine/agent/types';
import { scoringAgent, type DecisionOutcome, type DecisionRuntime } from './runtime';

/**
 * Which triggers are worth a model call (docs/lv3/02-decision-flow.md §3.4).
 *
 * The high set is §3.4's list — a new contract, an Agent conflict or invitation, a major event, a
 * broken promise. The low set is routine: a ship going idle, a directive finishing, the periodic
 * beat. A low-priority trigger is **not** forbidden from reaching the model; see
 * {@link AgentScheduler.consult} for the second half of the rule.
 */
const HIGH_PRIORITY: ReadonlySet<AgentTrigger['kind']> = new Set([
  'admiral-message',
  'agent-request',
  'world-event',
  'danger',
  'directive-failed',
  'promise-changed',
  'high-value-opportunity',
]);

export function isHighPriorityTrigger(kind: AgentTrigger['kind']): boolean {
  return HIGH_PRIORITY.has(kind);
}

/** The Agent fields the scheduler reads. Deliberately not the whole `Agent`. */
export interface ScheduledAgent {
  readonly id: string;
  /** Game minute at which this Agent's beat next comes due. */
  readonly nextDecisionAt: number;
}

/**
 * Everything the scheduler is allowed to know about the world.
 *
 * Note what is missing: no engine, no state object, no way to change anything except `writeBeat`.
 * The adapter that satisfies this from the real engine lives in the host (see
 * `docs/lv3/07-scheduler-plan.md` §4.2) — which is also where trigger addressing is resolved.
 */
export interface SchedulerWorld {
  /** Simulated time, in game minutes. */
  time(): number;
  isPaused(): boolean;
  isActive(): boolean;
  agents(): readonly ScheduledAgent[];
  /**
   * Which Agents a raw trigger concerns.
   *
   * This is the engine's job, not the scheduler's: `AgentTrigger` does not carry the target Agent
   * (a `ship-idle` names a ship, an `admiral-message` names a message, and `agent-request` names the
   * *sender* while it is the *recipient* who must decide). Only the engine knows the addressing, so
   * only the engine can answer this. See plan §13.5.
   */
  agentsForTrigger(trigger: AgentTrigger): string[];
  /** `N-1`: the Agent's ship has no current, queued or suspended directive. */
  isIdle(agentId: string): boolean;
  /** The Agent's own view, or `null` when it has no ship bound. */
  observe(agentId: string): AgentObservation | null;
  /** The id of the directive the Agent's ship is running, or `null`. Used for `C-17` liveness. */
  currentDirectiveId(agentId: string): string | null;
  /** The scheduler's **one** write into the world. See plan §13.2. */
  writeBeat(agentId: string, at: number): void;
  log(message: string, level: 'info' | 'warning'): void;
}

/**
 * What is being held for one Agent between a trigger arriving and its beat coming due.
 *
 * Keyed by Agent, so N triggers for the same Agent are **one** entry — that is the coalescing of
 * §3.3 / `S-2`, and it is why this is a `Map` rather than a list.
 */
interface Marker {
  triggers: AgentTrigger[];
  /** `C-17`: the directive that disappeared without a completion event reaching us. */
  lostDirectiveId: string | null;
}

/** An in-flight decision. Never awaited; drained by a later `pump()`. */
export interface PendingDecision {
  readonly agentId: string;
  readonly decisionId: string;
  readonly observation: AgentObservation;
  readonly triggeredBy: AgentTrigger['kind'][];
  readonly consulted: boolean;
  resolved: boolean;
  outcome: DecisionOutcome | null;
  failure: string | null;
}

export interface SchedulerOptions {
  world: SchedulerWorld;
  runtime: DecisionRuntime;
  /** Model calls allowed per game minute (§3.3, `S-4`). Default 1. */
  callsPerMinute?: number;
  /** Called once per decision, when it is drained. Observability and tests. */
  onDecision?: (agentId: string, outcome: DecisionOutcome) => void;
}

export class AgentScheduler {
  private readonly world: SchedulerWorld;
  private readonly runtime: DecisionRuntime;
  private readonly callsPerMinute: number;
  private readonly onDecision: ((agentId: string, outcome: DecisionOutcome) => void) | undefined;

  private readonly pending = new Map<string, PendingDecision>();
  private readonly markers = new Map<string, Marker>();
  /** Directives the scheduler has seen running, per Agent — `C-17` bookkeeping. */
  private readonly directiveSeen = new Map<string, string>();
  /** Agents whose directive ended with a proper event this frame, so it was not "lost". */
  private readonly settledThisFrame = new Set<string>();

  private callMinute = Number.NEGATIVE_INFINITY;
  private callsThisMinute = 0;

  constructor(options: SchedulerOptions) {
    this.world = options.world;
    this.runtime = options.runtime;
    this.callsPerMinute = options.callsPerMinute ?? 1;
    this.onDecision = options.onDecision;
  }

  /**
   * Feed this frame's triggers in. Synchronous, and safe to call with an empty list.
   *
   * Triggers are merged per Agent, and are *not* acted on here — `pump()` decides whether the beat
   * has come due. That split is what lets a burst of triggers during a cooldown collapse into a
   * single decision instead of a queue of them.
   */
  notify(triggers: readonly AgentTrigger[]): void {
    for (const trigger of triggers) {
      if (trigger.kind === 'directive-completed' || trigger.kind === 'directive-failed')
        for (const agentId of this.world.agentsForTrigger(trigger))
          this.settledThisFrame.add(agentId);
      for (const agentId of this.world.agentsForTrigger(trigger))
        this.markerFor(agentId).triggers.push(trigger);
    }
  }

  /**
   * One host frame. Synchronous; never awaits.
   *
   * Order matters: drain first (so a finished decision frees the Agent's single-flight slot in the
   * same frame it lands), then start. `C-17` runs first of all, because a vanished directive must be
   * able to produce a decision *this* frame — an Agent that never learns its task died is an Agent
   * that never acts again.
   */
  pump(): void {
    const world = this.world;
    if (world.isPaused() || !world.isActive()) return; // S-5

    const now = world.time();
    this.trackDirectives();
    this.drain(now);

    for (const agent of world.agents()) {
      if (this.pending.has(agent.id)) continue; // S-1 single-flight
      const marker = this.markers.get(agent.id);
      const urgent = marker !== undefined && this.isUrgent(marker);
      const beatDue = now >= agent.nextDecisionAt;
      // §13.6: a low-priority trigger waits for the beat; a high-priority one pierces the cooldown.
      if (!beatDue && !urgent) continue;
      if (!world.isIdle(agent.id)) continue; // N-1: defer, never retry
      const observation = world.observe(agent.id);
      if (observation === null) continue;
      this.markers.delete(agent.id);
      this.start(agent.id, observation, marker);
    }

    this.settledThisFrame.clear();
  }

  /** How many Agents are holding a merged marker. `S-2`'s "one marker" is a size of one. */
  queuedCount(): number {
    return this.markers.size;
  }

  /** How many decisions are in flight. `S-1` asserts this never exceeds one per Agent. */
  inFlightCount(): number {
    return this.pending.size;
  }

  // --- internals -------------------------------------------------------------------------------

  private markerFor(agentId: string): Marker {
    const existing = this.markers.get(agentId);
    if (existing) return existing;
    const marker: Marker = { triggers: [], lostDirectiveId: null };
    this.markers.set(agentId, marker);
    return marker;
  }

  private isUrgent(marker: Marker): boolean {
    return (
      marker.lostDirectiveId !== null ||
      marker.triggers.some((trigger) => isHighPriorityTrigger(trigger.kind))
    );
  }

  /**
   * `C-17`. An Agent's directive can be cleared by the engine without any event (`fleet.ts` does
   * exactly that when a ship breaks off in an emergency). Left undetected, the Agent waits forever
   * for a completion that will never come — and with single-flight plus the cooldown, it never
   * recovers. So a directive that was seen and is now gone, without a settlement event, becomes a
   * failure the Agent gets to react to.
   */
  private trackDirectives(): void {
    for (const agent of this.world.agents()) {
      const current = this.world.currentDirectiveId(agent.id);
      if (current !== null) {
        this.directiveSeen.set(agent.id, current);
        continue;
      }
      const seen = this.directiveSeen.get(agent.id);
      if (seen === undefined) continue;
      this.directiveSeen.delete(agent.id);
      if (this.settledThisFrame.has(agent.id)) continue; // it completed normally
      this.markerFor(agent.id).lostDirectiveId = seen;
    }
  }

  /** Apply every decision that has finished. The only place the beat advances. */
  private drain(now: number): void {
    for (const [agentId, decision] of [...this.pending]) {
      if (!decision.resolved) continue;
      this.pending.delete(agentId);
      this.world.writeBeat(agentId, now + RULES.agentDecisionInterval); // S-9
      if (decision.failure !== null) {
        this.world.log('Agent ' + agentId + ' 的决策失败：' + decision.failure, 'warning');
        continue;
      }
      if (decision.outcome !== null && this.onDecision) this.onDecision(agentId, decision.outcome);
    }
  }

  /**
   * Should this beat reach the model? (§13.3)
   *
   * A high-priority trigger always does. A low-priority one does only when the deterministic score
   * lands in `consult-llm` — the 45–69 band, which is precisely the band whose fallback is a
   * deliberate `wait`. Without that second clause, "a routine directive finished and the situation
   * happens to be genuinely ambiguous" could never get a judgement.
   */
  private consult(observation: AgentObservation, urgent: boolean): boolean {
    if (urgent) return true;
    return evaluate(scoringAgent(observation), observation).band === 'consult-llm';
  }

  private allowCall(): boolean {
    const minute = Math.floor(this.world.time());
    if (minute !== this.callMinute) {
      this.callMinute = minute;
      this.callsThisMinute = 0;
    }
    if (this.callsThisMinute >= this.callsPerMinute) return false;
    this.callsThisMinute += 1;
    return true;
  }

  /**
   * Start one decision. Registers the single-flight slot **before** the request, so a trigger
   * arriving while it is in flight merges into a marker instead of starting a second one.
   */
  private start(agentId: string, observation: AgentObservation, marker: Marker | undefined): void {
    const urgent = marker !== undefined && this.isUrgent(marker);
    const asked = this.consult(observation, urgent);
    const budgeted = asked && this.allowCall(); // S-4

    const decision: PendingDecision = {
      agentId,
      decisionId: agentId + '@' + observation.tick,
      observation,
      triggeredBy: (marker?.triggers ?? []).map((trigger) => trigger.kind),
      consulted: budgeted,
      resolved: false,
      outcome: null,
      failure: null,
    };
    this.pending.set(agentId, decision);

    let request: Promise<DecisionOutcome>;
    try {
      request = budgeted
        ? this.runtime.requestDecision(observation)
        : this.runtime.requestDecision(observation, {
            skipProvider: true,
            reason: asked
              ? '本游戏分钟的模型调用额度已用尽，按确定性规则作答。'
              : '这一拍不值得调用模型，按确定性规则作答。',
          });
    } catch (error) {
      // The runtime is not supposed to throw synchronously; if it ever does, it is still not a
      // reason to take the host loop down (N-9).
      decision.failure = String(error);
      decision.resolved = true;
      return;
    }

    // Fire and forget. Only this object's own queue is touched, and only after `pump()` returned.
    void request.then(
      (outcome) => {
        decision.outcome = outcome;
        decision.resolved = true;
      },
      (error: unknown) => {
        decision.failure = String(error);
        decision.resolved = true;
      },
    );
  }
}
