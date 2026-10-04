import { describe, expect, it } from 'vitest';
import { emptySchedulerState, offerAccesses, type ActivityAccess } from '../packages/shared/activity-events.js';
import type { HoloItem } from '../packages/shared/holo-scene.js';
import {
  SESSION_WINDOW_MS,
  filterAccesses,
  filterOrbit,
  filterScheduler,
  matchesSession,
  recentSessions,
  sessionLabel,
  sessionOptions,
  showSessionPicker,
  validSessionFilter,
  type SeenSession
} from '../packages/shared/holo-sessions.js';

/**
 * The session picker (docs/11 § The globe, 2026-09-27): with more than one Claude Code session
 * working, the caption's session label becomes ALL + each session, and choosing one narrows the
 * globe to it. The list and the filter are pure; these hold them.
 */

const A = '4a2cf476-3cb6-4f1e-8d87-ff161fadf566';
const B = '9b1e0c33-aaaa-bbbb-cccc-000000000000';
const NOW = 1_800_000_000_000;

const access = (path: string, session: string, action: ActivityAccess['action'] = 'read', at = NOW): ActivityAccess =>
  ({ path, action, at, session, kind: 'code' });

const item = (id: string): HoloItem => ({ id, path: id, name: id, kind: 'code', lat: 0, lon: 0, priority: 1, lastSeen: NOW });

describe('the session list', () => {
  it('labels a session by its cwd\'s last folder and short id', () => {
    expect(sessionLabel(A, 'C:\\dev\\SkynetOS')).toBe('SkynetOS · 4a2cf476');
    expect(sessionLabel(A, 'C:/dev/SkynetOS/')).toBe('SkynetOS · 4a2cf476');
    expect(sessionLabel(A)).toBe('4a2cf476');
  });

  it('lists sessions seen in the last ten minutes, most recent first, and keeps the filtered one', () => {
    const seen = new Map<string, SeenSession>([
      [A, { cwd: 'C:\\dev\\SkynetOS', lastSeen: NOW - 60_000 }],
      [B, { cwd: 'C:\\dev\\Stalker', lastSeen: NOW - 5_000 }],
      ['old', { cwd: 'C:\\dev\\Old', lastSeen: NOW - SESSION_WINDOW_MS - 1 }]
    ]);
    expect(recentSessions(seen, NOW).map((s) => s.label)).toEqual(['Stalker · 9b1e0c33', 'SkynetOS · 4a2cf476']);
    expect(recentSessions(seen, NOW, 'old').map((s) => s.id)).toEqual([B, A, 'old']);
  });

  it('is a dropdown only when there is a choice, with ALL first', () => {
    const one = [{ id: A, label: 'SkynetOS · 4a2cf476', lastSeen: NOW }];
    const two = [...one, { id: B, label: 'Stalker · 9b1e0c33', lastSeen: NOW }];
    expect(showSessionPicker(one)).toBe(false);
    expect(showSessionPicker(two)).toBe(true);
    expect(sessionOptions(two)).toEqual([
      { value: '', label: 'ALL' },
      { value: A, label: 'SkynetOS · 4a2cf476' },
      { value: B, label: 'Stalker · 9b1e0c33' }
    ]);
  });

  it('accepts only a session the feed has seen, or null / empty for ALL', () => {
    const seen = new Map<string, SeenSession>([[A, { lastSeen: NOW }]]);
    expect(validSessionFilter(A, seen)).toBe(A);
    expect(validSessionFilter(null, seen)).toBeNull();
    expect(validSessionFilter('', seen)).toBeNull();
    expect(validSessionFilter('someone-else', seen)).toBeUndefined();
    expect(validSessionFilter(42, seen)).toBeUndefined();
  });
});

describe('the filter', () => {
  it('offers the scheduler only the chosen session\'s accesses', () => {
    const accesses = [access('C:/a.ts', A), access('C:/b.ts', B), access('C:/c.ts', A)];
    expect(filterAccesses(accesses, A).map((a) => a.path)).toEqual(['C:/a.ts', 'C:/c.ts']);
    expect(filterAccesses(accesses, null)).toHaveLength(3);
    expect(matchesSession(B, A)).toBe(false);
    expect(matchesSession(B, null)).toBe(true);
  });

  it('drops a focus and queued accesses from other sessions when a filter is chosen', () => {
    let state = emptySchedulerState();
    state = offerAccesses(state, [access('C:/b.ts', B, 'edit'), access('C:/a.ts', A, 'read'), access('C:/b2.ts', B, 'read')], NOW).state;
    expect(state.focus?.access.session).toBe(B);
    const narrowed = filterScheduler(state, A);
    expect(narrowed.changed).toBe(true);
    expect(narrowed.state.focus).toBeNull();
    expect(narrowed.state.queue.map((q) => q.access.path)).toEqual(['C:/a.ts']);
    expect(narrowed.state.dropped).toBe(state.dropped);
    // ALL changes nothing; a filter that already matches changes nothing.
    expect(filterScheduler(state, null)).toEqual({ state, changed: false });
    expect(filterScheduler(filterScheduler(state, B).state, B).changed).toBe(false);
  });

  it('keeps in the orbit only what the chosen session touched', () => {
    const touched = new Map<string, Set<string>>([['a', new Set([A])], ['b', new Set([B])], ['both', new Set([A, B])]]);
    const orbit = [item('a'), item('b'), item('both'), item('unknown')];
    expect(filterOrbit(orbit, touched, A).map((i) => i.id)).toEqual(['a', 'both']);
    expect(filterOrbit(orbit, touched, null)).toHaveLength(4);
  });
});
