# Lv3 调度器阶段规划（07-scheduler-plan）

生成日期：2026-10-08
性质：**阶段规划**。本文只规划范围，**不含实现代码**。
阶段位置：介于 `06-deepseek-runtime-status.md`（P2）与 P3 之间。P3 的状态文档将编号为 `08-*`。

**输入（逐一点名）**：

| 类别 | 文件 |
| --- | --- |
| 批准合同 | `docs/lv3/03-api-contract.md` §4.6（Scheduler）、§4.7（AgentRuntime）、§3（端口权限） |
| 批准设计 | `docs/lv3/02-decision-flow.md` §3（调度）、`02-domain-model.md` §14（触发）、`02-persistence-strategy.md` |
| 施工图 | `docs/lv3/03-implementation-plan.md` §3.2/§8、`03-test-plan.md` §6/§13、`03-file-change-plan.md` |
| 任务卡 | `docs/lv3/CODEX_TASKS.md` **P1-03 / P1-04 / P1-05**（已存在，从未执行） |
| 已知冲突 | `KNOWN_ISSUES.md` `C-11` / `C-16` / `C-17` / `C-18` / `N-1` / `N-9` |
| 事实来源 | 当前 `src/engine/**`、`electron/**` 源码（本文所有行号均为实测，非转抄） |

---

## 0. 为什么会有这个阶段

`03-implementation-plan.md` §3.2 把 **Scheduler、宿主循环接线、`AgentTrigger` 发射** 全部划归 **P1**。
但 P1 与 P2 的任务书分别明令不含调度器（P2 任务书 §25/§26/§32），两阶段都照做了，于是这部分**从未执行**。

它不是被取消的，而是**被挤掉的**：playbook 原本的 `# Prompt 6 — Scheduler + SimulationEngine + Persistence`
标题仍在，其正文被换成 P2 DeepSeek 后，那一阶段就失去了自己的 prompt，但工作量并未消失。

**后果（实测，非推测）**：

| 项 | 现状 |
| --- | --- |
| `electron/agent/scheduler.ts` | 不存在 |
| `AgentTrigger` 的**发射** | `types.ts:499` 有类型、`engine.ts:27` 有通道，但**全仓库无任何一处 push** |
| `electron/main.ts` 的 `pump()` 接线 | 无。`boundary.test.ts` 断言其不含 `from './agent'` |
| `Agent.nextDecisionAt` | 已在 v11 存档中（`schemas.ts:195`），`data.ts:228` 已按 Agent 序号错峰初始化，但**从未被读取或推进** |
| P3 的退出判据 | 依赖「Agent 在真实游戏中自行决策」，而这依赖本阶段 |

`03-implementation-plan.md` §3.4 的 P3 范围写的是 EVT-01…09 接线、Promise/Override、状态与记忆更新，
**不含**调度与发射——即 P3 是**建立在本阶段之上**写的。

---

## 1. 本阶段要回答的唯一问题

```text
什么时候该让某个 Agent 想一次？        ← 本阶段
想完之后拿这个决定做什么？              ← 见 §2（需确认）
```

**不回答**「什么才是好决定」——那是提示词与模型的职责，P2 已完成。

---

## 2. 阶段边界决策（**已决议：选项 B**，见 §13）

批准文件对「choiceId 解析 → `submitAction` 提交流程」的归属**互相矛盾**。这是本阶段唯一的开放设计问题。

| 来源 | 主张 |
| --- | --- |
| `CODEX_TASKS.md` **P1-04**「`runtime.ts` + 宿主接线」 | **属本阶段**。Goal 明写「取观察 → 评分 → LLM/mock → 校验 → **choiceId 解析 → 提交**」；验收 ① 明写「录制的决策能**真正改变引擎状态**」 |
| `03-api-contract.md` §4.7（AgentRuntime） | 变更权限「**仅经** `ControllerPort.submitAction`」——即运行时本就包含提交 |
| P2 任务书 §32 | `ControllerPort` 与 `GameAction execution` 明确列为 **P3** |
| `03-implementation-plan.md` §3.4（P3 范围） | **未提及** choiceId 解析或提交 |

三份批准文件、两种读法，不可能都对（CLAUDE.md §15：不得静默择一）。

### 选项 A —— 本阶段止于「validated decision」（不含提交）

- **范围**：调度器 + 触发发射 + 宿主接线 + `nextDecisionAt` 推进/恢复。
- **依据**：P2 任务书 §32 的字面；`§4.6` 的「变更权限：**无**」。
- **代价**：本阶段交付物**没有可见玩法**——Agent 决定了、写了轨迹、什么都没发生。
  `S-1…S-11` 全部可过，但「完成声明必须对应真实可用行为」（AGENTS.md）会被削弱。
  且 `C-17` 的指令存续检测将**没有检测对象**（只能靠测试手工造出 `ship.current` 再清掉来验）。
- **收益**：改动面最小；P3 一次性接手全部世界变更。

### 选项 B —— 本阶段一并接入 `submitAction`，闭合成环 ✅ **推荐**

- **范围**：A 的全部 **+** `choiceId` → 既有引擎侧解析 → `ControllerPort.submitAction`。
- **依据**：`P1-04` 的原文与验收标准；`§4.7` 的权限描述；P3 范围（§3.4）本就不含此项。
- **收益**：
  1. 阶段以**可观测行为**收尾：录制的决策真的改变引擎状态（P1-04 验收 ① 可执行）。
  2. `C-17` 的存续检测**有真实对象**，而非潜伏代码。
  3. P3 得以保持它被写下时的样子——9 事件 / 3 分支 / Promise-Override / 记忆闭环。
  4. **无接口风险**：`controllerPort(operatorId)` 已存在（`engine.ts:91-96`），
     `KNOWN_ISSUES.md` `C-11` 明令**不得**给端口加第三个方法，本选项不需要加。
- **代价**：世界变更与触发发射落在同一阶段。因此门禁必须包含
  `tests/architecture.test.ts:39-60` 的重放断言与全部 Lv1/Lv2 回归（§7）。

> **推荐 B**，理由是把环闭上之后这个阶段才「可验收」，且 P3 的范围无需重写。
> **若你选 A**：§5 的 `MODIFY` 表中标注 `【B】` 的三行移出本阶段、归入 P3，其余不变。

---

## 3. 本阶段范围

### 3.1 做

| # | 内容 | 依据 |
| --- | --- | --- |
| 1 | `electron/agent/scheduler.ts`：单飞、冷却、合并、每游戏分钟上限、优先级、paused/非 active 守卫、舰船忙时**延后**（N-1）、`nextDecisionAt` 推进、`C-17` 指令存续检测 | `03-api-contract.md` §4.6；`02-decision-flow.md` §3.3/§3.4 |
| 2 | `AgentTrigger` 的**发射**（8 类，见 §3.3） | `02-domain-model.md` §14；`C-16` |
| 3 | `electron/main.ts` 宿主循环接线：`advanceFrame` 之后 `try/catch` 包住 `scheduler.pump()` | `03-implementation-plan.md` §8.3；`N-9` |
| 4 | `nextDecisionAt` 的推进与读档恢复 | `02-persistence-strategy.md` §（`nextDecisionAt` ✅ 需持久化）；`S-9`/`S-10` |
| 5 | 决策结果经既有 `DecisionRuntime` 产出并（选项 B）提交 | `§4.7` |
| 6 | 测试：`tests/agent/scheduler.test.ts`（`S-1…S-11`）+ 触发射发测试 + 接线测试 | `03-test-plan.md` §6 |

### 3.2 不做（明确留给 P3）

```text
EVT-01…EVT-09 的事件接线
Agent-Agent team-up 回路
Promise / Override 两条对照路径
任务结算后的状态与记忆更新（AgentStateDelta 的落地）
「过去经历影响下一次决策」的闭环证明
Admiral UI 的任何改动
DecisionTrace 的持久化（本阶段仍只在内存中经回调产出）
```

### 3.3 触发变体的取舍（**基于实测的裁剪**）

`AgentTrigger` 有 10 个变体。逐一核实后，本阶段发射 8 个、调度器内部生成 1 个、**推迟 2 个**：

| 变体 | 发射点（实测行号） | 本阶段 |
| --- | --- | --- |
| `directive-completed` / `directive-failed` | `engine.ts:108-133` 的 `complete()`（约 45 个调用点的**唯一漏斗**） | ✅ |
| `ship-idle` | `engine.ts:113`/`:120`（无后续指令时）；`fleet.ts:148-152`（standing 路径落 idle） | ✅ |
| `world-event` | `world-events.ts:51` 创建、`:57` 定格 | ✅ |
| `danger` | `sensors.ts:118-119`（`newContact`） | ✅ |
| `admiral-message` | `command-system.ts:609`，门控 `c.from === 'admiral'` 且有目标 | ✅ |
| `agent-request` | 同处 `:609`/`:611`，门控 `c.from !== 'admiral'` 且 payload 带 `requestType` | ✅ |
| `no-decision-for` | 无引擎侧站点——**由调度器自己生成**（第二层时间节拍兜底） | ✅（调度器内） |
| `promise-changed` | **无任何站点**。`agent/promise.ts` 是纯模块且**完全未接线**：`resolveFulfillments`/`createPromise` 无引擎调用方 | ⏸ **推迟 P3** |
| `high-value-opportunity` | **无任何站点**。opportunity 是 `projection.ts:12-59` 每快照**派生**的，不存储，id 为合成值 | ⏸ **推迟 P3** |

**推迟的理由**：两者都不是「在既有分支加一行 push」，而需要**新增推导或接线逻辑**。
`promise-changed` 属于 P3 的 Promise 工作流；`high-value-opportunity` 属于 P3 的 MVP 内容（EVT-05）。
把它们塞进本阶段会扩大改动面且无法在本阶段验收。**推迟是显式决策，不是遗漏**（CLAUDE.md §9）。

---

## 4. 文件级变更计划

### 4.1 CREATE

| 文件 | 理由 |
| --- | --- |
| `electron/agent/scheduler.ts` | `03-api-contract.md` §4.6 已指定实现方即此文件；P1-03 卡 |
| `tests/agent/scheduler.test.ts` | P1-03 卡明列的测试文件；`S-1…S-11` |
| `tests/agent/triggers.test.ts` | 触发射发与「不进 `WorldState`」断言（`C-16`、`C-17`）；P1-05 卡把重放测试放在 `replay.test.ts`，但发射断言需要独立文件以免污染既有 L1/L2 断言 |
| `docs/lv3/08-scheduler-status.md` | 阶段收尾文档（编号在 P3 之前） |

### 4.2 MODIFY

| 文件 | 改动 | 选项 |
| --- | --- | --- |
| `electron/main.ts` | `setInterval` 内 `advanceFrame` 之后调用 `scheduler.pump()`，`try/catch` 包住；不得动既有 7 条 IPC 与 `saveBlocked` 块 | A+B |
| `src/engine/engine.ts` | `complete()` 内追加 push（completed/failed/idle）。**纯追加** | A+B |
| `src/engine/fleet.ts` | `advanceStanding` 落 idle 处追加 1 行 push | A+B |
| `src/engine/sensors.ts` | `updateSensors` 的 `newContact` 分支追加 1 行 push | A+B |
| `src/engine/world-events.ts` | `createEvent` 追加 1 行 push | A+B |
| `src/engine/command-system.ts` | `agentMessage` 分支（`:609` 附近）追加 push。**不改既有校验与状态变更** | A+B |
| `electron/agent/runtime.ts` | 追加「validated decision → choiceId 解析 → `controllerPort.submitAction`」；保留既有 `requestDecision` 语义与降级顺序 | **仅 B** |
| `tests/agent/boundary.test.ts` | 解除「`main.ts` 不得 import `./agent`」的断言（该断言是 P1 为「调度器属后续阶段」而设，本阶段正是其后继），改为断言**接线存在且被 `try/catch` 包住**、仍无新 IPC | A+B |

### 4.3 DO NOT MODIFY

```text
src/engine/engine.ts 的 step() / advanceFrame 控制流      ← 只允许在既有分支内追加 push
src/engine/engine.ts 的 pending / finishCritical 机制
src/engine/definitions/rules.ts 的既有键（尤其 decisionInterval = 5）
src/engine/threats.ts 的敌方 AI 节拍
src/engine/fleet.ts:50, 81-93（hasAdmiralWork 与紧急脱离分支）
src/engine/legacy-v9/**、legacy-v10/**
schemas/*.json                                            ← 已批准合同
prompts/agent/*.md                                        ← P2 刚定稿为 agent-v2
src/ui/**、electron/preload.ts、src/global.d.ts           ← 本阶段零 UI 改动
tests/architecture.test.ts:39-60                          ← 必须继续通过，不得为迁就本阶段而放宽
```

---

## 5. 契约与不变量（实现时必须守住）

| # | 不变量 | 依据 |
| --- | --- | --- |
| 1 | `pump()` **同步返回**，内部**不 `await`** | §4.6；否则阻塞 `setInterval` |
| 2 | 网络调用**绝不**出现在 `step()` 调用栈内 | CLAUDE.md §2.4 |
| 3 | `AgentTrigger` 只走瞬时 `pendingEvents`，**绝不进 `WorldState`** | `C-16`；否则破坏 `expect(a.state).toEqual(b.state)` |
| 4 | 调度器**不触碰 `WorldState`**，`promise.then` 只改自己的队列 | §4.6 |
| 5 | provider 异常**不得**把世界标记为 `saveBlocked` | `N-9` |
| 6 | 提交动作必须**显式**带 `operatorId`，**绝不**以 `commander` 身份提交 | `N-3` |
| 7 | 舰船忙（`current`/`queue`/`suspended` 非空，或存在 `source:'admiral'` 的指令）时**延后**，不重试 | `N-1`；`command-system.ts:685-688`（Admiral 优先 `:685-686`、舰船忙 `:687-688`） |
| 8 | 同一 `agentId` 同一时刻至多一个 in-flight | §3.3；切断 EVT-03 的 A↔B 循环 |
| 9 | 决策节拍按**帧**判定（`advanceFrame` 每帧跑 `speed` 次 step），不放进 step 循环 | §8.3 |
| 10 | 回归测试**只用 mock provider**，不得断言 live LLM | `02-llm-boundary.md` §8 |

**新增常量**：无。`RULES.agentDecisionInterval = 15` **已存在**（`rules.ts:7-9`），
`C-18` 要求的独立键在 P0/P1 已落地，目前全局仅 `agent/decision.ts:64` 一处读取。`rules.ts` 保持不动。

---

## 6. 任务卡

沿用 `CODEX_TASKS.md` 的 18 字段格式，此处只摘关键字段。卡号用 `SC-*`（Scheduler Card）避免与测试号 `S-*` 相撞。

### SC-1 · `scheduler.ts`（对应原卡 P1-03）

- **Files to Create**：`electron/agent/scheduler.ts`
- **Files to Modify**：无
- **Input / Output**：`pump()` 无参 + `AgentTrigger`；无返回（副作用：内部 `Map<agentId, Pending>`）
- **Acceptance**：`S-1…S-11` 全过（`03-test-plan.md` §6）；`C-17` 存续检测存在且有用例；
  `paused`/`status !== 'active'` 时零动作；低优先级触发时 provider **零调用**（spy 断言）
- **Must NOT touch**：`WorldState`、`RULES` 既有键
- **Rollback**：R3

### SC-2 · `AgentTrigger` 发射（对应原卡 P1-05 的发射部分）

- **Files to Modify**：`engine.ts`、`fleet.ts`、`sensors.ts`、`world-events.ts`、`command-system.ts`（各 1–2 行 push）
- **Acceptance**：① 完成一条指令**恰好**触发一次决策（不多不少）；② 指令被静默清除 ⇒ 合成 `directive-failed`；
  ③ `expect(a.state).toEqual(b.state)` 仍成立；④ `clock.test.ts` 既有事件断言不受影响；
  ⑤ **全部改动是追加行**——若发现必须改控制流，**停下来记录冲突**（P1-05 卡的原文要求）
- **Rollback**：R4

### SC-3 · 宿主接线（对应原卡 P1-04 的接线部分）

- **Files to Modify**：`electron/main.ts`
- **Acceptance**：`pump()` 调用被 `try/catch` 包住；不新增 IPC；不改 `saveBlocked` 块；
  provider 抛异常时世界不被标 `saveBlocked`
- **Rollback**：R3

### SC-4 · 决策提交（**仅选项 B**）

- **Files to Modify**：`electron/agent/runtime.ts`
- **Acceptance**：`intent !== 'act'` 时**不调用** `submitAction`；`act` 时经 `controllerPort(operatorId)` 提交；
  重复提交被单飞阻止；`validateAction` 拒绝时**不回退**为直接执行（Rule 3 / Rule 6）
- **Must NOT touch**：`AgentControllerPort` 的 key 集合（`C-11`）
- **Rollback**：R3

### SC-5 · 阶段文档

- **Files to Create**：`docs/lv3/08-scheduler-status.md`

### 实施进度

| 卡 | 状态 | 产物 |
| --- | --- | --- |
| SC-1 | ✅ **完成**（2026-10-08） | `electron/agent/scheduler.ts`、`tests/agent/scheduler.test.ts`（18 用例，`S-1…S-11` + `C-17` 全覆盖） |
| SC-2 | ✅ **完成**（2026-10-08） | 5 个引擎文件共 **+44 行、0 删除**（纯追加，约束 ⑤ 满足）；`tests/agent/triggers.test.ts`（10 用例） |
| SC-3 | ✅ **完成**（2026-10-08） | **新增 `electron/agent-host.ts`**（见下方偏离说明）、`main.ts` 接线、`tests/agent/host.test.ts`（14 用例） |
| SC-4 | ✅ **完成**（2026-10-08） | `runtime.ts` 的 `applyDecision` + `ActionSubmitter`、`scheduler.ts` 的 drain/提交前 stale 复核、`agent-host.ts` 绑定端口；`tests/agent/submission.test.ts`（7 用例）+ `scheduler.test.ts` 追加 2 例 |
| SC-5 | ✅ **完成**（2026-10-08） | `docs/lv3/08-scheduler-status.md` |

**SC-4 的三个设计决定**（批准文件未规定，实现时定，均可被测试固定）：

1. **`requestDecision` 与 `applyDecision` 拆成两个入口**，而不是让 `requestDecision` 顺手提交。
   P1/P2 有一条断言「问一次决策不得改动世界」（`boundary.test.ts` B-10）；把提交塞进 `requestDecision`
   会直接推翻它。拆开之后，前半段保持纯函数语义，后半段是唯一让决策变成动作的地方（§4.7）。
2. **提交走注入的 `ActionSubmitter`，而不是 `AgentControllerPort` 本身。** 端口是绑定到 operator 的，
   把它注入进来就意味着 `runtime.ts` 要写出 `submitAction` 这个名字——而 B-2 **禁止整个 agent 层**
   出现该名字。注入一个函数让**宿主**去绑定，于是 B-2 **一行都不用放宽**：
   `submitAction` / `controllerPort` 只出现在 `electron/agent-host.ts`（新增断言 B-13 固定这一点）。
3. **提交前重做 stale 复核**（§4.7 要求）。运行时只对「它拿到的那份观测」判过新旧，说不清「问」与
   「答」之间隔了多久。模型耗时以秒计，16× 下就是上百游戏分钟，超过 `STALE_TICK_LIMIT`。
   复核放在 `scheduler.drain`（那里才有当前世界时间），过期则**丢弃且不提交**。

**SC-3 的两处计划偏离（CLAUDE.md §9 要求说明）**：

1. **新增 `electron/agent-host.ts`**（§4.1 的 CREATE 表原本没有它，§4.2 只说「`main.ts` 接线」）。
   理由：适配器是**唯一**必须同时认识引擎与 Agent 层的模块，而 `electron/agent/**` 被 B-2 禁止出现
   `SimulationEngine`。把它写进 `main.ts` 会让「窗口 / IPC / 自动存档的生命周期」与「Agent 接线」混在
   一个文件里（`main.ts` 已 208 行）。放在紧邻 `electron/agent/` 之外，既保住 B-2 的规则，又把引擎依赖
   收进一个具名文件，且该文件**不 import electron**，因此可被 vitest 直接驱动（`tests/agent/host.test.ts`）。
2. **`C-30` 的处置**：新增 `agent-request` 的 `toAgentId`（见 `KNOWN_ISSUES.md` `C-30`，已决议落地）。

**SC-3 新增的接线断言**（`boundary.test.ts`）：P1 的「`main.ts` 不得 import `./agent`」断言已被本阶段
**反转**（本阶段正是它等待的后继），改为断言：接线存在、`pump()` 在**自己的** `try/catch` 内（`N-9`）、
且**从未被 `await`**（CLAUDE.md §2.4）。

SC-1 落地时新增一条**计划外的澄清**：`SchedulerWorld.agentsForTrigger` 由**适配器**实现寻址
（§13.5），因此调度器本身不含任何引擎知识；`SC-3` 需在 `main.ts` 侧把 `SimulationEngine` 适配成
`SchedulerWorld`，包括 `shipId → Agent`、`messageId → 收件人`、世界级事件广播三类寻址。

---

## 7. 测试计划与门禁

### 7.1 测试矩阵

| 来源 | 内容 |
| --- | --- |
| `03-test-plan.md` §6 | **`S-1…S-11`**（单飞、合并、低优先级零调用、每游戏分钟上限、paused、舰船忙延后、`saveBlocked` 不受污染、`pump()` 立即返回、`nextDecisionAt` 推进且持久化、读档后不同时触发、假时钟可测） |
| 新增（发射） | 每个变体「恰好一次」；`AgentTrigger` **不进 `state`**；`step()` 早退分支（`engine.ts:147`）下的行为 |
| 新增（接线） | `pump()` 不阻塞；provider 抛异常不影响 `saveBlocked`；无新 IPC |
| 新增（提交，仅 B） | 录制的决策改变引擎状态；`intent !== 'act'` 不提交；`validateAction` 拒绝时不直接执行 |
| 既有，必须继续通过 | `tests/architecture.test.ts:39-60` 重放；全部 Lv1/Lv2 回归；`tests/agent/**` 既有 402+ 用例 |

### 7.2 门禁（`03-test-plan.md` §13 的 P1 行）

```bash
git status
git diff --check
npm test          # 含 Scheduler / Boundary / 全部 Lv1-Lv2 回归
npm run build
```

`npm run test:e2e` **不跑**（§12 决议：Lv3 不新增 E2E spec；且本阶段零 UI 改动）。

---

## 8. 风险与已知坑

| # | 内容 | 处置 |
| --- | --- | --- |
| 1 | **`step()` 的早退分支**（`engine.ts:146-147`）：`newContact` 关键事件会让本 tick 跳过 `advanceShip`/`advanceEvents`，但**仍会** splice `pendingEvents`。由 `updateSensors`（`:145`）推入的 `danger` 能存活；同 tick 本应由 `advanceShip` 推入的触发则推迟到下一 tick | 属可接受延迟；**须有用例固定这一行为**，避免日后被当成 bug 误改 |
| 2 | **`C-17` 指令存续检测**：Agent 提交的指令 `source` 恒为 `'standing'`，而 `fleet.ts:50` 的 `hasAdmiralWork` 只保护 `'admiral'`；`fleet.ts:84` 会直接 `s.current = null` 转入紧急脱离，**无任何事件**。叠加单飞 + 冷却后调度器会**永久停摆** | `SC-1` 必须实现；MVP 无战斗时该分支潜伏，但代码必须在位 |
| 3 | **`C-16`**：触发**绝不能**进 `WorldState` | `SC-2` 验收 ③ 断言 `state` 相等 |
| 4 | **`C-18`**：`RULES.decisionInterval = 5` 是敌方 AI 节拍，误用会改变 Lv1/Lv2 平衡 | 用已存在的 `agentDecisionInterval = 15`；`rules.ts` 标 DO NOT MODIFY |
| 5 | **`C-11`**：不得给 `AgentControllerPort` 加第三个方法 | `SC-4` 只能经 `submitAction`；解析在引擎侧 |
| 6 | **`N-1`**：舰船忙时 `submitAction` 返回 `{ok:false}` 而非抛错，且是**静默丢弃** | 调度器**延后**而非重试，否则会空转 |
| 7 | 文档行号**已过期**（实测更正，不属冲突但会绊倒实施者）：`KNOWN_ISSUES.md` `C-17` 与 P1-03 卡引用的 `command-system.ts:557` 是 `upgrade` 任务的 `duration: 15`，**舰船忙的拒绝实际在 `:687-688`**（`:685-686` 是 Admiral 优先）；`02-persistence-strategy.md:42` 与 `agent.schema.json` 注释引用的 `types.ts:298` 是旧位置，`Enemy.nextDecision` 实际在 `types.ts:336` | 实施时按实测行号；在本阶段文档中同步更正，**不改 `KNOWN_ISSUES.md` 的历史条目内容**（只追加更正说明） |

---

## 9. 范本：既有 `Enemy.nextDecision` 模式

Agent 调度器**照搬**既有敌方 AI 的节拍范式（`02-decision-flow.md` §3.2 明写「照搬既有 `decideThreat` 的范式」）：

| 环节 | `Enemy`（既有） | `Agent`（本阶段） |
| --- | --- | --- |
| 字段 | `types.ts:336` `nextDecision` | `schemas.ts:195` `nextDecisionAt`（**已存在**） |
| 初值 | `data.ts:96` `nextDecision: 0` | `data.ts:228` `nextDecisionAt: (index + 1) * 5`（**已错峰**，为 `S-10` 备好） |
| 门控+推进 | `threats.ts:76-80`：`if (w.time < s.nextDecision) return; s.nextDecision = w.time + RULES.decisionInterval` | 同形，间隔用 `agentDecisionInterval` |
| 唤醒 | `world-events.ts:227`、`tracking.ts:163` 置 `= w.time` 强制决策 | `AgentTrigger` 即唤醒机制 |

**关键差异**：`decideThreat` 是**同步纯规则**、在 `step()` 内跑；Agent 的决策**必须**在 `step()` 之外
（`pump()` 里发起异步请求、不等待）。这是本阶段全部复杂度的来源。

---

## 10. 提交计划（CLAUDE.md §11）

```text
feat(agent): add the agent scheduler
test(agent): cover the scheduler and its boundaries
feat(agent): emit agent triggers from existing engine branches
feat(agent): wire the scheduler into the host loop
feat(agent): submit validated decisions through the controller port   ← 仅选项 B
chore(agent): document lv3 scheduler status
```

`CODEX_TASKS.md:90` 建议的 `feat(agent): integrate agent scheduler` 已被上一行的首条覆盖；
若你更希望沿用原字面，把首条替换即可。

---

## 11. 退出判据

```text
AgentTrigger 由引擎既有分支发出，且不进 WorldState                        ✅
scheduler.pump() 同步返回、不 await、不触碰 WorldState                     ✅
S-1 … S-11 全部通过（假时钟 + mock provider，不依赖 Electron）              ✅
完成一条指令 ⇒ 该 Agent 恰好被触发一次决策                                  ✅
指令被静默清除 ⇒ 合成 directive-failed，调度器不停摆                        ✅
读档后 Agent 不会同时触发决策（nextDecisionAt 随存档恢复）                   ✅
provider 异常不污染 saveBlocked，游戏不崩溃                                ✅
（选项 B）录制的决策真正改变引擎状态，且不绕过 validateAction                ✅
tests/architecture.test.ts:39-60 与全部 Lv1/Lv2 回归继续通过                ✅
npm test / npm run build 全绿；git diff --check 空                        ✅
```

**明确不在退出判据内**：任何 EVT-01…09 的游戏内可玩流程（P3）。
若选 B，本阶段的可见成果是「Agent 会在世界中自行决策并行动」——但**不含** MVP 剧情。

---

## 12. 开工前的确认项（**已决议**）

§2 的选项 A / B —— **2026-10-08 决议：选 B**（一并接入提交，闭合成环）。记录见 §13。

---

## 13. 开工决议与设计澄清（2026-10-08）

### 13.1 边界：选项 B

本阶段一并接入 `choiceId` 解析 → `ControllerPort.submitAction`。P3 保持 §3.4 的原定范围。
`SC-4` 进入施工范围。

### 13.2 澄清一：`nextDecisionAt` 是调度器**唯一**允许写的 `WorldState` 字段，且只在 `pump()` 里写

设计文档在这里互相矛盾，必须在开工前定死：

| 来源 | 原文 |
| --- | --- |
| `03-api-contract.md` §4.6 | 调度器「变更权限：**无**——只改自己的队列，**绝不触碰 `WorldState`**」 |
| `03-api-contract.md` §4.6 硬约束 | `pump()` **不 `await`** |
| `03-implementation-plan.md` §8.3 | 「promise 的 `.then` **只改调度器自己的队列**，**绝不触碰 `WorldState`**」 |
| `03-implementation-plan.md` §8.4 | 「冷却：**决策结束后** `agent.nextDecisionAt = state.time + RULES.agentDecisionInterval`」 |

§8.4 要求推进 `nextDecisionAt`，而 `Agent.nextDecisionAt` 就在 `WorldState` 里（`schemas.ts:195`）；
且 `S-9`/`S-10` 要求它被推进、被持久化、读档后恢复。四者不能同时字面成立。

**决议**：

1. `nextDecisionAt` **是调度器的记账字段**，不是物理世界状态。§4.6 的「绝不触碰 `WorldState`」
   读作「不改任何**游戏**状态」（舰船、资源、指令、决策）；在 `Agent` 记录上推进一个节拍戳，
   是为了让它随存档持久化（`02-persistence-strategy.md`：不持久化则读档后全员同时触发）。
2. **只在 `pump()` 内推进**（同步、宿主线程），**绝不**在异步 `.then` 里推进。
   这样 §8.3 的「`.then` 只改自己的队列」与 §8.4 的「决策结束后推进」同时成立：
   `.then` 把 `Pending` 标记为已解决，`pump()` 在下一帧排空它时同步推进 `nextDecisionAt`。
3. **写入范围收窄到这一个字段**：`scheduler.ts` 中除 `Agent.nextDecisionAt` 外，
   不得出现任何对 `engine.state` 的赋值。测试以静态断言固定（字段级 grep）。

### 13.3 澄清二：优先级判定 = 触发类型 + 分数档

`02-decision-flow.md` §3.4 的优先级表按**触发类型**划分，而 `Agent.md` §46 / §3.5 的 fallback 阈值按
**分数档**划分（`scoreBand` 返回 `accept` / `consult-llm` / `request` / `reject`，其中
**`consult-llm` 恰为 45–69**，即「需要判断力」的区间）。两者如何合并未规定。

**决议**——两层，先看类型，类型为低再看分数：

```text
高优先级触发类型                        → 走 LLM
低优先级触发类型 且 scoreBand === 'consult-llm' → 走 LLM
低优先级触发类型 且 其它档位             → 确定性 fallback，provider 零调用
```

- **高**：`admiral-message`、`agent-request`、`world-event`、`danger`、`directive-failed`、
  `promise-changed`、`high-value-opportunity` —— 对应 §3.4 的「新合约 / Agent 冲突 / 邀请 / 重大事件 / 承诺破裂」。
- **低**：`ship-idle`、`directive-completed`、`no-decision-for`（时间节拍兜底）。

**为什么低优先级仍要过一遍分数档**：`§3.4` 说「低优先级用确定性规则**即可**」，而 §3.5 的 45–69 档
恰恰是确定性规则**给不出安全答案**的区间（该档的 fallback 刻意落到 `wait`）。若低优先级一律不看分数，
则「一次常规指令完成后恰好进入需要判断的境地」将永远得不到 LLM 的判断。
这条规则的代价可控：绝大多数 tick 的分数不在 45–69，`S-3` 的「provider 零调用」仍然成立且可测。

### 13.4 澄清三：「不调模型」的确定性分支如何产生（**不新增第二套 fallback**）

调度器需要一条「不调模型、直接给确定性答案」的路径，但 P2 明令**禁止第二套 fallback**
（`06-deepseek-runtime-status.md` §5.1/§17）。批准文件也没说这条路径长什么样。

**决议**：给 `DecisionRuntime.requestDecision` 追加**可选参数**
`options?: { skipProvider?: boolean; reason?: string }`；`skipProvider` 时直接进入**同一个**私有
`fallBack`、调用**同一个** `fallbackDecision`。于是仍然只有一份 fallback 实现、一种 trace 形状，
且事后可区分：

| 情形 | `trace.outcome` | `trace.providerFailure` |
| --- | --- | --- |
| provider 失败后降级 | `'fallback'` | 六类错误之一 |
| **调度器判定不值得调模型**（本澄清） | `'fallback'` | **`null`** |
| 观测过期 | `'discarded'` | `'stale'` |

`fallBack` 的 `failure` 形参因此放宽为 `ModelError | ValidationError | null`——这正是
`DecisionTrace.providerFailure` 本来就允许的类型。

### 13.5 澄清四：`AgentTrigger` 不携带目标 Agent，解析放在 world 适配器

`AgentTrigger` 的变体**不足以让调度器知道该叫醒谁**（实测）：

| 变体 | 携带 | 调度器需要的 |
| --- | --- | --- |
| `ship-idle` / `directive-completed` / `directive-failed` | `shipId` | 该舰的 operator → Agent |
| `admiral-message` | `messageId` | **消息的收件人**（需查 `agentMessages`） |
| `agent-request` | `fromAgentId`（**发送方**） | **收件人**——而 §3.3 要的正是「A 请求 B ⇒ 触发 **B** 决策」，变体里根本没有 B |
| `danger` / `world-event` | `contactId` / `eventId` | 世界级事件，**影响所有 Agent** |
| `no-decision-for` | — | 调度器自己生成 |

**决议**：解析不属于调度器。world 适配器提供
`agentsForTrigger(trigger): string[]`，由**引擎侧**决定寻址（它是唯一知道 ship↔operator、
message↔收件人 的地方）；世界级变体广播给全体。调度器只消费 `agentId`，因此可用假 world 完全单测。

**未改 `AgentTrigger` 的形状**：它是 P0 已批准的类型，且改它会让 P1-05 的发射点复杂化。
`agent-request` 的收件人由适配器从消息记录里查得。若将来认为该变体应自带收件人，
需作为一次**显式的合同变更**提出（CLAUDE.md §15），不在本阶段顺手改。

### 13.6 澄清五：触发与冷却的关系

`§3.3` 写「冷却期内**不重触发**」，`§3.2` 又写触发是**第一层**机制。两者在「高优先级事件在冷却期内到达」时冲突。

**决议**：

| 情形 | 行为 |
| --- | --- |
| 低优先级触发落在冷却期内 | **合并**进一个待处理标记，冷却到期后触发一次（`S-2` 即测此） |
| 高优先级触发落在冷却期内 | **穿透冷却**触发（但不穿透单飞）——否则一次 Admiral 命令最多要等一个 `agentDecisionInterval` |
| 冷却到期且无任何触发 | 按时间节拍兜底触发一次（`§3.2` 第二层） |

高优先级穿透是 `§3.4` 优先级表能产生实际后果的前提；低优先级合并是 `S-2` 可断言的前提。
