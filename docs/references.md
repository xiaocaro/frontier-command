# 参考资料阅读记录

实现前已阅读以下材料；部分旧PHP地址返回404，按站点 Site Map 找到迁移后的对应页面。没有把读取失败当作已经阅读。

## 项目题目

https://join.geek-tech.club/problems2/agent-mmo-game

关键边界：LV1至少三种机制不同的任务，真人实际操作为加分项；LV2建立成长反馈；LV3才要求模型驱动Agent及其互动。单人可以采用简单表现，现场有两分钟以内视频和试玩demo。本项目按LV1制作。

## LCARS 页面

- 首页：https://www.thelcars.com/
- Site Map：https://www.thelcars.com/site-map.php
- Menu：https://www.thelcars.com/menu/ （旧地址 menu.php）
- License：https://www.thelcars.com/license.php
- Download：https://www.thelcars.com/download.php
- Themes：https://www.thelcars.com/themes/ （旧地址 themes.php）
- Colors：https://www.thelcars.com/colors.php
- Fonts：https://www.thelcars.com/fonts.php
- HTML Elements：https://www.thelcars.com/html-elements.php
- Using Images：https://www.thelcars.com/images/ （旧地址 using-images.php）
- Buttons：https://www.thelcars.com/buttons.php
- Sidebar Buttons：https://www.thelcars.com/sidebar-buttons.php
- Panel Buttons：https://www.thelcars.com/panel-buttons.php
- 2 Column Flex：https://www.thelcars.com/flex.php （旧地址 2-column-layout-with-flex.php）
- Text Bar：https://www.thelcars.com/text-bar.php
- Comms：https://www.thelcars.com/comms/ （旧地址 comms.php）
- News：https://www.thelcars.com/logs/ （旧地址 news.php）

采用Classic配色、肘形贯通边框、分段条带、面板按钮和本地压缩英文字体。旧版panel按钮改造说明与较新版本的可点击面板有所区别；没有盲目混用模板版本。

原模板许可包含署名和分发限制。因此本项目自行编写HTML/CSS，未复制、热链接或分发模板CSS、JS、音效和图片。字体从独立的Fontsource包取得，附带SIL OFL许可。

## Star Trek 背景

- Starfleet职责：https://www.startrek.com/get-to-know
- Klingon与联邦关系：https://www.startrek.com/news/klingon-on-the-bridge
- Romulan背景：https://www.startrek.com/news/star-trek-romulans-federation-primer

正史背景与原创地点、家族、舰船和数值明确区分，详见worldbuilding.md。

## 模型与技术

https://docs.bigmodel.cn/cn/guide/models/free/glm-4.6v-flash

已阅读概览、工具调用、思考模式和调用示例。本阶段不连接API，不使用token；后续只在决策节点通过结构化动作接入，不能以模型替代模拟引擎。

https://www.electronjs.org/docs/latest/tutorial/security

https://www.electronjs.org/docs/latest/tutorial/context-isolation

https://vite.dev/guide/

Electron使用上下文隔离、沙箱、受限preload、来源检查与本地协议加载；界面没有Node权限或任意IPC入口。
