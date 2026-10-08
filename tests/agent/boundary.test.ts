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

/**
 * The one module allowed to reach the network (P2, docs/lv3/02-llm-boundary.md §7).
 *
 * P1 had no live provider, so the rule was "the whole layer is offline". P2 adds one, and the rule
 * becomes sharper rather than weaker: **exactly one named file** may open a socket, read a
 * credential or look at the environment, and every other file in the layer must stay as clean as it
 * was. A blanket ban would now be a lie; a per-file exemption with the exemption named is a rule
 * that still catches the thing it was written to catch — a second module quietly acquiring network
 * access.
 */
const NETWORK_MODULE = 'electron/agent/openai-compatible.ts';
const isNetworkModule = (file: string): boolean =>
  file.replace(/\\/g, '/').endsWith(NETWORK_MODULE);

describe('B-11 only the named provider module may touch the network', () => {
  it('confines fetch, credentials and environment reads to that one file', () => {
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
    const scanned = AGENT_LAYER_CODE.filter(({ file }) => !isNetworkModule(file));
    // A guard that silently scans nothing is worse than no guard, so make the scan's size visible.
    expect(scanned.length).toBe(AGENT_LAYER_CODE.length - 1);
    for (const { file, code } of scanned)
      for (const pattern of network)
        expect({ file, pattern: String(pattern), hit: pattern.test(code) }).toEqual({
          file,
          pattern: String(pattern),
          hit: false,
        });
  });

  it('the exempt module exists, and reaches out only through an injected transport', () => {
    expect(AGENT_LAYER.filter(isNetworkModule).map((file) => file.replace(/\\/g, '/'))).toEqual([
      NETWORK_MODULE,
    ]);
    const code = stripComments(read(NETWORK_MODULE));
    // It must actually be able to make a call…
    expect(code).toMatch(/fetch/);
    // …but must not smuggle in a second HTTP client, and must not bury an endpoint in a literal.
    expect(code).not.toMatch(/\baxios\b|node:https?|XMLHttpRequest/);
    // The transport is a dependency, not a global reached for at the call site: that is what makes
    // L-15 ("stub fetch, no real network") possible rather than aspirational.
    expect(code).toMatch(/options\.fetch\s*\?\?/);
  });

  it('leaves the renderer surface untouched: no new IPC channel', () => {
    const preload = read('electron/preload.ts');
    expect(preload).not.toMatch(/agent|model|llm|decision/i);
    expect(preload.match(/ipcRenderer\.invoke\(/g) ?? []).toHaveLength(5);
  });

  it('wires the Agent loop into the host frame — guarded, and never awaited', () => {
    // This replaces P1's "the scheduler is a later stage" assertion, which this stage is the later
    // stage for. The rule is inverted rather than dropped: the wiring must exist, and it must have
    // the two properties that keep a slow model from becoming a stalled or corrupted world.
    const main = read('electron/main.ts');
    expect(main).toMatch(/from\s+['"]\.\/agent-host['"]/);
    // Its own try/catch, so a provider failure can never reach the branch that sets `saveBlocked`.
    expect(main).toMatch(/try\s*\{[^}]*agentHost\?\.frame\(/s);
    // And never awaited: `setInterval` must not block on the network (CLAUDE.md §2.4).
    expect(main).not.toMatch(/await\s+agentHost/);
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

describe('B-13 exactly one module may reach the engine’s command seam', () => {
  it('confines it to the host bridge, so the agent layer still names no engine', () => {
    // B-2 above bans these names across the whole agent layer and is unchanged by P2.5 — even
    // though the agent loop now *submits* things. It can, because submission arrives as an injected
    // function rather than as a port the runtime imports. This asserts the other half: somewhere
    // that seam must exist, and exactly one named place may hold it.
    const seam = /controllerPort|submitAction/;
    const callers = filesUnder('electron')
      .filter((file) => seam.test(stripComments(read(file))))
      .map((file) => file.replace(/\\/g, '/'))
      .sort();
    expect(callers).toEqual(['electron/agent-host.ts']);
  });
});
