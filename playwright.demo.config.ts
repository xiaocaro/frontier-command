import { defineConfig } from '@playwright/test';
/**
 * The watchable UI demo only (docs/lv3/10-agent-demo-channel.md §4).
 *
 * The whole reason this file exists is `testMatch`. Playwright's default is
 * `**\/*.@(spec|test).?(c|m)[jt]s?(x)`, so `npm run test:e2e` would never collect a `.demo.ts` file —
 * and naming the demo `*.spec.ts` instead would make every e2e run record videos and spend twenty
 * minutes clicking through the Agent flow. Same shape as `vitest.live.config.ts`, for the same reason.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.demo.ts',
  // Two acts, two Electron launches, a real REFIT, and — with a key — a real model in the loop.
  timeout: 20 * 60_000,
  // Two `electron.launch()` calls must not overlap: `main.ts` takes a single-instance lock.
  workers: 1,
  reporter: 'list',
  // Not `test-results/agent-demo` — that is the storyboard directory, and Playwright clears its
  // own outputDir (removing the artifacts of passing tests) which would delete the storyboard.
  outputDir: 'test-results/demo-run',
  // Do NOT add `use: { video: ... }` here. It is wired to the browser `context` fixture and records
  // nothing for Electron; the recording is configured on `electron.launch({ recordVideo })`.
  use: { trace: 'off' },
});
