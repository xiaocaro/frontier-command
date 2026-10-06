import { useLcars } from './LcarsProvider';
import { LcarsButton, LcarsDrawer, LcarsField, LcarsPanel } from '../components/Lcars';
import type { AnimationMode } from './preferences';
import emblem from '../../assets/lcars-26/assets/sfcmd.png';
export function ConsoleSettings({ close }: { close: () => void }) {
  const { preferences, updatePreferences } = useLcars();
  return (
    <LcarsDrawer
      title="CONSOLE CONFIGURATION"
      label="控制台设置"
      onClose={close}
      className="console-settings"
    >
      <p className="panel-intro">LIBRARY COMPUTER ACCESS / RETRIEVAL SYSTEM</p>
      <LcarsPanel title="DISPLAY / TEXT 显示与文字">
        <LcarsField>
          TEXT SIZE 文字大小 <output>{Math.round(preferences.textScale * 100)}%</output>
          <input
            aria-label="文字大小"
            type="range"
            data-sound="none"
            min="100"
            max="200"
            step="5"
            value={Math.round(preferences.textScale * 100)}
            onChange={(e) => updatePreferences({ textScale: Number(e.target.value) / 100 })}
          />
        </LcarsField>
        <LcarsField>
          INTERFACE ZOOM 界面缩放 <output>{Math.round(preferences.interfaceZoom * 100)}%</output>
          <input
            aria-label="界面缩放"
            type="range"
            data-sound="none"
            min="100"
            max="200"
            step="10"
            value={Math.round(preferences.interfaceZoom * 100)}
            onChange={(e) => updatePreferences({ interfaceZoom: Number(e.target.value) / 100 })}
          />
        </LcarsField>
        <p>
          Ctrl + 加减：界面缩放 · Ctrl + 0：复位界面缩放。文字大小独立保存，小窗口不会强制缩字。
        </p>
      </LcarsPanel>
      <LcarsPanel title="ANIMATIONS">
        <div className="settings-switch" role="group" aria-label="ANIMATIONS">
          {(['on', 'reduced', 'off'] as AnimationMode[]).map((mode) => (
            <LcarsButton
              key={mode}
              aria-pressed={preferences.animations === mode}
              sound="commit"
              onClick={() => updatePreferences({ animations: mode })}
            >
              {mode.toUpperCase()}
            </LcarsButton>
          ))}
        </div>
        <p className="muted">
          ON：数据级联与界面反馈 · REDUCED：静态数据与短暂淡入 · OFF：立即切换
        </p>
      </LcarsPanel>
      <LcarsPanel title="SOUND">
        <div className="settings-switch" role="group" aria-label="SOUND">
          {[true, false].map((enabled) => (
            <LcarsButton
              key={String(enabled)}
              aria-pressed={preferences.sound === enabled}
              onClick={() => updatePreferences({ sound: enabled })}
            >
              {enabled ? 'ON' : 'OFF'}
            </LcarsButton>
          ))}
        </div>
        <LcarsField className="volume-control">
          VOLUME <output>{Math.round(preferences.volume * 100)}%</output>
          <input
            aria-label="音量"
            type="range"
            data-sound="none"
            min="0"
            max="100"
            value={Math.round(preferences.volume * 100)}
            onChange={(event) => updatePreferences({ volume: Number(event.target.value) / 100 })}
          />
        </LcarsField>
        <LcarsButton sound="action" disabled={!preferences.sound || preferences.volume === 0}>
          TEST SOUND
        </LcarsButton>
      </LcarsPanel>
      <div className="template-credit">
        <img src={emblem} alt="Starfleet Command" />
        <div>
          <b>LCARS 26 / CLASSIC</b>
          <p>LCARS Inspired Website Template by TheLCARS.com, with modifications.</p>
          <p className="muted">Jim Robertus · 原始模板、Antonio 字体与 LCARS 音效</p>
        </div>
      </div>
    </LcarsDrawer>
  );
}
