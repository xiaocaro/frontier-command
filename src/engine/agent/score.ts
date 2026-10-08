/**
 * Deterministic `DecisionScore` (Agent.md §46, docs/lv3/02-decision-flow.md §4).
 *
 * Two jobs only:
 *  1. decide **whether a decision is worth a model call at all** (Agent.md §35: most ticks are
 *     low-priority and must not call the LLM), and
 *  2. provide the **deterministic fallback** when the model is unavailable or its answer is
 *     unusable (§58).
 *
 * The LLM never computes this score (Agent.md §46) — it contributes intent, reason and choice.
 *
 * Weights and per-term mappings are the approved *structure*; the absolute numbers are proposals
 * to be calibrated in P3 against real decision outcomes.
 *
 * Pure module: no I/O, no clock, no randomness. Same input always yields the same score.
 */
import { CAREER_GOAL } from './goals';
import { averageCooperation } from './relationship';
import { fatigueBand } from './state';
import { activePromise } from './promise';
import type {
  Agent,
  AgentActionCandidate,
  AgentObservation,
  AgentPromise,
  GoalKind,
  MemoryTag,
} from './types';

export const DECISION_WEIGHTS = Object.freeze({
  skillFit: 0.2,
  goalAlignment: 0.2,
  rewardAttractiveness: 0.15,
  ceoTrust: 0.1,
  teamFit: 0.1,
  careerValue: 0.1,
  promiseValue: 0.05,
  recentMemoryScore: 0.15,
  riskDiscomfort: -0.1,
  fatiguePenalty: -0.1,
});

export interface DecisionScoreBreakdown {
  skillFit: number;
  goalAlignment: number;
  rewardAttractiveness: number;
  ceoTrust: number;
  teamFit: number;
  careerValue: number;
  promiseValue: number;
  recentMemoryScore: number;
  riskDiscomfort: number;
  fatiguePenalty: number;
  score: number;
}

export type DecisionBand = 'accept' | 'consult-llm' | 'request' | 'reject';

/** Agent.md §46 thresholds. */
export function scoreBand(score: number): DecisionBand {
  if (score >= 70) return 'accept';
  if (score >= 45) return 'consult-llm';
  if (score >= 25) return 'request';
  return 'reject';
}

/** Which goal kinds a memory tag speaks to. Used by `RecentMemoryScore`. */
export const TAG_GOALS: Readonly<Record<MemoryTag, readonly GoalKind[]>> = Object.freeze({
  'admiral-override': ['command', 'logistics'],
  'promise-kept': ['logistics', 'command'],
  'promise-broken': ['logistics', 'command'],
  'mission-success': ['command'],
  'mission-failure': ['command'],
  discovery: ['discovery', 'research'],
  'team-up': ['command'],
  conflict: ['command'],
  'near-death': ['command'],
  'risk-taken': ['discovery', 'research'],
});

/** Candidates that are about working with somebody else (see `actions.ts`). */
export function isTeamCandidate(candidateId: string): boolean {
  return candidateId.startsWith('escort:') || candidateId.startsWith('team-');
}

/** Agent.md §21 bands mapped onto the `FatiguePenalty` term. */
export const FATIGUE_PENALTY: Readonly<Record<ReturnType<typeof fatigueBand>, number>> =
  Object.freeze({
    normal: 0,
    fatigued: 40,
    'severe-fatigue': 75,
    'forced-rest': 100,
  });

const clamp100 = (value: number) => Math.min(100, Math.max(0, value));

function skillFit(agent: Agent, candidate: AgentActionCandidate): number {
  if (!candidate.goalKinds.length) return 0;
  return candidate.goalKinds.includes(CAREER_GOAL[agent.career]) ? 100 : 25;
}

function goalAlignmentTerm(agent: Agent, candidate: AgentActionCandidate): number {
  return candidate.goalKinds.includes(agent.goal.kind) ? 100 : 0;
}

function careerValue(agent: Agent, candidate: AgentActionCandidate): number {
  const fit = skillFit(agent, candidate);
  if (!fit) return 0;
  return clamp100(Math.round((fit * agent.personality.ambition) / 100));
}

/**
 * Whether a pending promise points at this candidate — i.e. taking it would move the Admiral toward
 * keeping the word. The link is `fulfills`: the candidate `refit:deepScan` is what installs the
 * `grant-module/deepScan` a promise asked for.
 */
export function promiseMatchesCandidate(
  promise: AgentPromise,
  candidate: AgentActionCandidate,
): boolean {
  const fulfills = promise.fulfills;
  if (fulfills.kind === 'grant-module') return candidate.id === 'refit:' + fulfills.key;
  if (fulfills.kind === 'grant-upgrade') return candidate.id === 'upgrade:' + fulfills.key;
  if (fulfills.kind === 'grant-rest') return candidate.id === 'rest';
  return candidate.id === 'fund:' + fulfills.amount;
}

function promiseValue(agent: Agent, candidate: AgentActionCandidate): number {
  const promise = activePromise(agent.promises);
  if (!promise) return 0;
  return promiseMatchesCandidate(promise, candidate) ? 100 : 0;
}

/**
 * Full breakdown for one candidate. Every term is a pure function of the Agent and the observation.
 */
export function decisionScore(
  agent: Agent,
  observation: AgentObservation,
  candidate: AgentActionCandidate,
): DecisionScoreBreakdown {
  const terms: Omit<DecisionScoreBreakdown, 'score'> = {
    skillFit: skillFit(agent, candidate),
    goalAlignment: goalAlignmentTerm(agent, candidate),
    rewardAttractiveness: candidate.reward,
    ceoTrust: agent.state.trustInAdmiral,
    teamFit: isTeamCandidate(candidate.id) ? averageCooperation(agent.relationships) : 50,
    careerValue: careerValue(agent, candidate),
    promiseValue: promiseValue(agent, candidate),
    recentMemoryScore: memoryContribution(observation, candidate),
    riskDiscomfort: (candidate.risk * (100 - agent.personality.riskTolerance)) / 100,
    fatiguePenalty: FATIGUE_PENALTY[fatigueBand(agent.state.fatigue)],
  };
  const score =
    DECISION_WEIGHTS.skillFit * terms.skillFit +
    DECISION_WEIGHTS.goalAlignment * terms.goalAlignment +
    DECISION_WEIGHTS.rewardAttractiveness * terms.rewardAttractiveness +
    DECISION_WEIGHTS.ceoTrust * terms.ceoTrust +
    DECISION_WEIGHTS.teamFit * terms.teamFit +
    DECISION_WEIGHTS.careerValue * terms.careerValue +
    DECISION_WEIGHTS.promiseValue * terms.promiseValue +
    DECISION_WEIGHTS.recentMemoryScore * terms.recentMemoryScore +
    DECISION_WEIGHTS.riskDiscomfort * terms.riskDiscomfort +
    DECISION_WEIGHTS.fatiguePenalty * terms.fatiguePenalty;
  return { ...terms, score };
}

/**
 * How strongly the Agent's recent memories push toward this candidate: the heaviest memory whose
 * tag speaks to one of the candidate's goal kinds. This is where Agent.md §50 ("memory must change
 * future behaviour") becomes a number instead of a promise.
 */
export function memoryContribution(
  observation: AgentObservation,
  candidate: AgentActionCandidate,
): number {
  const kinds = new Set(candidate.goalKinds);
  let best = 0;
  for (const memory of observation.recentMemory) {
    if (memory.kind !== 'episodic') continue;
    if (!memory.tags.some((tag) => TAG_GOALS[tag].some((goal) => kinds.has(goal)))) continue;
    best = Math.max(best, memory.weight);
  }
  return best;
}

/**
 * Candidates ranked best first. Ties break on `id` so the order is total and stable across ticks —
 * a model that picked a `choiceId` last tick must not find the option reshuffled this tick.
 */
export function rankCandidates(
  agent: Agent,
  observation: AgentObservation,
): { candidate: AgentActionCandidate; breakdown: DecisionScoreBreakdown }[] {
  return observation.availableActions
    .map((candidate) => ({ candidate, breakdown: decisionScore(agent, observation, candidate) }))
    .sort((a, b) =>
      b.breakdown.score !== a.breakdown.score
        ? b.breakdown.score - a.breakdown.score
        : a.candidate.id < b.candidate.id
          ? -1
          : a.candidate.id > b.candidate.id
            ? 1
            : 0,
    );
}
