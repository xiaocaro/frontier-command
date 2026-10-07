# Lv3 Agent 领域模型（02-domain-model）

生成日期：2026-10-07
输入：`Agent.md`（产品规格）；`docs/lv3/01-mvp-scenario.md`（MVP 场景）；反构基线 `docs/lv3/01-lv1-lv2-architecture.md`、`01-state-and-command-map.md`、`01-agent-gap-analysis.md`；事实来源为当前 `src/`、`electron/`、`tests/` 源码。
性质：合同文档。字段级设计，可与 `schemas/*.json` 及后续 Zod 实现对应。

> **本文不照搬 `Agent.md` 的接口。** 每个实体都标注与当前 Frontier Command v10 代码的关系：**Reuse**（直接复用）/ **Adapt**（调整后复用）/ **New**（新增）/ **Defer**（MVP 不实现）。
> 持久化决策见 `02-persistence-strategy.md`；运行时行为见 `02-decision-flow.md`。

---

## 0. 实体关系总览

```text
Agent ──1:1──▶ Operator ──1:1──▶ Ship
  │               (既有)          (既有，物理权威)
  │
  ├── AgentPersonality   稳定，5 维
  ├── AgentState         可变数值
  ├── AgentGoal          含 progress
  ├── AgentRelationship[]  指向其他 Agent
  ├── AgentMemory[]      有界，3 类
  ├── AgentPromise[]     指向 Admiral
  └── nextDecisionAt     决策节拍

派生（不持久化）：
  AgentObservation  ← 由 WorldState 裁剪
  AgentActionCandidate[]  ← 由 WorldState 推导
  AgentDecision     ← LLM 输出 / 确定性 fallback
```

---

## 1. `Agent`（聚合根）— `New`

拆成**稳定身份**与**可变状态**两部分（落实 `Agent.md` §6 自己的区分）：

```ts
interface Agent {
  id: string;                    // 'agent-<n>'，与既有 nextId 一致
  name: string;
  career: AgentCareer;           // Agent.md §8
  personality: AgentPersonality; // 稳定
  state: AgentState;             // 可变
  goal: AgentGoal;
  relationships: AgentRelationship[];
  memories: AgentMemory[];       // 有界
  promises: AgentPromise[];
  nextDecisionAt: number;        // 模拟时间，类比 Enemy.nextDecision (types.ts:298)
}
```

**与 `Operator` 的关系**：`Agent` 不替代 `Operator`。绑定关系仍由既有 `Assignment`（`types.ts:388-392`）表达。`Operator.kind` 由 `'rules'` 扩为 `'rules' | 'agent'`（`types.ts:385` / `save-schema.ts:158`）。

> **为什么不合并**：`Agent.md` §4 说「Agent 是 WorldState 的一部分」，指的是**持久化位置**（进存档），不是**物理权威**。Agent 数据进存档 ≠ Agent 能改物理状态。这条区分是 Rule 1 的实现基础。

---

## 2. `AgentPersonality` — `Reuse`（照 `Agent.md` §5）

```ts
interface AgentPersonality {
  riskTolerance: number;  // 0-100
  curiosity: number;
  loyalty: number;
  cooperation: number;
  ambition: number;
}
```

5 维、0–100、相对稳定。`Agent.md` §5 已定，与代码无冲突，直接采用。

**四个初始 Agent 的取值**（落实 `Agent.md` §9–§12；`high/medium/low` 需映射为数值）：

| Agent | riskTolerance | curiosity | loyalty | cooperation | ambition |
| --- | ---: | ---: | ---: | ---: | ---: |
| Explorer | 75 | 90 | 55 | 55 | 70 |
| Scientist | 50 | 75 | 55 | 55 | 70 |
| Tactical | 70 | 25 | 85 | 80 | 70 |
| Logistics | 25 | 25 | 85 | 80 | 50 |

> 数值是**提案**，须在 Prompt 4 用实际决策结果校准——`Agent.md` §9–§12 只给了定性描述。

---

## 3. `AgentState` — `New`（受 `Agent.md` §4 启发但收窄）

```ts
interface AgentState {
  fatigue: number;          // 0-100，§21 分档
  stress: number;           // 0-100
  morale: number;           // 0-100
  trustInAdmiral: number;   // 0-100，§20 与 loyalty 必须分开
  loyaltyToCompany: number; // 0-100
  experience: number;
  reputation: number;
  goalProgress: number;     // 冗余于 goal.progress，便于快速读取
}
```

**相对 `Agent.md` §4 的删减**：

| `Agent.md` 字段 | 处置 | 理由 |
| --- | --- | --- |
| `currentLocation` | **删** | 可由 `Assignment → Ship → x/y` 派生，重复存储会不同步 |
| `skills: AgentSkills` | **Defer** | `Agent.md` §49 提到技能成长；MVP 无技能系统，§52 允许延后 |
| `currentAssignment` | **改用既有 `Assignment`** | 已有 1:1 绑定与唯一性校验（`save-schema.ts:521-532`），不重复造 |
| `memories` / `promises` / `relationships` | **移到 `Agent` 顶层** | 它们是独立实体，不是 state 的标量 |

---

## 4. `AgentGoal` — `Adapt`（简化 `Agent.md` §7）

```ts
interface AgentGoal {
  id: string;
  title: string;          // 人类可读，进 Prompt
  kind: GoalKind;         // 供机器判定对齐
  progress: number;       // 0-100
  priority: number;
}

type GoalKind =
  | 'discovery'      // Explorer：发现未知区域和重要情报
  | 'research'       // Scientist：获得高级技术与科研成果
  | 'command'        // Tactical：成为优秀指挥者、提升战斗能力
  | 'logistics';     // Logistics：建立稳定安全高效的资源体系
```

**相对 `Agent.md` §7 的简化**：删掉 `conditions: GoalCondition[]`（要求可组合的条件表达式引擎），换成 `kind` 枚举 + 数值 `progress`。

> **理由**：`Agent.md` §52 明令第一阶段不实现复杂系统；而 §48 的 goal progress 示例（`+10 / +15 / +30 / 0`）本质是**由事件驱动的数值增减**，`kind` 足以支撑 GoalAlignment 计算（`02-decision-flow.md` §4）。`conditions` 会引入一个 MVP 用不到的条件求值器。

---

## 5. `AgentMemory` — `New`（有界，三类判别联合）

```ts
type AgentMemory = EpisodicMemory | SocialMemory | PromiseMemory;

interface EpisodicMemory {
  kind: 'episodic';
  id: string;
  at: number;             // 模拟时间
  text: string;           // 进 Prompt 的一句话
  tags: MemoryTag[];      // 供确定性检索
  weight: number;         // 0-100，影响 Prompt 排序与衰减
  subjectId?: string;     // 相关实体（事件/舰船/地点）
}

interface SocialMemory {
  kind: 'social';
  id: string;
  at: number;
  aboutAgentId: string;
  text: string;
  weight: number;
}

interface PromiseMemory {
  kind: 'promise';
  id: string;
  promiseId: string;      // 指向 AgentPromise
  at: number;
  text: string;
  weight: number;
}

type MemoryTag =
  | 'admiral-override'    // §42：被强制
  | 'promise-kept'        // §19：承诺兑现
  | 'promise-broken'      // §19：承诺打破
  | 'mission-success'
  | 'mission-failure'
  | 'discovery'           // §16：发现未知信号
  | 'team-up'
  | 'conflict'
  | 'near-death'
  | 'risk-taken';
```

**必须满足的三条约束**：

1. **有界**：`memories.length ≤ MEMORY_CAP`（提案 40）。超限按 `weight` 升序淘汰。这是 §52「不做复杂长期记忆检索」与 `persistence.ts:34`（存档 32MB 上限）的直接要求。
2. **结构化**：每条都有 `tags` 与 `weight`，使检索**确定性**——按 tag 匹配 + weight 排序，而非语义搜索（§52 明确排除 Vector Database）。
3. **影响未来**：§50 要求「Memory 不影响未来行为则系统无意义」。`02-decision-flow.md` §4 的 `RecentMemoryScore` 是它的落点。

---

## 6. `AgentRelationship` — `Reuse`（照 `Agent.md` §13）

```ts
interface AgentRelationship {
  targetAgentId: string;
  value: number;        // -100 ~ +100
  trust: number;
  cooperation: number;
}
```

`Agent.md` §13 已定，与代码无冲突。用于 §14 的 team-up 倾向与 §43 的 Agent-Agent 互动。

---

## 7. `AgentPromise` — `Reuse`（照 `Agent.md` §18，加 fulfillment 判据）

```ts
interface AgentPromise {
  id: string;
  from: string;           // 'admiral'
  to: string;             // agentId
  type: 'reward' | 'equipment' | 'research' | 'leadership' | 'rest';
  description: string;
  status: 'pending' | 'fulfilled' | 'broken';
  createdAt: number;
  resolvedAt: number | null;   // 新增：便于审计与测试
  fulfills: PromiseFulfillment; // 新增：机器可判定的兑现条件
}

interface PromiseFulfillment {
  kind: 'grant-module' | 'grant-upgrade' | 'grant-rest' | 'grant-credits';
  key?: string;           // 如 moduleId: 'deepScan'
  amount?: number;
}
```

**新增两个字段的理由**：`Agent.md` §18 的 `status` 需要有人去**置位**，但没定义「什么算兑现」。若不定义，Promise 会永远停在 `pending`，§19 的 trust 增减就无法触发——而 §19 正是 MVP EVT-07/EVT-09 的核心验证点。

`fulfills` 让引擎能在既有命令执行后**自动判定**：例如 `REFIT` 装上了 `deepScan` → 兑现 `grant-module/deepScan` 的 pending promise。这复用既有工业命令，不需要新的兑现机制。

---

## 8. `AgentAssignment` — `Reuse`（不新建）

**直接使用既有 `Assignment`**（`types.ts:388-392`）：

```ts
interface Assignment { operatorId: string; shipId: string; since: number; }
```

已有 1:1 唯一性校验（`save-schema.ts:521-532`）与 `vesselLost` 联动（`combat.ts:108`）。新增 `AgentAssignment` 会造出第二套绑定，违反 CLAUDE.md §4。

**Agent → Operator 的映射**：提案在 `Agent` 上不加字段，而是复用既有约定 `operatorId = 'ops-' + shipId`（`data.ts:175-181`），新增 `agentId = operatorId` 的 1:1 约定，或（更稳）在 `Operator` 上加可选 `agentId?: string`。

> **留给 Prompt 3 的决定**：两者都可行。前者零 schema 改动但依赖命名约定；后者显式但有 schema 改动。**提案取显式**——命名约定会在 `buildShip` 产生新舰时（`command-system.ts:488-504`）断裂。

---

## 9. `AgentObservation` — `Adapt`（扩展既有 `Observation`）

既有 `Observation`（`types.ts:643-652`）只有 `time/operatorId/ship/contacts/systems/bodies/opportunities/legalActions`。`Agent.md` §29 要求宽得多，而 Prompt 1 已证实**当前 Observation 无法支撑题面要求的「公司状况」与「同伴关系」决策**。

```ts
interface AgentObservation {
  time: number;
  tick: number;
  agentId: string;

  self: {
    name: string;
    career: AgentCareer;
    personality: AgentPersonality;
    state: AgentState;
    goal: AgentGoal;
  };

  ship: Ship;                       // 复用既有类型
  company: {
    credits: number;
    tension: number;                // 既有 w.tension
    priorities: string[];           // 由玩家设定的当前任务焦点
  };

  contacts: IntelRecord[];          // 复用（已裁剪）
  systems: StarSystem[];            // 复用
  bodies: Body[];                   // 复用（已按 survey 脱敏）
  opportunities: Opportunity[];     // 复用既有 projection.opportunities

  relationships: AgentRelationship[];
  recentMemory: AgentMemory[];      // 有界，按 weight 排序
  pendingMessages: AgentMessage[];

  activePromise: AgentPromise | null;
  activeDirective: {                // 既有 s.current 的语义化视图
    actionType: string;
    source: 'admiral' | 'standing';
    note: string;
  } | null;

  availableActions: AgentActionCandidate[];
}
```

**裁剪规则（Rule 5，`Agent.md` §30）**——以下**不得**进入任一 Agent 的 Observation：

| 禁止项 | 已有保障 |
| --- | --- |
| 其他 Agent 的 memory / promise / state | 需新增：只投影自己 |
| `WorldState.enemies` | ✅ 既有（`projection.ts:59-198` 白名单） |
| `seed` / `initialSeed` | ✅ 既有 |
| `factions` 内部（reports/credits/stance） | ✅ 既有 |
| 他人舰船的货舱与弹仓 | 需新增：`contacts` 已是 `IntelRecord` 而非 `Ship` |
| 未发现的地理 | ✅ 既有 |

> **可复用**：现有 `snapshot()` 已完成全部世界级裁剪。`AgentObservation` 只需在它之上**再做一层「单 Agent 视角」过滤**，而不是重新实现裁剪。

---

## 10. `AgentActionCandidate` — `New`（替换 `legalActions`）

```ts
interface AgentActionCandidate {
  id: string;              // choiceId，稳定、可读，如 'explore:0/12'
  label: string;           // 人类可读，进 Prompt
  action: Action;          // 既有 Action 联合（types.ts:210-240）
  risk: number;            // 0-100，供 RiskDiscomfort
  reward: number;          // 0-100，供 RewardAttractiveness
  goalKinds: GoalKind[];   // 供 GoalAlignment
  requirements: string[];  // 人类可读的硬性前置
}
```

**这是 `Agent.md` §27/§28 的落点**：LLM 只回 `choiceId`，引擎侧用 `availableActions.find(c => c.id === choiceId)` 取出**已经合法构造的 `Action`**，再走既有 `submitAction`。

**`id` 的生成规则**（提案，Prompt 3 细化）：

| 候选来源 | id 形态 |
| --- | --- |
| 探索某星区 | `explore:<q>/<r>` |
| 调查天体 | `survey:<bodyId>` |
| 运输 | `haul:<src>><dst>:<good>` |
| 护航某 Agent | `escort:<shipId>` |
| 接受/拒绝/反报价当前任务 | `accept` / `reject` / `counteroffer` |

`risk`/`reward` 从既有数据推导：`risk` 由 `routeEstimate`（`navigation.ts:170`）与目标区域威胁度合成；`reward` 由既有 `opportunities`（`projection.ts:10-58`）的语义映射。

---

## 11. `AgentDecision` — `Adapt`（`Agent.md` §24 + 校验元数据）

```ts
interface AgentDecision {
  intent: AgentIntent;      // 'act'|'wait'|'request'|'invite'|'respond'|'rest'|'quit'
  choiceId?: string;        // intent === 'act' 时必填
  reason: string;           // 进 Memory / 通信；**不是事实来源**
  say?: string;             // 面向玩家的话
  request?: AgentRequest;   // intent === 'request' 时
  // —— 新增的校验元数据 ——
  promptVersion: string;
  observationTick: number;  // 用于 stale 检测
  provider: 'llm' | 'deterministic';
}

interface AgentRequest {
  type: 'teammate' | 'equipment' | 'reward' | 'rest' | 'extension';
  targetAgentId?: string;
  value?: number;
}
```

**新增三字段的理由**：

- `promptVersion`：`Agent.md` §57 + CLAUDE.md §7 要求提示词版本化。
- `observationTick`：**stale 检测的唯一依据**。若决策回来时世界已推进过多，必须丢弃。
- `provider`：区分 LLM 输出与 deterministic fallback（§58）。测试需要断言 fallback 路径。

`reason` **不是事实来源**——`Agent.md` 未强调，但 §50 的闭环要求记忆来自**实际发生的事**。因此 Memory 写入用的是引擎结算结果，`reason` 只作为 Agent 自述的附加文本。

---

## 12. `AgentMessage` — `New`（Admiral ↔ Agent 与 Agent ↔ Agent）

```ts
interface AgentMessage {
  id: string;
  at: number;
  from: 'admiral' | string;   // agentId
  to: string | 'admiral';     // agentId
  kind: AgentMessageKind;
  text: string;               // 面向玩家/Agent 的自然语言
  payload?: MessagePayload;   // 结构化部分
  read: boolean;
}

type AgentMessageKind =
  | 'command'      // §37
  | 'ask'          // §38
  | 'negotiate'    // §39
  | 'promise'      // §40
  | 'encourage'    // §41
  | 'override'     // §42
  | 'team-request' // §43
  | 'team-reply'
  | 'report';
```

**与既有 `Communication` 的关系**：既有 `Communication`（`types.ts:411-419`）是**世界事件滚动流**（含 `priority`/`category`），面向 UI 顶栏。`AgentMessage` 是**双向互动记录**，需要 `from`/`to`/`read`/`payload`。

> **提案**：不复用 `Communication`（语义不同、字段不足），但 Agent 的对外发言**同时**产生一条 `Communication`，使既有 UI 通信流不改造即可显示 Agent 的话。这样既有 UI 零改动就能看到 Agent 发言。

---

## 13. `AgentInteraction` — `New`（Admiral 6 类 + Agent-Agent）

```ts
interface AgentInteraction {
  id: string;
  at: number;
  kind: InteractionKind;
  actorId: 'admiral' | string;
  targetAgentId: string;
  messageId: string | null;
  outcome: 'accepted' | 'rejected' | 'countered' | 'pending' | 'forced';
  effects: AgentStateDelta;   // 实际造成的数值变化，便于审计与测试
}

type InteractionKind =
  | 'command' | 'ask' | 'negotiate' | 'promise'
  | 'encourage' | 'override'          // §36 的六类
  | 'team-request' | 'team-reply';    // §43

interface AgentStateDelta {
  trustInAdmiral: number;
  loyaltyToCompany: number;
  morale: number;
  stress: number;
  fatigue: number;
  relationship?: { targetAgentId: string; value: number };
}
```

`effects` 记录**实际生效的增量**——这是 `Agent.md` §59 测试要求（Override → trust 变化、Promise → trust 变化）的断言对象，也是 Rule 8「行为可追踪」的落点。

**Override 的代价**（`Agent.md` §42 的具体值 + 约束）：
`trustInAdmiral -= 10`、`morale -= 5`、`stress += 10`，并写入 `admiral-override` tag 的 episodic memory。
**不能被鼓励抵消**——§41 明确「不能无条件提高数值」，需 `context/relationship/recent events` 影响。

---

## 14. `AgentEvent` — `Adapt`（复用既有 `WorldEvent` + 新增 Agent 侧事件）

既有 `WorldEvent`（`types.ts:157-173`）是**世界事件**（wormhole/plague/invasion/accident/distress/refugees/discovery/derelict/diplomatic），已有完整生命周期。**不替换、不重造。**

Agent 侧需要的是**决策相关事件**，作为 scheduler 的触发源（`Agent.md` §34）：

```ts
type AgentTrigger =
  | { kind: 'ship-idle' }
  | { kind: 'directive-completed'; directiveId: string }
  | { kind: 'directive-failed'; directiveId: string; reason: string }
  | { kind: 'admiral-message'; messageId: string }
  | { kind: 'agent-request'; fromAgentId: string }
  | { kind: 'high-value-opportunity'; opportunityId: string }
  | { kind: 'danger'; contactId: string }
  | { kind: 'promise-changed'; promiseId: string }
  | { kind: 'world-event'; eventId: string }
  | { kind: 'no-decision-for'; minutes: number };
```

> **这就是「不每 tick 调 LLM」的实现载体**：`AgentTrigger` 是**离散事件**，由引擎在既有分支中发出（如 `engine.complete()` 完成后发 `directive-completed`），而不是由 tick 计数产生。

---

## 15. 实体处置一览

| 实体 | 处置 | 说明 |
| --- | --- | --- |
| `Agent` | **New** | 聚合根，拆稳定/可变两部分 |
| `AgentPersonality` | **Reuse** | 照 `Agent.md` §5 |
| `AgentState` | **New**（收窄 §4） | 删 `currentLocation`，`skills` Defer，`currentAssignment` 改用既有 `Assignment` |
| `AgentGoal` | **Adapt** | 删 `conditions`，改 `kind` 枚举 |
| `AgentMemory` | **New** | 有界、带 tags/weight 的三类判别联合 |
| `AgentRelationship` | **Reuse** | 照 `Agent.md` §13 |
| `AgentPromise` | **Reuse + 2 字段** | 加 `resolvedAt` / `fulfills` 使兑现可判定 |
| `AgentAssignment` | **Reuse（不新建）** | 直接用既有 `Assignment` |
| `AgentObservation` | **Adapt** | 在既有 `snapshot()` 裁剪之上加单 Agent 视角过滤 |
| `AgentDecision` | **Adapt** | `Agent.md` §24 + 3 个校验元数据字段 |
| `AgentActionCandidate` | **New** | 替换不可靠的 `legalActions` |
| `AgentMessage` | **New** | 双向互动；对外发言同时写既有 `Communication` |
| `AgentInteraction` | **New** | 含 `effects` 供审计与测试断言 |
| `AgentEvent` | **Adapt** | 既有 `WorldEvent` 不动，新增 `AgentTrigger` 作调度源 |
| `AgentSkills` | **Defer** | `Agent.md` §49 的技能成长，MVP 不需要 |
| `GoalCondition` | **Defer** | 条件求值器，MVP 用 `kind` 替代 |
| Quit/Leave 系统 | **Defer** | `Agent.md` §47；不在 MVP 9 个事件内 |
