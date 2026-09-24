import { existsSync } from 'node:fs';
import { dirname, isAbsolute, normalize } from 'node:path';
import { dialog } from 'electron';
import { boardWindow } from './main-window.js';
import { refuseDialogWhenRemote } from './remote-context.js';
import type { PickRequest, PickResult } from '@shared/ipc.js';
import { boardRoot } from './board-store.js';
import { homedir } from 'node:os';
import { expandPath, skynetRoot } from './target-resolver.js';
import { getSettings } from './settings.js';

/**
 * Native file and folder pickers — the interface that makes a node point at something real.
 *
 * The renderer never sees a filesystem; it asks for a pick and gets back a path string. The
 * dialog opens where the user is most likely to want it: the field's current value if that
 * resolves, then its parent directory, then the first dev root. A picker that always starts at
 * "This PC" is a picker people stop using, and a field people type into by hand is a field with
 * typos in it — which the board then renders as broken hardware.
 */

function startingDirectory(current: string | undefined, control: PickRequest['control']): string {
  const settings = getSettings();
  if (control === 'board-file') return boardRoot();

  if (current) {
    const expanded = expandPath(current);
    if (isAbsolute(expanded)) {
      // A glob's directory part is concrete even though the pattern is not.
      const candidate = expanded.includes('*') ? dirname(expanded) : expanded;
      if (existsSync(candidate)) return candidate;
      const parent = dirname(candidate);
      if (existsSync(parent)) return parent;
    }
  }
  const firstRoot = settings.devRoots.find((r) => existsSync(r));
  return firstRoot ?? boardRoot();
}

export async function pick(request: PickRequest): Promise<PickResult> {
  refuseDialogWhenRemote('a file picker');
  // The board window, not getAllWindows()[0], which is the Face's window once that has been
  // opened. See services/main-window.ts.
  const win = boardWindow();
  // The platform's separators: every value above is board spelling, with forward slashes, and
  // the shell's file dialog should be handed a Windows path.
  const defaultPath = normalize(startingDirectory(request.current, request.control));

  const wantsDirectory = request.control === 'path-dir';

  const options: Electron.OpenDialogOptions = {
    title: request.title ?? (wantsDirectory ? 'Select a folder' : 'Select a file'),
    defaultPath,
    buttonLabel: 'Bind to this',
    properties: wantsDirectory
      ? ['openDirectory', 'dontAddToRecent']
      : ['openFile', 'dontAddToRecent'],
    ...(request.filters?.length && !wantsDirectory
      ? { filters: [...request.filters.map((f) => ({ name: f.name, extensions: [...f.extensions] })), { name: 'All files', extensions: ['*'] }] }
      : {})
  };

  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  const chosen = result.filePaths[0];
  if (result.canceled || !chosen) return { cancelled: true, value: null };

  // Board data is written with forward slashes throughout, so normalise at the boundary rather
  // than letting a backslash path leak into JSON that also contains forward-slash paths.
  const forward = chosen.replace(/\\/g, '/');

  if (request.control === 'board-file') {
    const root = boardRoot().replace(/\\/g, '/');
    const relative = forward.toLowerCase().startsWith(root.toLowerCase())
      ? forward.slice(root.length).replace(/^\//, '')
      : null;
    if (!relative) {
      return { cancelled: false, value: null, error: `THAT FILE IS OUTSIDE board/ — ${forward}` };
    }
    return { cancelled: false, value: relative };
  }

  const stored = portableSpelling(forward, skynetRoot(), homedir());

  if (request.control === 'glob') {
    // Picking a concrete file for a glob field is the common case: the user points at the jar
    // that exists today and wants "the newest one like this" from then on. Generalise the
    // extension and say so, rather than storing a pattern that can only ever match one build.
    const match = /^(.*)\/([^/]*?)(\.[^./]+)$/.exec(stored);
    if (match) {
      const [, dir, , ext] = match;
      return { cancelled: false, value: `${dir}/*${ext}`, note: `Generalised to *${ext} — the node will follow the newest match.` };
    }
    return { cancelled: false, value: stored };
  }

  return { cancelled: false, value: stored };
}

/**
 * The spelling a board should store for a picked path.
 *
 * `npm run paths:check` fails the build on an absolute path into this repo or the user profile,
 * because it resolves on one machine only. The picker returned exactly that: browsing to a sprite
 * in assets/ stored `C:/dev/SkynetOS/assets/...`, and the two backdrops added on 2026-09-11 turned
 * verify red. So a path inside the repo becomes `%SKYNET%/...` and one under the profile
 * `%USERPROFILE%/...`, the same rewrite tools/portable-paths.mjs makes. Anything else is a true
 * statement about this machine and is left alone.
 */
export function portableSpelling(path: string, repo: string, home: string): string {
  const p = path.replace(/\\/g, '/');
  const under = (root: string): string | null => {
    const r = root.replace(/\\/g, '/').replace(/\/+$/, '');
    return r && p.toLowerCase().startsWith(`${r.toLowerCase()}/`) ? p.slice(r.length + 1) : null;
  };
  const inRepo = under(repo);
  if (inRepo !== null) return `%SKYNET%/${inRepo}`;
  const inHome = under(home);
  if (inHome !== null) return `%USERPROFILE%/${inHome}`;
  return p;
}
