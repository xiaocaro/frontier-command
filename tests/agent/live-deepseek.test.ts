/**
 * The optional live check (playbook §21).
 *
 * **This file is skipped unless `DEEPSEEK_API_KEY` is set**, which is what keeps `npm test` free of
 * a key, of an outbound socket, of spend and of a model's mood. Run it deliberately with
 * `npm run test:llm` when you want to know whether the real endpoint still answers the way the
 * provider expects.
 *
 * What it asserts is deliberately weak. docs/lv3/02-llm-boundary.md §8 forbids claiming that a live
 * model is reproducible, so nothing here asserts *which* option the model picked, or that it picked
 * well. It asserts the two things that are actually contractual: the answer arrives in the shape
 * `AgentDecision` requires (or is classified as one of the six failures), and the credential does not
 * come back out. Judging the quality of the decision is a human's job, and prompt tuning is not
 * something a passing test can certify.
 */
import { describe, it, expect } from 'vitest';
import {
  createDeepSeekClient,
  describeDeepSeekConfig,
  deepSeekConfigFromEnv,
} from '../../electron/agent/openai-compatible';
import { buildDecisionRequest, loadDecisionSchema, loadPromptTemplates } from '../../electron/agent/prompt';
import { agentDecisionSchema } from '../../src/engine/agent/schemas';
import { REPO_ROOT, agentByCareer, agentEngine, observationFor, offerMission } from './support';

const config = deepSeekConfigFromEnv();
const apiKey = config?.apiKey;

/** `describe.skip` when unconfigured: the suite still reports honestly that it did not run. */
const live = apiKey ? describe : describe.skip;

live('the live DeepSeek provider (requires DEEPSEEK_API_KEY)', () => {
  it(
    'answers with a validateable AgentDecision, or with a classified failure',
    async () => {
      const engine = agentEngine();
      const explorer = agentByCareer(engine, 'explorer');
      offerMission(engine, explorer.id, '穿越虫洞，寻找失联探测船，确认发生了什么。');
      const observation = observationFor(engine, explorer.id);
      const request = buildDecisionRequest({
        observation,
        templates: loadPromptTemplates(REPO_ROOT),
        schema: loadDecisionSchema(REPO_ROOT),
      });

      const attempts: unknown[] = [];
      const client = createDeepSeekClient(process.env, {
        onAttempt: (trace) => attempts.push(trace),
      })!;
      expect(client).not.toBeNull();
      // No key may appear in anything we retain.
      expect(JSON.stringify(describeDeepSeekConfig(config!))).not.toContain(config!.apiKey);

      const result = await client.decide(request);
      expect(JSON.stringify(result)).not.toContain(config!.apiKey);
      expect(JSON.stringify(attempts)).not.toContain(config!.apiKey);

      if (!result.ok) {
        // A refusal to answer is an acceptable outcome — the point is that it is *classified*, and
        // that the runtime next door has a deterministic decision to fall back to.
        expect([
          'timeout',
          'http-error',
          'invalid-json',
          'schema-mismatch',
          'invalid-choice-id',
          'unavailable',
        ]).toContain(result.error);
        return;
      }

      expect(agentDecisionSchema.safeParse(result.decision).success).toBe(true);
      expect(result.decision.observationTick).toBe(observation.tick);
      expect(result.decision.provider).toBe('llm');
      expect(result.decision.promptVersion).toBe(client.promptVersion);
      // A decision that named an option the Agent was never offered would have been rejected by
      // `validateDecisionShape`, so reaching here already proves the menu was respected.
      if (result.decision.choiceId !== undefined)
        expect(observation.availableActions.map((c) => c.id)).toContain(result.decision.choiceId);
    },
    60_000,
  );
});
