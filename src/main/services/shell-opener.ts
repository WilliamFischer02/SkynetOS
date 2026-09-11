import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname } from 'node:path';
import { dialog, shell } from 'electron';
import type { BoardNode } from '@shared/types.js';
import type { TerminalOpenResult } from '@shared/ipc.js';
import { primeStepsFor } from '@shared/prime-steps.js';
import { isBroken, needsConfirmation, type TargetInfo } from '@shared/targets.js';
import type { Actor } from '@shared/commands.js';
import { officeRefusal, officeUri } from '@shared/office.js';
import { elevatedProgramArgv, toWindowsPath as toWindows } from './launch-script.js';
import { resolveNodeTarget } from './target-resolver.js';
import { openChatWindow } from './chat-window.js';
import { boardWindow } from './main-window.js';
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
 * Launch a program elevated, and find out whether it actually happened.
 *
 * ── Why `detached: false` ─────────────────────────────────────────────────────────────────────
 *
 * This is the bug that made "launch as administrator" show a dialog and then do nothing at all.
 * Measured from inside Electron main, spawning `powershell.exe` with a command that writes a
 * marker file:
 *
 *     detached: true,  stdio: 'ignore'   ->  nothing
 *     detached: true,  stdio: 'pipe'     ->  nothing
 *     detached: false, stdio: 'pipe'     ->  WORKS
 *     detached: false, stdio: 'ignore'   ->  WORKS
 *
 * `detached` is the whole difference. On Windows it sets DETACHED_PROCESS, which gives the child
 * no console — and Electron main, being a GUI-subsystem process, has none of its own to inherit.
 * A console application with no console does not run. `stdio: 'ignore'` then guaranteed nobody
 * would ever find out.
 *
 * Not detaching costs nothing here. PowerShell is a courier: it asks the Application Information
 * service to start the program and exits. The elevated program is a child of that service, not of
 * ours, so it outlives SkynetOS either way.
 *
 * ── Why it waits ──────────────────────────────────────────────────────────────────────────────
 *
 * Because the answer is worth having. UAC is modal, so PowerShell does not return until the user
 * has said yes or no, and its exit code and stderr carry the outcome: consent refused, or a
 * program Windows will not elevate at all — a Store app, for instance, which cannot run as
 * administrator by design. Reporting "asked Windows to launch it" and walking away turns every one
 * of those into the silence this function just spent a day being.
 */
async function launchElevated(exePath: string, args: string[], cwd: string): Promise<{ ok: boolean; error?: string }> {
  const invocation = elevatedProgramArgv(exePath, args, cwd);

  return await new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(invocation.file, invocation.args, {
        // See above. This must not be detached.
        detached: false,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true
      });
    } catch (err) {
      resolve({ ok: false, error: (err as Error).message });
      return;
    }

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', (err) => resolve({ ok: false, error: err.message }));

    /*
     * A cap, in case the UAC prompt is left sitting on screen. Reporting "it was requested" after
     * two minutes of no answer is honest; blocking the click forever is not.
     */
    const cap = setTimeout(() => resolve({ ok: true }), 120_000);
    if (typeof cap.unref === 'function') cap.unref();

    child.on('exit', (code) => {
      clearTimeout(cap);
      if (code === 0) { resolve({ ok: true }); return; }
      const reason = stderr.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(' ');
      resolve({
        ok: false,
        error: reason || `THE ELEVATED LAUNCH WAS REFUSED (powershell exit ${code ?? '?'}) — ` +
          'either UAC was declined, or Windows will not elevate this program. Packaged Store apps ' +
          'cannot run as administrator at all.'
      });
    });
  });
}

/**
 * Has the USER said "stop asking about this node"?
 *
 * `confirmBeforeLaunch: false` is that statement, and it now means it — it used to be overridden
 * by an unconditional "ask once per binary per run", so a person who explicitly turned
 * confirmation off still got a dialog, which is the sort of thing that teaches people to click
 * through dialogs without reading them.
 *
 * It is honoured for `'user'` only. Board JSON is agent-writable and `node:open` is in
 * AGENT_METHODS, so if this applied to everyone an agent could point a node at anything, clear the
 * flag, activate it, and run a program with nothing on screen. `settings.confirmAllLaunches`
 * overrides it in the other direction for someone who wants the belt and braces back — and that
 * lives in settings.json, which no agent can write.
 */
function trustedByUser(node: BoardNode, by: Actor): boolean {
  if (by !== 'user') return false;
  if (getSettings().confirmAllLaunches) return false;
  return node.confirmBeforeLaunch === false;
}

/**
 * Windows file types that `CreateProcess` can actually execute.
 *
 * Everything else has to go through the SHELL. This is not a nicety: measured on this machine,
 *
 *     spawn("thing.lnk")  ->  EFTYPE
 *     spawn("thing.bat")  ->  EINVAL
 *
 * and the node editor's own file filter offers `exe, bat, cmd, ps1` — so three of the four types
 * it invites you to pick could never have launched. A `.lnk` is a shell object, not an image;
 * `CreateProcess` has no idea what to do with one.
 */
const SPAWNABLE = ['.exe', '.com'];

/**
 * Run a program, by whatever mechanism actually works for it.
 *
 * `spawn` for a real executable, because it takes arguments and a working directory and hands back
 * a pid the dock can track. `shell.openPath` — which is ShellExecute — for everything else, and as
 * a fallback when spawn refuses.
 *
 * ShellExecute is also the only thing that launches a Store app correctly. William's Minecraft node
 * pointed at a shortcut whose target is
 * `C:/Program Files/WindowsApps/Microsoft.4297127D64EC6_.../Minecraft.exe`: an MSIX payload that
 * needs package identity, which you get from the shell and not from `CreateProcess`. Following the
 * shortcut ourselves and spawning its target would have failed a second time, for a second reason.
 * Handing the `.lnk` to the shell is exactly what double-clicking it in Explorer does.
 *
 * The cost is that ShellExecute returns no pid and takes no arguments, so a node with `args` that
 * is not a real executable is told plainly that they were ignored rather than silently dropped.
 */
async function launchProgram(resolved: string, node: BoardNode, target: TargetInfo): Promise<OpenResult> {
  const extension = resolved.slice(resolved.lastIndexOf('.')).toLowerCase();
  const viaShell = !SPAWNABLE.includes(extension);

  if (!viaShell) {
    try {
      const child = spawn(toWindows(resolved), node.args ?? [], {
        cwd: toWindows(node.cwd ?? dirname(resolved)),
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      });
      child.unref();
      return { ok: true, action: `launched ${resolved} (pid ${child.pid ?? '?'})`, target };
    } catch (err) {
      // Fall through to the shell rather than reporting failure: an .exe that CreateProcess
      // refuses may still be something Explorer knows how to open.
      console.warn(`[open] spawn refused ${resolved} (${(err as Error).message}) — trying the shell`);
    }
  }

  const failure = await shell.openPath(toWindows(resolved));
  if (failure) return { ok: false, action: 'launch failed', target, error: failure };

  const ignoredArgs = node.args?.length ? ' (arguments ignored — the shell takes none)' : '';
  return { ok: true, action: `launched ${resolved} via the shell${ignoredArgs}`, target };
}

/**
 * Activate a node. Returns a description of what happened rather than throwing, because the
 * renderer shows this in a toast either way and "nothing happened, here is why" is a result.
 */
export async function openTarget(
  node: BoardNode,
  /**
   * Who asked.
   *
   * This is the whole reason a node may silence its own confirmation safely. `confirmBeforeLaunch:
   * false` is the user saying "I trust this one, stop asking" — and board JSON is agent-writable
   * (`command:apply` is in AGENT_METHODS), while `node:open` is too. So if that flag suppressed
   * the prompt for everyone, an agent could point a node anywhere, clear the flag, activate it,
   * and run an arbitrary program with nothing on screen. Suppression applies to `'user'` only;
   * an agent is asked every time, whatever the board says.
   */
  by: Actor = 'user'
): Promise<OpenResult> {
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

  /*
   * ── One question, not two ─────────────────────────────────────────────────────────────────
   *
   * Opening a program outside a dev root used to raise TWO dialogs in a row — "target outside your
   * dev roots", then "launch this program?" — for one click, about one file, and both answered by
   * the same person for the same reason. William: "I want to remove the confirmation messages as
   * much as possible."
   *
   * They are now one dialog that says everything relevant, and `trusted()` decides whether it
   * appears at all. No consent is lost: the combined dialog carries the same path, the same
   * out-of-root warning, and the same refusal default.
   */
  const outsideRoots = needsConfirmation(target);
  if (outsideRoots && !trustedByUser(node, by)) {
    const proceed = await confirm(
      'Target outside your dev roots',
      `${node.designator ? node.designator + ' — ' : ''}${node.name}`,
      `${resolved}\n\nNot under any configured dev root (${getSettings().devRoots.join(', ')}) or your user profile.\n\n` +
      'To stop being asked: add its folder to devRoots in settings.json, or untick "Confirm before launch" on this node.',
      'Open'
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
    /*
     * A document behind a URL can go to the DESKTOP Office app instead of a browser tab.
     *
     * Opt in per node (`openWith: 'office'`), because it only works on a direct document URL.
     * `officeUri` returns null for a share link — Office cannot follow a redirect and fails with a
     * dialog rather than falling back — so this falls back HERE, to the browser, and says why.
     */
    if (node.openWith === 'office') {
      const uri = officeUri(resolved);
      if (uri) {
        await shell.openExternal(uri);
        return { ok: true, action: `opened in desktop Office: ${resolved}`, target };
      }
      await shell.openExternal(resolved);
      return { ok: true, action: `${officeRefusal(resolved)}`, target };
    }

    await shell.openExternal(resolved);
    return { ok: true, action: `opened in browser: ${resolved}`, target };
  }

  // A launchable binary is the one case that runs code rather than opening a document.
  if (node.kind === 'file.exe') {
    const elevated = node.elevated === true;

    /*
     * Elevation is ALWAYS confirmed, whatever the node says and whoever asked. "Do you want to run
     * this" and "do you want to run this as administrator" are different questions, and the second
     * one is not a node's to answer on the user's behalf.
     */
    if (elevated || !trustedByUser(node, by)) {
      const proceed = await confirm(
        elevated ? 'Launch this program AS ADMINISTRATOR?' : 'Launch this program?',
        `${node.designator ? node.designator + ' — ' : ''}${node.name}`,
        // An alias has no size worth reporting — the reparse buffer's 93 bytes describes nothing a
        // person cares about, and "0 KB" next to a launch button reads as a corrupt file.
        `${resolved}\n${target.alias ? 'Windows app · ' : target.sizeBytes ? `${(target.sizeBytes / 1024).toFixed(0)} KB · ` : ''}${node.args?.length ? `args: ${node.args.join(' ')}` : 'no arguments'}\n\n` +
        (elevated
          ? 'Windows will show a UAC prompt. An elevated program can change anything on this machine.\nSkynetOS itself stays non-elevated — it asks Windows to start an elevated child.'
          : 'SkynetOS is not elevated, and neither is this.\nUntick "Confirm before launch" on this node to stop being asked.'),
        elevated ? 'Launch as admin' : 'Launch'
      );
      if (!proceed) return { ok: false, action: 'cancelled by user', target };
      confirmedBinaries.add(resolved);
    }

    if (elevated) {
      const result = await launchElevated(resolved, node.args ?? [], node.cwd ?? dirname(resolved));
      // No pid: it would be PowerShell's, not the program's, and PowerShell has already exited.
      return result.ok
        ? { ok: true, action: `launched ${resolved} as administrator`, target }
        : { ok: false, action: 'elevated launch failed', target, ...(result.error ? { error: result.error } : {}) };
    }

    return await launchProgram(resolved, node, target);
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
      /*
       * A document bound by a URL has no directory. `dirname` on one cheerfully returns
       * `https:/contoso-my.sharepoint.com/personal/w/Documents`, which is not a path, is not on
       * this machine, and would be handed to a terminal as a working directory. Saying "there
       * isn't one" is the honest answer and the caller already knows how to report it.
       */
      return /^https?:\/\//i.test(resolved) ? null : dirname(resolved);
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
