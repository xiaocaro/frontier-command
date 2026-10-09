/**
 * The Admiral's read-only Agent view (docs/lv3/10-agent-demo-channel.md).
 *
 * This view is an **amplifier**: it carries Agent state to the renderer, where before P3 nothing did.
 * So the crop is the thing under test, not the plumbing — `N-7` warns that memory text is the leak
 * vector, and a comment claiming the crop happened is not evidence.
 */
import { describe, it, expect } from 'vitest';
import { quietEngine, run } from '../helpers';
import {
  agentRosterView,
  agentTranscriptView,
  ROSTER_MEMORY_LIMIT,
  TRANSCRIPT_LIMIT,
} from '../../src/engine/agent/roster';
import { agentByCareer, patchAgent } from './support';
import { episodicMemory, remember } from '../../src/engine/agent/memory';
import type { Command } from '../../src/engine/types';

describe('the roster view is cropped on purpose', () => {
  it('carries the state a player needs to see, for every Agent', () => {
    const engine = quietEngine();
    const roster = agentRosterView(engine.state);

    expect(roster).toHaveLength(4);
    expect(roster.map((agent) => agent.career).sort()).toEqual([
      'explorer',
      'logistics',
      'scientist',
      'tactical',
    ]);
    for (const agent of roster) {
      expect(typeof agent.state.trustInAdmiral).toBe('number');
      expect(typeof agent.state.morale).toBe('number');
      expect(typeof agent.goal.progress).toBe('number');
      expect(agent.relationships.length).toBeGreaterThan(0);
    }
  });

  it('never carries memory text', () => {
    const engine = quietEngine();
    const explorer = agentByCareer(engine, 'explorer');
    const SECRET = '在未测绘的 K-9 星云里发现了什么';
    patchAgent(engine, explorer.id, (agent) => ({
      ...agent,
      memories: remember(
        agent.memories,
        episodicMemory({ id: 'm-secret', at: 3, text: SECRET, tags: ['discovery'] }),
      ),
    }));

    const view = agentRosterView(engine.state).find((agent) => agent.id === explorer.id)!;
    // The tag is the evidence the demo needs, and it is the only part that goes out.
    expect(view.memories.some((memory) => memory.tags.includes('discovery'))).toBe(true);
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain(SECRET);
    expect(serialised).not.toContain('text');
  });

  it('hides the scheduler stamp, which is machinery rather than character', () => {
    const engine = quietEngine();
    expect(JSON.stringify(agentRosterView(engine.state))).not.toContain('nextDecisionAt');
  });

  it('bounds the memories it shows, most important first', () => {
    const engine = quietEngine();
    const explorer = agentByCareer(engine, 'explorer');
    patchAgent(engine, explorer.id, (agent) => {
      let memories = agent.memories;
      for (let i = 0; i < 20; i++)
        memories = remember(
          memories,
          episodicMemory({ id: 'm' + i, at: i, text: 'x', tags: ['risk-taken'], weight: i }),
        );
      return { ...agent, memories };
    });

    const view = agentRosterView(engine.state).find((agent) => agent.id === explorer.id)!;
    expect(view.memories).toHaveLength(ROSTER_MEMORY_LIMIT);
    // Weights descend — the same ordering a decision sees, not an arbitrary window.
    expect(view.memories.map((memory) => memory.weight)).toEqual(
      [...view.memories.map((memory) => memory.weight)].sort((a, b) => b - a),
    );
  });

  it('shows promises and relationships, which is how Path A and Path B become visible', () => {
    const engine = quietEngine();
    const explorer = agentByCareer(engine, 'explorer');
    engine.dispatchCommand({
      type: 'agentEvent',
      event: {
        kind: 'promise-made',
        toAgentId: explorer.id,
        promiseType: 'equipment',
        description: 'Deep Scan 优先权限',
        fulfills: { kind: 'grant-module', key: 'deepScan' },
      },
    });

    const view = agentRosterView(engine.state).find((agent) => agent.id === explorer.id)!;
    expect(view.promises).toHaveLength(1);
    expect(view.promises[0]).toMatchObject({ status: 'pending', description: 'Deep Scan 优先权限' });
  });

  it('is a snapshot, not a live handle — mutating the view cannot reach the world', () => {
    const engine = quietEngine();
    run(engine, 1);
    const view = agentRosterView(engine.state);
    const before = JSON.stringify(engine.state.agents);
    view[0].state.trustInAdmiral = 0;
    view[0].relationships.length = 0;
    expect(JSON.stringify(engine.state.agents)).toBe(before);
  });
});

/** A message as the engine receives it. `actorId` is the sender, and must be omitted for the Admiral. */
function speak(
  engine: ReturnType<typeof quietEngine>,
  from: string,
  to: string,
  kind: 'command' | 'report' | 'team-request' | 'promise',
  text: string,
  payload: unknown = null,
) {
  return engine.dispatchCommand(
    { type: 'agentMessage', from, to, kind, text, payload } as Command,
    from === 'admiral' ? undefined : from,
  );
}

describe('the transcript view is the Admiral’s own correspondence', () => {
  it('carries both sides of a conversation, oldest first, with names resolved', () => {
    const engine = quietEngine();
    const explorer = agentByCareer(engine, 'explorer');
    speak(engine, 'admiral', explorer.id, 'command', '穿越虫洞。');
    speak(engine, explorer.id, 'admiral', 'report', '收到，这就去。');

    const view = agentTranscriptView(engine.state);
    // Order is the only pairing there is: the answer is simply the later line. The panel reverses it.
    expect(view.map((message) => message.text)).toEqual(['穿越虫洞。', '收到，这就去。']);
    expect(view[0]).toMatchObject({
      from: 'admiral',
      fromName: 'Dawn Frontier Command',
      to: explorer.id,
      toName: explorer.name,
      kind: 'command',
    });
    expect(view[1]).toMatchObject({
      from: explorer.id,
      fromName: explorer.name,
      to: 'admiral',
      toName: 'Dawn Frontier Command',
      kind: 'report',
    });
  });

  it('keeps the message a reply answers, even though answering marks it read', () => {
    const engine = quietEngine();
    const explorer = agentByCareer(engine, 'explorer');
    const TRIGGER = '穿越虫洞，寻找失联探测船。';
    speak(engine, 'admiral', explorer.id, 'command', TRIGGER);
    speak(engine, explorer.id, 'admiral', 'report', '我去。');

    // `consumeAnswered` marks the Admiral's own offer read the moment the Agent answers it — which is
    // exactly why `read` is not a filter here: it would hide the message the answer is about.
    expect(engine.state.agentMessages[0].read).toBe(true);
    expect(agentTranscriptView(engine.state).some((line) => line.text === TRIGGER)).toBe(true);
  });

  it('leaves Agent-to-Agent traffic out — it is not the Admiral’s correspondence', () => {
    const engine = quietEngine();
    const explorer = agentByCareer(engine, 'explorer');
    const tactical = agentByCareer(engine, 'tactical');
    speak(engine, explorer.id, tactical.id, 'team-request', '我要进那片空域，需要护航。', {
      requestingAgentId: explorer.id,
      accept: false,
    });

    expect(engine.state.agentMessages).toHaveLength(1);
    expect(agentTranscriptView(engine.state)).toEqual([]);
  });

  it('bounds the transcript and keeps the newest end', () => {
    const engine = quietEngine();
    const explorer = agentByCareer(engine, 'explorer');
    for (let i = 0; i < TRANSCRIPT_LIMIT + 5; i++)
      speak(engine, 'admiral', explorer.id, 'command', '第 ' + i + ' 条');

    const view = agentTranscriptView(engine.state);
    expect(view).toHaveLength(TRANSCRIPT_LIMIT);
    expect(view.at(-1)!.text).toBe('第 ' + (TRANSCRIPT_LIMIT + 4) + ' 条');
    expect(view.some((line) => line.text === '第 0 条')).toBe(false);
  });

  it('withholds the payload and the inbox flag — machinery, like `nextDecisionAt`', () => {
    const engine = quietEngine();
    const explorer = agentByCareer(engine, 'explorer');
    speak(engine, 'admiral', explorer.id, 'promise', '给你 Deep Scan。', { promiseId: 'promise-secret' });

    const serialised = JSON.stringify(agentTranscriptView(engine.state));
    expect(serialised).not.toContain('promise-secret');
    expect(serialised).not.toContain('payload');
    expect(serialised).not.toContain('read');
  });

  it('is a snapshot, not a live handle — mutating the view cannot reach the world', () => {
    const engine = quietEngine();
    const explorer = agentByCareer(engine, 'explorer');
    speak(engine, 'admiral', explorer.id, 'command', '原文');
    const before = JSON.stringify(engine.state.agentMessages);
    const view = agentTranscriptView(engine.state);
    view[0].text = '改过了';
    expect(JSON.stringify(engine.state.agentMessages)).toBe(before);
  });
});
