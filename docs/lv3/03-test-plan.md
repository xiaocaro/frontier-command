# Lv3 测试计划（03-test-plan）

生成日期：2026-10-08
阶段：Prompt 3（Implementation Plan + Codex Handoff）
性质：测试矩阵。**测试从 MVP 场景 + `Agent.md` + Prompt 2 架构 + 实际代码反推**，不凭想象新增。

**基线（本阶段实测）**：`npm test` = 13 files / 184 tests **PASS**（vitest，`vitest.config.ts` include `tests/**/*.test.ts`）。

**测试运行器现状**：

| 运行器 | 配置 | 覆盖 |
| --- | --- | --- |
| Vitest | `npm test`（`vitest run`） | 13 个单测/集成文件，184 用例 |
| Playwright | `npm run test:e2e`（先 `npm run build`） | 8 spec / 36 用例 |

**新增测试全部用 Vitest**（`tests/agent/*.test.ts`）。原因：Lv3 的核心断言（确定性、边界、
失败降级）不依赖 Electron，且必须能在**无网络、无 Electron** 的条件下跑（`Agent.md` §59 的要求）。

---

## 1. 测试原则

1. **不依赖真实 LLM**：所有回归断言只使用 `mock` provider（`02-llm-boundary.md` §8）。
2. **不依赖网络与 Electron**：领域/决策/调度测试全部可在 `npm test` 内完成。
3. **确定性优先**：任何新增集合的有界淘汰都必须有「两次运行结果一致」的断言。
4. **不夸大**：不得声称「同样输入 LLM 必得同样输出」。
5. **回归护栏不可削弱**：既有 184 个用例中，只有 §8 列出的 8 处字面量随版本升级调整，语义不变。

---

## 2. 测试文件清单（新增）

| 文件 | 类别 | 对应任务 |
| --- | --- | --- |
| `tests/agent/schemas.test.ts` | Schema | P0-03 |
| `tests/agent/migration.test.ts` | Persistence | P0-04 |
| `tests/agent/domain.test.ts` | Domain | P0-05…P0-10 |
| `tests/agent/actions.test.ts` | Decision | P0-11 |
| `tests/agent/observation.test.ts` | Decision | P0-12 |
| `tests/agent/decision.test.ts` | Decision | P0-13 |
| `tests/agent/interactions.test.ts` | Domain | P0-14 |
| `tests/agent/command.test.ts` | Decision | P0-15 |
| `tests/agent/bootstrap.test.ts` | Integration | P0-16 |
| `tests/agent/boundary.test.ts` | Regression | P1-01 |
| `tests/agent/replay.test.ts` | LLM | P1-05 |
| `tests/agent/scheduler.test.ts` | Scheduler | P1-03 |
| `tests/agent/runtime.test.ts` | Integration | P1-04 |
| `tests/agent/provider.test.ts` | LLM | P2-01…P2-04 |
| `tests/agent/vertical-slice.test.ts` | Integration | P3-01…P3-09 |

Fixture：`tests/fixtures/agent/*.json`（录制决策、场景初始状态、期望结果）。

---

## 3. Domain 测试（P0-05…P0-10、P0-14）

| # | 断言 | 依据 | 对应 `Agent.md` |
| --- | --- | --- | --- |
| D-1 | `AgentPersonality` 五维钳制在 `[0,100]`；四名初始 Agent 取值符合 `02-domain-model.md` §2 表 | §5 | §5 |
| D-2 | `AgentGoal` 的 `kind` 决定 `GoalAlignment`；`progress` 按 §48（发现异常 +10 / Deep Scan +15 / 重大线索 +30 / 被强制停止 0） | §7/§48 | §7/§48 |
| D-3 | `fatigue` 分档边界：`39→正常`、`40→疲劳`、`69→疲劳`、`70→严重`、`84→严重`、`85→强制休息` | §21 | §21 |
| D-4 | 任务成功 `fatigue += 10`、高风险 `+15`、失败 `fatigue += 15`、休息 `-20` | §21 | §21 |
| D-5 | **Override 代价精确等于** `trust -= 10`、`morale -= 5`、`stress += 10` | §42 | §42 |
| D-6 | Promise fulfilled ⇒ `trust ↑`、`loyalty ↑`、`morale ↑`、`goalProgress ↑` | §19 | §19 |
| D-7 | Promise broken ⇒ `trust ↓`、`loyalty ↓`、`stress ↑` | §19 | §19 |
| D-8 | **Trust 与 Loyalty 是独立变量**：只降 trust 时 loyalty 不变 | §20 | §20 |
| D-9 | 所有状态更新后钳制到 `[0,100]`（含边界饱和） | — | §6 |
| D-10 | `AgentRelationship` 的 `value ∈ [-100,100]`，`trust`/`cooperation ∈ [0,100]`；team-up 成功双方 `value ↑`、`cooperation ↑` | §13/§14 | §13/§14 |
| D-11 | 记忆**有界**：写入第 41 条时按 `weight` 升序淘汰恰好 1 条 | §52 | §16–§18 |
| D-12 | **淘汰确定性**：同一写入序列跑两次，结果对象深度相等 | `architecture.test.ts:39-60` | §52 |
| D-13 | 记忆检索按 `tags` 匹配 + `weight` 排序，**顺序确定** | §52 | §16–§18 |
| D-14 | 三类记忆（episodic/social/promise）判别正确；`promise` 类携带有效 `promiseId` | §15–§18 | §15–§18 |
| D-15 | `AgentPromise.fulfills` 匹配：`grant-module/deepScan` 在既有 `REFIT` 装入 `deepScan` 后自动置 `fulfilled`，`resolvedAt` 被写入 | §18/§19 | §18/§19 |
| D-16 | Promise `pending → broken` 路径可触发，且 `promises` 上限 20 的淘汰只保留 `pending` + 最近 N 条已解决 | `02-persistence-strategy.md` §3 | §18 |
| D-17 | `AgentInteraction.effects` 记录**实际生效**的增量（供断言与审计） | Rule 8 | §42 |

---

## 4. Decision 测试（P0-11、P0-12、P0-13、P0-15）

| # | 断言 | 依据 | 对应 EVT |
| --- | --- | --- | --- |
| DEC-1 | `DecisionScore` 逐项可验证：九个分项各自的输入改变时分数按权重变化；`RecentMemoryScore` 使匹配 tag 的记忆产生正贡献 | §46 / `02-decision-flow.md` §4 | 全部 |
| DEC-2 | 分数分档边界：`70 → ACCEPT`、`69 → 需 LLM`、`45 → 需 LLM`、`44 → REQUEST/COUNTER`、`25 → REQUEST/COUNTER`、`24 → REJECT` | §46 | EVT-01/09 |
| DEC-3 | `DecisionScore` 是**纯函数**：同输入两次调用结果相同；不读时钟、不用随机 | §46 | 全部 |
| DEC-4 | `availableActions` 生成的候选**全部**能通过 `actionSchema.parse` 与 `validateAction` 前置检查 | §27/§28 | EVT-01/05 |
| DEC-5 | `choiceId` 生成**跨 tick 稳定**：同一世界状态两次生成产生相同且同序的集合 | `03-implementation-plan.md` §5 | EVT-01/05/06 |
| DEC-6 | choiceId 表单覆盖 §5 定稿表（`explore:` / `survey:` / `haul:` / `escort:` / `patrol:` / `recover:` / `return` / `dock:` / `refit:` / `rearm:` / `accept` / `reject` / `counteroffer` / `team-accept:` / `team-decline:`） | §10 定稿 | 全部 |
| DEC-7 | **合法决策**：`intent:'act'` + 合法 `choiceId` ⇒ 解析出正确的既有 `Action` | §24/§28 | EVT-05 |
| DEC-8 | **非法决策被拒**：`intent:'act'` 但**缺** `choiceId` ⇒ Zod 拒绝（`allOf` 条件必填） | `agent-decision.schema.json` | 全部 |
| DEC-9 | **`choiceId` 越界** ⇒ `invalid-choice-id`，且**绝不**回退为「让模型直接给 Action」 | Rule 3 | 全部 |
| DEC-10 | `intent:'request'` 缺 `request` 字段 ⇒ Zod 拒绝 | schema `allOf` | EVT-02 |
| DEC-11 | 非 `act` 意图**不调用** `submitAction`（用 spy 断言零调用） | `03-api-contract.md` §3 | EVT-01/02/04/06 |
| DEC-12 | `observationTick` 过期 ⇒ 丢弃，**且不做 fallback**（断言 provider 未被二次调用、状态未变） | §6 | 全部 |
| DEC-13 | `observationTick` 未过期 ⇒ 正常处理 | §6 | 全部 |
| DEC-14 | **Observation 裁剪**：无他人 memory/promise/state；无 `enemies`/`seed`/`factions`；无未发现地理 | Rule 5 | 全部 |
| DEC-15 | **Agent 隔离**：A 的 Observation 不含 B 的私有字段（逐字段断言，非仅 `JSON.stringify` 检查） | Rule 5 | EVT-03/06 |
| DEC-16 | **隐私回归**：`JSON.stringify(getObservation(op))` 不含隐藏地点名——**含 memory 文本后仍成立** | `recon.test.ts:365` | EVT-05 |
| DEC-17 | 舰船**忙碌**时 `availableActions === []`（或有 `current`/`queue`/`suspended` 时不产生 `act` 候选） | `N-1` | EVT-05/08 |
| DEC-18 | 游戏规则校验仍由既有 `validateAction` 生效：构造一个「候选合法但世界已变」的场景 ⇒ `submitAction` 返回 `{ok:false}`，且**不**回退为直接执行 | Rule 6 | 全部 |
| DEC-19 | `agentMessage` 权限：玩家（`commander`）通过；Agent 以**自己**名义通过；Agent 冒用**他人/admiral** 名义被拒 | `03-implementation-plan.md` §4.5 | EVT-07 |
| DEC-20 | `agentMessage` 的写入**同时**产生一条既有 `Communication`（UI 零改动可见） | `N-6` | EVT-02/04/06 |

---

## 5. LLM 测试（P1-01…P1-05、P2-01…P2-04）

| # | 断言 | 依据 | 任务 |
| --- | --- | --- | --- |
| L-1 | **mock provider 返回 schema 合法的 `AgentDecision`** | §58 | P1-01 |
| L-2 | **确定性重放**：同一 Observation + 同一 fixture ⇒ 逐字段相同的 `AgentDecision` | §8 | P1-05 |
| L-3 | 完成的指令恰好为该 Agent **重新触发一次**决策（不多不少） | §34 | P1-05 |
| L-4 | **指令被静默清除**（模拟 `fleet.ts:84` 的 `s.current = null`）⇒ 合成 `directive-failed`，Agent 不停摆 | `C-17` | P1-05 |
| L-5 | 提示词装配**不含** `enemies` / `seed` / `factions` / 他人 memory / `DecisionScore` 及其分项 | §4.3 | P1-02 |
| L-6 | 提示词文件带 `prompt_version`；`AgentDecision.promptVersion` 与之一致 | §57 / CLAUDE.md §7 | P1-02 |
| L-7 | `timeout` ⇒ `{ok:false,'timeout'}` | §6 | P2-01 |
| L-8 | 非 2xx ⇒ `'http-error'` | §6 | P2-01 |
| L-9 | 非法 JSON ⇒ `'invalid-json'` | §6 | P2-01 |
| L-10 | 结构不符 ⇒ `'schema-mismatch'` | §6 | P2-01 |
| L-11 | 无 key / provider 不可用 ⇒ `'unavailable'`，游戏**不崩溃**，退化为确定性模式 | §58 | P2-02 |
| L-12 | API key **不出现在**日志、不出现在 `Snapshot`、不进 Renderer | §7 | P2-02 |
| L-13 | 连续失败 2 次后进入退避，之后降级为确定性模式（提案 30 游戏分钟），**不无限重试** | §6 | P2-03 |
| L-14 | 每种失败都产生一条 `provider` 轨迹（可测） | §58 | P2-03 |
| L-15 | **全部 provider 测试使用 stub `fetch`，无真实网络** | — | P2-04 |

---

## 6. Scheduler 测试（P1-03、P1-04）

| # | 断言 | 依据 |
| --- | --- | --- |
| S-1 | 同一 `agentId` 同一时刻**至多一个** in-flight 决策（单飞） | §3.3 |
| S-2 | 冷却期内到达的多个触发**合并**为一个待处理标记 | §3.3 |
| S-3 | **低优先级**触发不调用 provider（spy 断言零调用），直接由分数得出确定性决策 | §3.4 |
| S-4 | 每游戏分钟最多 1 次模型调用；超出降级为确定性 | §3.3 |
| S-5 | `paused` 或 `status !== 'active'` 时 `pump()` 不做任何事 | §3.1 |
| S-6 | 舰船非空闲时调度器**延后**而非重试，也不发起 provider 调用 | `N-1` |
| S-7 | **provider 抛异常不污染 `saveBlocked`** | `N-9` |
| S-8 | `pump()` 同步返回：即使 provider 永不 resolve，`pump()` 也立即返回 | §3.1 |
| S-9 | `nextDecisionAt` 决策后按 `RULES.agentDecisionInterval` 推进，**且被持久化** | §3.2 |
| S-10 | 读档后 Agent **不会全部同时触发**决策（`nextDecisionAt` 随存档恢复） | 类比 `Enemy.nextDecision` |
| S-11 | 调度器逻辑可在 vitest 中以**假时钟 + mock provider** 直接驱动，不依赖 Electron | §8.3 |

---

## 7. Integration 测试（P0-16、P1-04、P3-01…P3-09）

| # | 断言 | 对应 EVT | 对应 `Agent.md` |
| --- | --- | --- | --- |
| I-1 | 新世界含**恰好 4 名** Agent，1:1 绑定 operator↔ship，其余 2 艘保持 `kind:'rules'` | — | CONFLICT-6 |
| I-2 | **Admiral → Agent**：下发任务后 Agent 产出评估（`accept`/`reject`/`counteroffer`） | EVT-01 | §37 |
| I-3 | **反报价**：Explorer 产出 `counteroffer` 且理由体现人格/目标/状态/信任（断言输入契约而非文本） | EVT-01/02 | §39 |
| I-4 | **组队**：Tactical 接受请求 ⇒ 提交既有 `ESCORT`，双方 `relationship.value ↑` | EVT-03 | §43 |
| I-5 | **Logistics 风险评估**：无燃料；READY/WARNING 由「弹药余量 + 船体完整度 + 路径预估」合成 | EVT-04 | CONFLICT-1 |
| I-6 | **穿越 + 发现**：`TRANSIT` → 发现异常 → `SURVEY` 候选出现并被执行；写 `discovery` 记忆；`goalProgress ↑` | EVT-05 | §48 |
| I-7 | **目标冲突**：四名 Agent 对同一状态给出**不同**意见（至少 2 种不同 `intent`/`choiceId`） | EVT-06 | §44 |
| I-8 | **Promise 路径**：`agentMessage{kind:'promise'}` ⇒ 新增 `AgentPromise{status:'pending'}`；兑现后 `status='fulfilled'` + `trust ↑` | EVT-07A | §18/§19 |
| I-9 | **Override 路径**：既有 `issueDirective`（`source:'admiral'`）+ `agentMessage{kind:'override'}` ⇒ 精确 `−10/−5/+10` + `admiral-override` 记忆 | EVT-07B | §42 |
| I-10 | **任务结果**：结算后 `goalProgress`/`experience`/`fatigue`/`morale`/`relationship`/`trust`/memory 全部按规则变化 | EVT-08 | §48/§19 |
| I-11 | **闭环（核心）**：同一 Agent，Path A 与 Path B 两次运行产生**不同的下一次决策**；`trustInAdmiral` 差异与 `choiceId` 差异同时可断言 | EVT-09 | §50 |
| I-12 | **Agent-Agent 影响**：A 的行为改变 B 的状态或选择（至少一次） | EVT-03 | 题目要求 Lv3-4 |
| I-13 | 全链路只用既有 `Action`（`ESCORT`/`TRANSIT`/`SURVEY`/`RETURN`），**未新增任何物理动作** | EVT-03/05/08 | ADR-3 |
| I-14 | 垂直切片在**离线 + mock provider** 下可完整重放 | 全部 | §51 |

**I-11 是本次 MVP 最重要的验证点**：若只有链路 A 能跑通，`Agent.md` §50 的闭环未成立。
至少需要 A 与 B 两条**对照**路径同时可复现（`02-mvp-traceability.md` §3）。

---

## 8. Regression 测试（Lv1/Lv2 不被破坏）

### 8.1 既有 184 个用例作为护栏

**除 §8.2 列出的字面量外，既有测试的语义一律不变。** 任何其它失败都意味着破坏了 Lv1/Lv2。

### 8.2 随 v11 必须调整的字面量（8 处，语义不变）

| File:line | Current | Edit |
| --- | --- | --- |
| `tests/architecture.test.ts:105` | `[5, 6, 7, 8, 11]` | `[5, 6, 7, 8, 12]` |
| `tests/persistence.test.ts:108` | `version: 11` | `version: 12` |
| `tests/mine-accidents.test.ts:186` | `toBe(10)` | `toBe(11)` |
| `tests/v10.test.ts:371` | `toBe(10)` | `toBe(11)` |
| `tests/v10.test.ts:385` | `'frontiers-v10'` | `'frontiers-v11'` |
| `tests/v10.test.ts:390` | `toBe(10)` | `toBe(11)` |
| `tests/e2e/desktop.spec.ts:174` | `toBe(10)` | `toBe(11)` |
| `tests/e2e/desktop.spec.ts:239` | `'frontiers-v10'` | `'frontiers-v11'` |

（`scripts/acceptance-v9.mjs:119` 先检查是否参与断言，属 OPTIONAL。）

### 8.3 必须保持不变的既有断言（重点盯防）

| 断言 | 位置 | 为什么会被 Lv3 波及 |
| --- | --- | --- |
| `Object.keys(port).sort()` 恰为 `['getObservation','submitAction']` | `architecture.test.ts:13` | Observation 加宽容易诱使新增 port 方法（`C-11`） |
| `controllerPort('unknown').getObservation()` 为 `null` | `architecture.test.ts:27` | 改 `getObservation` 时容易忘记 `null` 语义 |
| `port.getObservation()?.ship.id` | `architecture.test.ts:12` | 返回类型加宽后必须仍含 `ship` |
| 同 seed 同命令重放 `a.state === b.state` | `architecture.test.ts:39-60` | 任何进 `WorldState` 的非确定量（时间戳、随机、插入序淘汰）都会破坏它 |
| Migration round-trip / 分支 / `.bak` / failure | `persistence.test.ts`（13 项） | 版本升级 |
| 隐私：`JSON.stringify(getObservation(op))` 不含隐藏地点名 | `recon.test.ts:365` | memory 文本是新的泄漏向量 |
| 快照不含 `enemies`/`seed`/`factions` | `architecture.test.ts:85-102` | `snapshot()` 不得改动 |
| 非法存档必须被拒 | `architecture.test.ts:103-122` | 新增 Agent 图后需要扩展用例 |

---

## 9. Persistence 测试（P0-03、P0-04）

| # | 断言 | 依据 |
| --- | --- | --- |
| P-1 | **v10 → v11**：既有 v10 存档迁移后 `agents: []`、`agentMessages: []`、`agentInteractions: []`，其余字段**逐字段不变** | §7.3 |
| P-2 | **v9 → v11 链式**：v9 fixture 一路迁到 v11，无信息丢失，`agents` 为空数组 | §7.3 |
| P-3 | **未知版本被拒**：5/6/7/8/12 抛 `UnsupportedSaveVersionError` | `architecture.test.ts:105` |
| P-4 | **Save/load round-trip**：存盘再读，`agent.state` 逐字段相等；`memories`/`promises`/`relationships`/`nextDecisionAt` 全部保留 | §7.7 |
| P-5 | **跨存档闭环**：存档 → 读档 → Agent 的下一次决策与不存档时一致（mock provider） | §7.7 |
| P-6 | **有界淘汰确定性**：同一序列两次运行，淘汰结果一致 | §3 |
| P-7 | 集合上限被 schema 强制：`memories > 40`、`promises > 20`、`agentMessages > 200`、`agentInteractions > 200` 的存档被拒 | §3 |
| P-8 | `agentId` 唯一性与指向有效性被 schema 强制（重复/悬空被拒） | `C-15` |
| P-9 | 新 id 纳入全局唯一性集合与编号序列正则 | `C-15` |
| P-10 | `migrateV9` 在 v11 生效后仍能把 v9 迁到 v10 中间态（**专门守护 `C-14`**） | `C-14` |
| P-11 | 磁盘布局：升级后根目录为 `frontiers-v11`、索引为 `timeline-v11.json`；v10 索引可被链式迁移 | §7.4 |
| P-12 | **v10 索引存在时也会触发迁移**（守护 `persistence.ts:46` 的触发条件，`C-15`） | §7.4 |

---

## 10. Schema 一致性测试（P0-03，守护 `C-16`）

`schemas/*.json` **不被任何代码 import**（已 grep 确认），因此 Zod 与 JSON Schema 的漂移是不可见的。
且**无声明式 JSON Schema 校验器**可用（`ajv@8.20.0` 仅作为 `app-builder-lib` 的传递依赖存在——
**不得依赖传递依赖**，`C-25`）。

**方案：零依赖结构比对**。`tests/agent/schemas.test.ts`：

1. 读取 7 个 `schemas/*.json`；
2. 对每个断言关键不变量：`required` 字段集合、`enum` 成员、数值 `minimum`/`maximum`、
   `memories.maxItems === 40`、`promises.maxItems === 20`、顶层 `additionalProperties === false`；
3. 断言对应 Zod schema **接受**一个合法 fixture，且**拒绝**一个非法 fixture（缺字段 / 越界 / 未知键）；
4. 断言 `agent-action-candidate.schema.json` 的 `action.type` 枚举与 `actionSchema` 的判别式集合一致。

**可选加强（OPTIONAL）**：把 `ajv` 显式加为 devDependency，用 `zod-to-json-schema` 生成后比对。
**仅在网络允许且实施者确认收益时采用**；不采用也不影响本合同的有效性。

**已知需要在 Zod 侧对齐的两处**（`C-20`/`C-21`）：

- `agent-message.payload` **必填但可 `null`**（跟随已提交 schema，而非 `02-domain-model.md` §12 的 `payload?:`）。
- choiceId 表以 `03-implementation-plan.md` §5 的定稿为准（含 `team-accept:`/`team-decline:`）。

---

## 11. 边界与安全测试（P1-01、P2-02）

| # | 断言 | 依据 |
| --- | --- | --- |
| B-1 | `electron/agent/**` **不**被 `src/**` 引用（静态扫描 import 图） | `02-llm-boundary.md` §9 |
| B-2 | `electron/agent/**` **不** import `SimulationEngine` / `WorldState` | Rule 1 |
| B-3 | `AgentDecision` 的 Zod schema 与 `schemas/agent-decision.schema.json` 一致 | Rule 3 |
| B-4 | `choiceId` 解析失败时**绝不**回退为「让模型直接给 Action」 | Rule 3 |
| B-5 | 提示词不含 `enemies`/`seed`/`factions`/他人 memory | Rule 5 |
| B-6 | 提示词不含 `DecisionScore` 或其分项 | §46 |
| B-7 | API key 不在仓库、不进 Renderer、不进日志 | §7 |
| B-8 | 提示词文件带 `prompt_version` | CLAUDE.md §7 |
| B-9 | `mock` provider 存在且回归测试依赖它 | §3 |
| B-10 | 模型调用**不在** `step()` 调用栈内（静态断言 + 运行时断言调用栈不含 `step`） | CLAUDE.md §2.4 |
| B-11 | 无新增 IPC 通道；`electron/preload.ts` 与 `src/global.d.ts` 未改 | §7 |
| B-12 | `src/engine/agent/**` 零 `fetch`、零 `Date.now`、零 `Math.random`、零 I/O | §8.6 |

---

## 12. E2E（既有，本阶段不新增）

| 项 | 说明 |
| --- | --- |
| 命令 | `env -u ELECTRON_RUN_AS_NODE npm run test:e2e` |
| 现状 | 8 spec / 36 用例；**2 项既存失败**（`mine-accidents.spec.ts:48` Windows 文件锁 flaky；`:130` 超时 15.000s vs 需求约 15.38s），均**非引擎缺陷** |
| 环境坑 | shell 中若存在 `ELECTRON_RUN_AS_NODE=1`，全部 36 项以 `bad option` 失败；且**不要**把输出管道给 `tail`（会吞掉真实退出码） |
| Lv3 改动 | 只改 §8.2 的 2 处字面量 |
| 是否新增 Lv3 E2E spec | ❌ **不新增**（本阶段决议）。垂直切片由 `tests/agent/vertical-slice.test.ts`（Vitest，离线、快速、确定性）承担；Playwright spec 列为 POST-MVP |
| 理由 | E2E 约 15 分钟且有 2 项既存 flaky；Lv3 的核心断言不依赖 Electron，放进 E2E 只会让回归反馈变慢变脆 |

**本阶段（Prompt 3）未运行 E2E**——docs-only 阶段，见 `CLAUDE_TO_CODEX.md` 的验证记录。

---

## 13. 每阶段的测试门禁

| 阶段 | 必须通过 |
| --- | --- |
| P0 | `npm test`（既有 184 + 新增 Domain/Decision/Schema/Persistence） |
| P1 | 上述 + LLM(mock)/Scheduler/Boundary |
| P2 | 上述 + Provider（stub fetch） |
| P3 | 上述 + Integration/Vertical Slice |
| 每阶段结束 | `git status` → `git diff --check` → `npm test`（CLAUDE.md §10/§11）；`npm run build` 在阶段收尾时跑 |

**禁止**：在未实际执行的情况下声称测试通过（CLAUDE.md §10）。若某测试无法运行，记录**命令、失败原因、
是环境问题还是代码问题**。
