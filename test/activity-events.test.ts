import { describe, expect, it } from 'vitest';
import {
  MAX_FOCUS_MS,
  MIN_FOCUS_MS,
  QUEUE_CAP,
  bashAccess,
  emptySchedulerState,
  eventsFromMessage,
  offerAccesses,
  schedulePriority,
  tickScheduler,
  type ActivityAccess
} from '../packages/shared/activity-events.js';

/**
 * The centre of the globe is contested. These tests pin the rules William asked for: importance
 * decides, a focus is held long enough to read, and a fast burst is thinned rather than shown.
 */

const line = (tools: { name: string; input: Record<string, unknown> }[], cwd = 'C:\\dev\\SkynetOS') => ({
  type: 'assistant',
  cwd,
  sessionId: 'abcdef12-0000',
  timestamp: '2026-09-26T20:00:00.000Z',
  message: { content: tools.map((t) => ({ type: 'tool_use', id: 'x', ...t })) }
});

const access = (path: string, action: ActivityAccess['action'], at = 0, kind: ActivityAccess['kind'] = 'code'): ActivityAccess =>
  ({ path, action, at, session: 's', kind });

describe('eventsFromMessage', () => {
  it('maps the file tools to their actions and resolves relative paths against the cwd', () => {
    const events = eventsFromMessage(line([
      { name: 'Read', input: { file_path: 'C:\\dev\\SkynetOS\\handoff.md' } },
      { name: 'Edit', input: { file_path: 'src/main/ipc.ts', old_string: 'a', new_string: 'b' } },
      { name: 'Write', input: { file_path: 'C:/dev/SkynetOS/new.ts', content: '' } },
      { name: 'NotebookEdit', input: { notebook_path: 'C:/dev/n.ipynb' } },
      { name: 'Grep', input: { pattern: 'x', path: 'C:/dev/SkynetOS/src' } },
      { name: 'Glob', input: { pattern: '**/*.ts' } },
      { name: 'ToolSearch', input: { query: 'x' } }
    ]));
    expect(events.map((e) => [e.path, e.action, e.kind])).toEqual([
      ['c:/dev/skynetos/handoff.md', 'read', 'doc'],
      ['c:/dev/skynetos/src/main/ipc.ts', 'edit', 'code'],
      ['c:/dev/skynetos/new.ts', 'write', 'code'],
      ['c:/dev/n.ipynb', 'edit', 'other'],
      ['c:/dev/skynetos/src', 'search', 'folder'],
      ['c:/dev/skynetos', 'search', 'folder']
    ]);
    expect(events[0]!.session).toBe('abcdef12-0000');
    expect(events[0]!.at).toBe(Date.parse('2026-09-26T20:00:00.000Z'));
  });

  it('ignores lines that are not assistant tool calls', () => {
    expect(eventsFromMessage({ type: 'user', message: { content: 'hello' } })).toEqual([]);
    expect(eventsFromMessage({ type: 'assistant', message: { content: [{ type: 'text', text: 'C:/dev/x.ts' }] } })).toEqual([]);
  });
});

describe('bashAccess', () => {
  it('follows a cd', () => {
    expect(bashAccess('cd /c/dev/TheStalker && ./gradlew build', 'C:/dev')).toEqual({ path: '/c/dev/thestalker', action: 'run', directory: true });
    expect(bashAccess('cd "C:\\dev\\My Mod" ; ls', 'C:/dev')).toEqual({ path: 'c:/dev/my mod', action: 'run', directory: true });
  });
  it('sees a program being run', () => {
    expect(bashAccess('C:/Tools/build.exe --all', 'C:/dev')).toEqual({ path: 'c:/tools/build.exe', action: 'run', directory: false });
  });
  it('sees a listing and a look', () => {
    expect(bashAccess('ls -la src/main', 'C:/dev/SkynetOS')).toEqual({ path: 'c:/dev/skynetos/src/main', action: 'browse', directory: true });
    expect(bashAccess('sed -n 1,40p src/main/ipc.ts', 'C:/dev/SkynetOS')).toEqual({ path: 'c:/dev/skynetos/src/main/ipc.ts', action: 'read', directory: false });
  });
  it('falls back to running in the cwd, and to nothing without one', () => {
    expect(bashAccess('npm run verify', 'C:/dev/SkynetOS')).toEqual({ path: 'c:/dev/skynetos', action: 'run', directory: true });
    expect(bashAccess('npm run verify')).toBeNull();
  });
});

describe('the scheduler', () => {
  it('thins a burst of forty reads to at most four focuses and counts the drops', () => {
    const reads = Array.from({ length: 40 }, (_, i) => access(`c:/dev/f${i}.ts`, 'read', i));
    let state = emptySchedulerState();
    const shown = new Set<string>();
    let r = schedulePriority(state, reads, 0);
    state = r.state;
    if (r.focus) shown.add(r.focus.path);
    let now = 0;
    for (let step = 0; step < 40; step++) {
      now += MIN_FOCUS_MS;
      const t = tickScheduler(state, now);
      state = t.state;
      if (state.focus) shown.add(state.focus.access.path);
    }
    expect(shown.size).toBeLessThanOrEqual(1 + QUEUE_CAP);
    expect(state.dropped).toBe(40 - 1 - QUEUE_CAP);
  });

  it('lets a write pre-empt a read at once', () => {
    let { state } = offerAccesses(emptySchedulerState(), [access('c:/dev/a.ts', 'read')], 0);
    const r = offerAccesses(state, [access('c:/dev/b.ts', 'write', 10)], 10);
    state = r.state;
    expect(r.changed).toBe(true);
    expect(state.focus?.access.path).toBe('c:/dev/b.ts');
    expect(state.focus?.since).toBe(10);
  });

  it('does not let a read pre-empt a write; it queues', () => {
    let { state } = offerAccesses(emptySchedulerState(), [access('c:/dev/a.ts', 'write')], 0);
    const r = offerAccesses(state, [access('c:/dev/b.ts', 'read', 10)], 10);
    state = r.state;
    expect(r.changed).toBe(false);
    expect(state.focus?.access.path).toBe('c:/dev/a.ts');
    expect(state.queue.map((q) => q.access.path)).toEqual(['c:/dev/b.ts']);
  });

  it('holds a focus for the minimum time before the queue advances, and empties it after the maximum', () => {
    let { state } = offerAccesses(emptySchedulerState(), [access('c:/dev/a.ts', 'read'), access('c:/dev/b.ts', 'read', 1)], 0);
    expect(tickScheduler(state, MIN_FOCUS_MS - 1).changed).toBe(false);
    const advanced = tickScheduler(state, MIN_FOCUS_MS);
    expect(advanced.changed).toBe(true);
    expect(advanced.state.focus?.access.path).toBe('c:/dev/b.ts');
    state = advanced.state;
    expect(tickScheduler(state, MIN_FOCUS_MS + MAX_FOCUS_MS - 1).changed).toBe(false);
    const emptied = tickScheduler(state, MIN_FOCUS_MS + MAX_FOCUS_MS);
    expect(emptied.changed).toBe(true);
    expect(emptied.state.focus).toBeNull();
  });

  it('refreshes the focus in place when the same path is touched again', () => {
    let { state } = offerAccesses(emptySchedulerState(), [access('c:/dev/a.ts', 'read')], 0);
    const r = offerAccesses(state, [access('c:/dev/a.ts', 'edit', 5)], 5);
    state = r.state;
    expect(state.focus?.access.action).toBe('edit');
    expect(state.focus?.since).toBe(0);
    expect(state.queue).toEqual([]);
  });
});
