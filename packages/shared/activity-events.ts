/**
 * From a Claude Code transcript line to "Claude touched this path", and from a stream of those
 * to the one thing the hologram shows at its centre.
 *
 * William, 2026-09-26: "sometimes Claude browses or edits quickly, so categorize activity by
 * urgency or importance, skip less important accesses, and choose the next real-time renderable
 * action based on highest priority." The scheduler below is that rule: a focus holds the centre
 * for a minimum time so the eye can read it, a clearly more important arrival may interrupt it, and
 * everything else waits in a queue of three or is dropped and counted.
 *
 * Pure. The feed (main/services/activity-feed.ts) owns the clock and the files.
 */
import { accessPriority, type HoloAction, type HoloKind } from './holo-scene.js';
import { kindOf } from './globe-atlas.js';
import { normalisePath } from './usage.js';

export interface ActivityAccess {
  /** Normalised absolute path. */
  path: string;
  action: HoloAction;
  /** ms since epoch. */
  at: number;
  session: string;
  kind: HoloKind;
  /** True when the tool named a directory (Glob, Grep, cd). */
  directory?: boolean;
}

const isAbsolute = (p: string): boolean => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\');

function absolute(raw: string, cwd?: string): string | null {
  const value = raw.trim().replace(/^["']|["']$/g, '');
  if (!value) return null;
  if (isAbsolute(value)) return normalisePath(value);
  if (!cwd) return null;
  return normalisePath(`${cwd.replace(/[\\/]+$/, '')}/${value}`);
}

const EXE_EXT = /\.(exe|bat|cmd|ps1|msi|lnk)$/i;
/** The first path-like token of a shell command: quoted, or bare with a drive or slash. */
const PATH_TOKEN = /"([^"]+)"|'([^']+)'|((?:[a-zA-Z]:)?[\\/][^\s"'&|;<>]+|[A-Za-z0-9_.-]+(?:[\\/][^\s"'&|;<>]+)+)/;

/** What a Bash command was about: a folder it entered, a program it ran, a file it looked at. */
export function bashAccess(command: string, cwd?: string): { path: string; action: HoloAction; directory: boolean } | null {
  const text = command.trim();
  if (!text) return null;
  const cd = /(?:^|&&|;|\|\|)\s*cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)/.exec(text);
  if (cd) {
    const path = absolute(cd[1]!, cwd);
    if (path) return { path, action: 'run', directory: true };
  }
  const first = text.split(/\s+/)[0] ?? '';
  const firstPath = absolute(first, cwd);
  if (firstPath && EXE_EXT.test(firstPath)) return { path: firstPath, action: 'run', directory: false };
  const browse = /^(ls|dir|tree|Get-ChildItem|gci)\b(.*)$/i.exec(text);
  if (browse) {
    const m = PATH_TOKEN.exec(browse[2] ?? '');
    const path = m ? absolute(m[1] ?? m[2] ?? m[3] ?? '', cwd) : cwd ? normalisePath(cwd) : null;
    if (path) return { path, action: 'browse', directory: true };
  }
  const look = /^(cat|type|head|tail|sed|less|more|bat|Get-Content|gc)\b(.*)$/i.exec(text);
  if (look) {
    const m = PATH_TOKEN.exec(look[2] ?? '');
    const path = m ? absolute(m[1] ?? m[2] ?? m[3] ?? '', cwd) : null;
    if (path) return { path, action: 'read', directory: false };
  }
  if (cwd) return { path: normalisePath(cwd), action: 'run', directory: true };
  return null;
}

interface ToolUse { name: string; input: Record<string, unknown> }

function toolUses(content: unknown): ToolUse[] {
  if (!Array.isArray(content)) return [];
  const out: ToolUse[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as { type?: unknown; name?: unknown; input?: unknown };
    if (b.type !== 'tool_use' || typeof b.name !== 'string' || !b.input || typeof b.input !== 'object') continue;
    out.push({ name: b.name, input: b.input as Record<string, unknown> });
  }
  return out;
}

/** A parsed transcript line, or anything shaped enough like one. */
export interface TranscriptLine {
  type?: unknown;
  cwd?: unknown;
  sessionId?: unknown;
  timestamp?: unknown;
  message?: { content?: unknown } | null;
}

/**
 * Every path a transcript line's tool calls touched, with what was done to it.
 * Read → read; Edit, MultiEdit, NotebookEdit → edit; Write → write; Glob, Grep → search on the
 * directory (or the cwd); Bash → see `bashAccess`. Other tools touch nothing the globe shows.
 */
export function eventsFromMessage(line: TranscriptLine, cwd?: string, session?: string, at?: number): ActivityAccess[] {
  const dir = typeof line.cwd === 'string' && line.cwd ? line.cwd : cwd;
  const sess = session ?? (typeof line.sessionId === 'string' ? line.sessionId : '');
  const when = at ?? (typeof line.timestamp === 'string' ? Date.parse(line.timestamp) : NaN);
  const stamp = Number.isFinite(when) ? when : Date.now();
  const out: ActivityAccess[] = [];
  const push = (path: string | null, action: HoloAction, directory: boolean) => {
    if (!path) return;
    out.push({ path, action, at: stamp, session: sess, kind: kindOf(path, { directory }), directory });
  };
  for (const tool of toolUses(line.message?.content)) {
    const input = tool.input;
    const str = (k: string): string | undefined => (typeof input[k] === 'string' ? (input[k] as string) : undefined);
    switch (tool.name) {
      case 'Read': push(absolute(str('file_path') ?? '', dir), 'read', false); break;
      case 'Edit':
      case 'MultiEdit': push(absolute(str('file_path') ?? '', dir), 'edit', false); break;
      case 'NotebookEdit': push(absolute(str('notebook_path') ?? '', dir), 'edit', false); break;
      case 'Write': push(absolute(str('file_path') ?? '', dir), 'write', false); break;
      case 'Glob':
      case 'Grep': {
        const p = str('path');
        push(p ? absolute(p, dir) : dir ? normalisePath(dir) : null, 'search', true);
        break;
      }
      case 'Bash':
      case 'PowerShell': {
        const cmd = str('command');
        if (!cmd) break;
        const a = bashAccess(cmd, dir);
        if (a) push(a.path, a.action, a.directory);
        break;
      }
      default: break;
    }
  }
  return out;
}

/* ────────────────────────── the scheduler ────────────────────────── */

/** A focus stays at least this long, so it can be read. */
export const MIN_FOCUS_MS = 2_500;
/** And at most this long with nothing behind it, after which the globe goes idle. */
export const MAX_FOCUS_MS = 12_000;
/** An arrival interrupts the focus only when it outranks it by this much. */
export const PREEMPT_MARGIN = 10;
/** The queue behind the focus. Anything beyond it is dropped and counted. */
export const QUEUE_CAP = 3;

export interface Ranked { access: ActivityAccess; priority: number }
export interface Focused extends Ranked { since: number }

export interface SchedulerState {
  focus: Focused | null;
  queue: Ranked[];
  /** Accesses that never reached the centre, since the state was created. */
  dropped: number;
}

export function emptySchedulerState(): SchedulerState {
  return { focus: null, queue: [], dropped: 0 };
}

export function priorityOf(access: ActivityAccess): number {
  return accessPriority(access.kind, access.action);
}

/**
 * Offer new accesses. Returns the next state and whether the focus changed.
 * The queue is deduplicated by path (the newer access wins), sorted by priority then recency,
 * and cut to QUEUE_CAP; the cut is counted as dropped. An access to the path already at the
 * centre refreshes the focus's action without restarting its hold.
 */
export function offerAccesses(state: SchedulerState, accesses: readonly ActivityAccess[], now: number): { state: SchedulerState; changed: boolean } {
  let focus = state.focus;
  let queue = [...state.queue];
  let dropped = state.dropped;
  let changed = false;
  for (const access of accesses) {
    const priority = priorityOf(access);
    if (!focus) {
      focus = { access, priority, since: now };
      changed = true;
      continue;
    }
    if (focus.access.path === access.path) {
      if (priority > focus.priority) { focus = { ...focus, access, priority }; changed = true; }
      continue;
    }
    if (priority >= focus.priority + PREEMPT_MARGIN) {
      focus = { access, priority, since: now };
      changed = true;
      continue;
    }
    queue = queue.filter((q) => q.access.path !== access.path);
    queue.push({ access, priority });
  }
  queue.sort((a, b) => b.priority - a.priority || b.access.at - a.access.at);
  if (queue.length > QUEUE_CAP) {
    dropped += queue.length - QUEUE_CAP;
    queue = queue.slice(0, QUEUE_CAP);
  }
  return { state: { focus, queue, dropped }, changed };
}

/**
 * The clock. After the minimum hold, the head of the queue takes the centre; after the maximum
 * hold with nothing waiting, the centre empties.
 */
export function tickScheduler(state: SchedulerState, now: number): { state: SchedulerState; changed: boolean } {
  const { focus } = state;
  if (!focus) {
    const next = state.queue[0];
    if (!next) return { state, changed: false };
    return { state: { focus: { ...next, since: now }, queue: state.queue.slice(1), dropped: state.dropped }, changed: true };
  }
  const held = now - focus.since;
  if (held >= MIN_FOCUS_MS && state.queue.length) {
    const next = state.queue[0]!;
    return { state: { focus: { ...next, since: now }, queue: state.queue.slice(1), dropped: state.dropped }, changed: true };
  }
  if (held >= MAX_FOCUS_MS) {
    return { state: { focus: null, queue: state.queue, dropped: state.dropped }, changed: true };
  }
  return { state, changed: false };
}

/** Offer then tick, in one call. */
export function schedulePriority(state: SchedulerState, accesses: readonly ActivityAccess[], now: number): { state: SchedulerState; focus: ActivityAccess | null; changed: boolean; dropped: number } {
  const offered = offerAccesses(state, accesses, now);
  const ticked = tickScheduler(offered.state, now);
  return {
    state: ticked.state,
    focus: ticked.state.focus?.access ?? null,
    changed: offered.changed || ticked.changed,
    dropped: ticked.state.dropped
  };
}
