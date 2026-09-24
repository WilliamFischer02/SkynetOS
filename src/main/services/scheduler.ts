import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { app, Notification } from 'electron';
import {
  describeTaskAction,
  nextRunFor,
  normaliseSchedulerState,
  planDispatch,
  planRuns,
  recordResult,
  resolveTaskAction,
  type RunMode,
  type ScheduledTask,
  type SchedulerState,
  type TaskStatusView
} from '@shared/schedule.js';
import { listBoards, loadBoard } from './board-store.js';
import { startSession } from './session-manager.js';
import { writeJournalNote } from './journal.js';
import { expandPath, skynetRoot } from './target-resolver.js';

/**
 * The scheduler: runs `task.scheduled` nodes while SkynetOS is open. Roadmap M8, first half.
 *
 * Every decision is `planRuns` / `planDispatch` in packages/shared/schedule.ts, which is where the
 * rules live and are tested. This file is the clock, the disk and the launcher:
 *
 *  - a tick on every minute boundary, plus one 15 s after launch so a missed morning catches up
 *    promptly;
 *  - `scheduler-state.json` in userData, written BEFORE a run starts (the slot is marked first, so
 *    a crash cannot fire it twice) and again with the result;
 *  - runs one at a time, and a tick that finds the previous one still busy (for instance a
 *    confirmation dialog waiting on William) does nothing.
 *
 * Nothing is registered with Windows. If SkynetOS is closed at 8 am, the morning run happens when
 * it next opens within the task's catch-up window, or not at all.
 */

let timer: ReturnType<typeof setTimeout> | null = null;
let busy = false;
/** The last skip reason logged per task, so "already ran for this slot" is said once, not every minute. */
const lastSaid = new Map<string, string>();

function stateFile(): string {
  return join(app.getPath('userData'), 'scheduler-state.json');
}

function readState(): SchedulerState {
  try {
    return normaliseSchedulerState(JSON.parse(readFileSync(stateFile(), 'utf8')));
  } catch {
    return normaliseSchedulerState(null);
  }
}

function writeState(state: SchedulerState): void {
  const file = stateFile();
  try {
    mkdirSync(dirname(file), { recursive: true });
    // Written beside and renamed over, so a crash mid-write leaves the old state, not half a file.
    writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2), 'utf8');
    renameSync(`${file}.tmp`, file);
  } catch (err) {
    console.warn('[scheduler] could not save state', err);
  }
}

function allTasks(): ScheduledTask[] {
  const out: ScheduledTask[] = [];
  for (const boardId of listBoards()) {
    const load = loadBoard(boardId);
    if (!load.ok) continue;
    for (const node of load.board.nodes) {
      if (node.kind === 'task.scheduled') out.push({ key: `${boardId}.${node.id}`, boardId, node });
    }
  }
  return out;
}

/**
 * A brief named in board JSON: markdown, inside the SkynetOS repo, nowhere else. Board JSON is
 * agent-writable, and a brief is read into a prompt, so it is fenced to the repo's own files.
 */
export function readBrief(ref: string): string | null {
  const root = skynetRoot();
  const abs = (ref.startsWith('%') ? expandPath(ref) : join(root, ref)).replace(/\\/g, '/');
  const rel = relative(root, abs);
  if (rel.startsWith('..') || isAbsolute(rel) || !/\.md$/i.test(abs)) return null;
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

async function execute(task: ScheduledTask, mode: RunMode, slot: string | null): Promise<{ ok: boolean; message: string }> {
  const action = resolveTaskAction(task.node);
  const plan = planDispatch({
    boardId: task.boardId,
    node: task.node,
    action,
    mode,
    slot,
    nodesOf: (id) => {
      const load = loadBoard(id);
      return load.ok ? load.board.nodes : [];
    },
    briefText: action.kind === 'agent.run' && action.brief ? readBrief(action.brief) : null
  });

  switch (plan.do) {
    case 'refuse':
      return { ok: false, message: plan.reason };
    case 'journal': {
      const written = writeJournalNote(task.node);
      return { ok: written.ok, message: written.ok ? written.action : written.error ?? 'COULD NOT WRITE THE JOURNAL NOTE' };
    }
    case 'session': {
      const load = loadBoard(plan.boardId);
      const target = load.ok ? load.board.nodes.find((n) => n.id === plan.targetId) : undefined;
      if (!target) return { ok: false, message: `THE TARGET ${plan.targetId} IS NO LONGER ON THE BOARD` };
      const started = await startSession(plan.boardId, target, { fresh: true, prompt: plan.prompt });
      return started.ok
        ? { ok: true, message: `started a fresh session on ${target.name}${started.note ? ` — ${started.note}` : ''}` }
        : { ok: false, message: started.error };
    }
    case 'notify': {
      // A Windows toast (roadmap M8). Windows files toasts under an App User Model ID; the installer
      // gives the packaged app one, and a dev copy has none, so it borrows electron.exe's.
      if (!Notification.isSupported()) return { ok: false, message: 'THIS SYSTEM CANNOT SHOW TOAST NOTIFICATIONS' };
      if (!app.isPackaged) app.setAppUserModelId(process.execPath);
      new Notification({ title: plan.title, body: plan.message }).show();
      return { ok: true, message: `showed a toast: ${plan.message}` };
    }
  }
}

async function tick(now = new Date()): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const tasks = allTasks();
    const planned = planRuns(tasks, readState(), now);
    // Slots marked BEFORE anything starts: the one-run-per-slot rule survives a crash mid-run.
    writeState(planned.state);

    for (const decision of planned.decisions) {
      if (!decision.run) {
        const quiet = decision.reason === 'no slot due' || decision.reason === 'disabled';
        if (!quiet && lastSaid.get(decision.key) !== decision.reason) {
          console.log(`[scheduler] ${decision.key}: skipped — ${decision.reason}`);
        }
        lastSaid.set(decision.key, decision.reason);
        continue;
      }
      lastSaid.delete(decision.key);
      const task = tasks.find((t) => t.key === decision.key);
      if (!task) continue;
      const mode = decision.mode ?? 'on-time';
      console.log(`[scheduler] ${decision.key}: RUN (${mode}, slot ${decision.slot}) — ${describeTaskAction(resolveTaskAction(task.node))}`);
      let result: { ok: boolean; message: string };
      try {
        result = await execute(task, mode, decision.slot ?? null);
      } catch (err) {
        result = { ok: false, message: (err as Error).message };
      }
      console.log(`[scheduler] ${decision.key}: ${result.ok ? 'ok' : 'FAILED'} — ${result.message}`);
      writeState(recordResult(readState(), decision.key, result, mode, new Date()));
    }
  } catch (err) {
    console.error('[scheduler] tick failed', err);
  } finally {
    busy = false;
  }
}

export function startScheduler(): void {
  if (timer) return;
  console.log('[scheduler] started — task.scheduled nodes run while SkynetOS is open');
  const arm = (): void => {
    const delay = 60_000 - (Date.now() % 60_000) + 250;
    timer = setTimeout(() => { void tick(); arm(); }, delay);
  };
  // One look soon after launch, so a morning missed while the app was closed catches up promptly.
  timer = setTimeout(() => { void tick(); arm(); }, 15_000);
}

export function stopScheduler(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

/** "Run now": the same action path a scheduled run takes. User only; not counted against the daily cap. */
export async function runTaskNow(boardId: string, nodeId: string): Promise<{ ok: boolean; message: string }> {
  const load = loadBoard(boardId);
  if (!load.ok) return { ok: false, message: load.error };
  const node = load.board.nodes.find((n) => n.id === nodeId);
  if (!node || node.kind !== 'task.scheduled') return { ok: false, message: 'THAT IS NOT A SCHEDULED TASK' };
  const key = `${boardId}.${nodeId}`;
  console.log(`[scheduler] ${key}: RUN NOW (manual)`);
  let result: { ok: boolean; message: string };
  try {
    result = await execute({ key, boardId, node }, 'manual', null);
  } catch (err) {
    result = { ok: false, message: (err as Error).message };
  }
  writeState(recordResult(readState(), key, result, 'manual', new Date()));
  return result;
}

export function taskStatus(boardId: string, nodeId: string): TaskStatusView {
  const load = loadBoard(boardId);
  const node = load.ok ? load.board.nodes.find((n) => n.id === nodeId) : undefined;
  if (!node || node.kind !== 'task.scheduled') {
    return { enabled: false, schedule: '', next: null, error: 'NOT A SCHEDULED TASK', action: '', last: null };
  }
  const next = nextRunFor(node, new Date());
  const entry = readState().tasks[`${boardId}.${nodeId}`];
  return {
    enabled: node.enabled !== false,
    schedule: node.schedule ?? '',
    next: next.next,
    ...(next.error ? { error: next.error } : {}),
    action: describeTaskAction(resolveTaskAction(node)),
    last: entry?.lastResult ?? null
  };
}
