/**
 * The two-second hold after an Agent answers the Admiral.
 *
 * An answer to the Admiral arrives as a new line in the Communications feed, and the world carries
 * straight on — at 16× the line is a memory before it is read. So the host pauses the world when an
 * Agent has spoken and lets it go again a moment later.
 *
 * **Why the host and not the engine.** This is wall-clock scheduling, not a simulation rule:
 * `docs/architecture.md` allows the host to schedule its own work but never to decide movement,
 * combat or inventory. The hold applies an ordinary `pause` Command, so `WorldState` is still written
 * only through the command door and the engine stays authoritative (CLAUDE.md §2.1). A pause advances
 * nothing, so it cannot perturb the fixed-step simulation or same-seed replay.
 *
 * **Why this is its own module.** The resume is the first automatic one in the project — every other
 * pause waits for a human — so the dangerous part is not the timer but *ownership*: resuming a pause
 * that belongs to a threat alarm, a broken save or the player would be a real bug. That rule is a
 * pure function of state, so it lives here and is tested on its own rather than behind Electron.
 *
 * **What it cannot see.** `pauseReasons` and `status` distinguish a critical pause, but a pause with
 * no reason and an active world is indistinguishable from ours whoever set it — `main.ts` pauses
 * exactly that way when a save fails or a write throws. So `arm()` refuses to start from an
 * already-paused world, and `disarm()` is called at each of those writers instead of being guessed
 * at. A future no-reason pause written outside `main.ts` must call `disarm()` too.
 *
 * Pure module: no Electron, no engine, no agent layer, no clock of its own (the timer is injected).
 */
import type { WorldState } from '../src/engine/types';

export const DEFAULT_READ_HOLD_MS = 2000;

/** A ceiling, so a typo in the environment cannot freeze the game for an hour. */
export const MAX_READ_HOLD_MS = 60_000;

/**
 * The hold in milliseconds, from `FRONTIER_READ_HOLD_MS`.
 *
 * `0` disables it, which is what the E2E specs set: the specs drive the world in wall-clock time, and
 * a freeze an Agent can trigger at any moment would make them flaky for reasons that have nothing to
 * do with what they assert. Anything unreadable — empty, not a number, negative — falls back to the
 * default rather than silently disabling the feature, because a typo should not look like a setting.
 */
export function readHoldMsFromEnv(env: NodeJS.ProcessEnv): number {
  const raw = env.FRONTIER_READ_HOLD_MS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_READ_HOLD_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return DEFAULT_READ_HOLD_MS;
  return Math.min(Math.round(value), MAX_READ_HOLD_MS);
}

/**
 * Whether the pause in effect is still the one the hold applied.
 *
 * `active` and no reasons rule out every pause the engine raises on its own: a critical pause always
 * carries at least one reason, and `commandLost` changes the status. What is left is a bare pause —
 * which is exactly what the hold applies, and also what `main.ts` applies when a save fails, so the
 * hold is never armed there (`arm()` will not start from a paused world) and is disarmed at those
 * sites anyway.
 */
export function holdStillOwns(
  state: Pick<WorldState, 'paused' | 'status' | 'pauseReasons'>,
): boolean {
  return state.paused && state.status === 'active' && state.pauseReasons.length === 0;
}

export interface ReadHoldOptions {
  /** How long to hold, in milliseconds. `0` disables the hold entirely. */
  ms: number;
  /** Pause or resume the world. Called at most once per transition. */
  apply: (paused: boolean) => void;
  /** Whether the world is paused right now, whoever did it. */
  isPaused: () => boolean;
  /** Whether the pause in effect is still ours — `holdStillOwns(engine.state)`. */
  stillOurs: () => boolean;
  /** Injected so a test can drive the clock instead of sleeping. */
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Hold the world for a moment after an Agent speaks, then let it go.
 *
 * `arm()` is safe to call on every answer: a second one while still holding *extends* the window
 * rather than stacking, so two answers a second apart read as one hold, not two.
 */
export class ReadHold {
  private holding = false;
  private disposed = false;
  private handle: unknown = null;

  constructor(private readonly options: ReadHoldOptions) {}

  arm(): void {
    if (this.disposed || this.options.ms <= 0) return;
    if (!this.holding) {
      // Never adopt someone else's pause: we would be resuming it two seconds later, and it is not
      // ours to release. A hold can only begin from a running world.
      if (this.options.isPaused()) return;
      this.holding = true;
      this.options.apply(true);
    }
    this.schedule();
  }

  /**
   * Give up the hold without touching the world.
   *
   * Called wherever a pause is applied or lifted by someone else — the player, a session switch, a
   * failed save. The pause belongs to them now, so the most this can do is stop counting.
   */
  disarm(): void {
    this.cancel();
    this.holding = false;
  }

  dispose(): void {
    this.disposed = true;
    this.disarm();
  }

  private schedule(): void {
    this.cancel();
    const setTimer =
      this.options.setTimer ?? ((run, ms) => setTimeout(run, ms) as unknown as NodeJS.Timeout);
    this.handle = setTimer(() => this.release(), this.options.ms);
  }

  private cancel(): void {
    if (this.handle === null) return;
    const clearTimer = this.options.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
    clearTimer(this.handle);
    this.handle = null;
  }

  private release(): void {
    this.handle = null;
    const wasOurs = this.holding;
    this.holding = false;
    // Only if the pause standing now is still the one we applied. If the world has been paused for a
    // reason, or resumed and paused again by someone else, resuming here would clear their pause.
    if (wasOurs && this.options.stillOurs()) this.options.apply(false);
  }
}
