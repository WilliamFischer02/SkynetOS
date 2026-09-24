import { readdirSync, realpathSync, statSync, type Dirent } from 'node:fs';
import { dialog, shell, type WebContents } from 'electron';
import type { BoardNode } from '@shared/types.js';
import {
  EXPLORER_MAX_ENTRIES,
  extensionOf,
  isHiddenName,
  isInside,
  isRunnable,
  joinInside,
  normaliseAbs,
  relativeInside,
  sortEntries,
  type ExplorerEntry,
  type ExplorerListing
} from '@shared/explorer.js';
import { isBroken, needsConfirmation } from '@shared/targets.js';
import { expandPath, resolveNodeTarget } from './target-resolver.js';
import { boardWindow } from './main-window.js';
import { dragPathOut, type DragOutResult } from './drag-out.js';
import { openWithEditor } from './editors.js';
import { refuseDialogWhenRemote } from './remote-context.js';

/**
 * The disk half of the explorer node. See packages/shared/explorer.ts for the pure half.
 *
 * Read-only by construction: nothing here writes, renames, moves or deletes. The only effects are
 * a listing, the default app opening a file (confirmed when it would RUN something), and a file
 * handed to Windows as a drag.
 *
 * ── The root is a wall ────────────────────────────────────────────────────────────────────────
 *
 * Every request names a path RELATIVE to the node's root. It is refused outright if its spelling
 * could climb out (`..`, a drive letter, a stream name), and then the REAL path — junctions and
 * symlinks resolved by the OS — must still be inside the REAL root. A junction in a research
 * folder pointing at C:/Windows lists as a folder and is refused the moment you try to enter it.
 */

type RootResult =
  | { ok: true; raw: string; real: string; outsideRoots: boolean }
  | { ok: false; raw: string; error: string };

const toWindowsPath = (path: string): string => path.replace(/\//g, '\\');

/**
 * A native yes/no, parented to the board window. Its own small copy rather than shell-opener's:
 * that module brings the session database in with it, and this one is tested without Electron.
 */
async function confirm(title: string, message: string, detail: string, confirmLabel: string): Promise<boolean> {
  refuseDialogWhenRemote(`"${title}"`);
  const win = boardWindow();
  const options = {
    type: 'warning' as const,
    buttons: [confirmLabel, 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title,
    message,
    detail,
    noLink: true
  };
  const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  return response === 0;
}

function realPath(path: string): string {
  return normaliseAbs(realpathSync.native(path));
}

export function explorerRoot(node: BoardNode): RootResult {
  const raw = node.path ?? '';
  if (node.kind !== 'store.explorer') return { ok: false, raw, error: `${node.kind} IS NOT A FILE EXPLORER` };
  const target = resolveNodeTarget(node);
  if (isBroken(target) || !target.resolved) {
    return { ok: false, raw, error: target.detail ?? 'ROOT FOLDER DID NOT RESOLVE' };
  }
  try {
    return { ok: true, raw, real: realPath(target.resolved), outsideRoots: needsConfirmation(target) };
  } catch (err) {
    return { ok: false, raw, error: `CANNOT READ THE ROOT FOLDER — ${(err as Error).message}` };
  }
}

/** A relative path, checked twice: by its spelling, then by where the OS says it really is. */
export function resolveInside(realRoot: string, rel: string):
  { ok: true; abs: string; rel: string } | { ok: false; error: string } {
  const joined = joinInside(realRoot, rel);
  if (joined === null) return { ok: false, error: `OUTSIDE THE EXPLORER ROOT — "${rel}"` };
  let resolved: string;
  try {
    resolved = realPath(joined);
  } catch {
    return { ok: false, error: `NOT FOUND — ${joined}` };
  }
  if (!isInside(realRoot, resolved)) {
    return { ok: false, error: `LEADS OUTSIDE THE EXPLORER ROOT — ${joined} is really ${resolved}` };
  }
  return { ok: true, abs: resolved, rel: relativeInside(realRoot, joined) ?? '' };
}

/** Where the window rests, relative to the root, or why the node's `restPath` cannot be used. */
function restOf(node: BoardNode, realRoot: string): { rest: string | null; refused?: string } {
  if (!node.restPath) return { rest: null };
  const expanded = expandPath(node.restPath);
  let resolved: string;
  try {
    resolved = realPath(expanded);
  } catch {
    return { rest: null, refused: `RESTING FOLDER NOT FOUND — ${expanded}` };
  }
  const rel = relativeInside(realRoot, resolved);
  if (rel === null) return { rest: null, refused: `RESTING FOLDER IS OUTSIDE THE ROOT — ${expanded}` };
  try {
    if (!statSync(resolved).isDirectory()) return { rest: null, refused: `RESTING FOLDER IS A FILE — ${expanded}` };
  } catch {
    return { rest: null, refused: `RESTING FOLDER CANNOT BE READ — ${expanded}` };
  }
  return { rest: rel };
}

function entryFor(dir: string, dirent: Dirent): ExplorerEntry {
  let isDir = dirent.isDirectory();
  let size: number | null = null;
  let mtime: number | null = null;
  try {
    // stat, not lstat: it follows a link, so a junction to a folder lists as the folder it is.
    const info = statSync(`${dir}/${dirent.name}`);
    isDir = info.isDirectory();
    size = isDir ? null : info.size;
    mtime = Math.round(info.mtimeMs);
  } catch {
    // A broken link, a locked system file: listed with what the directory entry itself says.
  }
  return {
    name: dirent.name,
    kind: isDir ? 'dir' : 'file',
    size,
    mtime,
    ext: isDir ? '' : extensionOf(dirent.name),
    ...(dirent.isSymbolicLink() ? { link: true } : {})
  };
}

/**
 * One folder of an explorer node. `rel` null means "wherever it rests": the resting folder if it is
 * set and usable, the root otherwise.
 */
export function listExplorer(node: BoardNode, rel: string | null): ExplorerListing {
  const root = explorerRoot(node);
  if (!root.ok) return { ok: false, root: root.raw, rel: '', rest: null, entries: [], truncated: false, error: root.error };

  const { rest, refused } = restOf(node, root.real);
  const base = { root: root.raw, rest, truncated: false, ...(refused ? { restRefused: refused } : {}) };
  const place = resolveInside(root.real, rel ?? rest ?? '');
  if (!place.ok) return { ok: false, ...base, rel: rel ?? '', entries: [], error: place.error };

  let dirents: Dirent[];
  try {
    dirents = readdirSync(place.abs, { withFileTypes: true });
  } catch (err) {
    return { ok: false, ...base, rel: place.rel, entries: [], error: `CANNOT LIST THIS FOLDER — ${(err as Error).message}` };
  }

  const entries: ExplorerEntry[] = [];
  let truncated = false;
  for (const dirent of dirents) {
    if (isHiddenName(dirent.name)) continue;
    if (entries.length >= EXPLORER_MAX_ENTRIES) { truncated = true; break; }
    entries.push(entryFor(place.abs, dirent));
  }
  return { ok: true, ...base, rel: place.rel, entries: sortEntries(entries), truncated };
}

/**
 * Open an entry with its default app, or show it in Windows Explorer.
 *
 * docs/07: a target outside every dev root is confirmed on every activation, and so is anything
 * that runs code — a script or program in a downloads-and-research folder is exactly the file that
 * must never start on a stray double-click.
 */
export async function openExplorerItem(node: BoardNode, rel: string, mode: 'open' | 'reveal' | 'notepadpp' | 'obsidian'):
  Promise<{ ok: boolean; action?: string; error?: string }> {
  const root = explorerRoot(node);
  if (!root.ok) return { ok: false, error: root.error };
  const place = resolveInside(root.real, rel);
  if (!place.ok) return { ok: false, error: place.error };
  const windowsPath = toWindowsPath(place.abs);

  if (mode === 'reveal') {
    shell.showItemInFolder(windowsPath);
    return { ok: true, action: `revealed in Explorer: ${place.abs}` };
  }

  /*
   * A named editor. It opens a document and runs nothing, so it needs no run confirmation, but it
   * gets the same outside-the-dev-roots question an ordinary open gets.
   */
  if (mode === 'notepadpp' || mode === 'obsidian') {
    let isFolder = false;
    try { isFolder = statSync(place.abs).isDirectory(); } catch { return { ok: false, error: `NOT FOUND — ${place.abs}` }; }
    if (isFolder) return { ok: false, error: 'THAT IS A FOLDER — AN EDITOR NEEDS A FILE' };
    if (root.outsideRoots) {
      const proceed = await confirm(
        'Open a file outside your dev roots?',
        place.abs.slice(place.abs.lastIndexOf('/') + 1),
        `${place.abs}\n\nNot under any configured dev root or your user profile.`,
        'Open'
      );
      if (!proceed) return { ok: false, error: 'CANCELLED' };
    }
    return openWithEditor(mode, place.abs);
  }

  const name = place.abs.slice(place.abs.lastIndexOf('/') + 1);
  let isDir = false;
  try { isDir = statSync(place.abs).isDirectory(); } catch { /* opened below; the shell reports it */ }

  const runs = !isDir && isRunnable(name);
  if (runs || root.outsideRoots) {
    const proceed = await confirm(
      runs ? 'Run this file?' : 'Open a file outside your dev roots?',
      name,
      `${place.abs}\n\n` + (runs
        ? 'This file type runs code rather than opening a document. SkynetOS is not elevated, and neither is this.'
        : `Not under any configured dev root or your user profile.`),
      runs ? 'Run' : 'Open'
    );
    if (!proceed) return { ok: false, error: 'CANCELLED' };
  }

  const failure = await shell.openPath(windowsPath);
  return failure ? { ok: false, error: failure } : { ok: true, action: `opened ${name}` };
}

/** Hand one file from the explorer to Windows as a real drag. Files only: a folder dragged into a chat is an accident. */
export async function dragExplorerItem(sender: WebContents, node: BoardNode, rel: string): Promise<DragOutResult> {
  const root = explorerRoot(node);
  if (!root.ok) return { ok: false, error: root.error };
  const place = resolveInside(root.real, rel);
  if (!place.ok) return { ok: false, error: place.error };
  try {
    if (!statSync(place.abs).isFile()) return { ok: false, error: 'ONLY FILES CAN BE DRAGGED OUT' };
  } catch {
    return { ok: false, error: `NOT FOUND — ${place.abs}` };
  }
  return dragPathOut(sender, place.abs);
}
