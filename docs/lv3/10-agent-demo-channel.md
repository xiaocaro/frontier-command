# Agent 演示通道：决定记录与人类演示 Runbook（10-agent-demo-channel）

生成日期：2026-10-08
状态：**已实现**

---

## 1. 为什么做这件事

P3 结束时，EVT-01…09 **全部有自动测试**，规格也**从未要求**人工试玩——`03-test-plan.md` §12 把垂直切片
交给 Vitest，`07-scheduler-plan.md:371` 明写「明确不在退出判据内：任何 EVT-01…09 的游戏内可玩流程（P3）」，
`02-mvp-traceability.md` §1 甚至把 Live LLM 标为「人工演示，**不参与回归断言**」。

但一次覆盖审计发现：**这份 MVP 无法由人在运行中的应用里演示**。三条硬事实：

| 事实 | 证据 |
| --- | --- |
| UI **发不出** `agentMessage` | `src/ui/**` 全文不含 "agent" 一词；三个能发命令的 UI 路径（`OrderComposer.tsx:610`、`App.tsx:262`、`Inspector.tsx:467`）**全部发 `issueDirective`** |
| UI **看不到**任何 Agent 状态 | `snapshot()`（`projection.ts:61-199`）不含 `agents`/`agentMessages`/`agentInteractions`，因此 trust/morale/memory/promise/relationship/goal 全部不可见 |
| 运行中的应用**没有控制台** | `main.ts` 用 `removeMenu()` + `contextIsolation:true` + `sandbox:true`，且全仓库无 `openDevTools`/`before-input-event`/`globalShortcut` |

**后果**：playbook §二十五 的豁免条款（"若 MVP 可先用现有 UI / **debug controls** 验证，则不要为展示
重做 UI"）在实践中**并未成立**——那个 debug control 是 `window.frontier.command(...)`，而人在运行中的
应用里够不到它（Playwright 能，是因为它从外部注入）。MVP 的核心体验是「他为什么拒绝？」「我之前的决定
是否影响了他现在对我的信任？」，而**没有任何地方可以看**。

**用户已显式授权解开 §二十五 的「零 UI 改动 / 零新 IPC」冻结。** 本文件即那次解冻的记录。

---

## 2. 做了什么（三块，逐块最小）

### 2.1 只读的 Agent 名单 —— **新通道，而不是放大旧通道**

- `src/engine/agent/roster.ts`：纯函数 `agentRosterView(w)`，**裁剪规则就是全部设计**。
- 新增 IPC `agents:get`（`electron/main.ts`），渲染层经 `frontier.agents()` 取用。
- **没有**把 `agents` 加进 `snapshot()`：snapshot 由 `projection.ts` 裁剪并被 `tests/recon.test.ts`
  的隐私断言守着，放大它会顺便把 Agent 的 memory 文本推向渲染层——而 `N-7` 正是把 memory `text`
  列为泄漏向量。**两条通道、各自显式裁剪，比一条更宽的通道更好审计。**

**裁剪规则**（由 `tests/agent/roster.test.ts` 固定，不靠注释自称）：

| 给出 | 不给 | 为什么 |
| --- | --- | --- |
| `state`（全是数字）、`goal`、`relationships`、`promises` | — | 面板要看的正是这些 |
| 记忆的 `{kind, tags, weight, at}` | 记忆的 **`text`** | `N-7` 的泄漏向量。而 Path A/B 的可见证据**恰好就是 tag**（`promise-kept` vs `admiral-override`）——给 tag 既够用又零自由文本 |
| — | `nextDecisionAt` | 调度内部戳，是机制不是性格 |

记忆条数取 `ROSTER_MEMORY_LIMIT = 6`，用 `recentMemories()` 排序（**与决策看到的同一种排序**），
所以面板里最上面那条就是决策最在意的那条。

### 2.2 最小 LCARS 面板

- `src/ui/components/AgentChannel.tsx`，挂在 `.communications` **内部**、`.comms-list` 之后。
- **默认折叠**（`<details>`，与 `.resource-strip` 里既有的模式一致）：控制台几何被
  `tests/e2e/lcars.spec.ts` 在六种窗口尺寸下断言，一个只在演示时需要的面板，平时应该只占一行。
- **不新增第 4 个 `.command-deck` 子元素** —— 那会改变三列栅格并顶掉地图高度断言。
- 复用 `LcarsButton`/`LcarsTextBar` 与既有 token，不引入新设计语言。
- **读取只读，写入仍走 `world:command`**（CLAUDE.md §2.1 不变）。

**面板能做的**：选 Agent / 选 kind（`command`·`ask`·`negotiate`·`override`）/ 填文本 / 发送；
override 另给一个 `directiveActionType` 选择器；一个 **`承诺 Deep Scan 优先权限`** 按钮；
一个**刷新**按钮。`ENCOURAGE` 不做（`02-mvp-traceability.md` §1 判为延后）。

**承诺为什么是两步**：`agentMessage{kind:'promise'}` 的 payload 只有一个 `promiseId`，**装不下
`fulfills`**，所以它无法创建承诺——`agentEvent{promise-made}` 才能，且 id 由引擎生成。面板因此
**创建 → 回读 id → 通知**。若第二步被拒，面板显示「承诺已创建，但通知被拒」，而不是假装成功。

### 2.3 devtools —— 让那条豁免真的成立

`electron/main.ts` 用 `before-input-event` 绑了 `F12` / `Ctrl+Shift+I`。这不是给玩家的功能，而是
把「先用 debug controls 验证」这句话从**纸面**变成**事实**：控制台打开后，
`window.frontier.command({type:'agentMessage', …})` 是可用的。

---

## 3. 边界与红线（本次显式改动）

`tests/agent/boundary.test.ts` 里那条断言原为
「preload 不含 `agent|model|llm|decision`，且 `ipcRenderer.invoke` 恰好 5 个」。
新通道让它必然失效。按仓库既有惯例（P2.5 对 B-11 的做法）**反转而非删除**：改为
**逐一列出渲染层应有的通道并断言精确相等**（现在是 6 个），并继续禁止 `model|llm|prompt`。
这比"不含 agent 字样"更强，且把"通道只能这么多"的意图固定下来。

**仍然不动的**：`src/engine/projection.ts` 的 `snapshot()`、`src/engine/**` 的物理规则、
`AgentControllerPort`、`schemas/*.json`、存档版本、`scheduler.ts`/`runtime.ts` 的判定、
`B-2`/`B-11`/`B-13` 三条。

---

## 4. 人类演示 Runbook

前提：`npm start`（或 `npm run dev`）启动应用；载入的世界**默认暂停**，先点「继续」；
`speed` 用 `16×` 让 Agent 的节拍（每 15 游戏分钟一次）来得快些。

面板：控制台 PRIORITY COMMUNICATIONS 下方 → 展开 **AGENT CHANNEL · 舰桥通讯**。

| 步 | 做什么 | 应该看到 |
| --- | --- | --- |
| 1 | 面板 → 选中 Explorer → 类型 `command` → 发送「穿越虫洞，寻找失联探测船。」 | 通信栏出现 `舰队司令 → <Agent>：…`；**面板出现「已发出」** |
| 2 | 点「继续」等一拍，再点面板的**刷新** | 通信栏出现 `<Agent> ← admiral：…`（**Agent 的答复**）；面板里该 Agent 的信任/士气可能已变 |
| 3 | 换 `negotiate` 或 `ask` 再发一条，看 Agent 如何回应 | 答复文本随其人格/目标/状态而不同 |
| 4 | 让 Explorer 与 Tactical 互相请求（Agent-Agent）：可在第 1 步的文本里点明需要护航 | 出现 `team-request` / `team-reply`；面板刷新后两者的 `relationships` 变化 |
| 5 | **Path A**：点「承诺 Deep Scan 优先权限」 | 「承诺已创建，并已通知」；面板里该 Agent **多出一条未兑现承诺** |
| 6 | 兑现：用既有的 **Admiral 指令**对话给某艘舰下 `REFIT`（Deep Scan），等它装好 | 面板刷新后承诺变 **fulfilled**，信任上升，记忆 tag 出现 **`promise-kept`** |
| 7 | **Path B**（另起一局）：类型 `override` → 选一个 `directiveActionType` → 发送 | 面板里信任**下降**、士气下降，记忆 tag 出现 **`admiral-override`** |
| 8 | 再发一条新的高风险 `command`，看 Agent 的答复 | **同一名 Agent，因上一步的历史不同，答复不同**（Path A 更愿接，Path B 更保守） |

**第 8 步是 §50 的闭环**，也是 `03-implementation-plan.md` §3.4 的退出判据。它现在**两种配置下都成立**：
- 有 key（真实模型）：模型自己权衡；
- **无 key（游戏默认）**：确定性分档 —— 由 `tests/agent/vertical-slice.test.ts` 的
  *「the two histories reach different answers through the real host, with no provider」* 固定，
  Path A 的历史在那条测试里是**真跑一次 REFIT** 造出来的。

**看什么、不看什么**：面板显示记忆的 **tag**，不显示文本。要看「他具体记得什么」，读通信栏里
Agent 自己说的话——那是它自己写的，不是从世界状态推出来的。
