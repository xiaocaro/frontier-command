export type AudioCue = 'navigation' | 'action' | 'alert' | 'terminal' | 'commit';
export interface AudioDriver {
  unlock(): void;
  setVolume(volume: number): void;
  start(cue: AudioCue, ended: () => void): () => void;
}
const priority: Record<AudioCue, number> = {
  navigation: 0,
  commit: 0,
  action: 1,
  alert: 2,
  terminal: 3,
};
/** UI feedback only: this clock never participates in simulation or saving. */
export class AudioManager {
  private enabled = true;
  private volume = 0.25;
  private unlocked = false;
  private last = -Infinity;
  private lastAlert = -Infinity;
  private cues = new Map<AudioCue, number>();
  private events = new Set<string>();
  private voices = new Map<symbol, { priority: number; stop: () => void }>();
  private pendingTerminal: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private driver: AudioDriver,
    private now: () => number = () => performance.now(),
  ) {}
  unlock() {
    this.unlocked = true;
    this.driver.unlock();
  }
  configure(enabled: boolean, volume: number) {
    this.enabled = enabled;
    this.volume = Math.max(0, Math.min(1, volume));
    this.driver.setVolume(this.volume);
    if (!enabled || this.volume === 0) this.stop();
  }
  stop() {
    this.cancelPending();
    for (const voice of this.voices.values()) voice.stop();
    this.voices.clear();
  }
  cancelPending() {
    clearTimeout(this.pendingTerminal);
    this.pendingTerminal = undefined;
  }
  play(cue: AudioCue, eventId?: string): boolean {
    if (!this.enabled || !this.unlocked || this.volume === 0) return false;
    if (eventId) {
      if (this.events.has(eventId)) return false;
      this.events.add(eventId);
      if (this.events.size > 256) this.events.delete(this.events.values().next().value!);
    }
    const time = this.now(),
      urgent = priority[cue] >= 2;
    const remaining = Math.max(
      (urgent ? 2000 : 150) - (time - (this.cues.get(cue) ?? -Infinity)),
      urgent ? 2000 - (time - this.lastAlert) : 0,
    );
    if (remaining > 0) {
      // A terminal event remains meaningful after a recent warning. Deliver one
      // cue after the shared cooldown, without building a queue of old alerts.
      if (cue === 'terminal' && this.pendingTerminal === undefined)
        this.pendingTerminal = setTimeout(() => {
          this.pendingTerminal = undefined;
          this.play('terminal');
        }, remaining);
      return false;
    }
    if (!urgent && time - this.last < 80) return false;
    if (cue === 'terminal') this.stop();
    if (this.voices.size >= 2) {
      const victim = [...this.voices].find(([, v]) => v.priority < priority[cue]);
      if (!victim) return false;
      victim[1].stop();
      this.voices.delete(victim[0]);
    }
    const id = Symbol(cue);
    this.voices.set(id, { priority: priority[cue], stop: () => {} });
    this.last = time;
    this.cues.set(cue, time);
    if (urgent) this.lastAlert = time;
    try {
      const stop = this.driver.start(cue, () => this.voices.delete(id));
      const voice = this.voices.get(id);
      if (voice) voice.stop = stop;
      return true;
    } catch {
      this.voices.delete(id);
      return false;
    }
  }
}
