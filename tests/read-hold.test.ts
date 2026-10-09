/**
 * The two-second hold after an Agent answers the Admiral (`electron/read-hold.ts`).
 *
 * The timer is the easy part; **ownership** is what this file is really about. This is the project's
 * first automatic resume — every other pause waits for a human — so the failure that matters is the
 * hold clearing a pause that belongs to a threat alarm, a failed save or the player. That rule is a
 * pure function of world state, which is why it lives in its own module and is tested here without
 * booting Electron.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_READ_HOLD_MS,
  holdStillOwns,
  MAX_READ_HOLD_MS,
  ReadHold,
  readHoldMsFromEnv,
} from '../electron/read-hold';
import type { CriticalReason, WorldState } from '../src/engine/types';

type Holdable = Pick<WorldState, 'paused' | 'status' | 'pauseReasons'>;

const reason: CriticalReason = {
  kind: 'newContact',
  entityId: 'orion-raider-1',
  tick: 10,
  time: 1,
  message: 'Orion 舰船进入传感器范围',
};

describe('the hold length comes from the environment, and a typo is not a setting', () => {
  it('defaults when unset or unreadable', () => {
    expect(readHoldMsFromEnv({})).toBe(DEFAULT_READ_HOLD_MS);
    expect(readHoldMsFromEnv({ FRONTIER_READ_HOLD_MS: '' })).toBe(DEFAULT_READ_HOLD_MS);
    expect(readHoldMsFromEnv({ FRONTIER_READ_HOLD_MS: '  ' })).toBe(DEFAULT_READ_HOLD_MS);
    expect(readHoldMsFromEnv({ FRONTIER_READ_HOLD_MS: 'soon' })).toBe(DEFAULT_READ_HOLD_MS);
    // Negative is a typo, not a request to disable — `0` is how you disable it, out loud.
    expect(readHoldMsFromEnv({ FRONTIER_READ_HOLD_MS: '-1' })).toBe(DEFAULT_READ_HOLD_MS);
  });

  it('reads a real value, rounds it, and disables on exactly 0', () => {
    expect(readHoldMsFromEnv({ FRONTIER_READ_HOLD_MS: '0' })).toBe(0);
    expect(readHoldMsFromEnv({ FRONTIER_READ_HOLD_MS: '1500' })).toBe(1500);
    expect(readHoldMsFromEnv({ FRONTIER_READ_HOLD_MS: '1500.6' })).toBe(1501);
  });

  it('caps a value that would freeze the game for an hour', () => {
    expect(readHoldMsFromEnv({ FRONTIER_READ_HOLD_MS: '3600000' })).toBe(MAX_READ_HOLD_MS);
  });
});

describe('the hold only resumes a pause it applied itself', () => {
  it('owns a bare pause on an active world', () => {
    expect(holdStillOwns({ paused: true, status: 'active', pauseReasons: [] })).toBe(true);
  });

  it('does not own a world that is running, or lost, or paused for a reason', () => {
    expect(holdStillOwns({ paused: false, status: 'active', pauseReasons: [] })).toBe(false);
    // `commandLost` pauses the world too, and it is not ours to release.
    expect(holdStillOwns({ paused: true, status: 'commandLost', pauseReasons: [] })).toBe(false);
    // Every pause the engine raises on its own carries at least one reason.
    expect(holdStillOwns({ paused: true, status: 'active', pauseReasons: [reason] })).toBe(false);
  });
});

/** A fake clock, so the tests never sleep. Injectable timers are the seam `ReadHold` exposes. */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    setTimer(run: () => void, ms: number) {
      const id = nextId++;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimer(handle: unknown) {
      timers.delete(handle as number);
    },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at > now) continue;
        timers.delete(id);
        timer.run();
      }
    },
    get pending() {
      return timers.size;
    },
  };
}

function harness(ms: number) {
  const clock = fakeClock();
  const world: Holdable = { paused: false, status: 'active', pauseReasons: [] };
  const applied: boolean[] = [];
  const hold = new ReadHold({
    ms,
    apply: (paused) => {
      applied.push(paused);
      world.paused = paused;
      if (!paused) world.pauseReasons = [];
    },
    isPaused: () => world.paused,
    stillOurs: () => holdStillOwns(world),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { hold, clock, applied, world };
}

describe('the hold pauses on an answer and lets go after it', () => {
  it('pauses once, resumes once, and leaves no timer behind', () => {
    const { hold, clock, applied } = harness(2000);
    hold.arm();
    expect(applied).toEqual([true]);
    expect(clock.pending).toBe(1);

    clock.advance(1999);
    expect(applied).toEqual([true]);

    clock.advance(1);
    expect(applied).toEqual([true, false]);
    expect(clock.pending).toBe(0);
  });

  it('extends rather than stacks when a second answer arrives mid-hold', () => {
    const { hold, clock, applied } = harness(2000);
    hold.arm();
    clock.advance(1500);
    hold.arm();
    // Still one pause: the second answer moved the deadline, it did not pause a paused world.
    expect(applied).toEqual([true]);

    clock.advance(1500);
    expect(applied).toEqual([true]);
    clock.advance(500);
    expect(applied).toEqual([true, false]);
  });

  it('never starts from a world someone else has already paused', () => {
    const { hold, clock, applied, world } = harness(2000);
    world.paused = true; // a save failed, or the player pressed 暂停
    hold.arm();
    expect(applied).toEqual([]);
    expect(clock.pending).toBe(0);
  });

  it('leaves a pause standing if it changed hands during the hold', () => {
    const { hold, clock, applied, world } = harness(2000);
    hold.arm();
    // A threat alarm lands a reason on the pause while the hold is counting down. The world is still
    // paused, but it is no longer the hold's pause, and resuming would swallow the alarm.
    world.pauseReasons = [reason];
    clock.advance(2000);
    expect(applied).toEqual([true]);
  });

  it('cannot tell a bare pause from its own — which is why every other writer disarms', () => {
    // The one state the predicate cannot distinguish: an active world, paused, with no reason
    // recorded. The hold resumes it, and that is deliberate rather than overlooked — the alternatives
    // all carry a signal (`pauseReasons` for a critical pause, `status` for a lost command), and the
    // no-reason pauses in `electron/main.ts` are all covered by an explicit `disarm()`, which this
    // test bypasses by writing the world directly. The module comment says so, and so does C-41.
    const { hold, clock, applied, world } = harness(2000);
    hold.arm();
    world.paused = false;
    world.paused = true;
    clock.advance(2000);
    expect(applied).toEqual([true, false]);
  });
});

describe('disarm and disable', () => {
  it('disarm cancels the timer and never touches the world', () => {
    const { hold, clock, applied, world } = harness(2000);
    hold.arm();
    hold.disarm();
    expect(clock.pending).toBe(0);
    // The player's pause owns the world now; the hold just stops counting.
    expect(world.paused).toBe(true);
    clock.advance(5000);
    expect(applied).toEqual([true]);
  });

  it('disarm is idempotent', () => {
    const { hold, applied } = harness(2000);
    hold.arm();
    hold.disarm();
    hold.disarm();
    expect(applied).toEqual([true]);
  });

  it('a zero hold is disabled outright', () => {
    const { hold, clock, applied } = harness(0);
    hold.arm();
    expect(applied).toEqual([]);
    expect(clock.pending).toBe(0);
  });

  it('dispose stops the hold and refuses to arm again', () => {
    const { hold, clock, applied } = harness(2000);
    hold.dispose();
    hold.arm();
    expect(applied).toEqual([]);
    expect(clock.pending).toBe(0);
  });
});
