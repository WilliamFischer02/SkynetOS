import { describe, expect, it } from 'vitest';
import type { BoardNode } from '../packages/shared/types.js';
import {
  emptySchedulerState,
  nextRunFor,
  normaliseSchedulerState,
  planDispatch,
  planRuns,
  recordResult,
  resolveTaskAction,
  type DispatchContext,
  type ScheduledTask,
  type SchedulerState
} from '../packages/shared/schedule.js';

const at = (y: number, m: number, d: number, h = 0, min = 0, s = 0): Date => new Date(y, m - 1, d, h, min, s);

function task(id: string, fields: Partial<BoardNode> = {}): ScheduledTask {
  return {
    key: `root.${id}`,
    boardId: 'root',
    node: {
      id,
      kind: 'task.scheduled',
      name: id.toUpperCase(),
      pos: { x: 0, y: 0 },
      schedule: '0 8 * * *',
      action: { type: 'agent.run' },
      taskBrief: 'codex/briefs/x.md',
      ...fields
    } as BoardNode
  };
}

/** A state in which the task has been known since long before the slot in question. */
function known(keys: string[], extra: Partial<SchedulerState['tasks'][string]> = {}): SchedulerState {
  const state = emptySchedulerState();
  for (const key of keys) state.tasks[key] = { firstSeen: at(2026, 9, 1).toISOString(), ...extra };
  return state;
}

describe('resolveTaskAction', () => {
  it('runs only agent.run and journal.write', () => {
    expect(resolveTaskAction({ action: { type: 'journal.write' } })).toEqual({ kind: 'journal.write' });
    expect(resolveTaskAction({ action: { type: 'agent.run', target: 'a', prompt: 'p' } }))
      .toEqual({ kind: 'agent.run', target: 'a', brief: null, prompt: 'p' });
  });

  it('lets the node fields win over the action object, because the editor shows them', () => {
    const a = resolveTaskAction({ action: { type: 'agent.run', target: 'old', prompt: 'old' }, taskTarget: 'u3', taskPrompt: 'new', taskBrief: 'codex/briefs/m.md' });
    expect(a).toEqual({ kind: 'agent.run', target: 'u3', brief: 'codex/briefs/m.md', prompt: 'new' });
  });

  it('reads a notify action as its message, and refuses one with nothing to say', () => {
    expect(resolveTaskAction({ action: { type: 'notify', level: 'info', message: ' Drill window. ' } }))
      .toEqual({ kind: 'notify', message: 'Drill window.' });
    const empty = resolveTaskAction({ action: { type: 'notify', message: '   ' } });
    expect(empty.kind).toBe('unsupported');
    expect((empty as { reason: string }).reason).toContain('"message"');
  });

  it('keeps the older action types valid but inert, saying why', () => {
    expect(resolveTaskAction({ action: { type: 'jarvis.headless', prompt: 'x' } }).kind).toBe('unsupported');
    expect(resolveTaskAction({ action: { type: 'rm -rf' } }).kind).toBe('unsupported');
    expect(resolveTaskAction({}).kind).toBe('unsupported');
  });
});

describe('planRuns', () => {
  it('runs on time, once per slot', () => {
    const t = task('morning');
    const first = planRuns([t], known([t.key]), at(2026, 9, 11, 8, 0, 20));
    expect(first.decisions[0]).toMatchObject({ run: true, mode: 'on-time' });
    const again = planRuns([t], first.state, at(2026, 9, 11, 8, 1));
    expect(again.decisions[0]).toMatchObject({ run: false, reason: 'already ran for this slot' });
    // The next morning is a new slot.
    expect(planRuns([t], again.state, at(2026, 9, 12, 8, 0)).decisions[0]?.run).toBe(true);
  });

  it('catches up ONCE when the app opens within the grace window', () => {
    const t = task('morning');
    const state = known([t.key], { lastSlot: at(2026, 9, 10, 8).toISOString() });
    const open = planRuns([t], state, at(2026, 9, 11, 10, 30));
    expect(open.decisions[0]).toMatchObject({ run: true, mode: 'catch-up', slot: at(2026, 9, 11, 8).toISOString() });
    expect(planRuns([t], open.state, at(2026, 9, 11, 10, 31)).decisions[0]?.run).toBe(false);
  });

  it('does not catch up after the window (default 4 h), nor with a window of 0', () => {
    const t = task('morning');
    expect(planRuns([t], known([t.key]), at(2026, 9, 11, 12, 30)).decisions[0]).toMatchObject({ run: false, reason: 'no slot due' });
    const strict = task('strict', { catchUpHours: 0 });
    expect(planRuns([strict], known([strict.key]), at(2026, 9, 11, 8, 5)).decisions[0]?.run).toBe(false);
    expect(planRuns([strict], known([strict.key]), at(2026, 9, 11, 8, 1)).decisions[0]?.run).toBe(true);
  });

  it('never catches up a task it has never seen, but runs it at its next slot', () => {
    const t = task('new');
    const first = planRuns([t], emptySchedulerState(), at(2026, 9, 11, 10, 30));
    expect(first.decisions[0]?.run).toBe(false);
    expect(first.decisions[0]?.reason).toContain('never catches up');
    expect(planRuns([t], first.state, at(2026, 9, 12, 8, 0)).decisions[0]?.run).toBe(true);
  });

  it('runs a brand-new task whose slot is this very minute', () => {
    const t = task('new');
    expect(planRuns([t], emptySchedulerState(), at(2026, 9, 11, 8, 0, 30)).decisions[0]?.run).toBe(true);
  });

  it('skips disabled tasks and bad schedules, saying why', () => {
    const off = task('off', { enabled: false });
    const bad = task('bad', { schedule: '0 8 * *' });
    const { decisions } = planRuns([off, bad], known([off.key, bad.key]), at(2026, 9, 11, 8));
    expect(decisions[0]).toMatchObject({ run: false, reason: 'disabled' });
    expect(decisions[1]?.reason).toContain('bad schedule');
  });

  it('caps scheduled runs per day across every task', () => {
    const tasks = Array.from({ length: 7 }, (_, i) => task(`t${i}`));
    const { decisions } = planRuns(tasks, known(tasks.map((t) => t.key)), at(2026, 9, 11, 8), 6);
    expect(decisions.filter((d) => d.run)).toHaveLength(6);
    expect(decisions.find((d) => !d.run)?.reason).toContain('daily cap');
  });

  it('marks the slot in the returned state BEFORE anything runs, so a crash cannot double-fire', () => {
    const t = task('morning');
    const { state } = planRuns([t], known([t.key]), at(2026, 9, 11, 8));
    expect(state.tasks[t.key]?.lastSlot).toBe(at(2026, 9, 11, 8).toISOString());
  });

  it('forgets tasks that are no longer on any board', () => {
    const t = task('kept');
    const state = known([t.key, 'root.gone']);
    expect(Object.keys(planRuns([t], state, at(2026, 9, 11, 9)).state.tasks)).toEqual([t.key]);
  });

  it('records a result without touching the slot', () => {
    const t = task('morning');
    const { state } = planRuns([t], known([t.key]), at(2026, 9, 11, 8));
    const after = recordResult(state, t.key, { ok: true, message: 'started' }, 'on-time', at(2026, 9, 11, 8, 0, 5));
    expect(after.tasks[t.key]?.lastResult).toMatchObject({ ok: true, mode: 'on-time' });
    expect(after.tasks[t.key]?.lastSlot).toBe(state.tasks[t.key]?.lastSlot);
  });

  it('survives a mangled state file', () => {
    expect(normaliseSchedulerState('nonsense')).toEqual(emptySchedulerState());
    expect(normaliseSchedulerState({ tasks: { a: { nope: 1 } }, runs: [1, 'x'] })).toEqual({ version: 1, tasks: {}, runs: ['x'] });
  });
});

describe('planDispatch (the action table)', () => {
  const hands = { id: 'u3_jarvis_hands', kind: 'agent.code', name: 'JARVIS-PRIME', tags: ['hands'], pos: { x: 0, y: 0 }, cwd: 'C:/dev' } as BoardNode;
  const elevated = { ...hands, id: 'u9_admin', tags: [], name: 'ADMIN', launch: 'popout-elevated' } as BoardNode;
  const chat = { id: 'u1_chat', kind: 'agent.chat', name: 'CHAT', pos: { x: 0, y: 0 } } as BoardNode;
  const boards: Record<string, BoardNode[]> = { root: [hands, elevated, chat], storyos: [] };

  const ctx = (node: Partial<BoardNode>, extra: Partial<DispatchContext> = {}): DispatchContext => {
    const n = task('morning', node).node;
    return {
      boardId: 'root',
      node: n,
      action: resolveTaskAction(n),
      mode: 'on-time',
      slot: at(2026, 9, 11, 8).toISOString(),
      nodesOf: (id) => boards[id] ?? [],
      briefText: 'Improve one small thing.',
      ...extra
    };
  };

  it('sends an agent.run with no target to JARVIS Prime on the root board, brief first', () => {
    const plan = planDispatch(ctx({}));
    expect(plan).toMatchObject({ do: 'session', boardId: 'root', targetId: 'u3_jarvis_hands' });
    if (plan.do !== 'session') throw new Error('not a session');
    expect(plan.prompt).toContain('SCHEDULED RUN');
    expect(plan.prompt).toContain('on time for the 2026-09-11 08:00 slot');
    expect(plan.prompt).toContain('commit nothing');
    expect(plan.prompt).toContain('Improve one small thing.');
  });

  it('finds a named target on the root board from a room', () => {
    const plan = planDispatch(ctx({ taskTarget: 'u3_jarvis_hands' }, { boardId: 'storyos' }));
    expect(plan).toMatchObject({ do: 'session', boardId: 'root', targetId: 'u3_jarvis_hands' });
  });

  it('refuses an elevated target, a non-agent target, a missing target, a missing brief and an empty task', () => {
    expect(planDispatch(ctx({ taskTarget: 'u9_admin' }))).toMatchObject({ do: 'refuse' });
    expect((planDispatch(ctx({ taskTarget: 'u9_admin' })) as { reason: string }).reason).toContain('NEVER ELEVATED');
    expect(planDispatch(ctx({ taskTarget: 'u1_chat' }))).toMatchObject({ do: 'refuse' });
    expect(planDispatch(ctx({ taskTarget: 'nobody' }))).toMatchObject({ do: 'refuse' });
    expect(planDispatch(ctx({}, { briefText: null }))).toMatchObject({ do: 'refuse' });
    expect(planDispatch(ctx({ taskBrief: '' }, { briefText: null }))).toMatchObject({ do: 'refuse' });
  });

  it('writes the journal only when a vault is set', () => {
    expect(planDispatch(ctx({ action: { type: 'journal.write' }, journalVault: 'C:/v' }))).toEqual({ do: 'journal' });
    expect(planDispatch(ctx({ action: { type: 'journal.write' } }))).toMatchObject({ do: 'refuse' });
  });

  it('never runs an unsupported action', () => {
    expect(planDispatch(ctx({ action: { type: 'jarvis.headless', prompt: 'x' } }))).toMatchObject({ do: 'refuse' });
  });

  it('shows a notify action as a toast titled with the task, on time or by hand', () => {
    const node = { designator: 'T1', name: 'Daily drill reminder', action: { type: 'notify', message: 'One pass only.' } };
    expect(planDispatch(ctx(node))).toEqual({ do: 'notify', title: 'T1 Daily drill reminder', message: 'One pass only.' });
    expect(planDispatch(ctx(node, { mode: 'manual', slot: null }))).toMatchObject({ do: 'notify' });
    expect(planDispatch(ctx({ action: { type: 'notify' } }))).toMatchObject({ do: 'refuse' });
  });

  it('says so when William pressed Run now', () => {
    const plan = planDispatch(ctx({}, { mode: 'manual', slot: null }));
    if (plan.do !== 'session') throw new Error('not a session');
    expect(plan.prompt).toContain('because William pressed Run now');
  });
});

describe('nextRunFor (what the inspector says about a task)', () => {
  const now = at(2026, 9, 19, 9, 30);

  it('names the next slot for a live schedule', () => {
    expect(nextRunFor({ schedule: '0 8 * * *' }, now)).toEqual({ next: at(2026, 9, 20, 8, 0).toISOString() });
  });

  /*
   * The inspector prints these after "NOT SCHEDULED —". "DISABLED" and "THIS SCHEDULE NEVER FIRES"
   * both stopped at what is wrong; each now ends in what to do, which is the rule for every error
   * the chrome shows.
   */
  it('says how to switch a disabled task back on', () => {
    const result = nextRunFor({ schedule: '0 8 * * *', enabled: false }, now);
    expect(result.next).toBeNull();
    expect(result.error).toMatch(/TICK ENABLED/);
  });

  it('says where to look when no date can ever match', () => {
    const result = nextRunFor({ schedule: '0 0 31 2 *' }, now);
    expect(result.next).toBeNull();
    expect(result.error).toMatch(/DAY AND MONTH/);
  });

  it("passes a parse failure through in the parser's own words", () => {
    const result = nextRunFor({ schedule: '0 8 * *' }, now);
    expect(result.next).toBeNull();
    expect(result.error).toMatch(/FIVE FIELDS/);
  });

  it('treats a missing schedule as a parse failure, not a crash', () => {
    expect(nextRunFor({}, now).next).toBeNull();
    expect(nextRunFor({}, now).error).toBeTruthy();
  });
});
