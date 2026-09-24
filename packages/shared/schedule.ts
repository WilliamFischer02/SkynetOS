import type { BoardNode } from './types.js';
import { latestSlot, nextRun, parseCron } from './cron.js';
import { pickHandsNode } from './face-brief.js';

/**
 * The scheduler's rules, pure. src/main/services/scheduler.ts supplies the clock, the disk and the
 * launcher; everything that decides WHETHER and WHAT to run is here, where test/schedule.test.ts
 * can drive it with an injected clock instead of waiting for 8 am.
 *
 * William: "a scheduled agent node that runs Jarvis Prime every morning that the program is open…
 * make minor improvements automatically every morning at 8am, maintain a roadmap for program
 * feature development, and slowly work through roadmap items."
 *
 * ── The rules ─────────────────────────────────────────────────────────────────────────────────
 *
 *  - Runs happen only while SkynetOS is open. Nothing is registered with Windows.
 *  - One run per task per scheduled slot, ever. The slot is recorded BEFORE the run starts, so a
 *    crash mid-run cannot make it fire twice.
 *  - Catch-up: a slot missed because the app was closed fires ONCE when the app opens within the
 *    task's grace window (`catchUpHours`, default 4). Only the latest missed slot fires, however
 *    many were missed.
 *  - A task the scheduler has never seen before never catches up. A board edit that adds an 8 am
 *    task at 10 am, or a first launch after an update, does not start work nobody expected.
 *  - At most MAX_SCHEDULED_RUNS_PER_DAY scheduled runs a day, across every task. Manual runs are
 *    William's own clicks and are not capped.
 *  - Never elevated: an agent.run whose target launches elevated is refused (docs/07).
 */

export const DEFAULT_CATCH_UP_HOURS = 4;
export const MAX_CATCH_UP_HOURS = 48;
/** A slot this recent is "on time"; later than this it is a catch-up. */
export const ON_TIME_MS = 2 * 60_000;
export const MAX_SCHEDULED_RUNS_PER_DAY = 6;
/** Where the Hands live, and where an agent.run with no target is sent. */
export const SCHEDULE_ROOT_BOARD = 'root';

export type RunMode = 'on-time' | 'catch-up' | 'manual';

/* ────────────────────────── what a task does ────────────────────────── */

export type TaskAction =
  | { kind: 'journal.write' }
  | { kind: 'agent.run'; target: string | null; brief: string | null; prompt: string | null }
  | { kind: 'notify'; message: string }
  | { kind: 'unsupported'; reason: string };

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * A task's action, from its `action` object and its task fields.
 *
 * The node's own fields (`taskTarget`, `taskBrief`, `taskPrompt`) win over the same keys inside
 * `action`, because they are what the editor shows. `journal.write`, `agent.run` and `notify` (a
 * Windows toast carrying `action.message`) run. The older `jarvis.headless` value stays VALID board
 * data but does nothing, and says why: treating it as "run a Prime session" would have started
 * unannounced sessions from tasks written before a scheduler existed, like StoryOS's weekly word
 * count.
 */
export function resolveTaskAction(
  node: Pick<BoardNode, 'action' | 'taskTarget' | 'taskBrief' | 'taskPrompt'>
): TaskAction {
  const action = node.action ?? {};
  const type = str(action['type']) ?? '';
  switch (type) {
    case 'journal.write':
      return { kind: 'journal.write' };
    case 'agent.run':
      return {
        kind: 'agent.run',
        target: str(node.taskTarget) ?? str(action['target']),
        brief: str(node.taskBrief) ?? str(action['brief']),
        prompt: str(node.taskPrompt) ?? str(action['prompt'])
      };
    case 'jarvis.headless':
      return { kind: 'unsupported', reason: 'HEADLESS RUNS ARRIVE WITH THE SUPERVISION LOOP — SET THE ACTION TO {"type":"agent.run"} TO RUN A PRIME SESSION' };
    case 'notify': {
      const message = str(action['message']);
      return message
        ? { kind: 'notify', message }
        : { kind: 'unsupported', reason: 'NOTHING TO SAY — PUT "message" INSIDE THE ACTION' };
    }
    case '':
      return { kind: 'unsupported', reason: 'THIS TASK HAS NO ACTION TYPE' };
    default:
      return { kind: 'unsupported', reason: `UNKNOWN ACTION "${type}" — USE agent.run OR journal.write` };
  }
}

export function describeTaskAction(action: TaskAction): string {
  switch (action.kind) {
    case 'journal.write': return 'write the Obsidian journal note';
    case 'agent.run': return `fresh session on ${action.target ?? 'JARVIS Prime'}${action.brief ? ` · brief ${action.brief}` : ''}`;
    case 'notify': return `a Windows toast: "${action.message}"`;
    case 'unsupported': return `nothing: ${action.reason}`;
  }
}

/* ────────────────────────── when a task runs ────────────────────────── */

export interface TaskState {
  /** When the scheduler first saw this task. No slot before it is ever caught up. */
  firstSeen: string;
  /** The last slot a scheduled run was started for. */
  lastSlot?: string;
  lastResult?: { ok: boolean; message: string; mode: RunMode; at: string };
}

export interface SchedulerState {
  version: 1;
  /** By `<boardId>.<nodeId>`. */
  tasks: Record<string, TaskState>;
  /** When each scheduled run in the last two days started, for the daily cap. */
  runs: string[];
}

export function emptySchedulerState(): SchedulerState {
  return { version: 1, tasks: {}, runs: [] };
}

/** Whatever was on disk, made safe to use. A mangled file costs the history, never a crash. */
export function normaliseSchedulerState(raw: unknown): SchedulerState {
  if (!raw || typeof raw !== 'object') return emptySchedulerState();
  const source = raw as Partial<SchedulerState>;
  const tasks: Record<string, TaskState> = {};
  for (const [key, value] of Object.entries(source.tasks ?? {})) {
    if (!value || typeof value !== 'object' || typeof (value as TaskState).firstSeen !== 'string') continue;
    tasks[key] = value as TaskState;
  }
  const runs = Array.isArray(source.runs) ? source.runs.filter((r): r is string => typeof r === 'string') : [];
  return { version: 1, tasks, runs };
}

export interface ScheduledTask {
  key: string;
  boardId: string;
  node: BoardNode;
}

export interface RunDecision {
  key: string;
  run: boolean;
  reason: string;
  slot?: string;
  mode?: RunMode;
}

export function catchUpWindowMs(node: Pick<BoardNode, 'catchUpHours'>): number {
  const hours = typeof node.catchUpHours === 'number' && Number.isFinite(node.catchUpHours)
    ? Math.min(MAX_CATCH_UP_HOURS, Math.max(0, node.catchUpHours))
    : DEFAULT_CATCH_UP_HOURS;
  return Math.max(hours * 3_600_000, ON_TIME_MS);
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * One tick's decisions. Returns the new state with every slot that is about to run already marked,
 * so the caller persists it BEFORE launching anything.
 */
export function planRuns(
  tasks: readonly ScheduledTask[],
  state: SchedulerState,
  now: Date,
  maxPerDay = MAX_SCHEDULED_RUNS_PER_DAY
): { decisions: RunDecision[]; state: SchedulerState } {
  const next: SchedulerState = {
    version: 1,
    tasks: {},
    runs: state.runs.filter((r) => now.getTime() - Date.parse(r) < 2 * 86_400_000)
  };
  const decisions: RunDecision[] = [];

  for (const task of tasks) {
    const entry: TaskState = state.tasks[task.key] ? { ...state.tasks[task.key]! } : { firstSeen: now.toISOString() };
    next.tasks[task.key] = entry;
    const skip = (reason: string): void => { decisions.push({ key: task.key, run: false, reason }); };

    if (task.node.enabled === false) { skip('disabled'); continue; }
    const parsed = parseCron(task.node.schedule ?? '');
    if (!parsed.ok) { skip(`bad schedule: ${parsed.error}`); continue; }

    const slot = latestSlot(parsed.spec, now, catchUpWindowMs(task.node));
    if (!slot) { skip('no slot due'); continue; }
    if (slot.getTime() < Date.parse(entry.firstSeen) - ON_TIME_MS) {
      skip('slot predates this task — a task never catches up on its first sight');
      continue;
    }
    if (entry.lastSlot && Date.parse(entry.lastSlot) >= slot.getTime()) { skip('already ran for this slot'); continue; }

    const today = next.runs.filter((r) => sameLocalDay(new Date(r), now)).length;
    if (today >= maxPerDay) { skip(`daily cap of ${maxPerDay} scheduled runs reached`); continue; }

    const mode: RunMode = now.getTime() - slot.getTime() <= ON_TIME_MS ? 'on-time' : 'catch-up';
    entry.lastSlot = slot.toISOString();
    next.runs.push(now.toISOString());
    decisions.push({
      key: task.key,
      run: true,
      reason: mode === 'on-time' ? 'due now' : 'missed while SkynetOS was closed — catching up once',
      slot: slot.toISOString(),
      mode
    });
  }
  // Tasks deleted from the board are forgotten with their history.
  return { decisions, state: next };
}

export function recordResult(
  state: SchedulerState,
  key: string,
  result: { ok: boolean; message: string },
  mode: RunMode,
  at: Date
): SchedulerState {
  const entry = state.tasks[key] ?? { firstSeen: at.toISOString() };
  return {
    ...state,
    tasks: { ...state.tasks, [key]: { ...entry, lastResult: { ok: result.ok, message: result.message, mode, at: at.toISOString() } } }
  };
}

/**
 * The next scheduled run after `now`, or null with the reason. For the inspector, which prints the
 * reason after "NOT SCHEDULED —", so each one ends in what to do about it.
 */
export function nextRunFor(node: Pick<BoardNode, 'schedule' | 'enabled'>, now: Date): { next: string | null; error?: string } {
  if (node.enabled === false) return { next: null, error: 'SWITCHED OFF. TICK ENABLED IN THE EDITOR TO RUN IT' };
  const parsed = parseCron(node.schedule ?? '');
  if (!parsed.ok) return { next: null, error: parsed.error };
  const at = nextRun(parsed.spec, now);
  return at
    ? { next: at.toISOString() }
    : { next: null, error: 'NO SUCH DATE IN THE NEXT FIVE YEARS. CHECK THE DAY AND MONTH FIELDS' };
}

/** What the inspector shows for a task. */
export interface TaskStatusView {
  enabled: boolean;
  schedule: string;
  next: string | null;
  error?: string;
  action: string;
  last: TaskState['lastResult'] | null;
}

/* ────────────────────────── what a run does ────────────────────────── */

export type DispatchPlan =
  | { do: 'journal' }
  | { do: 'session'; boardId: string; targetId: string; prompt: string }
  | { do: 'notify'; title: string; message: string }
  | { do: 'refuse'; reason: string };

export interface DispatchContext {
  boardId: string;
  node: BoardNode;
  action: TaskAction;
  mode: RunMode;
  slot: string | null;
  nodesOf: (boardId: string) => readonly BoardNode[];
  /** The brief's text, read by the caller; null when there is no brief or it could not be read. */
  briefText: string | null;
}

function localStamp(iso: string | null): string {
  if (!iso) return 'now';
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** How a task is named to a person: its designator, then its name. */
function taskLabel(node: BoardNode): string {
  return `${node.designator ? `${node.designator} ` : ''}${node.name}`;
}

/** The task a scheduled session opens holding: who set it, when it fired, then the brief. */
export function scheduledPrompt(ctx: DispatchContext, body: string): string {
  const label = taskLabel(ctx.node);
  const when = ctx.mode === 'manual'
    ? 'because William pressed Run now'
    : ctx.mode === 'catch-up'
      ? `as a catch-up for the ${localStamp(ctx.slot)} slot, missed while SkynetOS was closed`
      : `on time for the ${localStamp(ctx.slot)} slot`;
  return [
    `SCHEDULED RUN. "${label}" (cron ${ctx.node.schedule ?? '?'}) fired ${when}.`,
    '',
    'This is a standing task William configured on the board, not something he typed just now, and he',
    'may be away. Do not wait on him: work within the brief\'s bounds, commit nothing, delete nothing,',
    'and leave every change uncommitted for his review. Report what you did in handoff.md and in a',
    'to-face mailbox note before you stop.',
    '',
    '---',
    '',
    body
  ].join('\n');
}

export function planDispatch(ctx: DispatchContext): DispatchPlan {
  const refuse = (reason: string): DispatchPlan => ({ do: 'refuse', reason });
  const { action, node } = ctx;

  if (action.kind === 'unsupported') return refuse(action.reason);
  if (action.kind === 'journal.write') {
    return node.journalVault?.trim() ? { do: 'journal' } : refuse('NO JOURNAL VAULT SET ON THIS TASK');
  }
  // The toast is titled with the task's own name, so the message can be the reminder alone.
  if (action.kind === 'notify') return { do: 'notify', title: taskLabel(node), message: action.message };

  let boardId = ctx.boardId;
  let target: BoardNode | null | undefined;
  if (action.target) {
    target = ctx.nodesOf(ctx.boardId).find((n) => n.id === action.target);
    if (!target && ctx.boardId !== SCHEDULE_ROOT_BOARD) {
      target = ctx.nodesOf(SCHEDULE_ROOT_BOARD).find((n) => n.id === action.target);
      if (target) boardId = SCHEDULE_ROOT_BOARD;
    }
    if (!target) return refuse(`NO NODE "${action.target}" ON THIS BOARD OR THE ROOT BOARD`);
  } else {
    target = pickHandsNode(ctx.nodesOf(SCHEDULE_ROOT_BOARD));
    boardId = SCHEDULE_ROOT_BOARD;
    if (!target) return refuse('NO JARVIS PRIME ON THE ROOT BOARD — TAG ONE AGENT "hands"');
  }

  if (target.kind !== 'agent.code') return refuse(`${target.id} IS A ${target.kind}, NOT A CLAUDE CODE AGENT`);
  if (target.launch === 'popout-elevated') {
    return refuse(`SCHEDULED RUNS ARE NEVER ELEVATED — ${target.id} LAUNCHES ELEVATED (docs/07)`);
  }
  if (action.brief && ctx.briefText === null) return refuse(`BRIEF NOT FOUND — ${action.brief}`);

  const body = [ctx.briefText?.trim(), action.prompt].filter((part): part is string => Boolean(part));
  if (!body.length) return refuse('NOTHING TO DO — SET A BRIEF OR A PROMPT ON THIS TASK');

  return { do: 'session', boardId, targetId: target.id, prompt: scheduledPrompt(ctx, body.join('\n\n')) };
}
