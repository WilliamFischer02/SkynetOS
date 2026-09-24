import { spawn } from 'node:child_process';
import { shell } from 'electron';
import { EDITOR_LABELS, notepadPlusPlusCandidates, obsidianOpenUri, type EditorOpenWith } from '@shared/open-with.js';
import { pathExists, which } from './which.js';
import { findVaultRoot } from './obsidian.js';

/**
 * Open a file in Notepad++ or Obsidian. Shared by a node's `openWith` and the explorer window.
 *
 * Both fail legibly rather than falling back to the default app. A node set to "Notepad++" that
 * quietly opened Word instead would be a setting that lies.
 *
 * - Notepad++ is found on PATH or in its usual install folders. `pathExists` rather than
 *   `existsSync`: see which.ts on Windows app aliases.
 * - Obsidian can only open a note inside a vault it knows, so the file is checked for a vault (a
 *   `.obsidian` folder at or above it) before the URI goes out. Otherwise Obsidian answers with a
 *   "vault not found" dialog that says nothing useful.
 */

export function findNotepadPlusPlus(): string | null {
  const onPath = which('notepad++');
  if (onPath) return onPath;
  for (const candidate of notepadPlusPlusCandidates(process.env)) {
    if (pathExists(candidate)) return candidate;
  }
  return null;
}

export async function openWithEditor(
  editor: EditorOpenWith,
  absPath: string
): Promise<{ ok: boolean; action?: string; error?: string }> {
  const windowsPath = absPath.replace(/\//g, '\\');

  if (editor === 'notepadpp') {
    const exe = findNotepadPlusPlus();
    if (!exe) {
      return { ok: false, error: 'NOTEPAD++ IS NOT INSTALLED ON THIS MACHINE — winget install Notepad++.Notepad++' };
    }
    try {
      // Arguments as an array: a path with spaces reaches Notepad++ as one argument, no shell involved.
      const child = spawn(exe, [windowsPath], { detached: true, stdio: 'ignore', windowsHide: false });
      child.on('error', () => undefined);
      child.unref();
    } catch (err) {
      return { ok: false, error: `NOTEPAD++ DID NOT START — ${(err as Error).message.split('\n')[0]}` };
    }
    return { ok: true, action: `opened in ${EDITOR_LABELS.notepadpp}: ${absPath}` };
  }

  const vault = findVaultRoot(absPath);
  if (!vault) {
    return { ok: false, error: 'NOT INSIDE AN OBSIDIAN VAULT — Obsidian opens notes only from a folder with a .obsidian directory' };
  }
  await shell.openExternal(obsidianOpenUri(windowsPath));
  return { ok: true, action: `opened in ${EDITOR_LABELS.obsidian} (vault ${vault}): ${absPath}` };
}
