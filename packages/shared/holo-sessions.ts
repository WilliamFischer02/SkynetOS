/**
 * The session picker on the hologram (docs/11 § The globe, 2026-09-27).
 *
 * The activity feed tails every Claude Code session on this machine, so with two or three running
 * the globe interleaves them. When more than one has written a line in the last ten minutes, the
 * caption's session label becomes a dropdown: ALL, then each session by its cwd's last folder and
 * the first eight characters of its id. Choosing one filters the scene in main
 * (`hologram:setSessionFilter`): only that session's accesses are offered to the scheduler, the
 * focus and queue from others are dropped, and the orbit keeps only what that session touched.
 *
 * Pure. The feed (main/services/activity-feed.ts) owns the clock, the maps and the scene.
 */
import type { ActivityAccess, SchedulerState } from './activity-events.js';
import type { HoloItem, HoloSession } from './holo-scene.js';

/** A session is offered in the picker while it has written a line within this long. */
export const SESSION_WINDOW_MS = 10 * 60_000;

/** What the feed remembers about a session between transcript lines. */
export interface SeenSession {
  cwd?: string;
  lastSeen: number;
}

/** `SkynetOS · 4a2cf476`: the cwd's last folder and the id's first eight characters, whichever exist. */
export function sessionLabel(id: string, cwd?: string): string {
  const dir = cwd ? (cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '') : '';
  const short = id.slice(0, 8);
  return [dir, short].filter(Boolean).join(' · ') || 'unknown session';
}

/**
 * The sessions for the picker, most recent first: every one seen within `SESSION_WINDOW_MS` of
 * `now`, plus the filtered one even when it has gone quiet (so the picker can still show what is
 * chosen and offer ALL).
 */
export function recentSessions(seen: ReadonlyMap<string, SeenSession>, now: number, filter?: string | null): HoloSession[] {
  const out: HoloSession[] = [];
  for (const [id, s] of seen) {
    if (!id) continue;
    if (now - s.lastSeen > SESSION_WINDOW_MS && id !== filter) continue;
    out.push({ id, label: sessionLabel(id, s.cwd), lastSeen: s.lastSeen });
  }
  return out.sort((a, b) => b.lastSeen - a.lastSeen || a.id.localeCompare(b.id));
}

/** The label becomes a dropdown only when there is a choice to make. */
export function showSessionPicker(sessions: readonly HoloSession[]): boolean {
  return sessions.length > 1;
}

/** Whether a session passes the filter; no filter passes everything. */
export function matchesSession(session: string, filter: string | null | undefined): boolean {
  return !filter || session === filter;
}

/** The accesses the scheduler is offered under a filter. */
export function filterAccesses(accesses: readonly ActivityAccess[], filter: string | null | undefined): ActivityAccess[] {
  return filter ? accesses.filter((a) => a.session === filter) : [...accesses];
}

/**
 * The scheduler after a filter is chosen: a focus or a queued access from another session is
 * dropped (not counted as dropped: nothing was thinned, the view was narrowed). `changed` when the
 * focus went.
 */
export function filterScheduler(state: SchedulerState, filter: string | null | undefined): { state: SchedulerState; changed: boolean } {
  if (!filter) return { state, changed: false };
  const focusOk = !state.focus || state.focus.access.session === filter;
  const queue = state.queue.filter((q) => q.access.session === filter);
  if (focusOk && queue.length === state.queue.length) return { state, changed: false };
  return { state: { focus: focusOk ? state.focus : null, queue, dropped: state.dropped }, changed: !focusOk };
}

/** The orbit under a filter: only items that session touched. `touchedBy` maps an item id to its sessions. */
export function filterOrbit(items: readonly HoloItem[], touchedBy: ReadonlyMap<string, ReadonlySet<string>>, filter: string | null | undefined): HoloItem[] {
  if (!filter) return [...items];
  return items.filter((item) => touchedBy.get(item.id)?.has(filter) === true);
}

/** The dropdown's entries: ALL first (value ''), then each session. */
export function sessionOptions(sessions: readonly HoloSession[]): { value: string; label: string }[] {
  return [{ value: '', label: 'ALL' }, ...sessions.map((s) => ({ value: s.id, label: s.label }))];
}

/** Whether a filter names a session the feed has seen; anything else is refused. */
export function validSessionFilter(id: unknown, seen: ReadonlyMap<string, SeenSession>): string | null | undefined {
  if (id === null || id === '') return null;
  if (typeof id !== 'string') return undefined;
  return seen.has(id) ? id : undefined;
}
