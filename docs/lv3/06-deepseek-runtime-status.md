# Lv3 P2 实施状态（06-deepseek-runtime-status）

生成日期：2026-10-08
阶段：Prompt 6 — **P2 DeepSeek Runtime**
范围：`electron/agent/openai-compatible.ts`（新增 provider）、`model-client.ts` / `runtime.ts` 的**增量**字段、P2 测试与 fixture 复用、`package.json` 的 `test:llm`
未做：Scheduler、`SimulationEngine` 接线、`ControllerPort`、命令执行、持久化、Admiral UI、Agent-Agent runtime、完整 MVP

---

## 0. 验证记录（实际执行）

| 命令 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | **PASS**（0 error；`npm run build` 的第一段） |
| `npm test` | **PASS** — 30 files / **457 tests，456 passed + 1 skipped** |
| `npm run build` | **PASS** — exit 0（`create-icon` + `tsc --noEmit` + `vite build` + `tsc -p tsconfig.electron.json`） |
| `git diff --check` | **无输出** |
| `npm run test:llm` | **SKIPPED** — 本机未设置 `DEEPSEEK_API_KEY`，该文件以 `describe.skip` 报告未运行（非「通过」） |
| `npm run test:package` | **未运行**（需先 `npm run package`；P2 未改打包内容） |
| `npm run test:e2e` | **未运行**（P2 未接宿主循环；`tests/e2e/desktop.spec.ts` 未改） |

改动前实测基线：`npm test` = 27 files / 402 tests PASS，与 `05-mock-runtime-status.md` §0 一致。

**新增用例构成**：`tests/agent/deepseek.test.ts` 42 + `tests/agent/context.test.ts` 11 + `tests/agent/live-deepseek.test.ts` 1（默认 skipped）+ `tests/agent/boundary.test.ts` +1（B-11 拆分）= **54 passed / 1 skipped**。

> **最重要的一条诚实声明**：本阶段**没有对 DeepSeek 发起过任何真实调用**（无 key）。
> provider 的全部行为都由注入的 stub transport 验证。真实端点的端到端行为**尚未被验证过**，见 §8 限制 1。

---

## 1. 本阶段建立的管线（实际可执行的）

```text
AgentObservation
    ↓  buildDecisionRequest                        electron/agent/prompt.ts（P1，未改）
DecisionRequest { observation, systemPrompt, decisionPrompt, schema, timeoutMs }
    ↓  ModelClient.decide
    ├── MockModelClient                            electron/agent/mock-client.ts（P1，未改）
    └── OpenAiCompatibleModelClient                electron/agent/openai-compatible.ts（P2 新增）
            ↓  fetch + AbortController（超时）
            ↓  有限重试 + 指数退避
            ↓  连续失败熔断
            ↓  content → extractJsonObject → JSON.parse → 盖上三个记账字段
            ↓  validateDecisionShape（结构 + choiceId 归属 + 目标可达）
    ↓  AgentDecision | ModelError（六类，永不抛）
    ↓  validateDecision（+ stale 判定）             src/engine/agent/decision.ts（P0，未改）
Validated AgentDecision

任一步失败（stale 除外）
    ↓  fallbackDecision(scoringAgent(observation), observation)     ← P1 已有的那**一条**降级路径
Valid Deterministic Decision
```

与 P1 相比，管线**只多了一个 provider**。校验、降级、路径、返回类型全部复用，没有第二套。

---

## 2. 实际创建的文件

| 文件 | 行数 | 职责 |
| --- | ---: | --- |
| `electron/agent/openai-compatible.ts` | 518 | `DeepSeekConfig` + `deepSeekConfigFromEnv` + `describeDeepSeekConfig` + `OpenAiCompatibleModelClient` + `extractJsonObject` + `createDeepSeekClient` + `LlmAttemptTrace` |
| `tests/agent/deepseek.test.ts` | 710 | 配置（§5/§6）、请求装配（§7/§10）、六类错误（L-7…L-10）、重试/退避、熔断（L-13）、不抛异常（§16）、密钥不外泄（L-12）、隔离（§28）、无真实网络（L-15）、§31 退出判据 |
| `tests/agent/context.test.ts` | 329 | §22 事件级 Prompt fixture（EVT-01/02/03/05/07）、§23 四 Agent 同任务分化、§24 同一 Agent 两段历史 |
| `tests/agent/live-deepseek.test.ts` | 83 | 可选 live 检查；无 key 时 `describe.skip` |
| `docs/lv3/06-deepseek-runtime-status.md` | 本文 | — |

**为什么 `openai-compatible.ts` 是一个文件而不是三个**：`03-implementation-plan.md` §2 已把 provider 实现定名为 `openai-compatible.ts`。配置解析、传输、解析、重试、熔断都只服务于这一个类的构造与 `decide()`，拆成 `config.ts` / `transport.ts` 会增加文件数而不增加边界。**P2 不新增计划外的模块名。**

---

## 3. 实际修改的文件

| 文件 | 改动 | 说明 |
| --- | --- | --- |
| `electron/agent/model-client.ts` | **追加可选** `readonly model?: string` | 见 §5.2。可选 ⇒ `MockModelClient` 与全部既有测试 stub **无需修改**即满足契约 |
| `electron/agent/runtime.ts` | `DecisionTrace` 追加 `model: string \| null`；构造 trace 时填 `this.client.model ?? null` | 见 §5.2。既有测试只做字段级断言，未受影响 |
| `tests/agent/boundary.test.ts` | B-11 从「整层无网络」改为「**唯一命名模块**可联网」+ 1 个新用例 | 见 §5.3 |
| `package.json` | `scripts` 追加 `"test:llm"` | §21：live 检查必须能被单独调用，且**不在** `npm test` 的依赖集内 |

**未修改**（P2 明令保持）：`electron/main.ts`、`electron/preload.ts`、`electron/persistence.ts`、`src/engine/**`（全部）、`schemas/*.json`、`prompts/agent/*.md`、`src/ui/**`、P0/P1 的既有测试与 fixture。

---

## 4. 达成的能力（对照任务书）

```text
AgentObservation → Prompt/Context → DeepSeek → AgentDecision
                 → Schema Validation → Decision Validation → Validated AgentDecision   ✅
DeepSeek unavailable → Failure → **P1 既有 fallback** → Valid Decision                   ✅
默认 npm test 无 key / 无外网 / 无费用 / 不依赖模型随机性                                  ✅
```

| 任务书条目 | 落地位置 | 状态 |
| --- | --- | --- |
| §4 provider 抽象 | `OpenAiCompatibleModelClient implements ModelClient` | ✅ |
| §5 API 配置注入 | `DeepSeekConfig` + `deepSeekConfigFromEnv(env)` | ✅ |
| §6 安全读取 key | 仅 `openai-compatible.ts` 读 `process.env`；`describeDeepSeekConfig` 是唯一可安全记录的形状 | ✅ |
| §7 Prompt/Context Builder | 复用 P1 `prompt.ts`（**未改**）；P2 用 `context.test.ts` 证明它把 Agent 专属信息传给了模型 | ✅ |
| §8/§9 结构化上下文优先于文字人格 | `renderSituation` 输出 personality/state/trust/memory/promise/availableActions 的**取值**，而非形容词 | ✅ |
| §10 结构化输出 | `response_format: json_object` + `extractJsonObject` + `parse` + `validateDecisionShape` | ✅ |
| §11 Schema Validation | 复用 `agentDecisionSchema`（Zod，`strict()`） | ✅ |
| §12 Decision Validation | 复用 `validateDecisionShape`（choiceId 归属 + 目标可达） | ✅ |
| §13 choiceId 而非 GameAction | provider 只能回 `choiceId`；**未** resolve 到 Action | ✅ |
| §14 Timeout | `AbortController`；`min(request.timeoutMs, config.timeoutMs)` | ✅ |
| §15 Retry | `maxRetries`（默认 2）+ 指数退避；区分可重试/不可重试 | ✅ |
| §16 Failure Handling | 六类 `ModelError`，`decide()` **永不抛**（含 fetch 抛异常、body 读失败、trace 回调抛异常） | ✅ |
| §17 Fallback 复用 | 未新增 fallback；`DecisionRuntime` 原样 | ✅ |
| §18 LLM 不负责 Game Rules | provider 不含任何规则校验 | ✅ |
| §19 LLM Traceability | `DecisionTrace`（决策级）+ `LlmAttemptTrace`（尝试级） | ✅ 见 §5.2 |
| §20 Deterministic Test Mode | `MockModelClient` 原样保留，回归测试仍依赖它 | ✅ |
| §21 Live 测试不进入默认套件 | `tests/agent/live-deepseek.test.ts` + `npm run test:llm` | ✅ |
| §22 Prompt Fixture Tests | `context.test.ts`，按 EVT 编号组织 | ✅（6 个事件，见 §8 限制 3） |
| §23 Agent Differentiation | `context.test.ts` 四 Agent 同任务 | ✅ |
| §24 Memory Context Test | `context.test.ts` History A/B | ✅ |
| §25/§26/§27 不做 Scheduler / 引擎 / 持久化 | 见 §6 | ✅ |

---

## 5. 实现层调整（Approved Design → Actual Implementation → Reason）

### 5.1 熔断是 **provider 级 + wall-clock**，不是 Agent 级 + 游戏分钟

- **Approved**：`02-llm-boundary.md` §6 —— 「连续失败则临时停用**该 Agent** 的 LLM 路径」，「降级为确定性模式一段时间（**提案 30 游戏分钟**）」。
- **Actual**：`OpenAiCompatibleModelClient` 内部维护 `consecutiveFailures` / `breakerOpenUntil`，**全 provider 共享**；冷却用 wall-clock 毫秒（默认 30 000ms，`DEFAULT_COOLDOWN_MS`）。
- **Reason**：① provider **拿不到 `SimulationEngine`，也没有游戏时钟**（Rule 1）；在这里造一个游戏时钟等于在引擎之外再造一个时间权威。② 「按 Agent 停用」需要 per-Agent 状态，而 per-Agent 状态正是 P3 Scheduler 的职责（`03-api-contract.md` §4.6 的 `Map<agentId, Pending>`）。P2 提供的是**传输层**保护：provider 挂掉时不再空转网络。
- **未丢失的能力**：「失败 ⇒ 降级为确定性模式」在 P2 已经成立，且不依赖熔断——`DecisionRuntime` 对任何 provider 失败都走 fallback（§31 的退出判据已用测试证明）。
- **P3 需补**：游戏分钟粒度的退避/停用，由 Scheduler 实现。见 `KNOWN_ISSUES.md` `C-26`。

### 5.2 `ModelClient.model` 与 `DecisionTrace.model` 的**增量**追加

- **Approved**：`03-api-contract.md` §4.4 的 `ModelClient` 只有 `id` / `promptVersion` / `decide`；`runtime.ts` 的 `DecisionTrace` 由 P1 定义。P2 的交接说明写「**不要重写** `model-client.ts` 的契约」。
- **Actual**：`ModelClient` 追加**可选** `readonly model?: string`；`DecisionTrace` 追加 `model: string | null`。
- **Reason**：任务书 §19 明确要求 trace 能记录 `model`。可选字段是**唯一**不破坏既有实现的加法：`MockModelClient`、`runtime.test.ts` 的 `lyingClient` / spy stub 全部无需改动即仍然满足接口（已验证：既有测试零修改通过）。
- **兼容性**：`ModelResult`（§4.4 的另一半）**一字未改**；既有 trace 断言均为字段级，未受影响。
- **为什么 model 不放在 `ModelResult` 里**：那会改一个**必需**的、被 P0/P1 测试直接 `toEqual` 的形状。放在接口上、由一个可选成员承载，代价最小。
- **为什么尝试级信息单独成 `LlmAttemptTrace`**：`DecisionTrace` 回答「这个 Agent 决定了什么、有没有被采用」；`LlmAttemptTrace` 回答「这条线路上发生了什么」（请求/响应时间戳、第几次尝试、HTTP 状态、是否重试）。一次决策用了几次尝试是**传输细节**，混进决策记录会让「决策」这个概念变形。两者合并覆盖 §19 的字段清单。

### 5.3 B-11 从「整层离线」改为「唯一命名模块可联网」

- **Approved**：`05-mock-runtime-status.md` §6 —— 「`electron/agent/**` 无 `fetch` / `axios` / SDK / `process.env`」，`boundary.test.ts` 用静态断言固定。
- **Actual**：断言改为 —— **除 `electron/agent/openai-compatible.ts` 外**，其余每个模块仍需满足原来的全部禁令；并新增三条：① 被扫描文件数必须恰为「层内文件数 − 1」（防止守卫静默扫空）；② 豁免模块必须存在且恰为该文件名；③ 豁免模块必须通过**注入的 transport** 取网络（`options.fetch ??`），不得引入第二个 HTTP 客户端。
- **Reason**：P2 的存在意义就是引入一个能联网的 provider，全层禁令在 P2 之后必然为假。**放松一条守卫的正确方式是让它更精确，而不是让它消失**：现在「谁能联网」有一个可断言的名字，任何**第二个**模块偷偷拿到网络能力仍会被抓住。

### 5.4 不把 `AgentDecision` 的 JSON Schema 塞进 prompt；三个记账字段由 provider 覆盖

- **Approved**：`ModelClient` 的注释写 `schema` 是「carried to the provider so it can constrain its own output」；`02-llm-boundary.md` §5 规定模型输出结构化 JSON。
- **Actual**：请求体只带 `response_format: { type: 'json_object' }`，**不**附 schema。模型只负责 `intent / choiceId / reason / say / request`；`promptVersion` / `observationTick` / `provider` 由 provider 在 `stamp()` 中**无条件覆盖**。
- **Reason**：schema 里这三个字段是**必需的**（`schemas/agent-decision.schema.json` 的 `required`），而模型**不可能知道**自己依据的是哪个 tick、哪个 prompt 版本。把 schema 原样给它，等于要求它编造这三个值再被我们覆盖——徒增一种失败模式（模型填了 `observationTick` 却被 `.strict()` 因别的字段拒绝）。给定 `additionalProperties: false`，模型多写一个字段仍会 `schema-mismatch`，严格性未降低。`request.schema` 字段保留给「能用 schema 约束解码」的 provider。

### 5.5 非法数值环境变量回落默认，而非启动失败

- **Approved**：任务书 §15 把「invalid local configuration」列为**不可重试**错误。
- **Actual**：`DEEPSEEK_TIMEOUT_MS=soon` → 用默认 20 000；`DEEPSEEK_MAX_RETRIES=-4` → 夹到 0。不抛异常。
- **Reason**：任务书 §16 要求「invalid local configuration 不能导致游戏进程崩溃」。一个拼错的超时值不该让整局游戏起不来。真正的配置错误（**没有 key**）走的是另一条路：`deepSeekConfigFromEnv` 返回 `null`，宿主干脆不构造 provider。

### 5.6 超时取 `min(request.timeoutMs, config.timeoutMs)`

- **Approved**：`DecisionRequest.timeoutMs`（P1）与「timeout 必须可配置」（§5）并存，未规定二者关系。
- **Actual**：两者都是**上界**，取更严的那个。
- **Reason**：runtime 的每请求预算是调用方的权利，provider 的配置是它自己的护栏；任一被另一个静默覆盖都会让其中一处配置变成死代码。

### 5.7 `prompts/agent/*.md` 未改动

- **Approved**：任务书 §7/§8/§9 要求 Prompt/Context Builder 与设计原则。
- **Actual**：四个提示词文件**一字未改**，`prompt_version` 仍为 `agent-v1`。
- **Reason**：P1 的 `renderSituation` 已经把 §8/§9 要求的全部结构化输入（who am I / what do I want / state / recent / trust / relationships / promises / choices）渲染进「当前态势」，`context.test.ts` 逐项断言了这一点。改提示词正文会连带更新 `AGENT_PROMPT_VERSION`、fixture 的 `promptVersion` 与 P1 的版本一致性测试，**收益（推测的措辞改进）无法在本阶段离线验证**。提示词质量按 `05-mock-runtime-status.md` §8 限制 6 的既定处置留给实测。见 `KNOWN_ISSUES.md` `C-28`。

---

## 6. 未实现（明确不在 P2）

| 项 | 现状 |
| --- | --- |
| Scheduler | **NOT IMPLEMENTED**——`scheduler.ts` 不存在；`electron/main.ts` 未被修改（`boundary.test.ts` 断言其不含 `from './agent`） |
| `SimulationEngine` 接线 | **NOT CONNECTED**——`src/engine/engine.ts` 一行未改；无 `AgentTrigger` 发射 |
| `ControllerPort` 接线 | **NOT CONNECTED**——`electron/agent/**` 源码中不出现 `controllerPort` / `submitAction`（B-2 静态断言，**对新增的 provider 文件同样生效**） |
| `choiceId` → `Action` → `submitAction` | **NOT IMPLEMENTED**（P3） |
| 持久化 | **NOT INTEGRATED**——`DecisionTrace` 与 `LlmAttemptTrace` 只在内存中经回调产出；`save-schema.ts` 未动 |
| UI / IPC | **无改动**——`preload.ts` 仍是 5 个 `invoke`，无新通道 |
| Agent-Agent runtime | **未实现** |
| Promise workflow / 完整 MVP 9 事件流 / E2E vertical slice | **未实现**（P3） |

---

## 7. 推荐下一阶段

**P3 — Game Integration + MVP Vertical Slice**（`03-implementation-plan.md` §3.4），最短顺序：

1. `electron/agent/scheduler.ts` + `electron/main.ts` 的 `pump()` 接线 + `AgentTrigger` 发射（`03-test-plan.md` §6 的 S-1…S-11）。**这是 P2 之后最紧的一环**——`validated decision` 目前仍无消费者。
2. `electron/agent/config.ts` 或 `main.ts` 中的一行 `createDeepSeekClient(process.env, …)`：把 P2 的 provider 真正接上宿主，并在无 key 时退化为确定性模式。
3. `choiceId` resolution + `ControllerPort.submitAction`（`KNOWN_ISSUES.md` `C-11` 是红线：**不得**给 port 加第三个方法）。
4. 游戏分钟粒度的退避 / per-Agent 熔断（`C-26`）。
5. `SaveStore` 的 Agent 状态与 `DecisionTrace` 持久化、`save-schema` v12 迁移。

**P3 不要重写**：`electron/agent/model-client.ts` 的接口、`openai-compatible.ts` 的传输/解析/重试分层、
`prompt.ts` 的装配与版本校验、`runtime.ts` 的校验/降级顺序、`src/engine/agent/decision.ts` 的两层校验、
`tests/fixtures/agent/scenarios.json` 的令牌约定、`tests/agent/boundary.test.ts` 的**唯一网络模块**规则。

---

## 8. 已知限制

| # | 内容 | 影响 | 处置 |
| --- | --- | --- | --- |
| 1 | **从未对真实 DeepSeek 发起调用**（本机无 key） | provider 的线路格式、鉴权头、`response_format` 的实际效果、真实模型的输出质量**均未被验证**。全部结论来自 stub transport | 计划内：`npm run test:llm` 已备好；需要 key 的机器上跑一次即可补上。**在此之前不得声称「DeepSeek 已接好并可工作」** |
| 2 | 熔断是 provider 级、wall-clock（§5.1） | 一个 Agent 的连续失败会短暂影响其他 Agent 的 LLM 路径；冷却时长与游戏时间无关 | `C-26`，P3 Scheduler 补游戏分钟与 per-Agent 粒度 |
| 3 | §22 覆盖 6 个事件的 5 种情境（EVT-01/02/03/05/07），EVT-06/09 在 §23/§24 中以「四 Agent 分化」「两段历史」的形式覆盖 | 事件编号与用例不是一对一 | 属覆盖方式差异，非缺口；EVT-04/EVT-08 未单列（其录制本就是 `wait`，无新情境） |
| 4 | 重试的**总**耗时上界是 `(maxRetries+1) × timeout` | 极端情况下单次决策可占用约 60s（默认 2 次重试 × 20s） | 由调用方的 `request.timeoutMs` 收紧；P3 Scheduler 需要为决策设定总预算 |
| 5 | `extractJsonObject` 只取**第一个**平衡对象 | 若模型先输出一个无关的前导对象，取到的是那一个 | 该对象随后必然 `schema-mismatch`，失败是安全的一侧（降级而非误采） |
| 6 | 未新增 `AgentTrigger` / 未改 `engine.ts` | provider 目前仍无生产调用点，只在测试中被驱动 | 计划内；P3 第 1 步 |
| 7 | `npm run test:package` / `test:e2e` 未运行 | 打包与 E2E 路径本阶段未验证 | P2 未改 `preload`/`main`/UI；`build.files` 已在 P1 覆盖 `prompts/**` 与 `schemas/**` |
