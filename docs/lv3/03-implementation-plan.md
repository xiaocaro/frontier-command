# Lv3 实施计划（03-implementation-plan）

生成日期：2026-10-08
阶段：Prompt 3（Implementation Plan + Codex Handoff）
性质：**实施计划**。本阶段**不写业务代码**，只把 Prompt 2 已批准的架构转换成文件级、接口级、任务级、验收级的施工图。

**输入（逐一点名）**：

| 类别 | 文件 |
| --- | --- |
| 产品规格 | `Agent.md`（§1–§61） |
| 需求原文 | `题目要求.md`（Lv3 四项要求） |
| MVP 场景 | `docs/lv3/01-mvp-scenario.md`（4 天 / 9 事件 / 3 分支） |
| 批准的架构与合同 | `docs/lv3/02-architecture.md`、`02-domain-model.md`、`02-decision-flow.md`、`02-llm-boundary.md`、`02-persistence-strategy.md`、`02-mvp-traceability.md` |
| 机器可读合同 | `schemas/agent*.schema.json`（7 个） |
| 项目规则 | `CLAUDE.md`、`AGENTS.md` |
| 事实来源 | 当前 `src/`、`electron/`、`tests/` 源码与本阶段实际执行的 `npm test` |

> **冲突登记见 `KNOWN_ISSUES.md`。** 本文只写「怎么做」，不重开设计。凡与 `02-*.md` 不同处，
> 均标注对应 `C-nn` 条目。

**基线（本阶段实测）**：`npm test` = 13 files / 184 tests **PASS**；工作区干净于 `a089d95`。

---

## 1. 本阶段范围

只做 **Analysis / Plan / Documentation / Task decomposition**。产出 7 份文档：

```text
docs/lv3/
├── 03-implementation-plan.md   ← 本文
├── 03-file-change-plan.md      ← 文件级改动计划（CREATE/MODIFY/DELETE/DO NOT MODIFY）
├── 03-api-contract.md          ← 模块间调用合同与「谁有权改状态」
├── 03-test-plan.md             ← 测试矩阵
├── CODEX_TASKS.md              ← 34 张任务卡（18 字段格式）
├── CLAUDE_TO_CODEX.md          ← 交接说明
└── KNOWN_ISSUES.md             ← 冲突登记
```

**本阶段不修改任何 `src/`、`electron/`、`tests/`、`schemas/`、配置文件。**

---

## 2. 最终目录（取自 `02-architecture.md` §2，不重新选择）

Prompt 2 已决定模块边界。Prompt 3 **禁止**因个人偏好改变目录。

```text
electron/agent/                    ← 网络与编排；仅主进程；禁止被 src/ 引用
  runtime.ts                       异步决策编排
  scheduler.ts                     触发、去抖、单飞、优先级
  model-client.ts                  ModelClient / DecisionRequest / ModelResult / ModelError
  mock-client.ts                   fixture 驱动的确定性 provider（长期存在）
  openai-compatible.ts             DeepSeek / OpenAI 兼容实现
  prompt.ts                        提示词装配（版本化）

src/engine/agent/                  ← 纯领域；零网络、零 I/O；可被 vitest 直接单测
  types.ts                         全部 Agent 领域类型
  schemas.ts                       Zod 运行时合同（与 schemas/*.json 对应）
  personality.ts                   5 维人格 + 四名初始 Agent 取值
  goals.ts                         AgentGoal / GoalKind / GoalAlignment / goalProgress 增减
  state.ts                         fatigue/stress/morale/trust/loyalty/experience/reputation
  memory.ts                        三类记忆、有界、确定性检索与淘汰
  relationship.ts                  AgentRelationship 读取与更新
  promise.ts                       AgentPromise 创建/结算/fulfills 匹配
  score.ts                         确定性 DecisionScore（纯函数）
  actions.ts                       AgentActionCandidate[] 推导与 choiceId 生成
  observation.ts                   AgentObservation 装配（裁剪）
  decision.ts                      AgentDecision 校验 + 确定性 fallback
  interactions.ts                  Admiral 6 类互动 + Agent-Agent + AgentMessage 辅助

prompts/agent/
  system.md  decision.md  conversation.md  reflection.md    各自带 prompt_version

tests/agent/                       领域 / 决策 / LLM / 集成 测试
tests/fixtures/agent/              mock 决策与场景 fixture
```

**为什么 `src/engine/agent/` 多出 `types.ts` 与 `schemas.ts`**（`02-architecture.md` §2 未列）：11 个领域模块互相引用类型，若把类型散在各文件会造成循环 import；且 CLAUDE.md §6 要求「运行时校验仍由既有 TypeScript/Zod 层实现」。把「类型 + Zod」收敛到两个文件是**新文件的最小必要理由**，不引入新的抽象层。

**为什么 `electron/agent/` 多出 `mock-client.ts`**：`02-llm-boundary.md` §3 要求 **mock provider 必须长期存在**（全部 `Agent.md` §59 测试要在无网络下可跑）。把它与 `openai-compatible.ts` 分开，才保持「领域层只依赖 `ModelClient` 接口」的 provider 无关性。

**不新增构建配置**：`tsconfig.json` 已 include `src` + `electron` + `tests`（类型检查与 vitest 覆盖）；`tsconfig.electron.json` 已 include `electron/**` + `src/engine/**`（两个新目录都进 Electron 产物）。`02-architecture.md` §2.2 的核对成立。

**新增打包配置（1 处）**：`package.json` 的 `build.files` 目前为 `dist/**/*`、`dist-electron/**/*`、`build/icon.png`、`package.json`、`docs/**/*`，**不含 `prompts/**/*`**。必须追加，否则打包后的应用读不到提示词（`C-14`）。

---

## 3. 分阶段（P0 → P3）

四阶段的划分与用户任务书一致；每阶段**独立可测**，各有 rollback point。

### 3.1 P0 — Domain Foundation（不依赖真实 LLM）

**目标**：不调用任何模型，Agent 的领域逻辑与持久化主干可运行、可单测。

**范围**：

```text
Agent 领域实体（Agent / Personality / State / Goal / Memory / Relationship / Promise）
AgentObservation（含 availableActions）
AgentDecision（含校验与确定性 fallback）
确定性 DecisionScore
确定性状态更新规则
WorldState v11 + 存档迁移
4 名初始 Agent 的引导与绑定
领域测试与 fixtures
```

**退出判据**：`npm test` 全绿，且新增领域测试覆盖 `Agent.md` §59 要求的可离线断言项（Fatigue / Goal / Memory / Relationship / Promise / Override）。**此时不调用模型，Agent 的基本领域逻辑已可运行。**

### 3.2 P1 — Mock LLM

**目标**：不依赖 DeepSeek API，Agent Decision Loop 端到端可测、可确定性重放。

**范围**：`ModelClient` 抽象、mock provider、结构化决策解析与 Zod 校验、提示词装配与版本化、
`Scheduler`（单飞/去抖/优先级/上限）、`Runtime` 编排、宿主循环接线、`AgentTrigger` 发射、
确定性重放测试。

**退出判据**：同一 Observation + 同一 fixture ⇒ 同一 `AgentDecision`；完整决策环在离线条件下跑通；
`tests/architecture.test.ts:39-60` 的重放断言仍通过。

### 3.3 P2 — Live DeepSeek Runtime

**目标**：让 DeepSeek 真正驱动 Agent 的高层意图表达，且**只能产生结构化 decision / proposal**。

**范围**：`openai-compatible.ts`（内建 `fetch` + `AbortController` 超时）、环境变量配置、
日志脱敏、错误分类（`ModelError` 六类）、有限重试 + 退避、熔断降级、无 key 时进确定性模式。

**退出判据**：六类错误各有 stub `fetch` 测试；无 key 时不影响游戏；key 不出现在仓库、Renderer、日志。

### 3.4 P3 — Integration / MVP Vertical Slice

**目标**：跑通 `01-mvp-scenario.md` 的 9 个事件与 3 条分支。

**范围**：EVT-01 → EVT-09 的接线、`agentMessage` 互动命令、Promise / Override 两条对照路径、
任务结算后的状态与记忆更新、以及**「过去经历影响下一次决策」的闭环证明**。

**退出判据**：`02-mvp-traceability.md` §3 的链路 A（Promise → Trust↑ → 更愿接受）与链路 B
（Override → Trust↓ → 未来更保守）**同时可复现**；至少 1 次 Agent-Agent 互动改变另一名 Agent 的状态。

---

## 4. 本阶段必须定稿的决策

Prompt 2 把若干项显式留给 Prompt 3（`02-domain-model.md` §8/§10/§12、`02-architecture.md` §8）。以下为定稿。

### 4.1 Agent ↔ Operator 的关联（对应 `C-22` / `C-23`）

**决定**：在 `Operator` 上新增可选字段 `agentId?: string`。

```ts
// src/engine/types.ts:382-387
export interface Operator {
  id: string;
  name: string;
  kind: 'rules' | 'agent';   // ← 由 'rules' 扩为联合
  agentId?: string;          // ← 新增；指向 Agent.id
  availability: 'available' | 'vesselLost';
}
```

**理由**（**不是** `02-domain-model.md` §8 给出的理由）：
`Agent.id` 按已批准的 `schemas/agent.schema.json` 形如 `'agent-<n>'`，**与 `operatorId` 不同名**，
因此**任何命名约定都无法把 operator 映射到 agent**——`'ops-' + shipId` 只能给出 ship ↔ operator。
若取「约定」方案，仍需第二张映射表；显式字段则不需要，且能被 `save-schema` 的唯一性校验覆盖。

**顺带更正**：`02-domain-model.md` §8 称该命名约定「会在 `buildShip` 产生新舰时断裂」——**不成立**。
`services.ts:157`（造船）与 `world-events.ts:362`（接管 USS VEIL）都遵循 `'ops-' + shipId`。
因此**不得**为此改动 `services.ts` / `world-events.ts`（见 `C-23`）。

**唯一性约束**：`agentId` 若存在，必须全局唯一且指向真实 `Agent`；`save-schema` 的 `superRefine` 需加此校验（`C-15` 同批）。

### 4.2 choiceId 解析位置（对应 `C-11`）

**决定**：**不扩展 `AgentControllerPort`。** choiceId 在 Agent 层解析：

```ts
const candidate = observation.availableActions.find((c) => c.id === decision.choiceId);
if (!candidate) return { ok: false, reason: 'invalid-choice-id' };   // Rule 3
port.submitAction(candidate.action);                                  // 引擎二次校验
```

**理由**：`engine.ts:91-96` 返回 `Object.freeze`，`tests/architecture.test.ts:13` 断言 port 恰好两个 key；
新增第三个 method 会**立即打破既有 Lv1/Lv2 边界测试**。而每个 `AgentActionCandidate.action` 已是完整
构造好的既有 `Action`（`schemas/agent-action-candidate.schema.json` 的 `required` 含 `action`），
引擎侧**完全不需要知道 choiceId 存在**——这比 `02-decision-flow.md` §6 的时序图**更严格**地满足
`Agent.md` Rule 2/3。

> `02-decision-flow.md` §6 中 `controllerPort.resolve(choiceId)` 那一行是图示不精确。以本节为准；已登记为 `C-11`。

### 4.3 AgentObservation 的通路（对应 `C-10`）

**决定**：**加宽唯一那条观察通路**，不新增第二条。

```ts
// types.ts:643-652  —— ObservationData 扩充（示意）
interface ObservationData {
  time: number;
  tick: number;                 // 新增：stale 检测依据
  operatorId: string;
  agentId: string;              // 新增
  ship: Ship;
  self: { name; career; personality; state; goal };     // 新增
  company: { credits; tension; priorities };            // 新增
  contacts: IntelRecord[];
  systems: StarSystem[];
  bodies: Body[];
  opportunities: Opportunity[];
  relationships: AgentRelationship[];                   // 新增
  recentMemory: AgentMemory[];                          // 新增（有界，按 weight 排序）
  pendingMessages: AgentMessage[];                      // 新增
  activePromise: AgentPromise | null;                   // 新增
  activeDirective: { actionType: string; source: 'admiral' | 'standing'; note: string } | null;  // 新增
  availableActions: AgentActionCandidate[];             // 新增，取代 legalActions
  // legalActions 已移除
}
```

`getObservation(operatorId): AgentObservation | null`——**operator 无 Agent 时返回 `null`**
（余下 2 艘 `kind:'rules'` 的舰船即属此情形；生产代码无消费方）。

**已复核不破坏**：消费方仅 `architecture.test.ts:12`（读 `.ship.id`）、`:27`（读 `null`）、
`recon.test.ts:365`（对 `JSON.stringify` 做隐私断言）。三者均不受加宽影响。

**明确不采用**：新增 `engine.getAgentObservation(agentId)` 的第二条观察通路。CLAUDE.md §4 禁止平行抽象，
且 ADR-4 要求 `Snapshot`（整个世界）与 Observation（单个 Agent 应知）分离——但**不要求有两条 Agent 通路**。

**新增风险（必须测试）**：memory 的 `text` 是新的泄漏向量。`recon.test.ts:365` 的隐私断言必须继续通过，
因此写记忆时不得嵌入未发现实体的名称（详见 `03-test-plan.md` Regression 段）。

### 4.4 `AgentMessage.payload` 的可选性（对应 `C-20`）

**决定**：以**已提交的 JSON Schema 为准**——`payload` **必填但可为 `null`**：

```ts
payload: MessagePayload.nullable();
```

**理由**：CLAUDE.md §6 规定 JSON Schema 是跨工具合同；`schemas/agent-message.schema.json` 的 `required`
含 `payload`。`02-domain-model.md` §12 的 `payload?:` 与之不一致，本阶段按 schema 落 Zod，并**不修改 schema**。

### 4.5 `agentMessage` 命令（对应 CONFLICT-5）

**决定**：新增**追加式**命令类型 `agentMessage`，作为 Agent 社交写入的**唯一**入口。

```ts
// Command 联合新增
| { type: 'agentMessage';
    from: 'admiral' | string;      // 'admiral' 或 agentId
    to: string | 'admiral';
    kind: 'command' | 'ask' | 'negotiate' | 'promise' | 'encourage' | 'override' | 'team-request' | 'team-reply' | 'report';
    text: string;
    payload: MessagePayload | null; }
```

**权限门**：`validate`（`command-system.ts:149-167`）现有规则仅允许非 commander actor 下发
`issueDirective` 到自己那艘舰。需**追加一条最小放宽**：

```ts
|| (c.type === 'agentMessage' && c.from === actorId && c.from !== 'admiral')
```

即 Agent **只能以自己名义**发言。渲染进程路径不带 actorId，默认 `'commander'`，因此玩家一方的
`agentMessage` 天然以 `'admiral'` 通过。

**为什么必须是命令而不是引擎方法**：CLAUDE.md §2.1 要求「所有世界修改通过结构化、可验证的 Command
进入引擎」。若让 runtime 直接写 `WorldState.agentMessages`，就出现了绕过验证的第二条通路，也违反 Rule 6。

**对外可见性**：Agent 的发言（`say` 字段与 `agentMessage` 的 `text`）**同时**产生一条既有
`Communication`（`engine.report()`），使既有 UI 通信流**零改动**即可显示（`N-6`）。

### 4.6 Override 的实现路径（对应 CONFLICT-7 同批 / `C-11` 相邻）

**决定**：玩家的一次 Override 操作**发出两条**命令：

```text
① 既有 issueDirective（REPLACE，commander actor）
     → Directive.source = 'admiral'，受 admiral 优先级保护
② agentMessage{ kind: 'override', payload: { directiveActionType } }
     → 施加 trust −10 / morale −5 / stress +10
     → 写入 tags: ['admiral-override'] 的 episodic memory
     → 记录 AgentInteraction{ outcome: 'forced', effects: {...} }
```

**理由**：这解释了 `schemas/agent-message.schema.json` 的 override payload **只携带
`directiveActionType`** 的原因——强制**执行**靠既有指令，**意愿代价**靠消息。同时满足
`Agent.md` §55 Rule 7（Override ≠ 绕过验证：指令仍走完整 `validateAction`）与 §42（代价明确）。

### 4.7 非 `act` 意图的路由

**决定**（设计未明说，必须补上）：

```text
intent === 'act'                                    → 解析 choiceId → Action → port.submitAction
intent ∈ { wait, request, invite, respond, rest, quit }
                                                    → 走互动/消息层，绝不调用 submitAction
```

`respond` / `request` / `invite` 只产生 `AgentMessage` + `AgentInteraction`（若构成互动）与状态增量，
**不产生物理动作**。这与 `02-mvp-traceability.md` §2 一致：EVT-01/02/04/06 的「动作」列都是「无物理动作／
仅发言」。

### 4.8 确定性 fallback 与调度上限（照 `02-decision-flow.md` §3.5）

```text
score >= 70   → ACCEPT
45 - 69       → 需要 LLM；LLM 不可用则安全默认 = wait
25 - 44       → REQUEST / COUNTER
< 25          → REJECT
```

调度上限：同一 `agentId` 同一时刻**至多一个** pending 决策；冷却 `agentDecisionInterval`（提案 15 游戏分钟，
**新键**，不得复用 `RULES.decisionInterval`——见 `C-18`）；每游戏分钟最多 1 次模型调用，超出降级为确定性。

---

## 5. choiceId 定稿（对应 `C-21`）

`02-domain-model.md` §10 声明该表是「提案，Prompt 3 细化」，故本节为**授权范围内的定稿**。

| 候选来源 | id 形态 | 解析出的 Action |
| --- | --- | --- |
| 探索星区 | `explore:<q>/<r>` | `EXPLORE { sector, approach }` |
| 调查天体 | `survey:<bodyId>` | `SURVEY { targetId, approach, deep }` |
| 运输 | `haul:<src>><dst>:<good>` | `HAUL { … }` |
| 护航某舰 | `escort:<shipId>` | `ESCORT { targetId }` |
| 巡逻 | `patrol:<targetId>` | `PATROL { targetId, duration }` |
| 回收残骸 | `recover:<wreckId>` | `RECOVER { targetId }` |
| 返航 | `return` | `RETURN` |
| 入坞 | `dock:<targetId>` | `DOCK { targetId }` |
| 改装模块 | `refit:<moduleId>` | `REFIT { targetId, moduleId, remove: false }` |
| 装弹 | `rearm:<photon>/<quantum>` | `REARM { targetId, load }` |
| 回应 Admiral 任务 | `accept` / `reject` / `counteroffer` | 无（社交决策） |
| 回应组队请求 | `team-accept:<agentId>` / `team-decline:<agentId>` | 无（社交决策），接受后另发 `ESCORT` |

**两条硬性要求**：

1. **确定性且跨 tick 稳定**：同一世界状态下两次生成必须产生**相同且同序**的候选集合（迭代顺序固定/排序），
   否则 LLM 上一拍给出的 choiceId 会变得有歧义。
2. **生成时必须保证合法性**：候选在生成阶段就要通过 `validateAction` 的前置检查
   （例如 `TRANSIT` 要求虫洞已 `discovered`，`command-system.ts:64-65`，见 `N-8`），
   避免 Agent 挑到一个必被拒绝的动作。`requirements` 字段仅供提示词参考，**不作为合法性判据**。

---

## 6. 决策分与状态更新（照 `02-decision-flow.md` §4/§5）

### 6.1 DecisionScore（纯函数，`score.ts`）

```text
DecisionScore =
    0.20 SkillFit
  + 0.20 GoalAlignment
  + 0.15 RewardAttractiveness
  + 0.10 CEOTrust
  + 0.10 TeamFit
  + 0.10 CareerValue
  + 0.05 PromiseValue
  + 0.15 RecentMemoryScore      ← 提案追加（02-decision-flow.md §4）
  - 0.10 RiskDiscomfort
  - 0.10 FatiguePenalty
```

**LLM 不计算此分数**（`Agent.md` §46 明文）。权重的绝对值为初始提案，P3 用实际决策结果校准；
本阶段只固定**结构与输入来源**。

### 6.2 状态更新（结算后，确定性）

| 事件 | 更新 |
| --- | --- |
| 任务成功 | `goalProgress += Δ`、`experience += Δ`、`fatigue += 10` |
| 高风险任务成功 | `fatigue += 15` |
| 任务失败 | `morale -= Δ`、`stress += Δ`、`fatigue += 15` |
| 休息 | `fatigue -= 20` |
| Promise fulfilled | `trust ↑`、`loyalty ↑`、`morale ↑`、`goalProgress ↑` |
| Promise broken | `trust ↓`、`loyalty ↓`、`stress ↑` |
| Override | `trust -= 10`、`morale -= 5`、`stress += 10` |
| Team-up 成功 | 双方 `relationship.value ↑`、`cooperation ↑` |

Fatigue 分档（`Agent.md` §21）：`0-39` 正常 / `40-69` 疲劳 / `70-84` 严重疲劳 / `85-100` 强制休息。
所有数值更新后钳制到 `[0, 100]`。每次更新写入 `AgentInteraction.effects`，作为测试断言对象。

### 6.3 集合上限（有界性）

| 集合 | 上限 | 淘汰规则 |
| --- | --- | --- |
| `agent.memories` | 40 | `weight` 升序淘汰 |
| `agent.promises` | 20 | 保留 `pending` + 最近 N 条已解决 |
| `agent.relationships` | 每 Agent ≤ 其余 Agent 数 | 规模固定为 4，不需上限 |
| `agentMessages`（全局） | 200 | 最旧优先，`read` 优先淘汰 |
| `agentInteractions`（全局） | 200 | 同上 |

**淘汰必须确定性**（按 weight/时间排序，不随插入顺序漂移），否则 `tests/architecture.test.ts:39-60`
的重放断言会不稳定（`N-5`）。

---

## 7. Persistence Plan

### 7.1 Current Save Schema（事实）

| 约束 | 位置 |
| --- | --- |
| `CURRENT_SAVE_VERSION = 10` | `src/engine/saves.ts:5` |
| `version: z.literal(10)` | `src/engine/save-schema.ts:133` |
| `WorldState.version: 10` | `src/engine/types.ts:475` |
| `SnapshotData.version: 10` | `src/engine/types.ts:531` |
| `createWorld` 的 `version: 10` | `src/engine/data.ts:165` |
| `version === 9` → `migrateV9`；`!== 10` → 抛 `UnsupportedSaveVersionError` | `saves.ts:49-56` |
| `migrateV9` 末尾用**活** `worldSchema` 校验 | `saves.ts:47` |
| `indexSchema` 硬编码 `z.literal(10)` | `electron/persistence.ts:25` |
| 根目录 / 索引名硬编码 | `electron/persistence.ts:44-45` |
| 迁移触发条件（仅 v9） | `electron/persistence.ts:46` |
| `migrateTimeline` 只处理 v9→v10 | `electron/persistence.ts:64-102` |
| 写索引 / `create()` 的字面量 10 | `electron/persistence.ts:101,167` |
| 原子写、日快照、分支、失败封存 | `persistence.ts:28-31`、`daily`、`create`、`failure.json` |
| 存档上限 32MB | `electron/persistence.ts:34` |
| `legacy-v9/` 冻结 | `docs/architecture.md:185` |

> ⚠️ `02-persistence-strategy.md` §5 称根目录/索引「由版本常量驱动，改一处即可」——**与代码不符**，
> 全仓库无版本常量。真实改动集见 7.4（`C-15`）。

### 7.2 Lv3 additional fields

```ts
interface WorldState {
  version: 11;                            // ← 10 升为 11
  // …既有字段全部不变…
  agents: Agent[];                        // ← 新增（有界 4）
  agentMessages: AgentMessage[];          // ← 新增（有界 200）
  agentInteractions: AgentInteraction[];  // ← 新增（有界 200）
}
```

**既有字段的唯一改动**：

```ts
// types.ts:385 / save-schema.ts:158
kind: 'rules' | 'agent';        // 由字面量 'rules' 扩为联合
agentId?: string;               // 新增可选（见 4.1）
```

**此外不改动任何既有字段。** 既有 operator 恒为 `'rules'`、无 `agentId`，行为与存档语义完全不变。

### 7.3 Migration

```text
v9 ──migrateV9──▶ v10 ──migrateV10──▶ v11
```

```ts
export function migrateV9(input: unknown): WorldState {
  const old = legacyV9Schema.parse(input);
  const w = { …v10 形状… };              // 既有逻辑不变，version: 10
  return migrateV10(legacyV10Schema.parse(w));   // ← 关键改动（C-14）
}

export function migrateV10(input: unknown): WorldState {
  const old = legacyV10Schema.parse(input);
  return worldSchema.parse({
    ...old,
    version: 11,
    agents: [],
    agentMessages: [],
    agentInteractions: [],
  });
}

// parseSave 闸门（saves.ts:49-56）
if (version === 9)  return migrateV9(input);
if (version === 10) return migrateV10(input);
if (version !== 11) throw new UnsupportedSaveVersionError(...);
```

> 🔴 **`migrateV9` 必须改**（`C-14`）。若只改 `parseSave` 闸门，`migrateV9` 末尾会用已成 v11 的
> `worldSchema` 校验一个没有 `agents` 的对象，**所有 v9 存档立刻无法迁移**。

**冻结副本**：新增 `src/engine/legacy-v10/save-schema.ts`，与 `legacy-v9/` 并列。
`worldSchema` 是 `ZodEffects`（`.strict().superRefine`，`save-schema.ts:131,420-741`），**无法 `.omit()` 派生**，
因此必须整份复制（`C-24`）。复制须在**修改活 schema 之前**完成（任务 P0-01）。
冻结副本须保留 `kind: z.literal('rules')` 且**不含** `agentId`。

### 7.4 Backward compatibility（磁盘）

```text
frontiers-v10/  →  frontiers-v11/          ← 新的世界根
timeline-v10.json → timeline-v11.json      ← 新的索引
```

**真实改动集**（比 `02-persistence-strategy.md` §5 描述的多）：

| 位置 | 改动 |
| --- | --- |
| `persistence.ts:25` | `indexSchema` 的 `z.literal(10)` → `11` |
| `persistence.ts:44` | `'frontiers-v10'` → `'frontiers-v11'` |
| `persistence.ts:45` | `'timeline-v10.json'` → `'timeline-v11.json'` |
| `persistence.ts:46` | 触发条件改为「无 v11 索引 **且**（存在 `timeline-v10.json` **或** `timeline-v9.json`）」——**不改则 v10 玩家升级后不触发迁移** |
| `persistence.ts:64-102` | `migrateTimeline` 泛化为**链式**：有 v10 索引则按 v10 索引读、源根 `frontiers-v10`；只有 v9 索引则先跑既有 v9→v10 步再跑 v10→v11。每个分支文件都过 `loadWorld` → `parseSave`，staged 校验得以保留 |
| `persistence.ts:101,167` | 写索引 / `create()` 的字面量 10 → 11 |

**兼容保证**：

- v9 原文件**从不改写**（既有 `migrateTimeline` 已如此），新根 `frontiers-v11` 与旧根并存。
- v10 存档迁移后 `agents: []`，operator 仍为 `'rules'`，其余字段逐字段不变（由 `tests/agent/migration.test.ts` 断言）。
- `blocked` / `failure.json` / `.bak` / `.corrupt-` / `restorePreviousDay` / `beginNew` 逻辑**一行不改**。
- `restorePreviousDay` 会**回滚 Agent 的 trust / memory**——这是既有机制的自然结果，**MVP 接受**
  （`02-persistence-strategy.md` §6 已记录，避免被误判为 bug）。
- `superRefine` 需把 `agents` / `agentMessages` / `agentInteractions` 的 id 纳入全局唯一性集合，
  并把 `agent` 前缀加入编号序列正则（`save-schema.ts:459-460,733-740`，见 `C-15`）。

### 7.5 是否引入版本常量（SHOULD，非 MUST）

推荐把 `persistence.ts` 的两处路径改为从既有的 `CURRENT_SAVE_VERSION`（`saves.ts:5`）派生：

```ts
const root = join(directory, `frontiers-v${CURRENT_SAVE_VERSION}`);
const indexPath = join(directory, `timeline-v${CURRENT_SAVE_VERSION}.json`);
```

好处：消除未来再次漂移（本次漂移即源于硬编码）。代价：`persistence.ts` 增加一个 import。
**最小改动方案 = 直接更新字面量**；两者都满足要求，由实施者按「改动面最小」原则择一，并记录选择。

---

## 8. Scheduler / Tick Boundary

### 8.1 硬约束

```text
SimulationEngine.step()  同步、固定步、无 I/O（engine.ts:134-161）
advanceFrame             每帧跑 state.speed 次 step（1/4/16，engine.ts:162-171）
宿主循环                 electron/main.ts:165-196 的 setInterval(HOST_FRAME_MS)
```

**禁止**：

```text
Simulation Tick → 同步网络 LLM 调用          ❌ CLAUDE.md §2.4 明令
AgentTrigger / pending 决策 / ModelClient 放进 WorldState   ❌ 破坏重放断言
```

**必须**：

```text
游戏事件 / 决策触发 → Agent Scheduler → Observation → LLM → Decision
                    → Validation → Command → SimulationEngine
```

### 8.2 承载通道（对应 `C-16`）

`AgentTrigger` **作为 `SimulationEvent` 联合的新增变体**，复用既有的**非持久化瞬时通道**
`SimulationEngine.pendingEvents`（`engine.ts:26-27`，由 `step()` 在 `:147`/`:160` 汇入返回值）。

**为什么**：

- `SimulationEvent`（`types.ts:448-453`）是本地判别联合，新增变体是**纯追加**。
- 先例已存在：`combat.ts:126` 从 `step()` 深处推送 `shipDestroyed`。
- 瞬时通道**不进 `state`**，因此 `tests/architecture.test.ts:39-60` 的
  `expect(a.state).toEqual(b.state)` 重放断言不受影响。
- `main.ts:193` 只过滤 `shipTransited`，新增变体不会被误当 UI 事件。

**发出点**（各加 1–2 行 push，属**追加式**改动）：

| 触发 | 发出点 | 修正后的行号（见 `C-9`） |
| --- | --- | --- |
| `directive-completed` / `directive-failed` | `engine.complete()` | `engine.ts:108-133` |
| `ship-idle` | `advanceStanding` 末尾置 idle | `fleet.ts:148-153` |
| `world-event` | `createEvent` | `world-events.ts:22` |
| `danger` | 新接触产生 | `sensors.ts:119`（**非** `02-decision-flow.md` §3.2 写的 `:56`） |
| `admiral-message` | 新增的 `agentMessage` 命令处理分支 | `command-system.ts` |
| `promise-changed` | Promise 状态变更处 | `src/engine/agent/promise.ts` |

> `fleet.ts` / `sensors.ts` / `world-events.ts` / `engine.ts` 的改动**只允许是追加行**，
> 不得改动既有控制流。若某处发现无法只追加，**停下来记录冲突**，不要顺手重构（CLAUDE.md §3）。

### 8.3 调度器位置与不阻塞

```ts
// electron/main.ts:165-196（示意，非最终代码）
timer = setInterval(() => {
  …engine.advanceFrame((events, state) => { …既有 dayBoundary/commandLost… })…
  try {
    scheduler.pump();          // 同步：排空已完成的决策 + 到期则发起新请求
  } catch (error) {
    // provider 异常绝不允许把世界标记为 saveBlocked（N-9）
    engine.log('Agent 调度异常：' + String(error), 'warning');
  }
  …既有 autosave / send()…
}, HOST_FRAME_MS);
```

- `pump()` **同步**：先排空已 resolve 的决策并提交，再对「`state.time >= agent.nextDecisionAt`
  或存在高优先级触发」且舰船**空闲**且无 in-flight 请求的 Agent 发起 `provider.decide(...)`，
  把 `{ promise, observation, observationTick }` 存入 `Map<agentId, Pending>`。
- promise 的 `.then` **只改调度器自己的队列**，**绝不触碰 `WorldState`**，因此 interval 立即返回，
  网络延迟永不阻塞 `step()`。
- 守卫：`engine.state.paused || engine.state.status !== 'active'` 时跳过。
- `advanceFrame` 每帧跑 `speed` 次 step（`N-1`）：到期判定按**帧**做，不放进 step 循环内。

### 8.4 去抖、单飞、上限

| 机制 | 规则 |
| --- | --- |
| 单飞 | 同一 `agentId` 同一时刻至多一个 pending 决策 |
| 冷却 | 决策结束后 `agent.nextDecisionAt = state.time + RULES.agentDecisionInterval` |
| 合并 | 冷却期内到达的多个触发合并为一个待处理标记 |
| 上限 | 每游戏分钟最多 1 次模型调用，超出降级为确定性 |

**为什么需要单飞**：EVT-03 的组队会产生「A 请求 B → 立即触发 B 决策 → B 回复又触发 A」的循环。
单飞 + 冷却切断它。

### 8.5 失败与降级

| 失败 | 处置 | fallback |
| --- | --- | --- |
| `timeout` / `invalid-json` / `schema-mismatch` / `invalid-choice-id` / `http-error` / `unavailable` | 丢弃 | ✅ 确定性 fallback |
| **Observation 过期** | 丢弃 | ❌ **不 fallback** |
| **指令被引擎侧清除**（`C-17`） | 合成 `directive-failed` | — |

**「过期不 fallback」的理由**：`observationTick` 落后过多意味着世界已显著变化。用确定性规则基于**新**世界
做决策是合理的；但若 fallback 用的是基于**旧** Observation 算出的分数，就是错的。正确做法是丢弃并在下一拍重新评估。

**退避**：有限重试（最多 2 次）+ 指数退避，之后降级为确定性模式一段时间（提案 30 游戏分钟）。
**不无限重试**——`Agent.md` §58 只要求「不能导致游戏崩溃」。

### 8.6 确定性的诚实边界

| 模式 | 可重放 | 用途 |
| --- | --- | --- |
| Engine 重放（同 seed 同命令） | ✅ **是** | 既有能力，`tests/architecture.test.ts:39-60`，必须保持 |
| `mock` provider + 录制决策 | ✅ **是** | 回归测试 |
| Live LLM | ❌ **否** | 人工演示，**不参与回归断言** |

**不得声称**「同样输入 LLM 必得同样输出」。回归测试**只使用 mock provider**（`02-llm-boundary.md` §8）。

---

## 9. 实施顺序与 Rollback Point

```text
P0  ──▶  P0 tests  ──▶  P1  ──▶  P1 tests  ──▶  P2  ──▶  P2 tests  ──▶  P3  ──▶  Vertical Slice
 │            │          │           │           │           │          │
 R1           R2         R3          R4          R5          R6         R7
```

| Rollback point | 位置 | 回退动作 |
| --- | --- | --- |
| **R1** | P0-01…P0-04 完成（存档主干） | 最高风险点。`git revert` 该批提交即可，`legacy-v10/` 为纯新增文件 |
| R2 | P0 全部 + 领域测试 | revert P0-05…P0-16 |
| R3 | P1 mock runtime | 删除 `electron/agent/**` 与 `prompts/**`；`src/` 不受影响 |
| R4 | P1 测试 | revert P1-05 |
| R5 | P2 provider | 删除 `openai-compatible.ts`；无 key 时本就退化为确定性 |
| R6 | P2 测试 | revert P2-04 |
| R7 | P3 垂直切片 | 每个 EVT 一张卡，逐卡可回退 |

**每个阶段结束都必须**：`git status` → `git diff --check` → `npm test`（CLAUDE.md §10/§11）。

---

## 10. POST-MVP Backlog（**不得**塞进当前实施计划）

依用户 §14 规则：凡**既不在 MVP 场景**、**又不被批准架构作为 P0–P3 必需依赖**的 `Agent.md` 能力，
一律标记 POST-MVP。

| 项 | 依据 |
| --- | --- |
| ENCOURAGE 互动 | `02-mvp-traceability.md` §1.1：需 `context/relationship/recent events`，MVP 事件密度不足。**但 Lv3 完整交付前须补齐**（`Agent.md` §60 的 DoD 含六类互动） |
| Quit / Leave 系统 | `Agent.md` §47；依赖 SalaryGap / CompetitorOffer，属 MVP 范围外的经济与竞争公司系统 |
| SalaryGap / CompetitorOffer | 同上 |
| Agent Skills（技能成长） | `Agent.md` §49；MVP 用 `experience` 表达成长 |
| `GoalCondition[]` 条件求值器 | `Agent.md` §52 排除复杂系统；MVP 用 `GoalKind` 枚举替代 |
| 复杂长期记忆检索 / Vector DB / LangGraph / Multi-Agent Framework | `Agent.md` §52 明令排除 |
| 复杂 Agent 社会网络 / 无限 NPC / 复杂职业树 / Agent Economy / 招聘系统 / 复杂情绪模拟 / 自然语言自动生成任务 | `01-mvp-scenario.md` §7 |
| Agent 与既有 `Personnel` 岗位绑定 | 不在 MVP 9 事件内（见 `C-9`） |
| Renderer 侧的 Agent 管理界面 | MVP 用既有 `Communication` 流显示 Agent 发言即可（`N-6`）；UI 属 CLAUDE.md §3 的保护区域 |
| 为 Agent 指令引入 `source: 'agent'` | 批准设计**未要求**。现状 `'standing'` 可用；改动会触及 `Directive` 类型、存档与 UI。若 P3 发现 `'standing'` 造成实际障碍，**另行提出设计决策**，不在本计划内 |

---

## 11. 本阶段的验收判据

1. 7 份文档生成完毕，且 `03-*` 之间、与 `schemas/*.json`、`docs/lv3/02-*.md`、`Agent.md`、
   `01-mvp-scenario.md` **无未登记的矛盾**。
2. `KNOWN_ISSUES.md` 覆盖 `CONFLICT-1…7` 与 `C-8…C-25`，每条都有 Current Code / Impact / Resolution。
3. `03-file-change-plan.md` 给出 CREATE / MODIFY / DELETE / DO NOT MODIFY 完整清单，
   并明确「哪些既有 Lv1/Lv2 文件是**扩展**而非重写」。
4. `03-api-contract.md` 覆盖 8 个接口与 4 条状态变更权限。
5. `03-test-plan.md` 覆盖 Domain / Decision / LLM / Integration / Regression / Persistence / Scheduler，
   每条映射到 EVT 与 Task ID。
6. `CODEX_TASKS.md` 的每张卡在**冷上下文**下可独立执行（只读项目文件 + 该卡）。
7. `npm test` 仍为 13 files / 184 tests PASS；`git diff --check` 无输出。
8. 本阶段**零业务代码改动**。
