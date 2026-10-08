import { freezeDefinitions } from './freeze';
export const RULES = freezeDefinitions({
  baseSensors: 230,
  intelTTL: 30,
  /** Enemy AI beat. Do **not** reuse for Agents — see `agentDecisionInterval` (KNOWN_ISSUES C-18). */
  decisionInterval: 5,
  /** Lv3 Agent decision beat, in game minutes. A separate key on purpose: changing the enemy AI's
   * interval would break Lv1/Lv2 balance. */
  agentDecisionInterval: 15,
  cloakDrain: 2,
  decloakMinutes: 1,
  surveyMinutes: 12,
  eventResponseRange: 12,
  mineAccidentWork: 20,
  mineAccidentMaterials: 5,
  loadMinutes: 2,
  repairPerMaterial: 8,
  repairRate: 8,
  torpedoLoadMinutes: 0.6,
  reportTTL: 100,
  searchMinutes: 20,
  constructionMinutes: 25,
  shipBuildMinutes: 25,
});
