# AGENTS.md
题目要求：'题目要求.md'

## 项目定位

Frontier Command 是“Agent 时代的 MMO 生态模拟经营游戏”。Star Trek 提供世界观与交互语言，但本作不是传统舰队 RTS，也不是任务菜单模拟器。

真人玩家身份是 Dawn Frontier Command 的 Admiral。玩家管理持续运行的边疆世界、舰队、基地、殖民地、物流与资源，并对所有己方舰船拥有最终指挥权。

核心体验是：

**世界产生机会与危机 → Admiral 下达意图 → 舰船/角色执行 → 世界状态发生长期变化 → 新的机会与危机继续产生。**

当前 V1 覆盖题目 Lv1 + Lv2；未来 Agent 系统建立在同一世界规则之上，而不是另起一套玩法。

## 核心玩法原则

- Admiral 可以随时命令任意己方舰船；舰船不得被长期 Mission/Operation 锁死。
- 任意舰船都可以尝试任意合法活动，差异来自性能、装备、风险和效率，而不是职业硬限制。
- 高层命令表达“要什么”，模拟引擎负责移动、射程、伤害、资源、航线和结算。
- 明确的 Admiral 命令优先于 Standing Orders；ROE 只约束自主行为。
- 世界行为必须有可解释的因果。敌人、任务和风险不应主要依赖无来源的随机刷怪。
- 失败、损失、发现、命名、建设和势力变化都应留下持久历史。

## Self-Generating MMO Ecology

Frontier Command 的核心创新是让 MMO 内容由世界状态自然生成，而不是从任务列表中凭空刷新。

主要生态链：

**EXPLORE → DISCOVER → MINE → TRANSPORT → CREATE VALUE → ATTRACT THREATS → DEFEND → PROFIT → GROW → EXPLORE FARTHER**

四类基础活动必须真正不同：

- **Combat / Security**：巡逻、护航、拦截、追踪、交战、压制、撤退。
- **Exploration / Survey**：发现未知星系、行星、异常、资源点并逐步提高情报等级。
- **Mining / Extraction**：低注意力、持续产出、受货舱、效率、风险和资源储量影响。
- **Transport / Logistics**：真实货物、航线、时间与风险管理。

这些活动共享同一个持续世界，并互相创造后续玩法。

## 世界

战略空间由可持续扩展的 Sector / Star System 组成，不以固定矩形地图为世界边界。

世界包含：

- Federation 后方与 Dawn Starbase
- Dawn Frontier
- Federation 殖民地、矿区、前哨和运输网络
- Romulan Border / Neutral Zone
- 向多个方向延伸的 UNKNOWN SPACE

探索必须真正发现并持久化新的恒星系、行星、异常和资源点。生成结果使用可复现 seed，并进入存档。

新发现的星球、星系，以及己方舰船、殖民地和设施应支持玩家命名/改名；内部稳定 ID 与显示名称分离。

## 势力

### Federation

玩家管理 Dawn Frontier Command。Dawn Starbase 位于相对安全的后方，是舰队、工业、弹药和战略管理中心，而不是前线木桩。

设施应拥有符合其定位的自卫能力；普通袭击应给玩家留下合理响应时间。

### Orion Syndicate

海盗势力统一为 Orion Syndicate。

Orion 是持久世界实体，不是定时刷新的敌人。其舰船、基地、资源、弹药、情报和损失都应真实存在。

Orion 会侦察高价值航线、寻找薄弱目标、抢劫真实货物、撤退并返回基地；舰船被摧毁后就是实际损失。其行动应由收益、风险和已获得的情报驱动。

### Romulan

Romulan 是政治与军事势力，不是红名怪物。

Scout 获取情报，Border Command 根据真实情报决定观察、巡逻、试探或升级行动。Federation 行为影响边境 tension；未经敌对确认的 Romulan 不应默认成为自动攻击目标。

## Starbase 与成长

`STARBASE` 是独立完整界面，不是地图 Inspector。

核心模块：

- COMMAND
- SHIPYARD
- DRYDOCK
- ARMORY
- ENGINEERING
- LOGISTICS
- SENSOR CONTROL
- DEFENSE GRID

Lv2 成长必须改变下一轮玩法，而不只是增加百分比。

两条主要成长线：

- **Fleet Development**：有限 Module Slots；升级解锁 Deep Scan、Long-Range Sensors、Precision Targeting、Expanded Cargo 等新能力。
- **Frontier / Starbase Development**：升级 Shipyard、Sensor Network、Armory、Logistics、Defense Grid 等战略能力。

核心经济资源保持清晰：

- Credits：预算
- Materials：工业建设与维修
- Photon / Quantum：实际弹药
- Special Finds：少量特殊发现，用于独特能力或升级

Shipyard 可以建造新舰船，舰损必须严重但不能形成不可恢复的死局。

## UI / UX

主界面使用已建立的 LCARS 26 Classic design system；不要退化成通用 dashboard/cards。

主要信息架构：

- 顶部：时间、Priority Communications、关键战略状态
- 左侧：主要功能导航
- 中央：Strategic Map
- 右侧：Context Inspector
- Starbase：独立管理界面
- 管理页面使用现有 LCARS 视觉语言、动画和音频系统

Strategic Map 是持续世界的战略视图，应支持 semantic zoom，并随着探索扩展，而不是表现为固定尺寸图片。

## Agent 边界

未来 Agent 与舰船必须是独立实体。

舰船拥有 Hull、Shield、Core、Warp、Cargo、Weapons、Sensors 等物理属性；Agent 拥有 Personality、Skills、Memory、Experience、Career、Relationships。

未来 LLM Agent 接口遵循：

**observation → model decision → structured action → validation → engine command**

模型不得直接修改 `WorldState`，不得负责逐帧移动、伤害或库存计算，也不应按 simulation tick 调用。

## 引擎边界

- Electron 主进程拥有唯一权威 `SimulationEngine`。
- Renderer 只持有 UI 状态与只读 Snapshot。
- 所有世界修改通过结构化、可验证的 Command 进入引擎。
- 隐藏敌方状态、AI 意图、随机源不得泄露到 Renderer。
- 游戏规则使用 simulation time。
- 保持 deterministic fixed-step 模拟与可复现随机源。
- 存档格式必须版本化。
- UI、决策层与物理模拟保持边界清晰。

## 代码与文档

- `src/engine/`：世界状态、规则、命令、模拟、存档
- `src/ui/`：LCARS UI、hooks、交互与展示
- `src/StrategicMap.*`：战略地图
- `electron/`：主进程、preload、持久化
- `tests/`：规则、存档与 Electron E2E

按任务需要阅读文档，不要求每次预读全部内容：

- `docs/architecture.md`：引擎边界与数据流
- `docs/worldbuilding.md`：世界与阵营规则
- `docs/acceptance.md`：验收约束
- `README.md`：运行方式与当前能力

## 开发约束

- 优先修根因；错误架构允许重构，不要为了兼容旧实现持续堆补丁。
- 不把临时占位实现固化成未来架构。
- 可配置舰级、武器、模块、地点和数值优先使用数据定义。
- 保持 TypeScript 类型严格，避免用 `any` 绕过领域模型。
- 本地测试使用隔离数据，无生产访问；可直接运行与当前改动相关的测试并修复由改动引起的失败。
- UI 改动必须实际运行 Electron 检查；引擎改动必须验证规则、确定性和存档行为。
- 完成声明必须对应真实可用行为，不把占位或计划描述成已实现。
