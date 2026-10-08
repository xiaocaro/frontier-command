# Claude → Codex 交接（CLAUDE_TO_CODEX）

生成日期：2026-10-08
阶段：Prompt 3（Implementation Plan + Codex Handoff）
上一提交：`a089d95 feat(agent): define lv3 agent contracts`

---

## 1. 一句话现状

**Lv3 的架构、合同、Schema 与实施计划已全部就绪；Lv3 的业务代码一行都还没写。**
本仓库当前是一个**完整可运行的 Lv1/Lv2 游戏**（存档 v10，184 个单测通过），Lv3 的全部产物是
**文档 + JSON Schema**。

---

## 2. 已实现的内容（分阶段）

| 阶段 | 提交 | 产物 |
| --- | --- | --- |
| Prompt 0 侦察 | `aa87bd3` | `docs/lv3/00-baseline-audit.md`、`00-baseline.md`、`00-code-map.md`、`00-test-baseline.md` |
| Prompt 1 反构 | `15909bd` | `01-lv1-lv2-architecture.md`、`01-runtime-call-graph.md`、`01-state-and-command-map.md`、`01-agent-gap-analysis.md` |
| Prompt 1+2 规格 | `0505438` | `Agent.md`（产品规格）、`docs/lv3/01-mvp-scenario.md`（MVP 场景） |
| Prompt 2 架构与合同 | `a089d95` | `docs/lv3/02-architecture.md`、`02-domain-model.md`、`02-decision-flow.md`、`02-llm-boundary.md`、`02-persistence-strategy.md`、`02-mvp-traceability.md` + `schemas/*.json`（7 个） |
| **Prompt 3 实施计划（本次）** | 本次提交 | `docs/lv3/03-implementation-plan.md`、`03-file-change-plan.md`、`03-api-contract.md`、`03-test-plan.md`、`CODEX_TASKS.md`、`CLAUDE_TO_CODEX.md`、`KNOWN_ISSUES.md` |

**重要**：`docs/lv3/` 与 `schemas/` 是**唯一**存在的 Lv3 产物。
`src/engine/agent/`、`electron/agent/`、`prompts/` 三个目录**都不存在**。

---

## 3. 本次改动（Prompt 3）

**代码改动：无。** 本阶段是 docs-only。

新增 7 个文件（全部在 `docs/lv3/`）：见上表最后一行。
未修改任何 `src/`、`electron/`、`tests/`、`schemas/`、配置文件。

---

## 4. 引入的合同

本阶段**没有新增**业务合同（那已在 Prompt 2 完成）。本阶段**定稿**了 Prompt 2 显式留给 Prompt 3 的决策：

| 决策 | 定稿 | 位置 |
| --- | --- | --- |
| Agent ↔ Operator 关联 | `Operator.agentId?: string`（显式字段） | `03-implementation-plan.md` §4.1 |
| choiceId 解析位置 | Agent 层（`availableActions.find(...)`），**不扩展 port** | `03-implementation-plan.md` §4.2 |
| AgentObservation 通路 | **加宽唯一那条观察通路**，无 Agent 的 operator 返回 `null` | `03-implementation-plan.md` §4.3 |
| `AgentMessage.payload` | 必填但可 `null`（跟随已提交 JSON Schema） | `03-implementation-plan.md` §4.4 |
| `agentMessage` 命令 | 追加式新命令 + 精确权限放宽 | `03-implementation-plan.md` §4.5 |
| Override 路径 | 既有 `issueDirective` + `agentMessage{kind:'override'}` 两条命令 | `03-implementation-plan.md` §4.6 |
| 非 `act` 意图路由 | `act` 才走 `submitAction`，其余走互动层 | `03-implementation-plan.md` §4.7、`03-api-contract.md` §3 |
| choiceId 表 | 含 `team-accept:`/`team-decline:` | `03-implementation-plan.md` §5 |

**已批准的既有合同（不得重写）**：`schemas/*.json` 的 7 个 schema、`02-*.md` 的 ADR-1…5 与 Rule 1–8 的落地约束。

---

## 5. 测试现状（本阶段实测）

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `npm test` | ✅ **PASS** | 13 test files / **184 tests** 通过（vitest 4.1.11，5.4s） |
| `git diff --check` | ✅ 无输出 | 无空白错误 |
| `npm run build` | ✅ **PASS** | `create-icon.mjs` → `tsc --noEmit` → `vite build` → `tsc -p tsconfig.electron.json` |
| `npm run test:e2e` | ⏭ **NOT RUN** | docs-only 阶段；且运行时约 15 分钟并含 **2 项既存非引擎失败**（`mine-accidents.spec.ts:48` Windows 文件锁 flaky；`:130` 超时 15.000s vs 需求约 15.38s）。**未运行，不得视为通过** |

**没有 Lv3 的测试**——不存在 Lv3 代码，所以无法有。

**运行 E2E 的两个坑**（记录以免重踩）：

```bash
# 1. shell 中若存在 ELECTRON_RUN_AS_NODE=1，全部 36 项 E2E 会以 bad option 失败
env -u ELECTRON_RUN_AS_NODE npm run test:e2e

# 2. 不要把输出管道给 tail —— 会吞掉真实退出码
```

---

## 6. Codex 不得重写的东西（红线）

| 对象 | 原因 |
| --- | --- |
| `src/engine/legacy-v9/**` | 冻结契约（`docs/architecture.md:185`），且 `saves.ts:3` **活依赖**它 |
| `src/engine/v9-schema.ts` | **被活 `save-schema.ts` 与冻结 `legacy-v9/save-schema.ts:8` 共用**；改动会同时污染两条契约 |
| `src/engine/commands.ts` 的 `careerSchema`（`:79-86`） | 是 **Personnel** 的 6 值枚举，与 `AgentCareer` 无关（`KNOWN_ISSUES.md` `C-8`）。Agent 用新的 `agentCareerSchema` |
| `SimulationEngine.step()` / `advanceFrame` 的控制流 | 确定性；`tests/architecture.test.ts:39-60` 的同 seed 重放断言 |
| `AgentControllerPort` 的 key 集合 | 恰好 `['getObservation','submitAction']`；`tests/architecture.test.ts:13` 断言（`C-11`） |
| `schemas/*.json` | 已批准的跨工具合同（CLAUDE.md §6）。**唯一**相关取舍是 `payload` 必填可空——改 Zod，不改 schema（`C-20`） |
| `src/ui/**`（含 `StrategicMap.tsx`、`PersonnelView.tsx`、`lcars/**`） | CLAUDE.md §3 保护区域。Agent 发言经既有 `Communication` 流显示，**零 UI 改动** |
| `electron/preload.ts`、`src/global.d.ts` | Lv3 **不新增 IPC 通道**，不让 Renderer 直连 provider |
| `src/engine/fleet.ts` 的 `hasAdmiralWork` / 紧急脱离分支 | Lv1/Lv2 行为；`C-17` 是**计划级兼容**（调度器做存续检测），不是改它 |
| `src/engine/projection.ts` 的 `snapshot()` 裁剪逻辑 | 被 `recon.test.ts` 与 `architecture.test.ts:85-102` 锁定 |
| `src/engine/definitions/rules.ts` 的既有键（尤其 `decisionInterval`） | 改 `decisionInterval` 会改变**敌方 AI** 行为（`C-18`）。Agent 用新键 `agentDecisionInterval` |
| `docs/lv3/00-*.md`、`01-*.md`、`02-*.md` | 已批准的历史阶段产物。冲突只登记在 `KNOWN_ISSUES.md`，**不静默修改** |
| `src/engine/definitions/{factions,resources}.ts` | 死代码（零 import），不要在其上构建 |

---

## 7. 剩余工作

全部剩余工作已拆成 **34 张任务卡**，见 `CODEX_TASKS.md`。

```text
P0  Domain Foundation（16 卡，不依赖 LLM）      ← 从这里开始
P1  Mock LLM（5 卡，仍不依赖网络）
P2  Live DeepSeek Runtime（4 卡）
P3  MVP Vertical Slice（9 卡，覆盖 EVT-01…EVT-09）
```

**推荐的第一张卡**：`P0-01` 冻结 v10 存档 schema。

⚠️ `P0-02 → P0-03 → P0-04` 必须作为**一个连贯增量**：P0-02 把类型升到 v11 而 schema 尚未升级时，
`npm test` 会**预期失败**；三张卡全部落地后再一次性跑测试。

---

## 8. 已知限制

| # | 限制 | 影响 |
| --- | --- | --- |
| 1 | **无燃料系统** | EVT-04 的 Logistics 用「弹药 + 船体 + 路径预估」复合战备度替代（CONFLICT-1）。**不要新增燃料**——那会引入 Lv1/Lv2 从未有过且需重新平衡的经济系统 |
| 2 | **Agent 只能在舰船完全空闲时提交动作** | `command-system.ts:557-558`。EVT-03/05/08 各是一次独立决策周期，依赖 `directive-completed` 重新触发（`N-1`） |
| 3 | **Agent 指令可被静默清除** | Agent 指令 `source` 恒为 `'standing'`（`command-system.ts:393`），`fleet.ts:81-91` 的紧急脱离会直接 `s.current = null` 且无事件。调度器**必须**做存续检测（`C-17`），否则 Agent 永久停摆 |
| 4 | **无 JSON Schema 运行时校验器** | `ajv@8.20.0` 仅作为 `app-builder-lib` 的传递依赖存在，**不得依赖**。用零依赖结构测试比对（`C-25`/`C-16`） |
| 5 | **提示词未进打包** | `package.json` 的 `build.files` 不含 `prompts/**`，必须追加（`C-14`），否则打包后读不到 |
| 6 | **Live LLM 不可重放** | 只有 Engine 重放与 mock provider 可重放。**不得声称**「同样输入 LLM 必得同样输出」（`02-llm-boundary.md` §8） |
| 7 | **`restorePreviousDay` 会回滚 Agent 的 trust/memory** | 这是既有机制的自然结果，**MVP 接受**，不是 bug（`02-persistence-strategy.md` §6） |
| 8 | **E2E 有 2 项既存非引擎失败** | 非本次引入，勿误判（见 §5） |
| 9 | **Agent 与既有 `Personnel` 是两套并行系统** | `Personnel`（`types.ts:99-110`，UI 页 `PERSONNEL`）是船员/技能/岗位系统，Lv3 Agent 与之无关。绑定的想法属 POST-MVP（`C-9`） |
| 10 | **ENCOURAGE 与 Quit 延后** | MVP 事件中无对应场合。但 **Lv3 完整交付前须补齐 ENCOURAGE**（`Agent.md` §60 的 DoD 含六类互动） |

---

## 9. 从仓库理解一切（不依赖聊天记录）

本阶段结束后，**仓库是唯一事实来源**。按下列顺序阅读即可获得完整图景：

```text
1. CLAUDE.md / AGENTS.md                    项目规则与红线
2. docs/lv3/00-baseline.md                  当前代码基线
3. docs/lv3/01-lv1-lv2-architecture.md      Lv1/Lv2 架构
4. docs/lv3/01-mvp-scenario.md              Lv3 的 MVP 故事（EVT-01…09）
5. docs/lv3/02-architecture.md              批准的 Lv3 架构（目录、ADR、边界）
6. docs/lv3/02-domain-model.md              逐字段领域模型
7. docs/lv3/02-decision-flow.md             调度与决策
8. docs/lv3/02-llm-boundary.md              LLM 边界
9. docs/lv3/02-persistence-strategy.md      持久化
10. docs/lv3/02-mvp-traceability.md         需求追溯 + CONFLICT-1…7
11. schemas/*.json                          机器可读合同
12. docs/lv3/03-implementation-plan.md      ★ 实施计划（含本阶段定稿的 10 项决策）
13. docs/lv3/03-file-change-plan.md         ★ 改哪些文件、怎么改、不许改哪些
14. docs/lv3/03-api-contract.md             ★ 模块间合同与状态变更权限
15. docs/lv3/03-test-plan.md                ★ 测试矩阵
16. docs/lv3/KNOWN_ISSUES.md                ★ 冲突登记（C-1…C-25）+ 实施陷阱（N-1…N-9）
17. docs/lv3/CODEX_TASKS.md                 ★ 34 张任务卡（从这里开始干活）
18. docs/lv3/CLAUDE_TO_CODEX.md             本文件
```

**事实来源优先级**（冲突时按此判定，CLAUDE.md §15/§16）：

```text
当前行为      → 源代码 + 测试
Lv3 目标架构  → docs/lv3/（02-* 是设计，03-* 是施工图）
机器可读合同  → schemas/*.json
Claude 工作流 → CLAUDE.md
仓库级指令    → AGENTS.md
```

**若发现任何不一致**：不要静默选一个。先记录 `Conflict / Current Code / Approved Design / Impact /
Proposed Resolution`，追加到 `docs/lv3/KNOWN_ISSUES.md`。

---

## 10. 下一张卡

```text
P0-01 · 冻结 v10 存档 schema
  Files to Create : src/engine/legacy-v10/save-schema.ts
  Dependencies    : 无（必须是 P0 的第一张）
  Done When       : 文件存在；npx tsc --noEmit 与 npm test 全绿；git diff --check 空
```

完整 18 字段定义见 `docs/lv3/CODEX_TASKS.md` 的 P0-01 卡。
