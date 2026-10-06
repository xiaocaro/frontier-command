import { describe, it, expect } from 'vitest';
import { quietEngine, issue, run, until } from './helpers';
import { gameCalendar, FIXED_DELTA } from '../src/engine/clock';
describe('fixed simulation clock and selective major pauses', () => {
  it.each([1, 4, 16] as const)('%sx changes step count only', (speed) => {
    const e = quietEngine();
    e.dispatchCommand({ type: 'speed', speed });
    e.dispatchCommand({ type: 'pause', paused: false });
    e.advanceFrame();
    expect(e.state.tick).toBe(speed);
    expect(e.state.time).toBe(speed / 10);
  });
  it('paused simulation freezes every state', () => {
    const e = quietEngine(),
      before = structuredClone(e.state);
    e.advanceFrame();
    e.step();
    expect(e.state).toEqual(before);
  });
  it('rejects variable deltas', () => {
    expect(() => quietEngine().step(0.5)).toThrow();
    expect(FIXED_DELTA).toBe(0.1);
  });
  it('midnight crosses exactly once', () => {
    const e = quietEngine();
    e.state.tick = 14399;
    e.state.time = 1439.9;
    e.state.paused = false;
    expect(e.step().filter((x) => x.type === 'dayBoundary')).toHaveLength(1);
    expect(e.step().filter((x) => x.type === 'dayBoundary')).toHaveLength(0);
    expect(gameCalendar(14400)).toEqual({ day: 2, hour: 0, minute: 0 });
  });
  it('normal discoveries and reports never pause', () => {
    const e = quietEngine();
    issue(e, { type: 'EXPLORE', sector: { q: 0, r: -1 }, approach: 'remote' });
    until(e, () => !e.state.ships[2].current);
    expect(e.state.paused).toBe(false);
    expect(e.state.pauseReasons).toEqual([]);
    expect(e.state.history.some((h) => h.kind === 'discovery')).toBe(true);
  });
  it('major damage pauses atomically before the rest of a fast batch', () => {
    const e = quietEngine();
    e.state.speed = 16;
    e.state.paused = false;
    e.hit(e.state.ships[0], 150);
    e.advanceFrame();
    expect(e.state.paused).toBe(true);
    expect(e.state.tick).toBe(1);
    expect(e.state.pauseReasons.some((r) => r.kind === 'lowHull')).toBe(true);
    const t = e.state.tick;
    run(e, 1);
    expect(e.state.tick).toBe(t + 10);
  });
});
