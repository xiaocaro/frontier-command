# Lv3 工程基线（00-baseline）

生成日期：2026-10-07
仓库：`D:\Geek Tech\frontier-command`，分支 `docs/lv3-baseline-audit`，基线提交 `770822f`
用途：Prompt 0（Repository Baseline）产物，供后续 Codex / Lv3 阶段直接消费。

> 本文回答固定清单，**每个结论都带文件路径与符号名**。凡已在 `docs/lv3/00-baseline-audit.md` 中验证过的结论标 `[蒸馏]`（不重复考证）；本阶段新分析的标 `[新]`。未验证项一律写明，不伪造。

---

## 1. 当前版本与技术栈 `[新]`

| 项 | 值 | 位置 |
| --- | --- | --- |
| 包名 / 版本 | `frontier-command` / `1.1.0`，`private: true` | `package.json:2-4` |
| 主进程入口 | `dist-electron/electron/main.js` | `package.json:8` |
| 自我定位 | “Lv1 + Lv2 deterministic frontier ecology” | `package.json:6` |
| 存档版本 | **10**（`CURRENT_SAVE_VERSION`） | `src/engine/saves.ts:5` |

**运行时依赖（仅 4 个）**：`@fontsource/antonio ^5.2.0`、`react ^19.0.0`、`react-dom ^19.0.0`、`zod ^3.24.0`（`package.json:21-26`）。

**构建期依赖**：`electron ^41.0.0`、`electron-builder ^26`、`typescript ^5.9`、`vite ^6.4`、`vitest ^4.1.11`、`@playwright/test ^1.55`、`prettier ^3.6.2`（`package.json:27-39`）。本机实测安装版本：**electron 41.10.7 / playwright-core 1.63.0**。

**TypeScript 严格模式**：两套 tsconfig 都是 `"strict": true`（`tsconfig.json:8`、`tsconfig.electron.json:8`）。

**两套编译边界（重要）**：

- `tsconfig.json` — `noEmit`，include `["src", "electron", "tests", ...]`，用于类型检查（`tsconfig.json:15`）。
- `tsconfig.electron.json` — **只 include `electron/**/*.ts` 与 `src/engine/**/*.ts`**，输出 CJS 到 `dist-electron`（`tsconfig.electron.json:10`）。
  → **UI 层不进入 Electron 构建产物**；引擎与主进程才是被打包运行的部分。

> ⚠️ 仓库**没有 ESLint / Prettier 校验脚本**，`format` 只是 `prettier --write`（`package.json:14`），不参与 CI。没有 CI 配置文件。

---

## 2. 如何启动开发模式 `[新]`

```powershell
npm ci          # 安装依赖
npm run dev     # 开发模式
npm start       # 构建并启动生产 Electron
```

- `npm run dev` → `node scripts/dev.mjs`（`package.json:10`）。
- `scripts/dev.mjs` 做三件事：先 `tsc -p tsconfig.electron.json` 编译主进程；再启动 Vite dev server；最后以 `VITE_DEV_SERVER_URL` 启动 Electron（`scripts/dev.mjs:5-18`）。
- **`scripts/dev.mjs:13-17` 显式删除 `ELECTRON_RUN_AS_NODE`**，注释说明该变量由 VS Code 扩展宿主等设置，会让 electron 二进制退化为纯 Node 从而崩溃。**注意：这个 workaround 只覆盖 `npm run dev` 一条路径**，E2E 路径没有（详见 `00-test-baseline.md` §4）。
- Vite dev server 固定 `127.0.0.1:5373`。选这个端口是因为 Vite 默认的 5173 落在 Windows 保留 TCP 段内会 `EACCES`（`vite.config.ts:3-5` 注释）。
- `npm start` = `npm run build && electron .`（`package.json:12`）。

---

## 3. 如何 build `[新]`

```powershell
npm run build
```

等价于（`package.json:11`）：

```
node scripts/create-icon.mjs      # 程序化生成 build/icon.png + icon.ico
  && tsc --noEmit                 # 全量类型检查（src + electron + tests）
  && vite build                   # Renderer → dist/
  && tsc -p tsconfig.electron.json # 主进程 + 引擎 → dist-electron/
```

注意 `scripts/create-icon.mjs` 是**首步**，用纯 zlib 手工拼 PNG/ICO，不依赖外部图形库（`scripts/create-icon.mjs:1-69`）。

其他打包相关：`npm run package`（electron-builder --win --dir → `release/`）、`npm run package:zip`、`npm run test:package`、`npm run test:release`（`package.json:16-19`）。

---

## 4. 如何运行 unit test / e2e

```powershell
npm test           # vitest run
npm run test:e2e   # npm run build && playwright test
```

| 命令 | 配置 | 范围 |
| --- | --- | --- |
| `npm test` | `vitest.config.ts:2` → `include: ['tests/**/*.test.ts']` | 13 个文件 / **184 项** |
| `npm run test:e2e` | `playwright.config.ts:3` → `testDir: './tests/e2e'`，`workers: 1`，`timeout: 60000` | 8 个 spec / **36 项**（实测 34 通过 / 2 失败） |

> **E2E 必须 `env -u ELECTRON_RUN_AS_NODE`**，否则 36 项全红。且**不要用 `npm run test:e2e | tail` 判断成败**——管道退出码是 `tail` 的，会把失败显示成 exit 0。完整命令、原始结果与失败定性见 `00-test-baseline.md`。

真机验收脚本（非 npm script，需手动跑）：`node scripts/acceptance-v9.mjs 236807` 等，见 `00-test-baseline.md` §3。

---

## 5. Electron main / preload / renderer 边界 `[蒸馏 + 新]`

```text
Renderer (React, contextIsolation: true, sandbox: true, nodeIntegration: false)
    │  window.frontier.*            ← 唯一桥，src/global.d.ts:9-26
    ▼
preload.ts (contextBridge)          electron/preload.ts:3-20
    │  7 条 IPC 通道
    ▼
main.ts (唯一权威宿主)              electron/main.ts
    │  SimulationEngine 实例 + SaveStore 实例
    ▼
SimulationEngine.state : WorldState  src/engine/engine.ts:25
```

**7 条 IPC 通道（全量，无遗漏）**：

| 通道 | 方向 | 注册（main） | 暴露（preload） |
| --- | --- | --- | --- |
| `world:get` | R→M invoke | `electron/main.ts:99` | `preload.ts:4` `getState` |
| `world:command` | R→M invoke | `electron/main.ts:108` | `preload.ts:5` `command` |
| `world:save` | R→M invoke | `electron/main.ts:145` | `preload.ts:6` `save` |
| `world:timeline` | R→M invoke | `electron/main.ts:149` | `preload.ts:7` `timeline` |
| `display:zoom` | R→M invoke | `electron/main.ts:153` | `preload.ts:8` `setDisplayZoom` |
| `world:state` | M→R push | `electron/main.ts:24`（`send()`） | `preload.ts:15-19` `onState` |
| `world:events` | M→R push | `electron/main.ts:195` | `preload.ts:9-14` `onEvents` |

**安全约束**：

- 每个 invoke handler 首行调用 `trusted(event)`，校验发送方必须是主窗口主框架（`electron/main.ts:91-98`）。
- 窗口配置 `contextIsolation: true` / `nodeIntegration: false` / `sandbox: true`（`electron/main.ts:73-75`）。
- `will-navigate` 拦截外部跳转、`setWindowOpenHandler` 一律 deny、权限请求一律拒绝（`electron/main.ts:80-90`）。
- 自定义 `frontier://` protocol 做路径穿越防护（`electron/main.ts:40-52`）。
- **Renderer 永远拿不到 `WorldState`**，只有 `Snapshot`（`ReadonlyDeep<SnapshotData>`）——见 §6。
- `world:command` 额外接受一个严格限定的 `SessionCommand` 子集（`restorePreviousDay` / `beginNewFrontier`），在 `electron/main.ts:110-128` 用 Zod strict 解析。

---

## 6. 哪个对象拥有唯一世界权威 `[蒸馏]`

**`SimulationEngine.state: WorldState`**（`src/engine/engine.ts:25`）是唯一权威。

- 构造时 `structuredClone(world)` 与世界对象解耦（`engine.ts:29`）。
- 所有世界变更必须走 `dispatchCommand` → `validate` → `validateAction` → 应用（`src/engine/command-system.ts:149` / `:34` / `:340`）。
- 公开只读投影是 `snapshot()`（`src/engine/projection.ts:59`），类型 `ReadonlyDeep<SnapshotData>`（`src/engine/types.ts:664`）。
- 可执行证据：`tests/architecture.test.ts:28-30` 断言改写 `snapshot.ships[0].hull` 不影响 `engine.state`。

**隐藏状态确实不过界**（`tests/architecture.test.ts:85-102` 断言）：`Snapshot` 不含 `enemies` / `seed` / `factions`；未发现的设施与 `hidden` 天体不出现；失联接触位置冻结。

---

## 7. 游戏时间如何推进 `[蒸馏]`

`src/engine/clock.ts` 定义全部时间常量：

| 常量 | 值 | 含义 |
| --- | --- | --- |
| `TICKS_PER_MINUTE` | 10 | 每游戏分钟 10 个 tick |
| `FIXED_DELTA` | `1/10 = 0.1` | **固定步长 = 0.1 游戏分钟** |
| `MINUTES_PER_DAY` | 1440 | |
| `TICKS_PER_DAY` | 14400 | |
| `HOST_FRAME_MS` | 100 | 宿主每 100ms 推一帧 |
| `SIMULATION_SPEEDS` | `[1, 4, 16]` | |

1× 速度下每帧 1 步 → **约 1 现实秒 = 1 游戏分钟**；4× / 16× 重复同样的固定步，不改变步长。

**步进链**：

- `SimulationEngine.step(fixedDelta = FIXED_DELTA)`（`engine.ts:134`）——`fixedDelta !== FIXED_DELTA` 时**直接抛错**（`engine.ts:135`）。
- `SimulationEngine.advanceFrame(afterStep?)`（`engine.ts:162`）——按 `state.speed` 重复 `step()`，`paused` 时立即停。
- 宿主驱动：`electron/main.ts:165-196` 的 `setInterval(..., HOST_FRAME_MS)`。
- `advanceFrame` 的 `afterStep` 回调负责 `dayBoundary → store.daily`、`commandLost → store.write`（`electron/main.ts:169-172`）。

> **该循环内没有任何网络调用、Promise、await 或模型调用**——满足 CLAUDE.md §2.4 与题面「模型不需每帧调用」的约束。这是 Lv3 必须保持的不变量。

---

## 8. LLM 当前是否存在、在哪里不存在 `[蒸馏]`

**完全不存在。**

对 `src/ electron/ tests/ scripts/` 全量 grep `llm|openai|anthropic|prompt|gpt|claude|inference|neural`：**零命中**。

具体地：

- 无 API 客户端、无 provider 抽象、无密钥/环境变量读取、无 `.env` 处理。
- 无 `prompts/` 目录，无任何提示词文件。
- 运行时依赖只有 4 个（§1），其中**没有任何 HTTP 客户端**。
- `docs/references.md:45-47` 提到曾阅读 GLM-4.6v-flash 文档并计划「后续只在决策节点通过结构化动作接入」——**该计划从未落地**。

→ **Lv3 的模型层从零开始，且不存在任何需要兼容的既有 LLM 代码。**

---

## 9. 当前 Agent / Operator 的实际定义 `[蒸馏]`

**数据结构已存在，行为完全为空。**

```ts
// src/engine/types.ts:382-392
export interface Operator {
  id: string;
  name: string;
  kind: 'rules';                                  // ← 字面量，只有一种取值
  availability: 'available' | 'vesselLost';
}
export interface Assignment { operatorId: string; shipId: string; since: number; }
```

- 创建：`createWorld()` 为每艘初始舰船生成 `ops-<shipId>`，`kind: 'rules'`，并建立 1:1 assignment（`src/engine/data.ts:175-181`）。
- 持久化约束：`kind: z.literal('rules')`（`src/engine/save-schema.ts:158`）；schema 强制 ship↔operator **一一对应且无重复**，operator 必须 `available`（`save-schema.ts:521-532`）。
- 损失联动：舰船被摧毁时对应 operator 置 `vesselLost`（`src/engine/combat.ts:108`）。
- 公开可见：`operators` 与 `assignments` 都进入 `Snapshot`（`src/engine/types.ts:539-540`）。

**Agent 接缝（唯一的、且已被测试固定）**：

```ts
// src/engine/types.ts:653-656
export interface AgentControllerPort {
  getObservation(): Observation | null;
  submitAction(action: Action): CommandResult;
}
```

- 实现：`SimulationEngine.controllerPort(operatorId)` 返回 `Object.freeze({...})`（`src/engine/engine.ts:91-96`）。
- `tests/architecture.test.ts:13` **精确断言端口恰好只有这两个键**——任何新增方法都会撞这个测试。
- `Observation` 字段：`time, operatorId, ship, contacts, systems, bodies, opportunities, legalActions`（`src/engine/types.ts:643-652`，构造见 `src/engine/projection.ts:199-228`）。

**`submitAction` 的实际语义**（`src/engine/command-system.ts:550-563`）：

```text
Zod 校验 action
  → 找不到该 operator 的 assignment            → no('执行主体不可用')
  → current/queue/suspended 存在 admiral 指令   → no('Admiral 当前、队列和挂起指令优先')
  → 该舰有任何在途指令                          → no('执行主体正在完成既有行动')
  → dispatchCommand(issueDirective, [本舰], QUEUE)
```

即「**Admiral 绝对优先**」是硬编码在 `submitAction` 里的。

---

## 10. 当前 Ship 的控制模型 `[蒸馏 + 新]`

**Ship 是纯物理/世界实体，不含任何人格、记忆或目标状态。**

> **[修正 2026-10-07]** 原文写作「不含任何人格或**决策状态**」，与紧接着介绍的 `standing: StandingOrders` 自相矛盾——`standing` 本身就是决策策略状态。已收窄为「人格、记忆或目标状态」，这才是 Lv3 相关且准确的表述：Ship 携带的是**策略**（ROE、阈值、保护开关），不是**主体**（性格、记忆、目标）。

```ts
// src/engine/types.ts:261-291（节选）
interface Ship {
  hull; shield; core; photon; quantum; modules; engines; weapons;
  status: 'docked' | 'active' | 'idle';
  current: Directive | null;      // 当前指令
  queue: Directive[];             // FIFO 队列
  suspended: Directive[];         // INTERRUPT 造成的 LIFO 栈
  standing: StandingOrders;       // ROE 与自主行为阈值
  path: Point[]; heading; cargo; passengers; cooldowns;
  cloak; emergencyRetreat; tracking;
}
```

**三种下达语义**（`issueDirective.mode`，`src/engine/types.ts:582`）：

| mode | 行为 |
| --- | --- |
| `REPLACE` | 清空 current + queue + suspended 三者 |
| `QUEUE` | 追加到 FIFO `queue` |
| `INTERRUPT` | 把 current 压入 LIFO `suspended` |

完成时 `complete()` 先弹 `suspended` 再取 `queue`，并对接续目标做 `validateContinuation`（`src/engine/engine.ts:108-133`，`command-system.ts:309`）。

**指令执行由 `advanceShip` 单一拥有**（`src/engine/execution.ts:140`），20+ 个 action 分支的行号见 `00-code-map.md` §3。

**Ship 与 Agent 的关系**：当前 `Operator` ↔ `Ship` 是 1:1 assignment；Ship 自己没有决策逻辑，`standing: StandingOrders` 的自主行为由**两处**规则代码执行，**均不经模型**：

| 行为 | 执行位置 | 内容 |
| --- | --- | --- |
| 非交战自主行为 | `advanceStanding`（`src/engine/fleet.ts:49`，由 `src/engine/execution.ts:143` 每步调用） | 撤退阈值（`:56-59`）、紧急脱离（`:81-91`）、停靠维修/装弹（`:94-105`）、响应遇险（`:106-117`）、护航（`:118-133`）、殖民地巡逻（`:134-147`） |
| **ROE** | `autonomousFire`（`src/engine/execution.ts:721`） | `HOLD FIRE` 早退（`:722`）；候选筛选（`:723-731`）：`ENGAGE HOSTILES`、或该目标曾攻击本舰、或曾攻击被保护对象 |

两者都受 Admiral 优先约束：`advanceStanding` 首行即 `hasAdmiralWork(s)` 早退（`fleet.ts:50`），且所有自主指令都先经 `validateAction`（`fleet.ts:64`）。

`autonomousFire` 由 `advanceShip` 在**两处**调用：无当前指令时（`execution.ts:152-155`），以及非交战指令执行后的收尾（`execution.ts:714-719`，排除 `ATTACK`/`DISABLE`/`DRIVE_OFF`/`SHADOW` 四类）。

> **[修正 2026-10-07]** 原文把上述两者合并为一句「（ROE、撤退阈值、护航）由 `advanceStanding`（`src/engine/fleet.ts`）执行」，**把 ROE 归错了文件**——`fleet.ts` 全文不含 `roe`。实际 ROE 在 `src/engine/execution.ts:722` 与 `:727`。经复核 `fleet.ts` 与 `execution.ts` 原文后修正。

---

## 11. 当前 SaveStore / save schema 的版本策略 `[蒸馏]`

**策略：严格版本闸门 + 只前进一步迁移 + v9 契约冻结。**

```text
version === 9  → migrateV9(input)      src/engine/saves.ts:52
version !== 10 → throw UnsupportedSaveVersionError   src/engine/saves.ts:53-54
version === 10 → worldSchema.parse(input)            src/engine/saves.ts:55
```

| 组成 | 位置 | 职责 |
| --- | --- | --- |
| `CURRENT_SAVE_VERSION = 10` | `src/engine/saves.ts:5` | 版本常量 |
| `migrateV9` | `src/engine/saves.ts:7-48` | v9 → v10 迁移 |
| `parseSave` | `src/engine/saves.ts:49-56` | 版本闸门 |
| `worldSchema`（v10） | `src/engine/save-schema.ts:741 行`，`version: z.literal(10)` 在 `:133` | 当前 schema + 交叉一致性校验 |
| `v9-schema.ts` | `src/engine/v9-schema.ts` | v10 与 v9 **共享**的子 schema |
| `legacy-v9/save-schema.ts` | 703 行 | **冻结的 v9 契约，不得修改** |

**磁盘布局**（`electron/persistence.ts:44-45`）：

```text
frontiers-v10/                    ← 当前世界根
  frontier-000001/
    head.json                     ← 当前状态
    head.json.bak                 ← 同代备份
    day-<N>.json                  ← 每日快照（午夜写入）
    branch.json                   ← 分支元数据
    failure.json                  ← COMMAND LOST 后的封存（只写一次，flag:'wx'）
timeline-v10.json                 ← 分支索引 {version:10, activeId, branches[]}
```

与 v9 及更早**完全隔离**（v9 用 `timeline-v9.json` / `frontiers-v9/`）。

**关键不变量**：

- 原子写：先写 `.tmp` 再 `renameSync`（`electron/persistence.ts:28-31`）。
- 读取优先级：`failure.json` → `head.json` → `head.json.bak`（`persistence.ts:106-149`）。
- 迁移先全部校验到 staging 目录，再 `renameSync` 发布；**v9 原文件从不改写**；失败则 `blocked = true` 拒绝覆盖（`persistence.ts:64-102`）。
- `blocked` 状态下 `write()` 直接抛错（`persistence.ts:179`）。
- 存档大小上限 32MB（`persistence.ts:34`）。

> **Lv3 影响**：任何进入 `WorldState` 的 Agent 状态都必须走 **v11 + 迁移**，沿用这套 staged-migration 模式；**`legacy-v9/` 不得改动**。

---

## 附：本阶段固定检查的 10 个边界（Prompt 0 E 段）

| 边界 | 位置 | 状态 |
| --- | --- | --- |
| `AgentControllerPort` | `src/engine/types.ts:653-656`，`engine.ts:91-96` | 存在，2 方法，`Object.freeze`，被 `architecture.test.ts:13` 固定 |
| `getObservation()` | `src/engine/projection.ts:199-228` | 存在；无 assignment 返回 `null` |
| `submitAction()` | `src/engine/command-system.ts:550-563` | 存在；Admiral 优先硬编码 |
| `actionSchema` / `commandSchema` | `src/engine/commands.ts:25-78` / `:117-243` | 存在，Zod `.strict()`，唯一运行时验证层 |
| `WorldState` | `src/engine/types.ts:474-522` | `version: 10` 字面量 |
| `Operator` / `Assignment` | `src/engine/types.ts:382-392` | 存在但 `kind` 仅 `'rules'` |
| `SimulationEngine.step()` | `src/engine/engine.ts:134-161` | 同步、固定步、无 I/O |
| `SimulationEngine.advanceFrame()` | `src/engine/engine.ts:162-171` | 按 speed 重复 step |
| persistence / save schema | `electron/persistence.ts`，`src/engine/save-schema.ts` | v10，严格闸门，v9 冻结 |
| public Snapshot 与 hidden state 隔离 | `src/engine/projection.ts:59-198` | 白名单投影，有测试 |
