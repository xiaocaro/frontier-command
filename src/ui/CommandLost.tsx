import type { Snapshot } from '../engine/types';
import type { TimelineStatus } from '../engine/timeline';
import type { CommandSender } from './types';
import { LcarsButton, LcarsDialog } from './components/Lcars';
export function CommandLost({
  world,
  timeline,
  command,
  onRestored,
  onNewFrontier,
  onArchive,
}: {
  world: Snapshot;
  timeline: TimelineStatus;
  command: CommandSender;
  onRestored: () => void;
  onNewFrontier: () => void;
  onArchive: () => void;
}) {
  return (
    <LcarsDialog title="COMMAND LOST" label="COMMAND LOST">
      <h2>DAWN STARBASE DESTROYED</h2>
      <p>指挥基地已摧毁。当前时间线已停止，舰船损失与失败记录保留。</p>
      <p className="muted">
        {timeline.previousDay
          ? '恢复至 DAY ' + timeline.previousDay + ' 00:00，将创建独立分支。'
          : '没有上一游戏日快照，可开始新的边疆。'}
      </p>
      <div className="loss-summary">
        {world.losses.length} VESSEL LOSSES ·{' '}
        {world.history.filter((o) => o.kind === 'actionFailed').length} FAILED DIRECTIVES
      </div>
      <div className="dialog-actions">
        <LcarsButton
          disabled={!timeline.previousDay}
          onClick={async () => {
            const r = await command({ type: 'restorePreviousDay' });
            if (r.ok) onRestored();
          }}
        >
          RESTORE PREVIOUS DAY
        </LcarsButton>
        <LcarsButton tone="danger" sound="navigation" onClick={onNewFrontier}>
          BEGIN NEW FRONTIER
        </LcarsButton>
        <LcarsButton tone="secondary" sound="navigation" onClick={onArchive}>
          VIEW ARCHIVE
        </LcarsButton>
      </div>
    </LcarsDialog>
  );
}
