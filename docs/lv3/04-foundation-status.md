# Lv3 P0 实施状态（04-foundation-status）

生成日期：2026-10-08
阶段：Prompt 4 — **P0 Agent Domain Foundation**
范围：`src/engine/agent/**`、v11 持久化主干、4 名初始 Agent 引导、`agentMessage` 命令、P0 测试
未做：真实 LLM、Mock LLM Runtime、Scheduler、任何网络调用、`SimulationEngine.step()` 的任何改动

**提交**：

| Commit | 内容 |
| --- | --- |
| `e64b1df` | `feat(agent): add lv3 agent domain foundation on world v11`（P0-01…P0-14、P0-16） |
| `d335f07` | `feat(agent): add the agent message command`（P0-15） |
| 本次 | `chore(agent): document lv3 p0 foundation status` |

---

## 0. 验证记录（实际执行）

| 命令 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | **PASS**（0 error） |
| `npm test` | **PASS** — 22 files / **335 tests**（既有 184 + 新增 151） |
| `npm run build` | **PASS** — exit 0（`tsc --noEmit` + `vite build` + `tsc -p tsconfig.electron.json`） |
| `git diff --check` | **无输出** |
| `npm run test:e2e` | **未运行**（Prompt 4 §19 明示不需要；见 §7） |

基线复核：改动前实测 `npm test` = 13 files / 184 tests PASS，与 `03-test-plan.md` 的基线一致。

---

## 1. 实际创建的文件

### 1.1 `src/engine/legacy-v10/`（1 个）

| 文件 | 行数 | 说明 |
| --- | ---: | --- |
| `save-schema.ts` | 754 | 今日 v10 存档契约的冻结副本，供 `migrateV10` 校验真实 v10 文件 |

`worldSchema` 是 `ZodEffects`（`.strict().superRefine`），无法 `.omit()` 派生（`C-24`），
因此必须整份复制。**必须在修改活 schema 之前完成**——本阶段即按此顺序执行。

### 1.2 `src/engine/agent/`（13 个）

| 文件 | 行数 | 职责 |
| --- | ---: | --- |
| `types.ts` | 124 | 领域类型桶 + 派生类型（`AgentObservation`、`AgentTrigger`） |
| `schemas.ts` | 314 | Zod 运行时合同（类型由 `z.infer` 派生） |
| `personality.ts` | 55 | 5 维人格 + 四名初始取值 + 钳制 |
| `goals.ts` | 70 | `AgentGoal` / `GoalKind` / `GoalAlignment` / §48 进度 |
| `state.ts` | 167 | fatigue 分档、任务/休息/Override/Promise 的确定性增减 |
| `memory.ts` | 165 | 三类记忆、上限 40、确定性淘汰与检索 |
| `relationship.ts` | 130 | 有向关系、对称更新（team-up / conflict） |
| `promise.ts` | 134 | 承诺创建、`fulfills` 匹配、状态流转、上限 20 |
| `score.ts` | 206 | 十项 `DecisionScore`（纯函数）+ 四档阈值 |
| `actions.ts` | 481 | 候选动作生成 + choiceId 表 + 生成期合法性 |
| `observation.ts` | 122 | 单 Agent 视角装配（在既有 `snapshot()` 裁剪之上） |
| `decision.ts` | 186 | 决策校验、stale 检测、确定性 fallback |
| `interactions.ts` | 145 | 互动语义、`AgentMessage` / `AgentInteraction` 构造、上限常量 |

**纯度**：`grep -rn "Math.random|Date.now|new Date|fetch(|require(|readFileSync|process.env" src/engine/agent/` → **无匹配**（`03-test-plan.md` B-12）。

### 1.3 测试（10 个测试文件 + 1 个 helper + 4 个 fixture）

| 文件 | 行数 | 覆盖 |
| --- | ---: | --- |
| `tests/agent/support.ts` | 84 | 共享脚手架（引擎、Agent 查找、v10 fixture 构造） |
| `tests/agent/schemas.test.ts` | 245 | P0-03：零依赖 schema 一致性（`C-16` / `C-25`） |
| `tests/agent/domain.test.ts` | 543 | D-1…D-17 |
| `tests/agent/migration.test.ts` | 291 | P-1…P-12 |
| `tests/agent/bootstrap.test.ts` | 84 | I-1：4 名 Agent 与 1:1 绑定 |
| `tests/agent/actions.test.ts` | 236 | DEC-4…DEC-6、DEC-17 |
| `tests/agent/observation.test.ts` | 221 | DEC-14…DEC-16 |
| `tests/agent/decision.test.ts` | 448 | DEC-1…DEC-3、DEC-7…DEC-13 |
| `tests/agent/interactions.test.ts` | 121 | D-17 |
| `tests/agent/command.test.ts` | 214 | DEC-19、DEC-20 |
| `tests/fixtures/agent/*.json` | 4 个 | `valid-agent` / `valid-decision` / `valid-message` / `valid-action-candidate` |

---

## 2. 实际修改的文件

| 文件 | 改动 |
| --- | --- |
| `src/engine/types.ts` | Agent 类型桶再导出；`Operator.kind` 加宽 + `agentId?`；`WorldState`/`SnapshotData` → 11；新增 `agents`/`agentMessages`/`agentInteractions`；`Command` 加 `agentMessage`；`SimulationEvent` 加 `agentTrigger`；`AgentControllerPort.getObservation(): AgentObservation \| null`；删除 `ObservationData` 与 `legalActions` |
| `src/engine/commands.ts` | 新增 `agentMessageKindSchema` / `agentRequestTypeSchema` / `messagePayloadSchema`（+ 导出类型）；`commandSchema` **追加** `agentMessage` 分支；给 `careerSchema` 加注释说明它**不是** `AgentCareer`（`C-8`） |
| `src/engine/command-system.ts` | 抽出 `validateActionIn(w, s, a)`（`validateAction` 变为一行委托）；`validate` 加 `agentMessage` 参与者校验；`validate` 的 actor 门**追加一条**最小放宽；`dispatchCommand` **追加** `agentMessage` 分支 + 两个有界淘汰 helper |
| `src/engine/save-schema.ts` | `version: z.literal(11)`；`operator.kind: z.enum(['rules','agent'])` + 可选 `agentId`；三个新集合 + `.max()`；`superRefine` 新增 Agent 图不变量；编号序列正则加 `agent`/`agent-message`/`agent-interaction` |
| `src/engine/saves.ts` | `CURRENT_SAVE_VERSION = 11`；新增 `migrateV10`；`migrateV9` 末尾改走 `migrateV10`（**C-14**）；`parseSave` 闸门加 10 |
| `src/engine/data.ts` | `version: 11`；`INITIAL_AGENTS`（4 名）+ `initialAgentState()`；operator 由 agents 派生（4 名 `kind:'agent'`，2 名保持 `kind:'rules'`）；`nextId` 在所有既有分配之后推进 4 |
| `src/engine/projection.ts` | `getObservation` 加宽为 `AgentObservation \| null`，装配委托给 `agent/observation.ts`，移除 `legalActions`；`snapshot()` **一行未改** |
| `src/engine/engine.ts` | **未修改**（`AgentTrigger` 的发射属 P1-05） |
| `src/engine/definitions/rules.ts` | **追加** `agentDecisionInterval: 15`（`decisionInterval` 未动，`C-18`） |
| `electron/persistence.ts` | 根目录/索引从 `CURRENT_SAVE_VERSION` 派生；`indexSchema` 版本跟随；迁移触发条件改为「无当前索引 **且** 存在 v10 或 v9 索引」；`migrateTimeline(sourceVersion)` 泛化为链式；三处字符串提示语去掉版本号 |
| `tests/architecture.test.ts` | `:105` `11` → `12` |
| `tests/persistence.test.ts` | `:108` `version: 11` → `12` |
| `tests/mine-accidents.test.ts` | `:186` `toBe(10)` → `toBe(11)` |
| `tests/v10.test.ts` | `:371`/`:390` `10`→`11`；`:385` `frontiers-v10`→`frontiers-v11`；`:409` 合成 v9 fixture 补删三个 v11 键（见 §5.2） |
| `tests/e2e/desktop.spec.ts` | `:174` `10`→`11`；`:239` `frontiers-v10`→`frontiers-v11` |
| `scripts/acceptance-v9.mjs` | `:88` 断言 `version` 10→11；`:119` 报告标签 10→11 |
| `scripts/smoke-package.mjs` | `:28` 断言 `version` 10→11（见 §5.2） |

**未修改**（按计划保持不变）：`src/engine/legacy-v9/**`、`src/engine/v9-schema.ts`、`commands.ts` 的 `careerSchema` 与 `actionSchema`、`engine.ts` 的 `step()`/`advanceFrame`、`fleet.ts`、`sensors.ts`、`world-events.ts`、`execution.ts`、`src/ui/**`、`electron/preload.ts`、`src/global.d.ts`、`schemas/*.json`、`package.json`（`prompts/**` 属 P1）。

---

## 3. 已实现的 P0 能力

| 任务卡 | 状态 | 落点 |
| --- | --- | --- |
| P0-01 冻结 v10 schema | ✅ | `legacy-v10/save-schema.ts` |
| P0-02 Agent 类型 + v11 形状 | ✅ | `agent/types.ts`、`src/engine/types.ts` |
| P0-03 Zod 合同 + schema 一致性 | ✅ | `agent/schemas.ts`、`tests/agent/schemas.test.ts` |
| P0-04 v11 持久化 + 迁移链 | ✅ | `save-schema.ts`、`saves.ts`、`electron/persistence.ts` |
| P0-05 人格 + 目标 | ✅ | `personality.ts`、`goals.ts` |
| P0-06 状态更新规则 | ✅ | `state.ts` |
| P0-07 有界记忆 | ✅ | `memory.ts` |
| P0-08 关系 | ✅ | `relationship.ts` |
| P0-09 承诺 | ✅ | `promise.ts` |
| P0-10 DecisionScore | ✅ | `score.ts` |
| P0-11 候选动作 + choiceId | ✅ | `actions.ts` |
| P0-12 Observation + 加宽 | ✅ | `observation.ts`、`projection.ts` |
| P0-13 决策校验 + fallback | ✅ | `decision.ts` |
| P0-14 互动 + 消息 | ✅ | `interactions.ts` |
| P0-15 `agentMessage` 命令 | ✅ | `commands.ts`、`command-system.ts` |
| P0-16 初始名册 + 收口 | ✅ | `data.ts`、`tests/agent/**` |

**测试矩阵覆盖**：D-1…D-17、DEC-1…DEC-10 与 DEC-12…DEC-20、P-1…P-12、I-1 全部有对应断言。
DEC-11（「非 `act` 意图不调用 `submitAction`，用 spy 断言零调用」）需要 runtime 才能断言，属 P1；
P0 覆盖它的一半：社交 choiceId **不能**以 `intent: 'act'` 通过校验（`decision.test.ts`）。
任务卡 `03-test-plan.md` §2 中属于 P0 的 9 个测试文件全部创建。

**完成条件复核**（Prompt 4 §20）：

```text
Agent Domain 可独立创建          ✅  createWorld() / createPromise() / createGoal() 等
可保存/序列化为结构化数据        ✅  过 worldSchema v11；round-trip 逐字段相等
可测试                          ✅  151 个纯领域用例
不依赖 LLM                      ✅  src/engine/agent/** 零 fetch / 零 provider
不依赖 Network                  ✅  同上
不依赖 SimulationEngine Runtime  ✅  agent/actions.ts 只读 WorldState；其余模块连 WorldState 都不需要

Agent ≠ Ship                    ✅  Agent 无 hull/shield/position；绑定走既有 Assignment
AgentDecision ≠ GameAction      ✅  decision 只有 choiceId；Action 由引擎侧按 id 取出
Agent Domain ≠ SimulationEngine ✅  唯一交叉点是 projection.getObservation 的装配调用
```

---

## 4. 尚未实现（按设计留给后续阶段）

### 4.1 留给 P1（Mock Decision Runtime）

- `electron/agent/**`（6 个文件）：`model-client` / `mock-client` / `prompt` / `scheduler` / `runtime` / `openai-compatible`
- `prompts/agent/*.md` 与 `package.json` 的 `build.files` 追加 `prompts/**/*`
- `AgentTrigger` 的**发射**（9 个 `pendingEvents` push 点：`engine.complete()`、`fleet.ts`、`sensors.ts`、`world-events.ts`、`agentMessage` 分支、promise 变更处）
- Scheduler：单飞 / 冷却 / 合并 / 每游戏分钟上限 / `nextDecisionAt` 推进
- Runtime：`submitAction` 接线、提交前 stale 复核、失败降级轨迹
- 确定性重放测试（L-1…L-6）、S-1…S-11、边界测试 B-1…B-12

### 4.2 留给 P2（Live DeepSeek Runtime）

- `openai-compatible.ts`（内建 `fetch` + `AbortController` 超时）
- 环境变量配置、日志脱敏、六类 `ModelError` 分类、有限重试 + 退避、熔断降级
- L-7…L-15

### 4.3 留给 P3（Integration / Vertical Slice）

- EVT-01…EVT-09 的接线与两条对照链路（Promise → Trust↑ / Override → Trust↓）
- `AgentInteraction.outcome` 在真实协商中被写入 `accepted`/`rejected`/`countered`
- 任务结算后把 `resolveFulfillments` 的信号来源接到既有 `REFIT` / upgrade / rest 完成点
- I-2…I-14

### 4.4 POST-MVP（不在 P0–P3 内）

技能成长、`GoalCondition[]` 条件求值器、Quit/Leave、Vector DB / 语义检索、Renderer 侧 Agent 管理界面
（依据 `03-implementation-plan.md` §10）。

---

## 5. 实现层调整（Architecture decision → Actual implementation → Reason）

### 5.1 `AgentStateDelta` 增加两个字段

- **Approved**：`02-domain-model.md` §13 的 `AgentStateDelta` = `{ trustInAdmiral, loyaltyToCompany, morale, stress, fatigue, relationship? }`。
- **Actual**：另加**必填**的 `goalProgress` 与 `experience`（`agent/schemas.ts` 的 `agentStateDeltaSchema`）。
- **Reason**：`02-decision-flow.md` §5 要求任务结算改变 `goalProgress`/`experience`，并在同一句里要求「每次更新都写入 `AgentInteraction.effects`」。没有这两个字段，`Agent.md` §48 的 Goal Progress 断言就没有可断言的对象（`03-test-plan.md` D-2/D-17 无法成立）。二者都是数值增量，无需新机制。

### 5.2 新增两处版本字面量（8 → 10）

- **Approved**：`03-file-change-plan.md` §4.16–4.20 列出 8 处。
- **Actual**：另加 ① `tests/v10.test.ts:409` 的合成 v9 fixture 需删除 `agents`/`agentMessages`/`agentInteractions`（否则那个对象已带 v11 键，被冻结的 `legacyV9Schema` 以 `unrecognized_keys` 拒绝）；② `scripts/smoke-package.mjs:28` 的 `assert.equal(initial.version, 10)`。
- **Reason**：两者都是版本升级的机械后果，与那 8 处同类。① 属于「测试断言了一个不再是 v9 形状的对象」，② 是打包冒烟脚本里的版本断言。**未扩大语义范围**：两者的断言意图都不变，只是数值跟随版本。

### 5.3 choiceId 表新增 `transit:`

- **Approved**：`03-implementation-plan.md` §5 的表未列 `TRANSIT`。
- **Actual**：新增 `transit:<wormholeId>` → 既有 `TRANSIT { targetId }`。
- **Reason**：同一份计划的 `KNOWN_ISSUES` N-8 明确要求「`TRANSIT` 候选要求虫洞已 `discovered`」，且 MVP 场景 EVT-05 的核心动作就是穿越虫洞。表格漏列，不是设计禁止。

### 5.4 `messagePayloadSchema` / `agentMessageKindSchema` 放在 `commands.ts`

- **Approved**：`02-domain-model.md` §12 把 `MessagePayload` 归入 Agent 领域。
- **Actual**：Zod 定义落在 `src/engine/commands.ts`，由 `agent/types.ts` 再导出。
- **Reason**：`commandSchema` 需要它，而 `agent/schemas.ts` 需要 `actionSchema`。若定义放在 agent 侧，就形成 `commands → agent/schemas → commands` 的求值环，`actionSchema` 在 `agent/schemas.ts` 求值时仍处于 TDZ，会直接抛 `ReferenceError`。语义归属不变（类型仍从 agent 层导出）。

### 5.5 `ValidationResult` 新增 `'stale'` 错误码

- **Approved**：`03-api-contract.md` §4.5 的 `ValidationResult` 复用 `ModelError` 的六个码，同时又要求校验 ④「`observationTick` 未过期」。
- **Actual**：`ValidationError = ModelError | 'stale'`。
- **Reason**：`03-api-contract.md` §6 的失败表把「Observation 过期」单列，且明确它**不 fallback**，而其余六类都 fallback。把它压进六个 provider 码之一，调用方就无法区分该走哪条路——这会让契约里最重要的一条失败语义变得不可实现。

### 5.6 fallback 的 REJECT 档映射

- **Approved**：`02-decision-flow.md` §3.5 写 `< 25 → REJECT`。
- **Actual**：`schemas/agent-decision.schema.json` 的 `intent` 枚举**没有** `reject`（只有 `act|wait|request|invite|respond|rest|quit`）。因此分数 `< 25` 时：若菜单里有 `reject`（即确实有未回复的任务邀约），产出 `intent: 'respond'` + `choiceId: 'reject'`；否则产出 `intent: 'wait'`。
- **Reason**：JSON Schema 是已批准合同且本阶段禁改（CLAUDE.md §6）。把「拒绝」表达为社交回应与 `03-api-contract.md` §3 的路由一致（非 `act` 意图一律走互动层），而「没有邀约可拒」时等待是唯一不会造成伤害的选择。

### 5.7 社交候选携带占位 Action

- **Approved**：`agent-action-candidate.schema.json` 把 `action` 列为 `required`；`03-implementation-plan.md` §5 又说 `accept`/`reject`/`counteroffer`/`team-*` 是「无（社交决策）」。
- **Actual**：社交候选仍带一个 `{ type: 'MOVE', point: <舰船当前位置> }` 占位；`decision.ts` 拒绝 `intent: 'act'` + 社交 choiceId 的组合。
- **Reason**：schema 不可改。占位动作是零位移 MOVE（最无害的既有动作），而 `decision.ts` 的守卫保证它**永远不会**被当作物理动作提交——`accept` 只能以社交意图被选中。两条测试（DEC-9 变体、`decision.test.ts`）锁定这条守卫。

### 5.8 `company.priorities` 的取值来源

- **Approved**：`02-domain-model.md` §9 写「由玩家设定的当前任务焦点」。
- **Actual**：`WorldState` 里没有玩家设定的 priorities 字段，因此从既有的 Admiral `Directive` 派生：`ship.current.source === 'admiral'` 时为 `[actionType]`，否则为 `[]`。
- **Reason**：不发明新的持久化字段（CLAUDE.md §6），只用世界里真实存在的意图声明。

### 5.9 记忆/承诺/消息/互动的 id 前缀

- **Approved**：`03-file-change-plan.md` §4.2 只要求「把 `agent` 前缀加入编号序列正则」。
- **Actual**：`agent-<n>`（Agent）、`agent-message-<n>`、`agent-interaction-<n>`、`agent-memory-<n>`，共用既有 `nextId`；正则加三个前缀（memory id 不在一级集合里，不参与该断言）。
- **Reason**：沿用 `Enemy.nextDecision` / `Communication.nextComms` 的既有分配方式，保持「编号 < `nextId`」不变式；不新增 `nextAgentMessage` 之类的计数字段。

### 5.10 未采用的项（明确记录）

| 项 | 决定 |
| --- | --- |
| `02-persistence-strategy.md` §5「根目录/索引由版本常量驱动，改一处即可」 | 与代码不符（全仓库无版本常量）。本阶段**改为**从 `CURRENT_SAVE_VERSION` 派生，使该描述从此成立（`C-15`） |
| `02-decision-flow.md` §6 与 §4.3 时序图里的 `controllerPort.resolve(choiceId)` | 未实现。按 `03-implementation-plan.md` §4.2 在 Agent 层解析，port key 集合保持两个（`C-11`） |
| 第二条观察通路 `engine.getAgentObservation(agentId)` | 未实现（CLAUDE.md §4） |
| `RULES.decisionInterval` 复用 | 未复用，新增 `agentDecisionInterval`（`C-18`） |

---

## 6. 已知问题 / 限制

| # | 内容 | 影响 | 处置 |
| --- | --- | --- | --- |
| 1 | 权重与初始数值是**提案**（DecisionScore 十项权重、初始 psych state、PROMISE_KEPT/BROKEN 幅度、`TAG_GOALS` 映射、各候选类别的 risk/reward 基数） | 决策质量尚未校准 | P3 用实际决策结果校准；本阶段只固定**结构与输入来源**，测试断言方向与记录值，不断言「数值正确」 |
| 2 | `legacy-v10/save-schema.ts` import **活的** `../commands`、`../v9-schema`、`../capabilities`（按 `03-file-change-plan.md` §3.1），而 `legacy-v9/` 自带冻结副本 | 未来若改动 `actionSchema` / `v9-schema` / `capabilities`，会**同时**影响 v10 校验 | 已按批准计划执行；`actionSchema` 被计划明令 Lv3 不改。若后续需要更严格的冻结，另立设计决策 |
| 3 | `v10World()` 是「把当前世界降级」构造的 v10 形状对象，而非历史存档样本 | 覆盖字段集合，但不覆盖历史数值分布 | 已用 `legacyV10Schema.safeParse` 证明它是**真** v10 形状；真实玩家存档的迁移由 `tests/v10.test.ts` 的 v9 fixture 链覆盖 |
| 4 | `AgentMessage` 一旦 `read` 就不会再进入 `pendingMessages`，但 P0 没有任何东西把它置 `read` | 未读消息会持续出现在 observation 里 | 由 P1/P3 的 runtime 在消费后置位；P0 只固定「未读 = 待处理」的语义 |
| 5 | `AgentTrigger` 已定义但无人发射 | `SimulationEvent` 多一个永不出现的变体 | 计划内的 P1-05 增量；不影响重放断言（瞬时通道） |
| 6 | DEC-11 的「非 `act` 意图不调用 `submitAction`（spy 断言）」 | 需要 runtime 才能断言 | 属 P1（`tests/agent/runtime.test.ts`）；P0 已断言的是「社交 choiceId 不能以 `intent:'act'` 通过校验」 |
| 7 | E2E 未运行 | `tests/e2e/desktop.spec.ts` 的两处字面量已改但未验证 | Prompt 4 §19 明确不需要；计划本身也把 Lv3 E2E 定为 POST-MVP |
| 8 | `agentDecisionInterval = 15` 尚无消费者 | 未使用的规则常量 | 计划内的 `SHOULD` 追加项，P1 的 Scheduler 消费；不影响任何既有行为 |

---

## 7. 遗留冲突登记（未新增未登记冲突）

`03-*` 之间、与 `schemas/*.json`、`02-*.md`、`Agent.md`、`01-mvp-scenario.md` 的矛盾全部记录在 §5（实现层调整）。
`KNOWN_ISSUES.md` 的 `CONFLICT-1…7` 与 `C-8…C-25` 中的 P0 相关项（`C-8`/`C-11`/`C-12`…`C-15`/`C-18`/`C-19`/`C-20`/`C-21`/`C-24`/`C-25`）均已按其 Resolution 落实；
`C-14`/`C-15` 另有专门守护测试（`migration.test.ts` 的 `still migrates a v9 save all the way to v11`、`triggers a migration when only a v10 index exists`）。

**没有发现需要停下来上报的未登记冲突。**

---

## 8. 推荐下一阶段

**P1 — Mock Decision Runtime**（`03-implementation-plan.md` §3.2）。

建议入口：

1. `electron/agent/model-client.ts` + `mock-client.ts`（`ModelClient` 接口 + fixture provider）
2. `prompts/agent/*.md` + `electron/agent/prompt.ts`（含 `prompt_version`，与 `AGENT_PROMPT_VERSION` 对齐）+ `package.json` 的 `build.files`
3. `AgentTrigger` 发射（`engine.complete()` → `fleet.ts` → `sensors.ts` → `world-events.ts` → `agentMessage` 分支；**只允许追加行**）
4. `electron/agent/scheduler.ts`（单飞/冷却/合并/上限，`pump()` 同步、不 `await`）+ `runtime.ts`
5. `tests/agent/{boundary,replay,scheduler,runtime}.test.ts`

**P1 不要重写**：`src/engine/agent/**`（P0 的领域合同）、`src/engine/legacy-v10/**`、`src/engine/legacy-v9/**`、
v11 的 `superRefine` 不变量、`agentMessage` 的权限门、`AgentControllerPort` 的 key 集合。
