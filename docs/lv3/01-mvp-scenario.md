# Frontier Command — Lv3 Agent MVP Scenario

> Version: v1.0  
> Target: Frontier Command v10 → Lv3 Agent  
> Scenario Type: MVP Vertical Slice  
> Duration: 4 game days  
> Key Events: 9

---

# 1. Scenario Overview

## 1.1 Player

玩家身份：

> **Admiral**

玩家负责指挥舰队，并与拥有独立目标、人格、状态、记忆和关系的 Agent 协商。

玩家不是直接操作每艘飞船，而是通过任务指令和互动影响 Agent 的决策。

---

## 1.2 Main Mission

舰队收到来自虫洞另一侧的异常信号。

初步判断：

> 一艘失联探测船可能仍然存在。

Admiral 下达任务：

> **“穿越虫洞，寻找失联探测船，并确认发生了什么。”**

---

## 1.3 MVP Purpose

本场景用于验证 Lv3 Agent 的最小可玩闭环：

```text
Admiral 发布任务
    ↓
Agent 评估
    ↓
Agent 自主决策
    ↓
协商 / 请求 / 组队
    ↓
执行任务
    ↓
任务结果
    ↓
Agent 状态变化
    ↓
Memory / Relationship / Trust
    ↓
影响后续决策
```

本 MVP 不需要展示全部 Lv3 能力，但必须证明：

> **Agent 的行为不是简单执行命令，而是会受到自身目标、人格、当前状态以及过去经历影响。**

---

# 2. Player & Initial Setup

## 2.1 Start

游戏开始：

```text
Day 1
```

舰队处于正常状态。

主要任务：

```text
MISSION-WORMHOLE-001

穿越虫洞，寻找失联探测船。
```

---

## 2.2 Initial Conditions

开始时：

```text
Fleet:
正常

Ships:
可执行任务

Agents:
可用
低疲劳
正常士气

Admiral:
拥有任务发布和最终决策权
```

具体数值由当前 Frontier Command 数据模型和 Lv3 Agent Specification 决定。

---

# 3. Four Agents

本 MVP 使用四个初始 Agent。

四个 Agent 的详细 Personality、Goal、Career 定义以 `Agent.md` 为准。   

## 3.1 Explorer

定位：

> 探索 / 侦察

故事作用：

> 本次虫洞任务的主要探索者。

典型诉求：

```text
探索未知
调查异常
发现重要情报
继续深入调查
```

---

## 3.2 Tactical

定位：

> 战术 / 作战

故事作用：

> 负责探索任务的战术支援和护航。

典型诉求：

```text
保护团队
控制作战风险
获得战斗经验
```

---

## 3.3 Scientist

定位：

> 科学 / 异常研究

故事作用：

> 对虫洞另一侧发现的异常现象进行研究。

典型诉求：

```text
研究异常
获得科研数据
争取更多调查时间
```

---

## 3.4 Logistics

定位：

> 后勤 / 资源管理

故事作用：

> 监控舰队燃料、船体状态和返航余量。

典型诉求：

```text
控制风险
保证返航
减少资源浪费
避免无意义损耗
```

---

# 4. Nine Key Events

---

## EVT-01 — Admiral 发布虫洞任务

### Day 1

Admiral 收到：

```text
来自虫洞另一侧的未知信号
```

其中包含：

```text
探测船识别信息
求救片段
异常信号特征
```

Admiral 向 Explorer 发布任务：

> “穿越虫洞，寻找失联探测船。”

### Agent Response

Explorer 对任务进行自主评估。

可能结果：

```text
ACCEPT
REJECT
COUNTEROFFER
```

MVP 推荐路径：

```text
COUNTEROFFER
```

---

## EVT-02 — Explorer 反报价

### Day 1

Explorer 表示愿意执行任务，但提出条件：

> “如果要深入未知区域，我需要 Tactical 护航。”

这不是固定脚本式回答。

Explorer 的理由应该体现：

```text
个人目标
人格
风险感知
当前状态
与 Admiral 的信任
```

玩家需要决定：

```text
接受条件
继续协商
拒绝条件
```

---

## EVT-03 — Tactical 收到 Team-up Request

### Day 1

Tactical 收到 Explorer 的护航请求。

Tactical 根据自身：

```text
Goal
Personality
Fatigue
Current Assignment
Relationship
Risk
```

决定：

```text
ACCEPT
REJECT
```

MVP 推荐路径：

```text
ACCEPT
```

于是：

```text
Explorer + Tactical
        ↓
Team-up / Escort
```

该事件用于证明：

> Agent 不只是与玩家互动，也能够与另一个 Agent 产生实际的行为关系。

---

## EVT-04 — Logistics 评估任务风险

### Day 1

出发前，Logistics 对任务进行评估。

主要关注：

```text
Fuel
Hull
Expected Risk
Return Margin
```

Logistics 可以向 Admiral / 团队提出：

```text
READY
WARNING
```

例如：

> “当前资源足够完成任务，但不建议额外深入未知区域。”

此事件不需要复杂剧情。

重点是体现：

> **不同 Agent 面对同一任务，可以因为不同目标而形成不同意见。**

---

## EVT-05 — 穿越虫洞并发现异常

### Day 2

Explorer + Tactical 穿越虫洞。

完成正常游戏中的：

```text
航行
时间推进
Fuel 消耗
Ship 状态变化
```

到达目标区域后发现：

```text
Unknown Energy Signature
```

同时发现失联探测船的残骸 / 数据痕迹。

Explorer 获得新的探索机会：

> 继续调查未知异常。

Explorer 再次进行自主决策。

推荐：

```text
继续调查
```

并产生重要事件记忆：

> “我们在虫洞另一侧发现了未知异常。”

---

## EVT-06 — Agent 之间产生目标冲突

### Day 3

新的异常数据出现。

四个 Agent 对下一步产生不同意见：

```text
Explorer
→ 希望继续追踪失联探测船

Scientist
→ 希望继续研究异常现象

Tactical
→ 可以继续，但需要控制风险

Logistics
→ 建议尽快返航
```

Admiral 可以使用：

```text
ASK
NEGOTIATE
COMMAND
```

玩家此时第一次真正面对：

> **不是“哪艘船去哪里”，而是“我应该听谁的”。**

---

## EVT-07 — Admiral 选择 Promise 或 Override

### Day 3

Admiral 决定继续任务。

此时提供两种主要玩家路径。

### Path A — Promise

Admiral 向 Explorer 承诺：

> “完成这次任务后，我给你一次 Deep Scan 优先权限。”

Explorer 接受。

该 Promise 成为 Agent 后续可记忆、可验证的承诺。

---

### Path B — Override

Explorer 明确表示不愿继续。

Admiral：

> “这是命令，继续执行。”

Explorer 必须执行 Admiral 的 Override。

但是这一行为不能只是：

```text
执行 / 不执行
```

它应该对 Agent 的后续状态产生影响。

例如：

```text
Trust
Morale
Stress
Memory
```

Override 的设计必须保留 `Agent.md` 中定义的“Admiral 拥有最终权力，但强制行为会产生 Agent 关系代价”的核心体验。

---

## EVT-08 — 完成任务并返航

### Day 4

舰队最终找到：

```text
Lost Survey Vessel
```

任务完成。

任务结果由游戏引擎决定，而不是 Agent / LLM 决定。

完成任务后，相关 Agent 的：

```text
Goal Progress
Experience
Fatigue
Morale
Relationship
Trust
Memory
```

产生变化。

---

## EVT-09 — 过去经历影响下一次决策

### Day 4

任务结束后出现新的高风险调查机会。

Admiral 再次向 Explorer 提出任务。

此时测试两种历史路径。

### Path A — Promise

之前：

```text
Admiral made promise
↓
Promise fulfilled
```

Explorer 对 Admiral 的：

```text
Trust
```

应该受到正面影响。

Explorer 更可能：

```text
ACCEPT
```

---

### Path B — Override

之前：

```text
Admiral forced Explorer
↓
Memory created
```

Explorer 再次面对高风险任务时，可以：

```text
HESITATE
COUNTEROFFER
REQUEST
REJECT
```

具体结果由 Agent 的状态与决策机制决定。

本事件的核心不是固定要求某一个结果，而是证明：

```text
过去事件
    ↓
Memory
    ↓
Agent State / Trust / Relationship
    ↓
未来 Decision
```

因此：

> **同一个 Agent，因为玩家过去的行为不同，可以做出不同的未来选择。**

这是本 MVP 最重要的 Lv3 验证点之一。`Agent.md` 也明确要求 Memory 必须影响未来行为，否则 Memory 系统没有实际意义。

---

# 5. Main Branches

本 MVP 只保留三组主要分支。

## Branch A — Accept

```text
Mission
    ↓
Explorer Accept
    ↓
Team-up
    ↓
Mission Execution
```

---

## Branch B — Counteroffer

```text
Mission
    ↓
Explorer Counteroffer
    ↓
Admiral Accept
    ↓
Tactical Team-up
    ↓
Mission Execution
```

这是推荐的主要演示路径。

---

## Branch C — Override

```text
Agent Reject
    ↓
Admiral Override
    ↓
Agent continues mission
    ↓
Trust / Morale / Memory changed
    ↓
Future behavior changed
```

该分支用于体现：

> Admiral 拥有权力，但玩家的管理行为会产生长期后果。

---

# 6. MVP Definition of Done

本 MVP 完成时，玩家必须能够完成：

```text
发布虫洞任务
    ↓
Agent 自主评估
    ↓
Agent 反报价 / 接受 / 拒绝
    ↓
Agent 请求另一名 Agent
    ↓
Agent-Agent Team-up
    ↓
穿越虫洞
    ↓
发现异常
    ↓
Agent 之间产生不同意见
    ↓
Admiral 进行协商 / Promise / Override
    ↓
完成任务
    ↓
Agent 状态发生变化
    ↓
产生 Memory
    ↓
下一次任务中的 Agent 行为受到过去经历影响
```

必须能够让玩家明显观察到以下差异：

```text
不同 Agent
→ 不同目标
→ 不同意见
→ 不同决策

不同玩家行为
→ 不同 Trust / Relationship / Memory
→ 不同未来行为
```

---

# 7. Scope Boundary

本 MVP 不要求实现：

```text
复杂 Agent 社会网络
无限 NPC
复杂职业树
复杂 Agent Economy
复杂招聘系统
复杂长期 Memory Retrieval
Vector Database
LangGraph
Multi-Agent Framework
复杂情绪模拟
自然语言自动生成完整任务
完整 30 天剧情
```

这些内容不是本垂直切片的必要条件。

`Agent.md` 同样明确将复杂 Agent 社会、复杂经济、无限 NPC、Vector Database、LangGraph、复杂情绪等列为第一阶段不应优先实现的内容。

---

# 8. Relationship to Agent.md

本文件只定义：

> **Lv3 Agent 在一个具体 MVP 故事中的使用场景。**

以下内容不在本文件中重新定义：

```text
AgentState
AgentPersonality
AgentGoal
AgentMemory
AgentRelationship
AgentPromise
AgentDecision Schema
LLM Interface
Scheduler
Validator
Persistence Schema
```

上述内容以：

```text
Agent.md
```

和后续：

```text
docs/lv3/02-*.md
schemas/*.json
```

为准。

本文件的作用是为后续 Lv3 Architecture + Contract Design 提供一个具体、可验证的 Use Case。

---

# 9. Scenario Core Experience

完成本 MVP 后，玩家应该从：

> “我要让这艘船去哪里？”

转变为：

> “我要不要让这个 Agent 去？”

以及：

> “他为什么拒绝？”

> “我应该给他什么条件？”

> “我之前的决定是否影响了他现在对我的信任？”

> “我要不要让另一个 Agent 和他一起去？”

> “如果我强迫他，他以后还愿不愿意听我的？”

这就是 Frontier Command Lv3 Agent 的核心体验。