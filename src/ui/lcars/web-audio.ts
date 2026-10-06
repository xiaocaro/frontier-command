import beep1 from '../../assets/lcars-26/assets/beep1.mp3';
import beep2 from '../../assets/lcars-26/assets/beep2.mp3';
import beep3 from '../../assets/lcars-26/assets/beep3.mp3';
import beep4 from '../../assets/lcars-26/assets/beep4.mp3';
import picardKey from '../../assets/lcars-26/assets/picard-key.mp3';
import type { AudioCue, AudioDriver } from './audio-manager';
const sources: Record<AudioCue, string> = {
  navigation: beep1,
  action: beep2,
  alert: beep3,
  terminal: beep4,
  commit: picardKey,
};
// Original samples have different peaks, including an intersample peak above 1.
const gain: Record<AudioCue, number> = {
  navigation: 1,
  action: 0.8,
  alert: 0.55,
  terminal: 1,
  commit: 0.48,
};
export class WebAudioDriver implements AudioDriver {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private volume = 0.25;
  private buffers = new Map<AudioCue, Promise<AudioBuffer | null>>();
  prepare() {
    if (this.context) return;
    try {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.context.destination);
      for (const cue of Object.keys(sources) as AudioCue[]) {
        const context = this.context;
        this.buffers.set(
          cue,
          fetch(sources[cue])
            .then((r) => {
              if (!r.ok) throw new Error('Audio unavailable');
              return r.arrayBuffer();
            })
            .then((data) => context.decodeAudioData(data))
            .catch(() => null),
        );
      }
    } catch {
      this.context = null;
    }
  }
  unlock() {
    this.prepare();
    void this.context?.resume().catch(() => {});
  }
  setVolume(volume: number) {
    this.volume = volume;
    if (this.master) this.master.gain.value = volume;
  }
  start(cue: AudioCue, ended: () => void) {
    this.prepare();
    let cancelled = false,
      source: AudioBufferSourceNode | null = null;
    const requested = performance.now();
    void this.buffers
      .get(cue)
      ?.then((buffer) => {
        const context = this.context,
          master = this.master;
        if (
          cancelled ||
          !buffer ||
          !context ||
          !master ||
          performance.now() - requested > 600 ||
          context.state !== 'running'
        ) {
          ended();
          return;
        }
        source = context.createBufferSource();
        source.buffer = buffer;
        const level = context.createGain();
        level.gain.value = gain[cue];
        source.connect(level);
        level.connect(master);
        source.onended = () => {
          source?.disconnect();
          level.disconnect();
          ended();
        };
        source.start();
        window.dispatchEvent(new CustomEvent('lcars:cue', { detail: { cue } }));
      })
      .catch(() => ended());
    if (!this.buffers.has(cue)) ended();
    return () => {
      cancelled = true;
      try {
        source?.stop();
      } catch {
        /* Already ended. */
      }
      ended();
    };
  }
}
