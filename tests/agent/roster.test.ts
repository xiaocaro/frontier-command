/**
 * The Admiral's read-only Agent view (docs/lv3/10-agent-demo-channel.md).
 *
 * This view is an **amplifier**: it carries Agent state to the renderer, where before P3 nothing did.
 * So the crop is the thing under test, not the plumbing — `N-7` warns that memory text is the leak
 * vector, and a comment claiming the crop happened is not evidence.
 */
import { describe, it, expect } from 'vitest';
import { quietEngine, run } from '../helpers';
import { agentRosterView, ROSTER_MEMORY_LIMIT } from '../../src/engine/agent/roster';
import { agentByCareer, patchAgent } from './support';
import { episodicMemory, remember } from '../../src/engine/agent/memory';

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
