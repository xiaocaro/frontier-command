# Lv3 MVP 需求追溯与场景映射（02-mvp-traceability）

生成日期：2026-10-07
输入：`Agent.md`（产品规格，全部 61 节）；`docs/lv3/01-mvp-scenario.md`（MVP 场景，9 个事件）；反构基线 `docs/lv3/01-lv1-lv2-architecture.md`、`01-runtime-call-graph.md`、`01-state-and-command-map.md`、`01-agent-gap-analysis.md`；事实来源为当前 `src/`、`electron/`、`tests/` 源码。
性质：合同文档。把 `Agent.md` 的需求映射到 `01-mvp-scenario.md`，并登记两者与当前代码的冲突。

> **场景来源说明**：本文的场景侧全部取自 `docs/lv3/01-mvp-scenario.md`；代码基线侧取自上表四份 `01-*` 反构文档（其中 `01-lv1-lv2-architecture.md` 的四类活动机制差异与两条成长线是判定「MVP 是否需要新机制」的依据）。

---

## 1. Requirement Traceability

对 `Agent.md` 的每项核心能力，判定：**MVP 是否需要 / 在哪个事件发生 / 是否延后**。

| # | 能力 | MVP 需要 | 发生在 | 判定依据 |
| --- | --- | --- | --- | --- |
| 1 | **Agent Personality** | ✅ **必须** | 贯穿全部 9 事件 | EVT-01 的 ACCEPT/REJECT/COUNTEROFFER 必须体现个体差异；`Agent.md` §3 明确「同一任务交给不同 Agent 有不同反应」 |
| 2 | **Goals** | ✅ **必须** | EVT-01（Explorer 的探索目标）、EVT-05/06（继续调查）、EVT-09（Goal Progress 影响再决策） | §48 要求 goalProgress 影响后续决策；§50 闭环的一环 |
| 3 | **Fatigue** | ✅ **必须** | EVT-01/02（影响是否接受）、EVT-04（Logistics 的风险评估）、EVT-08（任务后 +10/+15） | §21；且 §59 要求「高疲劳 → 高风险任务更可能拒绝」的可测断言 |
| 4 | **Stress** | ✅ **必须** | EVT-07 Path B（Override → `stress += 10`）、EVT-09（影响再决策） | §42 明文；MVP 的 Override 分支必需 |
| 5 | **Morale** | ✅ **必须** | EVT-07 Path B（`morale -= 5`）、EVT-08 | §42/§19 |
| 6 | **Trust / Loyalty** | ✅ **必须** | EVT-02（Explorer 与 Admiral 的信任影响反报价）、EVT-07（Promise→trust↑ / Override→trust↓）、**EVT-09（核心验证点）** | §20 要求两者分开；§19 是 Promise 机制的落点 |
| 7 | **Relationship** | ✅ **必须** | EVT-03（Tactical 是否接受护航）、EVT-06（Agent 间分歧）、EVT-08（关系变化） | §13/§14；§43 是 MVP 唯一的 Agent-Agent 互动 |
| 8 | **Memory** | ✅ **必须** | EVT-05（「我们在虫洞另一侧发现了未知异常」）、EVT-07（Override/Promise 写入）、**EVT-09（Memory→Decision 闭环）** | §50 明文：不影响未来行为则 Memory 无意义 |
| 9 | **Promise** | ✅ **必须** | EVT-07 Path A、**EVT-09 Path A** | §18/§19；MVP 两条对照路径之一 |
| 10 | **Admiral COMMAND** | ✅ **必须** | EVT-01 | §37 |
| 11 | **ASK** | ⚠️ **建议需要** | EVT-06（玩家「我应该听谁的」时需要询问） | §38。MVP 场景把它列为「Admiral 可以使用」，非强制。**建议保留**——它是「Agent 拒绝后玩家能问为什么」的唯一通道，直接支撑 §9 的核心体验「他为什么拒绝？」 |
| 12 | **NEGOTIATE** | ✅ **必须** | EVT-02（Explorer 反报价，玩家接受/继续协商/拒绝） | §39 |
| 13 | **OVERRIDE** | ✅ **必须** | EVT-07 Path B、EVT-09 Path B | §42；MVP 的对照路径 |
| 14 | **ENCOURAGE** | ⚠️ **建议延后** | 无专属事件 | §41 要求受 `context/relationship/recent events` 影响，**不能无条件加数值**。MVP 无足够事件密度让它有意义的上下文 → **延后**，理由见 §1.1 |
| 15 | **Agent Counteroffer** | ✅ **必须** | EVT-02（推荐主路径 Branch B） | §39 |
| 16 | **Request Teammate** | ✅ **必须** | EVT-03 | §43「第一版只实现一种」——就这一种 |
| 17 | **Agent Decision** | ✅ **必须** | 全部 | §23/§24 |
| 18 | **Observation** | ✅ **必须** | 全部 | §29/§30 |
| 19 | **Available Actions / choiceId** | ✅ **必须** | EVT-01/05/06 的具体动作选择 | §27/§28；**这是防参数幻觉的机制，不可省** |
| 20 | **LLM** | ✅ **必须** | EVT-01/02/06/07 的高冲突决策 | §25/§33 |
| 21 | **Validator** | ✅ **必须** | 全部 | §55 Rule 3；复用既有 `validateAction` |
| 22 | **Scheduler** | ✅ **必须** | 全部 | §34；不每 tick 调用 |
| 23 | **Persistence** | ✅ **必须** | EVT-09（跨天保留 Memory/Promise/Trust） | §50 闭环要求跨时间保持 |
| 24 | **Quit / Leave** | ❌ **延后** | 无 | §47；MVP 9 个事件中无离职。见 §1.2 |
| 25 | **Agent Skills（技能成长）** | ❌ **延后** | 无 | §49 提到技能成长，但 MVP 用 `experience` 即可体现成长 |
| 26 | **Agent Conflict（多方分歧）** | ✅ **必须（简化版）** | EVT-06 | §44 明文「不需要复杂 AI，只需让不同价值观产生冲突」 |
| 27 | **SalaryGap / CompetitorOffer** | ❌ **延后** | 无 | §47 的离职因素；MVP 无经济与竞争公司 |
| 28 | **复杂长期记忆检索 / Vector DB / LangGraph** | ❌ **延后** | 无 | §52 明令 |

### 1.1 为什么 ENCOURAGE 建议延后

`Agent.md` §41 有一条容易忽略的约束：

> 可以影响 morale / trust，**但不能无条件提高数值**。应该有 `context` / `relationship` / `recent events` 影响。

这意味着 ENCOURAGE 只有在**有足够上下文**时才有意义——玩家夸一句「我相信你」不该无条件加 trust。MVP 的 9 个事件里没有为它设计的场合；若强行加入，要么违反「不能无条件提高」，要么需要额外上下文系统。

**这不等于不做**——`Agent.md` §60 的 DoD 列了六类互动（含 ENCOURAGE）。**判定：MVP 垂直切片可延后，Lv3 完整交付前补齐**。这个区分很重要：本文件评的是「MVP 场景是否需要」，不是「Lv3 是否需要」。

### 1.2 为什么 Quit 延后

§47 要求综合 `BrokenPromises / LowGoalProgress / LowTrust / HighStress / SalaryGap / CompetitorOffer / CareerValue` 触发离职谈判。其中 `SalaryGap` 与 `CompetitorOffer` 依赖 MVP 范围外的经济与竞争公司系统（§52 明令排除）。

**判定：延后到 MVP 之后**。但 `loyaltyToCompany` 与 `stress` **仍需在 MVP 持久化并更新**——它们是 Quit 的输入，提前积累是正确的。

---

## 2. MVP 场景逐步追踪

`01-mvp-scenario.md` §4 的 9 个事件，映射到系统：

```text
Scenario Step
  → Event
  → Observation
  → Agent Decision
  → Validation
  → Command / Action
  → SimulationEngine
  → State Change
  → Memory / Goal / Relationship Update
```

| 事件 | 触发 | Observation 关键字段 | Decision | 动作 | 引擎侧 | 状态更新 |
| --- | --- | --- | --- | --- | --- | --- |
| **EVT-01** 发布虫洞任务 | `admiral-message` | `self.goal`（discovery）、`self.state.fatigue`、`self.state.trustInAdmiral`、`availableActions` | `intent:'respond'` + `choiceId:'counteroffer'` | 无物理动作 | 记录 task | 无 |
| **EVT-02** Explorer 反报价 | Agent 决策输出 | 同上 + `activePromise`（null） | `intent:'request'` + `request:{type:'teammate'}` | 生成 `AgentMessage` | 无 | 写 episodic memory |
| **EVT-03** Tactical 收请求 | `agent-request` | `self.goal`（command）、`relationships[Explorer].value`、`self.state.fatigue`、`self.assignedDirective` | `intent:'respond'` + `choiceId:'accept-team'` | **`ESCORT`**（既有 `types.ts:233`） | `validateAction` → `dispatchCommand` | 双方 `relationship.value ↑` |
| **EVT-04** Logistics 风险评估 | `admiral-message` / 节拍 | `ship.hull/shield/core`、弹药、`contacts` | `intent:'respond'` + `say:"READY"/"WARNING"` | 无物理动作（仅发言） | 无 | 无（除非构成 `AgentInteraction`） |
| **EVT-05** 穿越并发现异常 | `world-event`（wormhole）/ `directive-completed` | `bodies`（新发现）、`opportunities` | `intent:'act'` + `choiceId:'survey:<bodyId>'` | **`TRANSIT` → `SURVEY`**（既有） | 既有物理与结算 | **episodic memory「发现未知异常」**、`goalProgress ↑` |
| **EVT-06** 目标冲突 | 新异常数据（`world-event`） | 各自的 `goal.kind`、`state` | 四个 Agent 各出意见（`wait`/`respond`） | 各生成 `AgentMessage` | 无 | 无 |
| **EVT-07** Promise 或 Override | `admiral-message`（新互动类型） | `self.state.trustInAdmiral`、`activePromise` | Path A: `intent:'respond'`；Path B: 记录不愿但必须执行 | Promise: 新增 `AgentPromise`；Override: 强制 `issueDirective` | Path B 走**既有** `dispatchCommand`（Rule 7：Override 不绕过验证） | Path A 无（pending）；**Path B: `trust-10` / `morale-5` / `stress+10`** + memory |
| **EVT-08** 完成任务返航 | `directive-completed` | — | — | **`RETURN`** | 引擎结算任务结果 | `goalProgress`、`experience`、`fatigue+15`、`morale`、`relationship`、`trust`、memory |
| **EVT-09** 过去影响未来 | `admiral-message`（新任务） | **`recentMemory`**、`self.state.trustInAdmiral`、`activePromise` | Path A → 更可能 `accept`；Path B → 可能 `reject`/`counteroffer`/`request` | 依决策 | — | 闭环完成 |

**关键**：全部 9 个事件的物理动作（ESCORT / TRANSIT / SURVEY / RETURN）**都是既有 `Action`**——`Agent.md` ADR-3 的判断得到验证：Lv3 不新增物理行为。

---

## 3. 玩家选择如何改变后续 Agent 行为

这是 MVP 的核心验证点（`01-mvp-scenario.md` §9）。三条可追踪链路：

### 链路 A — Promise 兑现 → Trust 上升 → 更愿接受

```text
EVT-07 Path A: Admiral 承诺 Deep Scan 权限
   → 新增 AgentPromise{status:'pending', fulfills:{kind:'grant-module',key:'deepScan'}}
        ↓
EVT-08 任务完成，Admiral 实际执行 REFIT(deepScan)（既有命令）
   → 引擎侧判定 fulfills 匹配 → status = 'fulfilled'
        ↓
   trustInAdmiral ↑  loyaltyToCompany ↑  morale ↑  goalProgress ↑   （§19）
   + episodic memory{tags:['promise-kept'], weight:高}
        ↓
EVT-09 新高风险任务
   → DecisionScore 的 CEOTrust ↑、PromiseValue ↑、RecentMemoryScore ↑
   → score 越过 70 → ACCEPT
```

### 链路 B — Override → Trust 下降 → 未来更保守

```text
EVT-07 Path B: Admiral 强制 Explorer 继续
   → AgentInteraction{kind:'override', outcome:'forced', effects:{trust:-10, morale:-5, stress:+10}}
   + episodic memory{tags:['admiral-override'], weight:高}
        ↓
EVT-08 任务完成（但心理状态已受损）
        ↓
EVT-09 新高风险任务
   → CEOTrust ↓、RecentMemoryScore 为负
   → score 落入 25-44 或 <25 → COUNTEROFFER / REJECT
```

### 链路 C — Team-up 成功 → Relationship 上升 → 未来更易组队

```text
EVT-03 Tactical 接受护航
   → AgentInteraction{kind:'team-request', outcome:'accepted'}
   → 双方 relationship.value ↑
        ↓
EVT-08 共同完成任务 → 再次 ↑
        ↓
后续任务 → TeamFit ↑ → 更可能 REQUEST TEAMMATE；Tactical 侧更可能 ACCEPT
```

**三条链路的共同结构**（`Agent.md` §50）：`Player Action → Event → Memory → Trust/Relationship/Goal → Future Decision`。

> **这三条链路就是 Prompt 7 垂直切片的验收对象。** 若只有链路 A 能跑通，Lv3 的核心价值仍未成立——§50 要求的是「不同玩家行为 → 不同未来行为」，至少需要 A 与 B 两条**对照**路径同时可复现。

---

## 4. 冲突登记

按任务要求「不要静默解决」，逐条记录 `Requirement / Current Code / Conflict / Proposed Resolution`。

### CONFLICT-1 — 燃料系统不存在 🔴 **最高优先级**

| 项 | 内容 |
| --- | --- |
| **Requirement** | `Agent.md` §2.1 把 `fuel` 列为 Ship 属性；§25 要求 LLM 不修改 fuel；§26 把 `Fuel` 列为 Engine 职责。`01-mvp-scenario.md` EVT-04 让 Logistics「监控舰队燃料、船体状态和返航余量」并提出 READY/WARNING；EVT-05 列出「Fuel 消耗」 |
| **Current Code** | **完全没有燃料机制。** `Ship`（`types.ts:261-291`）无 fuel 字段；全仓库 grep `fuel\|燃料\|返航余量` 在 `src/`、`electron/`、`tests/` **零命中** |
| **Conflict** | MVP 中 Logistics 这个 Agent 的**整个存在理由**（EVT-04）建立在燃料之上 |
| **Proposed Resolution** | **不新增燃料机制**。把「Fuel / Return Margin」重新表达为**既有物理资源的复合战备度**：<br>• **弹药**（`photon`/`quantum`，`types.ts:282-283`）——**物理消耗、须回基地补装**，与燃料语义最接近<br>• **船体**（`hull`）——损伤累积<br>• **Core**（`core`）——**注意：Core 会再生**（`combat.ts:15`），是**节奏**约束而非**预算**约束，不宜单独承担「返航余量」<br>EVT-04 的 READY/WARNING 改为基于「弹药余量 + 船体完整度 + 路径预估」的确定性评估。**理由**：新增燃料会引入一个 Lv1/Lv2 从未有过、且需要重新平衡的经济系统，违反 CLAUDE.md §3「不要重写 Lv1/Lv2」与 `Agent.md` §52 |

### CONFLICT-2 — 「Agent 是 WorldState 的一部分」的边界含义

| 项 | 内容 |
| --- | --- |
| **Requirement** | `Agent.md` §4 开篇「Agent 是 WorldState 的一部分」，并给出存入 `WorldState` 的 `AgentState` 接口 |
| **Current Code** | `WorldState`（`types.ts:474-522`）是引擎物理权威状态；CLAUDE.md §2.2 要求「Agent 不得直接拥有或改变物理世界状态」 |
| **Conflict** | 表面矛盾：Agent 数据若进 `WorldState`，是否等于 Agent 成为世界状态？ |
| **Proposed Resolution** | **区分「存档位置」与「物理权威」**。`WorldState` 在代码中**同时是存档载体**（`SaveStore.write(engine.state)`，`persistence.ts:178`）。Agent 数据进存档是**必需的**（否则无法持久化），但这与「Agent 能改物理状态」无关——后者由 Rule 1 与「LLM 层不持有 `SimulationEngine` 引用」保证。<br>**结论：`Agent.md` §4 与 CLAUDE.md §2.2 不冲突**，前提是文档措辞明确区分两者。已在 `02-domain-model.md` §1 注明。 |

### CONFLICT-3 — `Agent.md` §53 的目录名与现状不符

| 项 | 内容 |
| --- | --- |
| **Requirement** | §53 推荐 `src/engine/world-state.ts`、`src/engine/simulation-engine.ts` |
| **Current Code** | 引擎在 `src/engine/engine.ts`；`WorldState` 在 `src/engine/types.ts`。**不存在** `world-state.ts` / `simulation-engine.ts` |
| **Conflict** | 按 §53 命名会**重命名既有文件**，属 CLAUDE.md §3 禁止的无谓重构 |
| **Proposed Resolution** | **保留既有文件名**，只新增 `src/engine/agent/`。优先既有契约（CLAUDE.md §4）。已在 `02-architecture.md` §2 落实 |

### CONFLICT-4 — `legalActions` 不可靠

| 项 | 内容 |
| --- | --- |
| **Requirement** | §27「不要继续依赖简单 `legalActions: string[]`」，改用 `availableActions: AgentActionCandidate[]` |
| **Current Code** | `projection.ts:212-226` 是硬编码数组：漏 12 个可执行动作（`ATTACK`/`SHADOW`/`ESCORT`/`RECOVER`/`REARM`…），又无条件列出 3 个受 `validateAction` 约束的动作（`TRANSIT`/`CAPTURE`/`HAIL`） |
| **Conflict** | **无冲突——`Agent.md` 的判定与代码实际一致**（Prompt 1 独立发现同一问题）。这是需求与现状的**对齐** |
| **Proposed Resolution** | 用 `availableActions` 替换。**成本为零**：`legalActions` 全仓库仅类型声明（`types.ts:651`）与构造处（`projection.ts:212`）两处引用，**UI 与测试都不消费它**，替换不破坏任何现有代码 |

### CONFLICT-5 — Admiral 互动的通道

| 项 | 内容 |
| --- | --- |
| **Requirement** | §36 六类互动（COMMAND/ASK/NEGOTIATE/PROMISE/ENCOURAGE/OVERRIDE）；§57 的 `say` 字段；MVP EVT-02/06/07 需要双向对话 |
| **Current Code** | `commandSchema`（`commands.ts:117-243`）现有 25 种命令，**无任何对话类命令**；`Communication`（`types.ts:411-419`）是单向世界事件流 |
| **Conflict** | MVP 的协商分支在现有命令集里无法表达 |
| **Proposed Resolution** | **新增命令类型**（追加式，不修改既有）：`agentMessage`（Admiral→Agent 的 ask/negotiate/promise/encourage/override）。经既有 `dispatchCommand` → `validate` 路径；adimral 身份由 `main.ts:131` 的默认 `'commander'` actor 天然满足。<br>Agent→Admiral 的发言**同时**写一条既有 `Communication`，使既有 UI 通信流**零改动**即可显示 Agent 的话（见 `02-domain-model.md` §12） |

### CONFLICT-6 — MVP 需要 4 个 Agent，初始舰队有 6 艘

| 项 | 内容 |
| --- | --- |
| **Requirement** | MVP 需要 4 个 Agent（Explorer/Tactical/Scientist/Logistics），各操作一艘舰 |
| **Current Code** | `INITIAL_FLEET`（`definitions/ships.ts:248-255`）有 **6 艘**：meridian(antares)、vigil(peregrine)、verity(constitution)、horizon(galaxy)、meridian-2、meridian-3 |
| **Conflict** | **无冲突**——6 艘足以承载 4 个 Agent，余 2 艘保持 `kind:'rules'` 的普通 operator |
| **Proposed Resolution** | 4 个 Agent 绑定 4 艘；建议按能力匹配（Explorer→`vigil`(peregrine，已有 SHADOW 传统)、Tactical→`verity`(constitution)、Scientist→`horizon`(galaxy)、Logistics→`meridian`(antares)）。余舰维持现状，**这也正好形成对照组**：同一舰队里既有 Agent 舰也有规则舰 |

### CONFLICT-7 — MVP 的「失联探测船」与既有 Veil

| 项 | 内容 |
| --- | --- |
| **Requirement** | EVT-05/08：虫洞另一侧有失联探测船 |
| **Current Code** | **已存在**：`FRONTIER 0/0` 的 Dawn Passage 通往 `0/12`，出口有唯一无人侦察舰 USS VEIL（幽影号），经 `SURVEY` + `ASSIST_EVENT` 接管（`README.md:65`，`world-generation.ts:VEIL_SITE`） |
| **Conflict** | **无冲突——极佳的对齐** |
| **Proposed Resolution** | MVP 的「Lost Survey Vessel」**直接复用 Veil 链路**，不新增。`recoveredVeil` 标志与唯一性保障（`types.ts:499`）已存在 |

---

## 5. 冲突对 MVP 范围的影响

| 冲突 | 影响 | 处置 |
| --- | --- | --- |
| CONFLICT-1（燃料） | **改变 EVT-04 的实现方式**，不改变故事 | 用「弹药+船体+路径预估」复合战备度替代 |
| CONFLICT-5（互动通道） | **新增命令类型**（追加式） | 属必要新增，不违反保护 Lv1/Lv2 |
| 其余 | 无范围影响 | 记录在案 |

**净结论**：MVP 场景**不需要新增任何物理玩法机制**。它的全部物理动作（ESCORT / TRANSIT / SURVEY / RETURN）都是既有 `Action`，唯一的实质缺口是燃料——而燃料**不应新增**，应重新表达。
