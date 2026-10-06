import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react';
import { AudioManager } from './audio-manager';
import { WebAudioDriver } from './web-audio';
import { parsePreferences, PREFERENCES_KEY, type ConsolePreferences } from './preferences';
const driver = new WebAudioDriver();
const audio = new AudioManager(driver);
interface LcarsContextValue {
  preferences: ConsolePreferences;
  updatePreferences: (patch: Partial<Omit<ConsolePreferences, 'version'>>) => void;
  audio: AudioManager;
}
const Context = createContext<LcarsContextValue | null>(null);
export function LcarsProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(() => {
    let raw: string | null = null;
    try {
      raw =
        localStorage.getItem(PREFERENCES_KEY) ?? localStorage.getItem('frontier.lcars.console.v1');
    } catch {
      /* Session preferences still work. */
    }
    return parsePreferences(raw, matchMedia('(prefers-reduced-motion: reduce)').matches);
  });
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--text-scale', String(preferences.textScale));
    const update = () => {
      const unit = parseFloat(getComputedStyle(document.documentElement).fontSize);
      document.documentElement.dataset.consoleLayout =
        innerWidth / unit >= 84 ? 'wide' : innerWidth / unit >= 68 ? 'medium' : 'compact';
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [preferences.textScale]);
  useEffect(() => {
    void window.frontier.setDisplayZoom(preferences.interfaceZoom);
  }, [preferences.interfaceZoom]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !['+', '=', '-', '0'].includes(event.key)) return;
      event.preventDefault();
      setPreferences((p) => ({
        ...p,
        interfaceZoom:
          event.key === '0'
            ? 1
            : Math.max(
                1,
                Math.min(
                  2,
                  Math.round((p.interfaceZoom + (event.key === '-' ? -0.1 : 0.1)) * 10) / 10,
                ),
              ),
      }));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.motion = preferences.animations;
    document.documentElement.dataset.sound = preferences.sound ? 'on' : 'off';
    audio.configure(preferences.sound, preferences.volume);
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    } catch {
      /* Storage can be unavailable. */
    }
  }, [preferences]);
  useEffect(() => {
    driver.prepare();
    const unlock = (event: Event) => {
      if (event.isTrusted) audio.unlock();
    };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
    return () => {
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
      audio.stop();
    };
  }, []);
  return (
    <Context.Provider
      value={{
        preferences,
        updatePreferences: (patch) => setPreferences((p) => ({ ...p, ...patch })),
        audio,
      }}
    >
      <div
        className="lcars-root"
        onChangeCapture={(event) => {
          const element = event.target as HTMLInputElement;
          if (element.dataset.sound === 'none') return;
          if (element.tagName === 'SELECT' || element.type === 'checkbox') audio.play('commit');
        }}
        onFocusCapture={(event) => {
          if (event.target instanceof HTMLInputElement)
            event.target.dataset.initialValue = event.target.value;
        }}
        onBlurCapture={(event) => {
          const element = event.target;
          if (
            element instanceof HTMLInputElement &&
            element.type === 'number' &&
            element.dataset.initialValue !== element.value
          )
            audio.play('commit');
        }}
      >
        {children}
      </div>
    </Context.Provider>
  );
}
export function useLcars() {
  const context = useContext(Context);
  if (!context) throw new Error('LCARS provider is required');
  return context;
}
