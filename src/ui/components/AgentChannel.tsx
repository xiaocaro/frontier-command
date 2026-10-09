/**
 * The Admiral's channel to the Agents (docs/lv3/10-agent-demo-channel.md).
 *
 * Two things this exists for, both of which were impossible before it:
 *
 *  1. **Sending.** Every command-sending control in the console issues an `issueDirective`. There was
 *     no way for a player to say anything *to an Agent* — no offer, no negotiation, no promise, no
 *     Override — so the MVP's central loop could only be driven from the test harness.
 *  2. **Seeing.** `snapshot()` carries no Agent state, so trust, morale, goals, promises and the
 *     memory tags that distinguish Path A from Path B were invisible. The MVP asks "did my earlier
 *     decision change how much he trusts me?" and there was nowhere to look.
 *
 * **Read-only, deliberately.** Nothing here writes: every action is a `Command` the engine validates
 * (CLAUDE.md §2.1). The roster is a snapshot from `agents:get`, not a handle on the world.
 *
 * Collapsed by default. The console's geometry is asserted at six window sizes by
 * `tests/e2e/lcars.spec.ts`, so a panel that is only needed while demonstrating should cost about one
 * line when it is not.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  AgentChannelView,
  AgentLoopStats,
  AgentTranscriptEntry,
  RosterAgent,
} from '../../engine/agent/roster';
import type { CommandSender } from '../types';
import { LcarsButton, LcarsTextBar } from './Lcars';

const CAREER_LABELS: Record<string, string> = {
  explorer: '探索',
  scientist: '科学',
  tactical: '战术',
  logistics: '后勤',
};

/** The message kinds the MVP needs. `ENCOURAGE` is deferred (`02-mvp-traceability.md` §1). */
const KINDS = ['command', 'ask', 'negotiate', 'override'] as const;
type Kind = (typeof KINDS)[number];

/** Only `override` needs a payload — the action the Admiral is forcing. */
const OVERRIDE_ACTIONS = ['TRANSIT', 'SURVEY', 'EXPLORE', 'RETURN', 'ESCORT'] as const;

const PROMISE_TEXT = '完成这次任务后，我给你一次 Deep Scan 优先权限。';

/**
 * `commanderName` is the sender's name as the **engine** spells it (`commander.name`), passed in rather
 * than invented here so the prefix above the box matches the line the engine writes into the feed.
 *
 * `revision` is any number that changes when the world does — the shell passes the length of the
 * Communications feed, and every Agent message adds exactly one mirrored line to it. The panel only
 * fetches while it is open, so without this a reply that arrived after opening would never appear
 * until someone pressed 刷新.
 */
export function AgentChannel({
  command,
  commanderName,
  revision,
}: {
  command: CommandSender;
  commanderName: string;
  revision: number;
}) {
  const [open, setOpen] = useState(false);
  const [roster, setRoster] = useState<RosterAgent[]>([]);
  const [messages, setMessages] = useState<AgentTranscriptEntry[]>([]);
  const [stats, setStats] = useState<AgentLoopStats>({ decisions: 0, modelCalls: 0, dropped: 0, lastDrop: null });
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [target, setTarget] = useState('');
  const [kind, setKind] = useState<Kind>('command');
  const [overrideAction, setOverrideAction] = useState<string>('TRANSIT');
  const [text, setText] = useState('穿越虫洞，寻找失联探测船。');

  const recipientName = roster.find((agent) => agent.id === target)?.name ?? null;

  const refresh = useCallback(async () => {
    const api = window.frontier?.agents;
    if (!api) {
      setError('本构建没有 agents 通道（preload 未更新？）');
      return;
    }
    try {
      const next: AgentChannelView = await api();
      setRoster(next.agents);
      setStats(next.stats);
      setSpeed(next.speed);
      setMessages(next.messages);
      setTarget((current) => current || (next.agents[0]?.id ?? ''));
      setError(null);
    } catch (failure) {
      setError(String(failure));
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, revision, refresh]);

  const send = async () => {
    if (!target) return;
    const result = await command(
      {
        type: 'agentMessage',
        from: 'admiral',
        to: target,
        kind,
        text,
        payload: kind === 'override' ? { directiveActionType: overrideAction } : null,
      },
      true,
    );
    setNote(result.ok ? '已发出 · ' + kind : '被拒：' + result.reason);
    // Clear the box on success so the next message starts from empty. Deliberately NOT cleared on a
    // refusal: the text is still the thing you want, and retyping it to fix one word would be worse
    // than being told why it was refused.
    if (result.ok) setText('');
    await refresh();
  };

  /**
   * A promise is **two** commands, and the id in the middle is the reason.
   *
   * `agentMessage{kind:'promise'}` carries a bare `promiseId` and has nowhere to put the `fulfills`
   * condition, so it cannot create the promise — `agentEvent{promise-made}` does, and the engine mints
   * the id. So: create, read the id back from the roster, then tell the Agent. If the second step
   * fails the promise still exists, and the panel says so rather than pretending otherwise.
   */
  const promiseDeepScan = async () => {
    if (!target) return;
    const made = await command(
      {
        type: 'agentEvent',
        event: {
          kind: 'promise-made',
          toAgentId: target,
          promiseType: 'equipment',
          description: 'Deep Scan 优先权限',
          fulfills: { kind: 'grant-module', key: 'deepScan' },
        },
      },
      true,
    );
    if (!made.ok) {
      setNote('承诺创建被拒：' + made.reason);
      return;
    }
    const after = await window.frontier.agents();
    const promise = after.agents.find((agent) => agent.id === target)?.promises.at(-1);
    if (!promise) {
      setNote('承诺已创建，但读不回 id —— 未向 Agent 发出通知');
      await refresh();
      return;
    }
    const told = await command(
      { type: 'agentMessage', from: 'admiral', to: target, kind: 'promise', text: PROMISE_TEXT, payload: { promiseId: promise.id } },
      true,
    );
    setNote(told.ok ? '承诺已创建，并已通知' : '承诺已创建，但通知被拒：' + told.reason);
    await refresh();
  };

  /**
   * The selected Agent's correspondence, **newest first**.
   *
   * The reversal is the whole point of the feature: an answer is always a later message than the
   * message it answers, so newest-first puts it *above* its trigger. Nothing pairs them — there is no
   * reply-to id in the message model, and `consumeAnswered` was deliberately left blunt — the order
   * is the only link, which is what the Communications feed relies on too.
   */
  const thread = (target ? messages.filter((m) => m.from === target || m.to === target) : [])
    .slice()
    .reverse();

  return (
    <details className="agent-channel" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        AGENT CHANNEL · 舰桥通讯
        {roster.length > 0 && <span className="agent-count">{roster.length}</span>}
      </summary>
      <div className="agent-channel-body">
        {error && <p className="muted">{error}</p>}
        {/* C-36: the loop's own tally. `dropped` is the number that used to be invisible — a stale
            decision writes one info line into the world log, and nothing renders that log. */}
        <p className="agent-loop">
          本局决策 <b>{stats.decisions}</b> 次，其中 <b>{stats.modelCalls}</b> 次由模型作答 · 过期丢弃{' '}
          <b>{stats.dropped}</b> 次
        </p>
        {stats.dropped > 0 && (
          <p className="agent-alert">
            ⚠ 有决策因过期被丢弃
            {stats.lastDrop ? '（最近一次迟 ' + stats.lastDrop.ageTicks + ' / 上限 ' + stats.lastDrop.limit + '）' : ''}
            {speed > 1
              ? '。当前 ' + speed + '× 加速会让世界在模型思考期间跑得很远——降到 1× 可减少丢弃。'
              : '。世界在模型思考期间前进得比它的答案能追赶的更多。'}
          </p>
        )}
        {!error && roster.length === 0 && <p className="muted">尚未读取</p>}
        {roster.map((agent) => (
          <div key={agent.id} className={'agent-row' + (agent.id === target ? ' is-selected' : '')}>
            <LcarsButton
              shape="text"
              sound="navigation"
              className="agent-pick"
              aria-pressed={agent.id === target}
              onClick={() => setTarget(agent.id)}
            >
              <b>{agent.name}</b>
              <span>{CAREER_LABELS[agent.career] ?? agent.career}</span>
            </LcarsButton>
            <span className="agent-stats">
              信任 <b>{Math.round(agent.state.trustInAdmiral)}</b> · 士气{' '}
              <b>{Math.round(agent.state.morale)}</b> · 目标 <b>{Math.round(agent.goal.progress)}</b>
              {agent.promises.some((p) => p.status === 'pending') && <em> · 有未兑现承诺</em>}
            </span>
            {/* Tags only — the roster view withholds memory text on purpose (N-7). The tag is what
                distinguishes a kept promise from an Override, which is the whole point of showing it. */}
            <span className="agent-memory">
              {agent.memories
                .flatMap((memory) => memory.tags)
                .slice(0, 4)
                .join(' · ') || '（无标注记忆）'}
            </span>
          </div>
        ))}

        {/*
          What was asked and what came back, newest first — see `thread`. Deliberately rendered with
          the **same arrow convention as the feed** (`command-system.ts`, N-6): the arrow points away
          from the speaker, so `LYRA VOSS ← Dawn Frontier Command：` here is the same sentence as the
          mirrored line there, rather than a second rendering free to drift from it.
        */}
        {thread.length > 0 && (
          <div className="agent-thread">
            {thread.map((message) => (
              <p
                key={message.id}
                className={'agent-line ' + (message.from === 'admiral' ? 'is-sent' : 'is-reply')}
              >
                <span>
                  {message.from === 'admiral'
                    ? message.fromName + ' → ' + message.toName + '：'
                    : message.toName + ' ← ' + message.fromName + '：'}
                </span>
                {message.text}
              </p>
            ))}
          </div>
        )}

        <div className="agent-compose">
          <label>
            类型
            <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {KINDS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          {kind === 'override' && (
            <label>
              强制执行
              <select value={overrideAction} onChange={(e) => setOverrideAction(e.target.value)}>
                {OVERRIDE_ACTIONS.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </select>
            </label>
          )}
          {/*
            Who is speaking to whom, spelled out — the same prefix the engine will put on the line
            when it mirrors this message into the Communications feed (`command-system.ts`, N-6). It
            is built from the same two names the engine uses (`commander.name` and the target Agent's
            name), so what you read here is literally what appears there.

            It sits immediately before the box so the input reads as the rest of that sentence, and it
            exists **only while there is something to send**: sending clears the text, and the prefix
            leaves with it rather than sitting there labelling an empty box.
          */}
          {text.trim().length > 0 && (
            <span className="agent-prefix">
              {commanderName} → {recipientName ?? '（未选择 Agent）'}：
            </span>
          )}
          <input
            aria-label="发往 Agent 的消息"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={800}
          />
          <LcarsButton sound="navigation" disabled={!target} onClick={() => void send()}>
            发送
          </LcarsButton>
          <LcarsButton tone="secondary" sound="navigation" disabled={!target} onClick={() => void promiseDeepScan()}>
            承诺 Deep Scan 优先权限
          </LcarsButton>
          <LcarsButton tone="secondary" sound="navigation" onClick={() => void refresh()}>
            刷新
          </LcarsButton>
        </div>
        {note && <p className="muted">{note}</p>}
        <LcarsTextBar className="agent-hint">
          只读视图 · 一切变更仍经引擎校验；记忆只显示标注（tag），不显示文本
        </LcarsTextBar>
      </div>
    </details>
  );
}
