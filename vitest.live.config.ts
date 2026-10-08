import { defineConfig } from 'vitest/config';
/**
 * The live demonstration only (docs/lv3/10-agent-demo-channel.md §4).
 *
 * A separate config rather than a naming convention, for a specific reason: `npm test`'s glob is
 * `tests/**\/*.test.ts`, and the pattern this repo already uses for live network tests
 * (`live-deepseek.test.ts` skips itself without a key) has a sharp edge — put a key in the shell and
 * `npm test` quietly starts calling the API. A second file with that behaviour doubles the edge.
 *
 * `tests/live/` is outside the default glob, so the gating suite can never pick it up, and this config
 * includes only that directory. No environment switch to remember.
 */
export default defineConfig({
  test: {
    include: ['tests/live/**/*.ts'],
    // The demo makes real model calls, each a few seconds; vitest's 5s default would kill it. Set here
    // rather than per test, so a step added later cannot silently reintroduce the limit.
    testTimeout: 20 * 60_000,
  },
});
