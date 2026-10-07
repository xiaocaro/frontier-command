# Lv1/Lv2 状态与命令映射（01-state-and-command-map）

生成日期：2026-10-07
用途：Prompt 1 产物。回答「哪些状态存在、谁能改它、公开投影暴露了什么」。

> 行号在写入前回原文核对。时序见 `01-runtime-call-graph.md`；差距分析见 `01-agent-gap-analysis.md`。

---

## 1. `WorldState` 字段与写入者

`WorldState`（`src/engine/types.ts:474-522`，`version: 10` 字面量）。按**谁能写**分类：

### 1.1 由 `dispatchCommand` 写入（玩家命令路径）

| 字段 | 写它的命令 | 位置 |
| --- | --- | --- |
| `dismissedMarkerIds` | `dismissMapMarker` | `command-system.ts:357` |
| `paused` / `pauseReasons` | `pause` | `:362-363` |
| `speed` | `speed` | `:367` |
| `communications[].read` | `acknowledge` | `:371` |
| `ships[].current/queue/suspended/tracking/emergencyRetreat/path/status` | `issueDirective` | `:378-390` |
| 同上（编队版） | `issueGroupDirective` | `frontier-commands.ts:163-174` |
| `ships[].standing` | `standingOrders` | `:416` |
| `ships[].cloak` / `cloakUntil` | `setCloak` | `:421-422` |
| `groups` | `createGroup` / `updateGroup` / `deleteGroup` | `frontier-commands.ts:119,132-137,142` |
| `renamedEntityIds` | `renameEntity` / `createGroup` / `updateGroup` / `startConstruction` / `startBaseRefit` | `:436`，`frontier-commands.ts:126,131`，`command-system.ts:461,484` |
| `resources.credits` | `candidate` / `developColony` / `tradeStock` / `sellStock` / `buildShip` / `upgrade` / `manufacture` / `startConstruction` / `startBaseRefit` | 见 §2 |
| `locations[].stock` | `developColony` / `repairFacility` / `tradeStock` / `sellStock` / `pay()` 路径 | 见 §2 |
| `locations[].hull` | `repairFacility` | `:544` |
| `locations[].occupation` | `startBaseRefit` | `:468` |
| `projects` | `startConstruction` / `startBaseRefit` | `:460`，`:469` |
| `jobs` | `buildShip` / `upgrade` / `manufacture` | `:490,507,523` |
| `trade.orders` / `trade.stock` / `trade.credits` | `tradeStock` / `sellStock` | `trade.ts:55-58,71-74` |
| `personnel[].career/status/skills/posting/locationId` | `candidate` / `assignPersonnel` | `frontier-commands.ts:182-205` |
| `locations[].colony.commanderId` / `colony.development` | `assignPersonnel` / `developColony` | `frontier-commands.ts:193,201`，`society.ts:119` |
| `events[].choice/targetId/stage/outcome` | `respondEvent` | `frontier-commands.ts:224-225`，`world-events.ts:57-58` |
| `nextId` | 多数创建型命令 | 各 `push` 处 |

### 1.2 由模拟循环写入（`step()` 路径，非命令）

| 字段 | 写入者 |
| --- | --- |
| `tick` / `time` | `step()` 首部（`engine.ts:138-139`） |
| `seed` | `SimulationEngine.random()`（`engine.ts:34-37`） |
| `status` / `pauseReasons` | `finishCritical()`（`engine.ts:76-82`）、`commandLost` 路径 |
| `ships`（位置、血量、货舱、弹仓、`path`、`moved`、`work`） | `execution.ts` 各 action 分支 |
| `ships[].status` | `advanceStanding`（`fleet.ts:148-152`） |
| `enemies`（全部） | `threats.ts` |
| `factions` / `tension` | `advanceFactions`（`threats.ts:284`） |
| `intel` / `siteIntel` / `contactAlerts` | `updateSensors`（`sensors.ts:56`）、`tracking.ts` |
| `locations[].stock`（开采） / `hull`（自防与回复） | `advanceEconomy`（`services.ts:11`） |
| `jobs[].work/complete` / `projects[].work/complete` | `advanceEconomy` |
| `civilians` / `trade.orders` | `advanceTrade`（`trade.ts:88`） |
| `events`（创建与推进） | `advanceEvents`（`world-events.ts:111`） |
| `wrecks` / `losses` | `destroyShip`（`combat.ts:91`） |
| `beams` | `engine.beam()`（`engine.ts:172`） |
| `communications` / `logs` / `history` | `report()` / `log()` / `record()`（`engine.ts:38-71`） |

### 1.3 只读/派生的字段

- `baseResources`、`inventories`、`production`、`opportunities`、`accidentResponse`、`mapMarkers` **不是 `WorldState` 字段**——它们在 `snapshot()` 中**即时计算**（`projection.ts:118-135,189`，`types.ts:553-561`）。`MineAccidentResponse` 的注释明确写着「never persisted in WorldState」（`types.ts:174`）。

---

## 2. 命令 → 变更映射（全 25 种）

分派管线：`validate` → `commandSchema.parse` → **`applyFrontierCommand`（对所有类型都调用）** → 内联分支（`command-system.ts:345-351`）。

| # | 命令 | 校验位置 | 应用位置 | 关键变更 | `record()` |
| --- | --- | --- | --- | --- | --- |
| 1 | `dismissMapMarker` | `:209-212` | `:351-360` | `dismissedMarkerIds` | ✅ |
| 2 | `issueDirective` | `:168-208` | `:374-402` | 舰船指令容器、`nextId` | ✅ |
| 3 | `cancelDirective` | `:215-216` | `:403-414` | 清空三容器、`status='idle'` | ✅ |
| 4 | `standingOrders` | `:215-216` | `:415-418` | `s.standing` | ❌ |
| 5 | `setCloak` | `:217-222` | `:419-427` | `s.cloak`、`cloakUntil`；SHADOW 时 `phase` | ✅ |
| 6 | `createGroup` | `frontier-commands.ts:12-25` | `:118-129` | `w.groups`、`renamedEntityIds` | ✅ |
| 7 | `updateGroup` | `:12-25` | `:130-140` | `w.groups[]`、`renamedEntityIds` | ✅ |
| 8 | `deleteGroup` | `:26-27` | `:141-145` | `w.groups`（filter 重赋值） | ✅ |
| 9 | `issueGroupDirective` | `:28-57` | `:146-179` | 各成员舰三容器、`groupOrderId` 等 | ✅ |
| 10 | `candidate` | `:58-65` | `:180-190` | `p.career`、`resources.credits -= 90`、`p.status` | ✅ |
| 11 | `assignPersonnel` | `:66-75` | `:191-208` | `colony.commanderId`、`p.posting/status` | ✅ |
| 12 | `developColony` | `:76-84` | `:209-213` → `society.ts:105-121` | `credits`、`l.stock.materials`、`colony.development` | ✅ |
| 13 | `respondEvent` | `:93-113` | `:222-244` | `v.choice/targetId`、`quarantine`、`stage`；**withdraw+舰船主体时递归下发 `RETURN`**（`:235-241`） | ✅ |
| 14 | `tradeStock` | `:85-88` → `trade.ts:8-43` | `:214-217` → `trade.ts:44-87` | `base.stock`、`trade.stock/credits`、`resources.credits` | ✅ |
| 15 | `renameEntity` | `:223-229` | `:428-440` | 目标实体 `name`/`label`、`renamedEntityIds` | ✅ |
| 16 | `startConstruction` | `:230-247` | `:441-464` | `credits`（**按原价** `FACILITIES[kind].cost`）、`projects` | ✅ |
| 17 | `buildShip` | `:248-260,269-280` | `:488-504` | `pay()` → credits + 库存、`jobs` | ✅ |
| 18 | `upgrade` | `:248-260,281-290` | `:505-519` | `pay()`、`jobs` | ❌ |
| 19 | `manufacture` | `:248-260,291-295` | `:521-535` | `pay()`、`jobs` | ❌ |
| 20 | `startBaseRefit` | `:261-268` | `:465-487` | `credits`、`occupation='rebuilding'`、`projects` | ✅ |
| 21 | `sellStock` | `frontier-commands.ts:89-92` | `:218-221` → `trade.ts` | `base.stock`、`trade.credits`、`resources.credits` | ✅ |
| 22 | `repairFacility` | `:298-303` | `:537-547` | `l.stock.materials`、`l.hull` | ✅ |
| 23 | `acknowledge` | `:304-305` | `:370-373` | `communications[].read` | ❌ |
| 24 | `pause` | 兜底 `ok()` `:306` | `:361-365` | `paused`、`pauseReasons` | ❌ |
| 25 | `speed` | 兜底 `ok()` `:306` | `:366-369` | `speed` | ❌ |

**`record()` 不对称**：`upgrade`（`:505-519`）、`manufacture`（`:521-535`）、`standingOrders`、`acknowledge`、`pause`、`speed` **不写历史**，而 `buildShip` 写（`:502`）。这意味着部分世界变更在 `history` 中无痕迹。

**`startConstruction` 的价格不一致**：`:454/:459` 收取的是 `FACILITIES[kind].cost.credits`（原价），**不是** `productionCost` 的折后价。而 `buildShip`/`manufacture` 走 `pay()` + `productionCost`（享 `productionDiscountUnlocked` 五折）。

---

## 3. 谁能让舰船指令容器变化

| 途径 | 位置 |
| --- | --- |
| `issueDirective` | `command-system.ts:378`（queue push）、`:380`（suspended push）、`:382-386` |
| `cancelDirective` | `:405-407` |
| `issueGroupDirective` | `frontier-commands.ts:163,165,167-170` |
| `respondEvent`（间接） | `frontier-commands.ts:235-241` 递归 `issueDirective REPLACE RETURN` |
| `setCloak`（仅 `phase`） | `command-system.ts:423-424` |
| **`SimulationEngine.complete()`（非命令路径）** | `engine.ts:108-133`，用 `validateContinuation` |
| **`advanceStanding` 的紧急脱离（非命令路径）** | `fleet.ts:84` 直接 `s.current = null` |

### 3.1 三种下达语义的精确行为

`command-system.ts:378-391`：

```ts
if (c.mode === 'QUEUE' && s.current?.source === 'admiral') s.queue.push(d);
else {
  if (c.mode === 'INTERRUPT' && s.current) s.suspended.push(s.current);
  if (c.mode === 'REPLACE') { s.current = null; s.queue = []; s.suspended = []; }
  s.current = d; s.tracking = null; s.emergencyRetreat = null; s.path = []; s.status = 'active';
}
```

| mode | 实际行为 |
| --- | --- |
| `QUEUE` | **仅当 `s.current?.source === 'admiral'` 时**入 `queue`。否则落入 else：直接 `s.current = d`，`queue`/`suspended` 不动 |
| `INTERRUPT` | `current` 压入 `suspended`（LIFO），新指令成为 `current` |
| `REPLACE` | 清空三容器，新指令成为 `current` |

**容量上限**：`queue` ≤ 32（`command-system.ts:173`），`suspended` ≤ 16（`:174`）。

`issueGroupDirective` 的 REPLACE（`frontier-commands.ts:166-170`）只清 `queue`/`suspended`，**不先置 `s.current = null`**——终态等价（随即被覆盖），但路径不同。

### 3.2 预留模型

`Directive.reserved`（`types.ts:250`）只有 **REARM** 与 **HAUL** 会填充。

| 环节 | 行为 | 位置 |
| --- | --- | --- |
| 收集范围 | `heldDirectives` = 每舰 `current` + `suspended`，**不含 `queue`** | `inventory.ts:19-20` |
| 归属解析 | `reservationHolder` 解析 `sourceId`（HAUL）或 `targetId`（REARM），含「已完成项目 → 其产出设施」的映射 | `inventory.ts:21-33` |
| 可用量 | `available()` = `持有点库存 − Σ 同持有者的预留` | `inventory.ts:34-44` |
| REARM 预留时机 | **下达时**（`phase='reserved'`） | `command-system.ts:394-398` |
| HAUL 预留时机 | **执行开始时**（到源点且可用量 > 0） | `execution.ts:398-402` |
| 消耗 | HAUL 装货时扣库存入货舱并清零预留；REARM 每 `torpedoLoadMinutes` 消耗一发 | `execution.ts:409-418`，`:662-673` |
| 取消 | 指令对象被丢弃，预留随之消失——**没有显式退款代码**，因为未消耗的库存从未被真正移除 | `command-system.ts:403-414` |
| 破坏性损失 | `loseStock` 实扣库存后逆序遍历持有指令，递减 `reserved` 并标记 `note` | `inventory.ts:54-73` |

**不使用预留的指令**：`REFIT` / `REPAIR` / `UNLOAD` 直接查 `available()` 后扣减（`execution.ts:683-695`，`:633-637`，`:612-617`）。

---

## 4. 公开投影：`Snapshot` 暴露什么、藏什么

`snapshot()`（`projection.ts:59-198`）以**显式白名单**构造，随后 `structuredClone`。类型 `ReadonlyDeep<SnapshotData>`（`types.ts:664`）。

### 4.1 `WorldState` 有、但 `Snapshot` 没有的字段

| 缺失字段 | 原因 |
| --- | --- |
| `enemies`（全部） | 敌方资产、意图、货舱、位置是隐藏状态 |
| `seed` / `initialSeed` | 随机源绝不外泄 |
| `factions`（`orion`/`romulan` 的 reports/credits/production/stance/pressure） | 势力内部经济与意图 |
| `bodies[].hidden === true` | 未发现天体 |
| 未 `discovered` 的 `sectors` / `systems` / `locations` / `wormholes` / `wrecks` | 未揭示地理 |
| `wormholes[].exit` / `exitSector` | 出口坐标保持隐藏（`projection.ts:184-186`） |
| `contactAlerts` | 接触去重账本 |
| 敌方的 `counterTracking` 证据、假航点、真实目的地 | 反跟踪私有状态 |

### 4.2 逐字段脱敏

| 字段 | 处理 |
| --- | --- |
| `bodies` | `survey < 2` 时把 `remaining`/`richness`/`hazard`/`specialClaimed`/`population` 归零（`projection.ts:92-96`） |
| `locations`（非己方） | `stock`/`core`/`production`/`capacity`/`colony`/`extracted` 归零，`lastAttackerId` 置 null（`:97-113`） |
| `siteContacts` | 只暴露 `id/x/y/progress/lastSeen`，**不含 `locationId`/`owner`/`name`/库存**（`:85-87`，`types.ts:544`） |
| `beams` | 只保留两端都在已知点附近的（`:165`） |
| `events` | 过滤主体可见性；`assetIds` 只保留可见的（`:168-183`） |
| `renamedEntityIds` | 过滤掉已不存在的实体（`:136-146`） |

**可执行证据**：`tests/architecture.test.ts:85-102` 断言 `Snapshot` 不含 `enemies`/`seed`/`factions`，未发现设施不出现，失联接触位置冻结。

---

## 5. `Observation`：Agent 边界的读模型

`getObservation(operatorId)`（`projection.ts:199-228`）。类型 `ReadonlyDeep<ObservationData>`（`types.ts:665`）。

```ts
{ time, operatorId, ship, contacts, systems, bodies, opportunities, legalActions }
```

构造流程：查 `assignments` → 找 `ship` → **无分配返回 `null`** → 调 `this.snapshot()` 取公共部分 → `structuredClone`。

**与 `Snapshot` 的差异**：

| 项 | `Snapshot` | `Observation` |
| --- | --- | --- |
| 覆盖范围 | 整个已知世界 | **仅本舰 + 公共子集** |
| `ship` | `ships[]` 全部 | **只有自己操作的那一艘** |
| `contacts` / `systems` / `bodies` / `opportunities` | ✅ | ✅（取自 Snapshot） |
| `locations` / `projects` / `jobs` / `personnel` / `events` / `trade` / `groups` / `civilians` | ✅ | ❌ **完全没有** |
| `baseResources` / `inventories` / `production` / `armory` | ✅ | ❌ **完全没有** |
| `communications` / `logs` / `history` / `losses` | ✅ | ❌ |
| `legalActions` | ❌ | ✅ 但见下 |

### 5.1 `legalActions` 不可信

`projection.ts:212-226`：

```ts
legalActions: s.current ? [] : [
  'MOVE','EXPLORE','SURVEY','HAUL','PATROL','RETREAT','RETURN',
  'ASSIST_EVENT','TRANSIT','CAPTURE','HAIL',
]
```

- **硬编码字符串数组**，不是由 `validateAction` 推导。
- **遗漏**了 `Action` 联合中真实存在且可执行的 12 个：`ATTACK`、`DISABLE`、`DRIVE_OFF`、`INTERCEPT`、`SHADOW`、`ESCORT`、`RECOVER`、`REPAIR`、`REARM`、`REFIT`、`UNLOAD`、`DOCK`。
- **无条件列出**受约束的动作：`TRANSIT`（需虫洞已发现）、`CAPTURE`（需目标 `ruined` 且无他舰在接管）、`HAIL`（需已识别实时 Romulan 接触且冷却结束）。
- 当 `s.current` 非空时返回 `[]`，但 `submitAction` 的判断依据是 `current`/`queue`/`suspended` **三者**。

**结论：`legalActions` 不能作为合法动作的权威来源，也不能作为「本舰此刻无事可做」的判据。**

---

## 6. 船与 Agent 的状态归属

| 概念 | 所在 | 内容 |
| --- | --- | --- |
| **Ship（物理）** | `types.ts:261-291` | hull / shield / core / 弹药 / modules / engines / weapons / status / current / queue / suspended / **standing** / path / cargo / cloak / tracking |
| **Operator（接缝）** | `types.ts:382-387` | `id` / `name` / `kind: 'rules'` / `availability` |
| **Assignment（映射）** | `types.ts:388-392` | `operatorId` / `shipId` / `since`，**1:1 且唯一**（`save-schema.ts:521-532`） |

**Ship 携带的是策略，不是主体**：`standing: StandingOrders`（`types.ts:118-134`: `roe`、撤退阈值、弹药阈值、`maxPursuit`、7 个保护开关）是**决策策略**，但 Ship 没有性格、记忆或目标。这一区分对 Lv3 是关键——见 `01-agent-gap-analysis.md`。
