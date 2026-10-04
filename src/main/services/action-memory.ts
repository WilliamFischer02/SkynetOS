import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { normalisePlan, type DesktopPlan } from '@shared/desktop.js';
import { forgetIn, parseMemoryFile, recallFrom, rememberIn, type ActionMemoryEntry } from '@shared/action-memory.js';
import { desktopMonitors, ensureHelper, helperWindows, listApps } from './desktop.js';

/**
 * Action memory (docs/11 § Reaching into windows, the board, and a terminal).
 *
 * After a PLANNER plan runs to completion, `rememberPlan` keeps `{key, sentence, steps, windows,
 * at, successes}` in `%APPDATA%/SkynetOS/desktop/action-memory.json` (never the repo), at most 200
 * entries. The next time the same sentence arrives (`memoryKey`: case, punctuation, "please",
 * "jarvis", "could you" and other fillers do not count), `recallPlan` hands the planner the
 * remembered plan instead of asking the model, and the planner reads it back as "Same as last
 * time." (SAME_AS_LAST_TIME) through its own read-back, pause, turn and `runPlan`: the same switch,
 * twelve-step cap and halt as any plan. A remembered plan is re-checked by `normalisePlan` against
 * today's catalogue before it is handed over; a failure evicts it (`forgetPlan`).
 *
 * The hook is two lines in services/planner.ts `planAndRun` (the turn engine's file):
 *   const remembered = recallPlan(heard);
 *   const outcome = remembered ? { ok: true, plan: remembered, say: SAME_AS_LAST_TIME } : await planDesktop(heard);
 * and after `runPlan`:
 *   if (result.ok) rememberPlan(heard, plan); else forgetPlan(heard);
 */

/** The read-back line for a remembered plan, in place of the model's `say`. */
export const SAME_AS_LAST_TIME = 'Same as last time.';

let cache: ActionMemoryEntry[] | null = null;

function file(): string {
  const dir = join(app.getPath('userData'), 'desktop');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'action-memory.json');
}

function load(): ActionMemoryEntry[] {
  if (cache) return cache;
  try {
    const path = file();
    cache = existsSync(path) ? parseMemoryFile(JSON.parse(readFileSync(path, 'utf8'))) : [];
  } catch (err) {
    console.warn('[action-memory] could not read the memory, starting empty:', (err as Error).message);
    cache = [];
  }
  return cache;
}

function save(entries: ActionMemoryEntry[]): void {
  cache = entries;
  try {
    const path = file();
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, entries }, null, 2) + '\n', 'utf8');
    renameSync(tmp, path);
  } catch (err) {
    console.warn('[action-memory] could not write the memory:', (err as Error).message);
  }
}

/** The remembered plan for a sentence, re-checked by today's rules, or null (and forgotten if it no longer passes). */
export function recallPlan(sentence: string): DesktopPlan | null {
  const entry = recallFrom(load(), sentence);
  if (!entry) return null;
  const checked = normalisePlan(entry.steps, { apps: listApps(), monitors: desktopMonitors().length || 1 });
  if (checked.dropped.length || !checked.steps.length) {
    console.log(`[action-memory] "${entry.sentence}" no longer passes the rules (${checked.dropped[0] ?? 'no steps'}); forgotten`);
    forgetPlan(sentence);
    return null;
  }
  return { source: 'planner', heard: sentence, steps: checked.steps };
}

/** Remember a plan that ran to completion, with the windows open at the time as context. */
export function rememberPlan(sentence: string, plan: DesktopPlan): void {
  const at = new Date().toISOString();
  const write = (windows: string[]): void => save(rememberIn(load(), sentence, plan.steps, windows, at));
  void ensureHelper()
    .then((up) => (up ? helperWindows() : []))
    .then((wins) => write(wins.map((w) => w.process).filter(Boolean)))
    .catch(() => write([]));
}

export function forgetPlan(sentence: string): void {
  const before = load();
  const after = forgetIn(before, sentence);
  if (after.length !== before.length) save(after);
}
