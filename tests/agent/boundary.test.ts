/**
 * P1-01/P1-05 boundary and security (docs/lv3/03-test-plan.md §11 B-1/B-2/B-9/B-10/B-11/B-12,
 * §5 L-15; docs/lv3/02-llm-boundary.md §9; CLAUDE.md §2.1–§2.4).
 *
 * These are the assertions that keep the Lv3 work from quietly becoming a second architecture. Most
 * of them are static: they read the source and check that a boundary which *is* structural today has
 * not been quietly crossed by an import. The rest are runtime: they check that stepping the world
 * never reaches a provider.
 *
 * The static scans strip comments first. A rule that fires on the word "WorldState" inside a
 * sentence explaining why `WorldState` is unreachable would be a rule nobody could keep.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { agentEngine, agentRuntime, REPO_ROOT } from './support';
import { careerIds, observationFor, offerMission, agentByCareer } from './support';
import type { ModelClient } from '../../electron/agent/model-client';

const read = (relativePath: string): string =>
  readFileSync(join(REPO_ROOT, relativePath), 'utf8');

function filesUnder(relativeDir: string, extension = '.ts'): string[] {
  const root = join(REPO_ROOT, relativeDir);
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(extension)) found.push(relative(REPO_ROOT, path));
    }
  };
  walk(root);
  return found;
}

/** Comments explain the rules; they must not be mistaken for violations of them. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

/** Every module specifier an `import`/`require` names. */
function importedModules(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:from\s+|require\(\s*)['"]([^'"]+)['"]/g;
  let match = pattern.exec(source);
  while (match) {
    specifiers.push(match[1]);
    match = pattern.exec(source);
  }
  return specifiers;
}

const AGENT_LAYER = filesUnder('electron/agent');
const AGENT_LAYER_CODE = AGENT_LAYER.map((file) => ({ file, code: stripComments(read(file)) }));

describe('B-1 the Agent layer is a leaf: nothing under src/ may reach into electron/', () => {
  it('has no src file importing the runtime, scheduler, provider or prompts', () => {
    const offenders = filesUnder('src')
      .map((file) => ({ file, code: read(file) }))
      .filter(({ code }) => importedModules(code).some((specifier) => specifier.includes('electron/')))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('does not let simulation code name the decision runtime at all', () => {
    // B-10's structural half: with no import edge, a model call cannot be sitting inside step().
    for (const file of [...filesUnder('src/engine'), 'src/engine/engine.ts']) {
      const code = stripComments(read(file));
      expect(code).not.toMatch(/electron\/(agent|main)/);
    }
  });
});

describe('B-2/Rule 1 the Agent layer cannot touch the world', () => {
  it('never names the engine, the world state or the command seam', () => {
    for (const { file, code } of AGENT_LAYER_CODE)
      for (const forbidden of [
        'SimulationEngine',
        'WorldState',
        'controllerPort',
        'dispatchCommand',
        'submitAction',
      ])
        expect({ file, forbidden, hit: code.includes(forbidden) }).toEqual({
          file,
          forbidden,
          hit: false,
        });
  });

  it('imports only the domain layer and its own modules', () => {
    const allowed = [/^\.\//, /^\.\.\//, /^node:/];
    for (const { file, code } of AGENT_LAYER_CODE)
      for (const specifier of importedModules(code))
        expect({ file, specifier, allowed: allowed.some((p) => p.test(specifier)) }).toEqual({
          file,
          specifier,
          allowed: true,
        });
  });

  it('reaches the engine only through pure domain modules, never the engine itself', () => {
    const engineModules = ['/engine.ts', '/projection.ts', '/command-system.ts', '/data.ts'];
    for (const { file, code } of AGENT_LAYER_CODE)
      for (const specifier of importedModules(code))
        expect({ file, specifier, engine: engineModules.some((m) => specifier.endsWith(m)) }).toEqual({
          file,
          specifier,
          engine: false,
        });
  });
});

describe('B-11/§16/§23 P1 performs no network call and adds no IPC', () => {
  it('has no network client, SDK or credential in the Agent layer', () => {
    const network = [
      /\bfetch\s*\(/,
      /\baxios\b/,
      /node:https?/,
      /from\s+['"]https?['"]/,
      /require\(\s*['"]https?['"]/,
      /XMLHttpRequest/,
      /process\.env/,
      /DEEPSEEK|OPENAI|ANTHROPIC/,
    ];
    for (const { file, code } of AGENT_LAYER_CODE)
      for (const pattern of network)
        expect({ file, pattern: String(pattern), hit: pattern.test(code) }).toEqual({
          file,
          pattern: String(pattern),
          hit: false,
        });
  });

  it('leaves the renderer surface untouched: no new IPC channel', () => {
    const preload = read('electron/preload.ts');
    expect(preload).not.toMatch(/agent|model|llm|decision/i);
    expect(preload.match(/ipcRenderer\.invoke\(/g) ?? []).toHaveLength(5);
  });

  it('does not wire the runtime into the host loop (the scheduler is a later stage)', () => {
    expect(read('electron/main.ts')).not.toMatch(/from\s+['"]\.\/agent/);
  });
});

describe('B-12 the domain layer stays pure', () => {
  it('has no clock, randomness, I/O or network in src/engine/agent', () => {
    const impure = [
      /Math\.random/,
      /Date\.now/,
      /new Date\b/,
      /\bfetch\s*\(/,
      /readFileSync|writeFileSync|createReadStream/,
      /node:fs|node:child_process|node:net|node:http/,
      /process\.env/,
      /\brequire\s*\(/,
    ];
    for (const file of filesUnder('src/engine/agent')) {
      const code = stripComments(read(file));
      for (const pattern of impure)
        expect({ file, pattern: String(pattern), hit: pattern.test(code) }).toEqual({
          file,
          pattern: String(pattern),
          hit: false,
        });
    }
  });
});

describe('B-9 the offline provider is a permanent part of the system', () => {
  it('exists and is what the regression suite replays against', () => {
    expect(existsSync(join(REPO_ROOT, 'electron/agent/mock-client.ts'))).toBe(true);
    expect(read('electron/agent/mock-client.ts')).toContain('class MockModelClient');
    for (const file of ['tests/agent/provider.test.ts', 'tests/agent/runtime.test.ts'])
      expect(read(file)).toContain("electron/agent/mock-client");
  });
});

describe('B-10 no model call inside the fixed-tick loop', () => {
  it('never asks a provider while the world steps, however long it runs', () => {
    const engine = agentEngine();
    let calls = 0;
    const spy: ModelClient = {
      id: 'spy',
      promptVersion: 'agent-v1',
      decide: async () => {
        calls += 1;
        return { ok: false, error: 'unavailable', latencyMs: 0 };
      },
    };
    // Building the runtime is fine; running the world must not reach it.
    agentRuntime(spy);
    for (let i = 0; i < 60; i++) {
      engine.dispatchCommand({ type: 'pause', paused: false });
      engine.step();
    }
    expect(calls).toBe(0);
    expect(engine.state.tick).toBe(60);
  });

  it('leaves the world untouched when a decision is asked for', async () => {
    const engine = agentEngine();
    const explorer = agentByCareer(engine, 'explorer');
    offerMission(engine, explorer.id);
    const observation = observationFor(engine, explorer.id);
    const before = JSON.stringify(engine.state);
    await agentRuntime({
      id: 'spy',
      promptVersion: 'agent-v1',
      decide: async () => ({ ok: false, error: 'timeout', latencyMs: 0 }),
    }).requestDecision(observation);
    expect(JSON.stringify(engine.state)).toBe(before);
    expect(careerIds(engine).explorer).toBe(explorer.id);
  });
});
