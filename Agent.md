可以。下面这份我建议直接作为 **`Agent.md`** 放进 Frontier Command 项目根目录。它不是泛泛的 Agent 设计文档，而是作为 **Lv3 Agent 的开发规格（Single Source of Truth）**：Claude Code / Codex 后续实现时都以它为约束。

# Frontier Command — Lv3 Agent Specification

> **版本：v1.0**
>
> **适用版本：Frontier Command v10 → Lv3 Agent**
>
> **文档用途：Agent 系统的产品设计、领域模型、LLM 接口、行为规则与实现边界的唯一参考**
>
> **核心原则：保留 Lv1/Lv2 确定性 MMO Simulation Engine，在其上增加具有目标、人格、关系、记忆和自主决策能力的 Agent。**

---

# 1. Lv3 Agent 的目标

Frontier Command 已经具备：

- MMO / 太空模拟世界
- Ship
- WorldState
- SimulationEngine
- Command / Action
- Admiral / Operator
- Deterministic simulation
- Action validation
- ControllerPort
- Lv1/Lv2 游戏循环

Lv3 的目标不是重写这些系统。

Lv3 要增加的是：

> **让 Operator 从“规则控制器”升级为“有目标、有性格、有记忆、有关系、能够与玩家互动并自主做决定的 Agent”。**

因此：

```text
Lv1/Lv2

Player / Admiral
       ↓
Command
       ↓
SimulationEngine
       ↓
WorldState


Lv3

Player / Admiral
       ↓
Directive
       ↓
Agent
 ├── Personality
 ├── Goals
 ├── State
 ├── Memory
 ├── Relationships
 ├── Promises
 └── Current Assignment
       ↓
Agent Decision
       ↓
Validation
       ↓
SimulationEngine
       ↓
WorldState
```

---

# 2. 核心设计原则

## 2.1 Agent ≠ Ship

Agent 是人。

Ship 是游戏实体。

Agent 决定如何使用 Ship。

```text
Agent
 ├── personality
 ├── goals
 ├── memory
 ├── relationships
 ├── trust
 ├── fatigue
 └── decisions

Ship
 ├── hull
 ├── fuel
 ├── weapons
 ├── cargo
 ├── sensors
 └── position
```

**禁止：**

```text
ship.personality
ship.goal
ship.memory
```

人格、目标、记忆属于 Agent。

Ship 只提供执行任务所需要的能力。

---

# 3. Agent 的核心体验

Lv3 Agent 必须让玩家感受到：

> **玩家不是在操作几个飞船，而是在管理几个“人”。**

同一个任务交给不同 Agent：

```text
Agent A:
“风险太高，我需要护航。”

Agent B:
“这正是我想要的机会，我接受。”

Agent C:
“任务没有价值，我不想浪费时间。”

Agent D:
“可以，但我要你保证撤退条件。”
```

因此 Agent 的行为不能只是：

```text
if action available:
    choose action
```

而应该受到：

```text
Personality
+ Goal
+ Career
+ Fatigue
+ Trust
+ Relationship
+ Memory
+ Promise
+ Risk
+ Reward
```

共同影响。

---

# 4. Agent State

Agent 是 WorldState 的一部分。

建议：

```ts
interface AgentState {
  id: string;
  name: string;

  personality: AgentPersonality;

  skills: AgentSkills;

  currentCareer: AgentCareer;

  lifeGoal: AgentGoal;

  goalProgress: number;

  fatigue: number;
  stress: number;
  morale: number;

  trustInAdmiral: number;
  loyaltyToCompany: number;

  relationships: AgentRelationship[];

  memories: AgentMemory[];

  promises: AgentPromise[];

  currentLocation: string | null;

  currentAssignment: AgentAssignment | null;

  experience: number;

  reputation: number;

  nextDecisionAt: number;
}
```

---

# 5. Personality

Personality 用于解释：

> 为什么两个能力相近的 Agent 会做出不同选择。

建议第一版使用 5 个核心维度：

```ts
interface AgentPersonality {
  riskTolerance: number;
  curiosity: number;
  loyalty: number;
  cooperation: number;
  ambition: number;
}
```

范围：

```text
0 - 100
```

含义：

### riskTolerance

风险接受程度。

```text
0   = 极度保守
50  = 普通
100 = 极度冒险
```

### curiosity

探索未知的兴趣。

### loyalty

对公司 / Admiral 的忠诚倾向。

### cooperation

与其他 Agent 合作的倾向。

### ambition

追求晋升、能力、成就和个人发展的程度。

---

# 6. Agent State 与 Personality 的区别

必须严格区分：

### Personality

相对稳定：

```text
riskTolerance
curiosity
loyalty
cooperation
ambition
```

### State

随着游戏变化：

```text
fatigue
stress
morale
trustInAdmiral
loyaltyToCompany
goalProgress
experience
```

例如：

```text
Personality:
riskTolerance = 80

当前状态:
fatigue = 90
stress = 80
```

这个 Agent 仍然是“喜欢冒险的人”。

但当前可能仍然拒绝高风险任务。

---

# 7. Agent Goals

每个 Agent 必须拥有：

```ts
interface AgentGoal {
  id: string;
  title: string;
  description: string;

  progress: number;

  priority: number;

  conditions: GoalCondition[];
}
```

Agent Goal 不应该只是：

```text
“完成任务”
```

而应该是：

```text
探索未知
成为顶尖飞行员
获得高级技术
提高个人财富
建立自己的舰队
获得指挥权
保护团队
```

Goal 是 Agent 行为差异的重要来源。

---

# 8. Agent Career

Agent 可以拥有职业方向：

```ts
type AgentCareer =
  | 'explorer'
  | 'scientist'
  | 'tactical'
  | 'logistics';
```

第一版建议使用四种明显不同的 Agent。

---

# 9. 四个初始 Agent

## 9.1 Explorer

### 定位

探索者 / 侦察员。

### Personality

```text
riskTolerance: high
curiosity: very high
loyalty: medium
cooperation: medium
ambition: high
```

### Goal

> 发现未知区域和重要情报。

### 行为倾向

喜欢：

- Exploration
- Deep Scan
- Unknown Contact
- High-value Discovery

不喜欢：

- 重复运输
- 无意义巡逻
- 被要求停止调查

### 冲突方式

可能：

```text
ACCEPT
```

也可能：

```text
COUNTEROFFER

“我可以接受，但我要完成深度扫描。”
```

---

# 10. Scientist

### 定位

科学家 / 技术专家。

### Personality

```text
riskTolerance: medium
curiosity: high
loyalty: medium
cooperation: medium
ambition: high
```

### Goal

获得高级技术 / 科研成果。

### 喜欢

- Anomaly
- Research
- Advanced Technology
- Experimental Mission

### 不喜欢

- 低技术重复任务
- 无意义运输
- 错过科研机会

### 典型反应

```text
“如果让我负责这个任务，我需要研究权限。”
```

---

# 11. Tactical

### 定位

战术 / 作战 Agent。

### Personality

```text
riskTolerance: high
curiosity: low
loyalty: high
cooperation: high
ambition: high
```

### Goal

成为优秀指挥者 / 提升战斗能力。

### 喜欢

- Combat
- Escort
- High-risk Operations
- Team missions

### 不喜欢

- 无准备的战斗
- 让队友承担不必要风险

---

# 12. Logistics

### 定位

后勤 / 资源管理 Agent。

### Personality

```text
riskTolerance: low
curiosity: low
loyalty: high
cooperation: high
ambition: medium
```

### Goal

建立稳定、安全、高效的资源体系。

### 喜欢

- Cargo
- Salvage
- Repair
- Resource optimization

### 不喜欢

- 不必要风险
- 船只损伤
- 资源浪费

---

# 13. Agent Relationship

Agent 与 Agent 之间必须存在关系。

```ts
interface AgentRelationship {
  targetAgentId: string;

  value: number;

  trust: number;

  cooperation: number;
}
```

建议：

```text
-100 ~ +100
```

关系影响：

- Team-up
- Escort
- Accept suggestion
- Help another Agent
- Defend another Agent
- Leave together

---

# 14. Relationship 示例

例如：

```text
Explorer → Tactical
relationship = +60
```

Explorer 更可能：

```text
REQUEST TEAMMATE
```

Tactical 更可能：

```text
ACCEPT
```

如果：

```text
relationship = -60
```

则可能：

```text
REJECT

“我不想再和他一起执行任务。”
```

---

# 15. Agent Memory

Memory 是 Lv3 的核心。

Agent 必须记住：

> “玩家以前怎么对待我。”

建议：

```ts
type AgentMemory =
  | EpisodicMemory
  | SocialMemory
  | PromiseMemory;
```

---

# 16. Episodic Memory

记录重要事件。

例如：

```text
Day 8:
Admiral ordered me to continue after hull damage.
```

```text
Day 14:
I discovered an unknown signal.
```

```text
Day 20:
Admiral cancelled my investigation.
```

事件记忆必须能够影响未来行为。

---

# 17. Social Memory

记录对其他 Agent 的认知。

例如：

```text
“Kira cares strongly about money.”
```

```text
“Milo protects damaged ships.”
```

```text
“Noah often prioritizes research.”
```

Social Memory 可以影响：

```text
trust
team-up
recommendation
conflict
negotiation
```

---

# 18. Promise Memory

Promise 是 Lv3 最重要的玩家互动机制之一。

例如：

Admiral：

```text
“完成这次任务后，我给你一次 Deep Scan 权限。”
```

Agent：

```text
“好，我接受。”
```

系统创建：

```ts
interface AgentPromise {
  id: string;

  from: string;
  to: string;

  type:
    | 'reward'
    | 'equipment'
    | 'research'
    | 'leadership'
    | 'rest';

  description: string;

  status:
    | 'pending'
    | 'fulfilled'
    | 'broken';

  createdAt: number;
}
```

---

# 19. Promise 对未来行为的影响

Promise fulfilled：

```text
trust ↑
loyalty ↑
morale ↑
goalProgress ↑
```

Promise broken：

```text
trust ↓
loyalty ↓
stress ↑
quitPressure ↑
```

因此：

> **玩家的对话不能只是 UI 文本。**

必须改变游戏状态。

---

# 20. Trust / Loyalty / Morale / Fatigue

这四个变量必须分开。

## Trust

Agent 是否相信 Admiral。

---

## Loyalty

Agent 是否愿意继续为公司工作。

---

## Morale

Agent 当前精神状态。

---

## Fatigue

Agent 当前疲劳程度。

---

例如：

```text
Trust = 20
Loyalty = 80
```

意味着：

> Agent 仍然忠诚，但已经不太相信 Admiral。

而：

```text
Trust = 90
Loyalty = 30
```

意味着：

> Agent 信任 Admiral，但公司本身已经让他失去留下来的动力。

---

# 21. Fatigue

建议：

```text
0-39
正常

40-69
疲劳

70-84
严重疲劳

85-100
强制休息 / 高风险任务失败率显著增加
```

任务可能增加：

```text
normal mission:
fatigue + 10

high risk mission:
fatigue + 15

rest:
fatigue - 20
```

---

# 22. Admiral 与 Agent 的关系

Lv3 不应该简单变成：

```text
Admiral Command
       ↓
Agent Execute
```

而应该：

```text
Admiral Directive
       ↓
Agent Evaluation
       ↓
┌──────────────┐
│ ACCEPT       │
│ REJECT       │
│ COUNTEROFFER │
│ REQUEST      │
└──────────────┘
       ↓
Game Rule Validation
       ↓
Execute
```

---

# 23. Agent Decision

Agent 的高层决策：

```ts
type AgentIntent =
  | 'act'
  | 'wait'
  | 'request'
  | 'invite'
  | 'respond'
  | 'rest'
  | 'quit';
```

LLM 不直接改变 WorldState。

---

# 24. Agent Decision Schema

建议：

```ts
interface AgentDecision {
  intent:
    | 'act'
    | 'wait'
    | 'request'
    | 'invite'
    | 'respond'
    | 'rest'
    | 'quit';

  choiceId?: string;

  reason: string;

  say?: string;

  request?: {
    type: string;
    targetAgentId?: string;
    value?: number;
  };
}
```

---

# 25. LLM 的职责

LLM 负责：

> **理解 Agent 状态并表达 Agent 的“意图和理由”。**

LLM 可以决定：

```text
接受
拒绝
反报价
请求队友
请求装备
休息
邀请其他 Agent
向 Admiral 提问
退出谈判
```

LLM 不负责：

```text
扣钱
移动飞船
计算伤害
修改 HP
修改 fuel
直接修改 WorldState
```

---

# 26. Engine 的职责

Engine 负责：

```text
Action validation
Resource validation
Distance
Fuel
Combat
Damage
Cargo
Rewards
Time
Mission result
Fatigue
Trust changes
Relationship changes
Memory creation
Goal progress
```

原则：

> **LLM 决定“我想做什么”。Engine 决定“这个事情实际上能不能发生，以及发生后结果是什么”。**

---

# 27. Available Actions / Affordances

不要继续依赖简单：

```ts
legalActions: string[]
```

建议改为：

```ts
availableActions: AgentActionCandidate[]
```

例如：

```ts
interface AgentActionCandidate {
  id: string;

  label: string;

  action: GameAction;

  risk: number;

  reward?: number;

  requirements?: string[];
}
```

---

# 28. ChoiceId

LLM 不应该自己生成完整 Action 参数。

错误：

```json
{
  "action": "EXPLORE",
  "target": "sector-2",
  "ship": "ship-01"
}
```

正确：

```json
{
  "intent": "act",
  "choiceId": "explore-sector-2"
}
```

Engine：

```text
choiceId
   ↓
availableActions
   ↓
resolve
   ↓
GameAction
   ↓
validateAction()
   ↓
SimulationEngine
```

这样可以避免：

- 参数幻觉
- 非法目标
- 操作其他 Agent 的 Ship
- 越权操作
- LLM 修改游戏规则

---

# 29. Agent Observation

LLM 看到的不是整个 WorldState。

Agent 只能获得自己的 Observation。

建议：

```ts
interface AgentObservation {
  time: number;

  self: {
    id: string;
    name: string;

    personality: AgentPersonality;

    state: {
      fatigue: number;
      stress: number;
      morale: number;

      trustInAdmiral: number;
      loyaltyToCompany: number;
    };

    goals: AgentGoal[];
  };

  ship: ShipObservation;

  company: {
    credits: number;
    currentPriorities: string[];
  };

  contacts: ContactObservation[];

  opportunities: Opportunity[];

  relationships: AgentRelationship[];

  recentMemory: AgentMemory[];

  pendingMessages: AgentMessage[];

  availableActions: AgentActionCandidate[];
}
```

---

# 30. Agent 的信息边界

Agent 不允许直接访问：

```text
WorldState
```

也不能：

```text
dispatchCommand()
```

只能：

```text
getObservation()
submitAction()
```

这必须继续保持 Lv1/Lv2 已有的架构安全边界。

---

# 31. Agent Runtime

建议：

```text
electron/
└── agent/
    ├── runtime.ts
    ├── model-client.ts
    ├── openai-compatible.ts
    └── prompt.ts
```

---

# 32. ModelClient

模型必须抽象。

```ts
interface ModelClient {
  decide(
    observation: AgentObservation
  ): Promise<AgentDecision>;
}
```

这样未来可以切换：

```text
GPT
DeepSeek
Claude
GLM
其他 OpenAI-compatible API
```

而不修改 SimulationEngine。

---

# 33. Agent Runtime Loop

核心流程：

```text
WorldState
    ↓
Decision Trigger
    ↓
AgentObservation
    ↓
Prompt
    ↓
LLM
    ↓
AgentDecision
    ↓
Zod Validation
    ↓
Resolve choiceId
    ↓
ControllerPort
    ↓
validateAction()
    ↓
SimulationEngine
    ↓
WorldState
```

---

# 34. 不允许每个 Tick 调用 LLM

禁止：

```text
every 1 second
    ↓
LLM
```

应采用 Event-driven Decision。

触发条件：

```text
Ship idle
Task completed
Task failed
High-value opportunity
Danger
Admiral message
Agent invitation
Agent request
Long time without decision
Major event
Promise fulfilled/broken
```

---

# 35. LLM 调用优先级

高优先级：

```text
New contract
High-conflict mission
Counteroffer
Major event
Broken promise
Agent conflict
External offer
Quit decision
Final key decision
```

低优先级：

```text
Move
Wait
Normal resource deduction
Routine repair
Known low-risk action
```

低优先级事件使用确定性规则即可。

---

# 36. Admiral Interaction

玩家与 Agent 至少支持以下六类互动：

```text
COMMAND
ASK
NEGOTIATE
PROMISE
ENCOURAGE
OVERRIDE
```

---

# 37. COMMAND

玩家提出任务：

```text
“去调查未知信号。”
```

Agent 可以：

```text
Accept
Reject
Counteroffer
Request Teammate
Request Equipment
```

---

# 38. ASK

玩家询问：

```text
“你为什么不想执行这个任务？”
```

Agent 根据：

```text
Goal
Memory
Fatigue
Trust
Risk
Relationship
```

回答。

注意：

回答不是纯聊天。

如果 Agent 明确表达需求：

```text
“如果你给我一个 Tactical escort，我可以接受。”
```

系统应该创建：

```text
Request
```

---

# 39. NEGOTIATE

Agent 可以反报价：

```text
“我接受，但是需要 +20 reward。”

“我接受，但是我要 Noah 随行。”

“我接受，但任务完成后我要 Deep Scan 权限。”
```

---

# 40. PROMISE

Admiral 可以做出承诺：

```text
Bonus
Equipment
Research Access
Leadership
Rest Day
```

Promise 必须进入 Agent Memory。

---

# 41. ENCOURAGE

玩家可以鼓励 Agent。

例如：

```text
“我相信你。”
```

可以影响：

```text
morale
trust
```

但不能无条件提高数值。

应该有：

```text
context
relationship
recent events
```

影响。

---

# 42. OVERRIDE

Admiral 仍然拥有最终权力。

因此保留：

```text
COMMAND OVERRIDE
```

但是 Override 必须产生代价。

例如：

```text
trustInAdmiral -= 10
morale -= 5
stress += 10
```

并产生 Memory：

```text
“Admiral forced me to continue despite my refusal.”
```

---

# 43. Agent-Agent Interaction

第一版只实现一种：

> **Request Teammate / Team-up**

例如：

```text
Explorer
   ↓
Request Tactical
   ↓
Tactical Agent
   ↓
Accept / Reject
   ↓
ESCORT / TEAM-UP
```

决定因素：

```text
relationship
risk
fatigue
current assignment
personal goal
Admiral directive
ship status
```

---

# 44. Agent Conflict

两个 Agent 不需要复杂 AI。

只需要让不同价值观产生冲突。

例如：

```text
Explorer:
“我们必须继续调查。”

Logistics:
“船已经损伤，再继续没有意义。”
```

玩家需要：

```text
选择
谈判
承诺
强制
```

这就是 Lv3 的核心管理体验。

---

# 45. Decision Factors

Agent 决策主要受到：

```text
Skill Fit
Goal Alignment
Reward
Risk
Fatigue
Trust
Career Value
Team Fit
Promise Value
Relationship
Recent Memory
Current Assignment
```

影响。

---

# 46. Deterministic Decision Score

可以保留确定性 fallback。

建议：

```text
DecisionScore =
    0.20 SkillFit
  + 0.20 GoalAlignment
  + 0.15 RewardAttractiveness
  + 0.10 CEOTrust
  + 0.10 TeamFit
  + 0.10 CareerValue
  + 0.05 PromiseValue
  - 0.10 RiskDiscomfort
  - 0.10 FatiguePenalty
```

结果：

```text
70+
ACCEPT

45-69
CONSIDER / LLM

25-44
COUNTER / REQUEST

<25
REJECT
```

LLM 不负责计算这个分数。

LLM 负责：

> 在确定性因素基础上表达 Agent 的理由和意图。

---

# 47. Quit / Leave

不要使用简单：

```ts
if loyalty < 30:
    quit
```

应该综合：

```text
BrokenPromises
LowGoalProgress
LowTrust
HighStress
SalaryGap
CompetitorOffer
CareerValue
```

触发：

```text
Quit Negotiation
```

Agent 可以：

```text
COUNTEROFFER
REQUEST
STAY
LEAVE
```

---

# 48. Goal Progress

Agent Goal 必须随着游戏变化。

例如 Explorer：

```text
Day 1:
TruthProgress = 10

发现异常信号:
+10

完成 Deep Scan:
+15

发现重大线索:
+30

被强制停止调查:
0 / negative
```

Goal Progress 影响：

```text
future decisions
morale
loyalty
career
quit pressure
```

---

# 49. Agent Growth

Agent 必须随着游戏发展变化。

可以增长：

```text
experience
skills
goalProgress
reputation
relationship
trust
```

例如：

```text
Explorer
Day 1:
Exploration 55

Day 15:
Exploration 70
```

未来任务：

```text
SkillFit ↑
```

因此 Agent 的行为会改变。

---

# 50. Memory → Future Behavior

这是 Lv3 必须验证的闭环：

```text
Player Action
      ↓
Event
      ↓
Memory
      ↓
Trust / Relationship / Goal
      ↓
Future Decision
```

如果 Memory 不影响未来行为：

> Memory 系统没有实际意义。

---

# 51. Lv3 最小完整 Vertical Slice

第一版不需要实现全部 Agent 功能。

只需要完成一个完整闭环：

```text
1. Admiral 发布探索任务

2. Agent 查看任务

3. Agent 发现风险

4. Agent Counteroffer

5. Admiral 接受条件

6. Agent 请求 Tactical Agent

7. Tactical Agent Accept

8. 两个 Agent 执行任务

9. SimulationEngine 处理任务

10. 任务成功

11. Agent Goal Progress 更新

12. Relationship 更新

13. Admiral 与 Agent 对话

14. Admiral 做出 Promise

15. Promise 写入 Memory

16. 后续高风险任务

17. Agent 根据过去 Promise / Trust / Fatigue
    做出不同决定
```

这条链路完成后：

> Lv3 Agent 的核心价值已经成立。

---

# 52. Lv3 不应该第一阶段实现的内容

第一阶段不要实现：

```text
复杂 Agent 社会
复杂经济系统
复杂职业树
无限 NPC
复杂长期记忆检索
LangGraph
Multi-Agent framework
Agent 自己写代码
复杂情绪模型
复杂自然语言任务生成
```

这些都不是 Lv3 的核心。

---

# 53. 推荐目录

建议：

```text
src/
├── engine/
│   ├── agent/
│   │   ├── agent-state.ts
│   │   ├── agent-personality.ts
│   │   ├── agent-goals.ts
│   │   ├── agent-memory.ts
│   │   ├── agent-relationship.ts
│   │   ├── agent-promise.ts
│   │   ├── agent-observation.ts
│   │   ├── agent-actions.ts
│   │   └── agent-decision.ts
│   │
│   ├── world-state.ts
│   ├── simulation-engine.ts
│   └── ...
│
└── ...

electron/
└── agent/
    ├── runtime.ts
    ├── model-client.ts
    ├── openai-compatible.ts
    └── prompt.ts
```

---

# 54. Data Flow

最终系统：

```text
                 ┌──────────────┐
                 │  WorldState  │
                 └──────┬───────┘
                        │
                        ▼
              ┌──────────────────┐
              │ Decision Trigger │
              └────────┬─────────┘
                       │
                       ▼
              ┌──────────────────┐
              │ AgentObservation │
              └────────┬─────────┘
                       │
       ┌───────────────┼────────────────┐
       │               │                │
       ▼               ▼                ▼
 Personality         Goals          Memories
       │               │                │
       └───────────────┼────────────────┘
                       │
                       ▼
                 ┌───────────┐
                 │    LLM    │
                 └─────┬─────┘
                       │
                       ▼
                AgentDecision
                       │
                       ▼
                  Zod Validate
                       │
                       ▼
                  choiceId
                       │
                       ▼
              resolve availableActions
                       │
                       ▼
                ControllerPort
                       │
                       ▼
                validateAction
                       │
                       ▼
               SimulationEngine
                       │
                       ▼
                  WorldState
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
       Memory        Goal       Relationship
          │            │            │
          └────────────┼────────────┘
                       ▼
                Next Decision
```

---

# 55. Security / Architecture Rules

以下规则不可违反。

## Rule 1

Agent 不允许直接修改 WorldState。

---

## Rule 2

LLM 不允许直接执行 GameAction。

---

## Rule 3

LLM 不允许绕过 Zod validation。

---

## Rule 4

LLM 不允许操作其他 Agent 的 Ship。

---

## Rule 5

Agent 只能看到自己的 Observation。

---

## Rule 6

SimulationEngine 是最终规则权威。

---

## Rule 7

Admiral Override 可以绕过 Agent 的拒绝，但不能绕过 Engine validation。

---

## Rule 8

所有重要 Agent 行为必须产生可追踪 Event。

---

# 56. LLM Prompt 原则

Prompt 不应该告诉 LLM：

```text
“你是一个 AI。”
```

而应该告诉它：

```text
你是 Frontier Command 中的 Agent。

你的行为必须符合：

Personality
Goals
Career
Fatigue
Trust
Relationships
Memory
Promises
Current Assignment
```

LLM 的目标：

> **像这个 Agent 一样做决定，而不是替游戏设计者做决定。**

---

# 57. LLM 输出原则

LLM 必须输出结构化 JSON。

例如：

```json
{
  "intent": "request",
  "choiceId": "explore-sector-2",
  "reason": "This mission strongly matches my exploration goal, but the risk is too high without escort.",
  "say": "I can take this mission if Tactical provides escort."
}
```

禁止：

```text
自由文本作为唯一输出
```

---

# 58. LLM Failure Fallback

LLM：

```text
timeout
invalid JSON
invalid choiceId
API failure
```

不能导致游戏崩溃。

Fallback：

```text
Deterministic Decision System
```

例如：

```text
score >= 70
→ ACCEPT

45-69
→ safe default / wait

25-44
→ REQUEST / COUNTER

<25
→ REJECT
```

---

# 59. 测试要求

Lv3 至少需要测试：

### Agent Isolation

```text
Agent A cannot operate Agent B's ship.
```

### Observation Isolation

```text
Agent only receives allowed observation.
```

### Decision Validation

```text
invalid choiceId → rejected
```

### Override

```text
Admiral override → Agent memory/trust changes
```

### Promise

```text
Promise fulfilled → trust increases
Promise broken → trust decreases
```

### Relationship

```text
high relationship → team-up more likely
low relationship → team-up less likely
```

### Fatigue

```text
high fatigue → high-risk task less likely
```

### Goal

```text
successful goal-aligned mission → goalProgress increases
```

### Memory

```text
important event → future decision can observe memory
```

---

# 60. Lv3 Definition of Done

Lv3 Agent 不以“接入 LLM”为完成标准。

必须满足：

### Identity

Agent 有：

```text
Name
Personality
Career
Goal
```

### State

Agent 有：

```text
Fatigue
Stress
Morale
Trust
Loyalty
Experience
```

### Social

Agent 有：

```text
Relationships
```

### Memory

Agent 有：

```text
Episodic Memory
Social Memory
Promise Memory
```

### Autonomy

Agent 可以：

```text
Accept
Reject
Counteroffer
Request
Invite
Rest
Quit
```

### Interaction

玩家可以：

```text
Command
Ask
Negotiate
Promise
Encourage
Override
```

### Agent-Agent

至少实现：

```text
Request Teammate
Accept / Reject
Team-up / Escort
```

### LLM

LLM：

```text
读取 Observation
→ 做高层决策
→ 输出结构化 JSON
```

### Engine

Engine：

```text
验证
执行
计算结果
更新 WorldState
```

### Feedback

最终形成：

```text
Player Action
→ Agent Decision
→ Game Result
→ Memory
→ State Change
→ Future Decision
```

---

# 61. 最终设计哲学

Frontier Command Lv3 不应该变成：

> “给每艘船加一个 GPT。”

而应该变成：

> **“给游戏中的每个关键 Operator 一个能够拥有目标、记住过去、理解关系、表达诉求并影响游戏结果的人格。”**

因此：

```text
Lv1
世界可以运行

Lv2
玩家可以管理世界

Lv3
世界中的人开始拥有自己的意志
```

最终玩家体验应该从：

```text
“我要让这艘船去哪里？”
```

变成：

```text
“我要不要让这个 Agent 去？”

“他为什么拒绝？”

“我应该给他什么条件？”

“我要不要答应他的要求？”

“我之前答应他的事情还记得吗？”

“如果我强迫他，他以后还会听我的吗？”

“我是不是应该让另一个 Agent 和他一起去？”
```

**这才是 Frontier Command 的 Lv3 Agent 核心。**

这份可以作为后续 **Claude Code / Codex 的 Agent 实现基准文档**。特别建议下一步不要直接让 Claude Code“开始写 Agent”，而是先让它拿 `Agent.md` **逐项对照当前 v10 代码，生成一份 `LV3_AGENT_IMPLEMENTATION_PLAN.md`**，明确哪些现有代码保留、修改、新增、删除；这样可以最大程度保护已经完成的 Lv1/Lv2。