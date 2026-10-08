# Lv3 调度器阶段实施状态（08-scheduler-status）

生成日期：2026-10-08
阶段：**P2.5 — Scheduler / 恢复被移走的阶段**（规划见 `docs/lv3/07-scheduler-plan.md`）
范围：`electron/agent/scheduler.ts`、`electron/agent-host.ts`、`electron/main.ts` 接线、
`AgentTrigger` 发射（5 个引擎文件）、`runtime.ts` 的 `applyDecision`、本阶段测试与文档
未做：P3 的 EVT-01…09 接线、Promise/Override 对照路径、状态与记忆更新、`DecisionTrace` 持久化

---

## 0. 验证记录（实际执行）

| 命令 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | **PASS**（0 error） |
| `npm test` | **PASS** — 34 files / **509 tests，508 passed + 1 skipped** |
| `npm run build` | **PASS** — exit 0 |
| `git diff --check` | **无输出** |
| Electron 无头冒烟 | **PASS** — 应用起动并持续运行；写出 v11 存档；世界 log 中**无**「Agent 运行时装配失败」⇒ 运行时装配成功 |
| `npm run test:llm` | **未运行本阶段**（P2 已实跑过；本阶段未改 provider） |
| `npm run test:e2e` | **未运行**（`03-test-plan.md` §12 决议：Lv3 不新增 E2E spec） |
| `npm run test:package` | **未运行** |

改动前实测基线：`npm test` = **29 files / 457 tests（456 passed + 1 skipped）**
—— 与 `06-deepseek-runtime-status.md` §0 一致。

**本阶段新增 52 个通过用例**（456 → 508），新增 4 个测试文件：

| 文件 | 用例 | 覆盖 |
| --- | ---: | --- |
| `tests/agent/scheduler.test.ts` | 20 | `S-1…S-11`、`C-17`、SC-4 的 apply-on-drain 与提交前 stale 复核 |
| `tests/agent/triggers.test.ts` | 10 | 5 个发射点、`C-16`（不进 `WorldState`） |
| `tests/agent/host.test.ts` | 14 | 三类寻址、读窗口、无 key 仍产生决策 |
| `tests/agent/submission.test.ts` | 7 | `applyDecision` 的提交与两类拒绝、`N-3` |
| `tests/agent/boundary.test.ts` | +1 | B-13：命令接缝只允许一个文件触碰 |

---

## 1. 本阶段建立的管线（实际可执行的）

```text
引擎既有分支 ──AgentTrigger──▶ pendingEvents（瞬时、不进 WorldState）
                                      │
宿主帧 setInterval                     ▼
  advanceFrame ─────────────────▶ AgentHost.frame(events)
                                      │  notify(triggers)   ← 按 Agent 合并为一个标记
                                      │  pump()             ← 同步、不 await
                                      ▼
                              AgentScheduler
                                 │ 排空已完成 · 判定节拍 · 单飞 · 配额 · 舰船忙则延后
                                 ▼
                        DecisionRuntime.requestDecision(observation)
                                 │ 走 LLM 或 skipProvider（确定性）
                                 ▼
                  验证后的 AgentDecision ──▶ applyDecision
                                 │ choiceId → 引擎自己构造过的 Action
                                 ▼
                  AgentControllerPort.submitAction（**Agent 自己的 operator**）
                                 ▼
                          SimulationEngine ──▶ WorldState
```

**这一节是整条 Lv3 链路第一次真正闭合**：`Agent.md` §50 的
「过去经历影响下一次决策」现在是可运行的回路，而不是设计图。

---

## 2. 实际创建的文件

| 文件 | 行数 | 职责 |
| --- | ---: | --- |
| `electron/agent/scheduler.ts` | 381 | 单飞、冷却、合并、优先级、每游戏分钟配额、舰船忙延后、`nextDecisionAt` 推进、`C-17` 存续检测、drain 时提交 |
| `electron/agent-host.ts` | 169 | **唯一**同时认识引擎与 Agent 层的模块：三类寻址 + world 适配 + 装配 |
| `tests/agent/scheduler.test.ts` | 674 | 假世界 + 假时钟驱动的 20 个用例 |
| `tests/agent/triggers.test.ts` | 210 | 发射与 `C-16` |
| `tests/agent/host.test.ts` | 201 | 适配器，用**真实** `SimulationEngine` 驱动 |
| `tests/agent/submission.test.ts` | 192 | 提交与拒绝 |
| `docs/lv3/07-scheduler-plan.md` | — | 阶段规划（先于代码） |
| `docs/lv3/08-scheduler-status.md` | 本文 | — |

---

## 3. 实际修改的文件

| 文件 | 改动 | 说明 |
| --- | --- | --- |
| `src/engine/engine.ts` | `complete()` 末尾追加 2 处 push | `directive-completed`/`directive-failed` + 无后续时的 `ship-idle` |
| `src/engine/fleet.ts` | `advanceStanding` 末尾追加 2 行 | 转入 settled 状态时发 `ship-idle`；**带迁移守卫**，否则每 tick 都发 |
| `src/engine/sensors.ts` | `newContact` 分支追加 1 处 push | `danger` |
| `src/engine/world-events.ts` | `createEvent` 追加 1 行 | `world-event` |
| `src/engine/command-system.ts` | `agentMessage` 分支追加 1 处 push | `admiral-message` / `agent-request` |
| `src/engine/agent/types.ts` | `agent-request` 追加 `toAgentId` | `C-30`，见 §5.5 |
| `electron/agent/runtime.ts` | `requestDecision` 追加可选 `skipProvider`；新增 `ActionSubmitter` / `SubmissionOutcome` / `applyDecision`；`submitter` 变为**必需**选项 | 见 §5.2/§5.3 |
| `electron/main.ts` | 装配 `AgentHost`（try/catch）；`setInterval` 内 `advanceFrame` 之后调用 `frame()`，**自己的** try/catch | 见 §5.4 |
| `tests/agent/boundary.test.ts` | B-11 的「不得接线」断言**反转**为「必须接线且被 try/catch 包住、不得 await」；新增 B-13 | 见 §5.6 |
| `tests/agent/support.ts` | `agentRuntime` 追加第 3 个参数 `submitter`；新增 `engineSubmitter` / `recordingSubmitter` | 默认提交器**拒绝提交**，使 P1/P2 的隔离断言继续成立 |
| `docs/lv3/KNOWN_ISSUES.md` | 新增 `C-29`、`C-30` | 见 §5.5 |

**引擎侧改动是纯追加**：`git diff -U0 src/engine/ | grep '^-[^-]'` 无输出，44 行插入、0 行删除。
P1-05 卡要求「若必须改控制流就停下记录冲突」——未触发。

**未修改**：`schemas/*.json`、`prompts/agent/*.md`、`src/ui/**`、`electron/preload.ts`、
`src/global.d.ts`、`electron/persistence.ts`、`src/engine/legacy-v9|v10/**`、
`tests/architecture.test.ts:39-60`（重放断言必须继续通过，未放宽）。

---

## 4. 达成的能力（对照 `03-test-plan.md` §6）

| # | 断言 | 结果 |
| --- | --- | --- |
| S-1 | 同一 Agent 同时至多一个 in-flight | ✅ |
| S-2 | 冷却期内多个触发合并为一个标记 | ✅ |
| S-3 | 低优先级触发不调 provider，直接确定性 | ✅（并额外覆盖：落在 `consult-llm` 档时**仍**走模型） |
| S-4 | 每游戏分钟最多 1 次模型调用，超出降级 | ✅ |
| S-5 | `paused` / 非 `active` 时 `pump()` 不动作 | ✅ |
| S-6 | 舰船非空闲时**延后**而非重试 | ✅ |
| S-7 | provider 异常不污染 `saveBlocked` | ✅（调度器层；`main.ts` 的 `saveBlocked` 分支未触碰） |
| S-8 | `pump()` 同步返回，provider 永不 resolve 也立即返回 | ✅ |
| S-9 | `nextDecisionAt` 按 `agentDecisionInterval` 推进，且持久化 | ✅（v11 存档中的 `Agent.nextDecisionAt`） |
| S-10 | 读档后不会全员同时触发 | ✅ |
| S-11 | 假时钟 + mock provider 可测，不依赖 Electron | ✅（并静态断言 `scheduler.ts` 不 import 引擎/electron） |
| `C-17` | 指令被静默清除 ⇒ 合成失败，Agent 不停摆 | ✅ |
| `C-16` | 触发**不进** `WorldState` | ✅（两个世界同命令驱动后逐字段相等） |

---

## 5. 实现层调整（Approved Design → Actual Implementation → Reason）

本阶段共 **8 处**批准文件未规定或自相矛盾之处，全部在规划期或实现期显式记录。
规划期的 5 处见 `07-scheduler-plan.md` §13；实现期的 3 处如下。

### 5.1 `agent-host.ts` 是计划外的文件

- **Approved**：`07-scheduler-plan.md` §4.1 的 CREATE 表只列 `scheduler.ts`，§4.2 说「`main.ts` 接线」。
- **Actual**：新增 `electron/agent-host.ts`。
- **Reason**：适配器是唯一必须同时认识引擎与 Agent 层的模块，而 `electron/agent/**` 被 B-2 禁止出现
  `SimulationEngine`；写进 `main.ts` 会把「窗口/IPC/自动存档生命周期」与「Agent 接线」混在一起
  （`main.ts` 已 208 行）。该文件**不 import electron**，因此可被 vitest 直接用真实引擎驱动。

### 5.2 `requestDecision` 与 `applyDecision` 拆成两个入口

- **Approved**：`03-api-contract.md` §4.7 只说 AgentRuntime 会「提交」，未规定入口形状。
- **Actual**：`requestDecision` 保持纯函数语义；新增 `applyDecision(observation, decision)`。
- **Reason**：P1/P2 有断言「问一次决策不得改动世界」（`boundary.test.ts` B-10）。把提交塞进
  `requestDecision` 会直接推翻它。拆开后，前半段的可测性原样保留。

### 5.3 提交经注入的 `ActionSubmitter`，`submitter` 为必需选项

- **Approved**：§4.7 写「变更权限：仅经 `ControllerPort.submitAction`」。
- **Actual**：`DecisionRuntime` 接收一个 `ActionSubmitter`（单方法），由 `agent-host.ts` 绑定端口。
- **Reason**：端口绑定到 operator，注入端口意味着 `runtime.ts` 写出 `submitAction` 这个名字，
  而 B-2 禁止**整个 agent 层**出现它。注入函数让宿主去绑定，于是 B-2 **一行都不用放宽**——
  新增断言 B-13 固定「`submitAction`/`controllerPort` 只出现在 `agent-host.ts`」。
  设为**必需**选项是为了让「决策永远不被应用」不可能因遗漏而发生；测试脚手架传一个**拒绝**的提交器，
  于是 P1/P2 的隔离断言继续成立。

### 5.4 `main.ts` 的 try/catch 是**两个**，不是共用一个

- **Approved**：`N-9` 要求 provider 异常不得污染 `saveBlocked`。
- **Actual**：`advanceFrame` 的 try/catch 原样保留（它负责把世界标为 `saveBlocked`）；
  `agentHost.frame()` 放在**紧随其后、独立**的 try/catch 里。
- **Reason**：共用一个会让「模型超时」与「时间线写入失败」走同一条 `saveBlocked = true` 分支，
  正是 `N-9` 要防的事。

### 5.5 `agent-request` 追加 `toAgentId`（`C-30`）

- **Approved**：`02-domain-model.md` §14 的类型只有 `fromAgentId`；`07-scheduler-plan.md` §13.5 曾决定不改它。
- **Actual**：追加 `toAgentId`，`command-system.ts` 发射时填 `target.id`。
- **Reason**：§3.3 要的是「A 请求 B ⇒ 触发 **B** 决策」，而收件人不在载荷里，适配器无法可靠反查。
  该类型**没有** `schemas/*.json` 对应合同，故不触碰跨工具合同；发射点本来就持有该值。
  详见 `KNOWN_ISSUES.md` `C-30`。

### 5.6 B-11 的「不得接线」断言被**反转**而非删除

- **Approved**：P1 的 `boundary.test.ts` 断言 `main.ts` 不得 import `./agent`（当时调度器属后续阶段）。
- **Actual**：改为断言接线**存在**、`pump()` 在**自己的** try/catch 内、且**从未被 `await`**。
- **Reason**：本阶段正是那条断言等待的后继。删掉它会丢掉守卫；反转它则把「不得接线」升级为
  「必须这样接线」，三条性质都被固定。

### 5.7 `no-decision-for` 变体**未被发射**（显式偏离）

- **Approved**：`02-domain-model.md` §14 列出该变体；`07-scheduler-plan.md` §3.3 写「由调度器自己生成」。
- **Actual**：**未生成**。时间节拍兜底由 `pump()` 的 `now >= nextDecisionAt` 判定直接实现，
  没有合成 `no-decision-for` 触发。
- **Reason**：该变体的语义（「某 Agent 已 N 分钟没有决策」）与 `nextDecisionAt` 判定**完全重合**，
  再合成一个触发只是把同一件事说两遍，并会让「触发 → 唤醒」这条唯一入口多出一条旁路。
- **影响**：`AgentTrigger` 联合中该成员目前**无生产者**。若 P3 需要它做可观测性（例如把
  「Agent 长时间沉默」写进日志或 UI），应在那时补上，并删掉本条。

### 5.8 `SchedulerWorld.isIdle` 把「无绑定舰船」也视为非空闲

- **Approved**：`N-1` 只描述「舰船忙时延后」。
- **Actual**：Agent 找不到所辖舰船时 `isIdle` 返回 `false`（延后），而不是 `true`。
- **Reason**：拿不到舰船就无法提交动作，此时唤醒它只会产生一个必然被拒的决策。
  延后是安全的一侧。

---

## 6. 未实现（明确不在本阶段）

| 项 | 现状 |
| --- | --- |
| EVT-01…09 的 MVP 事件接线 | **NOT CONNECTED**（P3） |
| Promise / Override 两条对照路径 | **NOT CONNECTED**（P3） |
| 任务结算后的状态与记忆更新（`AgentStateDelta` 落地） | **NOT CONNECTED**（P3） |
| `DecisionTrace` 持久化 | **NOT INTEGRATED**——轨迹仍只在内存中经回调产出 |
| `promise-changed` 触发 | **未发射**——`agent/promise.ts` 完全未接线，属 P3 的 Promise 工作流 |
| `high-value-opportunity` 触发 | **未发射**——opportunity 是每快照派生的，需新的差分逻辑，属 P3 |
| `no-decision-for` 触发 | **未发射**，见 §5.7 |
| 游戏分钟粒度的 per-Agent 熔断 | **未实现**——仍是 provider 级 wall-clock 熔断（`C-26`） |
| Admiral UI 的任何改动 | **无改动**——`preload.ts` 仍是 5 个 `invoke`，无新 IPC 通道 |

---

## 7. 推荐下一阶段

**P3 — Integration / MVP Vertical Slice**（`03-implementation-plan.md` §3.4）。本阶段已把链路打通，
P3 现在是**纯内容与闭环**工作，不再有前置缺失：

1. EVT-01…09 的接线与 `agentMessage` 互动（`agentMessage` 命令与触发均已就位）。
2. Promise / Override 两条对照路径，以及 `agent/promise.ts` 的接线（顺带可补 `promise-changed` 触发）。
3. 任务结算后的状态与记忆更新——`AgentStateDelta` 的落地。
4. 「过去经历影响下一次决策」的**游戏内**闭环证明（`02-mvp-traceability.md` §3 链路 A/B）。
5. 视需要补 `DecisionTrace` 持久化与 `no-decision-for` 触发（§5.7）。

**P3 不要重写**：`scheduler.ts` 的判定与单一写入面、`agent-host.ts` 的寻址、`runtime.ts` 的两个入口、
`applyDecision` 的 choiceId 解析方式、`src/engine/agent/decision.ts` 的两层校验、
`tests/agent/boundary.test.ts` 的 B-2/B-11/B-13 三条边界规则。

---

## 8. 已知限制

| # | 内容 | 影响 | 处置 |
| --- | --- | --- | --- |
| 1 | **游戏内从未观察到一次真实的 Agent 行动** | 无头冒烟只证明了「运行时装配成功」与「应用不崩」。存档里 `paused: true`——**载入的世界默认暂停**，调度器因此整局静默；我无法从外部解除暂停 | 本阶段的**最大**未验证项。P3 的垂直切片第一次解除暂停时才会真正跑起来；在此之前不得声称「Agent 已在游戏里行动」 |
| 2 | 触发到调度器之间有最多一帧延迟 | `step()` 才排空 `pendingEvents`；暂停时触发会累积到解除暂停 | 语义上正确（暂停时本就不该决策），但 P3 若做 UI 反馈需知道这点 |
| 3 | `main.ts` 的 `AgentHost` 装配只有一条 try/catch 兜底 | `app.getAppPath()` 指向无 `prompts/` 的目录时，游戏照跑但**永不决策**，只有一行 warning | 冒烟已验证开发态路径正确；打包态需在 `npm run package` 后复验 |
| 4 | 每帧遍历全部 Agent（4 个） | 当前规模下无影响 | `pump()` 是 O(agents)，Agent 数量上到数百时需索引化 |
| 5 | `SchedulerWorld` 是新增抽象 | 多了一层端口 | 换来的是 `scheduler.ts` 完全不认识引擎（可静态断言）与单一写入面；`03-api-contract.md` §4.6 本就要求「变更权限：无」 |
| 6 | 低优先级触发在 `consult-llm` 档仍会调用模型 | 模型调用次数高于「只按触发类型」的直觉 | 见 `07-scheduler-plan.md` §13.3；配额（每游戏分钟 1 次）是真正的成本闸门 |
