import { LcarsMeter } from './Lcars';
export function WorkProgress({
  label,
  work,
  duration,
  paused,
}: {
  label: string;
  work: number;
  duration: number;
  paused: boolean;
}) {
  const percent = Math.min(100, Math.floor((work / duration) * 100));
  return (
    <div className="work-progress" data-work={work} data-duration={duration}>
      <LcarsMeter label={label + ' / ' + percent + '%'} value={work} max={duration} />
      <span>
        {percent}% · 剩余 {Math.max(0, Math.ceil(duration - work))} 游戏分钟
        {paused ? ' · 模拟暂停' : ''}
      </span>
    </div>
  );
}
