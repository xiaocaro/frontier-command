export interface TimelineSummary {
  id: string;
  parent: { id: string; day: number } | null;
  status: 'active' | 'commandLost';
  tick: number;
  lossCount: number;
}
export interface TimelineStatus {
  activeId: string | null;
  previousDay: number | null;
  branches: TimelineSummary[];
}
