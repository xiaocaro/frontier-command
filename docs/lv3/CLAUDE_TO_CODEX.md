# Claude → Codex 交接（CLAUDE_TO_CODEX）

最后更新：2026-10-08，于提交 `c82e009`
阶段：**P0 / P1 / P2 / P2.5 已实现并合入；P3 已实现主体，剩 E2E 与 EVT-04**

> 本次修订（P3）：追加 `09-game-integration-status.md` 与 `KNOWN_ISSUES.md` 的 `C-33`/`C-34`。
> §5 的实测数字**未重新测量**，仍是提交 `c82e009` 的结果；P3 的实测数字在 `09-*` §0。

> **先读这一份，再决定读什么。** 本文只讲「现在是什么状态」与「下一步做什么」。
> 每个阶段的细节在各自的 `0N-*-status.md` 里，那是**数字与结论的事实来源**；本文出现的
> 测试数、提交号一律**自带时间戳**（见 §5），若与状态文档冲突，以状态文档为准。

---

## 1. 一句话现状

**Lv3 的整条链路已经打通并在游戏中接线**：

```text
引擎既有分支 → AgentTrigger → 宿主帧 → Scheduler → DecisionRuntime
             → 验证后的 AgentDecision → applyDecision → ControllerPort → SimulationEngine
```

`Agent.md` §50 的「过去经历影响下一次决策」现在是**可运行的回路**，不再是设计图。
存档 **v11**，Lv1/Lv2 行为未改（重放断言 `tests/architecture.test.ts:39-60` 继续通过）。

**尚未做的**：MVP 剧情本身（EVT-01…EVT-09 的接线、Promise/Override 对照路径、结算后的状态与
记忆更新、游戏内闭环证明）。这是 P3 的全部内容。

**最大的一条未验证项**：**游戏内从未观察到一次真实的 Agent 行动**。载入的世界默认 `paused`，
所以整局调度器静默；无头冒烟只证明了「运行时能装配、应用不崩」（见 `08-scheduler-status.md` §8.1）。

---

## 2. 已实现的内容（分阶段）

| 阶段 | 内容 | 状态文档 |
| --- | --- | --- |
| Prompt 0–3 | 侦察 / 反构 / 架构与合同 / 施工图（纯文档 + `schemas/*.json`） | `00-*` … `03-*` |
| **P0** Domain Foundation | `src/engine/agent/**`（13 个纯领域模块）、存档 v11 + 链式迁移、4 名初始 Agent、`agentMessage` 命令 | `04-foundation-status.md` |
| **P1** Mock Decision Runtime | `electron/agent/{model-client,mock-client,prompt,runtime}.ts`、`prompts/agent/*.md`、录制 fixture | `05-mock-runtime-status.md` |
| **P2** Live DeepSeek Runtime | `electron/agent/openai-compatible.ts`（超时/重试/熔断/JSON 提取/结构化输出） | `06-deepseek-runtime-status.md` |
| **P2.5** Scheduler（插入阶段） | `electron/agent/scheduler.ts`、`electron/agent-host.ts`、`AgentTrigger` 发射、`main.ts` 接线、`runtime.applyDecision` | `07-scheduler-plan.md`、`08-scheduler-status.md` |
| **P3** Game Integration | `agentEvent` 结算接缝（`commands.ts`/`command-system.ts`/`agent/events.ts`）、`agent/events.ts` 规划器、`agent/dialogue.ts`（回复 + offer 分档）、记忆正负号、offer 消费与优先、REFIT/异常发射点 | `09-game-integration-status.md` |

> **P2.5 为什么存在**：`03-implementation-plan.md` §3.2 把 Scheduler 划归 P1，但 P1 与 P2 的任务书
> 都明令不含它，于是被两次跳过。它不是被取消，而是被挤掉的。规划见 `07-scheduler-plan.md`。

> **若你在按外部 playbook 逐条施工**：先读 `PLAYBOOK_COVERAGE.md`。playbook 自己把 Scheduler 划在
> **P3**（Prompt 6 §25），所以它的 **Prompt 7** 里 §四/§五 的调度器部分与已完成的 P2.5 **重叠**，
> **已满足，不要重建**（`KNOWN_ISSUES.md` `C-31`）。
>
> 但 Prompt 7 **不只是调度器**——它的标题是 `P3 Game Integration + MVP Vertical Slice`，
> 主体（§二十一 EVT-01…09、§二十五 UI/IPC、§二十九–§三十二 测试与 E2E、§三十三 DoD）**是 P3 的工作**，
> 由 `CODEX_TASKS.md` 的 `P3-01…P3-09` 承担，状态见 `09-game-integration-status.md`。
> 其中 §三十一 的 E2E 与仓库 `03-test-plan.md` §12 的既有决议冲突，已由用户裁决为**全量范围**并登记；
> §二十五 的 UI/IPC 则**无需**新通道（§二十五 自带豁免条款，见 `PLAYBOOK_COVERAGE.md` §3.2）。

**真实端点已实测**：`npm run test:llm` 对 `https://api.deepseek.com` 实跑通过，
并因此发现并修复了一个真实缺陷（`KNOWN_ISSUES.md` `C-29`：提示词把 `act` 解释成「菜单里的任一动作」，
与校验器冲突，导致模型的第一次回答被拒）。

---

## 3. 当前实际存在的目录

```text
src/engine/agent/     13 个纯领域模块（types/schemas/personality/goals/state/memory/
                      relationship/promise/score/actions/observation/decision/interactions）
electron/agent/       model-client、mock-client、prompt、runtime、scheduler、openai-compatible
electron/agent-host.ts  唯一同时认识引擎与 Agent 层的模块（寻址 + world 适配 + 装配）
electron/main.ts      宿主循环接线：advanceFrame 之后 agentHost.frame(events)（独立 try/catch）
prompts/agent/        system / decision / conversation / reflection，prompt_version = agent-v2
schemas/*.json        7 个跨工具合同（**未因 Lv3 实现而改动**）
tests/agent/          21 个测试文件 + fixtures/ 录制库
```

---

## 4. Lv3 引入的合同（实现期定稿）

| 合同 | 位置 | 说明 |
| --- | --- | --- |
| `AgentDecision` | `schemas/agent-decision.schema.json` + `src/engine/agent/schemas.ts` | 模型输出契约。`strict()`，多一个字段即作废 |
| `ModelClient` / `DecisionRequest` / `ModelResult` / `ModelError`（六类） | `electron/agent/model-client.ts` | provider 边界。**不得重写**；DeepSeek 只是第二个实现 |
| `AgentTrigger`（10 变体） | `src/engine/agent/types.ts` | 决策触发源。**不进 `WorldState`**，只走瞬时 `pendingEvents` |
| `SchedulerWorld` | `electron/agent/scheduler.ts` | 调度器看世界的唯一窗口；唯一写权限是 `writeBeat` |
| `ActionSubmitter` / `SubmissionOutcome` | `electron/agent/runtime.ts` | 决策变成动作的唯一通道。经**注入**而非 import 端口 |
| `DecisionTrace` / `LlmAttemptTrace` | `runtime.ts` / `openai-compatible.ts` | 决策级与尝试级轨迹（**尚未持久化**） |
| 提示词版本 `agent-v2` | `AGENT_PROMPT_VERSION` + `prompts/agent/*.md` | 改提示词措辞**必须**同步 bump |

**已批准的既有合同（不得重写）**：`schemas/*.json` 的 7 个 schema、`02-*.md` 的 ADR-1…5 与 Rule 1–8。

---

## 5. 测试现状（**自带时间戳**，勿当作长期数字）

于提交 `c82e009` 实测：

| 命令 | 结果 |
| --- | --- |
| `npm test` | ✅ **PASS** — 34 files / **508 passed + 1 skipped**（skipped 是 `live-deepseek.test.ts`，无 key 时 `describe.skip`） |
| `npm run build` | ✅ **PASS** — exit 0 |
| `git diff --check` | ✅ 无输出 |
| `npm run test:llm` | 需 `DEEPSEEK_API_KEY`；P2 已实跑通过（4/4）。**默认套件不依赖它** |
| `npm run test:e2e` | ⏭ **未运行**——`03-test-plan.md` §12 决议：Lv3 不新增 E2E spec；且有 2 项既有非引擎失败 |

**数字会变。** 要看最新实测，读各阶段状态文档的 §0 验证记录。

**运行 E2E 的两个坑**（免得重踩）：

```bash
# 1. shell 中若存在 ELECTRON_RUN_AS_NODE=1，全部 E2E 会以 bad option 失败
env -u ELECTRON_RUN_AS_NODE npm run test:e2e

# 2. 不要把输出管道给 tail —— 会吞掉真实退出码
```

---

## 6. 不得重写的东西（红线）

**Lv1/Lv2 侧**

| 对象 | 原因 |
| --- | --- |
| `src/engine/legacy-v9/**` | 冻结契约，且 `saves.ts` **活依赖**它 |
| `src/engine/v9-schema.ts` | 被活 `save-schema.ts` 与冻结 `legacy-v9/save-schema.ts` 共用 |
| `src/engine/commands.ts` 的 `careerSchema` | 是 **Personnel** 的枚举，与 `AgentCareer` 无关（`C-8`） |
| `SimulationEngine.step()` / `advanceFrame` 的控制流 | 确定性；同 seed 重放断言锁定。**只允许在既有分支内追加行** |
| `src/engine/fleet.ts` 的 `hasAdmiralWork` / 紧急脱离分支 | `C-17` 是**计划级兼容**（调度器做存续检测），不是改它 |
| `src/engine/projection.ts` 的 `snapshot()` 裁剪 | 被 `recon.test.ts` 与 `architecture.test.ts` 锁定 |
| `src/engine/definitions/rules.ts` 的既有键（尤其 `decisionInterval`） | 改它会改变**敌方 AI** 行为（`C-18`）。Agent 用 `agentDecisionInterval` |
| `src/ui/**`、`electron/preload.ts`、`src/global.d.ts` | Lv3 **零 UI 改动、零新 IPC**。Agent 发言经既有 `Communication` 流显示 |
| `src/engine/definitions/{factions,resources}.ts` | 死代码（零 import），不要在其上构建 |

**Lv3 侧（本阶段新增的红线）**

| 对象 | 原因 |
| --- | --- |
| `electron/agent/model-client.ts` 的契约 | provider 边界；P2 只允许**追加可选** `model?` |
| `src/engine/agent/decision.ts` 的两层校验 | `validateDecisionShape`（结构+归属+可达）与 `validateDecision`（+stale）。`act` + 社交选项**必须**被拒 |
| `AgentControllerPort` 的 key 集合 | 恰好 `['getObservation','submitAction']`（`C-11`）。**不得**加第三个方法 |
| `scheduler.ts` 的**单一写入面** | 只允许写 `Agent.nextDecisionAt`，且只在 `pump()` 里写（`07-scheduler-plan.md` §13.2） |
| `runtime.ts` 的两个入口划分 | `requestDecision` 保持纯、`applyDecision` 才提交。合并会推翻 B-10 的隔离断言 |
| `boundary.test.ts` 的 B-2 / B-11 / B-13 | B-2：agent 层不得出现引擎名；B-11：只有 `openai-compatible.ts` 可联网；B-13：命令接缝只允许 `agent-host.ts` |
| `docs/lv3/00-*` … `09-*`、`CODEX_TASKS.md` | 状态与计划文档。冲突只登记在 `KNOWN_ISSUES.md`，**不静默修改**（`C-34` 即一例：P3 卡片的 "Files to Modify" 指错了文件，未就地改写） |

---

## 7. 剩余工作

**P3 主体已完成**，剩两项——详见 `09-game-integration-status.md` §6。

```text
P0  Domain Foundation      16 卡   ✅ 已完成（04-foundation-status.md）
P1  Mock LLM                5 卡   ✅ 已完成（05-mock-runtime-status.md）
P2  Live DeepSeek Runtime   4 卡   ✅ 已完成（06-deepseek-runtime-status.md）
P2.5 Scheduler             5 卡   ✅ 已完成（07-scheduler-plan.md / 08-scheduler-status.md）
P3  MVP Vertical Slice      9 卡   🟡 EVT-01/02/03/07/08/09 PASS；EVT-04 未实现
                                      E2E spec 已通过（09-game-integration-status.md）
```

剩余：

1. **跑一次全套 E2E**——新增 spec 已单独通过（5.6s），但没和既有的 8 个 spec 一起跑过。
   期望 `34+1 / 2`（那 2 项是 `mine-accidents` 的既存失败，不是回归）。
2. **EVT-04**（`readiness.ts`）——先要决定战备结论挂在什么上；offer 没有结构化目标，见 `09-*` §6.1。
3. **`03-test-plan.md` §12** 的"不新增 E2E"决议与 `CODEX_TASKS.md` 的 P3 卡片文件清单（`C-34`）
   都是**红线文档上的既有错误**，只登记未就地改写——需要在红线上做一次显式决定。

P3 的硬约束（`CODEX_TASKS.md` P3 段开头已写明）：每张卡**只用既有 `Action`**
（`ESCORT`/`TRANSIT`/`SURVEY`/`RETURN`），**不得新增物理行为**（ADR-3）；
全部验证用 `tests/agent/vertical-slice.test.ts` + mock provider（**不得**依赖 live LLM 做回归断言）。

`08-scheduler-status.md` §6 列了 P2.5 **明确未做**的清单（`promise-changed` /
`high-value-opportunity` / `no-decision-for` 触发、`DecisionTrace` 持久化）。P3 **没有**补触发变体
（`C-32` 已裁决：`Mission offered` 由 `admiral-message` 承载），`DecisionTrace` 持久化仍未做。

---

## 8. 已知限制

| # | 限制 | 影响 |
| --- | --- | --- |
| 1 | **游戏内从未观察到真实 Agent 行动** | 载入世界默认 `paused`，调度器整局静默。P3 的垂直切片第一次解除暂停才真正验证。**在此之前不得声称「Agent 已在游戏里行动」** |
| 2 | **无燃料系统** | EVT-04 用「弹药 + 船体 + 路径预估」复合战备度替代（CONFLICT-1）。**不要新增燃料** |
| 3 | **Agent 只能在舰船完全空闲时提交动作** | `command-system.ts`。EVT-03/05/08 各是一次独立决策周期，依赖 `directive-completed` 重新触发（`N-1`） |
| 4 | **Agent 指令可被静默清除** | `fleet.ts` 的紧急脱离直接 `s.current = null` 且无事件。调度器**已实现**存续检测（`C-17`，`scheduler.test.ts` 覆盖）——不要移除 |
| 5 | **无 JSON Schema 运行时校验器** | `ajv` 仅作为传递依赖存在，**不得依赖**。运行时权威是 Zod（`C-25`） |
| 6 | **Live LLM 不可重放** | 回归测试**只用 mock provider**。**不得声称**「同样输入 LLM 必得同样输出」（`02-llm-boundary.md` §8） |
| 7 | **`restorePreviousDay` 会回滚 Agent 的 trust/memory** | 既有机制的自然结果，**MVP 接受**，不是 bug |
| 8 | **Agent 与既有 `Personnel` 是两套并行系统** | `Personnel` 是船员/技能/岗位系统，与 Lv3 Agent 无关（`C-9`） |
| 9 | **ENCOURAGE 与 Quit 延后** | 完整交付前须补齐 ENCOURAGE（`Agent.md` §60 的 DoD 含六类互动） |
| 10 | **`no-decision-for` 触发无生产者** | 时间节拍兜底由 `pump()` 直接实现，未合成该触发（`08-scheduler-status.md` §5.7） |
| 11 | **触发到调度器最多一帧延迟** | `step()` 才排空 `pendingEvents`；暂停时触发会累积到解除暂停 |

---

## 9. 从仓库理解一切（不依赖聊天记录）

```text
1. CLAUDE.md / AGENTS.md                    项目规则与红线
2. docs/lv3/CLAUDE_TO_CODEX.md              本文件（现状 + 下一步）
3. docs/lv3/CODEX_TASKS.md                  ★ P3-01…P3-09（从这里开始干活）
4. docs/lv3/01-mvp-scenario.md              MVP 故事（EVT-01…09）
5. docs/lv3/02-mvp-traceability.md          ★ 链路 A/B 的验收依据
6. docs/lv3/02-architecture.md              批准的 Lv3 架构（目录、ADR、边界）
7. docs/lv3/02-domain-model.md              逐字段领域模型
8. docs/lv3/02-decision-flow.md             调度与决策
9. docs/lv3/02-llm-boundary.md              LLM 边界
10. docs/lv3/02-persistence-strategy.md     持久化
11. docs/lv3/03-api-contract.md             ★ 模块间合同与状态变更权限
12. docs/lv3/03-test-plan.md                ★ 测试矩阵
13. docs/lv3/04-* … 08-*-status.md          ★ 各阶段实测状态（数字的事实来源）
14. docs/lv3/KNOWN_ISSUES.md                ★ 冲突登记（C-1…C-34）+ 实施陷阱（N-1…N-9）
15. docs/lv3/PLAYBOOK_COVERAGE.md           ★ 外部 playbook 提示 ↔ 仓库状态对照（按 Prompt 查，避免重做）
16. docs/lv3/09-game-integration-status.md  ★ P3 实测状态 + EVT-01…09 逐条结论
17. schemas/*.json                          机器可读合同
```

**事实来源优先级**（冲突时按此判定，CLAUDE.md §15/§16）：

```text
当前行为      → 源代码 + 测试
Lv3 目标架构  → docs/lv3/（02-* 设计，03-* 施工图，04-*…08-* 实测状态）
机器可读合同  → schemas/*.json
Claude 工作流 → CLAUDE.md
仓库级指令    → AGENTS.md
```

**若发现任何不一致**：不要静默选一个。先记录 `Conflict / Current Code / Approved Design / Impact /
Proposed Resolution`，追加到 `docs/lv3/KNOWN_ISSUES.md`。

---

## 10. 下一张卡

```text
P3-09 收口 · EVT-04 readiness（09-game-integration-status.md §6.1）
  Files to Create : src/engine/agent/readiness.ts（**先做设计决定**：战备结论挂在什么上）
  Files to Modify : 取决于决定——候选的 `requirements`？offer 的分档？
  Dependencies    : P3 主体（已完成）
  Why blocked     : offer 没有**结构化目标**（目标只出现在自由文本里），"这趟够不够"缺一个可判定的输入
  Done When       : 设计决定记录在 docs/lv3/，且 readiness 是**有生产调用者**的（不是又一个死函数）
```

E2E 已完成；若要继续加固，跑一遍全套 `env -u ELECTRON_RUN_AS_NODE npm run test:e2e` 即可。
完整背景见 `09-game-integration-status.md`。
