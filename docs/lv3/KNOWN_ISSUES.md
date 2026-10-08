# Lv3 Known Issues / 冲突登记（KNOWN_ISSUES）

生成日期：2026-10-08
阶段：Prompt 3（Implementation Plan + Codex Handoff）
性质：冲突与遗留问题登记。**本文件不修改已批准的 `docs/lv3/02-*.md`，只登记它们与实际代码的差异。**

> `docs/lv3/02-*.md` 是 Prompt 2 批准的架构与合同，视为冻结。本文登记的所有差异都已在实际代码中
> 逐行复核（不是从文档转抄）。每条给出：**Conflict / Current Code / Approved Design / Impact /
> Proposed Resolution**。
>
> 命名规则：`CONFLICT-n` 沿用 `02-mvp-traceability.md` §4 的既有编号（1–7）；本文新增条目标为
> `C-8` 起，避免与既有编号冲突。

---

## 0. 严重度分级

| 级别 | 含义 |
| --- | --- |
| 🔴 **BLOCKER** | 若不处理，实施会失败或破坏 Lv1/Lv2。实施前必须按 Resolution 落地 |
| 🟠 **HIGH** | 会导致测试静默失败、迁移中断或行为与设计不符 |
| 🟡 **MEDIUM** | 会造成返工、命名混淆或漏改 |
| ⚪ **INFO** | 记录在案的措辞/引用不精确，无功能影响 |

---

## 1. 沿用 Prompt 2 的冲突（CONFLICT-1 … CONFLICT-7）

来源：`docs/lv3/02-mvp-traceability.md` §4。**结论不变，本阶段不重开。** 摘要如下，细节见原文。

| 编号 | 摘要 | 处置 |
| --- | --- | --- |
| CONFLICT-1 🔴 | 需求假设存在燃料系统，实际代码**完全没有** fuel 字段（`src/`、`electron/`、`tests/` 零命中） | **不新增燃料**。EVT-04 的「Fuel / Return Margin」重新表达为「弹药余量 + 船体完整度 + 路径预估」的复合战备度 |
| CONFLICT-2 ⚪ | `Agent.md` §4「Agent 是 WorldState 的一部分」与 CLAUDE.md §2.2 表面矛盾 | 区分「存档位置」与「物理权威」。不冲突 |
| CONFLICT-3 ⚪ | `Agent.md` §53 建议的文件名（`world-state.ts` / `simulation-engine.ts`）不存在 | 保留既有 `engine.ts` / `types.ts`，只新增 `src/engine/agent/` |
| CONFLICT-4 🟡 | `legalActions` 硬编码不可靠 | 用 `availableActions` 替换。**本阶段已复核为零成本**（见 C-19） |
| CONFLICT-5 🟠 | 现有 25 种命令中无任何对话类命令，MVP 协商分支无法表达 | 追加式新增 `agentMessage` 命令（本阶段落为 P0-15，见决策 5） |
| CONFLICT-6 ⚪ | MVP 需 4 个 Agent，`INITIAL_FLEET` 有 6 艘 | 4 艘绑定 Agent，余 2 艘保持 `kind:'rules'`，形成对照组（本阶段落为 P0-16） |
| CONFLICT-7 ⚪ | MVP 的「失联探测船」与既有 USS VEIL 链路重合 | 直接复用 Veil 链路（`world-events.ts:354-371`），不新增 |

---

## 2. 本阶段新增冲突（C-8 … C-25）

### C-8 — `careerSchema` 命名冲突 🟡 MEDIUM

| 项 | 内容 |
| --- | --- |
| **Conflict** | 已存在 `careerSchema`，与 Lv3 的 `AgentCareer` 同名概念但取值不同 |
| **Current Code** | `src/engine/commands.ts:79-86` 定义 `careerSchema = z.enum(['battle','science','diplomacy','logistics','security','commander'])`，服务既有 `Personnel`（`types.ts:99-110`）。被 `v9-schema.ts:30` 与 `commandSchema.candidate`（`commands.ts:~150`）使用 |
| **Approved Design** | `schemas/agent.schema.json` 的 `career` = `['explorer','scientist','tactical','logistics']`。`02-*.md` **从未提及 `Personnel`** |
| **Impact** | 实施者若 `import { careerSchema }` 给 Agent 复用，会静默拿到错误的 6 值枚举，且类型检查**不会报错**（都是 `z.enum` 字符串联合） |
| **Proposed Resolution** | 新增独立 `agentCareerSchema`（P0-03）。**`careerSchema` 一行不改。** 在 `03-implementation-plan.md` 与代码注释中明确：既有 `Personnel`（船员/技能/训练/岗位，UI 页 `PERSONNEL`）是**独立系统**，Lv3 Agent 与之无关；把 Agent 与 `Personnel` 岗位绑定的想法属 **POST-MVP**（不在 MVP 9 事件内） |

### C-9 — 既有 `Personnel` 与 Agent 概念重叠 🟡 MEDIUM

| 项 | 内容 |
| --- | --- |
| **Conflict** | 仓库已有「具名人员」系统，Lv3 又引入一个「具名 Agent」系统，二者都可能被理解为「员工」 |
| **Current Code** | `Personnel`（`types.ts:99-110`）：`id/name/originId/career/experience/skills/status/training/locationId/posting`；命令 `candidate` / `assignPersonnel`（`frontier-commands.ts:182-205`）；UI `ui/PersonnelView.tsx` |
| **Approved Design** | Agent 有 `personality/state/goal/memory/relationships/promises`，无 `skills`（Defer），不参与 `posting` |
| **Impact** | 概念混用会导致实施者试图「统一」两套系统，造成范围爆炸 |
| **Proposed Resolution** | 明确二者**并行且不互相引用**。`03-implementation-plan.md` 单列一节说明差异；`03-file-change-plan.md` 把 `ui/PersonnelView.tsx`、`society.ts`、`frontier-commands.ts` 的 personnel 分支标为 **DO NOT MODIFY** |

### C-10 — `AgentObservation` 无法经冻结的 port 传递 🟠 HIGH

| 项 | 内容 |
| --- | --- |
| **Conflict** | `02-architecture.md` §6 把观察入口定为 `controllerPort(operatorId)`，但该 port 的 `getObservation()` 返回类型过窄 |
| **Current Code** | `types.ts:653-656` `AgentControllerPort.getObservation(): Observation \| null`；`projection.ts:199-228` 只返回 `time/operatorId/ship/contacts/systems/bodies/opportunities/legalActions`。**不含** `self` / `company` / `relationships` / `recentMemory` / `pendingMessages` / `activePromise` / `activeDirective` / `availableActions` |
| **Approved Design** | `02-domain-model.md` §9 的 `AgentObservation` 宽得多，且 §9 明确要求「在既有 `snapshot()` 裁剪之上再做一层单 Agent 视角过滤」 |
| **Impact** | 无法在不动 port 的情况下装配决策上下文。而 `engine.ts:91-96` 返回 `Object.freeze`，`tests/architecture.test.ts:13` 断言 port 恰好只有两个 key——**新增第三个 method 会打破既有测试** |
| **Proposed Resolution** | **加宽唯一那条观察通路，不新增第二条、不改 port 的 key 集合**：`ObservationData` 扩充为 `AgentObservation` 的字段（含 `tick`/`agentId`/`self`/`company`/…/`availableActions`），`getObservation(operatorId)` 返回 `AgentObservation \| null`，operator 无 Agent 时返回 `null`。port 方法签名只发生**加宽**，key 集合不变，`:13` 继续通过。已复核消费方仅为 `architecture.test.ts:12`（读 `.ship.id`）、`:27`（读 `null`）、`recon.test.ts:365`（对 `JSON.stringify` 做隐私断言）——加宽不影响三者。**不采用**新增 `engine.getAgentObservation()` 的第二条通路（CLAUDE.md §4 禁止平行抽象） |

### C-11 — `controllerPort.resolve(choiceId)` 会打破既有测试 🔴 BLOCKER

| 项 | 内容 |
| --- | --- |
| **Conflict** | `02-decision-flow.md` §6 的时序图出现 `RT->>EN: controllerPort.resolve(choiceId) → Action` |
| **Current Code** | `engine.ts:91-96` 返回 `Object.freeze({ getObservation, submitAction })`；`tests/architecture.test.ts:13` 断言 `Object.keys(port).sort()).toEqual(['getObservation','submitAction'])` |
| **Approved Design** | §6 时序图暗示 port 需第三个 method 做 choiceId → Action 解析 |
| **Impact** | 若照图实现，**既有 Lv1/Lv2 边界测试立即失败** |
| **Proposed Resolution** | **不扩展 port。** choiceId 解析在 Agent 层完成：`observation.availableActions.find(c => c.id === choiceId)?.action`。每个 `AgentActionCandidate.action` 已是**完整构造好的既有 `Action`**（`schemas/agent-action-candidate.schema.json` 的 `required` 含 `action`），因此引擎侧完全不需要知道 choiceId 的存在——这比时序图**更严格**地满足 `Agent.md` Rule 2/3（引擎连「选择」这个概念都不引入）。`03-api-contract.md` 将明确记载：`02-decision-flow.md` §6 该行为图示不精确，以本节为准 |

### C-12 — `tests/architecture.test.ts:105` 断言 v11 必须抛错 🟠 HIGH

| 项 | 内容 |
| --- | --- |
| **Conflict** | 升级到 v11 与既有回归测试直接冲突 |
| **Current Code** | `tests/architecture.test.ts:105-106`：`for (const version of [5, 6, 7, 8, 11]) expect(() => parseSave({ ...e.state, version })).toThrow();` |
| **Approved Design** | `02-persistence-strategy.md` §4.3 要求 `CURRENT_SAVE_VERSION = 11` |
| **Impact** | 无法在不修改该测试的前提下完成 v11 升级。**这是本阶段唯一必须修改的 Lv1/Lv2 回归断言** |
| **Proposed Resolution** | 把字面量列表 `[5,6,7,8,11]` → `[5,6,7,8,12]`，**保持断言原意**（未知版本必须拒绝）。**不要**把 `10` 加进该列表：v11 落地后 `parseSave({version:10})` 会走 `migrateV10`，而传入对象是 v11 形状（带 `agents`），冻结的 v10 schema 是 `.strict()` 因而拒绝——它确实会抛错，但**抛错理由不对**，会把「拒绝未知版本」的断言变成误导性断言。该测试的修改理由必须写进 `03-file-change-plan.md` 与提交信息 |

### C-13 — v11 升级打破的测试远不止一个 🟠 HIGH

| 项 | 内容 |
| --- | --- |
| **Conflict** | `02-persistence-strategy.md` §7 只提到 `tests/persistence.test.ts`（13 项）作为回归护栏，未列出**因版本/路径字面量而被打破**的其它测试 |
| **Current Code** | 除 C-12 外，还有：`tests/persistence.test.ts:108`（`version: 11`，断言不支持版本 → 改 `12`）、`tests/mine-accidents.test.ts:186`（`expect(engine.state.version).toBe(10)` → `11`）、`tests/v10.test.ts:371`（`toBe(10)` → `11`）、`tests/v10.test.ts:385`（`toContain('frontiers-v10')` → `'frontiers-v11'`）、`tests/v10.test.ts:390`（`toBe(10)` → `11`）、`tests/e2e/desktop.spec.ts:174`（`toBe(10)` → `11`）、`tests/e2e/desktop.spec.ts:239`（`'frontiers-v10'` → `'frontiers-v11'`）。另需查看 `scripts/acceptance-v9.mjs:119`（报告载荷中的 `version: 10` 标签） |
| **Approved Design** | 未提及 |
| **Impact** | 若只改 `architecture.test.ts`，会有一批测试**静默失败**，实施者会误判为「迁移写错了」而浪费时间 |
| **Proposed Resolution** | 完整清单写入 `03-file-change-plan.md`，并与版本升级**同一个提交**内完成。`tests/v10.test.ts:357-390` 的整个前提（「迁移 v9 timeline」）会自然变成「v9 → v11」，需确认断言仍然表达原意 |

### C-14 — `migrateV9` 必须改，不只是 `parseSave` 闸门 🔴 BLOCKER

| 项 | 内容 |
| --- | --- |
| **Conflict** | 设计只描述「`parseSave` 闸门更新 + 链式迁移」，但 `migrateV9` 自身会用**活的** schema 校验 |
| **Current Code** | `saves.ts:47` `return worldSchema.parse(w);`——`migrateV9` 末尾用**活** `worldSchema` 校验自己构造的 v10 对象 |
| **Approved Design** | `02-persistence-strategy.md` §4.3 只要求 `if (version === 9) return migrateV9(input) → 需串接为 v9 → v10 → v11` |
| **Impact** | 一旦 `worldSchema` 变为 v11（要求 `agents` 字段），`migrateV9` 构造的对象**没有 `agents`**，`migrateV9` 自己就会抛错——**所有 v9 存档将彻底无法迁移** |
| **Proposed Resolution** | `migrateV9` 末尾改为用冻结的 `legacyV10Schema` 校验，然后 `return migrateV10(v)`。`migrateV9` 内部的 `version: 10` 字面量（`saves.ts:11`）**保持为 10**（它是 v10 中间产物）。`parseSave` 闸门：`9 → migrateV9`、`10 → migrateV10`、`!== 11 → throw` |

### C-15 — 存档根目录/索引并非「版本常量驱动」 🟠 HIGH

| 项 | 内容 |
| --- | --- |
| **Conflict** | `02-persistence-strategy.md` §5 称「`SaveStore` 的 `root` / `indexPath`（`persistence.ts:44-45`）由版本常量驱动，改一处即可」 |
| **Current Code** | `electron/persistence.ts:44` 硬编码 `'frontiers-v10'`、`:45` 硬编码 `'timeline-v10.json'`、`:25` `indexSchema` 硬编码 `z.literal(10)`、`:101` 写索引时 `version: 10`、`:167` `create()` 内 `version: 10`；且 `:46` 的迁移触发条件是「无 v10 索引 **且** 存在 `timeline-v9.json`」，`migrateTimeline`（`:64-102`）只处理 v9→v10 一步。**全仓库无版本常量** |
| **Approved Design** | 见上（不准确） |
| **Impact** | 低估改动面。且 `:46` 的触发条件若不改，**有 v10 存档的玩家升级后不会触发迁移**，直接进入 blocked 或空世界 |
| **Proposed Resolution** | 在 `03-implementation-plan.md` 的 Persistence Plan 中列出**真实改动集**（见该文 §7）。推荐把 `'frontiers-v' + CURRENT_SAVE_VERSION` 与 `'timeline-v' + CURRENT_SAVE_VERSION + '.json'` 从既有的 `saves.ts:5` 常量派生，避免未来再次漂移；但**是否引入该派生属 SHOULD 而非 MUST**，最小改动 = 直接更新字面量。迁移触发条件必须改为「无 v11 索引 且（存在 `timeline-v10.json` 或 `timeline-v9.json`）」 |

### C-16 — Agent 的触发事件不应新增引擎持久化字段 🟡 MEDIUM

| 项 | 内容 |
| --- | --- |
| **Conflict** | `02-decision-flow.md` §3.2 要求引擎在既有分支中发出 `AgentTrigger`，但未说明事件通道 |
| **Current Code** | 既有非持久化瞬时通道：`SimulationEngine.pendingEvents: SimulationEvent[]`（`engine.ts:26-27`），由 `step()` 在 `:147`/`:160` 汇入返回值；先例 `combat.ts:126` 推送 `shipDestroyed`。`abandonFrame` 的 `afterStep` 回调（`engine.ts:162-171`）已把每个 step 的事件交给宿主 |
| **Approved Design** | §3.2 给出触发点表（`engine.complete()`、`advanceStanding` 末尾、`createEvent`、`updateSensors` 等），未指定承载方式 |
| **Impact** | 若把触发队列放进 `WorldState`，会破坏 `tests/architecture.test.ts:39-60` 的 `expect(a.state).toEqual(b.state)` 重放断言，并膨胀存档 |
| **Proposed Resolution** | **把 `AgentTrigger` 作为 `SimulationEvent` 联合的新增变体**，复用既有 `pendingEvents` 瞬时通道。`SimulationEvent`（`types.ts:448-453`）是本地判别联合，新增变体是**纯追加**；`main.ts:193` 只过滤 `shipTransited`，不受影响；瞬时通道不进 `state`，重放断言不变。发出点只需在既有分支各加 1–2 行 push。**DO NOT** 新建第二个引擎侧队列，**DO NOT** 把 trigger 写进 `WorldState` |

### C-17 — Agent 指令可被静默清除 🟠 HIGH

| 项 | 内容 |
| --- | --- |
| **Conflict** | 设计与调度器都假设「Agent 提交的指令会被完整执行并产生完成事件」 |
| **Current Code** | ① Agent 提交的指令 `source` 恒为 `'standing'`（`command-system.ts:393`：`d.source = actorId === w.commander.id ? 'admiral' : 'standing'`；`Directive.source` 仅两值，`types.ts:254`）。② `fleet.ts:50` 的 `hasAdmiralWork` **只保护** `source === 'admiral'`。③ `fleet.ts:81-91`：当舰船自身 `standing` 阈值触发（hull/shield/core 低于阈值且 12 游戏分钟内被攻击）时，`fleet.ts:84` 直接 `s.current = null` 并转入紧急脱离——**没有任何事件通知** |
| **Approved Design** | `02-decision-flow.md` §3.5 只覆盖「超时/非法 JSON/choiceId 越界/API 错误/Observation 过期」，`02-llm-boundary.md` §6 同理。**未覆盖指令被引擎侧清除** |
| **Impact** | Agent 会「以为」自己还在执行任务，永远等不到 `directive-completed`，调度器**永久停摆**（尤其叠加单飞 + 冷却） |
| **Proposed Resolution** | 计划级兼容：`scheduler.ts`（P1-03）必须做**指令存续检测**——记录提交时的指令身份（`action.type` + `created` 或 `makeDirective` 的 id），每个宿主帧比对 `ship.current`；若指令消失且未收到完成事件，合成 `directive-failed`，并写入 `mission-failure` 记忆与 morale/stress 更新。在 MVP（EVT-01…09 无战斗）中该分支是**潜伏**的，但检测代码必须存在，否则 P3 一旦加入威胁就会挂死 |

### C-18 — `RULES.decisionInterval` 已被占用 ⚪ INFO

| 项 | 内容 |
| --- | --- |
| **Conflict** | `02-decision-flow.md` §3.2 的示意代码写 `RULES.agentDecisionInterval`（提案 15 游戏分钟），但 `RULES` 已有 `decisionInterval` |
| **Current Code** | `definitions/rules.ts`：`decisionInterval: 5`（既有敌方 AI 节拍，`threats.ts:79-80`）。`RULES` 经 `definitions/freeze.ts` 深冻结 |
| **Approved Design** | 未察觉重名 |
| **Impact** | 若实施者误改用 `decisionInterval`，会**改变敌方 AI 行为**，破坏 Lv1/Lv2 平衡与既有测试 |
| **Proposed Resolution** | 新增独立键 `agentDecisionInterval`（建议 15），**追加**到 `rules.ts`（深冻结只要求不修改既有值，追加是允许的）。`03-file-change-plan.md` 标注 `RULES.decisionInterval` 为 **DO NOT MODIFY** |

### C-19 — `legalActions` 替换确认为零成本 ⚪ INFO（**已复核，无冲突**）

| 项 | 内容 |
| --- | --- |
| **Conflict** | 无。`CONFLICT-4` 的判断在本阶段被独立复核并**确认成立** |
| **Current Code** | `legalActions` 全仓库仅两处：类型声明 `types.ts:651`、构造处 `projection.ts:212-226`。`grep` 确认**无任何消费者**（UI、测试均不读） |
| **Approved Design** | `02-architecture.md` §4 称「零成本替换」 |
| **Impact** | 无 |
| **Proposed Resolution** | 按设计执行。`05` 的 `Observation` 加宽（C-10）会一并移除 `legalActions` |

### C-20 — `payload` 可选性在文档与 schema 间矛盾 🟡 MEDIUM

| 项 | 内容 |
| --- | --- |
| **Conflict** | 同一字段在一处可选、一处必填 |
| **Current Code** | `schemas/agent-message.schema.json` 的 `required` **包含** `payload`，类型为 `oneOf: [null, …]` |
| **Approved Design** | `02-domain-model.md` §12 写作 `payload?: MessagePayload;`（可选） |
| **Impact** | Zod 与 JSON Schema 漂移；实施者按文档写 Zod 会让 `schemas/*.json` 与运行时契约不一致 |
| **Proposed Resolution** | **以已提交的 JSON Schema 为准**（CLAUDE.md §6：JSON Schema 是跨工具合同）：Zod 写作 `payload: MessagePayload.nullable()`，即**必填但可为 null**。该取舍写入 `03-api-contract.md`。注意：不改 `schemas/*.json` |

### C-21 — EVT-03 使用的 `accept-team` 不在 choiceId 清单中 🟡 MEDIUM

| 项 | 内容 |
| --- | --- |
| **Conflict** | 两处文档的 choiceId 取值不一致 |
| **Current Code** | 与本条无关（纯文档冲突） |
| **Approved Design** | `02-domain-model.md` §10 的 id 清单含 `accept` / `reject` / `counteroffer`，**不含** `accept-team`；而 `02-mvp-traceability.md` §2 的 EVT-03 行写 `choiceId:'accept-team'` |
| **Impact** | choiceId 表若不定稿，P0-11 与 P1 的解析逻辑会各自发明取值 |
| **Proposed Resolution** | 本阶段定稿（见 `03-implementation-plan.md` §5）：团队回应使用 `team-accept:<agentId>` / `team-decline:<agentId>`，同时**保留** `accept` / `reject` / `counteroffer` 表示对 Admiral 任务的回应。`02-domain-model.md` §10 自己声明该表是「提案，Prompt 3 细化」，因此这是**授权范围内的定稿，不是重新设计** |

### C-22 — Agent 身份的 join 方式未定义 🟡 MEDIUM

| 项 | 内容 |
| --- | --- |
| **Conflict** | Agent 与 Operator 的关联方式在设计中被留给 Prompt 3，而已提交的 `schemas/agent.schema.json` **没有**任何 operator 字段 |
| **Current Code** | `Operator`（`types.ts:382-387`）：`id/name/kind: 'rules'/availability`。三处创建点：`data.ts:176`、`services.ts:157`、`world-events.ts:362`，**全部**遵循 `'ops-' + shipId` |
| **Approved Design** | `02-domain-model.md` §8 把选择留给 Prompt 3，并**提议取显式字段**，其给出的理由是「命名约定会在 `buildShip` 产生新舰时断裂」 |
| **Impact** | 不定则 P0-16 无法写；`schemas/agent.schema.json` 无字段，因此不能靠 schema 表达关联 |
| **Proposed Resolution** | 采纳 §8 的**结论**：`Operator.agentId?: string`（provider 侧显式、可被 schema 唯一性校验、不惧改名）。但**理由需要更正**——见 C-23 |

### C-23 — `02-domain-model.md` §8 拒绝命名约定的理由与代码不符 ⚪ INFO

| 项 | 内容 |
| --- | --- |
| **Conflict** | §8 称命名约定 `operatorId = 'ops-' + shipId` 「会在 `buildShip` 产生新舰时（`command-system.ts:488-504`）断裂」 |
| **Current Code** | **不成立**。造船时同样遵循该约定：`services.ts:157` `const operatorId = 'ops-' + s.id;`；接管 USS VEIL 时 `world-events.ts:362` `id: 'ops-veil'`（`veil.id === 'veil'`）。三处创建点（`data.ts:176`、`services.ts:157`、`world-events.ts:362`）**都**遵循约定 |
| **Approved Design** | 见上（理由不准确） |
| **Impact** | 若实施者据「约定会断裂」去修 `services.ts`，会做**无谓的 Lv1/Lv2 改动** |
| **Proposed Resolution** | **不改 `services.ts` / `world-events.ts`。** 结论仍取显式 `Operator.agentId`，但真正理由是：**`Agent.id` 按已批准的 `agent.schema.json` 形如 `'agent-<n>'`，与 `operatorId` 不同名**，所以任何命名约定都无法把 operator 映射到 agent（约定只能给 ship ↔ operator）。显式字段是唯一不需要第二张映射表、且可被 `save-schema` 唯一性校验的做法。此更正写入 `03-implementation-plan.md` §4.1，并取代本条登记的原始理由 |

### C-24 — `worldSchema` 无法派生出 v10 版本 🟡 MEDIUM

| 项 | 内容 |
| --- | --- |
| **Conflict** | 迁移需要「v10 形状的校验器」，直觉上可从活 `worldSchema` 用 `.omit()` / `.pick()` 派生 |
| **Current Code** | `src/engine/save-schema.ts:131` 起是 `z.object({...}).strict().superRefine(...)`（`:420-741`），整体是 **`ZodEffects`**。`ZodEffects` **没有** `.omit()` / `.pick()` / `.extend()`——这些方法只存在于 `ZodObject` 上 |
| **Approved Design** | `02-persistence-strategy.md` §4.4 只说「参照既有做法新增 `src/engine/legacy-v10/save-schema.ts`」，未点明为何必须整份复制 |
| **Impact** | 实施者若尝试 `worldSchema.omit({ agents: true })` 派生，会在**类型检查阶段**失败（或被迫用 `any` 绕过，违反编码约束） |
| **Proposed Resolution** | **必须整份复制**活 `save-schema.ts` 成 `src/engine/legacy-v10/save-schema.ts`（P0-01），保留 `version: z.literal(10)`、`kind: z.literal('rules')`，不含 `agentId` 与三个 Agent 数组。**复制必须在修改活 schema 之前完成**，否则复制到的已是 v11 |

### C-25 — 无声明式 JSON Schema 校验器，`ajv` 仅为传递依赖 🟡 MEDIUM

| 项 | 内容 |
| --- | --- |
| **Conflict** | `schemas/*.json` 是 CLAUDE.md §6 规定的跨工具合同，直觉上应有一个校验器来保证它与 Zod 不漂移 |
| **Current Code** | `package.json` 的 `dependencies` 只有 `@fontsource/antonio`、`react`、`react-dom`、`zod`；`devDependencies` 也没有 JSON Schema 校验器。`node_modules/ajv/package.json` 存在（`ajv@8.20.0`），但它**只是** `app-builder-lib`（electron-builder 的依赖）带进来的**传递依赖**，未在 `package.json` 中声明 |
| **Approved Design** | `02-*.md` 未提及如何保持 JSON Schema 与 Zod 同步；CLAUDE.md §6 只要求「运行时校验由既有 TypeScript/Zod 层实现，不新建第二套校验架构」 |
| **Impact** | ① 若实施者 `import Ajv from 'ajv'`，在依赖提升变化或干净安装后可能**直接失败**；② 若为此把 `ajv` 提为直接依赖，会引入一个与「Zod 是运行时权威」并行的校验路径，触碰 CLAUDE.md §4/§6；③ 没有校验器则 `schemas/*.json` 的漂移完全不可见（`C-16`） |
| **Proposed Resolution** | **不引入运行时校验器。** 用**零依赖**的一致性测试（`tests/agent/schemas.test.ts`）：读 7 个 JSON 文件，断言 `required`/`enum`/数值范围/`maxItems` 40·20/`additionalProperties:false`，并断言对应 Zod schema 接受合法 fixture、拒绝非法 fixture。**可选的加强**是把 `ajv` 显式声明为 **devDependency** 并仅在测试中使用（用 `zod-to-json-schema` 生成后比对）——仅在网络允许且实施者确认收益时采用，**不采用也不影响合同有效性**。**绝不可**依赖传递依赖 |

---

## 2b. P2（DeepSeek Runtime）新增条目（C-26 … C-28）

来源：`docs/lv3/06-deepseek-runtime-status.md` §5。三条均为**实现与批准设计的差异**，已在代码中落地并有测试覆盖；**未重开 `02-*.md` 的设计**。

### C-26 — 熔断的粒度与时间基准与批准的提案不一致 🟡 MEDIUM

| 项 | 内容 |
| --- | --- |
| **Conflict** | `02-llm-boundary.md` §6 写「连续失败则临时停用**该 Agent** 的 LLM 路径」「降级为确定性模式一段时间（**提案 30 游戏分钟**）」；P2 的实现在 `electron/agent/openai-compatible.ts` 内按 **provider 全局** 计数、按 **wall-clock** 冷却（`DEFAULT_COOLDOWN_MS = 30_000`） |
| **Current Code** | `OpenAiCompatibleModelClient` 的 `consecutiveFailures` / `breakerOpenUntil`；`recordFailure()` 在 `consecutiveFailures >= maxConsecutiveFailures`（默认 2）时置 `breakerOpenUntil = now() + cooldownMs`；`decide()` 开头短路为 `{ok:false,error:'unavailable'}`，不发网络请求 |
| **Approved Design** | per-Agent 停用 + 游戏分钟粒度 |
| **Impact** | ① 一个 Agent 的连续失败会短暂影响其他 Agent 的 LLM 路径；② 冷却时长与游戏速度无关（倍速下体感不同）；③ **不**影响安全性——「降级为确定性模式」已由 `DecisionRuntime` 的既有 fallback 独立保证，与熔断无关 |
| **Proposed Resolution** | **不在 P2 修**。provider 不得持有 `SimulationEngine` 或游戏时钟（Rule 1），per-Agent 状态属于 Scheduler 的 `Map<agentId, Pending>`（`03-api-contract.md` §4.6）。P3 在 Scheduler 内实现游戏分钟粒度与 per-Agent 停用；届时 provider 的熔断退化为纯传输层护栏（保留，防止空转网络）。**验收见 `03-test-plan.md` L-13**（P2 已满足「有限重试 + 不死循环」的部分） |

### C-27 — `ModelClient` / `DecisionTrace` 的**增量**字段 ⚪ INFO

| 项 | 内容 |
| --- | --- |
| **Conflict** | 交接说明（`05-mock-runtime-status.md` §7）写「P2 **不要重写** `electron/agent/model-client.ts` 的契约」；任务书 §19 又要求 trace 能记录 `model` |
| **Current Code** | `ModelClient` 追加**可选** `readonly model?: string`；`DecisionTrace` 追加 `model: string \| null`（`runtime.ts` 由 `this.client.model ?? null` 填充） |
| **Approved Design** | `03-api-contract.md` §4.4 的 `ModelClient` 无 `model`；`DecisionTrace` 由 P1 定义 |
| **Impact** | 无。`model` 是**可选**成员，`MockModelClient` 与 P1 测试里的全部 stub（`lyingClient`、spy provider）**零修改**仍满足接口；`ModelResult`（§4.4 的另一半，且被 P1 测试 `toEqual`）**一字未改**；既有 trace 断言均为字段级 |
| **Proposed Resolution** | 保留。「不重写契约」= 不改变既有成员的语义与必需性；追加一个可选成员是满足 §19 的**最小**代价。若未来要把 `model` 放进 `ModelResult`（必需形状），需先重开 `03-api-contract.md` §4.4 并同步更新 P1 测试——**本阶段明确不做** |

### C-29 — 提示词的 `intent` 解释与校验器矛盾（**已由真实端点暴露并修复**）🟠 HIGH

| 项 | 内容 |
| --- | --- |
| **Conflict** | `prompts/agent/decision.md` 的 intent 表写 `act` =「执行菜单里的**某个**动作」，规则 1 又说 `act` 的 `choiceId` 必须是菜单里的 id；而菜单里**确实**包含 `accept`。同一份提示词的另一处又说社交选项应当用 `respond`。**提示词自相矛盾**，且与 `src/engine/agent/decision.ts#validateDecisionShape`（`act` + 社交选项 ⇒ 拒绝）矛盾 |
| **Current Code** | 首次对真实 DeepSeek 的调用返回 `{"intent":"act","choiceId":"accept"}` ⇒ `invalid-choice-id` ⇒ 降级为确定性决策。原始响应体与判定见 `docs/lv3/06-deepseek-runtime-status.md` §1.1 |
| **Approved Design** | `02-llm-boundary.md` §4.2 只规定内容原则；`decision.ts` 的 `act` 语义是 P1 已批准、有测试覆盖的行为。**两者不可能都对** |
| **Impact** | 🟠 真实模型的**第一次**回答即被拒。若不加处理，MVP 里 Agent 会系统性地无法接受任务（只能给出反报价或观望），P2 的退出判据「DeepSeek → valid AgentDecision」不成立 |
| **Proposed Resolution** | **已落地**（P2 内）：① `renderSituation` 在每个可选项后逐条标注其接受的 intent；② `decision.md` 增补硬性规则 2。**不**放宽校验器、**不**在 provider 里改写模型输出（Rule 3）。四个提示词与 `AGENT_PROMPT_VERSION` 升至 `agent-v2`。修复后 4/4 实跑通过。详见 `06-deepseek-runtime-status.md` §5.8 |
| **教训** | 离线 fixture 是这个缺陷的**盲区**——录制决策由人写成，人不会犯「act + accept」这种错。**只有真实端点能暴露提示词与校验器的矛盾。** 后续每次改提示词或改 intent 规则，都应对真实端点重跑 `npm run test:llm` |

### C-28 — `prompts/agent/*.md` 未随 P2 调优 ⚪ INFO（**已解决**）

| 项 | 内容 |
| --- | --- |
| **Conflict** | 任务书 §7/§8/§9 把 Prompt/Context Builder 与提示词设计原则列为 P2 交付；`05-mock-runtime-status.md` §8 限制 6 又说「提示词好不好，P2 接上真实模型才知道」 |
| **Current Code** | 首次提交时四个提示词文件一字未改，`prompt_version` 为 `agent-v1`。**现为 `agent-v2`**：`decision.md` 增补 intent 规则，`renderSituation` 逐条标注选项 intent（见 `C-29`）；`AGENT_PROMPT_VERSION` 与 fixture 的 `promptVersion` 已同步 |
| **Approved Design** | `02-llm-boundary.md` §4.2 只规定内容原则，未规定具体措辞 |
| **Impact** | 首次提交时提示词质量未被验证（离线无 key）。接上真实端点后**暴露了实际缺陷**（`C-29`），证明「离线无法验证措辞」这一顾虑是对的，只是方向比预想的严重 |
| **Proposed Resolution** | **已解决**：调优由实测驱动，只改必要处（intent 标注 + 一条硬性规则），未做无依据的措辞重写。后续任何提示词改动都必须同步 bump `prompt_version`、更新 fixture，并对真实端点重跑 `npm run test:llm`（`C-29` 的教训） |

### C-30 — `agent-request` 不携带收件人，调度器无法知道该叫醒谁 🟠 HIGH（**SC-3 必须解决**）

| 项 | 内容 |
| --- | --- |
| **Conflict** | `AgentTrigger` 的 `{ kind: 'agent-request'; fromAgentId: string }` 只给出**发送方**，而 `02-decision-flow.md` §3.3 要的是「A 请求 B ⇒ 触发 **B** 决策」——收件人不在载荷里 |
| **Current Code** | SC-2 按类型原样发射：`command-system.ts` 的 `agentMessage` 分支在消息落到 `agentMessages` 之后 push `{ kind: 'agent-request', fromAgentId: c.from }`。发射点上 `target.id`（收件人）**是已知的**，但类型里没有它的位置 |
| **Approved Design** | `02-domain-model.md` §14 的联合类型即上述形状；`07-scheduler-plan.md` §13.5 决定「不改该类型，寻址放适配器」 |
| **Impact** | 🟠 适配器（SC-3）拿到 `fromAgentId` 后**无法确定收件人**。若用「该发送方最新一条未读消息的 `to`」这类启发式，会在同一 Agent 连发多条请求时挑错，且是一条藏在适配器里的隐式规则 |
| **Proposed Resolution** | **已决议并落地（2026-10-08）：选项 ①**。`src/engine/agent/types.ts` 的 `agent-request` 追加 `toAgentId: string`，`command-system.ts` 发射时填 `target.id`。变更面：该类型**没有** `schemas/*.json` 对应合同（`schemas/` 只覆盖 agent / decision / memory / message / promise / relationship / action-candidate），故不触碰跨工具合同；唯一消费方是同一次提交里的发射点与两个测试，均为纯追加。<br>被否决的：② 适配器按「未读消息」反查——隐式规则藏在适配器里，同一 Agent 连发多条请求时会挑错；③ 推迟到 P3——`agent-request` 现在就能正确发射，没有理由留一个已知错误的形状 |

---

## 2c. Prompt 覆盖审计新增条目（C-31 … C-32）

来源：把外部 playbook 的 Prompt 7（AgentScheduler / event-driven）与仓库实际状态逐条对照，
结论记录在 `docs/lv3/PLAYBOOK_COVERAGE.md`。两条均为**记录性**条目，**未改任何代码**。

### C-31 — playbook 把 Scheduler 划在 P3，仓库已在 P2.5 完成 🟡 MEDIUM

| 项 | 内容 |
| --- | --- |
| **Conflict** | 外部 playbook 的 Prompt 6 §25 逐字写着「不要在 P2 实现 Scheduler …… **真正 Scheduler 在 P3。**」，Prompt 7 §二 也把 `AgentScheduler` 列为 P3 职责；而仓库已把 Scheduler 作为插入阶段 **P2.5** 完成并合入（`07-scheduler-plan.md` SC-1…SC-5 全 ✅） |
| **Current Code** | `electron/agent/scheduler.ts`、`electron/agent-host.ts`、`electron/agent/runtime.ts#applyDecision`、`electron/main.ts` 的接线均已存在并有测试覆盖（`tests/agent/scheduler.test.ts` 等） |
| **Approved Design** | playbook 的分层（Prompt 6 §25、Prompt 7 §二）说 Scheduler 属 P3。**Prompt 7 正文未随仓库进度更新**，仍写着「现在实现 Prompt 2 已批准的 Scheduler」——只在阅读清单里补了 P2.5 的文档 |
| **Impact** | 若下一个会话严格按 playbook 顺序执行 Prompt 7，会**重复实现**一个已存在、且被 `boundary.test.ts` 的 B-2/B-11/B-13 与 `scheduler.test.ts` 的 S-1…S-11 锁死的调度器。这是跨工具（playbook ↔ 仓库）的**流程**冲突，非代码缺陷 |
| **Proposed Resolution** | **不改代码。** 以 `docs/lv3/PLAYBOOK_COVERAGE.md` 为对照事实来源：Prompt 7 的 §四/§五/§六 视为**已由 P2.5 满足**，不重做。后续 Prompt 到达时先查该文件再决定施工范围。若 playbook 之后更新了分层，应同步更新该文件而不是改本条目 |

### C-32 — `Mission offered` 无触发生产者，Admiral 下达指令不唤醒 Agent 🟡 MEDIUM（**需要设计决定**）

| 项 | 内容 |
| --- | --- |
| **Conflict** | Prompt 7 §五 的 MVP 触发清单要求至少支持 `Mission offered`；仓库的 `AgentTrigger`（`src/engine/agent/types.ts:114-131`）**没有任何承载它的变体**，`directive-issued` 类触发不存在 |
| **Current Code** | 触发发射点共 7 处：`engine.ts:141-142`（`directive-completed`/`directive-failed`）、`engine.ts:144` 与 `fleet.ts:158`（`ship-idle`）、`sensors.ts:124-127`（`danger`）、`world-events.ts:55`（`world-event`）、`command-system.ts:617-624`（`admiral-message`/`agent-request`）。**下达指令（`issueDirective`）不产生任何触发**——Agent 只在任务**结算后**（完成/失败）才被叫醒 |
| **Approved Design** | **尚未决定。** `02-domain-model.md` §14 的联合类型里没有该变体；`07-scheduler-plan.md` §3.3 的触发清单也未列它。Prompt 7 提出了要求，但仓库侧从未做过对应的设计决定 |
| **Impact** | 语义上**可能正确**：按 `AGENTS.md`「明确的 Admiral 命令优先于 Standing Orders」，Admiral 下达指令后舰船直接执行，Agent 的"决定做什么"在此时并无决策空间，等到 `directive-completed`/`directive-failed` 再唤醒是合理的。**但也可能不正确**：Agent 无法在接到指令的当刻表达反报价 / 拒绝 / 请求协作者（`interactions.ts` 的 `team-request`/`negotiate` 等 kind 已存在）。**两种解读都有依据，故不做单方面判定** |
| **Proposed Resolution** | **留待显式设计决定**（CLAUDE.md §15：不得静默择一）。若决定支持，最小改法是给 `issueDirective` 的既有分支追加一次 push（与 P2.5 的 7 处同形，**零删除**）；若决定不支持，应在 `PLAYBOOK_COVERAGE.md` 中写明「`Mission offered` 由 `admiral-message` 语义覆盖，不新增变体」并给出理由。**在此之前不要新增触发变体**——P2.5 的边界测试与 `AgentTrigger` 形状是冻结的 |

---

## 3. 实施期需要留意的既有行为（非冲突，但会绊倒实施者）

| # | 行为 | 位置 | 影响 |
| --- | --- | --- | --- |
| N-1 | Agent 只能在舰船**完全空闲**时提交动作 | `command-system.ts:557-558`（有任何 `current`/`queue`/`suspended` 即拒绝） | 调度器必须**延后**而非重试；`availableActions` 在忙碌时应为空。EVT-03/05/08 各是一次独立决策周期，依赖 `directive-completed` 重新触发 |
| N-2 | 非 commander actor 只能 `issueDirective` 且仅限自己那艘舰 | `command-system.ts:159-167` | Agent **不能**下发 `standingOrders`/`setCloak`/`renameEntity` 等。Lv3 的额外通道只有 `agentMessage`（P0-15） |
| N-3 | 渲染进程命令不带 actorId，默认 `'commander'` | `main.ts:131` | 运行时必须**显式**传 `operatorId`（经 port 天然满足），**绝不可**以 commander 身份提交 |
| N-4 | `SimulationEngine` 构造用 `structuredClone` | `engine.ts:29` | Agent 数据必须是纯 JSON（无 `Date`、无类实例），否则克隆与序列化都会坏 |
| N-5 | 存档上限 32MB；`SaveStore.write` 先 `worldSchema.parse` | `persistence.ts:34,180` | 所有 Agent 侧集合必须有界（memories 40 / promises 20 / messages 200 / interactions 200），且淘汰必须确定性 |
| N-6 | `SimulationEvent` 只把 `shipTransited` 透给 UI | `main.ts:193-195` | Agent 的对外发言需**同时**写一条既有 `Communication`，否则 UI 看不到 |
| N-7 | 隐藏状态白名单在 `snapshot()` 内 | `projection.ts:59-198` | `AgentObservation` 必须在它之上裁剪。**新增风险**：memory 的 `text` 是新的泄漏向量，`recon.test.ts:365` 的隐私断言必须继续通过 |
| N-8 | `TRANSIT` 候选要求虫洞已 `discovered` | `command-system.ts:64-65` | P0-11 生成候选前必须校验，否则 Agent 会挑到一个 `validateAction` 必拒的动作 |
| N-9 | `main.ts:173-177` 的 `saveBlocked` 只覆盖 `advanceFrame` | `main.ts:165-196` | 调度器必须自带 `try/catch`，provider 异常不得把世界标成 `saveBlocked` |

---

## 4. 已知的既存测试不稳定（与本阶段无关，勿误判）

来源：`docs/lv3/00-test-baseline.md`。`npm run test:e2e`（8 spec / 36 用例）有 **2 项既存失败**，均非引擎缺陷：

| 用例 | 现象 | 判定 |
| --- | --- | --- |
| `tests/e2e/mine-accidents.spec.ts:48` | Windows 文件锁竞争（flaky） | 环境相关，非引擎缺陷 |
| `tests/e2e/mine-accidents.spec.ts:130` | 超时 15.000s vs 需求约 15.38s | 阈值问题，非引擎缺陷 |

另有一个**环境坑**：shell 中若存在 `ELECTRON_RUN_AS_NODE=1`，全部 36 项 E2E 会以 `bad option` 失败。运行前须 `env -u ELECTRON_RUN_AS_NODE npm run test:e2e`；且**不要**把输出管道给 `tail`，否则真实退出码会被吞掉。

本阶段（Prompt 3）**未运行 E2E**，见 `CLAUDE_TO_CODEX.md` 的验证记录。
