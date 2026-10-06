# v9 Admiral 演示

1. 在时钟下查看 Credits、Materials、Photon、Quantum、Special Finds 的基地可用量，展开库存/预留。MENU 在窄布局展开导航，控制台设置分别放大文字和界面；Ctrl+0 只复位界面缩放。
2. 先点 MERIDIAN，再 Ctrl 点另一艘货船，选 Helios 仍保留选舰。运输材料的任务窗口默认勾选这两艘船，数量为每舰数量；安全路线无已知危险时直达 Dawn。
3. 在装货船详情选择“返回 Dawn 并卸货”；仅想改变位置时选择“返回 Dawn／保留货物”。矿场仓位 3000，满仓报告一次，实际运走后恢复；Colony 提供 Credits。
4. 选点给所有选中舰船下达 MOVE，临时多选不会创建编队。完成或取消后舰船待命，显式返航和 REPLACE / QUEUE / INTERRUPT 保留原语义。
5. 选 VERITY，再选 FRONTIER 0/0 的 DAWN PASSAGE 并穿越。实际到达出口后镜头跟随该舰；拖图、缩放或选残骸结束跟随。
6. 点幽影残骸的“下一步”，近距 SURVEY 完成即出现“派舰现场接管”。现场 ASSIST_EVENT 后获得 USS VEIL；开启隐形可见虚线环与状态文字。已接管残骸右键移除标记，历史与舰籍仍保存。
7. 接触警报暂停后查看身份与实际观测位置，Romulan 未确认敌对时不会标为红名。确认、定位或下令仍保持暂停，部署完成后手动继续。
8. 普通舰 SHADOW 可能暴露并被甩尾；VEIL 执行 SHADOW 自动隐形，也可手动关闭。到真实目的地附近出现疑似设施，连续现场侦察十分钟后确认基地，才可实施打击。
9. 在 STARBASE 五项战略升级按钮旁观察百分比和剩余分钟；暂停时不推进，完成显示 ONLINE。造舰、弹药制造和模块改装也使用真实工作进度。
10. ARCHIVE 保存并重启，检查隐形、跟踪、地点情报、接触提醒去重与已移除标记。旧 v8 世界不会载入 v9，原存档保留。

验证入口：`npm test`、`npm run test:e2e`、`node scripts/acceptance-v9.mjs 236807`。截图和公开状态结果写入 `docs/verification/v9/`。
