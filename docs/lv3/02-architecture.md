# Lv3 Agent 架构（02-architecture）

生成日期：2026-10-07
性质：**架构与合同**。本阶段不写业务代码。

**输入（逐一点名，便于核对）**：

| 类别 | 文件 |
| --- | --- |
| 产品规格 | `Agent.md` |
| MVP 场景 | `docs/lv3/01-mvp-scenario.md` |
| 代码基线 | `docs/lv3/00-baseline.md`、`00-code-map.md`、`00-test-baseline.md`、`00-baseline-audit.md` |
| 反构基线 | `docs/lv3/01-lv1-lv2-architecture.md`、`01-runtime-call-graph.md`、`01-state-and-command-map.md`、`01-agent-gap-analysis.md` |
| 项目规则 | `AGENTS.md`、`CLAUDE.md` |
| 事实来源 | 当前 `src/`、`electron/`、`tests/` 源码与测试 |

> 冲突登记见 `02-mvp-traceability.md` §4。本文只做架构决策。

---

## 1. 架构总原则

```text
LLM 决定「我想做什么」。
Engine 决定「这件事实际能不能发生，以及发生后结果是什么」。
```

三条不可协商的边界（对应 `Agent.md` §55 的 8 条规则）：

| 边界 | 规则 | 落地约束 |
| --- | --- | --- |
| Agent ≠ WorldState | Rule 1 | Agent 领域层不持有 `WorldState` 引用；只能经 `ControllerPort` |
| LLM ≠ GameAction | Rule 2 / 3 | LLM 只输出 `choiceId`，不输出 Action 参数 |
| Agent ≠ 他人 Ship | Rule 4 | `controllerPort(operatorId)` 只暴露本舰（`engine.ts:91-96`），既有 `validate` 权限门（`command-system.ts:159-167`）已强制 |
| 单一 Observation | Rule 5 | `getObservation` 的投影裁剪（`projection.ts:199-228`） |
| Engine 是权威 | Rule 6 | 不得新建绕过 `validate` 的通路——`applyFrontierCommand` 只有 `command-system.ts:349` 一个调用点，这是可审计的 |
| Override ≠ 绕过验证 | Rule 7 | Override 改变的是 **Agent 意愿**，不是引擎规则 |
| 行为可追踪 | Rule 8 | 每个重要 Agent 行为写 `history`（复用 `engine.record()`） |

---

## 2. 分层

```text
┌─ Electron 主进程 ────────────────────────────────────────────┐
│  electron/agent/           ← 网络与编排（不进 Renderer）      │
│    runtime.ts              异步决策编排                       │
│    scheduler.ts            决策触发与去抖                     │
│    model-client.ts         ModelClient 接口                   │
│    openai-compatible.ts    provider 实现                      │
│    prompt.ts               提示词装配（版本化）               │
├──────────────────────────────────────────────────────────────┤
│  src/engine/agent/         ← 纯领域（无 I/O，可单测）         │
│    personality.ts  goals.ts  memory.ts  relationship.ts       │
│    promise.ts  state.ts  observation.ts  actions.ts           │
│    decision.ts  score.ts   ← 确定性决策分                     │
│    interactions.ts         ← Admiral 互动与 Agent-Agent       │
├──────────────────────────────────────────────────────────────┤
│  src/engine/               ← 既有引擎（尽量少改）             │
│    engine.ts  types.ts  command-system.ts  projection.ts      │
│    save-schema.ts  saves.ts  inventory.ts  fleet.ts ...       │
└──────────────────────────────────────────────────────────────┘
```

### 2.1 为什么这样切分

`Agent.md` §31/§53 把 runtime 放在 `electron/agent/`。这样做是对的——**LLM 属主必须留在主进程**（`main.ts:73-75` 的 `contextIsolation` + `sandbox` + 无 Node 权限，Renderer 拿不到密钥）。

但 `Agent.md` §53 没有区分「领域逻辑」与「网络逻辑」。本设计**拆开**：

- `src/engine/agent/` 只做纯计算（人格加权、目标评分、记忆写入、关系变更）。**零网络、零 Promise、可被 vitest 直接单测**（`vitest.config.ts:2` 的 `tests/**` 可 import `src/`）。
- `electron/agent/` 做异步编排与网络。**不被 `src/` 引用**。

好处：`Agent.md` §59 要求的测试（Fatigue / Goal / Memory / Relationship / Override / Promise）**全部可以在无网络、无 Electron 的条件下跑**，符合「deterministic fixture provider 做 regression」的要求。

### 2.2 构建边界核对

`tsconfig.electron.json`（`:10`）include `electron/**` + `src/engine/**` → 两个目录都进 Electron 产物。
`tsconfig.json`（`:15`）include `src` + `electron` + `tests` → 类型检查覆盖全部，vitest 可测纯领域层。

**没有新增构建配置**——两个目录天然落在既有 include 范围内。

---

## 3. 模块职责

| 模块 | 职责 | 不负责 |
| --- | --- | --- |
| `electron/agent/scheduler.ts` | 判定「何时该决策」，去抖、优先级、防重复 | 不做决策本身，不知道 Agent 语义 |
| `electron/agent/runtime.ts` | 编排：取 Observation → 建 Prompt → 调 provider → 解析 → 校验 → 提交 | 不写 WorldState |
| `electron/agent/model-client.ts` | `decide(observation): Promise<AgentDecision>` 抽象 | 不含 provider 细节 |
| `electron/agent/prompt.ts` | 从 Observation + 领域数据装配提示词，带 `promptVersion` | 不拼字符串散落在各处 |
| `src/engine/agent/score.ts` | 确定性 DecisionScore（`Agent.md` §46 公式） | **LLM 不计算此分数** |
| `src/engine/agent/actions.ts` | 由世界状态推导 `AgentActionCandidate[]` | 不做权限判定（那是 `validateAction`） |
| `src/engine/agent/observation.ts` | 装配 `AgentObservation`（裁剪后的信息） | 不暴露 `WorldState` |
| `src/engine/agent/memory.ts` | 记忆写入与检索（**有界**） | 不存完整对话历史 |
| `src/engine/agent/state.ts` | 派生量：Fatigue/Stress/Morale/Trust/Loyalty 的更新规则 | 不直接改世界物理状态 |

---

## 4. 决策管线（完整）

```text
① Decision Trigger                 scheduler.ts
   事件驱动（Agent.md §34），非每 tick
        ↓
② AgentObservation                  observation.ts（裁剪）
        ↓
③ Deterministic DecisionScore       score.ts（Agent.md §46）
        ↓  score 决定是否需要 LLM（§35 优先级）
④ Prompt                            prompt.ts（带 promptVersion）
        ↓
⑤ ModelClient.decide()              model-client.ts（async，可超时）
        ↓
⑥ AgentDecision（结构化 JSON）        Zod 校验
        ↓
⑦ choiceId → GameAction             actions.ts 解析（**引擎侧解析，非 LLM 生成**）
        ↓
⑧ ControllerPort.submitAction()      engine.ts:91-96（既有接缝）
        ↓
⑨ validateAction() → dispatchCommand command-system.ts:34 / :340（**既有验证链**）
        ↓
⑩ SimulationEngine.step()            引擎执行（同步、固定步）
        ↓
⑪ Game Result → Agent 状态更新        state.ts / memory.ts / relationship.ts（结算后）
```

**关键设计：`choiceId` 而非 Action 参数。**

`Agent.md` §28 的要求——LLM 输出 `{"intent":"act","choiceId":"explore-sector-2"}` 而不是完整 Action——同时消除了四类风险：参数幻觉、非法目标、操作他人舰船、越权。因为 `choiceId` 由**引擎侧**从 `availableActions` 生成，LLM 只能从既有选项里挑。

这正是本设计用 `availableActions` **替换** `legalActions` 的原因：现状的 `legalActions` 是硬编码字符串数组（`projection.ts:212-226`），漏 12 个可执行动作、又列出 3 个受约束动作——**它无法支撑 choiceId 解析**，因为解析需要每个候选携带可执行的 `GameAction`。

> ✅ **零成本替换**：`legalActions` 全仓库**只有类型声明 `types.ts:651` 与构造处 `projection.ts:212` 两处引用，没有任何消费者**（UI 也不读）。因此替换不破坏任何现有代码。

---

## 5. 状态归属

| 数据 | 归属 | 持久化 | 理由 |
| --- | --- | --- | --- |
| Personality（5 维） | Agent | ✅ | 相对稳定，是决策输入（`Agent.md` §6） |
| Goal / goalProgress | Agent | ✅ | 影响后续决策（§48） |
| Fatigue / Stress / Morale | Agent | ✅ | 可变状态（§6） |
| Trust / Loyalty | Agent | ✅ | §20 明确两者必须分开 |
| Relationship | Agent | ✅ | §13 |
| Memory（Episodic/Social/Promise） | Agent | ✅ 但有界 | §15–§18；§52 禁止复杂长期检索 |
| Promise | Agent | ✅ | §18；MVP 的核心验证点 |
| `currentAssignment` | Agent → 映射到既有 `Assignment` | ✅ | 复用 `types.ts:388-392` |
| `nextDecisionAt` | Agent | ✅ | 类比既有 `Enemy.nextDecision`（`types.ts:298`） |
| Ship 物理状态 | **Ship（不变）** | ✅ | 引擎权威 |
| `availableActions` | **派生，不持久化** | ❌ | 每 tick 从世界状态推导，类比既有 `opportunities`（`projection.ts:10`） |
| DecisionScore | **派生，不持久化** | ❌ | 纯函数 |

**持久化策略详见 `02-persistence-strategy.md`。**

---

## 6. 与既有接缝的对接

**全部复用，不新建并行通路**（CLAUDE.md §4）：

| 需要 | 复用 | 位置 |
| --- | --- | --- |
| Agent↔Ship 绑定 | `Operator` / `Assignment`（1:1，有唯一性校验） | `types.ts:382-392`，`save-schema.ts:521-532` |
| 观察入口 | `controllerPort(operatorId)` | `engine.ts:91-96` |
| 动作提交 | `submitAction(operatorId, action)` | `command-system.ts:550-563` |
| 规则验证 | `validateAction` → `validate` → `dispatchCommand` | `command-system.ts:34` / `:149` / `:340` |
| 历史追踪 | `engine.record()` | `engine.ts:62-71` |
| 结算触发 | 任务完成/失败的既有分支 | `engine.complete()` `engine.ts:108-133` |

**Operator↔Agent 关系（Prompt 1 方案 B 的落实）**：

```text
Agent（新增，拥有意志）  ──1:1──▶  Operator（既有，是绑定记录）  ──1:1──▶  Ship（既有，物理）
```

`Operator.kind` 从字面量 `'rules'` 扩为 `'rules' | 'agent'`（`types.ts:385`，`save-schema.ts:158`）。既有 operator 保持 `'rules'`，行为完全不变。

---

## 7. 关键架构决策记录（ADR）

### ADR-1：为什么 Agent 不直接成为 Ship
`Agent.md` §2.1 已定；代码侧的证据是 `Ship`（`types.ts:261-291`）没有也不应有 `personality`/`goal`/`memory`。Ship 携带的是 `standing: StandingOrders`——**策略**，不是**主体**。混入会让 `save-schema` 的物理校验（容量、槽位）与人格数据纠缠。

### ADR-2：为什么 LLM 不进入 `step()`
`step()` 同步、固定步、16× 下每秒 160 次（`engine.ts:134-171`；`clock.ts:6-7`）。网络延迟是秒级。且 `tests/architecture.test.ts:39-60` 断言同 seed 重放一致——网络结果不可重放。CLAUDE.md §2.4 明令禁止。

### ADR-3：为什么 Agent action 复用既有 Action
`Action` 联合（`types.ts:210-240`）已有 21 种，`advanceShip` 已有完整分发表（`execution.ts`，见 `00-code-map.md` §3）。**Lv3 不新增物理行为**——它的价值在于「选择」已有行为，而非发明新行为。若确需新行为（如 MVP 的团队协作），应优先用既有 `ESCORT`（`types.ts:233`）表达。

### ADR-4：为什么 public Snapshot 与 Agent Observation 分开
`Snapshot`（`types.ts:664`）是整个已知世界的只读视图，供 UI；`Observation`（`types.ts:665`）是**单个 Agent 应该知道的信息**。二者混同会违反 Rule 5——一个 Agent 会看到其他 Agent 的私有状态与公司全部数据。`Agent.md` §29 的 `AgentObservation` 比现有 `Observation` 宽（含 self/company/relationships/memory），但**仍须裁剪**：不给他人 memory、不给隐藏敌情。

### ADR-5：为什么 Agent memory 不等于完整聊天记录
`Agent.md` §52 禁止「复杂长期记忆检索」。记忆必须是**有界、结构化、可持久化**的条目（Episodic/Social/Promise 三类），而非无界对话日志。否则存档会无限膨胀（当前存档上限 32MB，`persistence.ts:34`），且引入不可控的检索行为。

---

## 8. 本阶段不决定的事

留给 Prompt 3 / 4：

- 具体的 `AgentActionCandidate` 生成规则（哪些世界状态产生哪些候选）
- 提示词正文（`prompts/agent/*.md`）
- provider 配置与环境变量
- 测试用例的具体写法

**本阶段只建立架构与合同。**
