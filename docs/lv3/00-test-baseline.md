# Lv3 测试基线（00-test-baseline）

生成日期：2026-10-07
用途：Prompt 0 产物。记录**实际运行过的命令与真实结果**。

> **本文件的一条硬规则**：凡未实际运行的命令，一律写作「未验证 + 原因」，**不伪造通过**。凡通过管道得到的退出码，必须说明管道掩盖问题。

---

## 1. 实际运行过的命令与结果

全部于 2026-10-07 在本机（Windows 10 Pro 19045）实际执行。

| # | 命令 | 结果 | 退出码 | 耗时 |
| --- | --- | --- | --- | --- |
| 1 | `npm test` | ✅ **13 文件 / 184 项全部通过** | `0`（`PIPESTATUS` 确认真实） | 5.3s |
| 2 | `npm run build` | ✅ 通过（icon + `tsc --noEmit` + vite + `tsc -p tsconfig.electron.json`） | `0` | ~45s |
| 3 | `npm run test:e2e`（**未**加 `env -u`） | ❌ **36 项全部失败**，全部为 `electron.launch: Process failed to launch!` | 管道掩盖（见下） | — |
| 4 | `env -u ELECTRON_RUN_AS_NODE npm run test:e2e` | ⚠️ **34 通过 / 2 失败** | `1` | **15.5 分钟** |
| 5 | `env -u ELECTRON_RUN_AS_NODE npx playwright test tests/e2e/mine-accidents.spec.ts` | ⚠️ **1 通过 / 1 失败**（隔离重跑，用于区分 flaky 与确定性失败） | `1` | 44.9s |
| 6 | `git diff --check` | ✅ 无空白错误 | `0` | — |

### 1.1 命令 3 的失败是环境性的，不是项目缺陷

命令 3 的 36 项失败，根因是本机 shell 中存在 **`ELECTRON_RUN_AS_NODE=1`**：

```
[pid][err] electron.exe: bad option: --remote-debugging-port=0
[pid][err] electron.exe: bad option: --force-device-scale-factor=2
```

该变量使 `electron.exe` 以纯 Node 模式启动，从而拒绝 Chromium 参数。诊断特征：`electron.exe --version` 返回 **Node** 的版本（`v24.18.0`）而不是 Electron 的（`v41.10.7`）。去掉该变量后，命令 4 得到真实结果。

> **项目自身已知此事但只修了一半**：`scripts/dev.mjs:13-17` 显式 `delete env.ELECTRON_RUN_AS_NODE` 并附注释说明「VS Code 扩展宿主等会设置它」，**但 `npm run test:e2e` 路径没有这个 workaround**——`playwright.config.ts` 无相关处理，各 spec 直接 `env: { ...process.env, ... }`（如 `tests/e2e/mine-accidents.spec.ts:24`）。

### 1.2 命令 4 的两项失败均已定位，**均非引擎缺陷**

| # | 测试 | 失败原因 | 定性 |
| --- | --- | --- | --- |
| 17 | `mine-accidents.spec.ts:48` | `Error: UNKNOWN: unknown error, open '...docs\verification\mine-accidents\supply-composer.png'`——存截图时文件被瞬时占用。**命令 5 隔离重跑该项通过**，且该文件运行前后均可写 | **环境性 / flaky**（Windows 文件锁） |
| 18 | `mine-accidents.spec.ts:130` | `toContainText('现场施工', { timeout: 15000 })` 失败，实得仍为「航行中…货舱材料 5」。**命令 5 隔离重跑仍失败**，同一文本 | **确定性失败：测试期望过紧** |

**#18 的根因（已算出）**：测试在 `mine-accidents.spec.ts:137-138` 把 `verity` 放在 `mine.x + 100`，即恰好 **100 单位**。`verity` 是 `constitution` 级，`warp = 6.5`（`src/engine/definitions/ships.ts:146`），`engines = 100`（`src/engine/data.ts:45`），故 `capabilities().warp = 6.5`。`move()` 每步推进 `warp × dt = 6.5 × 0.1 = 0.65` 单位（`src/engine/navigation.ts:52-54`）。所需步数 `100 / 0.65 ≈ 153.8`；1× 速度下每 100ms 一步 → **约 15.38 秒**，而 timeout 是 **15.000 秒**。

→ 缺口约 0.4 秒 + 渲染/轮询开销。**引擎行为正确**：`tests/mine-accidents.test.ts`（9 项）全部通过。

> **未修复，仅记录**。修法有二（把 `:149` 的 timeout 提到 30000，或把 `:137` 的初始距离调小），属测试侧改动，**需团队显式决策**，本阶段不擅自改测试。

### 1.3 两条必须记住的操作陷阱

1. **跑 E2E 必须 `env -u ELECTRON_RUN_AS_NODE`**，否则 36 项全红且看起来像项目缺陷。
2. **不要用 `npm run test:e2e | tail` 判断成败**——管道退出码是 `tail` 的。本阶段曾因此误报过一次「exit 0」，实际是 36 项失败。取真实退出码用 `${PIPESTATUS[0]}`，或重定向到文件后读 `$?`。

---

## 2. 单元测试逐文件清单（13 文件 / 184 项）

由 `npx vitest run --reporter=json` 实测统计，合计与总数吻合。

| 文件 | 项数 | 覆盖内容 |
| --- | ---: | --- |
| `tests/architecture.test.ts` | 6 | **引擎权威与 Agent 边界**；配置不可变；同 seed 确定性重放；行进中存档恢复；公开 Snapshot 隐私；非法存档拒绝 |
| `tests/camera.test.ts` | 6 | 地图相机缩放锚点/平移/尺寸变化；标签不重叠 |
| `tests/clock.test.ts` | 8 | 固定 tick 时钟、暂停冻结、非固定步长拒绝、午夜、选择性重大暂停 |
| `tests/command-v9.test.ts` | 14 | v9 命令与公开状态边界：安全航线、预留、RETURN/UNLOAD、接管时序、标记清理、穿越事件发布、接触暂停重触发、标签布局、偏好钳制 |
| `tests/engine.test.ts` | 19 | **REPLACE/QUEUE/INTERRUPT 语义**；采矿；HAUL 交付；运输守恒；护航/拦截；续接与安全边界 |
| `tests/frontier.test.ts` | 23 | 前沿建设与能力：模块槽位、Deep Scan、Precision Targeting、Reinforced Shields、基地升级、持久 Orion/Romulan 生态 |
| `tests/geography.test.ts` | 4 | 播种的稀疏星区内容；seed 独立性；航线安全与不确定性 |
| `tests/lcars.test.ts` | 8 | 显示缩放下的标签布局；控制台偏好独立性；LCARS 音频管理器行为 |
| `tests/mine-accidents.test.ts` | 9 | 矿场事故修复经济、响应舰货舱、确定性恢复 |
| `tests/persistence.test.ts` | 13 | v9 时间线持久化、夹具加载、备份、分叉、schema 拒绝、终态优先 |
| `tests/recon.test.ts` | 23 | 指挥权威与经济边界；确定性侦察生成；SHADOW 证据/甩尾/隐形 |
| `tests/v10.test.ts` | 16 | v10 生产/装弹/接管、次级基地、v9 迁移、远景网格与聚合 |
| `tests/v9.test.ts` | 35 | 有限物理经济；协同编队；人员与后果；世界生成/情报/外交；政治事件；Standing Orders |

**辅助模块（非测试文件）**：

- `tests/helpers.ts` — `quietEngine`、`issue`、`run`、`until`
- `tests/recon-scenarios.ts` — `recoverVeil`、`trackingScenario`
- `tests/e2e/typography.ts` — `inspectTitleBars`、`inspectTypography`（CDP 字体/笔画度量）

**夹具**：`tests/fixtures/v9/{initial,in-progress,continued,command-lost}.json`，由 `scripts/create-v9-fixtures.mjs` 在 electron TS 构建后重新生成。

---

## 3. 脚本清单（9 个）

| 脚本 | 何时运行 | 用途 |
| --- | --- | --- |
| `scripts/dev.mjs` | `npm run dev` | 编译主进程 → 起 Vite → 启动 Electron；**删除 `ELECTRON_RUN_AS_NODE`** |
| `scripts/create-icon.mjs` | `npm run build` 首步 | 纯 zlib 生成 `build/icon.png` + `icon.ico` |
| `scripts/create-v9-fixtures.mjs` | 手动（需先 build electron） | 重新生成 `tests/fixtures/v9/*.json` |
| `scripts/play-v9.mjs` | 手动 | stdin 驱动的交互式 UI 操作台，追加 JSONL 到 `docs/verification/v9/play-*.jsonl` |
| `scripts/acceptance-v9.mjs` | 手动 | **可见**原生验收：隔离存档、离线字体、待命/通道/接管，截图 + JSON 落到 `docs/verification/v10` |
| `scripts/acceptance-typography.mjs` | 手动 | **可见**原生 1.25/1.5/2 缩放验收；CDP 校验字体，产物落 `docs/verification/v9` |
| `scripts/smoke-package.mjs` | `npm run test:package` | 无头+离线启动打包后的 EXE，检查 v10 状态、指令、保存与重启 |
| `scripts/package-zip.mjs` | `npm run package:zip` | 打包 `release/win-unpacked` 为 ZIP + `.sha256` |
| `scripts/verify-release.mjs` | `npm run test:release` | 解压 ZIP 到临时目录并对它跑 smoke-package |
| `scripts/normalize-lcars-font.py` | 手动（需 Python + fontTools） | 从普惠体生成两套光学中文字面，产出 `fonts/optical-metrics.json`；**不在 npm/Electron 构建链内** |

---

## 4. E2E 逐 spec 清单（8 spec / 36 项）

`playwright.config.ts`：`testDir: './tests/e2e'`、`workers: 1`、`timeout: 60000`。全部通过 `_electron.launch` 启动**真实生产 Electron**，`FRONTIER_USER_DATA` 指向临时目录并经 `SaveStore` 预置世界。

| spec | 项数 | 通过 | 覆盖内容 |
| --- | ---: | ---: | --- |
| `tests/e2e/command-v9.spec.ts` | 7 | 7 | Ctrl 多选与批量移动；虫洞跟随/接管指引/隐形符号/标记清理；接触警报合并与手动继续；五项战略升级；125/150/200% 原生缩放 |
| `tests/e2e/desktop.spec.ts` | 4 | 4 | 真实 UI 发现/建设/指令/改装/升级/船坞/重启；接触暂停与非法指令无副作用；午夜快照与永久舰损跨重启；失败与成功的分支恢复 |
| `tests/e2e/lcars.spec.ts` | 5 | 5 | Classic 几何/8 个 Starbase 模块/指令/Inspector 六尺寸；偏好持久化、三档动效、真实音频；125/150/200% 显示缩放与紧凑 Inspector |
| `tests/e2e/mine-accidents.spec.ts` | 2 | **0** | 缺料矿场详情 + 预填真实货运；现场响应舰货舱施工状态。**两项均失败，见 §1.2** |
| `tests/e2e/recon.spec.ts` | 8 | 8 | 可见离线 Electron：真实穿越/调查/幽影接管/隐形/待命重启；Orion 与 Romulan 的普通暴露与秘密目的地确认；125/150/200% 地图语义与字体 |
| `tests/e2e/v10.spec.ts` | 4 | 4 | 中文 Inspector/殖民地分段条/自定义名/装弹库存；调查后可见永久五折；敌方基地接管→改建→本地生产；普通虫洞远方区域与聚合网格 |
| `tests/e2e/v9-ui.spec.ts` | 6 | 6 | 精确地图点/队列与打断/拖拽不下令；编队 CRUD 与编队指令持久化；全部地图轮廓与中文 Inspector 域；125/150/200% 长标题不缩断 |
| **合计** | **36** | **34** | |

**Lv1/Lv2 主链路 34 项全部通过，无回归。**

---

## 5. 未验证项（不伪造）

| 命令 | 状态 | 原因 |
| --- | --- | --- |
| `node scripts/acceptance-v9.mjs 236807` | **未验证** | 需可见 Electron 窗口的实玩脚本，未纳入本阶段范围 |
| `node scripts/acceptance-typography.mjs` | **未验证** | 同上 |
| `npm run test:package` | **未验证** | 需先 `npm run package` 产出 `release/`，未纳入本阶段范围 |
| `npm run test:release` | **未验证** | 依赖 `package:zip` 产物 |
| `scripts/play-v9.mjs` | **未验证** | 交互式脚本，需人工 stdin |
| `scripts/normalize-lcars-font.py` | **未验证** | 需 Python + fontTools 环境；不影响运行时 |
| UI 像素级人工核对 | **未验证** | 超出本阶段范围；E2E 的 34 项已覆盖布局/字体断言 |

---

## 6. 重跑基线（照抄即可）

```bash
git status
git diff --check
npm test                                              # 期望：13 文件 / 184 项通过

npm run build                                         # 期望：exit 0

env -u ELECTRON_RUN_AS_NODE npm run test:e2e > e2e.log 2>&1
echo "EXIT=$?"                                        # 期望：EXIT=1（2 项已知失败）
tail -5 e2e.log                                       # 期望：34 passed (≈15.5m) / 2 failed
```

若 E2E 出现 36 项全红且报 `bad option`，**先检查 `ELECTRON_RUN_AS_NODE`**，不要当成项目缺陷排查。

---

## 7. 对 Lv3 的测试含义

1. **`tests/architecture.test.ts` 是最有价值的护栏**——它把端口形状（`Object.keys(port).sort() === ['getObservation','submitAction']`，`:13`）、越权拒绝（`:15-26`）、快照只读（`:28-30`）、同 seed 重放（`:39-60`）都固化成了断言。**扩展 `AgentControllerPort` 必然撞 `:13`**，这是有意的设计闸门。
2. **同 seed 重放断言（`:39-60`）对 Lv3 是硬约束**——任何引入非确定性的 Agent 逻辑（未播种随机、时间戳、网络结果直达状态）都会破坏它。
3. **E2E 的 2 项失败与 Lv3 无关**，但会在每次全量回归里出现，容易被误判为 Lv3 引入的回归。**先记在案**。
4. **测试总数会变**：当前 184（单测）+ 36（E2E）。Lv3 新增测试后请更新本文件，别让数字再次漂移（这正是 `docs/acceptance.md` 此前 175 vs 184 漂移的成因）。
