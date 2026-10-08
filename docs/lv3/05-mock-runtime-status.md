# Lv3 P1 实施状态（05-mock-runtime-status）

生成日期：2026-10-08
阶段：Prompt 5 — **P1 Mock Decision Runtime**
范围：`electron/agent/**`、`prompts/agent/**`、`src/engine/agent/decision.ts` 的校验扩展、P1 测试与 fixture
未做：真实 LLM、DeepSeek、任何网络调用、Scheduler、`SimulationEngine` 接线、`ControllerPort` 调用、持久化、UI

---

## 0. 验证记录（实际执行）

| 命令 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | **PASS**（0 error） |
| `npm test` | **PASS** — 27 files / **402 tests**（P0 基线 22 files / 335 tests + 新增 5 files / 67 tests） |
| `npm run build` | **PASS** — exit 0（`create-icon` + `tsc --noEmit` + `vite build` + `tsc -p tsconfig.electron.json`） |
| `git diff --check` | **无输出** |
| `npm run test:package` | **未运行**（需先 `npm run package` 产出 `release/win-unpacked`；P1 不改变打包内容之外的行为） |
| `npm run test:e2e` | **未运行**（P1 未接宿主循环；`tests/e2e/desktop.spec.ts` 本次未改） |

改动前实测基线：`npm test` = 22 files / 335 tests PASS，与 `04-foundation-status.md` §0 一致。

---

## 1. 本阶段建立的管线（实际可执行的）

```text
AgentObservation
    ↓  buildDecisionRequest            electron/agent/prompt.ts
DecisionRequest { observation, systemPrompt, decisionPrompt, schema, timeoutMs }
    ↓  ModelClient.decide              electron/agent/model-client.ts（接口）
ModelResult                            electron/agent/mock-client.ts（实现）
    ↓  Schema + choiceId + addressability   src/engine/agent/decision.ts#validateDecisionShape
    ↓  + staleness                          src/engine/agent/decision.ts#validateDecision
Validated AgentDecision

任一步失败（除 stale）
    ↓  fallbackDecision(scoringAgent(observation), observation)
Valid Deterministic Decision（同一结构，仅 provider 字段不同）
```

---

## 2. 实际创建的文件

### 2.1 `electron/agent/`（4 个）

| 文件 | 行数 | 职责 |
| --- | ---: | --- |
| `model-client.ts` | 59 | `ModelClient` / `DecisionRequest` / `ModelResult` 契约 + `ModelError` 再导出。**只有接口，无实现、无网络** |
| `prompt.ts` | 336 | 读取 `prompts/agent/*.md` 并校验 `prompt_version` 一致；`renderSituation(observation)`；`buildDecisionRequest` |
| `mock-client.ts` | 107 | `MockModelClient`：规则脚本驱动的离线 provider；可模拟 timeout / http-error / unavailable / invalid-json / schema-mismatch / invalid-choice-id / 抛异常 |
| `runtime.ts` | 216 | `DecisionRuntime.requestDecision(observation)`：装配 → 调用 → 校验 → 降级；`scoringAgent`；`DecisionTrace` |

### 2.2 `prompts/agent/`（4 个，均带 `prompt_version: agent-v1`）

| 文件 | 用途 |
| --- | --- |
| `system.md` | Agent 身份与硬边界（`Agent.md` §56：不写「你是一个 AI」） |
| `decision.md` | 决策任务与输出格式 |
| `conversation.md` | ASK / NEGOTIATE 的说话方式 |
| `reflection.md` | 结算后的自述原则（P1 不消费，属版本化资产） |

### 2.3 测试与 fixture

| 文件 | 用例数 | 覆盖 |
| --- | ---: | --- |
| `tests/agent/provider.test.ts` | 15 | L-1、L-2、六类 provider 失败、抛异常、provider 不判 staleness |
| `tests/agent/runtime.test.ts` | 24 | 校验三层、stale 不降级、八种失败降级、DEC-11、§十二 四 Agent 分歧、§十三 Memory/Trust 影响、隔离性 |
| `tests/agent/replay.test.ts` | 4 | L-2 确定性重放（两个独立世界 + 多步序列 + 降级路径） |
| `tests/agent/prompt.test.ts` | 12 | L-5、L-6、B-5、B-6、B-8、装配契约 |
| `tests/agent/boundary.test.ts` | 12 | B-1、B-2、B-9、B-10、B-11、B-12、无网络、无新 IPC |
| `tests/fixtures/agent/scenarios.json` | — | EVT-01…EVT-09 录制决策 + 8 个失败样本 |

**合计新增 67 个用例**，全部离线、无网络、可用 `npx vitest run tests/agent` 单独执行。

---

## 3. 实际修改的文件

| 文件 | 改动 | 说明 |
| --- | --- | --- |
| `src/engine/agent/decision.ts` | 抽出 `validateDecisionShape`（结构 + choiceId 归属 + 目标可达）；新增 `addressableAgents`；`validateDecision` 变为「shape + stale」；`parseDecisionText` 改用 shape 版 | 见 §5.1–§5.3 |
| `tests/agent/support.ts` | 追加 `REPO_ROOT`、`agentRuntime`、`offerMission`、`requestTeamUp`、`careerIds`、`scenarioRule(s)`、`failureRule`、token 解析 | 纯追加，未改既有导出 |
| `package.json` | `build.files` 追加 `prompts/**/*`、`schemas/**/*` | 见 §5.5 |

**未修改**（P1 明令保持）：`electron/main.ts`、`electron/preload.ts`、`electron/persistence.ts`、`src/engine/engine.ts`、`src/engine/projection.ts`、`src/engine/command-system.ts`、`src/engine/types.ts`、`src/engine/save-schema.ts`、`src/engine/agent/**` 的其余 12 个文件、`schemas/*.json`、`src/ui/**`。

---

## 4. 本阶段达成的能力（对照任务书 §22）

```text
AgentObservation → Mock Decision Provider → AgentDecision
                 → Schema Validation → Decision Validation → Validated Decision   ✅
Provider Failure → Fallback → Valid Deterministic Decision                          ✅
同一 Observation + 同一 Fixture ⇒ 同一 Decision（逐字段相等）                        ✅
```

- **Decision Provider 抽象**：`ModelClient` 接口不含任何 provider 细节；`MockModelClient` 与未来的 DeepSeek provider 同为实现。
- **Mock Provider 二选一中的方式 A + B 都支持**：固定 fixture（`scenarios.json`）与按 Observation 谓词匹配的确定性规则（`MockRule.match`）并存。
- **两层校验**：provider 侧 `validateDecisionShape`；runtime 侧 `validateDecision`（再加 stale）。runtime **不信任** `{ ok: true }`——用一个「说谎的 provider」stub 断言了这一点。
- **确定性 fallback**：`fallbackDecision`（P0 已有）在 runtime 层被调用；provider 抛异常、超时、返回非法 JSON / 结构不符 / choiceId 越界，全部产出同一种结构、`provider: 'deterministic'` 的决策。
- **stale 不降级**：唯一被整条丢弃的失败（`docs/lv3/02-decision-flow.md` §3.5）。
- **可重放**：`replay.test.ts` 用两个独立构建的世界 + 三步序列证明逐字段相等。
- **可追踪**：`DecisionTrace`（agentId / decisionId / observationTick / observationTime / provider / promptVersion / outcome / providerFailure / fallbackUsed / reason / decision）经 `onTrace` 回调产出，**不落盘**。

---

## 5. 实现层调整（Approved Design → Actual Implementation → Reason）

### 5.1 `validateDecision` 的 choiceId 归属检查扩展到所有 intent

- **Approved**：`03-api-contract.md` §4.5 的校验清单 ③ 写作「`intent === 'act'` 时 `choiceId` ∈ `availableActions` 的 id 集合」，即**只**对 `act` 检查。
- **Actual**：只要 decision 带了 `choiceId`，就必须是菜单里的 id（`decision.ts#validateDecisionShape`）。`act` 的额外规则（不得是社交 id）不变。
- **Reason**：本阶段任务书 §7.2 明确要求「Decision 是否符合当前 Observation 所允许的选择」。只查 `act` 会放行 `intent: 'respond'` + 菜单外的 `choiceId`。
- **兼容性**：P0 的 9 个 decision 用例**全部原样通过**；`fallbackDecision` 产出的 social choiceId 本来就取自菜单。

### 5.2 新增 `addressableAgents` 与「目标必须可达」检查

- **Approved**：`03-api-contract.md` §4.5 未列此项。
- **Actual**：`request.targetAgentId` 必须出现在该 Agent 自己的 `relationships` 名单里，且不得是自己。
- **Reason**：任务书 §7.2 的第二个例子（「Agent A → request Agent B，如果 Observation 中 Agent B 不可见…→ invalid decision」）。
- **错误码**：复用 `invalid-choice-id`——六类 `ModelError` 是已批准合同（`schemas/` 不可改），而这条失败的语义正是「指名了一个没被提供的东西」。

### 5.3 `validateDecisionShape` / `ShapeValidationResult` 的拆分

- **Approved**：§4.4 把「JSON 解析 + Zod + choiceId 归属」划给 provider，§4.5 把「④ observationTick 未过期」划给 runtime。
- **Actual**：`validateDecisionShape` 返回不含 `'stale'` 的 `ShapeValidationResult`；`validateDecision` = shape + stale；`parseDecisionText` 返回类型同步收窄。
- **Reason**：不拆的话，Mock Provider 只能二选一——跳过结构校验（违反 §4.4），或在 provider 里判过期（违反 §4.5 与 §6 的「过期不 fallback」）。
- **兼容性**：`ValidationResult` 的对外形状未变；`validateDecision` 的调用方语义未变。

### 5.4 Runtime 从 Observation 重建评分用的 `Agent`（`scoringAgent`）

- **Approved**：§4.3 写 `DecisionEngine` 的输入是「`AgentObservation` + `Agent`」。
- **Actual**：runtime 只拿得到 `AgentObservation`（§4.7：它不持有 `WorldState`），因此由 `scoringAgent(observation)` 还原 `career / personality / state / goal / relationships / promises`。
- **Reason**：`AgentObservation` 本就是按「这个 Agent 决策所需的一切」设计的，字段一一对应；`activePromise` 就是 `activePromise(agent.promises)` 的结果，还原无损。
- **副产品**：这正是任务书 §13 想要的性质——**过去只通过 Observation 影响未来**，没有第二条暗路。

### 5.5 `build.files` 追加 `schemas/**/*`

- **Approved**：`03-file-change-plan.md` §4.10 只列了 `prompts/**/*`。
- **Actual**：同时追加 `schemas/**/*`。
- **Reason**：`loadDecisionSchema(root)` 从 app 根读取 `schemas/agent-decision.schema.json`。不追加的话，打包后的应用拿不到 provider 的输出契约（`prompt.ts` 的 `DecisionRequest.schema` 会是空的）。

### 5.6 提示词为中文，`prompt_version` 用 HTML 注释承载

- **Approved**：`02-llm-boundary.md` §4.1 规定四个文件名与「每个文件带 `prompt_version`」，未规定格式与语言。
- **Actual**：文件首行 `<!-- prompt_version: agent-v1 -->`；正文中文。
- **Reason**：注释行对 Markdown 渲染无副作用且可正则解析；正文语言与游戏一致（`tests/fixtures/agent/valid-decision.json` 的 `reason`/`say` 已是中文，且 `say` 要能直接进既有 `Communication` 显示）。

### 5.7 fixture 的 choiceId 令牌（`#first:` / `#agent:` / `#team-accept:`）

- **Approved**：未规定 fixture 形式。
- **Actual**：录制里的 `choiceId` 可以写成令牌，由 `tests/agent/support.ts#resolveToken` 在测试侧解析。
- **Reason**：`survey:<bodyId>`、`explore:<q>/<r>` 依赖 seed。写死会让「同一 fixture 可重放」只在某一个世界上成立，L-2 就成了空话。令牌让录制与 seed 无关。

### 5.8 未采用的项（明确记录）

| 项 | 决定 |
| --- | --- |
| `03-implementation-plan.md` §3.2 把 Scheduler、宿主循环接线、`AgentTrigger` 发射算在 P1 | **未实现**——本阶段任务书 §2/§15/§21 明令不含 Scheduler 与 `SimulationEngine` 接线。见 §7 |
| `.claude/rules/lv3-agent.md` | **不存在**（已确认），故未读取 |
| `Agent.md` §32 的 `ModelClient.decide(observation): Promise<AgentDecision>` 签名 | 未采用。以 `02-llm-boundary.md` §3 / `03-api-contract.md` §4.4 的 `DecisionRequest`/`ModelResult` 为准（前者是 §32 的早期简写，后者是批准的最终契约） |

---

## 6. 未实现（明确不在 P1）

| 项 | 现状 |
| --- | --- |
| DeepSeek / 任何真实 LLM | **NOT CONNECTED**——`openai-compatible.ts` 不存在，仓库内无 `fetch` / `axios` / SDK / `process.env`（`boundary.test.ts` 静态断言） |
| 网络调用 | **无**。`electron/agent/**` 只读 `prompts/`、`schemas/` 两个本地目录 |
| Scheduler | **NOT CONNECTED**——单飞 / 冷却 / 合并 / 每游戏分钟上限 / `nextDecisionAt` 推进均未实现 |
| `SimulationEngine` 接线 | **NOT CONNECTED**——`engine.ts` 一行未改；无 `AgentTrigger` 发射 |
| `ControllerPort` 接线 | **NOT CONNECTED**——`electron/agent/**` 源码中不出现 `controllerPort` / `submitAction`（静态断言） |
| `choiceId` → `Action` → `submitAction` | **未实现**（P3） |
| 持久化 | **NOT INTEGRATED**——`DecisionTrace` 只经回调产出，不写 `SaveStore`，`save-schema` 未动 |
| UI | **无改动**——`preload.ts` 仍是 5 个 `invoke`，无新 IPC 通道 |
| Agent-Agent runtime | **未实现**——fixture 里有 `team-accept:<id>` 录制，但没有「A 请求 → 触发 B 决策」的回路 |
| `reflection.md` 的消费 | **未实现**——文件已版本化并参与版本一致性校验，但 P1 不生成自述 |
| P2 的六类错误分类 / 重试 / 退避 / 熔断 | **未实现**（P2） |

---

## 7. 推荐下一阶段

**P2 — Live DeepSeek Runtime**（`03-implementation-plan.md` §3.3），范围限定为：

1. `electron/agent/openai-compatible.ts`（内建 `fetch` + `AbortController` 超时）
2. 环境变量配置（仅主进程）、日志脱敏（不记 key / 不记隐藏状态）
3. `ModelError` 六类分类落地、有限重试（≤2）+ 指数退避、无 key 时退化为确定性
4. `tests/agent/provider.test.ts` 的 stub-`fetch` 用例：L-7…L-15

**P2 不要重写**：`electron/agent/model-client.ts` 的契约、`prompt.ts` 的装配与版本校验、
`runtime.ts` 的校验/降级顺序、`src/engine/agent/decision.ts` 的两层校验、
`tests/fixtures/agent/scenarios.json` 的令牌约定。

**Scheduler（P1 未做，需补）**：`electron/agent/scheduler.ts` + `electron/main.ts` 的 `pump()` 接线 + `AgentTrigger` 发射，
建议单独一阶段（`03-implementation-plan.md` §8 的 S-1…S-11 用例）。**它必须在 P3 之前完成**，
否则 `validated decision` 没有消费者。

---

## 8. 已知限制

| # | 内容 | 影响 | 处置 |
| --- | --- | --- | --- |
| 1 | `DecisionRuntime` 目前无生产调用点（P1 不接宿主） | 代码已通过 67 个用例，但未在 Electron 中运行过 | 属计划内；Scheduler 阶段接线 |
| 2 | `MockModelClient` 是脚本 provider，不是「会思考的假模型」 | 它只能证明「观测携带状态、provider 能据此分化」，不能证明模型质量 | 与任务书 §13 的表述一致：本阶段不证明 LLM 的智能 |
| 3 | `scoringAgent` 丢弃了 `Agent.id` 之外的持久字段（`nextDecisionAt` 用 `observation.time` 顶替） | 无——`DecisionScore` 不读该字段 | 若未来某个评分项需要它，需先把它加进 Observation |
| 4 | `validateDecisionShape` 的错误码复用 `invalid-choice-id` 表示「目标不可达」 | 调用方无法从错误码区分两种失败 | 六类 `ModelError` 是已批准合同、本阶段禁改；`DecisionTrace.reason` 保留可读描述 |
| 5 | fixture 令牌解析失败会 **throw** | 测试脚手架而非生产代码；失败信息已包含令牌原文 | 有意为之：静默降级会让一条录制悄悄失效 |
| 6 | `prompts/agent/*.md` 的内容质量未被验证（只验证了版本、边界与可达性） | 提示词好不好，P2 接上真实模型才知道 | 属 P2 的调优范围 |
| 7 | `npm run test:package` / `test:e2e` 未运行 | 打包产物与 E2E 路径本次未验证 | P1 未改 `preload`/`main`/UI；`build.files` 的两条新增路径会在首次 `npm run package` 时暴露问题 |
