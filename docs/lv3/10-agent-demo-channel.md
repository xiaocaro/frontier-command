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

同一通道还带一份**通信记录** `agentTranscriptView(w)`：`TRANSCRIPT_LIMIT = 20`，只取 Admiral 参与的
行（`from === 'admiral' || to === 'admiral'`），按时间正序。裁剪同样是设计的一部分：

| 给出 | 不给 | 为什么 |
| --- | --- | --- |
| `id`/`at`/`from`/`to`/双方 **`name`**/`kind`/`text` | `payload` | 里面只有面板不显示的 id（`promiseId`、`requestingAgentId`） |
| — | `read` | 那是 **Agent 收件箱**的机制，与 `nextDecisionAt` 同类，不是「告诉过 Admiral 的事」；而且它是**刻意的非过滤条件**——`consumeAnswered` 会在 Agent 回话时把 Admiral 那条标成已读，一过滤就把「答复所针对的那条」删掉了 |

它取自 `agentMessages` 而**不是**解析 `communications`：镜像行 `NAME ← NAME：text` 是给人读的展示
字符串，从它反解说话人／收件人／正文要写正则处理含空格的名字和全角冒号——demo 里已经有一个带 fallback
的这样的解析器。文本本身不构成新泄漏：引擎无条件把每条 Agent 发言镜像进 `communications`，而它本来就在
Snapshot 里。

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

**面板现在也显示这段对话**：`agent-thread` 列出所选 Agent 的来往（Admiral 发出的与发给 Admiral 的），
**最新在上**。倒序就是「答复显示在触发消息之上」的做法——答复在时间上必然晚于它所答复的消息，所以不需要
任何配对字段。**也没有可用的配对字段**：消息模型里就没有 reply-to，`consumeAnswered` 是刻意做粗的，
顺序是唯一的联系（与通信栏一致）。

箭头沿用**通信栏的同一套约定**（`command-system.ts` N-6：箭头背离说话人），所以面板里的
`LYRA VOSS ← Dawn Frontier Command：` 与通信栏那一行是同一句话，而不是第二份可能漂移的渲染。

面板**只在打开时**取数，因此它还按 shell 传入的 `revision`（通信栏长度，每条 Agent 消息恰好 +1）重取；
否则打开之后才到的答复永远不会出现。

发送后**仍然清空输入框**：触发消息没有消失，它进了记录，而输入框不该留着一句已经发出去的话——
`tests/e2e/vertical-slice.spec.ts` 同时断言这两件事。

**承诺为什么是两步**：`agentMessage{kind:'promise'}` 的 payload 只有一个 `promiseId`，**装不下
`fulfills`**，所以它无法创建承诺——`agentEvent{promise-made}` 才能，且 id 由引擎生成。面板因此
**创建 → 回读 id → 通知**。若第二步被拒，面板显示「承诺已创建，但通知被拒」，而不是假装成功。

### 2.3 devtools —— 让那条豁免真的成立

`electron/main.ts` 用 `before-input-event` 绑了 `F12` / `Ctrl+Shift+I`。这不是给玩家的功能，而是
把「先用 debug controls 验证」这句话从**纸面**变成**事实**：控制台打开后，
`window.frontier.command({type:'agentMessage', …})` 是可用的。

---

### 2.4 启动时说明自己在哪种模式

`AgentHost` 构造时往 **stderr** 打一行：

```text
[agent] 未配置 DEEPSEEK_API_KEY —— 本轮为确定性模式，不调用模型
[agent] 模型已配置 — {"provider":"deepseek","baseUrl":"https://api.deepseek.com","model":"deepseek-chat",…,"hasApiKey":true}
```

两个理由，都是实测来的：

- **两种模式在游戏里完全一样**——都产出合法决策、都让 Agent 应答、都写世界状态。没人分得清自己在看哪一个，
  而这正是 `C-33` 那一整段"模型贡献为零、测试全绿"能发生的原因。启动时说一句，是最便宜的可观测性。
- **用 `console.error` 而不是 `console.log`**：Windows 上 Electron 主进程是 GUI 子系统程序，
  **stdout 不送到启动它的终端**，`console.log` 写了也没人看见；stderr 会。两支都实际启动应用读过终端确认过。

**不写 `engine.log`**：world log 属于 `WorldState`，让持久化状态取决于"环境里有没有 key"正是同 seed 重放断言
要排除的环境依赖。（而且写了也没用——`snapshot().logs` 虽然被送到渲染层，**但没有任何组件显示它**。）

**key 只以布尔出现**（`describeDeepSeekConfig` 的 `hasApiKey`），已实测输出中不含密钥。

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

**第一步：看你处在哪种模式。** 启动时终端会有一行 `[agent] …`（见 §2.4）：

```text
[agent] 未配置 DEEPSEEK_API_KEY —— 本轮为确定性模式，不调用模型
[agent] 模型已配置 — {…,"model":"deepseek-chat","hasApiKey":true}
```

**本机默认是第一种**——密钥不在环境变量里（它在 claude-code-router 的 `config.sqlite`），仓库里也
**没有 `.env` 加载**。要跑"带真模型"的演示，在启动时把 key 注入环境：

```bash
DEEPSEEK_API_KEY=<key> npm run dev      # dev.mjs 会把 process.env 透给 electron
# 或
DEEPSEEK_API_KEY=<key> npm start
```

可同时覆盖 `DEEPSEEK_MODEL`（默认 `deepseek-chat`）、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MAX_TOKENS` 等。

> **不要把 key 写进 `.env`**：本仓库的 `.gitignore` **没有** `.env` 条目，那个文件会被 `git add -A`
> 一并提交。要用文件形式，先把它加进 `.gitignore`。
>
> 两种模式都会产出**合法**决策，游戏里看起来一样（这正是 `C-33` 那一整段能发生的原因），
> 所以**先读那行**再开始演示，否则无从判断自己在看模型还是确定性分档。

前提：应用已启动；载入的世界**默认暂停**，先点「继续」。

> **关于速度**（`KNOWN_ISSUES.md` `C-36`）：过期窗口现已**随速度缩放**，16× 不再丢弃模型的回答。
> 已实测（`npm run demo:live -- --speed=16`，真实端点）：**开着缩放 0 次丢弃；临时关掉缩放 63/84 = 75% 被丢**。
> 面板上的「本局模型决策 N 次 · 过期丢弃 M 次」会直接告诉你实际有没有在被丢，不必猜。

面板：控制台 PRIORITY COMMUNICATIONS 下方 → 展开 **AGENT CHANNEL · 舰桥通讯**。

| 步 | 做什么 | 应该看到 |
| --- | --- | --- |
| 1 | 面板 → 选中 Explorer → 类型 `command` → 发送「穿越虫洞，寻找失联探测船。」 | 输入框前出现 `Dawn Frontier Command → LYRA VOSS / 薇拉：`（**发送者 → 接收者**，与发出去的那一行逐字一致）；通信栏出现同一行**且它是绿色的、大一号**（最新一条高亮）；**输入框与前缀一起消失**；**面板出现「已发出」** |
| 2 | 点「继续」等一拍，再点面板的**刷新** | 通信栏出现 `<Agent> ← admiral：…`（**Agent 的答复**），**绿色高亮随之移到这一条、上一条恢复原色**；面板里该 Agent 的信任/士气可能已变 |
| 3 | 换 `negotiate` 或 `ask` 再发一条，看 Agent 如何回应 | 答复文本随其人格/目标/状态而不同 |
| 4 | 让 Explorer 与 Tactical 互相请求（Agent-Agent）：可在第 1 步的文本里点明需要护航 | 通信栏出现 Tactical 的答复行。**关系值本身看不到**——面板不渲染 `relationships`（`KNOWN_ISSUES.md` `C-39`）；要看数值请用 `window.frontier.agents()` |
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

---

## 5. 把同一份 runbook 自动跑一遍：`npm run demo:live`

人手点一遍适合给人看；要**可复现的记录**就用这条：

> **`demo:live` 必须有 key。** 它存在的意义就是"真模型跑一遍"，所以没有 `DEEPSEEK_API_KEY` 时它会
> **立刻报错退出**并把给 key 的方法打出来——这是刻意的，不是故障。
> 想在**没有 key** 的机器上跑，用 §6 的 `demo:ui`：它跟应用自身的选择走（无 key → 确定性分档），
> 并把两种模式都如实打印出来。

```powershell
$env:DEEPSEEK_API_KEY='sk-...'; npm run demo:live                 # PowerShell
$env:DEEPSEEK_API_KEY='sk-...'; npm run demo:live -- --speed=16   # 16×，检验 C-36
```
```bash
DEEPSEEK_API_KEY=sk-... npm run demo:live                         # Git Bash（= 后不要有空格）
DEEPSEEK_API_KEY=sk-... npm run demo:live -- --speed=16
```

`--speed=1|4|16`（默认 1）由 `scripts/demo-live.mjs` 读出后经环境变量交给测试——vitest 会拒绝未知
命令行选项，所以不能在测试文件里直接读它。**16× 会走和游戏一样的推进速率**（`advanceFrame` 每帧跑
`speed` 步、按 `HOST_FRAME_MS` 定速），末尾印出 C-36 的结论。

它跑 `tests/live/vertical-slice.live.ts`（经 `vitest.live.config.ts`），把八步逐步打印出来，
**包括每一条决策的 intent / choiceId / reason、Agent 说的话、以及无模型时确定性回退会怎么答**。

**它断言什么、不断言什么**（这是刻意的，不是偷懒）：

| | |
| --- | --- |
| **断言**（与模型无关，必然为真） | 承诺 `pending → fulfilled`、`trustInAdmiral` 升降、记忆出现 `promise-kept` / `admiral-override`、第 8 步两条历史的信任值差异 |
| **只打印，不断言** | 每一条 `intent` / `choiceId` / 文本；第 8 步"两次答复是否不同" |

依据：`02-mvp-traceability.md` §1 把 Live LLM 标为「人工演示，**不参与回归断言**」，
playbook §三十二 明令不得把「DeepSeek 必须输出 COUNTEROFFER」当稳定条件。真模型下同一问题两次
答案**可能相同**——那本身是结果，脚本会把它印出来。

几条实测得来的注意事项（都写在代码注释里）：

- **每一步各起一局**（vignette）。真模型会做出把世界带偏的选择，一局连跑会让后面的步骤被静默吞掉。
- **循环必须定速**（`PACE_MS = 50`）。全速推进世界会让模型思考期间过去几百游戏分钟，
  决策全部因超过 `STALE_TICK_LIMIT` 被判过期——表现就是"模型说了 accept 但什么也没发生"。
- **第 4 步的 team-request 是注入的**，不是模型自己发起的（要看的是 Tactical 的答复）。
- 脚本会打印**模型调用次数与耗时**。实测一次约 **25 次调用 / 50s**。

---

## 6. 让人**看着**跑一遍：`npm run demo:ui`

```bash
npm run demo:ui                  # 默认节奏 ×5（有观众）
npm run demo:ui -- --pace=10     # 一屋子人 / 投影，最慢
npm run demo:ui -- --pace=1      # 一个人快速看
npm run demo:ui -- --pace=0.5    # 反复重跑
```

跑 `tests/e2e/agent-channel.demo.ts`（经 `playwright.demo.config.ts`），由 `scripts/demo-ui.mjs` 启动
（先 build，再跑 playwright）。与 §5 的文字版**职责不同，两者都保留**：

| | §5 `demo:live` | §6 `demo:ui` |
| --- | --- | --- |
| 形态 | 终端文字，无界面 | **真实 Electron 窗口**，鼠标点真实控件 |
| 断言 | 承诺/记忆/信任等**引擎状态事实**，并打印模型的推理 | 只断言与模型无关的事实；其余**只展示** |
| 产物 | 可复现的文字记录 | **可见的窗口** + `test-results/agent-demo/` 的 **14 张截图故事板**（旁白烧在图里） |
| 计数 | 模型调用 N 次：成功 X / 回退 Y | **决策 N 次，其中 M 次由模型作答**（两个 act 各自 + 合计）+ 耗时 + 节奏 |
| **需要 key 吗** | ✅ **必须**——没有 key 会立刻报错退出（它存在的意义就是跑真模型） | ❌ **不需要**——跟应用自身的选择：有 key 用真模型，没有就走确定性分档 |
| 用时 | ~50s（真模型，25 次调用） | **~104s**（默认 ×5，无 key）；×10 约 190s，×1 约 35s，×0.5 约 26s |

### 关于 `--pace`（0.25–10，**默认 5**）

**观众跟不上是这个参数存在的唯一理由。** ×1 在一个人一块屏上读得正好，**有别人在看时太快**；
×10 又把这段故事拖得比它本身需要的更长，所以默认取中间的 ×5。**10 同时也是允许的上限**，
也就是当前没有比它更慢的档位；要更慢需要把上限抬高。

它缩放的是**每一次刻意的停顿**——发起一个操作之前、一个结果落地之后、以及步与步之间
——而**不动轮询超时**：那些是"模型最多能花多久"的上限，不是演出的节拍，缩短它们只会把一个慢模型
变成一次假的失败。

**默认值写在两处**（启动器与测试文件），这样直接跑 spec 而不经启动器时也是同一种节奏。

**节奏越慢，本局决策次数越多**——世界按真实墙钟走，慢一倍就多跑一倍仿真时间，Agent 的节拍自然多打几次。
实测：×1 时 32 次决策，**×5 时 73 次**，×10 时 133 次。演示**不对这个数字做任何断言**，它只是打印出来。

非法值会被拒绝并给出建议（`--pace=99` → 报错退出）。命令行参数由启动器读、经环境变量交给测试，
因为 **Playwright 会拒绝未知的命令行选项**，测试文件里读不到 `--pace`。

### 提示词之外的那次停顿：Agent 回话后世界暂停 2 秒

Agent 答复 Admiral 时，**主进程会把世界停住 2 秒再放开**（`electron/read-hold.ts`，时长由
`FRONTIER_READ_HOLD_MS` 决定，默认 2000）。这是本项目**唯一一处自动恢复**——其余所有暂停都等人来按
——所以危险的不是定时器而是**归属**：误把别人的暂停解除才是真 bug。规则是纯函数，单独成模块、单独测。

- 暂停走**普通 `pause` 命令**，所以 `WorldState` 仍然只经命令门被写（CLAUDE.md §2.1），引擎仍然权威。
- **不带 `pauseReason`**：带 reason 会弹出 `PRIORITY HOLD … 处置后继续` 的横幅，那是在要求玩家行动，
  而这里只是让人读一眼。
- **只在归属仍然是自己时**才恢复：世界仍暂停、`status` 仍 `active`、`pauseReasons` 仍为空。引擎自己发起
  的暂停（critical / commandLost）都带信号，因此进不了这个条件；而「无 reason 的裸暂停」与自己的分不开，
  所以 `main.ts` 里每一个那样的写入点都显式 `disarm()`。残余限制记在 `KNOWN_ISSUES.md` `C-41`。
- **演示不缩放它**：它是游戏本身的固定时长，不是演出的节拍（同 `expect.poll` 的上限）。演示因此**直接继承**
  它，录下来的就是玩家看到的。想让演示里的停顿时长跟着 `--pace` 走，在 `scripts/demo-ui.mjs` 里按 pace 设
  `FRONTIER_READ_HOLD_MS` 即可——那是一行的事，而且是**故意**不做成默认。

E2E 一律把它设成 `0`：确定性分档的 Agent 会**自己**开口对 Admiral 说话，一个随时可能落下的冻结会让
spec 因为与它无关的原因变得不稳定。唯一真正测它的用例（`tests/e2e/vertical-slice.spec.ts`）显式传一个
非零值，断言它**落下**、并且**自己放开**。

### 通信栏的两处调整

同一次改动里，`PRIORITY COMMUNICATIONS` 也改了排序与默认过滤，为的是同一条要求（触发消息别消失、
答复显示在触发之上）：

- **排序只把 `urgent` 钉在最前**，其余**严格按时间倒序**。原来 `high` 也参与排序，而 Override 触发消息
  被镜像为 `high`、它的答复是 `normal`，于是答复被排在它所答复的命令**下面**。`urgent` 保持置顶是原本
  刻意的部分（新威胁不该被一条刚到的 Agent 发言挤下去），这一点没动。
- **默认显示全部**（`showRead` 初始 `true`）：确认过的行不再消失。原来的默认是「仅未读」，而确认一行就
  等于把它——连同它答复的那条——从列表里删掉。按钮语义不变，仍可切回仅未读。

### 它不录像

`electron.launch({ recordVideo })` 会让本应用加载失败（`ERR_FAILED (-2) loading 'frontier://app/index.html'`），
用例会挂到 20 分钟超时——完整证据与单变量实验见 `KNOWN_ISSUES.md` `C-38`。**看鼠标点击请直接看窗口**，
那正是这个演示存在的意义；PNG 是可分享的产物。

**结尾会打印计数**：「决策 N 次，其中 M 次由模型作答」。这两个数**故意分开**——一个 beat 若不值得
调模型、或 provider 失败，那次决策仍会被确定性规则回答。所以"模型参与了多少次"是 M，
而 `N - M` 是"游戏在没有模型的情况下继续走了多少次"。把 N 当成"模型调用次数"报出去，
就是 `C-33`/`C-36` 那类静默的不准确。

八步与 §4 的 runbook 一一对应，**其中只有第 4 步（组队请求）是注入的**——面板的 kind 只有四种，
全仓库没有任何组队 UI，旁白与截图里都标了 ⚠。其余七步（含第 6 步的 REFIT 走既有 Admiral 指令对话框、
第 7 步的 Override 走面板三个控件）**全部是真实鼠标点击**。

世界是**启动前预置**的：`deepScan` 改装要一枚 specialFind，而新世界没有——所以按既有惯例用
`SaveStore` 预置一个"基地里本来就有存货"的世界，旁白里也说明了。
