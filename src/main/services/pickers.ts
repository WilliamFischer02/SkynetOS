import { existsSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { BrowserWindow, dialog } from 'electron';
import type { PickRequest, PickResult } from '@shared/ipc.js';
import { boardRoot } from './board-store.js';
import { expandPath } from './target-resolver.js';
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
  const win = BrowserWindow.getAllWindows()[0];
  const defaultPath = startingDirectory(request.current, request.control);

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

  if (request.control === 'glob') {
    // Picking a concrete file for a glob field is the common case: the user points at the jar
    // that exists today and wants "the newest one like this" from then on. Generalise the
    // extension and say so, rather than storing a pattern that can only ever match one build.
    const match = /^(.*)\/([^/]*?)(\.[^./]+)$/.exec(forward);
    if (match) {
      const [, dir, , ext] = match;
      return { cancelled: false, value: `${dir}/*${ext}`, note: `Generalised to *${ext} — the node will follow the newest match.` };
    }
    return { cancelled: false, value: forward };
  }

  return { cancelled: false, value: forward };
}
