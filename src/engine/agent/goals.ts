/**
 * Agent goals (Agent.md §7/§48, docs/lv3/02-domain-model.md §4).
 *
 * Deliberately simplified against Agent.md §7: `conditions: GoalCondition[]` is replaced by a
 * `kind` enum plus a numeric `progress`. §48's goal progress is event-driven numeric change, so a
 * condition evaluator (explicitly out of scope per Agent.md §52) buys nothing for the MVP.
 *
 * Pure module: no I/O, no clock, no randomness.
 */
import { clamp100 } from './personality';
import type { Agent, AgentGoal, GoalKind } from './types';

/** Agent.md §48: the four goal-progress moves the MVP scenario exercises. */
export const GOAL_PROGRESS = Object.freeze({
  /** 发现异常信号 */
  anomalyDiscovered: 10,
  /** 完成 Deep Scan */
  deepScanCompleted: 15,
  /** 发现重大线索 */
  majorLead: 30,
  /** 被强制停止调查 */
  forcedStop: 0,
});

export const GOAL_TITLES: Readonly<Record<GoalKind, string>> = Object.freeze({
  discovery: '测绘未知星区，发现并确认重要异常与线索',
  research: '获取高级技术与科研成果',
  command: '成为优秀指挥者，提升舰队战斗能力',
  logistics: '建立稳定、安全、高效的资源与运输体系',
});

/** The career each goal kind belongs to (Agent.md §9–§12). */
export const CAREER_GOAL: Readonly<Record<Agent['career'], GoalKind>> = Object.freeze({
  explorer: 'discovery',
  scientist: 'research',
  tactical: 'command',
  logistics: 'logistics',
});

export function createGoal(id: string, kind: GoalKind, priority = 70): AgentGoal {
  return { id, title: GOAL_TITLES[kind], kind, progress: 0, priority: clamp100(priority) };
}

/**
 * GoalAlignment: whether the candidate advances this Agent's goal. Aligned candidates score 100,
 * everything else 0, so the term separates candidates rather than shading them.
 */
export function goalAlignment(goal: AgentGoal, candidateKinds: readonly GoalKind[]): number {
  return candidateKinds.includes(goal.kind) ? 100 : 0;
}

/**
 * Applies a goal-progress delta to both the goal and its redundant `state.goalProgress` mirror
 * (docs/lv3/02-domain-model.md §3), clamped to `[0, 100]`. Returns the change actually applied.
 */
export function applyGoalProgress(
  agent: Agent,
  delta: number,
): { agent: Agent; applied: number } {
  const before = agent.goal.progress;
  const progress = clamp100(before + delta);
  return {
    agent: {
      ...agent,
      goal: { ...agent.goal, progress },
      state: { ...agent.state, goalProgress: progress },
    },
    applied: progress - before,
  };
}
