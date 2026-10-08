# Lv3 Codex 任务卡（CODEX_TASKS）

生成日期：2026-10-08
阶段：Prompt 3（Implementation Plan + Codex Handoff）
性质：可直接执行的施工任务清单。

---

## 0. 使用说明

**每张卡都满足**：Codex 在新的 context 中，**只读取项目文件 + 该卡**，就能理解要做什么——
不依赖 Claude 的聊天上下文。

**执行前必读（每张卡都适用）**：

```text
CLAUDE.md          项目规则（架构边界、测试、git、范围）
AGENTS.md          仓库级 Agent 指令
docs/lv3/02-*.md   批准的架构与合同（不要重新设计）
docs/lv3/03-*.md   本阶段的实施计划 / 文件计划 / API 契约 / 测试计划
docs/lv3/KNOWN_ISSUES.md   冲突登记（C-1…C-25 必须遵守其 Resolution）
schemas/*.json     机器可读合同
```

**全局红线（任何任务都不得违反）**：

1. 不得让 LLM / Agent 直接修改 `WorldState`（只经 `Command` / `submitAction`）。
2. 不得在 `SimulationEngine.step()` 调用栈内做网络调用或 `await`。
3. 不得新建第二套运行时校验架构（Zod 是运行时权威，JSON Schema 是跨工具合同）。
4. 不得让 `src/**` import `electron/agent/**`。
5. 不得改动 `src/engine/legacy-v9/**`、`src/engine/v9-schema.ts`、`schemas/*.json`、
   `src/ui/**`、`src/engine/commands.ts` 的 `careerSchema`。
6. 不得使用 `any`（`tsconfig` 严格）。
7. 不得宣称未实际执行的测试通过。
8. 不得只做一个 `Implement Lv3 Agent` 的大提交——每次一个小语义提交。

**每个任务收尾必须**：

```bash
git status
git diff --check
npm test
git add -A && git commit -m "<语义化信息>"
```

---

## 1. 推荐顺序与 Rollback Point

```text
P0-01 ─▶ P0-02 ─▶ P0-03 ─▶ P0-04 ─▶ P0-05 ─▶ P0-06 ─▶ P0-07 ─▶ P0-08
                                                              │
                        P0-16 ◀─ P0-15 ◀─ P0-14 ◀─ P0-13 ◀─ P0-12 ◀─ P0-11 ◀─ P0-10 ◀─ P0-09
                          │
                        【P0 测试门禁：npm test 全绿】   ◀── Rollback R1 / R2
                          ▼
        P1-01 ─▶ P1-02 ─▶ P1-03 ─▶ P1-04 ─▶ P1-05
                          │
                        【P1 测试门禁】                  ◀── Rollback R3 / R4
                          ▼
        P2-01 ─▶ P2-02 ─▶ P2-03 ─▶ P2-04
                          │
                        【P2 测试门禁】                  ◀── Rollback R5 / R6
                          ▼
        P3-01 ─▶ P3-02 ─▶ P3-03 ─▶ P3-04 ─▶ P3-05 ─▶ P3-06 ─▶ P3-07 ─▶ P3-08 ─▶ P3-09
                          │
                        【Vertical Slice + 完整测试】    ◀── Rollback R7（逐卡可退）
```

| Rollback | 位置 | 回退动作 |
| --- | --- | --- |
| **R1** | P0-01…P0-04 后（存档主干） | **最高风险点。** `git revert` 该批；`legacy-v10/` 为纯新增文件，删除即可 |
| R2 | P0 全部后 | revert P0-05…P0-16 |
| R3 | P1-01…P1-04 后 | 删除 `electron/agent/**`、`prompts/**`、`package.json` 的 `files` 追加；`src/` 不受影响 |
| R4 | P1-05 后 | revert 触发发射 |
| R5 | P2-01…P2-03 后 | 删除 `openai-compatible.ts`；无 key 时本就退化为确定性 |
| R6 | P2-04 后 | revert provider 测试 |
| R7 | P3 每卡 | 每 EVT 一张卡，逐卡可回退 |

**建议提交信息**（CLAUDE.md §11 的模式）：

```text
feat(agent): freeze v10 save schema and add agent domain types
feat(agent): upgrade world state to v11 with agent persistence
feat(agent): add agent domain foundation
feat(agent): add agent observation and available actions
feat(agent): add agent message command
feat(agent): bootstrap initial agent roster
feat(agent): add llm decision runtime with mock provider
feat(agent): integrate agent scheduler
feat(agent): add deepseek provider
feat(agent): complete lv3 vertical slice
chore(agent): prepare codex handoff
```

---

# P0 — Domain Foundation（不依赖真实 LLM）

## P0-01 · 冻结 v10 存档 schema

- **Task ID**：P0-01
- **Title**：冻结 v10 存档 schema
- **Goal**：创建 `src/engine/legacy-v10/save-schema.ts`，作为今日 v10 存档契约的**字节忠实副本**，供后续 `migrateV10` 校验旧文件。
- **Why**：`worldSchema` 是 `ZodEffects`（`.strict().superRefine`，`save-schema.ts:131,420-741`），**无法 `.omit()` 派生**成 v10 版本（`KNOWN_ISSUES.md` `C-24`）。必须在修改活 schema **之前**复制。
- **MVP Event**：无（基础设施，EVT-01…09 全部依赖）
- **Read First**：`src/engine/save-schema.ts` 全文；`src/engine/legacy-v9/save-schema.ts` 前 30 行（照抄其写法）；`docs/lv3/02-persistence-strategy.md` §1/§4.4
- **Files to Create**：`src/engine/legacy-v10/save-schema.ts`
- **Files to Modify**：无
- **Files That Must NOT Be Modified**：`src/engine/save-schema.ts`（本卡不动它）、`src/engine/legacy-v9/**`、`src/engine/v9-schema.ts`
- **Dependencies**：无（**本卡必须是 P0 的第一张**）
- **Input / Output**：Input = 今日 `save-schema.ts` 的内容；Output = `export const worldSchema as legacyV10Schema`
- **API Contract**：导出名 `worldSchema`（与 `legacy-v9/save-schema.ts` 的命名风格一致）
- **Schema**：保留 `version: z.literal(10)`、`operator.kind: z.literal('rules')`，**不含** `agentId` 与 `agents`/`agentMessages`/`agentInteractions`
- **Acceptance Criteria**：① 新文件与今日 `save-schema.ts` 语义等价（字面量为 10）；② `npx tsc --noEmit` 通过；③ `npm test` 仍 184 通过
- **Tests**：`tests/agent/migration.test.ts`（本卡先建骨架）断言用一个 v10 形状对象过 `legacyV10Schema.parse` 成功
- **Expected Result**：`legacyV10Schema` 可校验 v10 存档；此后修改活 schema 不再影响旧存档校验
- **Rollback Point**：R1（删除该文件即可，零影响）
- **Done When**：文件存在、`tsc --noEmit` 与 `npm test` 全绿、`git diff --check` 空

## P0-02 · Agent 领域类型 + `WorldState` v11 形状

- **Task ID**：P0-02
- **Title**：Agent 领域类型与 v11 类型层
- **Goal**：在 `src/engine/types.ts` 定义全部 Agent 领域类型；把 `Operator` 扩为联合并加 `agentId?`；把 `WorldState`/`SnapshotData` 升到 11 并加三个集合；把 `ObservationData` 加宽为 `AgentObservation` 形状；`Command` 加 `agentMessage`；`SimulationEvent` 加 `AgentTrigger` 变体。
- **Why**：所有下游任务的类型基础；`Agent` 是 `WorldState` 的成员，类型层与 schema 层必须同步移动。
- **MVP Event**：EVT-01…09（全部）
- **Read First**：`src/engine/types.ts` 全文（重点 `:210-240` `Action`、`:382-392` `Operator`/`Assignment`、`:448-460` `SimulationEvent`、`:474-522` `WorldState`、`:530-576` `SnapshotData`、`:643-665` `Observation`/`AgentControllerPort`）；`schemas/*.json`（7 个）；`docs/lv3/02-domain-model.md` 全文；`docs/lv3/03-implementation-plan.md` §4.1/§4.3
- **Files to Create**：`src/engine/agent/types.ts`（领域类型；`types.ts` 只放与 `WorldState` 耦合的部分）
- **Files to Modify**：`src/engine/types.ts`
- **Files That Must NOT Be Modified**：`src/engine/legacy-v9/**`、`src/engine/v9-schema.ts`、`src/engine/commands.ts` 的 `careerSchema`、`schemas/*.json`
- **Dependencies**：P0-01
- **Input / Output**：Input = `schemas/*.json` + `02-domain-model.md`；Output = 可被 `tsc` 检查的类型集合
- **API Contract**：`AgentControllerPort.getObservation(): AgentObservation | null`——**key 集合不变**（`03-api-contract.md` §4.1）
- **Schema**：`Agent`/`AgentPersonality`/`AgentState`/`AgentGoal`/`GoalKind`/`AgentCareer`/`AgentMemory`(3 类)/`MemoryTag`/`AgentRelationship`/`AgentPromise`/`PromiseFulfillment`/`AgentActionCandidate`/`AgentDecision`/`AgentIntent`/`AgentRequest`/`AgentMessage`/`AgentMessageKind`/`MessagePayload`/`AgentInteraction`/`InteractionKind`/`AgentStateDelta`/`AgentTrigger`/`AgentObservation`
- **Acceptance Criteria**：① 全部类型与 `schemas/*.json` 字段一一对应；② **`AgentMessage` 必须在此卡完成定义**——P0-12 的 `AgentObservation.pendingMessages` 依赖它，若把消息类型留到 P0-14 才建，P0-12 就没有可用的依赖（**任务顺序约束，非代码冲突**）；③ `legalActions` 从 `ObservationData` 移除；④ `npx tsc --noEmit` 通过
- **Tests**：类型层无运行时断言；由 P0-03 起的测试间接覆盖
- **Expected Result**：`tsc --noEmit` 通过；`WorldState.version: 11`
- **Rollback Point**：R1
- **Done When**：`npx tsc --noEmit` 通过（`npm test` 此时**预期失败**——schema 尚未升级；因此本卡与 P0-03/P0-04 应在同一批内完成后再跑测试）

> ⚠️ 本卡单独落地会打破 `npm test`（schema 仍为 v10 而类型已是 v11）。**P0-02 → P0-03 → P0-04 应作为一个连贯增量**，在 P0-04 结束时一次性跑测试。

## P0-03 · Agent Zod 合同 + schema 一致性测试

- **Task ID**：P0-03
- **Title**：Agent Zod 运行时合同与 JSON Schema 一致性
- **Goal**：创建 `src/engine/agent/schemas.ts`（Agent 领域的 Zod 合同，类型由 `z.infer` 派生）与 `tests/agent/schemas.test.ts`（零依赖结构比对）。
- **Why**：CLAUDE.md §6 要求运行时校验由既有 TypeScript/Zod 层实现；`schemas/*.json` 不被任何代码 import，漂移不可见（`C-16`）。
- **MVP Event**：全部（决策与消息的合法性）
- **Read First**：`schemas/*.json`（7 个，逐字段）；`src/engine/commands.ts`（`actionSchema` 的判别式集合）；`docs/lv3/03-test-plan.md` §10
- **Files to Create**：`src/engine/agent/schemas.ts`、`tests/agent/schemas.test.ts`
- **Files to Modify**：无
- **Files That Must NOT Be Modified**：`schemas/*.json`、`src/engine/commands.ts` 的 `careerSchema`（**必须新建 `agentCareerSchema`**，见 `C-8`）
- **Dependencies**：P0-02
- **Input / Output**：Input = `schemas/*.json`；Output = Zod schema 对象
- **API Contract**：导出 `agentSchema`、`agentDecisionSchema`、`agentMemorySchema`、`agentRelationshipSchema`、`agentPromiseSchema`、`agentMessageSchema`、`agentActionCandidateSchema`、`agentCareerSchema`
- **Schema**：`agentMessage.payload` = **必填但可 `null`**（跟随已提交 schema，而非 `02-domain-model.md` §12 的 `payload?:`，见 `C-20`）
- **Acceptance Criteria**：① 七个 schema 与 `schemas/*.json` 的 `required`/`enum`/数值范围/`maxItems`/`additionalProperties:false` 一致；② `memories.maxItems === 40`、`promises.maxItems === 20`；③ 合法 fixture 被接受、非法 fixture 被拒；④ `agentCareerSchema` = `['explorer','scientist','tactical','logistics']`
- **Tests**：`tests/agent/schemas.test.ts`（零依赖，读 JSON 断言结构 + Zod 接受/拒绝 fixture）
- **Expected Result**：`npm test` 中该文件通过
- **Rollback Point**：R1
- **Done When**：一致性测试通过；无 `ajv` 依赖被引入

## P0-04 · v11 持久化主干 + 迁移链

- **Task ID**：P0-04
- **Title**：存档升级到 v11 与链式迁移
- **Goal**：把活 `worldSchema` 升到 v11 并加三个集合；新增 `migrateV10`；修正 `migrateV9`；更新 `parseSave` 闸门；把 `SaveStore` 的硬编码 v10 字面量与链式 `migrateTimeline` 一并更新；**同时**修正 8 处测试字面量。
- **Why**：这是唯一能破坏 Lv1/Lv2 存档的改动，必须早做且隔离。**`migrateV9` 必须改**——否则所有 v9 存档立刻无法迁移（`C-14`）。
- **MVP Event**：EVT-09（跨天/跨存档保留 Memory/Promise/Trust）
- **Read First**：`src/engine/save-schema.ts`（重点 `:133` version、`:158` operator、`:421-741` superRefine、`:459-460` 全局 id、`:733-740` 编号正则）；`src/engine/saves.ts` 全文（56 行）；`electron/persistence.ts` 全文（261 行）；`tests/v10.test.ts:357-395`；`docs/lv3/03-implementation-plan.md` §7；`KNOWN_ISSUES.md` `C-12`–`C-15`
- **Files to Create**：`tests/agent/migration.test.ts`
- **Files to Modify**：`src/engine/save-schema.ts`、`src/engine/saves.ts`、`src/engine/data.ts`（仅 `version: 10`→`11`）、`electron/persistence.ts`、`tests/architecture.test.ts:105`、`tests/persistence.test.ts:108`、`tests/mine-accidents.test.ts:186`、`tests/v10.test.ts:371,385,390`、`tests/e2e/desktop.spec.ts:174,239`
- **Files That Must NOT Be Modified**：`src/engine/legacy-v9/**`、`src/engine/v9-schema.ts`（**被活 schema 与冻结 v9 共用**）、`schemas/*.json`、`src/ui/**`
- **Dependencies**：P0-01、P0-03
- **Input / Output**：Input = v9/v10/v11 存档；Output = 迁移后的 v11 `WorldState`
- **API Contract**：`parseSave(input)`：`9 → migrateV9`、`10 → migrateV10`、`!== 11 → throw UnsupportedSaveVersionError`
- **Schema**：`agents`（`.max`）、`agentMessages`（`.max(200)`）、`agentInteractions`（`.max(200)`）；`operator.kind: z.enum(['rules','agent'])` + 可选 `agentId`；superRefine 加新 id 唯一性 + `agent` 前缀 + `agentId` 指向校验
- **Acceptance Criteria**：① `tests/agent/migration.test.ts` 覆盖 v10→v11、v9→v11 链、round-trip、未知版本（5/6/7/8/12）抛错；② **`migrateV9` 在 v11 生效后仍能把 v9 迁到 v10 中间态**（专门守护 `C-14`）；③ v10 索引存在时**也**触发迁移（守护 `C-15`）；④ `npm test` 全 184 + 新增 全绿
- **Tests**：见测试计划 P-1…P-12；既有 13 个文件的 8 处字面量按 §8.2 调整
- **Expected Result**：`npm test` 全绿；`frontiers-v11` 与 `timeline-v11.json` 生效
- **Rollback Point**：**R1（最高风险点）**
- **Done When**：`npm test` 全绿；`npm run build` 通过；v10 存档可迁、v9 存档可迁、旧文件未被改写

## P0-05 · `personality.ts` + `goals.ts`

- **Task ID**：P0-05
- **Title**：人格与目标
- **Goal**：实现五维人格与四名初始 Agent 的取值；实现 `AgentGoal`/`GoalKind`、`GoalAlignment` 计算与 `goalProgress` 增减规则。
- **Why**：`Agent.md` §3 要求「同一任务交给不同 Agent 有不同反应」；人格是 DecisionScore 的输入。
- **MVP Event**：EVT-01（个体差异）、EVT-05/06（目标）、EVT-09（Goal Progress 影响再决策）
- **Read First**：`docs/lv3/02-domain-model.md` §2/§4；`docs/lv3/02-decision-flow.md` §4；`Agent.md` §5/§6/§7/§48
- **Files to Create**：`src/engine/agent/personality.ts`、`src/engine/agent/goals.ts`
- **Files to Modify**：无
- **Files That Must NOT Be Modified**：`src/engine/commands.ts` 的 `careerSchema`
- **Dependencies**：P0-03
- **Input / Output**：Input = Agent 人格/目标 + 候选的 `goalKinds`；Output = 钳制后的数值 / 对齐度
- **API Contract**：纯函数，无 I/O，无 `Date`，无 `Math.random`（`03-api-contract.md` §4.3）
- **Schema**：`agent.schema.json` 的 `$defs.personality`、`$defs.goal`
- **Acceptance Criteria**：① 五维钳制 `[0,100]`；② 四名初始 Agent 取值符合 §2 表（Explorer 75/90/55/55/70；Scientist 50/75/55/55/70；Tactical 70/25/85/80/70；Logistics 25/25/85/80/50）；③ `goalProgress` 按 §48（+10/+15/+30/0）；④ 纯函数
- **Tests**：`tests/agent/domain.test.ts` D-1、D-2
- **Expected Result**：领域测试通过
- **Rollback Point**：R2
- **Done When**：测试通过；无 `any`

## P0-06 · `state.ts`

- **Task ID**：P0-06
- **Title**：Agent 可变状态与更新规则
- **Goal**：实现 `AgentState` 的确定性更新：fatigue 分档与任务增减、Override 代价、Promise 兑现/打破、任务成功/失败、休息。
- **Why**：`Agent.md` §20 要求 Trust/Loyalty/Morale/Fatigue 分开；§59 要求 Override → trust 变化可稳定断言。
- **MVP Event**：EVT-01/02（疲劳影响接受）、EVT-04、EVT-07B（Override）、EVT-08
- **Read First**：`docs/lv3/02-decision-flow.md` §5；`Agent.md` §19/§20/§21/§42
- **Files to Create**：`src/engine/agent/state.ts`
- **Files to Modify**：无
- **Files That Must NOT Be Modified**：`src/engine/engine.ts` 的 `step()`/`advanceFrame`
- **Dependencies**：P0-03
- **Input / Output**：Input = `AgentState` + 事件 + 增量；Output = 新的 `AgentState`（不可变返回）
- **API Contract**：纯函数；所有结果钳制 `[0,100]`；同时返回 `AgentStateDelta` 供 `AgentInteraction.effects` 使用
- **Schema**：`agent.schema.json` 的 `$defs.state`
- **Acceptance Criteria**：① Override 精确 `trust−10 / morale−5 / stress+10`；② fatigue 分档边界 39/40/69/70/84/85；③ 任务 +10/+15/失败 +15/休息 −20；④ Promise 兑现/打破的增减方向正确；⑤ 全部钳制；⑥ Trust 与 Loyalty 独立
- **Tests**：`tests/agent/domain.test.ts` D-3…D-9
- **Expected Result**：领域测试通过
- **Rollback Point**：R2
- **Done When**：测试通过

## P0-07 · `memory.ts`

- **Task ID**：P0-07
- **Title**：有界记忆与确定性检索
- **Goal**：实现三类记忆（episodic/social/promise）、上限 40、按 `weight` 升序的**确定性**淘汰、按 `tags` + `weight` 的确定性检索。
- **Why**：`Agent.md` §50 要求记忆影响未来行为；§52 排除复杂检索；存档上限 32MB 要求有界。
- **MVP Event**：EVT-05（发现异常）、EVT-07（Override/Promise 写入）、**EVT-09（Memory → Decision 闭环）**
- **Read First**：`docs/lv3/02-domain-model.md` §5；`docs/lv3/02-persistence-strategy.md` §3；`Agent.md` §15–§18/§50/§52
- **Files to Create**：`src/engine/agent/memory.ts`
- **Files to Modify**：无
- **Files That Must NOT Be Modified**：`electron/persistence.ts`
- **Dependencies**：P0-03
- **Input / Output**：Input = 记忆列表 + 新记忆 + 检索标签；Output = 新的有界列表 / 排序后的记忆
- **API Contract**：纯函数；淘汰必须确定性（否则破坏 `tests/architecture.test.ts:39-60`）
- **Schema**：`agent-memory.schema.json`；`MemoryTag` 10 值枚举
- **Acceptance Criteria**：① 第 41 条写入时按 `weight` 升序淘汰恰好 1 条；② 同一序列两次运行结果深度相等；③ 检索顺序确定；④ **记忆 `text` 由引擎结算生成，不得取自 LLM 的 `reason`**；⑤ 常量 `MEMORY_CAP = 40` 可被引用
- **Tests**：`tests/agent/domain.test.ts` D-11…D-14
- **Expected Result**：领域测试通过；淘汰确定性断言通过
- **Rollback Point**：R2
- **Done When**：测试通过

## P0-08 · `relationship.ts`

- **Task ID**：P0-08
- **Title**：Agent 间关系
- **Goal**：实现 `AgentRelationship` 的读取与更新（team-up 成功双向增益、冲突下降），并支持对称更新辅助。
- **Why**：`Agent.md` §13/§14 要求关系影响组队倾向；§43 是 MVP 唯一的 Agent-Agent 互动。
- **MVP Event**：EVT-03（Tactical 是否护航）、EVT-06（分歧）、EVT-08（关系变化）
- **Read First**：`docs/lv3/02-domain-model.md` §6；`Agent.md` §13/§14/§43
- **Files to Create**：`src/engine/agent/relationship.ts`
- **Files to Modify**：无
- **Files That Must NOT Be Modified**：无
- **Dependencies**：P0-03
- **Input / Output**：Input = 关系列表 + 互动结果；Output = 更新的关系
- **API Contract**：纯函数；对称更新必须在一次调用中同时改双方，避免「A 改了 B 没改」
- **Schema**：`agent-relationship.schema.json`（`value ∈ [-100,100]`，`trust`/`cooperation ∈ [0,100]`，`targetAgentId !== self`）
- **Acceptance Criteria**：① 范围钳制；② team-up 成功双方 `value ↑`、`cooperation ↑`；③ 不得产生指向自身的关系
- **Tests**：`tests/agent/domain.test.ts` D-10
- **Expected Result**：领域测试通过
- **Rollback Point**：R2
- **Done When**：测试通过

## P0-09 · `promise.ts`

- **Task ID**：P0-09
- **Title**：承诺与兑现判定
- **Goal**：实现 `AgentPromise` 的创建、`fulfills` 匹配、状态流转（`pending → fulfilled/broken`）与 `resolvedAt` 写入；上限 20 的确定性淘汰。
- **Why**：`Agent.md` §18 的 `status` 需要有人置位；不定义「什么算兑现」，`status` 会永远停在 `pending`，§19 的 trust 增减无法触发——而 §19 正是 EVT-07/EVT-09 的核心验证点。
- **MVP Event**：EVT-07 Path A、**EVT-09 Path A**
- **Read First**：`docs/lv3/02-domain-model.md` §7；`docs/lv3/02-mvp-traceability.md` §3 链路 A；`Agent.md` §18/§19
- **Files to Create**：`src/engine/agent/promise.ts`
- **Files to Modify**：无
- **Files That Must NOT Be Modified**：`src/engine/execution.ts:676` 的既有 `REFIT` 装入逻辑、`src/engine/command-system.ts:132` 的 `REFIT` 校验（本卡只**读取**其效果来判定兑现，不修改它们）
- **Dependencies**：P0-03
- **Input / Output**：Input = Promise 列表 + 世界状态变化（如某舰装上了 `deepScan`）；Output = 更新后的 Promise 列表 + 状态增量
- **API Contract**：纯函数 + 一个「给定世界变化，返回应结算的 promiseId 列表」的判定函数
- **Schema**：`agent-promise.schema.json`（`from` 恒为 `'admiral'`；`fulfills` 四种 kind；`resolvedAt` 为 number|null）
- **Acceptance Criteria**：① `grant-module/deepScan` 在既有 `REFIT` 装入 `deepScan` 后被置 `fulfilled`；② `pending → broken` 可触发；③ 上限 20 的淘汰只保留 `pending` + 最近 N 条已解决；④ 复用既有工业/改装命令判定，**不新增兑现机制**
- **Tests**：`tests/agent/domain.test.ts` D-15、D-16
- **Expected Result**：领域测试通过
- **Rollback Point**：R2
- **Done When**：测试通过

## P0-10 · `score.ts`

- **Task ID**：P0-10
- **Title**：确定性 DecisionScore
- **Goal**：实现 `Agent.md` §46 的加权公式（九项 + 追加的 `RecentMemoryScore`）与四档阈值。
- **Why**：`Agent.md` §46 要求确定性评分作为优先级判定与 LLM 不可用时的 fallback；**LLM 不计算此分数**。
- **MVP Event**：EVT-01/02/06/07/09（是否值得走 LLM、以及 fallback 结果）
- **Read First**：`docs/lv3/02-decision-flow.md` §4/§3.5；`Agent.md` §46
- **Files to Create**：`src/engine/agent/score.ts`
- **Files to Modify**：无
- **Files That Must NOT Be Modified**：无
- **Dependencies**：P0-05、P0-06、P0-07、P0-08
- **Input / Output**：Input = `AgentObservation` + `Agent`；Output = `{ score: number; fallback: AgentDecision }`
- **API Contract**：**纯函数**，无 I/O，无时钟，无随机（`03-api-contract.md` §4.3）
- **Schema**：无（派生，不持久化）
- **Acceptance Criteria**：① 十项权重与 `02-decision-flow.md` §4 一致；② 阈值 `>=70` / `45-69` / `25-44` / `<25`；③ 档边界精确（69/70、44/45、24/25）；④ `RecentMemoryScore` 使匹配 tag 的记忆产生正贡献；⑤ 同输入两次调用结果相同
- **Tests**：`tests/agent/domain.test.ts` DEC-1…DEC-3
- **Expected Result**：领域测试通过
- **Rollback Point**：R2
- **Done When**：测试通过

## P0-11 · `actions.ts` 与 choiceId 定稿

- **Task ID**：P0-11
- **Title**：候选动作生成与 choiceId
- **Goal**：由世界状态推导 `AgentActionCandidate[]`，实现 `03-implementation-plan.md` §5 的 choiceId 表，并保证生成期合法性与跨 tick 稳定性。
- **Why**：`Agent.md` §27/§28——LLM 只回 `choiceId`，引擎侧据此取出**已构造好的既有 `Action`**，从而消除参数幻觉、非法目标与越权。这是防幻觉机制，不可省。
- **MVP Event**：EVT-01/03/05/06（具体动作选择）
- **Read First**：`docs/lv3/02-domain-model.md` §10；`docs/lv3/03-implementation-plan.md` §5；`src/engine/types.ts:210-240`（`Action` 联合）；`src/engine/projection.ts:10-58`（`opportunities`）；`src/engine/command-system.ts:34-148`（`validateAction`）；`src/engine/navigation.ts`（`routeEstimate`）
- **Files to Create**：`src/engine/agent/actions.ts`
- **Files to Modify**：无
- **Files That Must NOT Be Modified**：`src/engine/types.ts` 的 `Action` 联合（**Lv3 不新增物理行为**，ADR-3）、`src/engine/projection.ts` 的 `opportunities()`、`src/engine/execution.ts` 的分发表
- **Dependencies**：P0-03、P0-05
- **Input / Output**：Input = `WorldState`（只读）+ Agent；Output = `AgentActionCandidate[]`
- **API Contract**：纯函数；`id` 生成**确定性且跨 tick 稳定**（固定迭代顺序或排序）
- **Schema**：`agent-action-candidate.schema.json`；`requirements` 仅供提示词参考，**不作合法性判据**
- **Acceptance Criteria**：① 生成的每个候选都能通过 `actionSchema.parse`；② 生成期即满足 `validateAction` 前置（例如 **`TRANSIT` 要求虫洞已 `discovered`**，`command-system.ts:64-65`，见 `N-8`）；③ 同一世界状态两次生成产生**相同且同序**的集合；④ 覆盖 §5 的完整 id 表（含 `team-accept:`/`team-decline:`，见 `C-21`）；⑤ 舰船忙碌时**不产生 `act` 候选**（`N-1`）
- **Tests**：`tests/agent/actions.test.ts` DEC-4…DEC-6、DEC-17
- **Expected Result**：测试通过；`id` 稳定性断言通过
- **Rollback Point**：R2
- **Done When**：测试通过

## P0-12 · `observation.ts` 与观察加宽

- **Task ID**：P0-12
- **Title**：AgentObservation 装配与裁剪
- **Goal**：在既有 `snapshot()` 裁剪之上装配单 Agent 视角的 `AgentObservation`，并把 `getObservation` 的返回类型加宽；移除 `legalActions`。
- **Why**：`Agent.md` §29/§30 与 Rule 5——一个 Agent 只应知道「它该知道的」。Prompt 1 已证实当前 Observation 无法支撑题面要求的「公司状况」与「同伴关系」决策。
- **MVP Event**：全部（每个决策的上下文）
- **Read First**：`docs/lv3/02-domain-model.md` §9；`docs/lv3/03-implementation-plan.md` §4.3；`src/engine/projection.ts:59-228`（`snapshot` 与 `getObservation`）；`tests/recon.test.ts:350-380`（隐私断言）；`tests/architecture.test.ts:9-31`
- **Files to Create**：`src/engine/agent/observation.ts`
- **Files to Modify**：`src/engine/projection.ts`
- **Files That Must NOT Be Modified**：`src/engine/projection.ts` 的 `snapshot()` 裁剪逻辑（`:59-198`，被 `recon.test.ts` 与 `architecture.test.ts:85-102` 锁定）；`src/engine/engine.ts` 的 `controllerPort` key 集合
- **Dependencies**：P0-05…P0-11
- **Input / Output**：Input = `operatorId`；Output = `AgentObservation | null`
- **API Contract**：**同步**；无 Agent 的 operator 返回 `null`；`AgentControllerPort` 的 key 集合**不变**（`C-10`、`C-11`）
- **Schema**：无（派生，不持久化）
- **Acceptance Criteria**：① 不含他人 memory/promise/state；② 不含 `enemies`/`seed`/`factions`；③ 不含未发现地理；④ **`JSON.stringify(...)` 不含隐藏地点名**（含 memory 文本后仍成立）；⑤ 含 `tick`/`agentId`/`self`/`company`/`relationships`/`recentMemory`/`pendingMessages`/`activePromise`/`activeDirective`/`availableActions`；⑥ `legalActions` 已移除
- **Tests**：`tests/agent/observation.test.ts` DEC-14…DEC-16；既有 `architecture.test.ts:12,27` 与 `recon.test.ts:365` 必须继续通过
- **Expected Result**：新测试与既有边界/隐私测试全部通过
- **Rollback Point**：R2
- **Done When**：测试通过

## P0-13 · `decision.ts`（校验 + 确定性 fallback）

- **Task ID**：P0-13
- **Title**：决策校验与 fallback
- **Goal**：实现 `AgentDecision` 的构造/校验（Zod + choiceId 归属 + stale 检测）与确定性 fallback 构造器。
- **Why**：`Agent.md` §55 Rule 3 与 §58；fallback 与 LLM 路径必须产生同一种结构，仅 `provider` 不同——否则无网络时无法跑 §59 的全部测试。
- **MVP Event**：全部
- **Read First**：`docs/lv3/02-llm-boundary.md` §5/§6；`docs/lv3/02-decision-flow.md` §3.5；`docs/lv3/03-api-contract.md` §3/§4.5；`schemas/agent-decision.schema.json`
- **Files to Create**：`src/engine/agent/decision.ts`
- **Files to Modify**：无
- **Files That Must NOT Be Modified**：`schemas/agent-decision.schema.json`
- **Dependencies**：P0-03、P0-10、P0-11、P0-12
- **Input / Output**：Input = `unknown`（provider 原始输出）+ `AgentObservation`；Output = `{ ok: true; decision } | { ok: false; error: ModelError }`
- **API Contract**：**同步、纯函数、无 I/O**（因此可离线单测，`03-api-contract.md` §4.5）；**不做**游戏规则校验（那是 `validateAction` 的职责）
- **Schema**：`agent-decision.schema.json`（`intent` 7 值；`act` 条件必填 `choiceId`；`request` 条件必填 `request`；`promptVersion`/`observationTick`/`provider` 必填）
- **Acceptance Criteria**：① 合法决策被接受；② 缺 `choiceId`（`act`）被拒；③ 缺 `request`（`request`）被拒；④ `choiceId` 越界返回 `invalid-choice-id`，**绝不**回退为「让模型直接给 Action」；⑤ stale 检测：过期 ⇒ 丢弃且**不 fallback**；⑥ fallback 构造器产出 `provider: 'deterministic'` 的同构决策
- **Tests**：`tests/agent/decision.test.ts` DEC-7…DEC-13
- **Expected Result**：测试通过
- **Rollback Point**：R2
- **Done When**：测试通过

## P0-14 · `interactions.ts` 与消息辅助

- **Task ID**：P0-14
- **Title**：Admiral 互动、Agent-Agent 互动与消息
- **Goal**：实现六类 Admiral 互动（command/ask/negotiate/promise/encourage/override）与 team-request/team-reply 的语义、`AgentInteraction`（含 `effects`）与 `AgentMessage` 的构造辅助。
- **Why**：`Agent.md` §36–§43；`effects` 是 §59 测试断言（Override → trust 变化、Promise → trust 变化）的落点，也是 Rule 8「行为可追踪」的实现。
- **MVP Event**：EVT-02/03/06/07
- **Read First**：`docs/lv3/02-domain-model.md` §12/§13；`Agent.md` §36–§43；`schemas/agent-message.schema.json`、`schemas/agent-interaction*`（若无则依 §13 的字段定义）
- **Files to Create**：`src/engine/agent/interactions.ts`
- **Files to Modify**：无
- **Files That Must NOT Be Modified**：`src/engine/types.ts` 的既有 `Communication`（**不替换、不重造**）
- **Dependencies**：P0-06、P0-08、P0-09
- **Input / Output**：Input = 互动种类 + 目标 Agent + 载荷；Output = `{ message: AgentMessage; interaction: AgentInteraction; delta: AgentStateDelta }`
- **API Contract**：纯函数；`AgentMessage` 的 `payload` **必填可 null**（`C-20`）
- **Schema**：`agent-message.schema.json`（`kind` 9 值；`payload` 按 kind 判别）
- **Acceptance Criteria**：① 六类互动各自产生正确的 `AgentStateDelta`；② Override 的 delta 精确 `−10/−5/+10`；③ `effects` 记录**实际生效**的增量；④ **ENCOURAGE 不得无条件提高数值**（`Agent.md` §41）——MVP 中它不在范围内，若实现必须受 `context/relationship/recent events` 约束；⑤ team-request/reply 的 payload 含 `requestingAgentId` 与 `accept`
- **Tests**：`tests/agent/interactions.test.ts` D-17、DEC-11
- **Expected Result**：测试通过
- **Rollback Point**：R2
- **Done When**：测试通过

## P0-15 · `agentMessage` 命令

- **Task ID**：P0-15
- **Title**：`agentMessage` 命令与权限门
- **Goal**：在 `commandSchema` 追加 `agentMessage`；在 `validate` 加最小权限放宽；在 `dispatchCommand` 加处理分支（写 `agentMessages`/`AgentInteraction`/状态增量/memory，**并同时**产生一条既有 `Communication`）。
- **Why**：CLAUDE.md §2.1 要求所有世界修改经结构化可验证 Command；现有 25 种命令无对话类命令，MVP 协商分支无法表达（CONFLICT-5）。
- **MVP Event**：EVT-02/04/06/07
- **Read First**：`docs/lv3/03-implementation-plan.md` §4.5/§4.6；`docs/lv3/03-api-contract.md` §1/§3；`src/engine/commands.ts:117-243`（`commandSchema`）；`src/engine/command-system.ts:149-167`（actor 门）、`:340-549`（`dispatchCommand`）；`src/engine/engine.ts:43-61`（`report()` 写 `Communication`）
- **Files to Create**：`tests/agent/command.test.ts`
- **Files to Modify**：`src/engine/types.ts`（`Command` 联合，若 P0-02 未含）、`src/engine/commands.ts`（**仅追加**）、`src/engine/command-system.ts`（**仅追加**）
- **Files That Must NOT Be Modified**：`src/engine/commands.ts` 的 `careerSchema`（`:79-86`）、`src/engine/commands.ts` 的 `actionSchema`、`dispatchCommand` 的既有分支
- **Dependencies**：P0-04、P0-14
- **Input / Output**：Input = `agentMessage` 命令；Output = `CommandResult` + 世界状态变化
- **API Contract**：经 `dispatchCommand` 进入；权限放宽**精确**限定为 `c.type === 'agentMessage' && c.from === actorId && c.from !== 'admiral'`
- **Schema**：命令自身的 Zod 分支；写入的实体符合 `agent-message.schema.json`
- **Acceptance Criteria**：① 玩家（`commander`）的 `agentMessage` 通过；② Agent 以**自己**名义通过；③ Agent 冒用**他人或 admiral** 名义被拒；④ `agentMessages` 有界 200 且淘汰确定；⑤ **同时**产生一条既有 `Communication`（便于 UI 零改动显示）；⑥ 既有 184 测试不受影响
- **Tests**：`tests/agent/command.test.ts` DEC-19、DEC-20
- **Expected Result**：测试通过；负向用例（冒名）确实被拒
- **Rollback Point**：R2
- **Done When**：测试通过

## P0-16 · 初始名册引导 + P0 收口

- **Task ID**：P0-16
- **Title**：4 名初始 Agent 引导与 P0 测试收口
- **Goal**：在 `createWorld` 中生成 4 名 Agent 并绑定 operator/ship；补齐 P0 的全部测试与 fixtures。
- **Why**：MVP 需要 4 名可区分人格的 Agent（Explorer/Tactical/Scientist/Logistics）；余 2 艘保持 `'rules'` 形成对照组（CONFLICT-6）。
- **MVP Event**：EVT-01…09（全部以这 4 名为载体）
- **Read First**：`docs/lv3/02-mvp-traceability.md` §4 CONFLICT-6；`docs/lv3/02-domain-model.md` §2；`src/engine/data.ts:160-200`（`createWorld`）；`src/engine/definitions/ships.ts:248-255`（`INITIAL_FLEET`）
- **Files to Create**：`tests/agent/bootstrap.test.ts`、`tests/agent/domain.test.ts`（若未建）、`tests/fixtures/agent/*.json`
- **Files to Modify**：`src/engine/data.ts`
- **Files That Must NOT Be Modified**：`INITIAL_FLEET` 的 6 艘舰与既有 operator/assignment 生成方式
- **Dependencies**：P0-04…P0-15
- **Input / Output**：Input = 无；Output = 含 4 名 Agent 的初始 `WorldState`
- **API Contract**：`createWorld()` 签名不变
- **Schema**：`agent.schema.json`；`WorldState.agents` 恰好 4 条
- **Acceptance Criteria**：① 恰好 4 名 Agent，1:1 绑定 operator↔ship（建议 Explorer→`vigil`、Tactical→`verity`、Scientist→`horizon`、Logistics→`meridian`）；② 对应 4 个 operator 为 `kind:'agent'` + `agentId`；③ 其余 2 艘保持 `'rules'` 且**无** `agentId`；④ **`nextId` 分配在所有既有分配之后**，既有 id 序列不变；⑤ `architecture.test.ts:39-60` 的重放断言仍相等
- **Tests**：`tests/agent/bootstrap.test.ts` I-1；`tests/agent/domain.test.ts` D-1…D-17；`tests/agent/actions.test.ts`；`tests/agent/observation.test.ts`；`tests/agent/decision.test.ts`；`tests/agent/interactions.test.ts`；`tests/agent/command.test.ts`
- **Expected Result**：`npm test` 全绿（既有 184 + 新增 P0 测试）；`npm run build` 通过
- **Rollback Point**：R2
- **Done When**：**P0 门禁**——`npm test` 全绿、`npm run build` 通过、`git diff --check` 空

---

# P1 — Mock LLM（仍不依赖网络）

## P1-01 · `ModelClient` + `mock-client`

- **Task ID**：P1-01
- **Title**：ModelClient 接口与 mock provider
- **Goal**：实现 `ModelClient`/`DecisionRequest`/`ModelResult`/`ModelError` 接口，以及 fixture 驱动的 `mock` provider；加边界测试。
- **Why**：`Agent.md` §32 要求 provider 无关性；`02-llm-boundary.md` §3 要求 mock 长期存在，使全部 §59 测试可在无网络下跑。
- **MVP Event**：全部（离线测试的基础）
- **Read First**：`docs/lv3/02-llm-boundary.md` §2/§3；`docs/lv3/03-api-contract.md` §4.4；`docs/lv3/03-test-plan.md` §11
- **Files to Create**：`electron/agent/model-client.ts`、`electron/agent/mock-client.ts`、`tests/agent/boundary.test.ts`
- **Files to Modify**：无
- **Files That Must NOT Be Modified**：`src/**`（**`src/` 不得 import `electron/agent/**`**）
- **Dependencies**：P0-13
- **Input / Output**：Input = `DecisionRequest`；Output = `Promise<ModelResult>`
- **API Contract**：**不抛异常**，一律返回 `{ ok: false, error }`（`03-api-contract.md` §4.4）
- **Schema**：`agent-decision.schema.json`
- **Acceptance Criteria**：① mock 返回 schema 合法的 `AgentDecision`；② mock 从 fixture 读，**同一输入 ⇒ 同一输出**；③ 边界测试断言 `electron/agent/**` 不被 `src/**` 引用、不 import `SimulationEngine`/`WorldState`；④ 无 `any`
- **Tests**：`tests/agent/boundary.test.ts` B-1、B-2、B-9；`tests/agent/schemas.test.ts`
- **Expected Result**：P1 基础可用；边界测试通过
- **Rollback Point**：R3
- **Done When**：测试通过

## P1-02 · `prompt.ts` 与提示词文件

- **Task ID**：P1-02
- **Title**：版本化提示词装配与打包
- **Goal**：创建 `prompts/agent/{system,decision,conversation,reflection}.md`（各带 `prompt_version`）与 `electron/agent/prompt.ts`（从 `AgentObservation` 装配）；把 `prompts/**/*` 加入 `package.json` 的 `build.files`。
- **Why**：CLAUDE.md §7 要求提示词版本化并置于业务逻辑之外；`build.files` 目前不含 `prompts/**`，打包后应用读不到（`C-14`）。
- **MVP Event**：EVT-01/02/06/07（高冲突决策）
- **Read First**：`docs/lv3/02-llm-boundary.md` §4；`Agent.md` §56/§57；`package.json` 的 `build.files`
- **Files to Create**：`prompts/agent/system.md`、`decision.md`、`conversation.md`、`reflection.md`、`electron/agent/prompt.ts`
- **Files to Modify**：`package.json`
- **Files That Must NOT Be Modified**：`docs/lv3/02-llm-boundary.md`
- **Dependencies**：P0-12
- **Input / Output**：Input = `AgentObservation`；Output = `{ systemPrompt, decisionPrompt, promptVersion }`
- **API Contract**：**只从 `AgentObservation` 字段装配，不拼接 `WorldState` 原始数据**
- **Schema**：提示词文件带 `prompt_version`；`AgentDecision.promptVersion` 与之一致
- **Acceptance Criteria**：① 装配结果**不含** `enemies`/`seed`/`factions`/他人 memory；② **不含** `DecisionScore` 或其分项；③ 不含未来事件/脚本化剧情；④ 不含 API key；⑤ 写「你是 Frontier Command 中的 Agent…」而非「你是一个 AI」；⑥ dev 与 asar 两种路径都能读到文件
- **Tests**：`tests/agent/decision.test.ts` 增补 L-5、L-6
- **Expected Result**：提示词装配测试通过；`npm run test:package` 能验证提示词可达
- **Rollback Point**：R3
- **Done When**：测试通过；打包产物含 `prompts/`

> **⚠️ 以下三张卡（P1-03 / P1-04 / P1-05）虽编号为 P1，但 P1 与 P2 的任务书都明令不含调度器与引擎接线，
> 因此它们从未执行。** 2026-10-08 决议：把它们**恢复为一个独立阶段**，排在 P2 之后、P3 之前。
> 范围、文件级变更计划、边界决策与门禁见 **`docs/lv3/07-scheduler-plan.md`**。
> 本处保留原卡原文，作为该阶段的施工依据；实施时以 `07-scheduler-plan.md` 为准（其中已按实测更正了
> 若干过期行号）。P1-04 的「`runtime.ts`」部分已在 P1 完成，剩余的是宿主接线与（待确认的）决策提交。

## P1-03 · `scheduler.ts`

- **Task ID**：P1-03
- **Title**：调度器
- **Goal**：实现触发去抖、单飞、优先级、每游戏分钟上限、冷却推进（`agent.nextDecisionAt`）、stale 判定与**指令存续检测**。
- **Why**：`Agent.md` §34 禁止每 tick 调用 LLM；CLAUDE.md §2.4 要求模拟在 LLM 慢/不可用时仍确定与响应。
- **MVP Event**：全部
- **Read First**：`docs/lv3/02-decision-flow.md` §3；`docs/lv3/03-implementation-plan.md` §8；`KNOWN_ISSUES.md` `C-16`/`C-17`/`C-18`；`src/engine/fleet.ts:39-53,81-93`（为何需要存续检测）；`src/engine/command-system.ts:550-563`（空舰约束）
- **Files to Create**：`electron/agent/scheduler.ts`、`tests/agent/scheduler.test.ts`
- **Files to Modify**：无（宿主接线在 P1-04）
- **Files That Must NOT Be Modified**：`src/engine/fleet.ts` 的 `hasAdmiralWork`/紧急脱离分支、`src/engine/definitions/rules.ts` 的既有键
- **Dependencies**：P1-01
- **Input / Output**：Input = `pump()`（无参）+ `AgentTrigger`；Output = 无（副作用：内部队列）
- **API Contract**：`pump()` **同步返回**，内部**不 `await`**（`03-api-contract.md` §4.6）
- **Schema**：`Agent.nextDecisionAt`（持久化）
- **Acceptance Criteria**：① 单飞；② 冷却期触发合并；③ 高优先级走 LLM、低优先级用确定性（spy 断言低优先级时 provider 零调用）；④ 上限每游戏分钟 1 次；⑤ `paused`/非 `active` 时不动作；⑥ 舰船非空闲时**延后**；⑦ **指令消失 ⇒ 合成 `directive-failed`**（`C-17`，否则 Agent 永久停摆）；⑧ 决策节拍按**帧**判定而非放进 step 循环；⑨ provider 异常不污染 `saveBlocked`
- **Tests**：`tests/agent/scheduler.test.ts` S-1…S-11（用假时钟 + mock provider，不依赖 Electron）
- **Expected Result**：调度器测试通过
- **Rollback Point**：R3
- **Done When**：测试通过；`RULES.agentDecisionInterval` 已新增且**未改动** `RULES.decisionInterval`

## P1-04 · `runtime.ts` + 宿主接线

- **Task ID**：P1-04
- **Title**：决策编排与宿主循环接入
- **Goal**：实现 `electron/agent/runtime.ts`（取观察 → 评分 → LLM/mock → 校验 → choiceId 解析 → 提交），并在 `electron/main.ts` 的 `setInterval` 内于 `advanceFrame` 之后调用 `scheduler.pump()`。
- **Why**：这是「不把网络调用放进 `step()`」的落点（CLAUDE.md §2.4）。
- **MVP Event**：全部
- **Read First**：`docs/lv3/03-api-contract.md` §3/§4.7/§5；`docs/lv3/02-decision-flow.md` §6；`electron/main.ts:99-196`；`src/engine/engine.ts:91-96`
- **Files to Create**：`electron/agent/runtime.ts`、`tests/agent/runtime.test.ts`
- **Files to Modify**：`electron/main.ts`
- **Files That Must NOT Be Modified**：`electron/main.ts` 的既有 7 条 IPC、`saveBlocked` 块（`:173-177`）、`electron/preload.ts`、`src/global.d.ts`
- **Dependencies**：P1-02、P1-03
- **Input / Output**：Input = `agentId`（+ 可选 trigger）；Output = `void`（副作用：可能提交一条命令）
- **API Contract**：内部异步；**只经 `AgentControllerPort.submitAction` 改状态**；`intent !== 'act'` 时**不调用** `submitAction`（`03-api-contract.md` §3）
- **Schema**：`agent-decision.schema.json`
- **Acceptance Criteria**：① 录制的决策能真正改变引擎状态；② 重复提交被单飞阻止；③ stale 决策被丢弃且**不 fallback**；④ provider 失败 ⇒ 确定性 `wait`；⑤ `pump()` 调用**不 `await`**、被 `try/catch` 包住；⑥ 提交时**显式**用 `operatorId`，绝不以 commander 身份提交（`N-3`）；⑦ **不新增 IPC 通道**
- **Tests**：`tests/agent/runtime.test.ts` I-2、S-7、S-8、B-10、B-11
- **Expected Result**：运行时测试通过；离线可完整跑一次决策环
- **Rollback Point**：R3
- **Done When**：测试通过；`npm run build` 通过

## P1-05 · `AgentTrigger` 发射 + 确定性重放测试

- **Task ID**：P1-05
- **Title**：触发发射与重放
- **Goal**：以 `SimulationEvent` 新增变体的方式发射 `AgentTrigger`（`directive-completed`/`directive-failed`/`ship-idle`/`world-event`/`danger`/`admiral-message`/`promise-changed`），并补齐确定性重放测试。
- **Why**：`Agent.md` §34 要求事件驱动；复用既有非持久化 `pendingEvents` 通道可避免触碰 `WorldState` 与破坏重放断言（`C-16`）。
- **MVP Event**：全部（触发源）
- **Read First**：`docs/lv3/03-implementation-plan.md` §8.2；`src/engine/engine.ts:26-27,108-133,147,160`；`src/engine/combat.ts:126`（先例）；`src/engine/fleet.ts:148-153`；`src/engine/sensors.ts:119`；`src/engine/world-events.ts:22`；`KNOWN_ISSUES.md` `C-9`/`C-16`
- **Files to Create**：`tests/agent/replay.test.ts`
- **Files to Modify**：`src/engine/engine.ts`（`complete()` 追加 push）、`src/engine/fleet.ts`（追加 1 行 push）、`src/engine/sensors.ts`（追加 1 行 push）、`src/engine/world-events.ts`（追加 1 行 push）、`src/engine/types.ts`（`SimulationEvent` 变体，若 P0-02 未含）
- **Files That Must NOT Be Modified**：`step()`/`advanceFrame` 控制流、`fleet.ts:50,81-93`、`sensors.ts`/`world-events.ts` 的既有分支逻辑
- **Dependencies**：P1-04
- **Input / Output**：Input = 引擎内部状态变化；Output = `SimulationEvent[]` 中的 `AgentTrigger` 变体
- **API Contract**：`AgentTrigger` **不进 `WorldState`**；只走瞬时 `pendingEvents`
- **Schema**：无（不持久化）
- **Acceptance Criteria**：① 指令完成恰好为该 Agent 触发**一次**决策；② 指令被静默清除 ⇒ 触发 `directive-failed`（`C-17`）；③ `expect(a.state).toEqual(b.state)` 仍成立（触发不得进 `state`）；④ 既有 `clock.test.ts` 的事件断言不受影响；⑤ 全部改动是**追加行**——若发现必须改控制流，**停下来记录冲突**
- **Tests**：`tests/agent/replay.test.ts` L-2、L-3、L-4；既有 `architecture.test.ts:39-60` 必须继续通过
- **Expected Result**：**P1 门禁**——`npm test` 全绿；离线完整决策环可重放
- **Rollback Point**：R4
- **Done When**：P1 门禁通过；`npm run build` 通过

---

# P2 — Live DeepSeek Runtime

## P2-01 · `openai-compatible.ts`

- **Task ID**：P2-01
- **Title**：DeepSeek / OpenAI 兼容 provider
- **Goal**：用内建 `fetch` + `AbortController` 实现 provider，支持超时与结构化 JSON 输出。
- **Why**：`Agent.md` §32 要求支持 DeepSeek 等 OpenAI 兼容接口；不需要新增依赖。
- **MVP Event**：EVT-01/02/06/07（真实 LLM 演示）
- **Read First**：`docs/lv3/02-llm-boundary.md` §3/§6；`docs/lv3/03-api-contract.md` §4.4
- **Files to Create**：`electron/agent/openai-compatible.ts`
- **Files to Modify**：无
- **Files That Must NOT Be Modified**：`package.json` 的 `dependencies`（**不新增 HTTP 客户端**）
- **Dependencies**：P1-01
- **Input / Output**：Input = `DecisionRequest`；Output = `Promise<ModelResult>`
- **API Contract**：**不抛异常**；`timeout` 用 `AbortController`；返回 `ModelError` 分类
- **Schema**：`agent-decision.schema.json`（要求模型输出结构化 JSON）
- **Acceptance Criteria**：① 超时 ⇒ `{ ok: false, error: 'timeout' }`；② 非 2xx ⇒ `'http-error'`；③ 非法 JSON ⇒ `'invalid-json'`；④ 结构不符 ⇒ `'schema-mismatch'`；⑤ 测试用 **stub `fetch`，零真实网络**
- **Tests**：`tests/agent/provider.test.ts` L-7…L-10
- **Expected Result**：provider 测试通过
- **Rollback Point**：R5
- **Done When**：测试通过；无真实网络请求

## P2-02 · 配置、密钥与日志脱敏

- **Task ID**：P2-02
- **Title**：provider 配置与日志脱敏
- **Goal**：从环境变量读取 API key / base URL / model id；无 key 时进入确定性模式；日志只记非敏感字段。
- **Why**：`02-llm-boundary.md` §7——密钥仅主进程、不进仓库/Renderer/日志。
- **MVP Event**：无（基础设施）
- **Read First**：`docs/lv3/02-llm-boundary.md` §7；`docs/lv3/03-api-contract.md` §8；`electron/main.ts:71-77`
- **Files to Create**：无（并入 `openai-compatible.ts` 或 `runtime.ts` 的配置读取）
- **Files to Modify**：`electron/agent/openai-compatible.ts`、`electron/agent/runtime.ts`
- **Files That Must NOT Be Modified**：`electron/preload.ts`、`src/global.d.ts`（**不新增 Renderer API**）
- **Dependencies**：P2-01
- **Input / Output**：Input = 环境变量；Output = provider 实例或确定性模式
- **API Contract**：无新接口
- **Schema**：无
- **Acceptance Criteria**：① 无 key ⇒ 不报错、退化为确定性模式；② key **不出现在**日志、不出现在 `Snapshot`、不进 Renderer；③ 日志仅含 `agentId`/`decisionTime`/`promptVersion`/`status`/`latency`
- **Tests**：`tests/agent/provider.test.ts` L-11、L-12；`tests/agent/boundary.test.ts` B-7
- **Expected Result**：测试通过
- **Rollback Point**：R5
- **Done When**：测试通过

## P2-03 · 错误处理、重试与降级

- **Task ID**：P2-03
- **Title**：失败分类、有限重试与熔断降级
- **Goal**：实现六类 `ModelError` 的处置、最多 2 次重试 + 指数退避、连续失败后熔断降级（提案 30 游戏分钟）、以及除「Observation 过期」外的确定性 fallback。
- **Why**：`Agent.md` §58 要求 LLM 失败不得导致游戏崩溃；`02-decision-flow.md` §3.5/§3.6 要求 fallback 不是可选项。
- **MVP Event**：全部
- **Read First**：`docs/lv3/02-llm-boundary.md` §6；`docs/lv3/02-decision-flow.md` §3.5；`docs/lv3/03-api-contract.md` §6
- **Files to Create**：无（并入 `runtime.ts`）
- **Files to Modify**：`electron/agent/runtime.ts`
- **Files That Must NOT Be Modified**：`src/engine/engine.ts` 的 `step()`
- **Dependencies**：P2-01、P2-02
- **Input / Output**：Input = `ModelResult`（失败）；Output = 确定性 `AgentDecision` 或丢弃
- **API Contract**：**Observation 过期时不 fallback**（基于旧观测的分数同样是错的）
- **Schema**：无
- **Acceptance Criteria**：① 六类错误各走正确路径；② 最多 2 次重试，**不无限重试**；③ 连续失败后熔断；④ 每次失败产生一条 `provider` 轨迹；⑤ 过期 ⇒ 丢弃且不 fallback
- **Tests**：`tests/agent/provider.test.ts` L-13、L-14；`tests/agent/runtime.test.ts`；`tests/agent/decision.test.ts` DEC-12
- **Expected Result**：测试通过
- **Rollback Point**：R5
- **Done When**：测试通过

## P2-04 · Provider 测试收口

- **Task ID**：P2-04
- **Title**：provider 全错误类覆盖
- **Goal**：补齐 `tests/agent/provider.test.ts`，覆盖每一类 `ModelError`、超时、熔断与无 key 模式；确认测试**零真实网络**。
- **Why**：`Agent.md` §58/§59；测试计划 §5。
- **MVP Event**：全部
- **Read First**：`docs/lv3/03-test-plan.md` §5
- **Files to Create**：无
- **Files to Modify**：`tests/agent/provider.test.ts`
- **Files That Must NOT Be Modified**：既有 13 个测试文件
- **Dependencies**：P2-03
- **Input / Output**：测试代码
- **API Contract**：无
- **Schema**：无
- **Acceptance Criteria**：L-7…L-15 全部通过；测试中无真实 `fetch` 外呼
- **Tests**：`tests/agent/provider.test.ts`
- **Expected Result**：**P2 门禁**——`npm test` 全绿
- **Rollback Point**：R6
- **Done When**：P2 门禁通过；`npm run build` 通过

---

# P3 — MVP Vertical Slice

> P3 的九张卡各自接线一个 MVP 事件。每张卡都必须**只用既有 `Action`**（`ESCORT`/`TRANSIT`/`SURVEY`/`RETURN`），
> **不得新增物理行为**（ADR-3）。全部验证用 `tests/agent/vertical-slice.test.ts` + mock provider。

## P3-01 · EVT-01 Admiral 发布任务

- **Task ID**：P3-01
- **Title**：Admiral 发布虫洞任务与 Agent 自主评估
- **Goal**：玩家下发任务后，Explorer 产出 `accept`/`reject`/`counteroffer` 之一（推荐路径 `counteroffer`）。
- **Why**：`01-mvp-scenario.md` EVT-01；`Agent.md` §37。
- **MVP Event**：EVT-01
- **Read First**：`docs/lv3/01-mvp-scenario.md` §4 EVT-01；`docs/lv3/02-mvp-traceability.md` §2 EVT-01 行
- **Files to Create**：无（技能接线进既有 `electron/agent/**`）
- **Files to Modify**：`electron/agent/runtime.ts`、`electron/agent/scheduler.ts`
- **Files That Must NOT Be Modified**：`src/engine/**` 的物理分发表
- **Dependencies**：P1-04、P2-04
- **Input / Output**：Input = 玩家的任务命令；Output = `AgentMessage` + （若 `counteroffer`）请求
- **API Contract**：`intent ∈ {respond, request}` ⇒ **不调用** `submitAction`
- **Schema**：`agent-message.schema.json`
- **Acceptance Criteria**：① 任务下发后 Explorer 产出评估；② 理由字段体现人格/目标/状态/信任**作为输入**（断言输入契约而非文本）；③ 若选择 `counteroffer`，其依据在确定性分数上可解释
- **Tests**：`tests/agent/vertical-slice.test.ts` I-2、I-3
- **Expected Result**：事件可复现
- **Rollback Point**：R7
- **Done When**：测试通过

## P3-02 · EVT-02 Explorer 反报价

- **Task ID**：P3-02
- **Title**：反报价与玩家三选一响应
- **Goal**：Explorer 提出「需要 Tactical 护航」；玩家可接受/继续协商/拒绝。
- **Why**：`01-mvp-scenario.md` EVT-02（推荐主路径 Branch B）；`Agent.md` §39。
- **MVP Event**：EVT-02
- **Read First**：`docs/lv3/01-mvp-scenario.md` §4 EVT-02、§5 Branch B；`docs/lv3/02-mvp-traceability.md` §2 EVT-02 行
- **Files to Create**：无
- **Files to Modify**：`electron/agent/runtime.ts`
- **Files That Must NOT Be Modified**：`src/engine/command-system.ts` 的既有分支
- **Dependencies**：P3-01
- **Input / Output**：Input = 玩家 `agentMessage{kind:'negotiate'}`；Output = 新 `AgentMessage` + episodic memory
- **API Contract**：经 `agentMessage` 命令；协商结果改变 `activeDirective` 或产生 team-request
- **Schema**：`agent-message.schema.json` 的 `negotiate` payload（`requestType`/`targetAgentId`/`value`）
- **Acceptance Criteria**：① 反报价产生 `request: {type:'teammate', targetAgentId}`；② 玩家接受后触发 EVT-03；③ 写一条 episodic memory
- **Tests**：`tests/agent/vertical-slice.test.ts` I-3
- **Expected Result**：事件可复现
- **Rollback Point**：R7
- **Done When**：测试通过

## P3-03 · EVT-03 Agent-Agent 组队

- **Task ID**：P3-03
- **Title**：组队请求与护航
- **Goal**：Tactical 收到请求并决定接受/拒绝；接受后提交既有 `ESCORT`，双方关系上升。
- **Why**：`01-mvp-scenario.md` EVT-03；`Agent.md` §43「第一版只实现一种」——就这一种。这是**题目要求 Lv3-4**「至少一次 Agent-Agent 互动」的落点。
- **MVP Event**：EVT-03
- **Read First**：`docs/lv3/01-mvp-scenario.md` §4 EVT-03；`docs/lv3/02-mvp-traceability.md` §2 EVT-03 行、§3 链路 C；`src/engine/types.ts:233`（`ESCORT`）；`src/engine/command-system.ts:550-563`（空舰约束）
- **Files to Create**：无
- **Files to Modify**：`electron/agent/runtime.ts`
- **Files That Must NOT Be Modified**：`src/engine/execution.ts` 的 `ESCORT` 实现
- **Dependencies**：P3-02
- **Input / Output**：Input = `team-request`；Output = `team-reply` + 既有 `ESCORT` 指令 + 关系变化
- **API Contract**：`team-accept:<agentId>` 是社交决策；接受后**另起一次** `act` 决策提交 `ESCORT`（`03-api-contract.md` §3）
- **Schema**：`agent-message.schema.json` 的 `team-request`/`team-reply` payload
- **Acceptance Criteria**：① Tactical 的决策受 `relationships[Explorer].value`、`fatigue`、当前指派影响；② 接受后 `ESCORT` 真正提交且通过 `validateAction`；③ 双方 `relationship.value ↑`；④ **Tactical 的舰必须空闲**，否则延后（`N-1`）
- **Tests**：`tests/agent/vertical-slice.test.ts` I-4、I-12
- **Expected Result**：事件可复现；关系变化可断言
- **Rollback Point**：R7
- **Done When**：测试通过

## P3-04 · EVT-04 Logistics 战备评估

- **Task ID**：P3-04
- **Title**：Logistics 风险/战备评估（无燃料）
- **Goal**：Logistics 基于「弹药余量 + 船体完整度 + 路径预估」给出 READY/WARNING。
- **Why**：`01-mvp-scenario.md` EVT-04；**代码中完全没有燃料机制**，必须重新表达（CONFLICT-1）。
- **MVP Event**：EVT-04
- **Read First**：`docs/lv3/02-mvp-traceability.md` §4 CONFLICT-1；`docs/lv3/01-mvp-scenario.md` §4 EVT-04；`src/engine/types.ts:261-291`（`Ship` 的 `hull`/`photon`/`quantum`）；`src/engine/navigation.ts`（`routeEstimate`）
- **Files to Create**：无
- **Files to Modify**：`electron/agent/runtime.ts`
- **Files That Must NOT Be Modified**：`src/engine/types.ts` 的 `Ship`（**不新增 `fuel` 字段**）
- **Dependencies**：P3-01
- **Input / Output**：Input = 舰船状态 + 目标 + 路线；Output = `say: 'READY' | 'WARNING'`（+ 理由）
- **API Contract**：**确定性评估**——不得由 LLM 决定 `READY`/`WARNING`（否则不可测）
- **Schema**：无（`say` 进 `AgentMessage`）
- **Acceptance Criteria**：① 不引入任何燃料概念；② 评估输入为弹药 + 船体 + 路径；③ 不同 Agent 对同一任务可因目标不同给出不同意见（EVT-06 的前置）
- **Tests**：`tests/agent/vertical-slice.test.ts` I-5
- **Expected Result**：事件可复现
- **Rollback Point**：R7
- **Done When**：测试通过；仓库中仍无 `fuel` 字段

## P3-05 · EVT-05 穿越虫洞与发现异常

- **Task ID**：P3-05
- **Title**：穿越、发现异常、继续调查
- **Goal**：Explorer+Tactical 穿越虫洞，发现未知能量特征与失联探测船痕迹；Explorer 产出「继续调查」并写 `discovery` 记忆、`goalProgress ↑`。
- **Why**：`01-mvp-scenario.md` EVT-05；`Agent.md` §48（发现异常 +10）。
- **MVP Event**：EVT-05
- **Read First**：`docs/lv3/01-mvp-scenario.md` §4 EVT-05；`docs/lv3/02-mvp-traceability.md` §2 EVT-05 行、§4 CONFLICT-7；`src/engine/command-system.ts:64-65`（`TRANSIT` 要求虫洞已 `discovered`）；`src/engine/world-events.ts:354-371`（Veil 链路，**复用不新增**）
- **Files to Create**：无
- **Files to Modify**：`electron/agent/runtime.ts`
- **Files That Must NOT Be Modified**：`src/engine/world-events.ts` 的 Veil 接管分支；`src/engine/world-generation.ts`
- **Dependencies**：P3-03
- **Input / Output**：Input = `directive-completed`；Output = 既有 `SURVEY` 指令 + episodic memory
- **API Contract**：经既有 `TRANSIT` / `SURVEY`；**生成候选时**必须校验虫洞已 `discovered`（否则候选必被拒，`N-8`）
- **Schema**：`agent-memory.schema.json`（`tags: ['discovery']`）
- **Acceptance Criteria**：① 穿越与调查都用既有 `Action`；② 复用 Veil 链路而非新增「失联探测船」机制；③ 写 `discovery` 记忆且 `goalProgress ↑`；④ 舰船忙碌时该决策延后到 `directive-completed` 之后
- **Tests**：`tests/agent/vertical-slice.test.ts` I-6、I-13
- **Expected Result**：事件可复现
- **Rollback Point**：R7
- **Done When**：测试通过

## P3-06 · EVT-06 目标冲突 + EVT-07 Promise 路径

- **Task ID**：P3-06
- **Title**：四名 Agent 分歧与 Promise 路径
- **Goal**：四名 Agent 对下一步给出不同意见；Admiral 走 Path A —— 承诺 Deep Scan 优先权限，产生 `pending` 承诺。
- **Why**：`01-mvp-scenario.md` EVT-06/EVT-07 Path A；`Agent.md` §39/§40/§44；`02-mvp-traceability.md` §3 链路 A。
- **MVP Event**：EVT-06、EVT-07 Path A
- **Read First**：`docs/lv3/01-mvp-scenario.md` §4 EVT-06/EVT-07、§5；`docs/lv3/02-mvp-traceability.md` §3 链路 A；`schemas/agent-promise.schema.json`
- **Files to Create**：无
- **Files to Modify**：`electron/agent/runtime.ts`
- **Files That Must NOT Be Modified**：`src/engine/command-system.ts` 的既有 `REFIT` 处理
- **Dependencies**：P3-04、P3-05
- **Input / Output**：Input = 新的异常数据；Output = 四条 `AgentMessage` + 一条 `AgentPromise{pending, fulfills:{kind:'grant-module', key:'deepScan'}}`
- **API Contract**：经 `agentMessage{kind:'promise', payload:{promiseId}}`
- **Schema**：`agent-promise.schema.json`、`agent-message.schema.json`
- **Acceptance Criteria**：① 至少 2 名 Agent 给出**不同**的 `intent`/`choiceId`；② Promise 以 `pending` 创建且 `resolvedAt: null`；③ 玩家可在 ASK / NEGOTIATE / COMMAND 中选择
- **Tests**：`tests/agent/vertical-slice.test.ts` I-7、I-8
- **Expected Result**：事件可复现
- **Rollback Point**：R7
- **Done When**：测试通过

## P3-07 · EVT-07 Override 路径

- **Task ID**：P3-07
- **Title**：Override 与其代价
- **Goal**：Agent 不愿继续时，Admiral 下达命令强制执行；精确施加 `trust−10 / morale−5 / stress+10` 并写 `admiral-override` 记忆。
- **Why**：`01-mvp-scenario.md` EVT-07 Path B；`Agent.md` §42 与 §55 Rule 7（Override 改变**意愿**，不绕过引擎验证）；`02-mvp-traceability.md` §3 链路 B。
- **MVP Event**：EVT-07 Path B
- **Read First**：`docs/lv3/03-implementation-plan.md` §4.6；`docs/lv3/01-mvp-scenario.md` §4 EVT-07 Path B、§5 Branch C；`docs/lv3/02-mvp-traceability.md` §3 链路 B
- **Files to Create**：无
- **Files to Modify**：`electron/agent/runtime.ts`
- **Files That Must NOT Be Modified**：`src/engine/command-system.ts` 的 `validate` 权限门（除 P0-15 的 `agentMessage` 放宽外）
- **Dependencies**：P3-06
- **Input / Output**：Input = 玩家的 Override 操作；Output = 既有 `issueDirective`（`source:'admiral'`）+ `agentMessage{kind:'override', payload:{directiveActionType}}` + `AgentInteraction{outcome:'forced'}`
- **API Contract**：**两条命令**（见 `03-implementation-plan.md` §4.6）；强制**执行**靠既有指令，**意愿代价**靠消息
- **Schema**：`agent-message.schema.json` 的 `override` payload 恰携带 `directiveActionType`
- **Acceptance Criteria**：① 两条命令都发出；② 增量精确 `−10/−5/+10`；③ 写入 `tags: ['admiral-override']` 的 episodic memory；④ `AgentInteraction.effects` 记录实际增量；⑤ **Override 不绕过 `validateAction`**
- **Tests**：`tests/agent/vertical-slice.test.ts` I-9
- **Expected Result**：事件可复现；代价可精确断言
- **Rollback Point**：R7
- **Done When**：测试通过

## P3-08 · EVT-08 任务结算

- **Task ID**：P3-08
- **Title**：任务完成与状态结算
- **Goal**：找到失联探测船、任务完成；结算 `goalProgress`/`experience`/`fatigue`/`morale`/`relationship`/`trust`/memory；若存在匹配的 pending promise 则置 `fulfilled`。
- **Why**：`01-mvp-scenario.md` EVT-08；`Agent.md` §48/§19。任务结果由**引擎**决定，不是 Agent/LLM。
- **MVP Event**：EVT-08
- **Read First**：`docs/lv3/02-mvp-traceability.md` §2 EVT-08 行、§3 链路 A；`src/engine/engine.ts:108-133`（`complete()`）；`src/engine/execution.ts:676`（`REFIT` 真正装入模块处，即 promise 兑现判定点）；`src/engine/command-system.ts:132`（`REFIT` 校验）
- **Files to Create**：无
- **Files to Modify**：`electron/agent/runtime.ts`
- **Files That Must NOT Be Modified**：`src/engine/engine.ts` 的 `complete()` 控制流（只允许追加 trigger push）
- **Dependencies**：P3-07
- **Input / Output**：Input = `directive-completed`；Output = 结算后的 Agent 状态 + 记忆
- **API Contract**：结算由**引擎**驱动；Agent 层只读取结果
- **Schema**：`agent.schema.json` 的 `$defs.state`/`$defs.goal`
- **Acceptance Criteria**：① 全部状态按 §5 规则变化；② `experience` 增长；③ 相关 Agent 的 `relationship` 变化；④ 若 Admiral 实际执行了 `REFIT(deepScan)`，对应 pending promise 自动置 `fulfilled` 且触发 §19 的 trust/loyalty/morale/goalProgress 上升；⑤ 写 `mission-success` 记忆
- **Tests**：`tests/agent/vertical-slice.test.ts` I-10
- **Expected Result**：事件可复现
- **Rollback Point**：R7
- **Done When**：测试通过

## P3-09 · EVT-09 闭环 + 垂直切片

- **Task ID**：P3-09
- **Title**：过去经历影响下一次决策（垂直切片）
- **Goal**：完成 EVT-09 与整个 `01-mvp-scenario.md` §6 的 Definition of Done：**同一 Agent，因玩家过去行为不同，下一次决策不同**。
- **Why**：这是本次 MVP **最重要的验证点**。`Agent.md` §50 明文：Memory 若不影响未来行为，系统没有实际意义。`02-mvp-traceability.md` §3 要求链路 A 与 B **同时**可复现。
- **MVP Event**：EVT-09（Path A 与 Path B 对照）
- **Read First**：`docs/lv3/01-mvp-scenario.md` §4 EVT-09、§6/§9；`docs/lv3/02-mvp-traceability.md` §3 全部三条链路；`Agent.md` §50/§51
- **Files to Create**：`tests/agent/vertical-slice.test.ts`、`tests/fixtures/agent/lv3-demo.json`、`docs/lv3/07-vertical-slice.md`（可选，供 Prompt 7 阶段）
- **Files to Modify**：`electron/agent/runtime.ts`（收口）
- **Files That Must NOT Be Modified**：`src/engine/**` 的物理规则
- **Dependencies**：P3-08
- **Input / Output**：Input = 新高风险任务；Output = Path A/B 下**不同**的下一次决策
- **API Contract**：全靠 mock provider 保证可重放
- **Schema**：全部 7 个 schema
- **Acceptance Criteria**：① Path A（Promise 兑现）⇒ `trustInAdmiral` 上升，更可能 `accept`；② Path B（Override）⇒ `trustInAdmiral` 下降，落入 `counteroffer`/`reject`；③ **两条路径在同一测试中对照断言**（`trustInAdmiral` 差异 + `choiceId` 差异同时成立）；④ 全链路离线 + mock provider 可重放；⑤ 覆盖 `01-mvp-scenario.md` §6 的 DoD 与 §9 的体验转变
- **Tests**：`tests/agent/vertical-slice.test.ts` I-11、I-14；MUST 覆盖 I-1…I-13
- **Expected Result**：**P3 门禁 / 垂直切片**——`npm test` 全绿；链路 A 与 B 同时可复现
- **Rollback Point**：R7
- **Done When**：垂直切片测试通过；`npm run build` 通过；`git diff --check` 空

---

## 2. 交接提示

P3-09 完成后进入 Prompt 4/8 的正式交接，请更新：

```text
docs/lv3/CLAUDE_TO_CODEX.md    ← 已实现内容、改动文件、合同、测试、剩余、限制
docs/lv3/KNOWN_ISSUES.md       ← 新增冲突与遗留
docs/lv3/CODEX_TASKS.md        ← 本文件的完成状态
```

**Codex 必须不得重写的东西**（详见 `CLAUDE_TO_CODEX.md` §6）：

```text
src/engine/legacy-v9/**               冻结
src/engine/v9-schema.ts               被两条契约共用
src/engine/commands.ts 的 careerSchema  Personnel 枚举
SimulationEngine.step() / advanceFrame 控制流
AgentControllerPort 的 key 集合         恰好两个
schemas/*.json                        已批准合同
src/ui/**                             保护区域
```
