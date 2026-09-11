import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname } from 'node:path';
import { BrowserWindow, dialog, shell } from 'electron';
import type { BoardNode } from '@shared/types.js';
import type { TerminalOpenResult } from '@shared/ipc.js';
import { primeStepsFor } from '@shared/prime-steps.js';
import { isBroken, type TargetInfo } from '@shared/targets.js';
import { elevatedProgramArgv } from './launch-script.js';
import { resolveNodeTarget } from './target-resolver.js';
import { openChatWindow } from './chat-window.js';
import { openTerminal } from './terminal.js';
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
 * Launch a program elevated.
 *
 * The argv is built by `services/launch-script.ts`, where the other pure command builders live and
 * where it can be tested without spawning anything. See `elevatedProgramArgv` for why this goes
 * through PowerShell rather than through `spawn` options.
 *
 * The pid this returns belongs to the PowerShell that made the REQUEST, not to the program.
 * PowerShell exits as soon as the request is placed, so reporting it as the program's pid would be
 * a lie with a very short shelf life — which is why the caller does not print it.
 */
function spawnElevated(exePath: string, args: string[], cwd: string): ReturnType<typeof spawn> {
  const invocation = elevatedProgramArgv(exePath, args, cwd);
  return spawn(invocation.file, invocation.args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
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
  if (isBroken(target)) {
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
    const elevated = node.elevated === true;
    const needsConfirm =
      elevated || node.confirmBeforeLaunch !== false || settings.confirmAllLaunches || !confirmedBinaries.has(resolved);

    if (needsConfirm) {
      const proceed = await confirm(
        elevated ? 'Launch this program AS ADMINISTRATOR?' : 'Launch this program?',
        `${node.designator ? node.designator + ' — ' : ''}${node.name}`,
        // An alias has no size worth reporting — the reparse buffer's 93 bytes describes nothing a
        // person cares about, and "0 KB" next to a launch button reads as a corrupt file.
        `${resolved}\n${target.alias ? 'Windows app · ' : target.sizeBytes ? `${(target.sizeBytes / 1024).toFixed(0)} KB · ` : ''}${node.args?.length ? `args: ${node.args.join(' ')}` : 'no arguments'}\n\n` +
        (elevated
          ? 'Windows will show a UAC prompt. An elevated program can change anything on this machine.\nSkynetOS itself stays non-elevated — it asks Windows to start an elevated child.'
          : 'SkynetOS is not elevated, and neither is this.'),
        elevated ? 'Launch as admin' : 'Launch'
      );
      if (!proceed) return { ok: false, action: 'cancelled by user', target };
      confirmedBinaries.add(resolved);
    }

    try {
      const child = elevated
        ? spawnElevated(resolved, node.args ?? [], node.cwd ?? dirname(resolved))
        : spawn(resolved.replace(/\//g, '\\'), node.args ?? [], {
            cwd: node.cwd ? node.cwd.replace(/\//g, '\\') : dirname(resolved).replace(/\//g, '\\'),
            detached: true,
            stdio: 'ignore',
            windowsHide: false
          });
      child.unref();
      return {
        ok: true,
        action: elevated
          // The pid is PowerShell's, not the program's — see spawnElevated. Saying so beats
          // printing a number that belongs to a process that has already exited.
          ? `asked Windows to launch ${resolved} elevated (UAC)`
          : `launched ${resolved} (pid ${child.pid ?? '?'})`,
        target
      };
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

    case 'terminal': {
      const result = await openNodeTerminal(node, { elevated: false });
      return result.ok
        ? { ok: true, action: `opened a terminal in ${result.cwd}`, target }
        : { ok: false, action: 'terminal failed', target, ...(result.error ? { error: result.error } : {}) };
    }

    case 'default':
    default: {
      const error = await shell.openPath(resolved.replace(/\//g, '\\'));
      return error
        ? { ok: false, action: 'open failed', target, error }
        : { ok: true, action: `opened with the default app: ${resolved}`, target };
    }
  }
}

/* ────────────────────────── plain terminals ────────────────────────── */

/**
 * The directory a terminal for this node should open in.
 *
 * A repo or folder opens in itself; an agent opens in its working directory; a document or a
 * build artifact opens in the folder that contains it, because "give me a shell where this
 * thing lives" is what you actually want when you are looking at a file.
 */
export function directoryForNode(node: BoardNode, resolved: string): string | null {
  switch (node.kind) {
    case 'store.repo':
    case 'store.folder':
      return resolved;
    case 'agent.code':
    case 'service.process':
      return node.cwd ?? resolved;
    case 'store.cloud':
      return node.localPath ?? null;
    case 'file.document':
    case 'file.exe':
    case 'file.artifact':
      return dirname(resolved);
    default: {
      try {
        return statSync(resolved).isDirectory() ? resolved : dirname(resolved);
      } catch {
        return null;
      }
    }
  }
}

/**
 * Open a plain terminal on a node's directory. No agent, no conversation, no session row.
 *
 * This is the gap the board had: `openWith: 'terminal'` answered "arrives at M3" and there was
 * no other way to get a shell anywhere. It runs the same staged-script machinery an agent launch
 * does, so it primes with the same named steps and proves it opened the same way — see
 * services/terminal.ts.
 */
export async function openNodeTerminal(
  node: BoardNode,
  options: { elevated?: boolean } = {}
): Promise<TerminalOpenResult> {
  const elevated = options.elevated === true;
  const target = resolveNodeTarget(node);
  const resolved = target.resolved;

  if (!resolved) {
    return { ok: false, pid: null, scriptFile: '', elevated, cwd: '', error: target.detail ?? `${node.kind} POINTS AT NOTHING` };
  }
  if (isBroken(target)) {
    return { ok: false, pid: null, scriptFile: '', elevated, cwd: '', error: target.detail ?? 'TARGET DID NOT RESOLVE' };
  }

  const cwd = directoryForNode(node, resolved);
  if (!cwd) {
    return { ok: false, pid: null, scriptFile: '', elevated, cwd: '', error: `NO LOCAL DIRECTORY ON THIS NODE — ${node.kind} lives somewhere else` };
  }

  const label = `${node.designator ? node.designator + ' — ' : ''}${node.name}`;

  // docs/07: outside a dev root -> confirm on every activation. A shell is at least as
  // consequential as opening a file, so it gets the same gate rather than a weaker one.
  if (target.state === 'outside-dev-root') {
    const proceed = await confirm(
      'Open a terminal outside your dev roots',
      label,
      `${cwd}\n\nNot under any configured dev root (${getSettings().devRoots.join(', ')}) or your user profile.`,
      'Open terminal'
    );
    if (!proceed) return { ok: false, pid: null, scriptFile: '', elevated, cwd, error: 'CANCELLED' };
  }

  if (elevated) {
    // docs/07 §Elevation: opt in, every time, with the blast radius spelled out. SkynetOS itself
    // stays non-elevated and asks Windows for the elevated child.
    const proceed = await confirm(
      'Open an ADMINISTRATOR terminal?',
      label,
      `${cwd}\n\nWindows will show a UAC prompt. Anything run in that window can change this whole machine.\nSkynetOS itself stays non-elevated.`,
      'Open as admin'
    );
    if (!proceed) return { ok: false, pid: null, scriptFile: '', elevated, cwd, error: 'CANCELLED' };
  }

  const prime = primeStepsFor(node.prelaunch);
  const result = await openTerminal({
    key: `terminal.${node.id}${elevated ? '.admin' : ''}`,
    cwd,
    elevated,
    spec: {
      title: `SkynetOS — ${label}${elevated ? ' [ADMIN]' : ''}`,
      banner: [cwd, elevated ? 'ADMINISTRATOR - this shell can change anything on this machine' : node.kind],
      prime,
      readyNote: elevated
        ? '  Admin shell ready. Everything here runs elevated.'
        : '  Shell ready.'
    }
  });

  return {
    ok: result.ok,
    pid: result.pid,
    scriptFile: result.scriptFile,
    elevated,
    cwd,
    ...(result.error ? { error: result.error } : {})
  };
}
