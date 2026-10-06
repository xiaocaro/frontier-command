# LCARS 26 Classic 指挥终端

2026-10-02。唯一视觉来源为用户提供的 `LCARS-26.zip`。24 个源文件完整保存在 `src/assets/lcars-26/`，已逐文件验证与 ZIP 内容字节相同；运行时直接打包其中 Antonio Regular/Bold、Starfleet Command 标志与五段 MP3。原模板 JavaScript 的页面跳转逻辑不在 React 中执行。

原 ZIP SHA-256：`93508b4eb3ba947ded979dac45b80565d6a1f3664eb8e596f1d036e67a95fa27`。

## 模板审计与对应实现

审计覆盖 Classic、Nemesis Blue、Voyager、Lower Decks、Lower Decks PADD、Picard 的全部 HTML/CSS，以及公共 JS、字体、图像、audio 和 Voyager 说明。主界面采用已确认的 Classic。

| 原始语言 | 应用对应 |
| --- | --- |
| 240 侧轨 / 28 横条 / 160 外弧 / 60 内弧 | 一个共享几何单位，Grid 的侧轨、双横条和上下镜像肘形协调缩放 |
| 40% / 4% / 17% / 自适应 / 4% 分段 | `LcarsBar` 保留五段比例、黑色切口和下横条第三段半高 |
| African Violet、Almond、Almond Creme、Barley、Bluey、Butterscotch、Orange、Red、Subdued Sienna | `tokens.css` 采用原始色值；地图、控件、抽屉使用相同变量 |
| 9 行、7 个行组、6000ms + 200ms delay | `DataCascade` 使用公开 Snapshot 数字；`motion.css` 移植 Classic 原始 keyframes 和行组映射 |
| Antonio 常规和粗体 | 英文标识、时间、终端数据；中文回退 Microsoft YaHei / Segoe UI |
| 胶囊按钮、端帽文字条、开放式黑底内容 | 统一 Button、TextBar、Field、Meter、终端数据行，移除旧卡片和叠加全局样式 |

模板中会隐藏按钮文字的动画没有用于操作控件。循环仅用于非交互数据级联和待决行动状态；关键文字及所有可用按钮始终可见。

## 模块与边界

- `src/ui/components/Lcars.tsx`：Frame、Elbow、Bar、TextBar、Panel、Button、Field、Meter、Drawer、Dialog。
- `src/ui/components/LcarsShell.tsx`：Admiral 框架、通信、时间、六项导航、地图工作区、Inspector、紧凑行动条。
- `src/ui/lcars/styles/`：tokens、controls、console、panels、map、motion；`index.css` 仅负责导入。删除旧 `styles.css` / `lcars.css`，不再叠加覆盖。
- `preferences.ts` / `LcarsProvider.tsx`：版本化界面偏好、系统初始减少动画设置、持久化及控件反馈。
- `audio-manager.ts` / `web-audio.ts` / `WorldFeedback.tsx`：反馈调度、原始资源解码与增益、公开 Snapshot 的新增事件。
- `usePanelFocus.ts`：面板焦点、Escape、模态 Tab 循环与关闭后的焦点恢复。

管理面板相对于地图工作区覆盖，地图始终挂载且 viewport 不变。宽度不超过 1100 时 Inspector 作为可打开覆盖层；Electron 最小内容尺寸为 960×540。地图原有 FIT、边界、指针缩放、语义缩放和标签避让继续使用同一相机模块。高分辨率下标签、标记及避让空间适度放大，标签不跟随世界缩放无限变大。动画 OFF / REDUCED 下摄像机直接定位。Priority Hold 位于顶部通信区，地图区域名称保持可见。

没有修改 `src/engine/`、玩法规则、保存 schema、Electron 持久化或 preload 接口。界面偏好不进入世界存档，不新增游戏 Command / IPC；人员、命令、调查、维修、装弹、保存、新世界与时间线恢复使用原处理函数。

## 动画与声音

侧轨底部 **Console Settings** 提供：

- ANIMATIONS：ON / REDUCED / OFF。默认 ON；首次运行时系统要求减少动画则默认 REDUCED。REDUCED 停用循环、闪烁和位移，保留 100ms 淡入；OFF 即时切换。
- SOUND：ON / OFF，默认 ON，音量 25%。静音或零音量立即停止声音；音量独立保存。
- TEST SOUND，以及原模板署名。

| 音频 | 事件 | 样本增益 |
| --- | --- | --- |
| beep1 | 导航、选择、面板 | 1.00 |
| beep2 | 命令成功、确认、保存 | 0.80 |
| beep3 | 新紧急通信、命令拒绝 | 0.55 |
| beep4 | 新发生的 COMMAND LOST | 1.00 |
| picard-key | 表单选项及数值提交 | 0.48 |

首次可信鼠标/键盘交互解锁 Web Audio；最多两路同时播放，普通操作按事件和全局冷却节流，所有告警至少间隔两秒。告警优先于普通反馈，COMMAND LOST 清理现有声音；若刚播放过告警，单个终态提示延至冷却结束，静音或切换分支会取消等待。初始快照与分支切换不播历史告警。拖动、滚轮、逐字符输入、音量滑动和 Snapshot 刷新保持安静。资源/音频设备失败不阻塞功能。

偏好使用 `frontier.lcars.console.v1` localStorage；未知版本或损坏内容回到初始偏好，音量限制 0–100%。

## 验证入口

`tests/lcars.test.ts` 验证偏好解析、持久化格式、解锁、静音、增益设置、事件去重、快速操作、并发上限和告警优先级。`tests/e2e/lcars.spec.ts` 在真实生产 Electron 验证六种分辨率、三种显示比例、面板焦点、三类表单、Inspector、实际音源启动、动画三档和重启后的设置。既有十项游戏 Electron E2E 保留全部规则/存档断言。

最终结果和截图索引见 [验证记录](verification.md)。显示缩放通过 Electron 的 `--force-device-scale-factor` 验证 125%、150%、200%，没有更改用户的 Windows 系统设置；DIP 转换回 CSS 尺寸允许一个像素舍入。
