# LCARS 26 Classic 验证记录

日期：2026-10-02。本轮只重构 UI，视觉来源为用户提供的 `LCARS-26.zip` Classic 模板。模板六套 HTML/CSS、公共 JS、字体、标志和五段音效均已审计；24 个原文件与 ZIP 逐文件字节相同。实现细节见 [模板审计与设计系统](lcars26-refactor.md)。

## 本轮结果

| 检查 | 结果 |
| --- | --- |
| `npm run build` | TypeScript、Vite、Electron 编译通过；原字体及五段 MP3 已打包 |
| `npm test` | 8 个文件、94 项通过 |
| `npm run test:e2e` | 完整 15 项真实 Electron E2E 通过，保留既有 10 项规则及存档断言 |
| 最终反馈与布局复验 | 6 项反馈/显示测试、4 项布局/缩放测试通过；200% 下 SVG 地图对象的键盘选中、Inspector 关闭与焦点恢复复验通过；舰损/重启和 Day 1 新世界两项最终复验通过 |
| 模板与数据边界 | `src/engine/`、世界规则、存档 schema、持久化和 preload 接口无改动；界面偏好独立保存 |

实际使用生产 Electron、隔离临时用户数据、原有 preload 与 Command 接口。显示缩放通过 Electron `--force-device-scale-factor` 检查，没有修改用户的 Windows 系统设置；DIP 舍入最多允许一个 CSS 像素差异。没有重新制作发布包，已有 release 目录仍是旧版。

## 显示与视觉检查

已打开实际截图检查六种尺寸、125% / 150% / 200% 缩放、五个管理页面、三类任务表单、六类 Inspector、通知、Console Settings、COMMAND LOST 和新世界确认。对照 Classic 的内外弧、双横条分段、黑色切口、按钮与 Antonio 字体层级；修正了圆角内的颜色泄漏、150% 下侧轨标题裁切和暂停提示遮挡地图区域标签。

| 内容视口 | 实际截图 |
| --- | --- |
| 1600×900 | [主控制台](screenshots/lcars-console-1600x900.png) |
| 1920×1080 | [主控制台](screenshots/lcars-console-1920x1080.png) |
| 1920×1200 | [主控制台](screenshots/lcars-console-1920x1200.png) |
| 2560×1440 | [主控制台](screenshots/lcars-console-2560x1440.png) |
| 2560×1600 | [主控制台](screenshots/lcars-console-2560x1600.png) |
| 3840×2160 | [主控制台](screenshots/lcars-console-3840x2160.png) |
| 125% 显示缩放 | [控制台](screenshots/lcars-scale-125.png)、[表单](screenshots/lcars-scale-125-form.png) |
| 150% 显示缩放 | [控制台](screenshots/lcars-scale-150.png)、[表单](screenshots/lcars-scale-150-form.png) |
| 200% 显示缩放 | [控制台](screenshots/lcars-scale-200.png)、[表单](screenshots/lcars-scale-200-form.png)、[Inspector 覆盖层](screenshots/lcars-compact-inspector.png) |

地图始终占主工作区最大面积；抽屉开启前后地图 viewport 不变。六项导航在高缩放下仍可访问。FIT、8× 上限、指针缩放、四向平移边界、窗口调整、语义缩放与标签避让均通过实际交互检查。模态表单 Tab 循环、Escape 及关闭后焦点恢复已验证；COMMAND LOST 保留明确的恢复、档案和新世界入口。

管理页面：[Operations](screenshots/lcars-operations.png)、[Personnel](screenshots/lcars-personnel.png)、[Starbase](screenshots/lcars-starbase.png)、[Colonies](screenshots/lcars-colonies.png)、[Archive](screenshots/lcars-archive.png)。任务表单：[Defense](screenshots/lcars-form-defense.png)、[Transport](screenshots/lcars-form-transport.png)、[Explore](screenshots/lcars-form-explore.png)。

Inspector：[地点](screenshots/lcars-inspector-location.png)、[舰船](screenshots/lcars-inspector-ship.png)、[接触](screenshots/lcars-inspector-contact.png)、[调查决策](screenshots/lcars-inspector-decision.png)、[坐标](screenshots/lcars-inspector-point.png)、[永久舰损](screenshots/lcars-inspector-loss.png)。其他状态：[设置](screenshots/lcars-settings.png)、[COMMAND LOST](screenshots/v5-command-lost-1920.png)、[新世界确认](screenshots/v5-new-frontier-confirm.png)。

## 反馈、持久化与功能

三档动画使用实际计算样式检查：ON 保留原模板级联节奏，REDUCED 停用循环与位移，OFF 关闭动画并使摄像机直接定位。关键文字和操作按钮始终可见。

音频检查观察实际 AudioBufferSource 启动：导航、选项提交、命令成功和 COMMAND LOST 使用对应原始样本；静音后不再启动音源，音量与动画模式在 Electron 重启后恢复。快速连续导航、事件去重、最多两路播放、告警两秒间隔、终态延迟提示与静音取消分别通过 E2E 或 Audio Manager 单元测试。初始快照和刷新不会重复播历史告警。

原有任务创建、修改、取消、调查决策、人员分配、维修、装弹、保存、档案、新世界和时间线恢复入口接回原处理函数。既有 Electron 场景继续验证真实结算、资源守恒、舰损、冻结、午夜快照、重启和失败记录保持。

---

## LV1 v5 历史验证记录

以下为 2026-09-29 的引擎/存档基线记录；其中引擎修复属于上一轮。本轮截图已更新为 LCARS Classic，历史测试数量不代表本轮结果。

日期：2026-09-29。源码版本1.1.0，世界格式v5。Windows x64，Node.js24.18.0、npm11.16.0、Electron41.10.7、Vite6.4.3。

## 实际结果

| 检查                                                                                                 | 结果                                                               |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `npm test`                                                                                           | 7个文件，86项通过                                                  |
| `npm run build`                                                                                      | TypeScript、Vite、Electron编译通过                                 |
| `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`                                             | 通过                                                               |
| `npx playwright test`                                                                                | 完整10项真实Electron测试通过；最终结果副本见electron-last-run.json |
| `npx playwright test --grep 'COMMAND LOST\|Day 1 has no restore' --output .test-data/final-terminal` | 最后消除时间控制的过时通知后，2项终态／新世界场景复验通过          |

没有运行发布打包、EXE或ZIP烟测；已有release目录仍是旧版，不能作为v5产物。本次交付是源码及可运行构建。

## Electron场景

1. 用UI创建运输、防御、探索三项并发任务，16×推进，选择近距方案，全部成功结算并返航；保存、关闭、重启后行动记录一致。
2. 从调查待决继续、修改ROE；超货舱运输由引擎拒绝并显示LCARS错误通知，未创建部分行动。
3. 1920×1080与1600×900内容视口：遍历五个管理抽屉并关闭，地图边界盒不变；鼠标中心缩放、8×极限、四方向拖至相机边界、FIT、地图选择、Resize保留世界中心、表单开启与滚动提交均验证。不存在页面级溢出。
4. 真实海盗火力使运输舰Hull归零，Archive显示永久损失；保存／重启不复活，任务失败。
5. Day3基地被真实海盗武器摧毁，COMMAND LOST出现；继续命令被拒绝、tick冻结。重启仍为终态；RESTORE PREVIOUS DAY恢复Day2 00:00并建立新分支，原failure.json字节不变。
6. 16×从午夜前一tick跨日，day-2.json恰为tick14400；day-1.json仍为tick0。
7. UI装弹4 Photon而库存只有3时拒绝；3 Photon＋1 Quantum先预留、再按时间转入舰船，基地与预留最终归零，舰船得到精确数量。
8. 独立弱防御／强防御世界中，Scout报告使远处Valdore分别选择probe／observe；Renderer始终不包含敌方实体和Romulan报告。
9. 防御设施被摧毁和调查Core不足分别产生实际失败反馈。
10. Day1 COMMAND LOST恢复按钮禁用；BEGIN NEW FRONTIER经LCARS确认后创建新世界，失败记录和旧版文件保持不变。

测试使用临时用户数据目录，通过生产Electron、preload、命令校验和引擎运行。边界测试在启动前生成隔离场景；没有给正式Renderer开放修改世界的测试接口。两种分辨率通过Electron BrowserWindow.setContentSize设置，系统125%显示缩放使PNG物理尺寸为2400×1350／2000×1125。

## 规则证据

- Pirate对货物价值和护航变化改变目标，殖民地／矿场／前哨均可被真实抢掠；取得20战利品后活着离场，撤离不同于Hull归零。
- Scout报告来源与观测时间保留；强防御、无目标和过期报告可以阻止Warbird袭击。
- Phaser／鱼雷发射的Core、弹药与未命中消耗；零弹药不能开火；真实装弹守恒；新增伤害不被既有维修额度免费修复。
- 舰损事件撤销操作者权限，销毁货物和任务关联归档；允许全部舰船被毁、操作者未分配；28舰防御编队不受初始舰数限制。
- Priority按已观测攻击证据改变目标排序；规则操作者不能调任自己或越过暂停命令。
- 隐藏位置、意图与库存改变不改变Snapshot；失联位置冻结，超过30分钟不再提供地图接触。
- 固定步长、同种子复现、存档续跑一致、库存预留与取消回收、调查重复奖励抑制、整段跨境授权。
- 1×／4×／16×的午夜快照、Day3→Day2分支、恢复写入失败不切换、损坏终态不回退至存活备份、旧版／未来版本保护。
- 默认世界运行一个游戏日或至终态，持续满足v5保存校验。

## 实际视觉检查

已打开检查以下真实Electron截图：主界面、两种尺寸的全部管理抽屉、Commander Intent表单及底部提交状态、装弹禁用状态、Archive舰损、COMMAND LOST与新世界确认。黑底、连续粗色带、双肘区域、非对称布局、胶囊按钮、LCARS输入／选择／复选及计量条保持一致。抽屉覆盖地图，不改变相机尺寸。表单独立滚动，标题与关闭按钮保持可见。

| 画面         | 1920×1080                                         | 1600×900                                          |
| ------------ | ------------------------------------------------- | ------------------------------------------------- |
| 主界面       | [截图](screenshots/v5-sector-1920.png)            | [截图](screenshots/v5-sector-1600.png)            |
| 任务表单     | [截图](screenshots/v5-composer-1920.png)          | [截图](screenshots/v5-composer-1600.png)          |
| 表单提交控件 | [截图](screenshots/v5-composer-controls-1920.png) | [截图](screenshots/v5-composer-controls-1600.png) |
| 人员分配     | [截图](screenshots/v5-personnel-1920.png)         | [截图](screenshots/v5-personnel-1600.png)         |
| COMMAND LOST | [截图](screenshots/v5-command-lost-1920.png)      | [截图](screenshots/v5-command-lost-1600.png)      |

另见[舰损档案](screenshots/v5-vessel-loss.png)、[实物装弹](screenshots/v5-armory-loading.png)、[Day1恢复禁用](screenshots/v5-day-one-lost.png)、[新世界确认](screenshots/v5-new-frontier-confirm.png)。其余抽屉截图保存在同目录v5前缀文件中；旧截图仅为历史产物，不作为此次验收证据。

## 验证中修复的问题

修复了安全路线重算时往返振荡、Point参数扩散其他领域字段、未观测罗慕兰设施误画成毁坏、永久终态因序列化字段顺序误判变更、恢复误用失败前备份、低刷新率下缩放迟迟不收敛、拖动离开窗口丢失结束事件、原生表单气泡绕过LCARS反馈及时间控制通知在失守后短暂过时等问题。未删除对应行为要求来让测试通过。
