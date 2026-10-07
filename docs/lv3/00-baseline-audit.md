# Lv3 基线审计（00-baseline-audit）

审计日期：2026-10-07
审计对象：`D:\Geek Tech\frontier-command`，分支 `main`，HEAD `770822f`
审计目的：在不修改 `src/`、`electron/`、测试与游戏逻辑的前提下，建立“当前代码可信基线”，供后续 Lv3 Agent 工作与 Codex 接手直接消费。

> 本文只做**现状审计**。按任务要求，本阶段**不设计** Lv3 Agent 的 Goal / Memory / Planner / Scheduler / Schema，只记录扩展点位置。

---

## 0. 审计范围与方法

执行顺序：先枚举已有文档 → 按文件名、日期、版本号与 git history 判断作用 → 阅读形成认知 → **对关键结论回到源码与测试逐条核对** → 打标签。

标签定义：

| 标签 | 含义 |
| --- | --- |
| `VERIFIED` | 文档描述与当前代码/测试一致 |
| `STALE` | 文档描述曾正确，但已被当前代码超越 |
| `CONFLICT` | 文档之间或文档与代码互相矛盾 |
| `MISSING` | 代码存在但缺少可靠文档；或文档引用的产物不存在 |

**本次实际执行的验证命令**（结果如实记录）：

| 命令 | 结果 |
| --- | --- |
| `npm test` | ✅ 通过，**13 文件 / 184 项**，exit 0（2026-10-07 实际运行） |
| `npm run build` | ✅ 通过，`tsc --noEmit` + `vite build` + `tsc -p tsconfig.electron.json`，exit 0 |
| `npm run test:e2e` | ⚠️ **36 项：34 通过 / 2 失败**（15.5 分钟），exit 1。两项失败均在 `mine-accidents.spec.ts`，定性见 §4 C2 |
| `node scripts/acceptance-v9.mjs 236807` | ❌ **本次未运行** |

> ⚠️ **运行 E2E 的环境前提**：本机 shell 环境中存在 `ELECTRON_RUN_AS_NODE=1`，会使 `electron.exe` 以纯 Node 模式启动，从而拒绝 `--remote-debugging-port=0` 等 Chromium 参数（报 `bad option`），导致 `electron.launch` 全部失败、**36 项全红**。必须 `env -u ELECTRON_RUN_AS_NODE npm run test:e2e` 才能得到真实结果。另注意：`npm run test:e2e | tail` 会把 npm 的退出码替换成 `tail` 的退出码，掩盖真实失败——不要通过管道判断成功与否。

**工作区状态**：`src/`、`electron/`、`tests/` 全部干净（无未提交改动）。`docs/verification/**` 下大量 PNG/JSON 显示为 modified，经核对为**字节确实不同**（如 `veil-recovered.png` 244602→242953 bytes），属于上次验证重跑后重新生成的证据文件，与代码无关。`CLAUDE.md` 当前为未跟踪文件（`?? CLAUDE.md`）。

---

## 1. 已有文档清单

### 1.1 git history 现状

仓库只有 **3 个 commit**（`770822f` 初始提交 + stash 产生的 2 个）：

```
770822f Initial commit: project structure and base files
11c59ac index on main: 770822f ...   (stash)
6016e05 WIP on main: 770822f ...     (stash)
```

`refs/heads/main` 与 `refs/remotes/origin/main` 都指向 `770822f`。

> ⚠️ **`CONFLICT`**：`docs/verification.md:3` 与 `docs/acceptance.md:26` 都声明“基线为本地提交 `49f5660`”，但 `git cat-file -t 49f5660` 返回 `fatal: Not a valid object name`。**该基线提交不在本仓库历史中**。因此文档中所有以 `49f5660` 为锚点的历史描述无法用 git 复核，只能以当前工作树代码为准。所有文档文件 mtime 均为 `2026-10-06 07:00`（同一次检出），**不能用于判断版本先后**。

### 1.2 文档清单

| 文件 | 自述日期/角色 | 与当前代码关系 |
| --- | --- | --- |
| `AGENTS.md` | 2026-10-07，仓库级 Agent 指令 | 当前。是 Lv3 边界的权威陈述之一 |
| `CLAUDE.md` | 2026-10-07，Claude 工作流指令 | 当前。**未纳入 git** |
| `README.md` | v10，面向用户 | 当前。声明 “Lv1 + Lv2 / v10，没有 LLM 决策” |
| `题目要求.md` | 赛题原文（Lv1–Lv4） | 当前。Lv3 需求的唯一权威来源 |
| `docs/architecture.md` | 21KB，v9/v10 架构 | **信息密度最高**。但按版本分段叙述，无“当前版本”抬头 |
| `docs/worldbuilding.md` | 世界与阵营规则 | 当前。含 “Future Agents” 一节 |
| `docs/acceptance.md` | v10 验收 | 部分 `STALE`（见 §4） |
| `docs/demo-script.md` | v9 演示脚本 | 当前（标题仍写 v9） |
| `docs/references.md` | 参考资料阅读记录 | **`STALE`**（见 §4） |
| `docs/lcars26-refactor.md` | 2026-10-02，纯 UI | 当前。明确声明“没有修改 `src/engine/`” |
| `docs/verification.md` | v9 验证记录 | 历史记录，锚点提交不存在 |
| `docs/verification-v5.md` | 历史 v5 | 历史 |
| `docs/verification/mine-accidents/README.md` | **2026-10-06，最新** | **当前且诚实**。测试数字与本次实测一致 |
| `docs/verification/{v8,v9,v10}/` | 机器证据（PNG/JSON） | 证据文件，非设计文档 |
| `fonts/README.md` | 字体校准说明 | 当前 |
| `tests/fixtures/v9/README.md` | v9 夹具说明 | 当前 |

### 1.3 关键空白

- **不存在 `docs/lv3/`**（本次审计创建）。
- **不存在 `schemas/`**（CLAUDE.md §6 要求的 JSON Schema 目录）。
- **不存在 `prompts/`**（CLAUDE.md §7 要求的版本化提示词目录）。
- 不存在任何 `docs/**` 之外的历史设计文档（无 `verification/` 顶层目录，仅 `docs/verification/`）。

---

## 2. 当前验证过的架构

### 2.1 SimulationEngine — `VERIFIED`

- 定义：`src/engine/engine.ts:24`，`class SimulationEngine`，持有 `state: WorldState`（`engine.ts:25`），构造时 `structuredClone(world)`（`engine.ts:29`）——引擎与世界对象解耦。
- 绑定式方法（`engine.ts:86-90`）：`validate`、`dispatchCommand`、`submitAction`、`snapshot`、`getObservation` 均 `bind(this)`。
- 随机源：`random()` 为引擎内的 LCG（`engine.ts:34-37`），读写 `state.seed`。**随机源属于世界状态**，随存档持久化。
- 副作用记录：`log` / `report` / `record` / `critical` / `finishCritical`（`engine.ts:38-82`）。
- 固定步校验：`step()` 在 `fixedDelta !== FIXED_DELTA` 时**直接抛错**（`engine.ts:135`）。

与 CLAUDE.md §2.1 的 `Command → Validation → SimulationEngine → WorldState` 一致：引擎是唯一持有并变更 `WorldState` 的地方。

### 2.2 WorldState — `VERIFIED`

- 定义：`src/engine/types.ts:474-522`。`version: 10` 为字面量类型。
- 结构：`tick/time/seed/initialSeed/paused/speed/status/pauseReasons` + `commander` + **`operators`** + **`assignments`** + `losses` + `ships` + `enemies` + `sectors/systems/bodies/locations/projects/jobs/wrecks` + `intel/siteIntel` + `factions/tension` + `resources/upgrades` + `groups/personnel/events/wormholes/civilians/trade` + `communications/logs/history/beams` + 各类 `nextId` 计数器。
- 世界即存档：`SaveStore.write()` 直接持久化 `engine.state`（`electron/persistence.ts:178`）。

### 2.3 Observation — `VERIFIED`（但见 §6 的缺口）

- 类型：`ObservationData`（`types.ts:643-652`），导出为 `ReadonlyDeep<ObservationData>`（`types.ts:665`）。
- 字段：`time, operatorId, ship, contacts, systems, bodies, opportunities, legalActions`。
- 构造：`projection.ts:199-228`。先取 `assignments`→`ship`，**无分配则返回 `null`**；随后 `structuredClone` 脱离引擎状态。
- 只读性有测试保障：`tests/architecture.test.ts:28-30` 断言改写 `snapshot.ships[0].hull` 不影响 `engine.state`。

### 2.4 Command — `VERIFIED`

两级契约，均为 Zod：

1. **`Command`**（`types.ts:577-640`，schema `commands.ts:117-243`）：全部使用 `.strict()`。约 25 种，含 `issueDirective` / `cancelDirective` / `standingOrders` / `setCloak` / 编队 / `buildShip` / `upgrade` / `manufacture` / `capture` 相关 / `pause` / `speed` 等。
2. **`Action`**（`types.ts:210-240`，schema `commands.ts:25-78`）：21 种指令动作，含 `MOVE / EXPLORE / SURVEY / RETURN / ASSIST_EVENT / TRANSIT / CAPTURE / HAIL / HAUL / ATTACK|DISABLE|DRIVE_OFF|INTERCEPT|SHADOW / ESCORT / PATROL / RETREAT|DOCK / REPAIR / REARM / REFIT / UNLOAD / RECOVER`。

验证分三层，顺序明确：

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 格式 | `commandSchema` / `actionSchema` | Zod 结构校验 |
| 权限 | `validate()` `command-system.ts:149-167` | actor 必须是 `commander.id`，否则只允许“为自己名下单舰下单” |
| 规则 | `validateAction()` `command-system.ts:34-148` | 库存/模块/情报时效/槽位/容量等游戏规则 |

### 2.5 AgentControllerPort — `VERIFIED`，且是本项目**唯一已存在的 Lv3 接缝**

- 类型：`types.ts:653-656`，**恰好两个方法**：`getObservation(): Observation | null`、`submitAction(action: Action): CommandResult`。
- 实现：`engine.ts:91-96`，返回 `Object.freeze({...})`。
- 可执行规格：`tests/architecture.test.ts:9-31` 断言 `Object.keys(port).sort()` **恰好等于** `['getObservation','submitAction']`，并断言：
  - `port.submitAction({type:'MOVE',...}).ok === true`
  - `port.submitAction({type:'DOCK',...}).ok === false`（规则层拒绝）
  - `e.dispatchCommand({...shipIds:['vigil']}, 'ops-verity').ok === false`（越权拒绝）
  - `e.controllerPort('unknown').getObservation() === null`

**`submitAction` 的实际语义**（`command-system.ts:550-563`）：

```
Zod 校验 action
  → 找不到 operator 的 assignment          → no('执行主体不可用')
  → current/queue/suspended 存在 admiral 指令 → no('Admiral 当前、队列和挂起指令优先')
  → 该舰有任何在途指令                      → no('执行主体正在完成既有行动')
  → dispatchCommand(issueDirective, [本舰], QUEUE)
```

即“**Admiral 绝对优先**”是硬编码在 `submitAction` 里的，与 AGENTS.md / worldbuilding.md 的 Admiral 权威设定一致。

### 2.6 SaveStore / persistence — `VERIFIED`

- 定义：`electron/persistence.ts:37`。
- 存档根（`persistence.ts:44-45`）：`frontiers-v10/` 目录 + `timeline-v10.json` 索引，**与 v9 及更早完全隔离**。
- 原子写：`atomic()` = 写 `.tmp` 后 `renameSync`（`persistence.ts:28-31`）。
- 读取优先级（`read()` `persistence.ts:106-149`）：`failure.json`（封存的失败时间线）→ `head.json` → `head.json.bak`；任一环节遇到不支持的版本即 `blocked = true`，**拒绝覆盖**。
- v9→v10 迁移（`migrateTimeline()` `persistence.ts:64-102`）：先全部校验到 staging 目录，再 `renameSync` 发布，**v9 原文件从不改写**；失败则 `blocked`。
- 版本闸门：`parseSave()`（`src/engine/saves.ts:49-56`）——`version === 9` 走 `migrateV9`，`!== 10` 抛 `UnsupportedSaveVersionError`。
- schema：`src/engine/save-schema.ts:133` `version: z.literal(10)`，全文 741 行，含跨引用、容量、模块槽、预留、历史计数等**交叉一致性检查**（如 `save-schema.ts:524-532` 校验 assignment 的 operator 必须 `available`）。
- v9 契约已冻结：`src/engine/legacy-v9/save-schema.ts`，`saves.ts:3` 引入，**不得修改**（`architecture.md:185` 明确要求）。

### 2.7 当前 Agent / Operator 模型 — `VERIFIED`（存在但为占位）

```ts
// types.ts:382-392
interface Operator {
  id: string;
  name: string;
  kind: 'rules';                                  // ← 字面量，只有一种取值
  availability: 'available' | 'vesselLost';
}
interface Assignment { operatorId: string; shipId: string; since: number; }
```

- 创建：`data.ts:175-181` —— 每艘初始舰船生成一个 `ops-<shipId>`，`kind: 'rules'`，并建立 1:1 `assignments`。
- 持久化约束：`save-schema.ts:158` `kind: z.literal('rules')`（**硬字面量**）；`save-schema.ts:521-532` 强制 ship↔operator **一一对应且无重复**，operator 必须 `available`。
- 公共可见：`operators` 与 `assignments` 都进入公开 `Snapshot`（`projection.ts:80-81`，`types.ts:539-540`）。
- 舰船损失：`combat.ts:108` 将对应 operator 置为 `vesselLost`。

**结论**：Agent/Operator 的**数据结构与权限接缝已经存在且经过测试**，但**没有任何自主决策实现**——`kind` 只有 `'rules'`，没有调度器，没有模型调用。

### 2.8 Game loop / tick loop — `VERIFIED`

- 时钟常量（`src/engine/clock.ts`）：`TICKS_PER_MINUTE = 10` → `FIXED_DELTA = 0.1` 游戏分钟；`MINUTES_PER_DAY = 1440`；`TICKS_PER_DAY = 14400`；`HOST_FRAME_MS = 100`；`SIMULATION_SPEEDS = [1, 4, 16]`。
- 步进：`SimulationEngine.step()`（`engine.ts:134-161`）顺序为
  `tick++` → `time = tick/10` → 清理光束 → `updateSensors`（每 10 tick）→ `advanceEconomy` → 逐舰 `advanceShip` → 逐敌 `advanceEnemy` → `advanceTrade` → `advanceFactions` → `advanceEvents`。
- 帧：`advanceFrame(afterStep?)`（`engine.ts:162-171`）按 `state.speed` 重复 `step()`，`paused` 时立即停止。
- 宿主：`electron/main.ts:165-196`，`setInterval(..., HOST_FRAME_MS)` 调用 `advanceFrame`，`afterStep` 回调内处理 `dayBoundary → store.daily` 与 `commandLost → store.write`；随后按 tick/日志/criticalPause 触发自动保存。

> ✅ 该循环内**没有任何网络调用、Promise、await 或模型调用**——完全满足 CLAUDE.md §2.4 与题目要求“实现边界”一节（模型不需每帧/每 Tick 调用）。

### 2.9 IPC 边界 — `VERIFIED`

- `electron/preload.ts:3-20`：只暴露 `getState / command / save / timeline / setDisplayZoom / onEvents / onState`。
- Renderer 只能拿到 `Snapshot`（只读），所有变更走 `world:command` → `engine.dispatchCommand`（`main.ts:131`）。
- `main.ts:91-98` 校验 IPC 发送方必须是主窗口主框架。
- 隐藏信息确实不过界：`tests/architecture.test.ts:85-102` 断言 `Snapshot` 无 `enemies`/`seed`/`factions`，未发现设施不出现，失联接触位置冻结。

### 2.10 LLM 相关代码 — `VERIFIED`（**不存在**）

对 `src/ electron/ tests/ scripts/` 全量 grep `llm|openai|anthropic|prompt|gpt|claude|inference|neural`：**零命中**。

- 无 API 客户端、无 provider 配置、无提示词文件、无密钥管理、无网络依赖（`package.json` 运行时依赖仅 `@fontsource/antonio`、`react`、`react-dom`、`zod`）。
- `docs/references.md:45-47` 提到曾阅读 GLM-4.6v-flash 文档并计划“后续只在决策节点通过结构化动作接入”，**该计划从未落地**。

**这是 Lv3 最重要的基线事实：Lv3 的模型层是从零开始，且不存在任何需要兼容的既有 LLM 代码。**

---

## 3. Lv1 / Lv2 当前边界

基线声明为 “Lv1 + Lv2 / v10”（`README.md:3`），且**不含 LLM 决策**（`README.md:5`）。

### Lv1 — 至少三类机制不同的活动：`VERIFIED`

不是“名称与奖励数值不同”，而是规则层真实分叉（`validateAction` `command-system.ts:34-148`）：

| 活动 | 差异化机制 | 证据 |
| --- | --- | --- |
| 战斗 / 安全 | 需**已观测且未过期**的情报（`RULES.intelTTL`）；定向禁用额外要求 `precisionTargeting` 模块 | `command-system.ts:105-121` |
| 探索 / 调查 | `EXPLORE` 受**传感器范围**约束（`longRangeSensors` 使候选范围 1→2）；`SURVEY` 的 `deep` 需 `deepScan` 模块 | `command-system.ts:72-90` |
| 采矿 / 提取 | 有限矿藏 + 3000 仓位上限 + 事故停工；产能与 `science` 相关 | `README.md:22-24`，`capabilities.ts:11` |
| 运输 / 物流 | 真实货舱容量约束（`capabilities(s).cargo`）；`repeat` 需 `logistics` 升级；危险航段真实损伤 | `command-system.ts:91-98`，`capabilities.ts:12` |

具备“高风险高收益 / 低注意力持续产出 / 稳定但受航线影响”的区分，符合题面 Lv1。

### Lv2 — 两条相互独立的成长路径：`VERIFIED`

两条路径都**改变能力**而非仅加百分比（符合题面“成长不能只是数字增加”）：

| 路径 | 载体 | 改变什么 | 证据 |
| --- | --- | --- | --- |
| Fleet Development | `ModuleId` 5 种 + 有限槽位 `MODULE_SLOTS` | Deep Scan 解锁隐藏异常扫描；Long Range 双倍传感器；Precision Targeting 解锁定向禁用；Reinforced Shields 危险航段减伤；Expanded Cargo +50 | `progression.ts:8-34`，`capabilities.ts:3-15` |
| Frontier / Starbase Development | `UpgradeId` 5 种（全指挥部共享） | Shipyard 解锁 Constitution/Galaxy；Armory 弹药制造减半；Sensors 扩展探测；Logistics 解锁持续货运；Defense Grid 解锁平台 | `progression.ts:35-61` |

另有 `productionDiscountUnlocked`（首次实际取得 Special Finds 后造舰/弹药永久五折，`README.md:43`）与基地接管/改建（`README.md:45`）。

### 结论

**Lv1 与 Lv2 已经闭环并可独立游玩；Lv3 的实现量为 0。** 基线干净，没有半成品 Agent 代码需要清理或兼容。

---

## 4. 文档与代码冲突

### C1 — 测试数量：`acceptance.md` `STALE`

- `docs/acceptance.md:7` 称 “`npm test` 的 **175 项**测试全部通过”。
- 本次实测：**13 文件 / 184 项通过**（exit 0）。
- `docs/verification/mine-accidents/README.md:5` 称 “13 文件、**184 项**通过”——与实测一致。
- 判定：`acceptance.md` 为 `STALE`；`mine-accidents/README.md` 为当前准确值。仅数量漂移，非行为冲突。
- **✅ 已订正（2026-10-07）**：`acceptance.md` 保留 2026-10-06 原始记录，另加“2026-10-07 复核”段落说明实测为 184 项并指向本文件。

### C2 — Electron E2E 是否全量通过：`CONFLICT` → **已仲裁**（2026-10-07 实跑）

原冲突：

- `docs/acceptance.md:7` 称：“Electron 全量回归的 **34 个用例已完成验证**：首次运行 25 项通过，9 项旧英文文案断言更新后全部重跑通过”。
- `docs/verification/mine-accidents/README.md:7` 称：“本轮完整 Electron 回归在用户要求停止时**已有 23 项通过；未完成剩余测试，不声明全量通过**”。

**仲裁结果（`env -u ELECTRON_RUN_AS_NODE npm run test:e2e`，2026-10-07）**：

```
Running 36 tests using 1 worker
  x  17 mine-accidents.spec.ts:48  old blocked mine exposes repair shortage, ...
  x  18 mine-accidents.spec.ts:130 onsite responder cargo repairs without remote inventory, ...
  2 failed
  34 passed (15.5m)
```

**两份文档都不准确**：

- 套件现为 **36** 项，不是 `acceptance.md` 所说的 34 项（多出的正是后来新增的 2 项矿场流程）。
- `mine-accidents/README.md` 称“两项新增矿场 Electron 流程**均通过**”，但这两项**现在都失败**。
- 其余 **34 项全部通过**——Lv1/Lv2 主链路（command-v9 / desktop / lcars / recon / v10 / v9-ui）无回归。

**两项失败的定性（已逐一定位，均非游戏规则缺陷）**：

| # | 测试 | 失败原因 | 定性 |
| --- | --- | --- | --- |
| 17 | `mine-accidents.spec.ts:48` | `Error: UNKNOWN: unknown error, open 'docs\verification\mine-accidents\supply-composer.png'` —— 存截图时文件被瞬时占用。**隔离重跑该项通过**，且该文件运行前后均可写 | **环境性 / flaky**（Windows 文件锁） |
| 18 | `mine-accidents.spec.ts:130` | 断言 `toContainText('现场施工', {timeout: 15000})`，实得仍为「航行中 ... 货舱材料 5」。**隔离重跑仍失败**，同一文本 | **确定性失败，测试期望过紧**（见下） |

**#18 的根因（已算出，非猜测）**：测试在 `mine-accidents.spec.ts:137-138` 把 `verity` 放在 `mine.x + 100`，即**恰好 100 单位**。`verity` 是 `constitution` 级，`warp = 6.5`（`definitions/ships.ts:146`），`engines = 100`（`data.ts:45`），故 `capabilities().warp = 6.5`。`move()` 每步推进 `warp × dt = 6.5 × 0.1 = 0.65` 单位（`navigation.ts:52-54`）。所需步数 `100 / 0.65 ≈ 153.8` 步；1× 速度下每 100ms 一步 → **约 15.38 秒**。测试给的 timeout 是 **15.000 秒**。

→ **缺口约 0.4 秒 + 渲染/轮询开销，属边际超时**。引擎行为本身正确：`tests/mine-accidents.test.ts`（单元层，216 行）全部通过，184 项单测无一失败。

**处置建议（不在本次改动范围内，需团队决定）**：把 `mine-accidents.spec.ts:149` 的 timeout 从 15000 提到 30000，或把 `:137` 的初始距离从 100 调小。**本审计不修改任何测试文件**——该决定应显式做出，而非由审计方顺手改掉。

### C3 — 基线提交 `49f5660` 不存在：`CONFLICT`

- `docs/verification.md:3`、`docs/acceptance.md:26` 均以 `49f5660` 为基线锚点，但该对象不在本仓库（§1.1）。历史叙述不可复核。
- **✅ 已订正（2026-10-07）**：两份文档均在锚点处加“基线标注”引用块，说明 `49f5660` 不在本仓库历史中、该描述无法用 git 复核。原文保留。

### C4 — 项目等级自述：`references.md` `STALE`

- `docs/references.md:9` 称“**本项目按 LV1 制作**”。
- 实际：`README.md:3` 与 `AGENTS.md` 均声明 **Lv1 + Lv2**，代码中两条成长线（§3）确实存在。
- 判定：`STALE`，属早期文字未更新。
- **✅ 已订正（2026-10-07）**：`references.md` 原句已替换为「更正」块，说明项目实际完成 Lv1 + Lv2、Lv3 尚未开始。

### C5 — 存档版本叙述混杂：`architecture.md` `STALE`（表述问题）

- `docs/architecture.md` 按 “v9 Implementation”（第 117 行起）与 “v10 production…”（第 183 行起）分段，但**没有“当前存档版本 = 10”的抬头**。
- 第 137 行（在 v9 小节内）写 “v9 saves use timeline-v9.json … The save version remains 10”，而代码中当前版本确为 10（`save-schema.ts:133`）、v9 仅作为迁移输入（`saves.ts:52`）。
- 判定：内容与代码不矛盾，但对新读者**极易误判当前版本**。
- **✅ 已订正（2026-10-07）**：`architecture.md` 标题下新增引用块，显式声明当前存档版本 = 10、v9 仅作迁移输入、v9 契约已冻结，并提醒不要据分段推断现行版本。

### C6 — 验证证据文件与初始提交不一致：`STALE`（非代码）

- `docs/verification/**` 下 50+ 个 PNG/JSON 在工作区显示 modified，且为真实字节差异。
- **`src/`、`electron/`、`tests/` 全部干净**，故不影响代码基线。但意味着**文档引用的截图不再是仓库中存放的那份**。

---

## 5. 文档缺失（MISSING）

### M1 — Agent / Operator 接缝无文档

`Operator`、`Assignment`、`AgentControllerPort`、`submitAction` 的语义**只散落在代码与测试中**。`docs/architecture.md` 仅第 135 行一句话提及：

> “AgentControllerPort exposes only getObservation and submitAction for its assigned vessel; an active Admiral directive rejects an autonomous submission.”

缺失内容：observation 契约、Admiral 优先的确切规则、`Operator.kind` 的取值集合与扩展方式、assignment 的 1:1 不变量。

### M2 — `legalActions` 语义未定义，且与真实规则**不一致**

`projection.ts:212-226`：

```ts
legalActions: s.current ? [] : [
  'MOVE','EXPLORE','SURVEY','HAUL','PATROL','RETREAT','RETURN',
  'ASSIST_EVENT','TRANSIT','CAPTURE','HAIL',
]
```

- 该列表**硬编码**，并非由 `validateAction()` 推导。
- **遗漏**了 `Action` 联合中真实存在且可执行的：`ATTACK`、`DISABLE`、`DRIVE_OFF`、`INTERCEPT`、`SHADOW`、`ESCORT`、`RECOVER`、`REPAIR`、`REARM`、`REFIT`、`UNLOAD`、`DOCK`。
- **条件性错误**：无条件列出 `TRANSIT`（需虫洞已发现）、`CAPTURE`（需目标为 ruined 且无他舰在接管）、`HAIL`（需已识别实时 Romulan 接触且冷却结束）——这些都可能被规则层拒绝。
- 因此 `legalActions` **不能作为合法动作的权威来源**。该字段既无文档说明，也无测试覆盖其内容。

### M3 — Observation 对公司状态与同伴不可见

`ObservationData` 只含 `ship + contacts + systems + bodies + opportunities + legalActions`。**不含**：`baseResources`/`inventories`、`events`、`communications`、`personnel`、`groups`、其他 `operators`/`assignments`、`upgrades`、`tension`、`cost/生产报价`。

题面 Lv3 要求 Agent 依据“**公司当前状况**”与“**与其他 Agent 或真人玩家的关系**”决策——当前**没有任何观测通道**可承载这两类信息。这是扩展点而非缺陷（`Snapshot` 已含大部分数据，只是未投影进 `Observation`）。

同一原因，Agent 无法从自身 `Observation` 判断一次 `HAUL` 的可行库存、或一次 `buildShip` 的报价。

### M4 — 无 `schemas/`、无 `prompts/`

CLAUDE.md §6 / §7 要求 JSON Schema 跨工具契约与版本化提示词目录；当前二者皆不存在，`package.json` 也无相关脚本。

### M5 — 无决策点 / 调度器文档（因为不存在）

代码中**没有**任何 Agent 决策点、调度边界、决策节流或 deadline 机制（对比：敌方 AI 有 `Enemy.nextDecision`，见 `types.ts:298`，`threats.ts` 用模拟时间 deadline）。人类侧的“决策”纯靠 UI 下发 Command。

### M6 — `docs/lv3/` 全套文档缺失

CLAUDE.md §8 / §14 列出的 `00-baseline.md` … `CODEX_TASKS.md`、`CLAUDE_TO_CODEX.md`、`KNOWN_ISSUES.md` 均不存在。本文（`00-baseline-audit.md`）是首份。

---

## 6. Lv3 可能涉及的扩展点

> 仅记录**接缝位置**，不设计方案。

### E1 — `Operator.kind` 是唯一的身份扩展点

- 现状：`kind: 'rules'`（`types.ts:385`），并在 `save-schema.ts:158` 与冻结的 `legacy-v9/save-schema.ts` 中为**字面量**。
- 扩展需同时处理：`types.ts` 类型、`save-schema.ts` 校验、`data.ts:175` 创建、`combat.ts:108` 损失处理。
- ⚠️ **`legacy-v9/save-schema.ts` 不得修改**（`architecture.md:185`：v9 契约已冻结）。新增 Agent 状态若进入 `WorldState`，必须走 **v11 + 迁移**，沿用 `saves.ts:migrateV9` 与 `persistence.ts:migrateTimeline` 已建立的 staged-migration 模式。

### E2 — `AgentControllerPort` 是可执行契约，扩展会触及测试

- 当前被 `tests/architecture.test.ts:13` **精确断言为恰好两个键**。任何新增方法都会使该测试失败——这是**有意的设计闸门**，扩展前必须显式决策并同步更新该规格。
- `Object.freeze`（`engine.ts:92`）意味着端口本身不可被 Agent 侧改写。

### E3 — `submitAction` 的 Admiral 优先是 Lv3 张力的落点

- `command-system.ts:556-558`：只要该舰存在任何 `source === 'admiral'` 的 current/queue/suspended 指令，自主提交即被拒绝。
- 这直接对应题面 Lv3 “Agent 不必无条件服从真人玩家”与 AGENTS.md “明确的 Admiral 命令优先于 Standing Orders”。任何“拒绝/协商/抗命”玩法都必须在此处或其上层设计，**且不能破坏该不变量的既有测试**。

### E4 — 决策点必须位于固定步之外

- `step()` 是同步、确定、禁止非固定步长的（`engine.ts:135`），宿主循环亦无异步入口（`main.ts:165-196`）。
- 现成的模式参考：`Enemy.nextDecision` + `advanceFactions` 用**模拟时间 deadline** 做低频决策（`types.ts:298`）。
- CLAUDE.md §2.4 与题面“实现边界”都要求模型调用落在显式决策点，**不得进入 `step()`**。

### E5 — Observation 需要扩展才能支撑 Lv3 决策输入

见 M3。可复用的数据已在 `projection.snapshot()`（`projection.ts:59-198`）中投影完毕，扩展属“选择子集 + 加只读类型”，不需新数据源。

### E6 — `legalActions` 需要成为真实规则投影（或明确降级为提示）

见 M2。若要让它可被模型信任，应改为基于 `validateAction()` 推导；若保留为提示，则必须在文档与提示词中明确其**非权威**性质。

### E7 — 可用的“世界机会”已经存在

`projection.ts:10-58` 的 `opportunities()` 已经是**从世界状态派生的机会列表**（`exploration / mining / logistics / security / construction`），并已进入 `Observation`。AGENTS.md 的 “Self-Generating MMO Ecology” 已具备数据基础，Lv3 的任务选择可直接建立其上。

### E8 — 持久化与确定性约束

- Agent 状态若入档：必须扩展 `save-schema.ts` 的交叉校验（参照现有 `save-schema.ts:521-532` 对 assignment 的校验密度）。
- `tests/architecture.test.ts:39-60` 断言**同 seed 同命令重放完全一致**。任何引入非确定性（如未播种的随机、时间戳、网络结果）的 Agent 逻辑都会破坏该回归。
- 现有 `random()` 读写 `state.seed`（`engine.ts:34-37`）——若 Agent 决策消耗随机数，需明确其是否应与战斗 RNG 共用同一序列（`architecture.md:123` 已说明存在“坐标生成 PRNG”与“战斗/隐形 RNG”分离的先例）。

### E9 — 无网络/密钥基础设施

运行时依赖仅 `react`、`react-dom`、`zod`、`@fontsource/antonio`。任何模型接入都需新增：HTTP 客户端、密钥配置、超时/降级策略（CLAUDE.md §2.4 要求“LLM 慢、不可用或返回无效输出时模拟仍然确定且可响应”）。

---

## 7. 可继续作为 Lv3 设计输入的文档

| 文档 | 可作为输入的部分 | 备注 |
| --- | --- | --- |
| `AGENTS.md` 「Agent 边界」 | Agent 与舰船分离、`observation → model decision → structured action → validation → engine command` | **与代码一致**，可直接引用 |
| `AGENTS.md` 「Self-Generating MMO Ecology」 | 四类活动与生态链，作为 Agent 任务空间的来源 | 与 `projection.opportunities()` 对应 |
| `docs/architecture.md:79-90` 「Agent Boundary」 | 边界陈述 | `VERIFIED` |
| `docs/architecture.md:135` | 端口与 Admiral 优先的一句话规格 | `VERIFIED`，但过于简略（见 M1） |
| `docs/worldbuilding.md:142-148` 「Future Agents」 | 设计意图：Agent 生活在既有边疆，而非人工任务菜单 | 与代码无冲突 |
| `tests/architecture.test.ts` | **可执行的边界规格**（端口形状、越权拒绝、快照只读、重放确定性） | 最有价值的输入，建议作为 Lv3 的回归护栏 |
| `题目要求.md` Lv3 + 实现边界 | 需求权威：≥2 个差异明显的 Agent、对话改变后续状态、行为进入成长循环、Agent 间至少一种互动、模型须真实负责决策 | 需求的唯一来源 |
| `README.md` / `docs/worldbuilding.md` | 世界规则、资源、势力、事件 | 供 Agent 的目标空间参考 |
| `docs/verification/mine-accidents/README.md` | 当前准确的自验基线数字（13 文件 / 184 项） | 取代 `acceptance.md` 的过时数字 |

**不建议直接作为设计输入**：`docs/verification-v5.md`（历史版本记录）。

> **更正（2026-10-07，本文件 §4 订正后）**：此处原列三项，其中两项已不成立——
> `docs/verification.md` 已加基线标注；`docs/acceptance.md:7` 的 E2E 结论已在 C2 仲裁后订正为 34/36 并注明失败定性。两份文档现在**可以**作为设计输入，但应以订正后的内容为准。
> 另见本目录 `00-baseline.md` / `00-code-map.md` / `00-test-baseline.md`（Prompt 0 choice1 产物），它们是从本审计蒸馏/扩展而来的正式基线。

---

## 8. 本次未验证事项

按 CLAUDE.md §10，未能执行的验证必须记录原因：

| 项目 | 状态 | 原因 | 性质 |
| --- | --- | --- | --- |
| `node scripts/acceptance-v9.mjs 236807` | 未运行 | 需可见 Electron 窗口的实玩脚本，未纳入本次范围 | **环境性** |
| C2（E2E 是否全绿） | ✅ **已仲裁** | 2026-10-07 实跑：34 通过 / 2 失败 | 见 §4 C2 |
| `mine-accidents.spec.ts:130` 的 15s timeout | 已定位，**未修改** | 属测试侧期望过紧，修改测试需团队决策 | **代码性**（测试缺陷，非引擎缺陷） |
| UI 视觉细节（像素级排版） | 未人工核对 | 超出本次基线范围；E2E 的 34 项已覆盖布局/字体断言 | 按 `docs/verification/**` 历史证据 |

**已确证为真实执行的**（全部为 2026-10-07 本机实测）：

- `npm test` → 13 文件 / **184 项通过**，exit 0
- `npm run build` → exit 0
- `env -u ELECTRON_RUN_AS_NODE npm run test:e2e` → **36 项：34 通过 / 2 失败**，exit 1，15.5 分钟
- `npx playwright test tests/e2e/mine-accidents.spec.ts`（隔离重跑）→ 1 通过 / 1 失败，用于区分 flaky 与确定性失败

---

## 9. 结论

1. **代码基线干净可信**：`src/`、`electron/`、`tests/` 无未提交改动；单元测试 184 项与生产构建均实测通过。
2. **Lv1 + Lv2 完整，Lv3 为零**：三类以上差异化活动与两条改变能力的成长线确实存在；**不存在任何 LLM 代码**，也没有需要清理的半成品 Agent。
3. **唯一的 Lv3 接缝已经存在且经过测试**：`Operator` / `Assignment` / `AgentControllerPort` / `submitAction`，并有 `tests/architecture.test.ts` 作为可执行规格。
4. **最主要的阻塞项是文档而非代码**：`docs/lv3/`、`schemas/`、`prompts/` 全空；`legalActions` 语义不明且与真实规则不符；`Observation` 无法支撑题面要求的“公司状况”与“同伴关系”输入。
5. **E2E 实测 34/36 通过，两项失败均已定位到具体原因，且都不指向引擎缺陷**：一项是 Windows 文件占用（隔离重跑即通过），一项是测试 timeout 比实际航程短约 0.4 秒（已算出）。**Lv1/Lv2 主链路 34 项无回归**，因此“Lv1/Lv2 稳定”这一前提**成立**，Lv3 可以在此基线上开始。
6. **文档漂移已全部订正**（2026-10-07，经用户授权）：C1 数量 175→184、C2 E2E 结论、C3 `49f5660` 锚点、C4 `references.md` 的 LV1 表述、C5 `architecture.md` 版本抬头。订正方式为**在原文旁追加标注块**，不删除历史记录——验证文档的历史结论保留原样，仅补充当前实测。
7. **未修改任何测试文件**：`tests/e2e/mine-accidents.spec.ts:149` 的边际超时已定位并记录，按用户决定**暂不改动**，留待团队决策。
8. **未做任何源码或游戏逻辑修改**。`src/`、`electron/`、`tests/` 全部保持干净；本次新增 `docs/lv3/00-baseline-audit.md`，并在 `docs/acceptance.md`、`docs/verification.md`、`docs/references.md`、`docs/architecture.md` 追加标注块。
