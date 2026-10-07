# Frontier Command v10 验收

矿场事故修复：`tests/mine-accidents.test.ts` 验证现场／舰上／混合材料、预留守恒、缺料停工、真实补给恢复、多舰单次结算及超额工作旧存档的确定性恢复。`tests/e2e/mine-accidents.spec.ts` 使用隔离存档运行生产 Electron，验证缺料详情、一次性补给表单、航行／施工提示及恢复生产；截图位于 `docs/verification/mine-accidents/`。

当前变更的规则验收：`tests/v10.test.ts`；实际 Electron 操作验收：`tests/e2e/v10.spec.ts`。全部使用隔离数据，不接入生产存档或外部服务。

2026-10-06 实际验证：`npm run build` 成功，`npm test` 的 175 项测试全部通过。Electron 全量回归的 34 个用例已完成验证：首次运行 25 项通过，9 项旧英文文案断言更新后全部重跑通过；四项新增 v10 流程再次完整通过。最后复查中文通知、半单位材料显示及最远景右栏布局。

2026-10-07 复核（本节数字已按实测更正）：

- `npm test` 实际为 **13 文件 / 184 项通过**（上文的 175 为核心数，此后已增长；`docs/verification/mine-accidents/README.md` 记录的 184 项与本次实测一致）。
- `npm run test:e2e` 实际为 **36 项中 34 项通过、2 项失败**（上文的 34 个用例是当时的套件规模，此后新增 2 项矿场 Electron 流程）。两项失败**均非引擎缺陷**：
  - `tests/e2e/mine-accidents.spec.ts:48` — 存截图时 Windows 文件瞬时占用（`UNKNOWN: unknown error, open ...supply-composer.png`），隔离重跑通过；
  - `tests/e2e/mine-accidents.spec.ts:130` — 测试 timeout（15s）短于实际航程（约 15.4s）的边际超时。该测试把 `verity` 放在距矿场 100 单位处，Constitution `warp = 6.5`、`engines = 100`，`move()` 每步 0.65 单位，需约 153.8 步 ≈ 15.38 秒。
- 完整定性、复现命令与 `ELECTRON_RUN_AS_NODE` 环境前提见 `docs/lv3/00-baseline-audit.md` §4 C2。

因此**上文 2026-10-06 的“Electron 全量回归已完成验证”结论，在当前工作树上不可复现为全绿**；除上述 2 项外，其余 34 项（含全部 Lv1/Lv2 主链路）无回归。

新增 Electron 流程包括“实际调查取得发现 → 船坞／军械库五折扣款”和“击败基地 → 现场接管 → 实际货运 → 改建 → 本地造舰／装弹／维修”。虫洞验证包含远方抵达、镜头跟随、隐藏出口不进入快照、原路返回与聚合标记展开。v9 历史截图保持原样；本轮截图独立存入 v10 目录。

| 行为                                                             | 验证                         |
| ---------------------------------------------------------------- | ---------------------------- |
| 基础光子／量子制造、永久精确五折、Galaxy 容量与速度              | 规则测试及生产 Electron 流程 |
| 弹仓、库存、预留显示；多舰需求、超量与并发预留守恒               | 规则测试及装弹 Electron 流程 |
| 现场接管、中断恢复、真实货运改建、稳定 ID、多基地本地生产与维修  | 规则测试及基地 Electron 流程 |
| 敌方不再使用被占领基地，基地毁坏后取消生产、升级可在其他基地重试 | 规则测试                     |
| v9 时间线整体迁移、原文件保留、v10 存取及确定性恢复              | 存档测试                     |
| 普通虫洞远距离双向配对、出口不泄露、实际穿越及镜头跟随           | 规则测试及地图 Electron 流程 |
| 右栏中文、玩家改名保留、殖民地分段条、放大文字                   | Electron 界面检查            |
| 最小缩放网格覆盖视口、远景聚合与点击展开                         | 相机规则及 Electron 检查     |

截图保存于 `docs/verification/v10/`。以下为此前 v9 功能的历史验收记录。

# Frontier Command v9 验收

基于本地提交 `49f5660`，沿用主进程唯一权威、确定性固定步、现有指令、事件和 LCARS 26 Classic。新建严格 v9 世界，不迁移 v8，不修改用户旧存档，不接入 LLM。

> **基线标注（2026-10-07）**：`49f5660` **不在当前仓库历史中**（`git cat-file -t 49f5660` 报 `Not a valid object name`；`main` 与 `origin/main` 均指向初始提交 `770822f`）。下文以该提交为锚点的描述**无法用 git 复核**，仅作为当时的验证记录保留。当前行为请以源码与测试为准。

| 约束                                                                           | 验证位置                                                                  |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| 安全航线无危险直达、已知危险避让、路径仅含坐标、隐藏状态不影响规划             | command-v9.test.ts、geography.test.ts                                     |
| Ctrl 多选、选目标保留选舰、所有任务预选、临时批量 MOVE、每舰货运数量           | command-v9.spec.ts、v9-ui.spec.ts                                         |
| RETURN 保留货物、UNLOAD 到 Dawn、已装货无需重载、预留守恒                      | command-v9.test.ts、frontier.test.ts、desktop.spec.ts、command-v9.spec.ts |
| 实际穿越后镜头跟随、手动选择结束、事件仅公开己方 ID/实际出口/tick              | command-v9.test.ts、command-v9.spec.ts                                    |
| 近距调查完成同一步创建接管事件、上下文入口、无残骸建设、唯一幽影接管           | command-v9.test.ts、recon.test.ts、command-v9.spec.ts、recon.spec.ts      |
| 自有隐形状态在地图、舰船条和详情清晰可见，保存恢复                             | command-v9.spec.ts、recon.test.ts                                         |
| 首次接触、10 分钟失联重获、首次敌对升级、同一步合并、各倍率同 tick 暂停        | command-v9.test.ts、command-v9.spec.ts、desktop.spec.ts                   |
| 合并警报与单次音效、确认/定位/下令保持暂停、手动继续、静音和音量               | command-v9.spec.ts、lcars.spec.ts                                         |
| 标记有货物/奖励/事件/打捞时不可移除，无价值时移除并永久保存真实实体/历史       | command-v9.test.ts、command-v9.spec.ts                                    |
| 五项基地可用资源、扣除预留、零库存显示、文字放大后不重叠                       | command-v9.test.ts、command-v9.spec.ts                                    |
| 默认 18px 相对字号、文字与整体缩放独立 100%–200%、Ctrl+0 不重置文字            | command-v9.test.ts、command-v9.spec.ts、lcars.spec.ts                     |
| 全部管理页/八基地模块、125/150/200% 原生显示缩放、放大导航和资源可用           | command-v9.spec.ts、lcars.spec.ts、v9-ui.spec.ts                          |
| 五项升级按钮旁真实进度/剩余分钟/暂停/ONLINE、施工禁重复；造舰/制造/改装进度    | command-v9.spec.ts、desktop.spec.ts                                       |
| 标题不被圆角遮罩咬断、纯色色条；标签近邻连线不超过当前字号 4em                 | command-v9.spec.ts、command-v9.test.ts、camera.test.ts                    |
| 中文普惠体正文/粗体、英文数字 Antonio，离线平台字体、字面高度与笔画实测        | command-v9.spec.ts、lcars.spec.ts、v9-ui.spec.ts                          |
| 无周期维护、3000 Mine、Colony Credits、Dawn Materials 守恒和真实工业成本       | v9.test.ts、frontier.test.ts、recon.test.ts                               |
| 空闲/低弹药/低状态/完成/取消/失联/重启待命；显式返航与战斗本地脱离             | recon.test.ts、v9.test.ts、engine.test.ts、frontier.test.ts               |
| REPLACE / QUEUE / INTERRUPT、正式编队、严格 v9 保存、拒绝 v8、日快照与永久舰损 | architecture.test.ts、persistence.test.ts、clock.test.ts、desktop.spec.ts |
| 稀疏生成/最小间距/探索顺序确定性、固定 0/0 ↔ 0/12 通道                        | geography.test.ts、recon.test.ts                                          |
| Orion/Romulan 普通尾随暴露、假航点、隐形秘密尾随、连续 10 分钟基地确认与打击   | recon.test.ts、recon.spec.ts                                              |
| 隐藏基地/AI intent/真目的地/假航点/反跟踪证据/接触去重记录不进入公共输出       | architecture.test.ts、command-v9.test.ts、recon.test.ts、recon.spec.ts    |
| 跟踪/甩尾/部分情报/隐形/去重/清理保存恢复与各倍率确定性                        | command-v9.test.ts、recon.test.ts、clock.test.ts                          |

必跑 `npm test`、`npm run build`、`npm run test:e2e`。Electron E2E 启动生产主进程与页面，隔离存档和合法场景夹具只用于测试；公开 API 没有测试专用世界修改接口。

`node scripts/acceptance-v9.mjs 236807` 使用未修改资产的正常新世界和可见 Electron，通过真实按钮/表单下令、确认警报和手动继续，验证待命、固定通道、调查接管与隐形。多 seed 规则使用 42、1701、236807。真实截图和机器结果存于 `docs/verification/v9/`，已运行的检查见 [验证记录](verification.md)。历史 v8 证据保留于原目录。本轮不推送远程或重新发布 EXE/ZIP。
