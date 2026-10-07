# Lv3 持久化策略（02-persistence-strategy）

生成日期：2026-10-07
输入：`Agent.md`（§4/§18/§50/§52）；`docs/lv3/01-mvp-scenario.md`（EVT-09 跨天闭环）；反构基线 `docs/lv3/01-state-and-command-map.md`、`00-baseline.md` §11；事实来源为 `src/engine/save-schema.ts`、`src/engine/saves.ts`、`electron/persistence.ts`。
性质：合同文档。定义 Agent 状态如何进入既有存档体系。

> **本文不新建第二套持久化系统。** 全部复用 `SaveStore`（`electron/persistence.ts:37`）与 `parseSave`（`src/engine/saves.ts:49`）。
> 领域结构见 `02-domain-model.md`；冲突登记见 `02-mvp-traceability.md` §4。

---

## 1. 现行机制（必须遵守的既有约束）

| 约束 | 位置 |
| --- | --- |
| `CURRENT_SAVE_VERSION = 10` | `src/engine/saves.ts:5` |
| `version === 9` → `migrateV9`；`!== 10` → 抛 `UnsupportedSaveVersionError` | `src/engine/saves.ts:49-56` |
| `version: z.literal(10)` | `src/engine/save-schema.ts:133` |
| 原子写（`.tmp` + `renameSync`） | `electron/persistence.ts:28-31` |
| 读取优先级 `failure.json` → `head.json` → `head.json.bak` | `persistence.ts:106-149` |
| 迁移先校验到 staging 再发布，**v9 原文件从不改写** | `persistence.ts:64-102` |
| `blocked` 状态下 `write()` 抛错 | `persistence.ts:179` |
| 存档上限 32MB | `persistence.ts:34` |
| `legacy-v9/` 冻结，**禁止修改** | `docs/architecture.md:185` |

**唯一合规的扩展方式**：**升到 v11 + 写迁移**，沿用 `migrateV9` 与 `migrateTimeline` 已建立的 staged 模式。绝不就地改 v10 的语义。

---

## 2. 逐项持久化决策（对应任务要求六）

| 项 | 持久化 | 理由 |
| --- | --- | --- |
| **`Agent` 身份**（id/name/career） | ✅ | 稳定标识，与稳定 ID 原则一致（`architecture.md:18`） |
| **`AgentPersonality`** | ✅ | `Agent.md` §6 定义为「相对稳定」——若每局重生成，同一 Agent 的行为会漂移 |
| **`AgentState`**（fatigue/stress/morale/trust/loyalty/experience/reputation/goalProgress） | ✅ | §6 定义为「随游戏变化」；不持久化则 §50 的闭环跨存档断裂 |
| **`AgentGoal` + `goalProgress`** | ✅ | §48 明确 goalProgress 影响后续决策；关系未来行为 → 必须持久化 |
| **`AgentMemory`** | ✅ **有界** | 见 §3 |
| **`AgentRelationship`** | ✅ | §13/§14：影响 team-up 倾向；§50 闭环的一部分 |
| **`AgentPromise`** | ✅ | §18/§19：Promise 是 MVP 的核心验证点，跨天存在（EVT-07 → EVT-09） |
| **`Assignment`**（当前绑定） | ✅ **已存在** | 复用既有 `w.assignments`（`types.ts:388-392`），无需新增 |
| **`nextDecisionAt`** | ✅ | 决策节拍。类比既有 `Enemy.nextDecision`（`types.ts:298`）**是持久化的**——不持久化会导致读档后所有 Agent 同时触发决策 |
| **`AgentDecision`（最后一次）** | ❌ | 派生物；其结果已体现在 state/memory 中 |
| **`availableActions`** | ❌ | 每 tick 由世界状态推导，类比既有 `opportunities`（`projection.ts:10`，不持久化） |
| **`DecisionScore`** | ❌ | 纯函数输出 |
| **`AgentMessage` / `AgentInteraction`** | ⚠️ **有界保留** | 见 §3 |

---

## 3. 有界性的强制要求

`Agent.md` §52 明令第一阶段不做「复杂长期记忆检索」；`persistence.ts:34` 有 32MB 硬上限。两者共同要求**所有 Agent 侧集合必须有界**。

| 集合 | 上限（提案） | 淘汰规则 |
| --- | --- | --- |
| `agent.memories` | 40 | `weight` 升序淘汰；同类记忆保底条数 |
| `agent.promises` | 20 | 只保留 `pending` + 最近 N 条已解决 |
| `agent.relationships` | 每 Agent ≤ 其余 Agent 数 | 不需要上限（规模固定为 4） |
| `agentMessages`（全局） | 200 | 最旧优先，且 `read` 的优先淘汰 |
| `agentInteractions`（全局） | 200 | 同上 |

**淘汰必须是确定性的**（按 weight/时间排序，不随插入顺序漂移），否则 `tests/architecture.test.ts:39-60` 的重放断言会不稳定。

> **存档体积估算**：4 个 Agent × （40 条记忆 + 20 条承诺 + 3 条关系）≈ 数百条小对象，远低于 32MB。**但上限仍必须设**——否则长期运行会单调增长。

---

## 4. Schema 变更（v10 → v11）

### 4.1 `WorldState` 顶层新增

```ts
interface WorldState {
  version: 11;                  // ← 由 10 升为 11
  // ... 既有字段全部不变 ...
  agents: Agent[];              // ← 新增
  agentMessages: AgentMessage[];    // ← 新增（有界）
  agentInteractions: AgentInteraction[]; // ← 新增（有界）
}
```

### 4.2 既有字段的**唯一**改动

```ts
// src/engine/types.ts:385 —— kind 由字面量扩为联合
kind: 'rules' | 'agent';

// src/engine/save-schema.ts:158 —— 同步放宽
kind: z.enum(['rules', 'agent']),
```

**此外不改动任何既有字段。** 既有 operator 恒为 `'rules'`，行为与存档语义完全不变。

### 4.3 迁移 `migrateV10`

沿用 `migrateV9`（`saves.ts:7-48`）的模式：

```ts
export function migrateV10(input: unknown): WorldState {
  const old = v10Schema.parse(input);      // 类似 legacy-v9 的冻结校验
  return worldSchema.parse({
    ...old,
    version: 11,
    agents: [],                            // v10 存档没有 Agent
    agentMessages: [],
    agentInteractions: [],
  });
}
```

**`parseSave` 闸门更新**（`saves.ts:49-56`）：

```ts
if (version === 9)  return migrateV9(input)   → 需串接为 v9 → v10 → v11
if (version === 10) return migrateV10(input)
if (version !== 11) throw new UnsupportedSaveVersionError(...)
```

> ⚠️ **v9 存档必须能一路迁到 v11**（`migrateV9` 产出的对象再喂给 `migrateV10`）。这是链式迁移，测试必须覆盖 `v9 → v11` 的完整路径。

### 4.4 `legacy-v9/` 的处理

**不得修改** `src/engine/legacy-v9/**`（`architecture.md:185`）。

v10 的 schema 需要一份冻结副本供 `migrateV10` 校验——参照既有做法新增 `src/engine/legacy-v10/save-schema.ts`，与 `legacy-v9/` 并列。**这是纯新增，不动既有目录。**

---

## 5. 磁盘布局

**完全不变**：

```text
frontiers-v11/            ← 新的世界根（v10 用 frontiers-v10/）
  frontier-000001/
    head.json
    head.json.bak
    day-<N>.json
    branch.json
    failure.json
timeline-v11.json         ← 新的索引（v10 用 timeline-v10.json）
```

`SaveStore` 的 `root` / `indexPath`（`persistence.ts:44-45`）由版本常量驱动，改一处即可。**分支、日快照、失败封存、原子写的逻辑一行不改。**

`migrateTimeline`（`persistence.ts:64-102`）扩展为 v9→v10→v11 的链式迁移：先迁 v9 索引到 v10（既有逻辑），再迁到 v11。

---

## 6. 与既有存档生命周期的对接

| 机制 | 是否受影响 | 说明 |
| --- | --- | --- |
| 原子写 | ❌ 不变 | `atomic()` 复用 |
| 日快照 `daily()` | ❌ 不变 | Agent 状态随 `WorldState` 一起快照 |
| 分支 `create()` | ❌ 不变 | 新分支自然携带当时的 Agent 状态 |
| 失败封存 `failure.json` | ❌ 不变 | `commandLost` 时封存，含 Agent 状态 |
| `restorePreviousDay` | ❌ 不变 | 回滚到昨日即回滚 Agent 状态——**这正确**：§50 的闭环要求状态与时间一致 |
| 损坏恢复 `.bak` / `.corrupt-` | ❌ 不变 | |

> **一个需要明确的语义**：`restorePreviousDay` 会**回滚 Agent 的 trust / memory**。这符合直觉（回到那个时间点），但意味着玩家可以「撤销」一次 Override 的代价。**这是既有机制的自然结果，MVP 接受**，记录在此以免被误认为 bug。

---

## 7. Round-trip 要求（测试）

`Agent.md` §59 与 playbook 均要求：

| 测试 | 断言 |
| --- | --- |
| Save/load round-trip | 存盘再读，`agent.state` 逐字段相等 |
| 链式迁移 | v9 存档 → v11，无信息丢失，`agents` 为空数组 |
| v10 → v11 | 既有 v10 存档迁移后 `agents: []`，其余字段完全不变 |
| 有界淘汰确定性 | 同一序列两次运行，淘汰结果一致 |
| 跨存档闭环 | 存档 → 读档 → Agent 的下一次决策与不存档时一致（mock provider） |

**回归护栏**：既有 `tests/persistence.test.ts`（13 项）必须全部继续通过。任何一项失败都意味着破坏了 Lv1/Lv2 存档。

---

## 8. 不做的事

| 不做 | 理由 |
| --- | --- |
| 新建第二套持久化 | CLAUDE.md §4 |
| 就地修改 v10 schema 语义 | 会静默破坏既有存档 |
| 修改 `legacy-v9/` | `architecture.md:185` 明令冻结 |
| 把 Agent 状态存到 `localStorage` / 独立文件 | 违反「唯一权威存档」；且 `LcarsProvider.tsx` 的偏好存储是 UI 专用，不应承载游戏状态 |
| 向量数据库 / 外部记忆服务 | `Agent.md` §52 明令排除 |
| 无界对话日志 | 见 §3 |
