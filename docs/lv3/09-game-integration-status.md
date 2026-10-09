# Lv3 P3 游戏整合 / MVP 垂直切片实施状态（09-game-integration-status）

生成日期：2026-10-08
阶段：**P3 — Game Integration / MVP Vertical Slice**（施工图见 `docs/lv3/CODEX_TASKS.md` 的 `P3-01…P3-09`）
范围：把已完成的决策侧（P0/P1/P2/P2.5）接到游戏状态上，并跑通 `01-mvp-scenario.md` 的 EVT-01…09

> **文件名的由来**：playbook §三十五 要求 `07-game-integration-status.md`，但 `07-` 与 `08-` 已被
> P2.5 的 `07-scheduler-plan.md` / `08-scheduler-status.md` 占用。P3 顺位取 `09-`。

---

## 0. 验证记录（实际执行）

| 命令 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | **PASS**（0 error） |
| `npm test` | **PASS** — 35 files / **546 tests，545 passed + 1 skipped**（含 P3 后的演示通道：`roster.test.ts` 6 例 + `vertical-slice.test.ts` 的 2 条新闭环断言） |
| `npm run build` | **PASS** — exit 0 |
| `git diff --check` | **无输出** |
| `npm run test:llm`（真实端点） | **PASS** — `deepseek-flash` 与 `deepseek-chat` 均 `outcome=ok:respond`；**并因此发现并修复 `C-33`** |
| `npm run test:e2e`（`vertical-slice.spec.ts`） | **PASS** — **2 passed / 12.8s**（EVT-01 + 演示通道：面板渲染名单、从面板发消息到达引擎、承诺两步不静默失败） |
| `npm run test:e2e`（`lcars.spec.ts`） | **PASS** —— **5 passed / 2.4m**（几何六尺寸 + 偏好/动效/音频 + 125/150/200% 显示缩放）。**面板没有移动 LCARS 布局**——这是演示通道唯一未验证的风险，现已排除 |
| `npm run test:e2e`（全套） | **未重跑**（上一次全套是 P3 结束时：35 / 37 / 14.7m） |
| `npm run test:package` | **未运行** |
| **`npm run demo:ui`**（可观看的 UI 演示，无 key，含 `--pace` 与计数） | **PASS** —— 真实 Electron 窗口、真实鼠标点击八步、**1 passed / 35.5s**、`test-results/agent-demo/` 产出 **14 张带旁白的故事板 PNG**；结尾打印「决策 N 次，其中 M 次由模型作答」（无 key 时 M=0，如实测 32/0）；`--pace=0.5` 使耗时由 34.8s 降到 **26.3s**，`--pace=99` 被拒。**不录像**：`recordVideo` 会让应用加载失败（`C-38`） |
| `npm run test:e2e` 是否收集到演示 | **未收集**（`npx playwright test --list` 无 demo；演示配置 `--list` 恰好 1 个用例）——隔离双向验证通过，`npm test` 亦不受影响（550 通过） |
| **面板上的循环计数（`C-36` ④）** | **PASS** —— `vertical-slice.spec.ts` 断言真实应用里出现「本局模型决策 …」；`scheduler.test.ts` 两条新用例钉住 16× 缩放与 `onDiscarded`；`host.test.ts` 一条钉住转发与快照 |
| **`C-36` ①（窗口随速度缩放）** | **PASS（含真实端点对照）** —— 16× 下 `npm run demo:live -- --speed=16`：开着缩放**决策 37 / 丢弃 0**；临时关掉缩放**决策 84 / 丢弃 63（75%）**。真实端点、真实 `AgentHost`、真实调度器 |
| **`C-37`（运行时过期检查不可达）** | **已解决（改认知，不删）** —— `isStale` → `misreportsObservation`、常量拆分、四份文档就地更正判定位置；**行为零变更**，`npm test` 550 通过 |
| **`npm run demo:live`**（真实模型，25 次调用 / 47.6s） | **PASS** —— 八步逐步打印：模型在第 1–2 步给出扎根于自身状态的答复（"我舰上没有一枚鱼雷…我需要一个明确的返航窗口"）；第 4 步组队后关系值 0 → 10；第 6 步真 REFIT 使承诺转 `fulfilled`、信任 60 → 70；第 7 步 Override 使信任 60 → 50；第 8 步两种历史都答 `counteroffer` 但**措辞可见地不同**（A 更积极、B 更直接）。**并因此发现 `C-36`** |
| **实际启动应用**（无头、读终端） | **PASS** —— 无 key 时终端出现 `[agent] 未配置 DEEPSEEK_API_KEY —— 本轮为确定性模式，不调用模型`；带 key 时出现 `[agent] 模型已配置 — {...hasApiKey:true}`，且**输出中不含密钥**（实测 0 处匹配）。顺带确认：Windows 上主进程的 `console.log` **不送到终端**，`console.error` 会——所以那行用 stderr |

改动前实测基线：`npm test` = **34 files / 508 passed + 1 skipped**（`08-scheduler-status.md` §0）。
**本阶段新增 30 个通过用例**，全部落在 `tests/agent/vertical-slice.test.ts`（另加 1 个 E2E spec）。

---

## 1. 本阶段建立的闭环（实际可执行）

```text
引擎分支（complete() / execution.ts 的 REFIT、SURVEY）
   └─ pendingEvents.push({ type:'agentEvent', event })        ← 瞬时通道，不进 WorldState
electron/agent-host.ts  frame(events)
   ├─ agentEventsOf(events) → engine.dispatchCommand({type:'agentEvent', event})
   │     └─ command-system.ts validate() → apply()
   │          └─ src/engine/agent/events.ts 纯规划器 → 状态 / 记忆 / 目标 / 关系 / 承诺
   ├─ scheduler.notify(agentTriggersOf(events)) → pump()
   │     └─ DecisionRuntime.requestDecision（异步、不 await）
   │          └─ applyDecision
   │               ├─ intent==='act' → ActionSubmitter → controllerPort.submitAction
   │               └─ 社交意图        → MessageSubmitter → agentMessage 命令
   └─ ← 回复消息反过来消费掉它所回答的 offer（consumeAnswered）
```

**结算仍然只经 Command 这一道门**（CLAUDE.md §2.1）——与既有的 `agentMessage` 分支同一条规矩，
而不是在 `complete()` 里直接改 `WorldState`。

**游戏内第一次真正跑起来了。** `08-scheduler-status.md` §8.1 记录的「游戏内从未观察到一次真实的
Agent 行动」在本阶段被证伪：`tests/agent/vertical-slice.test.ts` 用**真实 `AgentHost`**、
**不配任何 API key**（也就是游戏实际运行的配置），断言 Admiral 的 offer 经命令进入 → 触发唤醒调度器
→ 确定性分档作答 → 回复以 `agentMessage` 离开。整条链路没有一处 mock。

---

## 2. 实际创建的文件

| 文件 | 行数 | 职责 |
| --- | ---: | --- |
| `src/engine/agent/events.ts` | 244 | 结算规划器：`AgentEvent` 的一种 kind 一个函数，组合既有纯函数产出 delta/记忆/关系 |
| `src/engine/agent/dialogue.ts` | 114 | 社交决策 → `agentMessage`；以及 offer 的确定性分档 |
| `src/engine/agent/readiness.ts` | 61 | EVT-04 的确定性战备评估（弹药 + 船体 + 路径），**无 fuel** |
| `tests/agent/vertical-slice.test.ts` | 894 | 30 个用例：P3-00 接缝、EVT-01/02/03/04/05/08/09、宿主闭环 |
| `tests/e2e/vertical-slice.spec.ts` | 124 | 真实 Electron 应用中的 EVT-01（playbook §三十一） |
| `tests/e2e/agent-stub.ts` | 88 | 测试进程内的 OpenAI-compatible stub provider，确定性 |

## 3. 实际修改的文件

| 文件 | 改动 |
| --- | --- |
| `src/engine/commands.ts` | `agentEventSchema`（5 个 kind）+ 加入 `commandSchema`；`promiseType`/`promiseFulfillment` 移入（避免循环依赖） |
| `src/engine/types.ts` | `SimulationEvent` 与 `Command` 各追加一个成员 |
| `src/engine/command-system.ts` | `agentEvent` 的 validate + apply 分支；`consumeAnswered`；`team-resolved` 发射 |
| `src/engine/engine.ts` | `complete()` 内追加 `mission-settled` 发射（**仅 `source === 'admiral'`**） |
| `src/engine/execution.ts` | REFIT 装入模块处追加 `module-installed`；SURVEY 命中异常处追加 `discovery` |
| `src/engine/agent/score.ts` | **`MEMORY_VALENCE`：给记忆加正负号** |
| `src/engine/agent/decision.ts` | 确定性回退**先回答待答 offer** |
| `src/engine/agent/actions.ts` | 用 `isTaskOfferKind` 取代重复的 kind 列表 |
| `src/engine/agent/schemas.ts` | 改为从 `../commands` 再导出 promise 两个枚举 |
| `src/engine/agent/types.ts` | 再导出 `AgentEvent` |
| `electron/agent/runtime.ts` | 新增注入式 `MessageSubmitter`（**必需**选项）与两个 `SubmissionOutcome` |
| `electron/agent-host.ts` | 保存 `engine` 引用；`agentEventsOf` + 派发；绑定 messenger |
| `electron/agent/openai-compatible.ts` | `DEFAULT_MAX_TOKENS` 1200 → 4096（`C-33`） |
| `tests/agent/{support,submission,scheduler,runtime}.test.ts` | 脚手架补 messenger；两处编码了旧行为的断言**反转而非删除** |

**未修改**：`src/ui/**`、`electron/preload.ts`、`src/global.d.ts`、`schemas/*.json`、
`src/engine/save-schema.ts`、`legacy-v9|v10/**`、`AgentControllerPort` 的 key 集合、
`scheduler.ts` 的判定与单一写入面。

---

## 4. MVP 事件逐条结论

| EVT | 结论 | 证据 |
| --- | --- | --- |
| 01 Admiral 发布任务 | **PASS** | 经真实 `AgentHost`、无 key，Agent 产出 `respond` 并把回复发回 Admiral；offer 随后被消费 |
| 02 反报价 | **PASS** | `counteroffer` → `kind:'negotiate'`，payload `{requestType, targetAgentId}`（`AgentRequest.type` 映射为 `requestType`） |
| 03 Agent-Agent 组队 | **PASS** | `team-reply` 成消息 → `team-resolved` 结算**双方**关系各 ±10 → 另起一次 `act` 决策真正提交 `ESCORT`（`source:'standing'`） |
| 04 Logistics 战备评估 | **PASS** | `readiness.ts` 是纯函数，输入恰为卡片指定的三项（弹药 / 船体 / `routeEstimate`），**仓库中仍无 `fuel`**（以剥注释后的源码扫描断言，不靠注释自称）。结论经候选的 `requirements` 进入观察，决策与提示词都看得到 |
| 05 穿越 + 发现异常 | **PASS** | **发射点已端到端验证**：真实执行一次 `SURVEY`（贴近、hazard 0 的异常天体）→ 引擎在调查分支发射 `discovery` → 宿主派发 → 记忆 + `goal.progress ↑`，且 `subjectId` 指向该天体。**反面也断言**：同一目标的远程扫描**不算**发现。未写成单测的是"先 `TRANSIT` 再 `SURVEY` 的一次连续跑"，因为 `TRANSIT` 是既有 Action，Lv3 侧只负责"选得出来"（`actions.test.ts` 覆盖）。另注：Admiral 下的调查会**同时**发射 `discovery` 与 `mission-settled`，两者合法共存 |
| 06 四方分歧 | **PASS** | 既有用例 `tests/agent/runtime.test.ts:256-278` 正是本卡验收：四个职业、四份观察、fixture `EVT-06`，断言 `new Set(answers).size === 4`（四种不同答案）且 ≥2 种不同 intent。**本阶段未新写测试是刻意的**——重复一条已在跑且断言更强的用例没有价值 |
| 07A Promise 创建 | **PASS** | `promise-made` 造出 `pending` / `resolvedAt:null` 的承诺 |
| 07B Override 代价 | **PASS** | 沿用 P0 路径；EVT-09 的 Path B 断言了 −10 trust 与 `admiral-override` 记忆 |
| 08 任务结算 | **PASS** | `mission-settled` 状态/记忆/目标镜像；**真跑一次 REFIT**（由另一艘舰执行）→ pending 承诺转 `fulfilled` + `PROMISE_KEPT_EFFECT` + `promise-kept` 记忆 |
| 09 闭环 | **PASS** | 同一 Agent、同一新任务，Path A（信任↑ + `promise-kept`）与 Path B（信任↓ + `admiral-override`）⇒ `trustInAdmiral` **与** `choiceId` 同时不同；mock provider 与**纯确定性评分**两种证法都成立 |

---

## 5. 本阶段发现并修复的真实缺陷

三条都不是"看起来不对"，而是**实测到的、会让 Lv3 在真实配置下不成立**的问题。

### 5.1 `memoryContribution` 没有正负号（已修复）

`score.ts` 返回记忆**权重**，而权重没有方向。于是 `admiral-override`（权重 90）比 `promise-kept`
（权重 70）得分更高——**最坏的事反而把 Agent 推向接受**。`Agent.md` §50 的闭环一直在跑，方向是反的。
新增 `MEMORY_VALENCE`（±1），贡献取"最有决定性的那条带符号记忆"。这正是 `score.ts` 与
`04-foundation-status.md` §6 item 1 都写明留给 P3 的校准。**没有这个修复，EVT-09 的 A/B 只能"大小不同"，
不可能"方向相反"。**

### 5.2 三个社交候选分数完全相同（已修复）

`accept`/`reject`/`counteroffer` 的 risk/reward/goalKinds 一致 ⇒ `decisionScore` 分解完全一致 ⇒
`rankCandidates` 落到 id 平局 ⇒ **只能选出 `accept`**。无 key 的默认配置下，Agent **永远不会拒绝**。
`dialogue.offerResponse` 改为**对 offer 整体评分一次**，由 Agent.md §46 的分档决定答案。

### 5.3 待答 offer 压不过自主行动 + 消息从不标已读（已修复）

实测：待答 offer 得分 **8.9–28.9**，而一个 survey 候选排在它前面 ⇒ 确定性回退**去测绘了，根本不回答
Admiral**（EVT-01 在离线路径下不成立）。而它无法简单地被赋予优先级，因为 `agentMessages` **从不标记
`read`** —— offer 会永久留在菜单上，"先回答 Admiral"会把 Agent 永久锁死。

两半一起修：`fallbackDecision` 先回答待答 offer；引擎在收到回复时消费掉它所回答的 offer
（`consumeAnswered`）。

### 5.4 EVT-04 的设计决定：战备结论挂在**候选**上，不挂在 offer 上（已实现）

**问题**：P3-04 要求 Logistics 在出发前给出 READY/WARNING，但任务 offer 是**自由文本**——它不携带
任何结构化目标，所以"评估这趟任务"没有一个可判定的输入。这正是它此前被记为"未实现"的原因。

**决定**：战备不是对抽象任务的评估，而是对**这艘船能不能跑完某个具体选项**的评估。
菜单上的每个物理候选都指向一个引擎已知的真实目标，所以：

```text
ship(弹药/船体)  +  candidate 的目标点  ──assessReadiness──▶  READY | WARNING(+理由)
                                                              │
                                      写进该候选的 requirements（既有字段）
                                                              │
                                      进入 AgentObservation → 决策与提示词都看得到
```

**为什么不能在 Agent 层算**：战备需要航路，而 `AgentObservation` **刻意不含海图**
（Rule 1：runtime 不持有世界）。所以它是**世界事实**，必须在引擎侧算、经观察跨过边界——
这与"runtime 不能写回"是同一个约束的两面。

**被否决的方案**：
- 给 `agentMessage` 的 payload 加结构化目标 —— 会改动 `schemas/agent-message.schema.json`
  这个**跨工具合同**（CLAUDE.md §6 要求同步 7 个 JSON Schema），代价与收益不成比例。
- 让 LLM 决定 READY/WARNING —— 直接违反卡片的 API Contract（"确定性评估……否则不可测"）。

**残余缺口**：结论说的是"这艘船能不能跑完这个选项"，**不是**"能不能跑完 Admiral 心里那趟任务"。
要把两者接起来，仍然需要 offer 携带结构化目标——即上面被否决的那条路。已记录在 §6。

---

### 5.5 `C-33`：推理模型的 token 预算不足导致 live 路径**静默**全量降级（已修复）

`DEFAULT_MAX_TOKENS = 1200` 对非推理模型够用，对**推理**模型不够：`deepseek-flash` 把预算全花在
`reasoning_content` 上，`content` 返回空串，provider 归类 `invalid-json` 且不重试。**失败是静默的**
——世界照常运行、测试照常全绿，而模型贡献为零。实测 2048 起才有可能成功，默认改为 4096。
详见 `KNOWN_ISSUES.md` `C-33`。

---

## 6. 未完成 / 已知限制

| # | 项 | 说明 |
| --- | --- | --- |
| 1 | **战备结论是"选项级"的，不是"任务级"的** | §5.4 的决定：`readiness` 评估的是"这艘船能不能跑完**这个候选**"，而不是"能不能跑完 Admiral 心里那趟任务"。后者需要 offer 携带结构化目标，而那会改动 `agent-message.schema.json` 这个跨工具合同。**这是有意选择的代价**，不是遗漏 |
| 2 | **E2E 覆盖两条** | `tests/e2e/vertical-slice.spec.ts` 有两条：EVT-01（Admiral 发布 → Agent 作答）与**演示通道**（面板渲染名单、从面板发消息真的到达引擎、承诺两步不静默失败）。反报价 / 组队 / 执行 / 结算的更深处断言仍在 `tests/agent/vertical-slice.test.ts`，那里是确定性的。**驱动一个 stub provider 无法强制"必须反报价"**（playbook §三十二），所以 E2E 断言的是"产出合法决策 → 变成玩家可见的真实变化 → 应用没崩"，而不是某个具体答案 |
| 2b | **EVT-04…09 的人类可演示性** | P3 结束时 MVP **无法由人演示**（UI 既发不出 `agentMessage` 也看不到 Agent 状态，且应用里没有控制台）。已由用户授权解开 §二十五 冻结并补上通道，见 `KNOWN_ISSUES.md` `C-35` 与 `10-agent-demo-channel.md` 的 runbook。LCARS 几何回归已验证（`lcars.spec.ts` 5 passed） |
| 3 | **`promiseMemory`（kind `'promise'`）无生产者** | `memoryContribution` 只读 **episodic** 记忆，所以承诺兑现写的是 `episodicMemory{tags:['promise-kept'], subjectId:<promiseId>}`。`promiseMemory` 携带 `promiseId` 但没有 tags，写它不会影响任何分数。**要么**在别处用它（例如承诺详情 UI），**要么**承认它多余 |
| 4 | **team-accept / team-decline 仍然同分** | 两个候选的分解一致，平局由 id 决定 ⇒ 离线永远接受组队。要做成"关系差就拒绝"，需要一个 per-peer 的候选项（现有 `teamFit` 用的是**平均**合作度） |
| 5 | **offer 消费是钝的** | 给 Admiral 的一条回复会消费该 Agent **全部**未读任务 offer，而不只是被回答的那条。替代方案是让回复携带 message id，那会让 Agent 层知道它不该看见的消息日志 |
| 6 | **`escort:` 候选上限 4** | `CANDIDATE_CAPS.escort` 意味着请求组队的那艘舰**不一定**在对方的护航菜单上。测试因此从菜单里挑同伴而不是假定配对 |
| 7 | **结算的触发面仍窄** | `mission-settled` 只对 `source === 'admiral'` 的指令发射；Agent 自己提交的 `standing` 指令不结算。这是有意的（否则每次普通移动都会刷任务记忆），但意味着 EVT-05 里 Agent 自己发起的 SURVEY 只靠 `discovery` 事件留下痕迹 |
| 8 | **`no-decision-for` 仍无生产者** | 沿用 `08-scheduler-status.md` §5.7 |

---

## 7. 推荐下一步

1. **按 `10-agent-demo-channel.md` §4 的 runbook 人工走一遍** —— 尤其是第 5–8 步的 Path A（承诺 → REFIT
   兑现 → 下一次决策）与 Path B（Override → 下一次决策）。这是 MVP 唯一尚未由人跑过的部分。
   先看启动那行 `[agent] …` 确认自己在哪种模式（见 `10-*` §2.4）：无 key 是**确定性模式**，两种模式在
   游戏里看起来一样，但那行会告诉你正在看哪一个。
2. **`03-test-plan.md` §12 的决议仍未就地更新** —— 那一行写着"❌ 不新增 Lv3 E2E spec"，而 spec 早已存在
   且通过（`lcars.spec.ts` 5 passed、`vertical-slice.spec.ts` 2 passed）。它是红线文档
   （"冲突只登记在 `KNOWN_ISSUES.md`"），故未就地改写。
   （`CODEX_TASKS.md` 的同类问题已获授权后就地更正，见 `C-34`。）
3. **`npm run test:e2e` 全套未重跑** —— 上一次全套在 P3 结束时（35 / 37 / 14.7m）。演示通道之后只单独跑过
   `lcars.spec.ts` 与 `vertical-slice.spec.ts`，两者都通过；其余 6 个 spec 未在本次改动后重跑。
   跑完记得 `git checkout -- docs/verification`（`KNOWN_ISSUES.md` §4 记的坑）。
4. **P3 之后的常规走向**：稳定化 / 平衡 / UI 打磨 / Codex 交接。

**不要重写**：`scheduler.ts` 的判定与单一写入面、`agent-host.ts` 的寻址、
`src/engine/agent/events.ts` 的"事实而非数字"分工、`AgentControllerPort` 的 key 集合、
`tests/agent/boundary.test.ts` 的 B-2/B-11/B-13。
