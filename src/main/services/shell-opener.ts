import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { BrowserWindow, dialog, shell } from 'electron';
import type { BoardNode } from '@shared/types.js';
import { isBroken, type TargetInfo } from '@shared/targets.js';
import { resolveNodeTarget } from './target-resolver.js';
import { openChatWindow } from './chat-window.js';
import { getSettings } from './settings.js';

/**
 * Turns a click on a node into a real effect on this machine.
 *
 * docs/07 §Path and execution policy is enforced here, not in the renderer: a target outside
 * every dev root is confirmed on EVERY activation, and a file.exe is confirmed on first launch
 * with its full resolved path shown. The renderer cannot skip these because it never gets a
 * handle to `shell` or `spawn` in the first place.
 */

export interface OpenResult {
  ok: boolean;
  /** What actually happened, for the activity feed and the toast. */
  action: string;
  target: TargetInfo;
  error?: string;
}

/** Confirmed executables, so the "first launch of any binary asks once" rule is once per run. */
const confirmedBinaries = new Set<string>();

async function confirm(title: string, message: string, detail: string, confirmLabel: string): Promise<boolean> {
  const win = BrowserWindow.getAllWindows()[0];
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
  const { response } = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  return response === 0;
}

function revealInExplorer(absPath: string, isDirectory: boolean): void {
  if (isDirectory) {
    // openPath on a directory opens the folder itself, which is what you want for a repo.
    void shell.openPath(absPath.replace(/\//g, '\\'));
  } else {
    shell.showItemInFolder(absPath.replace(/\//g, '\\'));
  }
}

function openInVSCode(absPath: string): { ok: boolean; error?: string } {
  try {
    // `code` is a .cmd shim on Windows, so it needs a shell. The path is passed as an argument
    // rather than interpolated into a command string, so a path with spaces or an ampersand in
    // it cannot become extra shell syntax.
    const child = spawn('code', [absPath.replace(/\//g, '\\')], {
      detached: true,
      stdio: 'ignore',
      shell: true,
      windowsHide: true
    });
    child.unref();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `COULD NOT RUN "code" — is VS Code on PATH? (${(err as Error).message})` };
  }
}

/**
 * Activate a node. Returns a description of what happened rather than throwing, because the
 * renderer shows this in a toast either way and "nothing happened, here is why" is a result.
 */
export async function openTarget(node: BoardNode): Promise<OpenResult> {
  const target = resolveNodeTarget(node);

  if (target.state === 'none') {
    return { ok: false, action: 'nothing to open', target, error: `${node.kind} POINTS AT NOTHING` };
  }
  if (isBroken(target) && target.state !== 'outside-dev-root') {
    return { ok: false, action: 'blocked', target, error: target.detail ?? 'TARGET DID NOT RESOLVE' };
  }

  const resolved = target.resolved;
  if (!resolved) {
    return { ok: false, action: 'blocked', target, error: target.detail ?? 'TARGET DID NOT RESOLVE' };
  }

  // docs/07: outside a dev root -> confirm on every activation, no exceptions, no remembering.
  if (target.state === 'outside-dev-root') {
    const proceed = await confirm(
      'Target outside your dev roots',
      `${node.designator ? node.designator + ' — ' : ''}${node.name}`,
      `This target is not under any configured dev root (${getSettings().devRoots.join(', ')}) or your user profile.\n\n${resolved}\n\nSkynetOS asks every time for these.`,
      'Open anyway'
    );
    if (!proceed) return { ok: false, action: 'cancelled by user', target };
  }

  if (target.kind === 'url') {
    /*
     * A conversation gets its own window; a bookmark gets your browser.
     *
     * These used to be the same code path, and the JARVIS chip opened a Firefox tab wedged in
     * among thirty others — which made the agent feel like a link SkynetOS happened to know
     * about rather than something that lives on the board. `link.url` still goes to the real
     * browser, which is what a bookmark is for.
     */
    if (node.kind === 'agent.jarvis' || node.kind === 'agent.chat') {
      const { focused } = openChatWindow(node, resolved);
      return {
        ok: true,
        action: focused ? `focused the ${node.name} window` : `opened ${node.name} in its own window`,
        target
      };
    }
    await shell.openExternal(resolved);
    return { ok: true, action: `opened in browser: ${resolved}`, target };
  }

  // A launchable binary is the one case that runs code rather than opening a document.
  if (node.kind === 'file.exe') {
    const settings = getSettings();
    const needsConfirm = node.confirmBeforeLaunch !== false || settings.confirmAllLaunches || !confirmedBinaries.has(resolved);
    if (needsConfirm) {
      const proceed = await confirm(
        'Launch this program?',
        `${node.designator ? node.designator + ' — ' : ''}${node.name}`,
        `${resolved}\n${target.sizeBytes !== undefined ? `${(target.sizeBytes / 1024).toFixed(0)} KB · ` : ''}${node.args?.length ? `args: ${node.args.join(' ')}` : 'no arguments'}\n\nSkynetOS is not elevated, and neither is this.`,
        'Launch'
      );
      if (!proceed) return { ok: false, action: 'cancelled by user', target };
      confirmedBinaries.add(resolved);
    }
    try {
      const child = spawn(resolved.replace(/\//g, '\\'), node.args ?? [], {
        cwd: node.cwd ? node.cwd.replace(/\//g, '\\') : dirname(resolved).replace(/\//g, '\\'),
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      });
      child.unref();
      return { ok: true, action: `launched ${resolved} (pid ${child.pid ?? '?'})`, target };
    } catch (err) {
      return { ok: false, action: 'launch failed', target, error: (err as Error).message };
    }
  }

  const openWith = node.openWith ?? (target.kind === 'directory' ? 'explorer' : 'default');

  switch (openWith) {
    case 'explorer':
      revealInExplorer(resolved, target.kind === 'directory');
      return { ok: true, action: `revealed in Explorer: ${resolved}`, target };

    case 'vscode': {
      const result = openInVSCode(resolved);
      return result.ok
        ? { ok: true, action: `opened in VS Code: ${resolved}`, target }
        : { ok: false, action: 'vscode failed', target, ...(result.error ? { error: result.error } : {}) };
    }

    case 'browser': {
      const url = node.remote ?? node.url;
      if (!url) return { ok: false, action: 'blocked', target, error: 'NO REMOTE URL ON THIS NODE' };
      await shell.openExternal(url);
      return { ok: true, action: `opened in browser: ${url}`, target };
    }

    case 'terminal':
      // M3 owns real sessions. Saying so is better than silently doing something else.
      return { ok: false, action: 'not built yet', target, error: 'TERMINAL LAUNCH ARRIVES AT M3 — use Explorer or VS Code for now' };

    case 'default':
    default: {
      const error = await shell.openPath(resolved.replace(/\//g, '\\'));
      return error
        ? { ok: false, action: 'open failed', target, error }
        : { ok: true, action: `opened with the default app: ${resolved}`, target };
    }
  }
}
