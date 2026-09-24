import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

/**
 * One SkynetOS at a time, and the NEWEST one wins.
 *
 * William: "detect an already open version, closes it, and opens a refreshed version." Electron's
 * usual single-instance pattern is the opposite: the second copy quits and the first is focused.
 * Here a second copy means "I have a fresher build", so the running copy is the one that goes:
 *
 *   1. The new copy calls requestSingleInstanceLock() and loses, which fires `second-instance` in
 *      the running copy.
 *   2. The running copy quits cleanly through the ordinary will-quit path: control pipe, services,
 *      conversation windows, watchers, database.
 *   3. The new copy keeps asking for the lock until it gets it, or gives up after 15 s.
 *
 * Step 3 was measured, not assumed. On Electron 44, with a throwaway pair of processes under their
 * own app name, a copy that lost the lock got it on its second retry, 620 ms in, once the holder
 * had quit. Every retry signals the holder again, so the hand-over below is idempotent.
 *
 * Claude Code terminals are separate processes and outlive the swap. The new copy re-adopts them
 * through restoreSessions() at startup, as after any restart.
 */

const TAKEOVER_TIMEOUT_MS = 15_000;
const POLL_MS = 250;

function pidFile(): string {
  return join(app.getPath('userData'), 'instance.pid');
}

function readInstancePid(): number | null {
  try {
    const pid = Number.parseInt(readFileSync(pidFile(), 'utf8').trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** Written once this copy holds the lock, so a newer copy can say who it is replacing. */
function recordInstance(): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(pidFile(), String(process.pid), 'ascii');
  } catch { /* a missing note costs a log line, nothing more */ }
  app.on('will-quit', () => {
    try {
      if (readInstancePid() === process.pid) rmSync(pidFile(), { force: true });
    } catch { /* already gone */ }
  });
}

let handingOver = false;

/**
 * Take the single-instance lock, waiting for a running copy to close if there is one. Resolves
 * true when this copy may start, false when it should quit without doing anything.
 *
 * Called at module load, before app ready: the lock has to be taken before a window exists.
 */
export async function claimSingleInstance(): Promise<boolean> {
  app.on('second-instance', () => {
    if (handingOver) return;
    handingOver = true;
    console.log('[instance] a newer SkynetOS started — closing so it can take over');
    app.quit();
  });

  if (app.requestSingleInstanceLock()) {
    console.log(`[instance] primary copy, pid ${process.pid}`);
    recordInstance();
    return true;
  }

  const old = readInstancePid();
  console.log(`[instance] SkynetOS is already running${old ? ` (pid ${old})` : ''} — asked it to close so this copy can take over`);
  const started = Date.now();
  while (Date.now() - started < TAKEOVER_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (app.requestSingleInstanceLock()) {
      console.log(`[instance] took over after ${Date.now() - started} ms`);
      recordInstance();
      return true;
    }
  }
  console.error(`[instance] the running copy did not close within ${TAKEOVER_TIMEOUT_MS / 1000} s — leaving it running and quitting this one`);
  return false;
}
