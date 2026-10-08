/**
 * P0 persistence主干 (docs/lv3/03-test-plan.md §9, P-1 … P-12).
 *
 * The version bump is the only part of Lv3 that can destroy a player's save, so it is tested from
 * both ends: the migration functions themselves, and the on-disk timeline layout.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SaveStore } from '../../electron/persistence';
import { worldSchema } from '../../src/engine/save-schema';
import { worldSchema as legacyV10Schema } from '../../src/engine/legacy-v10/save-schema';
import {
  CURRENT_SAVE_VERSION,
  UnsupportedSaveVersionError,
  migrateV10,
  migrateV9,
  parseSave,
} from '../../src/engine/saves';
import { createWorld } from '../../src/engine/data';
import { SimulationEngine } from '../../src/engine/engine';
import { agentEngine, v10World } from './support';
import { agentSchema } from '../../src/engine/agent/schemas';
import { episodicMemory } from '../../src/engine/agent/memory';
import type { WorldState } from '../../src/engine/types';

const v9Fixture = () =>
  JSON.parse(readFileSync(join('tests', 'fixtures', 'v9', 'initial.json'), 'utf8')) as Record<
    string,
    unknown
  >;

const directories: string[] = [];
const tempDir = () => {
  const path = mkdtempSync(join(tmpdir(), 'frontier-v11-'));
  directories.push(path);
  return path;
};
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('P-1/P-10 v10 -> v11 migration', () => {
  it('accepts a genuine v10 world and changes nothing but the version and the new collections', () => {
    const v10 = v10World();
    // The fixture really is v10-shaped: the frozen contract accepts it.
    expect(legacyV10Schema.safeParse(v10).success).toBe(true);
    expect(worldSchema.safeParse(v10).success).toBe(false);

    const migrated = migrateV10(v10);
    expect(migrated.version).toBe(11);
    expect(migrated.agents).toEqual([]);
    expect(migrated.agentMessages).toEqual([]);
    expect(migrated.agentInteractions).toEqual([]);
    const { version: _v, agents: _a, agentMessages: _m, agentInteractions: _i, ...rest } = migrated;
    const {
      version: _oldVersion,
      agents: _oldAgents,
      agentMessages: _oldMessages,
      agentInteractions: _oldInteractions,
      ...oldRest
    } = v10;
    expect(rest).toEqual(oldRest);
    // Operators keep their pre-Lv3 shape: `'rules'`, no `agentId`.
    expect(migrated.operators.every((o) => o.kind === 'rules' && o.agentId === undefined)).toBe(true);
  });

  it('still migrates a v9 save all the way to v11 (guards KNOWN_ISSUES C-14)', () => {
    const migrated = migrateV9(v9Fixture());
    expect(migrated.version).toBe(11);
    expect(migrated.agents).toEqual([]);
    expect(worldSchema.safeParse(migrated).success).toBe(true);
  });

  it('chains v9 -> v10 -> v11 through parseSave without losing information', () => {
    const migrated = parseSave(v9Fixture());
    expect(migrated.version).toBe(11);
    expect(migrated.ships).toHaveLength(6);
    expect(migrated.tick).toBe(0);
    expect(migrated.nextId).toBe(1);
    expect(migrated.wormholes.length).toBeGreaterThan(0);
    expect(migrated.agentMessages).toEqual([]);
  });

  it('reports the current version as 11', () => {
    expect(CURRENT_SAVE_VERSION).toBe(11);
    expect(createWorld().version).toBe(11);
  });
});

describe('P-3 unknown versions are refused', () => {
  it('throws UnsupportedSaveVersionError for 5, 6, 7, 8 and 12', () => {
    const world = agentEngine().state;
    for (const version of [5, 6, 7, 8, 12])
      expect(() => parseSave({ ...world, version })).toThrow(UnsupportedSaveVersionError);
  });
});

describe('P-4 agent state survives a save/load round-trip', () => {
  it('preserves every Agent field byte for byte', () => {
    const engine = agentEngine();
    engine.state.agents[0].memories = [
      episodicMemory({ id: 'memory-1', at: 3, text: '发现异常信号', tags: ['discovery'] }),
    ];
    engine.state.agents[0].state.fatigue = 42;
    engine.state.agents[0].nextDecisionAt = 137;
    const reloaded = parseSave(JSON.parse(JSON.stringify(engine.state)));
    expect(reloaded.agents).toEqual(engine.state.agents);
    expect(reloaded.agents[0].nextDecisionAt).toBe(137);
    expect(reloaded.agents[0].state.fatigue).toBe(42);
    expect(reloaded.agents[0].memories).toHaveLength(1);
    // And the reloaded world still replays identically.
    const a = new SimulationEngine(engine.state);
    const b = new SimulationEngine(reloaded);
    a.dispatchCommand({ type: 'pause', paused: false });
    b.dispatchCommand({ type: 'pause', paused: false });
    for (let i = 0; i < 60; i++) {
      a.step();
      b.step();
    }
    expect(a.state).toEqual(b.state);
  });
});

describe('P-7/P-8/P-9 the schema polices the Agent graph', () => {
  const withAgents = (): WorldState =>
    JSON.parse(JSON.stringify(agentEngine().state)) as WorldState;

  it('refuses over-cap collections', () => {
    const world = withAgents();
    const overMemories = JSON.parse(JSON.stringify(world));
    overMemories.agents[0].memories = Array.from({ length: 41 }, (_, i) =>
      episodicMemory({ id: 'm' + i, at: i, text: 'x', tags: ['discovery'] }),
    );
    expect(worldSchema.safeParse(overMemories).success).toBe(false);

    const overMessages = JSON.parse(JSON.stringify(world));
    overMessages.agentMessages = Array.from({ length: 201 }, (_, i) => ({
      id: 'agent-message-' + i,
      at: 0,
      from: 'admiral',
      to: 'agent-1',
      kind: 'report',
      text: '',
      payload: null,
      read: true,
    }));
    expect(worldSchema.safeParse(overMessages).success).toBe(false);

    const overInteractions = JSON.parse(JSON.stringify(world));
    overInteractions.agentInteractions = Array.from({ length: 201 }, (_, i) => ({
      id: 'agent-interaction-' + i,
      at: 0,
      kind: 'ask',
      actorId: 'admiral',
      targetAgentId: 'agent-1',
      messageId: null,
      outcome: 'pending',
      effects: {
        trustInAdmiral: 0,
        loyaltyToCompany: 0,
        morale: 0,
        stress: 0,
        fatigue: 0,
        goalProgress: 0,
        experience: 0,
      },
    }));
    expect(worldSchema.safeParse(overInteractions).success).toBe(false);
  });

  it('refuses a duplicate or dangling operator agentId', () => {
    const bound = withAgents().operators.filter((o) => o.kind === 'agent');
    expect(bound).toHaveLength(4);
    const operatorFor = (world: WorldState, index: number) => {
      const operator = world.operators.find((o) => o.id === bound[index].id);
      if (!operator) throw new Error('missing operator under test');
      return operator;
    };

    const duplicated = withAgents();
    operatorFor(duplicated, 1).agentId = bound[0].agentId;
    expect(worldSchema.safeParse(duplicated).success).toBe(false);

    const dangling = withAgents();
    operatorFor(dangling, 0).agentId = 'agent-99';
    expect(worldSchema.safeParse(dangling).success).toBe(false);

    const halfBound = withAgents();
    operatorFor(halfBound, 0).kind = 'rules';
    expect(worldSchema.safeParse(halfBound).success).toBe(false);
  });

  it('refuses a dangling or self-referential relationship', () => {
    const dangling = withAgents();
    dangling.agents[0].relationships[0].targetAgentId = 'agent-99';
    expect(worldSchema.safeParse(dangling).success).toBe(false);

    const self = withAgents();
    self.agents[0].relationships[0].targetAgentId = self.agents[0].id;
    expect(worldSchema.safeParse(self).success).toBe(false);
  });

  it('refuses a message from an unknown sender', () => {
    const world = withAgents();
    world.agentMessages = [
      {
        id: 'agent-message-1',
        at: 0,
        from: 'agent-99',
        to: 'agent-1',
        kind: 'report',
        text: '',
        payload: null,
        read: false,
      },
    ];
    expect(worldSchema.safeParse(world).success).toBe(false);
  });

  it('counts agent ids against the shared numbered sequence', () => {
    const world = withAgents();
    const agent = agentEngine().state.agents[0];
    expect(agentSchema.safeParse(agent).success).toBe(true);
    // A new id at or above `nextId` means the allocator was bypassed.
    world.nextId = 1;
    expect(worldSchema.safeParse(world).success).toBe(false);
  });
});

describe('P-11/P-12 disk layout and migration trigger', () => {
  const writeV10Index = (dir: string) => {
    const branch = { id: 'frontier-000001', parent: null };
    const source = join(dir, 'frontiers-v10', branch.id);
    mkdirSync(source, { recursive: true });
    const world = v10World();
    writeFileSync(join(source, 'head.json'), JSON.stringify(world));
    writeFileSync(join(source, 'branch.json'), JSON.stringify(branch));
    writeFileSync(
      join(dir, 'timeline-v10.json'),
      JSON.stringify({ version: 10, activeId: branch.id, branches: [branch] }),
    );
    return { branch, world };
  };

  it('uses the v11 root and index', () => {
    const dir = tempDir();
    const store = new SaveStore(dir);
    expect(store.root).toContain('frontiers-v11');
    expect(existsSync(join(dir, 'timeline-v11.json'))).toBe(false);
    store.write(agentEngine().state);
    expect(existsSync(join(dir, 'timeline-v11.json'))).toBe(true);
  });

  it('triggers a migration when only a v10 index exists (guards KNOWN_ISSUES C-15)', () => {
    const dir = tempDir();
    const { world } = writeV10Index(dir);
    const store = new SaveStore(dir);
    const loaded = store.read();
    expect(loaded.blocked).toBe(false);
    expect(loaded.world?.version).toBe(11);
    expect(loaded.world?.agents).toEqual([]);
    // Original v10 files are never rewritten.
    expect(JSON.parse(readFileSync(join(dir, 'frontiers-v10', 'frontier-000001', 'head.json'), 'utf8'))).toEqual(world);
    expect(existsSync(join(dir, 'frontiers-v11', 'frontier-000001', 'head.json'))).toBe(true);
    const index = JSON.parse(readFileSync(join(dir, 'timeline-v11.json'), 'utf8')) as {
      version: number;
    };
    expect(index.version).toBe(11);
  });

  it('still migrates a v9-only directory', () => {
    const dir = tempDir();
    const branch = { id: 'frontier-000001', parent: null };
    const source = join(dir, 'frontiers-v9', branch.id);
    mkdirSync(source, { recursive: true });
    const original = readFileSync(join('tests', 'fixtures', 'v9', 'initial.json'), 'utf8');
    writeFileSync(join(source, 'head.json'), original);
    writeFileSync(join(source, 'branch.json'), JSON.stringify(branch));
    writeFileSync(
      join(dir, 'timeline-v9.json'),
      JSON.stringify({ version: 9, activeId: branch.id, branches: [branch] }),
    );
    const loaded = new SaveStore(dir).read();
    expect(loaded.blocked).toBe(false);
    expect(loaded.world?.version).toBe(11);
    expect(readFileSync(join(source, 'head.json'), 'utf8')).toBe(original);
    expect(existsSync(join(dir, 'timeline-v9.json'))).toBe(true);
  });
});
