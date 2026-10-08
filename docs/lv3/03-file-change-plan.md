# Lv3 文件级改动计划（03-file-change-plan）

生成日期：2026-10-08
阶段：Prompt 3（Implementation Plan + Codex Handoff）
性质：文件级施工图。**本阶段不执行任何一条改动**；本文件供 Prompt 4 起逐项落地。

**依据**：`docs/lv3/02-*.md`（批准的架构与合同）、`schemas/*.json`、`KNOWN_ISSUES.md`、实际 `src/`/`electron/`/`tests/` 源码。
**基线**：`npm test` = 13 files / 184 tests PASS（本阶段实测）。

---

## 1. 分类定义

| 分类 | 含义 |
| --- | --- |
| **MUST CHANGE** | 不完成则 Lv3 无法工作，或会破坏 Lv1/Lv2 |
| **SHOULD CHANGE** | 强烈建议；不做则留下技术债或可维护性问题 |
| **OPTIONAL** | 可做可不做，收益有限 |
| **DO NOT MODIFY** | 明确禁止改动；改动会破坏既有契约 |

---

## 2. 索引（速查）

| File | Op | Class | Why |
| --- | --- | --- | --- |
| `src/engine/legacy-v10/save-schema.ts` | CREATE | MUST | 冻结 v10 校验器，供 `migrateV10` 使用 |
| `src/engine/agent/*.ts`（13 个） | CREATE | MUST | 纯领域层 |
| `electron/agent/*.ts`（6 个） | CREATE | MUST | 异步编排与 provider |
| `prompts/agent/*.md`（4 个） | CREATE | MUST | 版本化提示词 |
| `tests/agent/*.test.ts`、`tests/fixtures/agent/*` | CREATE | MUST | 验收测试与 fixture |
| `src/engine/types.ts` | MODIFY | MUST | Agent 类型、`Operator` 加宽、v11、Observation 加宽 |
| `src/engine/save-schema.ts` | MODIFY | MUST | v11 + 新集合 + 约束 |
| `src/engine/saves.ts` | MODIFY | MUST | `CURRENT_SAVE_VERSION`、`migrateV9`、`migrateV10`、闸门 |
| `src/engine/data.ts` | MODIFY | MUST | 4 名初始 Agent 引导 |
| `src/engine/projection.ts` | MODIFY | MUST | `getObservation` 加宽、移除 `legalActions` |
| `src/engine/commands.ts` | MODIFY | MUST | 新增 `agentMessage` 命令 schema |
| `src/engine/command-system.ts` | MODIFY | MUST | `agentMessage` 校验放宽 + 处理分支 |
| `electron/persistence.ts` | MODIFY | MUST | v11 根目录/索引/链式迁移（`C-15`） |
| `electron/main.ts` | MODIFY | MUST | 调度器宿主接线 |
| `package.json` | MODIFY | MUST | `build.files` 加入 `prompts/**/*`（`C-14`） |
| `src/engine/definitions/rules.ts` | MODIFY | SHOULD | 新增 `agentDecisionInterval`（追加，`C-18`） |
| `src/engine/engine.ts` | MODIFY | SHOULD | `pendingEvents` 追加 `AgentTrigger` 变体（纯追加） |
| `tests/architecture.test.ts` | MODIFY | MUST | `:105` 版本列表 `11` → `12`（`C-12`） |
| `tests/persistence.test.ts` | MODIFY | MUST | `:108` `version: 11` → `12`（`C-13`） |
| `tests/mine-accidents.test.ts` | MODIFY | MUST | `:186` `toBe(10)` → `11`（`C-13`） |
| `tests/v10.test.ts` | MODIFY | MUST | `:371`/`:390` `10`→`11`；`:385` `frontiers-v10`→`frontiers-v11`（`C-13`） |
| `tests/e2e/desktop.spec.ts` | MODIFY | MUST* | `:174` `10`→`11`；`:239` 路径（`C-13`）；E2E 属 P3 可选验证 |
| `scripts/acceptance-v9.mjs` | INSPECT | OPTIONAL | `:119` 的 `version: 10` 标签，确认是否参与断言 |
| `src/engine/legacy-v9/**` | — | DO NOT MODIFY | 冻结 |
| `src/engine/v9-schema.ts` | — | DO NOT MODIFY | 被活 schema 与冻结 v9 共用 |
| `src/engine/commands.ts` 的 `careerSchema` | — | DO NOT MODIFY | Personnel 枚举，与 `AgentCareer` 无关（`C-8`） |
| `src/engine/engine.ts` 的 `step()`/`advanceFrame` | — | DO NOT MODIFY | 确定性 |
| `src/engine/fleet.ts` `sensors.ts` `world-events.ts` `execution.ts` | — | 仅允许追加行 | Lv1/Lv2 |
| `src/engine/definitions/{factions,resources}.ts` | — | DO NOT MODIFY | 死代码（零 import） |
| `src/ui/**` | — | DO NOT MODIFY | Agent 经既有 `Communication` 流显示 |
| `schemas/*.json` | — | DO NOT MODIFY | 已批准合同 |

---

## 3. CREATE 明细

### 3.1 `src/engine/legacy-v10/save-schema.ts`

| 字段 | 内容 |
| --- | --- |
| Responsibility | 冻结的 v10 存档校验器（`worldSchema` 的 v10 版本副本） |
| Why | `migrateV10` 必须能校验 v10 输入；`worldSchema` 是 `ZodEffects`（`.strict().superRefine`，`save-schema.ts:131,420-741`），**无法 `.omit()` 派生**（`C-24`），只能整份复制 |
| Existing Behavior | 无（新文件） |
| Lv3 Change | 复制今日 `save-schema.ts`，保留 `version: z.literal(10)`、`kind: z.literal('rules')`，**不含** `agentId` 与三个 Agent 数组 |
| Public API Impact | 新增 `export const worldSchema as legacyV10Schema` |
| Save Impact | 无（只读校验器） |
| Test Impact | `tests/agent/migration.test.ts` 用 v10 fixture 校验 |
| Risk | **必须在修改活 `save-schema.ts` 之前完成**，否则复制到的已是 v11。参照 `legacy-v9/save-schema.ts:8,19` 的写法（它 import 活的 `../commands`、`../v9-schema`、`../types`、`../capabilities`，故「冻结」意为**钉住字面量**，非完全隔离） |

### 3.2 `src/engine/agent/`（13 个文件）

| 字段 | 内容 |
| --- | --- |
| Responsibility | 纯领域：类型、Zod 合同、人格、目标、状态、记忆、关系、承诺、评分、候选动作、观察、决策、互动 |
| Why | `02-architecture.md` §2 的批准边界；CLAUDE.md §5 要求模块化而非 god class |
| Existing Behavior | 无 |
| Lv3 Change | 全部新增 |
| Public API Impact | 新增领域 API；**不得**被 `electron/agent/` 之外的运行时代码绕过 |
| Save Impact | 这些类型构成 `WorldState.agents` 的形状 |
| Test Impact | `tests/agent/*.test.ts` |
| Risk | `types.ts`/`schemas.ts` 是 `02-architecture.md` §2 未列的两份；理由见 `03-implementation-plan.md` §2。12 个模块无 I/O、无 `fetch`、无 `Date`、无 `Math.random`（`N-4`） |

### 3.3 `electron/agent/`（6 个文件）

| 字段 | 内容 |
| --- | --- |
| Responsibility | `runtime`（编排）、`scheduler`（触发/去抖/单飞）、`model-client`（接口）、`mock-client`（fixture provider）、`openai-compatible`（DeepSeek 等）、`prompt`（装配） |
| Why | LLM 属主必须留在主进程（`main.ts:71-77` 的 sandbox + contextIsolation） |
| Existing Behavior | 无 |
| Lv3 Change | 全部新增 |
| Public API Impact | 仅宿主（`electron/main.ts`）消费；`src/**` **禁止** import |
| Save Impact | 无（不持有 `WorldState` 引用，只有 `ControllerPort`） |
| Test Impact | vitest 可直接 import（`tsconfig.json` include 含 `electron`） |
| Risk | 违反「`electron/agent/**` 不被 `src/**` 引用」会破坏 LLM 边界。加 `tests/agent/boundary.test.ts` 断言 |

### 3.4 `prompts/agent/{system,decision,conversation,reflection}.md`

| 字段 | 内容 |
| --- | --- |
| Responsibility | 版本化提示词，各带 `prompt_version` |
| Why | CLAUDE.md §7：提示词不得埋进 TS 源码 |
| Existing Behavior | 无 |
| Lv3 Change | 全部新增 |
| Public API Impact | 无（被 `prompt.ts` 读取） |
| Save Impact | 无 |
| Test Impact | 断言装配结果不含 `enemies`/`seed`/`factions`/他人 memory/`DecisionScore` |
| Risk | **打包**：`package.json` 的 `build.files` 不含 `prompts/**`，必须追加（`C-14`）；并处理 dev 与 asar 下的路径差异 |

### 3.5 测试与 fixture

| 字段 | 内容 |
| --- | --- |
| Responsibility | 每张任务卡的验收；mock 决策 fixture；P3 场景 fixture |
| Why | CLAUDE.md §10 |
| Existing Behavior | 无 |
| Lv3 Change | `tests/agent/{schemas,schema-consistency,domain,migration,observation,actions,score,decision,interactions,command,bootstrap,boundary,scheduler,runtime,provider,replay,vertical-slice}.test.ts` + `tests/fixtures/agent/*.json` |
| Public API Impact | 无 |
| Save Impact | 无 |
| Test Impact | 与既有 13 个测试文件**并存**，不替换 |
| Risk | 不得修改既有测试的语义（唯一例外见 §4.16–§4.20） |

---

## 4. MODIFY 明细

> 每一项都回答同一组问题。**核心结论：`src/engine/` 与 `electron/` 的既有文件全部是「扩展」，
> 没有任何一个是「重写」。**

### 4.1 `src/engine/types.ts`（extend）

| 字段 | 内容 |
| --- | --- |
| Responsibility（既有） | 全部领域类型：`WorldState`、`Ship`、`Action`、`Command`、`Operator`、`Snapshot`、`Observation`、`AgentControllerPort` |
| Why | Agent 领域类型的宿主；`WorldState` 是存档载体 |
| Existing Behavior | v10：`Operator.kind: 'rules'`、`ObservationData.legalActions: string[]` |
| Lv3 Change | ① 新增 Agent 相关类型；② `Operator.kind` → `'rules' \| 'agent'`，新增 `agentId?: string`（`:385`）；③ `WorldState.version` → `11`（`:475`）+ `agents`/`agentMessages`/`agentInteractions`；④ `SnapshotData.version` → `11`（`:531`）；⑤ `ObservationData`（`:643-652`）加宽为 `AgentObservation` 形状并移除 `legalActions`；⑥ `Command` 联合新增 `agentMessage`；⑦ `SimulationEvent` 新增 `AgentTrigger` 变体 |
| Public API Impact | `Operator` 加宽（兼容：既有值 `'rules'` 仍合法）；`Observation` 类型加宽；`Command`/`SimulationEvent` 纯追加 |
| Save Impact | 版本号 + 三个新数组 + 一个可选字段 |
| Test Impact | `architecture.test.ts:12,27` 仍需通过；`recon.test.ts:365` 隐私断言仍需通过 |
| Risk | `SnapshotData.version` 也必须升——`snapshot()`（`projection.ts:72`）直接透传 `w.version`，漏改会让 UI 读到不一致版本 |

### 4.2 `src/engine/save-schema.ts`（extend）

| 字段 | 内容 |
| --- | --- |
| Responsibility（既有） | `worldSchema`：严格的存档契约 + 大规模 `superRefine` 跨实体不变量 |
| Why | 存档校验的唯一权威 |
| Existing Behavior | `version: z.literal(10)`（`:133`）；`operator.kind: z.literal('rules')`（`:158`）；全局 id 唯一性（`:459-460`）；编号序列正则（`:733-740`） |
| Lv3 Change | ① `z.literal(10)` → `11`；② `operator.kind` → `z.enum(['rules','agent'])` + 可选 `agentId`；③ 新增 `agents`（`.max(4)`）、`agentMessages`（`.max(200)`）、`agentInteractions`（`.max(200)`）；④ `superRefine` 把三类新 id 纳入全局唯一性集合，把 `agent` 前缀加入编号序列正则，校验 `agentId` 唯一性与指向有效 |
| Public API Impact | 无（内部 schema） |
| Save Impact | **契约级**：v10 存档不再通过本 schema（改由 `legacyV10Schema`） |
| Test Impact | `architecture.test.ts:103-122` 的「非法存档必须拒绝」需扩展到 Agent 图 |
| Risk | 漏改 ④ 会让非法 Agent 图（重复 id、悬空 `agentId`）静默通过（`C-15`） |

### 4.3 `src/engine/saves.ts`（extend）

| 字段 | 内容 |
| --- | --- |
| Responsibility（既有） | `CURRENT_SAVE_VERSION`、`migrateV9`、`parseSave`、`UnsupportedSaveVersionError` |
| Why | 版本闸门与迁移链的家 |
| Existing Behavior | `CURRENT_SAVE_VERSION = 10`（`:5`）；`migrateV9` 末尾 `return worldSchema.parse(w)`（`:47`）；`parseSave` 只认 9 与 10（`:49-56`） |
| Lv3 Change | ① `CURRENT_SAVE_VERSION` → `11`；② **`migrateV9` 末尾改为 `legacyV10Schema.parse(w)` 后 `return migrateV10(...)`**；③ 新增 `migrateV10`；④ `parseSave` 闸门加 10 → `migrateV10`，未知版本抛错 |
| Public API Impact | 无变化（签名不变） |
| Save Impact | **关键路径** |
| Test Impact | 新增 `tests/agent/migration.test.ts`（v9→v11 链、v10→v11、round-trip、未知版本抛错） |
| Risk | 🔴 **② 是本次最容易漏的一处**：只改闸门不改 `migrateV9`，会让**所有 v9 存档**无法迁移（`C-14`） |

### 4.4 `src/engine/data.ts`（extend）

| 字段 | 内容 |
| --- | --- |
| Responsibility（既有） | `createWorld()`：初始世界、6 艘舰、operator/assignment（`:175-181`） |
| Why | 初始 Agent 的引导点 |
| Existing Behavior | `version: 10`（`:165`）；`operators: ships.map(...)`；`assignments: ships.map(...)` |
| Lv3 Change | ① `version` → `11`；② 新增 `agents: []` 初始为 4 名（Explorer/Scientist/Tactical/Logistics，人格取值见 `02-domain-model.md` §2）；③ 对应 4 个 operator 置 `kind: 'agent'` + `agentId`；④ 其余 2 艘保持 `'rules'`（CONFLICT-6 的对照组） |
| Public API Impact | `createWorld()` 签名不变 |
| Save Impact | 新世界带 4 名 Agent |
| Test Impact | `architecture.test.ts:39-60` 的重放断言必须仍相等；`tests/agent/bootstrap.test.ts` 断言 4 名、1:1 绑定 |
| Risk | **`nextId` 分配顺序**：若 Agent 抢占了既有 id 序列，所有后续 id 平移，可能打破既有断言。**必须在所有既有分配之后**分配 Agent id。若仍冲突，退化为固定 id（`agent-1`…`agent-4`）并记录该决定 |

### 4.5 `src/engine/projection.ts`（extend）

| 字段 | 内容 |
| --- | --- |
| Responsibility（既有） | `snapshot()`（公开读模型）、`opportunities()`、`getObservation()` |
| Why | 唯一的观察出口 |
| Existing Behavior | `getObservation`（`:199-228`）返回窄 `Observation`；`legalActions` 硬编码（`:212-226`） |
| Lv3 Change | ① `getObservation` 返回类型加宽为 `AgentObservation \| null`（见 `03-implementation-plan.md` §4.3）；② 移除 `legalActions` 构造；③ 装配 `self`/`company`/`relationships`/`recentMemory`/`pendingMessages`/`activePromise`/`activeDirective`/`availableActions`/`tick`/`agentId`；④ 无 Agent 的 operator 返回 `null` |
| Public API Impact | 返回类型**加宽**；`AgentControllerPort` 的 key 集合**不变**（`architecture.test.ts:13` 继续通过） |
| Save Impact | 无（投影是派生） |
| Test Impact | `architecture.test.ts:12,27`、`recon.test.ts:365` 必须继续通过；新增 `tests/agent/observation.test.ts` |
| Risk | `snapshot()` **不动**——既有世界级裁剪（隐藏地理、`enemies`、`seed`、`factions`）已被 `recon.test.ts` 与 `architecture.test.ts:85-102` 锁定 |

### 4.6 `src/engine/commands.ts`（extend，追加）

| 字段 | 内容 |
| --- | --- |
| Responsibility（既有） | `actionSchema`、`commandSchema`（25 种命令） |
| Why | 命令的 Zod 契约 |
| Existing Behavior | 无对话类命令 |
| Lv3 Change | **仅在 `commandSchema` 末尾追加** `agentMessage` 分支 |
| Public API Impact | `Command` 联合新增成员（追加式） |
| Save Impact | 无（命令不入存档，但它写入的 `agentMessages` 入存档） |
| Test Impact | 新增 `tests/agent/command.test.ts` |
| Risk | ⚠️ **禁止改动 `careerSchema`（`:79-86`）**——那是 Personnel 的 6 值枚举，与 `AgentCareer` 无关（`C-8`）。Agent 的 career 用独立的 `agentCareerSchema` |

### 4.7 `src/engine/command-system.ts`（extend，追加）

| 字段 | 内容 |
| --- | --- |
| Responsibility（既有） | `validate` / `validateAction` / `dispatchCommand` / `submitAction`——唯一的命令验证链 |
| Why | Agent 社交写入必须经此进入引擎 |
| Existing Behavior | `validate` 的 actor 门（`:159-167`）只放行 commander 或「自己的舰的 `issueDirective`」；`dispatchCommand` 大 if 链 |
| Lv3 Change | ① `validate` 的 actor 门**追加一条最小放宽**：`c.type === 'agentMessage' && c.from === actorId && c.from !== 'admiral'`（见 `03-implementation-plan.md` §4.5）；② `dispatchCommand` 追加 `agentMessage` 处理分支：写 `WorldState.agentMessages`、写 `AgentInteraction`、施加状态增量、写 memory，并**同时**调用 `this.report()` 产生一条既有 `Communication` |
| Public API Impact | 无（签名不变） |
| Save Impact | 新集合的写入者 |
| Test Impact | 新增 `tests/agent/command.test.ts`：玩家 `agentMessage` 通过；Agent 以**他人名义**发言被拒；以自己名义通过；`Communication` 同时产生 |
| Risk | 放宽必须**精确**到「`from === actorId` 且 `from !== 'admiral'`」，否则 Agent 可冒用 Admiral 名义。这是本次唯一的权限门改动，必须配负向测试 |

### 4.8 `electron/persistence.ts`（extend）

| 字段 | 内容 |
| --- | --- |
| Responsibility（既有） | `SaveStore`：原子写、日快照、分支、失败封存、时间线迁移 |
| Why | 磁盘布局与迁移的权威 |
| Existing Behavior | 见 `03-implementation-plan.md` §7.1 |
| Lv3 Change | 见 `03-implementation-plan.md` §7.4 的完整改动集（6 处） |
| Public API Impact | `SaveStore` 方法签名不变；`root`/`indexPath` 取值变化 |
| Save Impact | **目录名变化**：`frontiers-v10` → `frontiers-v11` |
| Test Impact | `tests/v10.test.ts:385` 等（`C-13`）；新增 `tests/agent/migration.test.ts` 覆盖 v10 索引 → v11 的迁移 |
| Risk | 🟠 `:46` 的触发条件若不改，**有 v10 存档的玩家升级后不会触发迁移**。且 `migrateTimeline`（`:64-102`）必须泛化为链式，否则 v10 索引无法迁到 v11 |

### 4.9 `electron/main.ts`（extend，追加）

| 字段 | 内容 |
| --- | --- |
| Responsibility（既有） | 主进程：窗口、7 条 IPC、`setInterval(HOST_FRAME_MS)` 的 `advanceFrame` 循环、自动存档 |
| Why | 唯一的宿主循环；调度器只能在此被泵动 |
| Existing Behavior | 循环内 `advanceFrame` → 自动存档判定 → `send()` → 透传 `shipTransited`（`:165-196`） |
| Lv3 Change | 在 `advanceFrame` 之后追加 `scheduler.pump()`，包 `try/catch`；`paused`/`status !== 'active'` 时跳过 |
| Public API Impact | 无（不新增 IPC 通道，`02-llm-boundary.md` §7） |
| Save Impact | 无 |
| Test Impact | 调度器逻辑须可在 vitest 中以假时钟 + mock provider 直接驱动，**不依赖 Electron** |
| Risk | `main.ts:173-177` 的 `saveBlocked` 只包住 `advanceFrame`；调度器异常若逃逸会污染该状态（`N-9`）。**绝不可**在此 `await` |

### 4.10 `package.json`（extend）

| 字段 | 内容 |
| --- | --- |
| Responsibility（既有） | 脚本、依赖、`build.files` |
| Why | 提示词必须进打包产物 |
| Existing Behavior | `build.files` = `dist/**/*`、`dist-electron/**/*`、`build/icon.png`、`package.json`、`docs/**/*` |
| Lv3 Change | 追加 `prompts/**/*` |
| Public API Impact | 无 |
| Save Impact | 无 |
| Test Impact | `npm run test:package`（`scripts/smoke-package.mjs`）应能验证提示词可达 |
| Risk | 不加则打包后的应用读不到提示词（`C-14`） |

### 4.11 `src/engine/definitions/rules.ts`（extend，追加）

| 字段 | 内容 |
| --- | --- |
| Responsibility（既有） | 深冻结的数值规则 `RULES` |
| Why | 决策节拍需要一个可配置常量 |
| Existing Behavior | 已有 `decisionInterval: 5`（**敌方 AI 用**，`threats.ts:79-80`） |
| Lv3 Change | **追加** `agentDecisionInterval`（提案 15） |
| Public API Impact | `RULES` 新增键（`DeepReadonly` 下追加合法） |
| Save Impact | 无 |
| Test Impact | 无既有测试受影响 |
| Risk | ⚪ **禁止**复用或修改 `decisionInterval`——那会改变敌方 AI 行为并打破 Lv1/Lv2 平衡（`C-18`） |

### 4.12 `src/engine/engine.ts`（extend，追加）

| 字段 | 内容 |
| --- | --- |
| Responsibility（既有） | `SimulationEngine`：`state`、命令接缝、`step()`、`advanceFrame`、`complete()`、`record()`、`controllerPort()` |
| Why | `AgentTrigger` 的发射通道 |
| Existing Behavior | `pendingEvents` 瞬时通道（`:26-27`），`step()` 在 `:147`/`:160` 汇入返回值；`complete()`（`:108-133`）处理指令完成 |
| Lv3 Change | ① `complete()` 末尾追加推送 `directive-completed` / `directive-failed` 触发；② `SimulationEvent` 新增变体（类型在 `types.ts`） |
| Public API Impact | `step()` 返回值联合新增变体（追加式） |
| Save Impact | **无**——触发是瞬时通道，不进 `state`，不影响 `expect(a.state).toEqual(b.state)` |
| Test Impact | `clock.test.ts` 的事件断言、`architecture.test.ts:39-60` 的重放断言必须继续通过 |
| Risk | `step()`/`advanceFrame` 的**控制流不得改动**。只允许在 `complete()` 内追加 1–2 行 push |

### 4.13–4.15 其它「仅允许追加行」的 Lv1/Lv2 文件

| File | Lv3 Change | Risk |
| --- | --- | --- |
| `src/engine/fleet.ts` | 在 `advanceStanding` 末尾置 `idle` 处（`:148-153`）追加一行 `ship-idle` 触发 | **禁止**改动紧急脱离分支（`:81-91`）与 `hasAdmiralWork`（`:50`）——它们是 `C-17` 描述的既有行为 |
| `src/engine/sensors.ts` | 在 `:119` 的 `critical('newContact')` 附近追加 `danger` 触发 | 只追加 |
| `src/engine/world-events.ts` | 在 `createEvent`（`:22`）追加 `world-event` 触发 | 只追加；**禁止**改动 Veil 接管分支（`:354-371`，CONFLICT-7 复用点） |
| `src/engine/execution.ts` | 无（仅通过 `engine.complete()` 间接触发） | **禁止**改动 `advanceShip` 的分发表 |

> 若某处发现**无法只追加**，**停下来记录冲突**，不要顺手重构（CLAUDE.md §3/§15）。

### 4.16–4.20 必须修改的既有测试（`C-12` / `C-13`）

| File:line | Current | Edit | 理由 |
| --- | --- | --- | --- |
| `tests/architecture.test.ts:105` | `[5, 6, 7, 8, 11]` | `[5, 6, 7, 8, 12]` | v11 变为合法；断言原意「未知版本必须拒绝」保持不变。**不要**把 `10` 加进去（`C-12`） |
| `tests/persistence.test.ts:108` | `{ ...w, version: 11 }` | `version: 12` | 同上；该用例断言不支持版本被拒 |
| `tests/mine-accidents.test.ts:186` | `expect(engine.state.version).toBe(10)` | `toBe(11)` | 版本值断言 |
| `tests/v10.test.ts:371` | `expect(loaded.world?.version).toBe(10)` | `toBe(11)` | 迁移后版本 |
| `tests/v10.test.ts:385` | `expect(store.root).toContain('frontiers-v10')` | `'frontiers-v11'` | 磁盘布局 |
| `tests/v10.test.ts:390` | `...version).toBe(10)` | `toBe(11)` | `restorePreviousDay` 后版本 |
| `tests/e2e/desktop.spec.ts:174` | `expect(restored.version).toBe(10)` | `toBe(11)` | E2E 版本断言 |
| `tests/e2e/desktop.spec.ts:239` | `'frontiers-v10'` | `'frontiers-v11'` | E2E 磁盘路径 |
| `scripts/acceptance-v9.mjs:119` | `{ seed, version: 10, ... }` | **先检查**是否参与断言；若仅为报告标签则更新为 11 | OPTIONAL |

> **这 8 处必须与版本升级在同一个提交内完成**，否则会出现一批**静默失败**的测试，实施者会误判为「迁移写错了」。

---

## 5. DO NOT MODIFY

| Path | 理由 |
| --- | --- |
| `src/engine/legacy-v9/**` | 冻结契约（`docs/architecture.md:185`），且 `saves.ts:3` **活依赖**它 |
| `src/engine/v9-schema.ts` | **被活 `save-schema.ts` 与冻结 `legacy-v9/save-schema.ts:8` 共用**；改动会同时污染两条契约 |
| `src/engine/commands.ts` 的 `careerSchema`（`:79-86`） | Personnel 的 6 值枚举，与 `AgentCareer` 无关（`C-8`） |
| `src/engine/engine.ts` 的 `step()` / `advanceFrame` 控制流 | 确定性 + `tests/architecture.test.ts:39-60` |
| `src/engine/fleet.ts` 的 `hasAdmiralWork` / 紧急脱离分支 | Lv1/Lv2 行为；`C-17` 是**计划级兼容**，不是改它 |
| `src/engine/definitions/{factions,resources}.ts` | 死代码（零 import），Lv3 不得在其上构建 |
| `src/engine/definitions/progression.ts`、`ships.ts`、`definitions/freeze.ts` | Lv1/Lv2 平衡与冻结机制 |
| `src/ui/**`（含 `StrategicMap.tsx`、`PersonnelView.tsx`、`lcars/**`） | CLAUDE.md §3 保护区域；Agent 发言经既有 `Communication` 流显示，**零 UI 改动** |
| `electron/preload.ts`、`src/global.d.ts` | 不新增 IPC 通道，不新增 Renderer API |
| `schemas/*.json` | 已批准合同。本阶段唯一「按 schema 落 Zod」的取舍是 `payload` 必填可空（`C-20`），**改 Zod，不改 schema** |
| `tests/e2e/*.spec.ts`（除 §4.20 两处字面量） | E2E 语义不动 |
| `src/engine/legacy-v9/**`、`tests/fixtures/v9/**` | 冻结 fixture |
| `docs/lv3/00-*.md`、`01-*.md`、`02-*.md` | 已批准的历史阶段产物；本阶段冲突只登记在 `KNOWN_ISSUES.md` |

---

## 6. DELETE

**无。** 本计划不删除任何文件。

唯一「移除」是**代码级**的：`ObservationData.legalActions` 字段与其在 `projection.ts:212-226` 的构造。
已复核全仓库仅这两处引用、**无任何消费者**（`C-19`），因此是零成本替换（CONFLICT-4）。

---

## 7. 「扩展而非重写」的明确声明

以下既有 Lv1/Lv2 文件**保持其原有职责与全部既有行为**，Lv3 只在其上追加：

| 文件 | 保有的既有职责 |
| --- | --- |
| `src/engine/engine.ts` | 仍是有唯一权威世界状态的 `SimulationEngine`；`step()` 仍同步、固定步、无 I/O |
| `src/engine/command-system.ts` | 仍是唯一命令验证链（`validate` → `validateAction` → `dispatchCommand`） |
| `src/engine/commands.ts` | 仍是命令的 Zod 契约；`actionSchema` 一行不改 |
| `src/engine/projection.ts` | 仍是唯一读模型出口；`snapshot()` 的裁剪一行不改 |
| `src/engine/save-schema.ts` | 仍是存档契约；所有既有 `superRefine` 不变量保留 |
| `src/engine/saves.ts` | 仍是版本闸门；`migrateV9` 的 v9→v10 语义不变 |
| `electron/persistence.ts` | 仍是唯一存档写入者；原子写/日快照/分支/失败封存逻辑一行不改 |
| `electron/main.ts` | 仍是唯一宿主；7 条 IPC 通道数量不变 |
| `src/engine/data.ts` | 仍是 `createWorld()`；6 艘初始舰队不变，只多 4 名 Agent |
| `src/engine/definitions/rules.ts` | 仍是深冻结数值规则；既有键全部保留 |
