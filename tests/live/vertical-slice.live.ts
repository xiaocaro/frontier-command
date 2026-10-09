/**
 * `npm run demo:live` — the MVP runbook, driven by a real model (docs/lv3/10-agent-demo-channel.md §4).
 *
 * Runs only under `vitest.live.config.ts`, never under `npm test`. Two reasons that matter:
 *
 *  1. It calls a real endpoint. `npm test` must stay free of the network.
 *  2. **It asserts nothing about which answer the model gives.** `02-mvp-traceability.md` §1 marks Live
 *     LLM as "人工演示，**不参与回归断言**", and playbook §三十二 forbids treating "DeepSeek must answer
 *     COUNTEROFFER here" as a stable condition.
 *
 * **Each model step runs on its own fresh world** (a vignette), and that is not tidiness — it is what a
 * real model forces. Measured: on the first run the Explorer chose `act` (it went to the wormhole)
 * rather than answering, which left its ship busy and every later step deferred. A continuous
 * playthrough is what the *human* runbook is for; here each step is isolated so one surprising choice
 * cannot silently swallow the rest, and every step prints **both** what the model said and what the
 * deterministic fallback would have said.
 *
 * Output goes through `process.stdout.write`, not `console.log`: vitest buffers console output through
 * its reporter, and a demonstration whose transcript can be swallowed by a reporter flag is not a
 * demonstration.
 */
import { test, expect } from 'vitest';
import { SimulationEngine } from '../../src/engine/engine';
import { createWorld } from '../../src/engine/data';
import { HOST_FRAME_MS } from '../../src/engine/clock';
import { AgentHost } from '../../electron/agent-host';
import { deepSeekConfigFromEnv, describeDeepSeekConfig } from '../../electron/agent/openai-compatible';
import { fallbackDecision } from '../../src/engine/agent/decision';
import { scoringAgent } from '../../electron/agent/runtime';
import type { Agent } from '../../src/engine/types';
import type { DecisionTrace } from '../../electron/agent/runtime';
import {
  REPO_ROOT,
  agentByCareer,
  agentShipOf,
  observationFor,
  requestTeamUp,
} from '../agent/support';

/**
 * The simulation speed this run emulates (`--speed=16`, via `scripts/demo-live.mjs`).
 *
 * It is the whole point of the switch (`KNOWN_ISSUES.md` `C-36`): the staleness window is one decision
 * interval of **real** time, so at 1× it is 15s, and at 16× the world covers 16× as many game minutes in
 * the same wall clock. Before the window was scaled, 16× gave the model 0.94s and every answer was
 * thrown away. Running the demo at 16× is the end-to-end check that it no longer is.
 */
const SPEED = Number(process.env.DEMO_SPEED ?? '1');

const say = (line = '') => process.stdout.write(line + '\n');
const head = (title: string) => say('\n── ' + title + ' ' + '─'.repeat(Math.max(0, 52 - title.length)));

const CAREER: Record<string, string> = {
  explorer: '探索',
  scientist: '科学',
  tactical: '战术',
  logistics: '后勤',
};

const byId = (engine: SimulationEngine, id: string): Agent =>
  engine.state.agents.find((agent) => agent.id === id)!;

const tagsOf = (agent: Agent): string[] =>
  agent.memories.flatMap((memory) => (memory.kind === 'episodic' ? memory.tags : []));

interface Vignette {
  engine: SimulationEngine;
  host: AgentHost;
  traces: DecisionTrace[];
  explorer: Agent;
  tactical: Agent;
}

/** A fresh world with the real provider behind it — no `env`, so it reads the real environment. */
function vignette(seed = 236807): Vignette {
  const engine = new SimulationEngine(createWorld(seed));
  engine.state.enemies = []; // a quiet frontier, so the demo is about the Agents
  // Demo scaffolding, labelled as such: clear the standing orders a fresh world starts with, so an
  // Agent is idle and can decide immediately. Otherwise every step first waits out a routine haul.
  for (const ship of engine.state.ships) {
    ship.current = null;
    ship.queue = [];
    ship.suspended = [];
  }
  // Through the player's own command, so the demo runs the path the game does.
  engine.dispatchCommand({ type: 'speed', speed: SPEED as 1 | 4 | 16 });
  const traces: DecisionTrace[] = [];
  const host = new AgentHost(engine, { root: REPO_ROOT, onTrace: (trace) => traces.push(trace) });
  return {
    engine,
    host,
    traces,
    explorer: agentByCareer(engine, 'explorer'),
    tactical: agentByCareer(engine, 'tactical'),
  };
}


const PACE_MS = HOST_FRAME_MS;

async function beat(v: Vignette, done: () => boolean, frames = 240) {
  for (let i = 0; i < frames; i++) {
    v.engine.dispatchCommand({ type: 'pause', paused: false });
    // `advanceFrame`, not `step`: it runs `state.speed` steps per call, which is exactly what the real
    // host does every `HOST_FRAME_MS`. Advancing one step per frame would not be 16× whatever the
    // speed said, and the C-36 question is precisely about the real rate.
    v.host.frame(v.engine.advanceFrame());
    // **Paced at the real host rate**, and this is load-bearing rather than tidiness.
    //
    // A decision is discarded when more than `STALE_TICK_LIMIT` (= 15 game minutes = 150 ticks) pass
    // between the observation and the drain. An unpaced loop burns hundreds of game minutes during a
    // model call that takes a few seconds of wall clock — so every answer came back stale and was
    // thrown away, which read in the transcript as "the model said accept but nothing happened".
    // Pacing at `HOST_FRAME_MS` is what makes the speed setting mean anything: the world then advances
    // at `speed` game minutes per second, exactly as it does in the game.
    await new Promise((resolve) => setTimeout(resolve, PACE_MS));
    if (done()) return true;
  }
  return false;
}

/**
 * A fixed number of frames, for letting the engine finish something that is already in flight.
 *
 * Needed because a settlement fact travels one hop further than the command that caused it: the reply
 * lands in `agentMessages`, the engine pushes `team-resolved` onto `pendingEvents`, and the **host**
 * applies it on a later frame. Reading the relationship straight after the reply sees the state before
 * the settlement — which the first version of this did, and printed "关系值 0 → 0".
 */
async function run(v: Vignette, frames: number) {
  await beat(v, () => false, frames);
}

/** The Admiral speaks — as a command, so the engine emits the trigger that wakes the Agent. */
function admiral(engine: SimulationEngine, to: string, kind: 'command' | 'negotiate', text: string) {
  const result = engine.dispatchCommand({
    type: 'agentMessage',
    from: 'admiral',
    to,
    kind,
    text,
    payload: null,
  });
  expect(result.ok).toBe(true);
}

const lastReply = (v: Vignette, agentId: string) =>
  v.engine.state.agentMessages.filter((message) => message.from === agentId).at(-1) ?? null;

/**
 * What was decided this step, and what the Agent *said*. Never asserts which — a model that goes to
 * the wormhole instead of answering is a result, not a failure.
 *
 * It lists **every** decision the step produced rather than the last one. Pairing "the last decision"
 * with "the last thing the Agent said" is wrong and the first version of this did exactly that: over a
 * step the Agent decides several times, so the newest trace is usually a *later* beat than the reply
 * being shown, and the transcript read as though one had caused the other.
 */
function report(v: Vignette, agent: Agent, since: number) {
  // Only this Agent's decisions. The scheduler runs for the whole roster, so unfiltered traces mix in
  // other Agents' choices — the first version printed a *tactical*'s reasoning under the explorer's step.
  const fresh = v.traces.slice(since).filter((trace) => trace.agentId === agent.id);
  const decided = fresh.filter((trace) => trace.decision !== null);
  say(
    '  本步决策 ' + fresh.length + ' 次：成功 ' +
      fresh.filter((t) => t.outcome === 'provider').length + '，回退 ' +
      fresh.filter((t) => t.outcome === 'fallback').length,
  );
  for (const trace of decided)
    say(
      '    · ' +
        (trace.outcome === 'provider' ? '模型' : '回退') +
        ' → ' +
        trace.decision!.intent +
        (trace.decision!.choiceId ? ' / ' + trace.decision!.choiceId : '') +
        '   「' + trace.decision!.reason.slice(0, 80) + '」',
    );

  const reply = lastReply(v, agent.id);
  // Label the speaker explicitly: the runbook's earlier form put the name in front of a colon and
  // was easy to skim past, and this transcript is read by someone who was not watching.
  if (reply) say('  说话人：' + agent.name + '（本步最近一次发言）｜' + reply.text);
  else {
    say('  ⚠ 到这一步为止该 Agent 没有发过言——真模型常常直接下令（`act`），而不是回话。');
    const ship = v.engine.state.ships.find((s) => s.id === agentShipOf(v.engine, agent));
    if (ship?.current)
      say('     ' + ship.name + ' 正在执行：' + ship.current.action.type + '（舰船忙碌，后续决策会被延后）');
  }

  // Always show the deterministic answer too, so the transcript holds a complete path whatever the
  // model did. Same observation, no model.
  const observation = observationFor(v.engine, agent.id);
  const deterministic = fallbackDecision(scoringAgent(observation), observation);
  say(
    '  以**此刻**状态计算，无模型时确定性回退会答：' +
      deterministic.intent +
      ' / ' +
      (deterministic.choiceId ?? '-'),
  );
}

test('the MVP runbook, driven by the real model', async () => {
  const config = deepSeekConfigFromEnv();
  if (!config) {
    throw new Error(
      '没有 DEEPSEEK_API_KEY。演示需要真实模型；给法见 docs/lv3/10-agent-demo-channel.md §4：\n' +
        "  PowerShell:  $env:DEEPSEEK_API_KEY='sk-...'; npm run demo:live\n" +
        '  Git Bash:    DEEPSEEK_API_KEY=sk-... npm run demo:live   （= 后不要有空格）',
    );
  }

  const started = Date.now();
  const all: DecisionTrace[] = [];
  const v = vignette();

  say('\n════════ MVP 演示 · 真实模型 ════════');
  say('模型配置：' + JSON.stringify(describeDeepSeekConfig(config)));
  say('仿真速度：' + SPEED + '×');
  say('（密钥只以布尔出现；下面任何一行都不会包含它。）');
  say(
    '世界：' +
      v.engine.state.agents
        .map((a) => a.name + '(' + (CAREER[a.career] ?? a.career) + ')')
        .join('、'),
  );

  const OFFER = '穿越虫洞，寻找失联探测船，确认发生了什么。';
  const ASK = '又出现一个高风险调查机会，你去不去？';

  head('第 1–2 步 · Admiral 发布任务，Agent 自主评估');
  admiral(v.engine, v.explorer.id, 'command', OFFER);
  say('Admiral → ' + v.explorer.name + '：' + OFFER);
  let since = v.traces.length;
  await beat(v, () => lastReply(v, v.explorer.id) !== null);
  report(v, v.explorer, since);

  head('第 3 步 · 换一种问法（同一 Agent，不同问题）');
  admiral(v.engine, v.explorer.id, 'negotiate', '如果装备不足，你希望我提供什么？');
  since = v.traces.length;
  await beat(v, () => v.engine.state.agentMessages.filter((m) => m.from === v.explorer.id).length >= 2);
  report(v, v.explorer, since);

  head('第 4 步 · Agent-Agent：Tactical 收到组队请求');
  say('  ⚠ 保真度：这条 team-request 由演示**注入**（模拟 Explorer 发出），');
  say('    因为要看的是 Tactical 的答复，不是 Explorer 会不会想到要护航。');
  const t0 = vignette();
  requestTeamUp(t0.engine, t0.explorer.id, t0.tactical.id);
  const before = t0.tactical.relationships.find((r) => r.targetAgentId === t0.explorer.id)!.value;
  since = t0.traces.length;
  await beat(t0, () => lastReply(t0, t0.tactical.id) !== null);
  report(t0, t0.tactical, since);
  // The reply makes the engine emit `team-resolved`; the **host** applies it on a later frame, so the
  // relationship must be read after letting those frames run.
  await run(t0, 6);
  const after = byId(t0.engine, t0.tactical.id).relationships.find(
    (r) => r.targetAgentId === t0.explorer.id,
  )!.value;
  say('  关系值 ' + before + ' → ' + after + '（双方一起变，`teamUp` 一次调用改两条记录）');

  // ── 第 5–8 步：两条历史。这两步**不依赖模型**——历史由命令造成，正是为了让对照可复现 ─────────────
  /** Path A: the Admiral promises, then actually delivers — a real REFIT on a real hull. */
  const pathA = async () => {
    const a = vignette();
    head('第 5 步 · Path A · Admiral 承诺 Deep Scan 优先权限');
    a.engine.dispatchCommand({
      type: 'agentEvent',
      event: {
        kind: 'promise-made',
        toAgentId: a.explorer.id,
        promiseType: 'equipment',
        description: 'Deep Scan 优先权限',
        fulfills: { kind: 'grant-module', key: 'deepScan' },
      },
    });
    const promise = byId(a.engine, a.explorer.id).promises.at(-1)!;
    say('  承诺已创建：status=' + promise.status + ' resolvedAt=' + promise.resolvedAt);
    say('  fulfills=' + JSON.stringify(promise.fulfills));

    head('第 6 步 · Path A · 兑现：真跑一次 REFIT（由**另一艘**舰执行）');
    const base = a.engine.state.locations.find((l) => l.owner === 'starfleet' && l.hull > 0)!;
    a.engine.state.resources.credits = 10_000;
    base.stock.materials = 1_000;
    base.stock.specialFinds = 10;
    const flownBy = a.engine.state.ships.find((s) => s.id !== agentShipOf(a.engine, a.explorer))!;
    const trustBefore = byId(a.engine, a.explorer.id).state.trustInAdmiral;
    a.engine.dispatchCommand({
      type: 'issueDirective',
      shipIds: [flownBy.id],
      mode: 'REPLACE',
      action: { type: 'REFIT', targetId: base.id, moduleId: 'deepScan', remove: false },
    });
    await beat(a, () => byId(a.engine, a.explorer.id).promises.at(-1)!.status === 'fulfilled', 900);
    const settled = byId(a.engine, a.explorer.id);
    say('  ' + flownBy.name + ' 装上 deepScan：' + flownBy.modules.includes('deepScan'));
    say('  承诺 → ' + settled.promises.at(-1)!.status + '（引擎自己判定的，不是脚本改的）');
    say('  信任 ' + trustBefore + ' → ' + settled.state.trustInAdmiral);
    say('  记忆标注：' + tagsOf(settled).filter((tag) => tag.startsWith('promise')).join('、'));
    return a;
  };

  /** Path B: the Admiral forces it. A real Override command — the same one the panel sends. */
  const pathB = () => {
    const b = vignette();
    head('第 7 步 · Path B · Admiral Override（另起一局）');
    const trustBefore = byId(b.engine, b.explorer.id).state.trustInAdmiral;
    const moraleBefore = byId(b.engine, b.explorer.id).state.morale;
    b.engine.dispatchCommand({
      type: 'agentMessage',
      from: 'admiral',
      to: b.explorer.id,
      kind: 'override',
      text: '这是命令，继续执行。',
      payload: { directiveActionType: 'RETURN' },
    });
    const afterOverride = byId(b.engine, b.explorer.id);
    say('  信任 ' + trustBefore + ' → ' + afterOverride.state.trustInAdmiral);
    say('  士气 ' + moraleBefore + ' → ' + afterOverride.state.morale);
    say('  记忆标注：' + tagsOf(afterOverride).filter((tag) => tag.startsWith('admiral')).join('、'));
    return b;
  };

  const a = await pathA();
  const b = pathB();

  head('第 8 步 · 同一名 Agent、同一个新问题 —— 历史不同');
  say('  问题：' + ASK);
  const answer = async (side: Vignette) => {
    const start = side.traces.length;
    admiral(side.engine, side.explorer.id, 'command', ASK);
    await beat(side, () => lastReply(side, side.explorer.id) !== null);
    const reply = lastReply(side, side.explorer.id);
    const mine = side.traces.slice(start).filter((t) => t.agentId === side.explorer.id);
    const ship = side.engine.state.ships.find((s) => s.id === agentShipOf(side.engine, side.explorer));
    return {
      trust: byId(side.engine, side.explorer.id).state.trustInAdmiral,
      decisions: mine.length,
      model: mine.at(-1)?.decision
        ? mine.at(-1)!.decision!.intent + ' / ' + (mine.at(-1)!.decision!.choiceId ?? '-')
        : '(本步没有决策)',
      said:
        reply?.text ??
        '(没有回复)' +
          (ship?.current ? '——它的舰正在执行 ' + ship.current.action.type + '，忙碌期间不决策' : ''),
    };
  };
  const kept = await answer(a);
  const forced = await answer(b);
  say('  Path A（承诺已兑现）  信任 ' + kept.trust + '，本步决策 ' + kept.decisions + ' 次 → ' + kept.model);
  say('    说话人：' + a.explorer.name + '｜' + kept.said);
  say('  Path B（被强制过）    信任 ' + forced.trust + '，本步决策 ' + forced.decisions + ' 次 → ' + forced.model);
  say('    说话人：' + b.explorer.name + '｜' + forced.said);
  say('');
  say('  ↑ 两条**打印**出来供你判断，本脚本**不断言**它们不同。真模型下可能相同——');
  say('    那本身是结果。确定性路径下它们**确实**不同，那一条由');
  say('    tests/agent/vertical-slice.test.ts 断言（无提供方、走真实 host）。');

  // ── 只断言与模型无关的事实 ──────────────────────────────────────────────────────────────────
  expect(byId(a.engine, a.explorer.id).promises.at(-1)!.status).toBe('fulfilled');
  expect(tagsOf(byId(a.engine, a.explorer.id))).toContain('promise-kept');
  expect(tagsOf(byId(b.engine, b.explorer.id))).toContain('admiral-override');
  expect(kept.trust).toBeGreaterThan(forced.trust);

  for (const { traces } of [v, t0, a, b]) all.push(...traces);
  const fromProvider = all.filter((t) => t.outcome === 'provider').length;
  head('汇总');
  // The drop count comes from the host, not from the traces. A decision dropped as stale is dropped by
  // the **scheduler**, which writes a log line and no trace — the runtime-level `discarded` outcome is
  // unreachable in production (`C-37`), so counting traces here would always print zero.
  const hostStats = [v, t0, a, b].map((side) => side.host.stats());
  const decisions = hostStats.reduce((sum, stat) => sum + stat.decisions, 0);
  const dropped = hostStats.reduce((sum, stat) => sum + stat.dropped, 0);
  const fellBack = all.filter((t) => t.outcome === 'fallback').length;
  say('模型调用 ' + all.length + ' 次：成功 ' + fromProvider + '，回退 ' + fellBack);
  say('宿主计数：决策 ' + decisions + ' 次，因过期丢弃 ' + dropped + ' 次');
  say('耗时 ' + ((Date.now() - started) / 1000).toFixed(1) + 's');
  say('');
  if (SPEED > 1) {
    say('C-36 检验（' + SPEED + '×）：' + (dropped === 0
      ? '模型作答仍然落地 ✅ —— 窗口缩放生效。'
      : '仍有 ' + dropped + ' 次被丢 ❌ —— 本次作答迟于窗口。'));
    say('  窗口是"一个决策间隔的**真实**时间"，与速度无关，约 15 秒。未缩放前 ' + SPEED + '× 只给模型 ' +
      (15 / SPEED).toFixed(2) + 's，几乎必然被丢。');
    say('  注：这一条是**实测**，不是断言——真模型延迟会波动，偶尔的丢弃并不等于缩放失效。');
  }
  say('回退次数不为 0 是正常的：引擎遇回退就走确定性分档，世界照常前进。');
  say('这正是 C-33 那类"静默"要防的东西，所以这里把它显式打出来。');
}, 20 * 60_000);
