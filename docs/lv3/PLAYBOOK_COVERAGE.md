# Playbook 提示 ↔ 仓库状态 对照（PLAYBOOK_COVERAGE）

本文件记录**外部 playbook**（`CLAUDE_CODE_LV3_AGENT_PROMPT_PLAYBOOK.md`，**位于仓库之外**，
路径 `d:\qff\AI\code\jeek-tech\开发步骤5\`）的每条 Prompt 与**仓库实际状态**的对照。

用途：让下一个会话 / Codex 在读到某条 Prompt 时，**先知道它是否已经被仓库里的某个阶段覆盖**，
避免重复建设或推翻已有的边界测试。

三条约束：

1. 本文件**不是**阶段状态文档。`0N-*-status.md` 是数字与结论的事实来源，本文件不复制它们。
2. 本文件引用的 playbook 要求在下方**逐字内联**，因此**读懂本文件不需要访问那个仓库外文件**。
3. 冲突不写在这里，一律登记到 `KNOWN_ISSUES.md`（遵循该文件既有格式）。

事实来源是**源代码 + 测试**（CLAUDE.md §16）：本文件出现的每个 `file:line` 都在写入时于工作区核对过。

---

## Prompt 7 — AgentScheduler / event-driven

### 0. 结论

> **Prompt 7 第四节与第五节描述的 Scheduler，已由插入阶段 `P2.5` 完整实现并合入。**

- `07-scheduler-plan.md` 的 SC-1…SC-5 **全部 ✅**（2026-10-08）。
- `08-scheduler-status.md` 记录了构建管线、验证结果与已知限制。
- 触发到动作的整条链路已在游戏中接线（`electron/main.ts` → `agent-host.ts` → `scheduler.ts`）。

**但 playbook 自己把 Scheduler 划在 P3**：Prompt 6 §25 逐字写着「不要在 P2 实现
Scheduler …… **真正 Scheduler 在 P3。**」，Prompt 7 §二 也把 `AgentScheduler` 列为 P3 职责。
仓库的理由是它被 P1/P2 两次挤掉（见 `CLAUDE_TO_CODEX.md` §2「P2.5 为什么存在」）。

于是 **Prompt 7 §四/§五 与已完成的 P2.5 大面积重叠**，而 Prompt 7 只在阅读清单里补了 P2.5 的文档，
正文仍写着「现在实现 Prompt 2 已批准的 Scheduler」。**按 playbook 顺序施工会重复实现一个已经存在
且被边界测试锁死的调度器。** 该冲突登记为 `KNOWN_ISSUES.md` `C-31`。

### 1. 证据（Prompt 7 要求 Scheduler 负责的东西，实际在哪）

| 职责 | 实际位置 |
| --- | --- |
| 何时需要新决策 | `electron/agent/scheduler.ts`（381 行，`pump()` 判定节拍 / 优先级 / 单飞 / 配额） |
| 触发源类型 | `src/engine/agent/types.ts:114-131`（`AgentTrigger`，10 个变体） |
| 触发发射点 | `src/engine/{engine,fleet,sensors,world-events,command-system}.ts`（7 处，见 §2.3） |
| 引擎与 Agent 层的桥 | `electron/agent-host.ts`（唯一同时认识两层的模块） |
| 决策 → 动作 | `electron/agent/runtime.ts` 的 `applyDecision` → `ActionSubmitter` → `AgentControllerPort.submitAction` |
| 宿主接线 | `electron/main.ts`：`advanceFrame` 之后、**独立** try/catch 内调用 `agentHost.frame(events)` |
| 测试 | `tests/agent/scheduler.test.ts`（`S-1…S-11`、`C-17`、SC-4）、`tests/agent/triggers.test.ts`、`tests/agent/host.test.ts` |

### 2. 逐条对照

#### 2.1 §四 「Scheduler 的职责是」

> Scheduler 的职责是：
> **决定「什么时候 Agent 需要做一次新的决策」。**
>
> Scheduler 不负责：
> ```text
> Game Rule
> Combat
> Fuel
> Mission Result
> WorldState Mutation
> ```

**✅ 满足。** `scheduler.ts` 不认识 `SimulationEngine`：它只经 `SchedulerWorld`（`time` / `isPaused` /
`isActive` / `agents` / `isIdle` / `observe` / `writeBeat` …）看世界，唯一写权限是 `Agent.nextDecisionAt`。
测试 `S-11` **静态断言** `scheduler.ts` 不出现 `SimulationEngine` / `controllerPort` / `submitAction` /
`electron/`。Game Rule、Combat、Fuel、Mission Result、WorldState 的变更全部留在引擎侧。

#### 2.2 §五 「Scheduler 必须是 Event-driven」

> 不要：
> ```text
> every simulation tick
>     ↓
> call LLM
> ```
> 必须采用事件 / 决策节点触发。

**✅ 满足（且不是每 tick）。** 决策由「高优先级触发立即穿透冷却」与「`nextDecisionAt` 时间节拍兜底」
两条路径共同决定；宿主每帧调用一次 `pump()`，但 `pump()` 只在触发紧急或节拍到期时才启动决策。
`pump()` **同步、从不 await 模型**（测试 `S-8`：provider 永不 resolve 也立即返回）。

两条额外的成本闸门（超出 playbook 要求）：同一 Agent 同时至多一个 in-flight（`S-1`）、
每游戏分钟至多一次模型调用且超出即降级为确定性（`S-4`）。

#### 2.3 §五 「本 MVP 至少支持」的 11 个触发事件

> 本 MVP 至少支持：
> ```text
> Mission offered
> Task completed
> Task failed
> High-value opportunity
> Danger
> Admiral message
> Agent request
> Team-up request
> Promise fulfilled
> Promise broken
> Major event
> ```

| Playbook 要求 | 仓库承载 | 发射点 | 状态 |
| --- | --- | --- | --- |
| Task completed | `directive-completed` | `src/engine/engine.ts:141-142`（`complete()`） | ✅ |
| Task failed | `directive-failed` | `src/engine/engine.ts:141-142` | ✅ |
| Danger | `danger` | `src/engine/sensors.ts:124-127`（`newContact`） | ✅ |
| Admiral message | `admiral-message` | `src/engine/command-system.ts:617-624`（`agentMessage`，`from === 'admiral'`） | ✅ |
| Agent request | `agent-request`（含 `toAgentId`，`C-30`） | `src/engine/command-system.ts:617-624`（其余 `from`） | ✅ |
| Major event | `world-event` | `src/engine/world-events.ts:55`（`createEvent`） | ✅ |
| Team-up request | 消息 kind `team-request`，经 `agent-request` 承载 | `src/engine/agent/interactions.ts:38-47` 的 kind 枚举；触发同上 | ✅（**无独立变体**，见 §3） |
| High-value opportunity | `high-value-opportunity` | **无生产者** | ⚠️ 未实现（P3） |
| Promise fulfilled | `promise-changed` | **无生产者**（`src/engine/agent/promise.ts` 已存在但未接线） | ⚠️ 未实现（P3） |
| Promise broken | `promise-changed`（与 fulfilled **合成一个变体**） | 同上 | ⚠️ 未实现（P3） |
| Mission offered | **无任何变体** | **不存在 `directive-issued` 类触发** | ❌ 缺失，见 `C-32` |

未列在此表的第 10 个变体 `no-decision-for` 是**仓库自加**的、playbook 没有的成员；
它同样**无生产者**——时间节拍兜底由 `pump()` 的 `now >= nextDecisionAt` 直接实现
（`08-scheduler-status.md` §5.7 记录了这处显式偏离）。

#### 2.4 §六 「禁止在 `step()` 内同步调用模型」

> 不要：在 `SimulationEngine.step()` 里同步调用 `DeepSeek / HTTP / fetch / LLM`。

**✅ 满足。** 模型调用发生在 `pump()` 之外的调度器边界；`pump()` 同步返回，决策由 `DecisionRuntime`
在宿主帧内异步推进。`step()` 只负责把 `pendingEvents` 排空给宿主（`C-16`：触发**不进** `WorldState`）。

### 3. 落差清单（Prompt 7 要求 vs 仓库实际）

| # | 落差 | 性质 |
| --- | --- | --- |
| 1 | `high-value-opportunity`、`promise-changed`、`no-decision-for` 三个变体**声明了但无生产者** | 已知；`promise-changed` / `high-value-opportunity` 明确留给 P3（`08-scheduler-status.md` §6） |
| 2 | `Mission offered` **完全没有承载**：Admiral 下达指令不产生任何触发 | **新发现**，登记为 `C-32`，**需要显式设计决定**（CLAUDE.md §15） |
| 3 | playbook 的 `Team-up request` 没有独立变体，被合并进 `agent-request` | 语义上仍能叫醒收件人（`C-30` 已保证收件人在载荷里），但**触发类型上不可区分** |
| 4 | playbook 的 `Promise fulfilled` / `Promise broken` 被合并为单个 `promise-changed` | 与 `07-scheduler-plan.md` 的设计一致；两事件对 Agent 的含义不同，P3 接线时需决定是否拆分 |
| 5 | playbook 把 Scheduler 划在 P3，仓库已在 P2.5 完成 | 登记为 `C-31` |

**另需注意的最大未验证项**（来自 `08-scheduler-status.md` §8.1，非 Prompt 7 特有的落差）：
**游戏内从未观察到一次真实的 Agent 行动**——载入的世界默认 `paused: true`，调度器整局静默。
在 P3 的垂直切片第一次解除暂停之前，**不得**声称「Scheduler 已在游戏中实际驱动过 Agent」。

### 4. P3 不要重写（沿用 `08-scheduler-status.md` §7）

若后续 Prompt 要求「建立 AgentScheduler」，**不要重建**下列已被锁定的东西：

- `scheduler.ts` 的判定逻辑与**单一写入面**（只写 `Agent.nextDecisionAt`，且只在 `pump()` 里）；
- `agent-host.ts` 的三类寻址（`agentsForTrigger`）；
- `runtime.ts` 的两个入口划分（`requestDecision` 纯 / `applyDecision` 提交）；
- `applyDecision` 的 `choiceId` 解析方式；
- `src/engine/agent/decision.ts` 的两层校验；
- `tests/agent/boundary.test.ts` 的 `B-2`（agent 层不得出现引擎名）、`B-11`（只有 `openai-compatible.ts`
  可联网）、`B-13`（命令接缝只允许 `agent-host.ts`）。

P3 的正确起点是**内容与闭环**，不是调度器：见 `CODEX_TASKS.md` 的 `P3-01…P3-09`。
