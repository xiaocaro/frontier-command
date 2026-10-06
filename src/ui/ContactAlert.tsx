import { useLcars } from './lcars/LcarsProvider';
import { useEffect, useState } from 'react';
import type { Snapshot } from '../engine/types';
import type { CommandSender } from './types';
import { LcarsDialog, LcarsButton } from './components/Lcars';
export function ContactAlert({
  world,
  branch,
  command,
  locate,
}: {
  world: Snapshot;
  branch: string | null;
  command: CommandSender;
  locate: (id: string) => void;
}) {
  const { audio } = useLcars();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const reasons = world.pauseReasons.filter((r) => r.kind === 'newContact');
  const key = branch + ':' + reasons.map((r) => r.entityId + ':' + r.tick).join(',');
  const unread = world.communications.filter(
    (c) =>
      c.category === 'threat' &&
      c.priority === 'urgent' &&
      !c.read &&
      reasons.some((r) => r.entityId === c.entityId && r.time === c.time),
  );
  const open =
    world.status === 'active' &&
    world.paused &&
    reasons.length > 0 &&
    unread.length > 0 &&
    !dismissed.includes(key);
  useEffect(() => {
    if (open) audio.play('alert', key);
  }, [open, key, audio]);
  const close = () => {
    setDismissed((ids) => [...ids, key]);
    for (const c of unread) void command({ type: 'acknowledge', communicationId: c.id }, true);
  };
  if (!open) return null;
  return (
    <LcarsDialog title="CONTACT ALERT 接触警报" label="接触警报" onClose={close}>
      <h2>发现外部舰船，模拟已暂停</h2>
      <p>请部署舰船或调整指令，然后由 Admiral 手动继续模拟。</p>
      {reasons.map((r) => {
        const c = world.contacts.find((c) => c.id === r.entityId);
        return (
          <div className="decision-box" key={r.entityId}>
            <b>{c?.name ?? '未知舰船接触'}</b>
            <p>
              {c?.factionId === 'orion'
                ? 'Orion Syndicate'
                : c?.factionId === 'romulan'
                  ? 'Romulan'
                  : '势力尚未识别'}{' '}
              · {c?.hostile ? '已确认敌对' : '尚未确认敌对'}
            </p>
            {c && (
              <p>
                已观测位置 {Math.round(c.x)}, {Math.round(c.y)}
              </p>
            )}
            <LcarsButton
              onClick={() => {
                locate(r.entityId);
                close();
              }}
            >
              定位接触 / 保持暂停
            </LcarsButton>
          </div>
        );
      })}
      <LcarsButton onClick={close}>确认 / 保持暂停</LcarsButton>
    </LcarsDialog>
  );
}
