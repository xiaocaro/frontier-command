import { describe, expect, it, vi } from 'vitest';
import { AudioManager, type AudioCue, type AudioDriver } from '../src/ui/lcars/audio-manager';
import { defaultPreferences, parsePreferences } from '../src/ui/lcars/preferences';
import { placeLabels } from '../src/ui/map/camera';
it('keeps readable display-scaled map labels inside the viewport without overlapping', () => {
  const labels = Array.from({ length: 20 }, (_, i) => ({
    id: String(i),
    text: 'FEDERATION CONTACT ' + i,
    priority: i,
    color: '#fff',
    x: 200 + i * 10,
    y: 200,
  }));
  const placed = placeLabels(labels, 1280, 720, 1.5);
  expect(placed.length).toBeGreaterThan(0);
  expect(placed.length).toBeLessThan(labels.length);
  for (const p of placed) {
    expect(p.x - p.width / 2).toBeGreaterThanOrEqual(0);
    expect(p.x + p.width / 2).toBeLessThanOrEqual(1280);
    for (const other of placed.filter((x) => x.id !== p.id))
      expect(
        Math.abs(other.x - p.x) >= (p.width + other.width) / 2 || Math.abs(other.y - p.y) >= 30,
      ).toBe(true);
  }
});
describe('console preferences remain separate from world saves', () => {
  it('uses sound at 25% and respects the initial system motion preference', () => {
    expect(parsePreferences(null)).toEqual(defaultPreferences());
    expect(parsePreferences(null, true)).toEqual({
      version: 2,
      textScale: 1,
      interfaceZoom: 1,
      animations: 'reduced',
      sound: true,
      volume: 0.25,
    });
  });
  it('round trips all modes, clamps volume and rejects corrupt or future settings', () => {
    for (const animations of ['on', 'reduced', 'off'] as const)
      expect(
        parsePreferences(
          JSON.stringify({ version: 1, animations, sound: false, volume: 0.6 }),
          true,
        ),
      ).toEqual({ version: 2, textScale: 1, interfaceZoom: 1, animations, sound: false, volume: 0.6 });
    expect(parsePreferences('{')).toEqual(defaultPreferences());
    expect(parsePreferences('{"version":3,"animations":"off"}')).toEqual(defaultPreferences());
    expect(parsePreferences('{"version":1,"animations":"flash","sound":"on","volume":9}')).toEqual({
      ...defaultPreferences(),
      volume: 1,
    });
    expect(parsePreferences('{"version":1,"volume":-1}').volume).toBe(0);
  });
});
function fixture() {
  let time = 0,
    volume = 0,
    unlocked = 0;
  const starts: AudioCue[] = [],
    playing: { cue: AudioCue; stop: () => void; end: () => void }[] = [];
  const driver: AudioDriver = {
    unlock: () => {
      unlocked++;
    },
    setVolume: (v) => {
      volume = v;
    },
    start: (cue, ended) => {
      starts.push(cue);
      const voice = { cue, stop: () => {}, end: () => {} };
      voice.stop = voice.end = () => {
        const index = playing.indexOf(voice);
        if (index >= 0) playing.splice(index, 1);
        ended();
      };
      playing.push(voice);
      return voice.stop;
    },
  };
  const manager = new AudioManager(driver, () => time);
  return {
    manager,
    starts,
    playing,
    advance: (ms: number) => {
      time += ms;
    },
    volume: () => volume,
    unlocked: () => unlocked,
  };
}
describe('LCARS audio feedback', () => {
  it('delivers a terminal cue after the alert cooldown and cancels it when muted', () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      f.manager.unlock();
      f.manager.play('alert');
      f.advance(500);
      expect(f.manager.play('terminal', 'loss')).toBe(false);
      f.advance(1500);
      vi.advanceTimersByTime(1500);
      expect(f.starts).toEqual(['alert', 'terminal']);
      f.advance(500);
      f.manager.play('terminal', 'another-loss');
      f.manager.configure(false, 0.25);
      f.advance(2000);
      vi.advanceTimersByTime(2000);
      expect(f.starts).toEqual(['alert', 'terminal']);
    } finally {
      vi.useRealTimers();
    }
  });
  it('stays silent until interaction, immediately stops on mute and zero volume', () => {
    const f = fixture();
    expect(f.manager.play('alert', 'initial')).toBe(false);
    f.manager.unlock();
    expect(f.unlocked()).toBe(1);
    expect(f.manager.play('action')).toBe(true);
    f.manager.configure(false, 0.6);
    expect(f.volume()).toBe(0.6);
    expect(f.playing).toHaveLength(0);
    f.advance(3000);
    expect(f.manager.play('alert')).toBe(false);
    f.manager.configure(true, 0);
    expect(f.manager.play('action')).toBe(false);
    f.manager.configure(true, 0.1);
    expect(f.manager.play('action')).toBe(true);
  });
  it('deduplicates event IDs and spaces every alert by at least two seconds', () => {
    const f = fixture();
    f.manager.unlock();
    expect(f.manager.play('alert', 'comm-1')).toBe(true);
    f.playing[0].end();
    f.advance(1999);
    expect(f.manager.play('terminal', 'loss-1')).toBe(false);
    f.advance(1);
    expect(f.manager.play('terminal', 'loss-2')).toBe(true);
    f.playing[0].end();
    f.advance(2500);
    expect(f.manager.play('alert', 'comm-1')).toBe(false);
    expect(f.starts).toEqual(['alert', 'terminal']);
  });
  it('limits rapid operations and voices while prioritizing alerts', () => {
    const f = fixture();
    f.manager.unlock();
    for (let i = 0; i < 20; i++) {
      f.manager.play('navigation');
      f.advance(5);
    }
    expect(f.starts).toEqual(['navigation']);
    expect(f.manager.play('action')).toBe(true);
    expect(f.playing).toHaveLength(2);
    f.advance(100);
    expect(f.manager.play('commit')).toBe(false);
    expect(f.manager.play('alert')).toBe(true);
    expect(f.playing).toHaveLength(2);
    expect(f.playing.map((v) => v.cue)).toEqual(['action', 'alert']);
    f.advance(2000);
    expect(f.manager.play('terminal')).toBe(true);
    expect(f.playing.map((v) => v.cue)).toEqual(['terminal']);
  });
  it('does not let unavailable audio break a command or reserve stuck voices', () => {
    const manager = new AudioManager({
      unlock: () => {},
      setVolume: () => {},
      start: () => {
        throw Error('device unavailable');
      },
    });
    manager.unlock();
    expect(() => manager.play('navigation')).not.toThrow();
  });
});
