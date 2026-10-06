import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  copyFileSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { worldSchema } from '../src/engine/save-schema';
import { parseSave, UnsupportedSaveVersionError } from '../src/engine/saves';
import { gameCalendar, TICKS_PER_DAY } from '../src/engine/clock';
import type { WorldState } from '../src/engine/types';
import type { TimelineStatus } from '../src/engine/timeline';
const branchId = z.string().regex(/^frontier-\d{6,}$/);
const metaSchema = z
  .object({
    id: branchId,
    parent: z.object({ id: branchId, day: z.number().int().positive() }).strict().nullable(),
  })
  .strict();
const indexSchema = z
  .object({ version: z.literal(10), activeId: branchId, branches: z.array(metaSchema) })
  .strict();
type Index = z.infer<typeof indexSchema>;
function atomic(path: string, data: unknown) {
  writeFileSync(path + '.tmp', JSON.stringify(data), 'utf8');
  renameSync(path + '.tmp', path);
}
function loadWorld(path: string) {
  const text = readFileSync(path, 'utf8');
  if (text.length > 32_000_000) throw Error('存档超过容量限制');
  return parseSave(JSON.parse(text));
}
export class SaveStore {
  readonly root: string;
  readonly indexPath: string;
  private index: Index | null = null;
  private blocked = false;
  private migrationFailed = false;
  constructor(readonly directory: string) {
    this.root = join(directory, 'frontiers-v10');
    this.indexPath = join(directory, 'timeline-v10.json');
    if (!existsSync(this.indexPath) && existsSync(join(directory, 'timeline-v9.json'))) {
      try {
        this.migrateTimeline();
      } catch {
        this.blocked = true;
        this.migrationFailed = true;
      }
    }
    mkdirSync(this.root, { recursive: true });
    if (existsSync(this.indexPath))
      try {
        this.index = indexSchema.parse(JSON.parse(readFileSync(this.indexPath, 'utf8')));
        if (!this.index.branches.some((b) => b.id === this.index!.activeId))
          throw Error('Missing active branch');
      } catch {
        this.blocked = true;
      }
  }
  private migrateTimeline() {
    const legacyIndex = indexSchema
      .extend({ version: z.literal(9) })
      .parse(JSON.parse(readFileSync(join(this.directory, 'timeline-v9.json'), 'utf8')));
    if (!legacyIndex.branches.some((b) => b.id === legacyIndex.activeId))
      throw Error('Missing active branch');
    if (existsSync(this.root)) throw Error('Uncommitted migration preserved');
    const stage = join(this.directory, 'frontiers-v10-migration-' + Date.now());
    mkdirSync(stage, { recursive: true });
    // Validate every branch before publishing its index; v9 files are never rewritten.
    for (const branch of legacyIndex.branches) {
      const source = join(this.directory, 'frontiers-v9', branch.id);
      const destination = join(stage, branch.id);
      mkdirSync(destination);
      const head = (() => {
        try {
          return loadWorld(join(source, 'head.json'));
        } catch (error) {
          if (error instanceof UnsupportedSaveVersionError) throw error;
          return loadWorld(join(source, 'head.json.bak'));
        }
      })();
      atomic(join(destination, 'head.json'), head);
      atomic(join(destination, 'branch.json'), branch);
      for (const file of readdirSync(source)) {
        if (!/^day-\d+\.json$/.test(file) && file !== 'failure.json' && file !== 'head.json.bak')
          continue;
        if (file === 'head.json.bak') {
          try {
            atomic(join(destination, file), loadWorld(join(source, file)));
          } catch {
            /* Keep the original corrupt backup in v9. */
          }
        } else atomic(join(destination, file), loadWorld(join(source, file)));
      }
    }
    renameSync(stage, this.root);
    atomic(this.indexPath, { ...legacyIndex, version: 10 });
  }
  get path() {
    return join(this.root, this.index?.activeId ?? 'uninitialized', 'head.json');
  }
  read(): { world: WorldState | null; message: string; blocked: boolean } {
    if (this.blocked)
      return {
        world: null,
        message: this.migrationFailed
          ? 'v9 时间线迁移验证失败；原存档完整保留，已阻止启用新版存档。'
          : '时间线索引损坏或版本不支持；已保留原文件并阻止覆盖。',
        blocked: true,
      };
    if (!this.index) return { world: null, message: 'v10 曙光边疆就绪。', blocked: false };
    const terminal = join(this.root, this.index.activeId, 'failure.json');
    if (existsSync(terminal)) {
      try {
        return { world: loadWorld(terminal), message: '已恢复封存的失败时间线', blocked: false };
      } catch {
        this.blocked = true;
        return {
          world: null,
          message: '失败时间线记录不可读，已禁止回退到失败前的自动存档。',
          blocked: true,
        };
      }
    }
    for (const path of [this.path, this.path + '.bak'])
      try {
        const world = loadWorld(path);
        return {
          world,
          message: path === this.path ? '已恢复 v10 时间线' : '已从同代备份恢复',
          blocked: false,
        };
      } catch (error) {
        if (error instanceof UnsupportedSaveVersionError) {
          this.blocked = true;
          return { world: null, message: '禁止覆盖不支持的存档版本', blocked: true };
        }
      }
    this.blocked = true;
    return {
      world: null,
      message: '当前时间线存档不可读；可开始新边疆，原文件将保留。',
      blocked: true,
    };
  }
  private create(world: WorldState, parent: Index['branches'][number]['parent']): WorldState {
    worldSchema.parse(world);
    const ids = readdirSync(this.root).filter((n) => /^frontier-\d+$/.test(n));
    const n = Math.max(0, ...ids.map((id) => Number(id.slice(9)))) + 1,
      id = 'frontier-' + String(n).padStart(6, '0');
    const dir = join(this.root, id);
    mkdirSync(dir);
    atomic(join(dir, 'head.json'), world);
    if (world.tick % TICKS_PER_DAY === 0)
      writeFileSync(
        join(dir, 'day-' + gameCalendar(world.tick).day + '.json'),
        JSON.stringify(world),
        { flag: 'wx' },
      );
    const meta = { id, parent };
    atomic(join(dir, 'branch.json'), meta);
    const next: Index = {
      version: 10,
      activeId: id,
      branches: [...(this.index?.branches ?? []), meta],
    };
    if (this.blocked && existsSync(this.indexPath))
      copyFileSync(this.indexPath, this.indexPath + '.preserved-' + Date.now());
    atomic(this.indexPath, next);
    this.index = next;
    this.blocked = false;
    return structuredClone(world);
  }
  write(world: WorldState) {
    if (this.blocked) throw Error('存档被保护，禁止覆盖');
    worldSchema.parse(world);
    if (!this.index) {
      this.create(world, null);
      return;
    }
    const failure = join(this.root, this.index.activeId, 'failure.json');
    if (existsSync(failure)) {
      const frozen = loadWorld(failure);
      if (JSON.stringify(frozen) !== JSON.stringify(worldSchema.parse(world)))
        throw Error('失败时间线已封存');
      return;
    }
    if (existsSync(this.path))
      try {
        loadWorld(this.path);
        copyFileSync(this.path, this.path + '.bak');
      } catch (error) {
        if (error instanceof UnsupportedSaveVersionError) throw error;
        copyFileSync(this.path, this.path + '.corrupt-' + Date.now());
      }
    atomic(this.path, world);
    if (world.status === 'commandLost')
      writeFileSync(failure, JSON.stringify(world), { flag: 'wx' });
  }
  daily(world: WorldState) {
    if (world.tick % TICKS_PER_DAY !== 0) throw Error('日快照必须位于午夜');
    worldSchema.parse(world);
    if (!this.index) {
      this.create(world, null);
      return;
    }
    const path = join(
      this.root,
      this.index.activeId,
      'day-' + gameCalendar(world.tick).day + '.json',
    );
    if (!existsSync(path)) writeFileSync(path, JSON.stringify(world), { flag: 'wx' });
  }
  private dailyPath(id: string, day: number): string | null {
    const visited = new Set<string>();
    let current: string | null = id;
    while (current && !visited.has(current)) {
      visited.add(current);
      const p = join(this.root, current, 'day-' + day + '.json');
      if (existsSync(p)) return p;
      const parent = this.index?.branches.find((b) => b.id === current)?.parent;
      current = parent && day <= parent.day ? parent.id : null;
    }
    return null;
  }
  status(tick: number): TimelineStatus {
    const day = gameCalendar(tick).day - 1;
    return {
      activeId: this.index?.activeId ?? null,
      previousDay: this.index && day >= 1 && this.dailyPath(this.index.activeId, day) ? day : null,
      branches: (this.index?.branches ?? []).flatMap((b) => {
        try {
          const w = loadWorld(join(this.root, b.id, 'head.json'));
          return [{ ...b, status: w.status, tick: w.tick, lossCount: w.losses.length }];
        } catch {
          return [];
        }
      }),
    };
  }
  restorePreviousDay(world: WorldState): WorldState {
    if (!this.index) throw Error('时间线未初始化');
    const day = gameCalendar(world.tick).day - 1,
      path = this.dailyPath(this.index.activeId, day);
    if (!path) throw Error('没有上一游戏日快照');
    const restored = loadWorld(path);
    if (restored.status !== 'active') throw Error('昨日快照已失去指挥权');
    this.write(world);
    restored.paused = true;
    restored.pauseReasons = [];
    return this.create(restored, { id: this.index.activeId, day });
  }
  beginNew(world: WorldState, current?: WorldState): WorldState {
    if (current && !this.blocked) this.write(current);
    return this.create(world, null);
  }
}
