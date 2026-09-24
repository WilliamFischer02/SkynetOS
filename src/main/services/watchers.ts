import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { Board } from '@shared/types.js';
import { leadsTo, planWatch } from '@shared/watch-plan.js';
import { expandPath } from './target-resolver.js';

/**
 * File watchers: the board notices when a jar rebuilds or a manuscript is saved.
 *
 * ── The polling fallback, and why it is not optional ──────────────────────────────────────────
 * CLAUDE.md: "File watchers on network/OneDrive paths are unreliable. Fall back to polling with a
 * 5s interval when the path is not on a local fixed disk."
 *
 * Native change notifications come from the filesystem driver. A UNC share, a mapped network
 * drive, or a cloud-sync folder that materialises files on demand may deliver them late, coalesce
 * them, or not send them at all — and the failure is silent, which is the worst kind: the board
 * would simply stop noticing that a file changed and look correct while doing it. `usePolling`
 * below decides per path, and it errs toward polling: a few extra stat calls every 5 seconds is a
 * trade worth making against a board that quietly lies.
 */

export type WatchEvent = { boardId: string; nodeIds: string[]; path: string; reason: string };
export type WatchListener = (event: WatchEvent) => void;

const listeners = new Set<WatchListener>();
let watcher: FSWatcher | null = null;
/** Watched directory -> the node ids that care about it. */
let watchMap = new Map<string, Set<string>>();
let currentBoardId = '';
let currentBoard: Board | null = null;
/** An existing ancestor -> the wanted directories it stands in for until they exist. */
let waitingMap = new Map<string, string[]>();
let rearmTimer: ReturnType<typeof setTimeout> | null = null;
const pendingNodes = new Set<string>();
const REARM_MS = 600;

export function onFileChanged(listener: WatchListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Should this path be polled rather than watched natively?
 *
 * Pure and exported so test/watchers.test.ts can pin the rules — this is exactly the kind of
 * heuristic that gets quietly broken by a refactor and shows up months later as "the board
 * stopped noticing my builds".
 */
export function usePolling(path: string): boolean {
  const p = path.replace(/\\/g, '/');

  // UNC share: \\server\share. Never a local fixed disk.
  if (p.startsWith('//')) return true;

  // Cloud-sync roots. These reparse-point their contents and are the exact case CLAUDE.md names.
  if (/\/(onedrive|dropbox|google ?drive|icloud ?drive|box|nextcloud|creative ?cloud files)(\/|$)/i.test(p)) {
    return true;
  }

  // The user's own OneDrive locations, whatever they happen to be called on this machine.
  for (const key of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const root = process.env[key];
    if (root && p.toLowerCase().startsWith(root.replace(/\\/g, '/').toLowerCase())) return true;
  }

  // Anything without a local drive letter. A relative or malformed path is not something to
  // trust a native watcher with either.
  if (!/^[a-z]:\//i.test(p)) return true;

  return false;
}

/**
 * Every directory worth watching on a board, mapped to the nodes that depend on it.
 *
 * Directories, not files: a build replaces a jar rather than editing it, so watching the file
 * itself misses the rebuild entirely. Watching `build/libs` catches the new one arriving.
 */
export function watchTargetsFor(board: Board): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const add = (dir: string, nodeId: string): void => {
    const normalised = dir.replace(/\\/g, '/');
    const set = map.get(normalised) ?? new Set<string>();
    set.add(nodeId);
    map.set(normalised, set);
  };

  for (const node of board.nodes) {
    if (node.kind === 'file.artifact' && node.glob) {
      const expanded = expandPath(node.glob);
      if (!expanded.includes('..')) add(dirname(expanded), node.id);
      continue;
    }
    if ((node.kind === 'file.document' || node.kind === 'file.exe') && node.path) {
      const expanded = expandPath(node.path);
      if (!expanded.includes('..')) add(dirname(expanded), node.id);
    }
  }
  return map;
}

/**
 * Watch everything the given board cares about, replacing any previous watch.
 *
 * One chokidar instance for the whole board rather than one per node: a room with twenty file
 * nodes in the same repo would otherwise open twenty watchers on overlapping trees.
 *
 * A wanted directory that does not exist yet is waited for, through its nearest existing ancestor
 * (packages/shared/watch-plan.ts). A mod that has never been built has no `build/libs`; before
 * 2026-09-21 that meant nothing watched it and its first build was never seen.
 */
export async function watchBoard(board: Board): Promise<{ watched: number; polled: number; waiting: number }> {
  await stopWatching();

  currentBoardId = board.id;
  currentBoard = board;
  watchMap = watchTargetsFor(board);

  const plan = planWatch(watchMap.keys(), existsSync);
  waitingMap = plan.waiting;
  const dirs = [...new Set([...plan.direct, ...plan.waiting.keys()])];
  if (!dirs.length) return { watched: 0, polled: 0, waiting: 0 };

  const polled = dirs.filter(usePolling);
  const anyPolled = polled.length > 0;

  watcher = chokidar.watch(dirs, {
    ignoreInitial: true,
    depth: 0,
    // Chokidar takes one polling setting for the whole instance. If ANY watched directory needs
    // polling, poll them all: a few extra stat calls beats a board that silently stops noticing.
    usePolling: anyPolled,
    interval: 5000,
    binaryInterval: 5000,
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 }
  });

  const send = (nodeIds: string[], path: string, reason: string): void => {
    if (!nodeIds.length) return;
    const event: WatchEvent = { boardId: currentBoardId, nodeIds, path: path.replace(/\\/g, '/'), reason };
    for (const l of listeners) l(event);
  };

  const emit = (path: string, reason: string): void => {
    const dir = dirname(path).replace(/\\/g, '/');
    send([...(watchMap.get(dir) ?? [])], path, reason);
  };

  /*
   * Something appeared or vanished that changes WHAT can be watched: a step on the way to a
   * directory being waited for, or a watched directory itself going (`gradlew clean`). Re-plan
   * after a short pause, because a build makes `build`, `build/libs` and the jar within
   * milliseconds of each other, then tell the nodes concerned. `ignoreInitial` means the new watch
   * will not report a jar that is already there, so the re-plan reports it instead.
   */
  const structural = (path: string, reason: string): void => {
    const p = path.replace(/\\/g, '/');
    const waitingHit = [...waitingMap.values()].flat().filter((wanted) => leadsTo(p, wanted));
    const watchedGone = reason === 'removed' && watchMap.has(p);
    if (!waitingHit.length && !watchedGone) return;
    const nodeIds = new Set<string>();
    for (const wanted of waitingHit) for (const id of watchMap.get(wanted) ?? []) nodeIds.add(id);
    if (watchedGone) for (const id of watchMap.get(p) ?? []) nodeIds.add(id);
    for (const id of nodeIds) pendingNodes.add(id);
    if (rearmTimer) clearTimeout(rearmTimer);
    rearmTimer = setTimeout(() => {
      rearmTimer = null;
      const ids = [...pendingNodes];
      pendingNodes.clear();
      const again = currentBoard;
      if (!again || again.id !== board.id) return;
      void watchBoard(again).then(() => send(ids, p, reason === 'removed' ? 'removed' : 'appeared'));
    }, REARM_MS);
  };

  watcher.on('add', (p) => { emit(p, 'added'); structural(p, 'added'); });
  watcher.on('change', (p) => emit(p, 'changed'));
  watcher.on('unlink', (p) => emit(p, 'removed'));
  watcher.on('addDir', (p) => structural(p, 'added'));
  watcher.on('unlinkDir', (p) => structural(p, 'removed'));
  watcher.on('error', (err) => console.warn(`[watch] ${(err as Error).message}`));

  const waiting = [...plan.waiting.values()].flat().length;
  console.log(
    `[watch] ${plan.direct.length} director${plan.direct.length === 1 ? 'y' : 'ies'} on ${board.id}` +
    `${waiting ? `, waiting for ${waiting} that do not exist yet` : ''}` +
    `${anyPolled ? ` — POLLING at 5s (${polled.length} path(s) are not on a local fixed disk)` : ' — native notifications'}`
  );
  return { watched: plan.direct.length, polled: polled.length, waiting };
}

export async function stopWatching(): Promise<void> {
  if (rearmTimer) { clearTimeout(rearmTimer); rearmTimer = null; }
  if (!watcher) return;
  await watcher.close();
  watcher = null;
  watchMap = new Map();
  waitingMap = new Map();
}
