import { useCallback, useEffect, useRef, useState } from 'react';
import type { Command, SessionCommand, Snapshot } from '../../engine/types';
import type { TimelineStatus } from '../../engine/timeline';
import type { Notice } from '../types';
import { useLcars } from '../lcars/LcarsProvider';
export function useFrontier() {
  const { audio } = useLcars();
  const [timeline, setTimeline] = useState<TimelineStatus>({
    activeId: null,
    previousDay: null,
    branches: [],
  });
  const [world, setWorld] = useState<Snapshot | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notify = useCallback((text: string, error = false) => {
    setNotice({ text, error });
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), error ? 7000 : 3500);
  }, []);
  const command = useCallback(
    async (c: Command | SessionCommand, quiet = false) => {
      try {
        const result = await window.frontier.command(c);
        audio.play(result.ok ? 'action' : 'alert');
        if (!result.ok || !quiet) notify(result.reason, !result.ok);
        if (result.ok) setTimeline(await window.frontier.timeline());
        return result;
      } catch {
        audio.play('alert');
        notify('无法连接模拟引擎，请保存并重启应用。', true);
        return { ok: false, reason: 'IPC 连接失败' };
      }
    },
    [notify, audio],
  );
  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  useEffect(() => {
    if (!window.frontier) return;
    window.frontier.getState().then((data) => {
      setWorld(data.state);
      setTimeline(data.timeline);
      if (data.saveBlocked) notify(data.saveMessage, true);
    });
    return window.frontier.onState(setWorld);
  }, [notify]);
  const day = Math.floor((world?.tick ?? 0) / 14400);
  useEffect(() => {
    if (window.frontier)
      window.frontier
        .getState()
        .then((data) => {
          setTimeline(data.timeline);
          if (data.saveBlocked) notify(data.saveMessage, true);
        })
        .catch(() => {});
  }, [world?.status, world?.paused, day, notify]);
  const save = async () => {
    const r = await window.frontier.save();
    audio.play(r.ok ? 'action' : 'alert');
    notify(r.reason, !r.ok);
  };
  const reset = async () => {
    const r = await command({ type: 'beginNewFrontier' });
    notify(r.reason, !r.ok);
    return r;
  };
  return {
    world,
    timeline,
    notice,
    command,
    notify,
    save,
    reset,
    dismissNotice: () => setNotice(null),
  };
}
