# Lv3 LLM 边界（02-llm-boundary）

生成日期：2026-10-07
输入：`Agent.md`（§25/§26/§27/§28/§30/§32/§55/§56/§57/§58）；`docs/lv3/01-mvp-scenario.md`；反构基线 `docs/lv3/01-agent-gap-analysis.md`（LLM 边界与 DO NOT ASSUME）；事实来源为当前 `src/`、`electron/` 源码。
性质：合同文档。定义 LLM 能做什么、不能做什么，以及它与其他组件的接口。

> 调度与触发时机见 `02-decision-flow.md`；领域结构见 `02-domain-model.md`。

---

## 1. 唯一允许的管线

`Agent.md` §33 与 CLAUDE.md §2.3 要求同一条链：

```text
AgentObservation                      ← 已裁剪，不含 WorldState
        ↓
Prompt（带 promptVersion）             ← prompt.ts
        ↓
LLM                                   ← ModelClient.decide()，async
        ↓
Structured AgentDecision              ← 结构化 JSON，非自由文本
        ↓
Zod Schema Validation                 ← 结构合法性
        ↓
Game Rule Validation                  ← 复用既有 validateAction
        ↓
choiceId resolution                   ← 引擎侧解析出 Action
        ↓
ControllerPort.submitAction()         ← engine.ts:91-96
        ↓
SimulationEngine                      ← 最终权威
```

**七个环节缺一不可。** 尤其 `choiceId resolution` 不能被省略成「LLM 直接给 Action」——那正是参数幻觉的来源。

---

## 2. LLM 不得做的事（硬边界）

`Agent.md` §55 Rule 1–8 的 LLM 部分，逐条落到代码约束：

| 禁止 | 为什么 | 由什么保证 |
| --- | --- | --- |
| 直接修改 `WorldState` | Rule 1 | LLM 所在层（`electron/agent/`）**不持有 `WorldState` 引用**，只有 `ControllerPort` |
| 直接执行 `GameAction` | Rule 2 | LLM 输出只有 `choiceId`，无 `Action` 字段 |
| 绕过 Zod validation | Rule 3 | `AgentDecision` 先过 Zod，再经 `actionSchema`（既有 `commands.ts:25-78`） |
| 操作其他 Agent 的 Ship | Rule 4 | `controllerPort(operatorId)` 只暴露本舰；`validate` 的权限门（`command-system.ts:159-167`）二次拦截 |
| 计算最终游戏结果 | Rule 6 | 结算在 `step()` / `complete()`（`engine.ts:134-161` / `:108-133`） |
| 写 Trust / Fatigue / Morale | §46 | 由确定性规则更新（`02-decision-flow.md` §5） |
| 计算 `DecisionScore` | §46 明文 | 分数在 `src/engine/agent/score.ts`，纯函数 |
| 生成 Action 参数 | §28 明文 | `choiceId` 由 `availableActions` 解析 |
| 访问 Renderer | 安全 | `main.ts:73-75` 的 `contextIsolation` + `sandbox` + 无 Node |

**架构上的兜底**：`applyFrontierCommand` 只有 `command-system.ts:349` 一个调用点，`dispatchCommand` 是唯一变更入口。**只要 LLM 层拿不到 `SimulationEngine` 实例，上述禁止就无法被违反**——这是比「约定」更强的保证。

---

## 3. `ModelClient` 契约（`Agent.md` §32）

```ts
interface ModelClient {
  readonly id: string;              // 'deepseek' | 'mock' | ...
  readonly promptVersion: string;   // 与 prompts/agent/*.md 的版本对应
  decide(request: DecisionRequest): Promise<ModelResult>;
}

interface DecisionRequest {
  observation: AgentObservation;    // 已裁剪
  systemPrompt: string;             // 来自 prompts/agent/system.md
  decisionPrompt: string;           // 来自 prompts/agent/decision.md
  schema: JsonSchema;               // AgentDecision 的 JSON Schema
  timeoutMs: number;
}

type ModelResult =
  | { ok: true; decision: AgentDecision; latencyMs: number }
  | { ok: false; error: ModelError; latencyMs: number };

type ModelError =
  | 'timeout'
  | 'http-error'
  | 'invalid-json'
  | 'schema-mismatch'
  | 'invalid-choice-id'
  | 'unavailable';
```

**provider 无关性**（`Agent.md` §32）：`deepseek` / `openai-compatible` / `mock` 都是 `ModelClient` 的实现。领域层只依赖接口。

**`mock` provider 必须长期存在**（playbook Prompt 4/5 均要求）：`Agent.md` §59 的全部测试要在无网络条件下可跑。mock 从 fixture 读 `AgentDecision`，实现确定性重放。

---

## 4. 提示词

### 4.1 存放与版本

CLAUDE.md §7 要求提示词**版本化并存放在业务逻辑之外**：

```text
prompts/agent/
├── system.md        ← Agent.md §56 的身份与约束
├── decision.md      ← 决策任务说明 + 输出格式
├── conversation.md  ← §38 ASK / §39 NEGOTIATE 的对话
└── reflection.md    ← 结算后的自述（可选）
```

每个文件带 `prompt_version`。`AgentDecision.promptVersion` 记录产生该决策的版本，写入日志以便回溯。

### 4.2 内容原则（`Agent.md` §56）

**不写**「你是一个 AI」。**要写**「你是 Frontier Command 中的 Agent，你的行为必须符合 Personality / Goals / Career / Fatigue / Trust / Relationships / Memory / Promises / Current Assignment」。

`Agent.md` §56 的目标：

> **像这个 Agent 一样做决定，而不是替游戏设计者做决定。**

**具体装配**：提示词由 `prompt.ts` 从 `AgentObservation` 字段填充，**不拼接 `WorldState` 原始数据**。

### 4.3 不得进入提示词的内容

| 禁止 | 理由 |
| --- | --- |
| `WorldState.enemies` / `seed` / `factions` | 隐藏状态（既有投影已过滤，但提示词装配**不得绕过 Observation**） |
| 其他 Agent 的 memory / promise / state | Rule 5 |
| `DecisionScore` 的中间项 | §46：LLM 不计算分数。给出分数会让模型变成分数的解释器，而非**这个 Agent** |
| 未来事件、脚本化剧情 | 会让 Agent 变成剧本朗读器 |
| API key / provider 配置 | 安全 |

> **一处需要说明的取舍**：MVP 场景 EVT-01 要求 Explorer 的 `reason` 体现「个人目标、人格、风险感知、当前状态、与 Admiral 的信任」。这意味着应当把**这些输入**给 LLM，但**不给它们的加权结果**。前者是「你是谁」，后者是「你该怎么答」。

---

## 5. 输出契约（`Agent.md` §57）

LLM **必须**输出结构化 JSON：

```json
{
  "intent": "request",
  "choiceId": "explore:0/12",
  "reason": "This mission strongly matches my exploration goal, but the risk is too high without escort.",
  "say": "I can take this mission if Tactical provides escort."
}
```

**禁止把自由文本作为唯一输出**（§57 明文）。

`reason` 与 `say` 的角色：

| 字段 | 去向 | 是否事实来源 |
| --- | --- | --- |
| `reason` | 写 Memory 的说明文本、调试日志 | **否**——实际发生的以引擎结算为准 |
| `say` | 进 `AgentMessage` + 既有 `Communication`，供 UI 显示 | 否 |

> `reason` **不是**事实来源这一条很重要：若把 `reason` 当事实写入 Memory，Agent 会「记住」自己声称做过但实际没发生的事。Memory 必须来自引擎结算。

---

## 6. 失败处理（`Agent.md` §58）

| 失败 | 处置 | 是否 fallback |
| --- | --- | --- |
| `timeout` | 丢弃 | ✅ 确定性规则 |
| `invalid-json` | 丢弃 | ✅ |
| `schema-mismatch` | 丢弃 | ✅ |
| `invalid-choice-id` | 丢弃（Rule 3） | ✅ |
| `http-error` | 丢弃；连续失败则临时停用该 Agent 的 LLM 路径 | ✅ |
| `unavailable` | 同上 | ✅ |
| **Observation 过期** | 丢弃（**由 `scheduler.apply()` 判定**——它才持有世界） | ❌ **不 fallback** |

**「过期不 fallback」的理由**：`observationTick` 落后过多意味着世界已显著变化。此时用确定性规则基于**新**世界做决策是合理的；但若 fallback 是基于**旧** Observation 算出的分数，就是错的。正确做法是丢弃并在下一拍重新评估。

> **判定位置（`KNOWN_ISSUES.md` `C-37` 更正）**：这一条**不在 `DecisionRuntime`**。运行时按 Rule 1 不持有世界、按 B-12 不得有钟，它在 `await` 前后拿到的是同一份冻结 Observation，**无法测出过了多久**。真正的过期判定在 `scheduler.apply()`。运行时那道 `misreportsObservation` 是**provider 守约检查**（决策必须自报它实际拿到的那份观测的 tick），两者用途不同。

**连续失败的退避**：提案使用有限重试（最多 2 次）+ 指数退避，之后降级为确定性模式一段时间（提案 30 游戏分钟）。**不无限重试**——`Agent.md` §58 只要求「不能导致游戏崩溃」。

---

## 7. 密钥与运行位置

| 项 | 位置 | 理由 |
| --- | --- | --- |
| API key | **仅主进程**，从环境变量读取 | 不进仓库、不进 Renderer |
| `ModelClient` 实例 | `electron/agent/` | Renderer 是 sandbox + contextIsolation（`main.ts:73-75`） |
| 网络调用 | 主进程 | 唯一有 Node 权限的进程 |
| 日志 | 仅记 `agentId`/`decisionTime`/`promptVersion`/`status`/`latency` | **不记 key、不记隐藏状态** |

IPC 边界现状：7 条通道（`00-baseline.md` §5）。**Lv3 不需要新增 IPC 通道也不能让 Renderer 直连 provider**——Agent 决策完全在主进程内完成，Renderer 仍只经既有 Snapshot 显示结果。

---

## 8. 确定性承诺（不虚假宣称）

`Agent.md` 与 playbook 都要求不夸大。**明确区分**：

| 模式 | 可重放 | 用途 |
| --- | --- | --- |
| Engine 重放（同 seed 同命令） | ✅ **是** | 既有能力，`tests/architecture.test.ts:39-60`，必须保持 |
| `mock` provider + 录制决策 | ✅ **是** | 回归测试 |
| Live LLM | ❌ **否** | 人工演示不参与回归断言 |

**不得声称**「同样输入 LLM 必得同样输出」。回归测试**只使用 mock provider**。

---

## 9. 边界检查清单（供 Prompt 8 审计用）

- [ ] LLM 层不 import `SimulationEngine`、不 import `WorldState`
- [ ] `electron/agent/**` 不被 `src/**` 引用
- [ ] `AgentDecision` 有对应 Zod schema，且与 `schemas/agent-decision.schema.json` 一致
- [ ] `choiceId` 解析失败时**绝不**回退为「让模型直接给 Action」
- [ ] 提示词里不含 `enemies` / `seed` / `factions` / 他人 memory
- [ ] 提示词里不含 `DecisionScore` 或其分项
- [ ] API key 不在仓库、不进 Renderer、不进日志
- [ ] 提示词文件带 `prompt_version`
- [ ] mock provider 存在且回归测试依赖它
- [ ] 模型调用不在 `step()` 调用栈内
