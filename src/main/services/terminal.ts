import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { isProcessAlive } from './db.js';
import { hasExecutable } from './which.js';
import { buildLaunchScript, elevatedArgv, popoutArgv, safeKey, UAC_DECLINED_EXIT, type LaunchScriptSpec, type ShellKind } from './launch-script.js';

/**
 * Opening a real console window on Windows, and knowing whether one actually opened.
 *
 * Everything that puts a shell on screen goes through here: an agent chip launching Claude Code,
 * and "open a terminal in this folder" on a repo. They differ only in what the staged script
 * does once the window exists, which is the whole reason this is one module and not two.
 *
 * ── The lie this module exists to stop telling ────────────────────────────────────────────────
 *
 * `spawn` returning a pid used to be treated as proof of a launch. It is not, and handoff.md has
 * warned about it for two sessions: `wt.exe` is a stub that hands the real work to the running
 * WindowsTerminal process and exits 0 in about 200ms, whether or not it understood its arguments.
 * Fifteen recorded sessions on this machine each "started" and "exited" within a second, and the
 * UI reported every one as launched.
 *
 * So a launch here is confirmed by evidence from the other side: the staged script's first act
 * is to write its own `$PID`, and `openTerminal` waits for that file. No file, no launch — and
 * the caller gets the script's path so it can be run by hand.
 */

export type { ShellKind } from './launch-script.js';
export { elevatedArgv, popoutArgv, safeKey } from './launch-script.js';

export interface TerminalRequest {
  /** Identifies the staged files. `<board>.<node>`, or a slug for an ad-hoc terminal. */
  key: string;
  /** Windows path with backslashes. */
  cwd: string;
  elevated: boolean;
  spec: Omit<LaunchScriptSpec, 'pidFile' | 'cwd'>;
  /**
   * How long to wait for the script to prove it is running. UAC needs a human to click, so an
   * elevated launch gets much longer than a plain one.
   */
  confirmMs?: number;
}

export interface TerminalResult {
  ok: boolean;
  /** The pid of the SHELL, read from the file the script wrote. Not the launcher's pid. */
  pid: number | null;
  /** The staged script, always returned — it is the thing to run by hand when this fails. */
  scriptFile: string;
  pidFile: string;
  shell: ShellKind;
  usedWindowsTerminal: boolean;
  error?: string;
}

function launchDir(): string {
  const dir = join(app.getPath('userData'), 'launch');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Which PowerShell to use.
 *
 * pwsh 7 is preferred; `powershell.exe` (5.1) is the fallback and is present on every Windows
 * install, so a missing pwsh degrades instead of failing.
 *
 * Resolved through `which`, NOT `existsSync` — pwsh.exe is an App Execution Alias and existsSync
 * says it is not there. That misdetection is why every launch on this machine silently used
 * PowerShell 5.1. See services/which.ts.
 */
export function resolveShell(): ShellKind {
  return hasExecutable('pwsh.exe') ? 'pwsh' : 'powershell';
}

/**
 * Windows Terminal is how a popout gets a real window with tabs and a sane font.
 *
 * Same story as above: this used to be an existsSync on the alias path and was therefore always
 * false. wt.exe ships with Windows 11 but can be removed, so the fallback still has to work.
 */
export function hasWindowsTerminal(): boolean {
  return hasExecutable('wt.exe');
}

/** Stage the prompt text for a node, so prose never enters a script or a command line. */
export function stagePrompt(key: string, prompt: string): string {
  const dir = join(app.getPath('userData'), 'prompts');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${safeKey(key)}.txt`);
  writeFileSync(file, prompt, 'utf8');
  return file;
}

/**
 * Read a pid file written by a staged script, and verify the process is really there.
 *
 * A stale file is worse than no file — it is what makes a chip claim a session that closed
 * hours ago — so the pid is checked against the OS, not trusted because a file exists.
 */
export function readLivePid(pidFile: string): number | null {
  if (!existsSync(pidFile)) return null;
  try {
    const pid = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return isProcessAlive(pid) ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Wait for the script to report in. `abort` ends the wait the moment the launcher has already
 * failed: a spawn error or a non-zero exit. Without it, a launch that died in its first
 * millisecond was still waited on for 12 s, or 90 s elevated, before anyone was told.
 */
async function waitForPid(pidFile: string, timeoutMs: number, abort: () => string | null = () => null): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pid = readLivePid(pidFile);
    if (pid !== null) return pid;
    if (abort() !== null) return null;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

/**
 * Open a terminal, and do not return until it has proved it exists (or the wait ran out).
 *
 * The child process handle is deliberately NOT returned or tracked. It is a launcher, it dies
 * immediately, and every previous bug in this file came from mistaking it for the session.
 */
export async function openTerminal(request: TerminalRequest): Promise<TerminalResult> {
  const dir = launchDir();
  const key = safeKey(request.key);
  const scriptFile = join(dir, `${key}.ps1`);
  const pidFile = join(dir, `${key}.pid`);
  const cwd = request.cwd.replace(/\//g, '\\');

  // A leftover pid file from a previous run would be read as this launch succeeding instantly.
  rmSync(pidFile, { force: true });

  const script = buildLaunchScript({ ...request.spec, cwd, pidFile });
  // UTF-8 with a BOM: Windows PowerShell 5.1 reads a BOM-less .ps1 as the ANSI codepage. The
  // generated text is ASCII anyway, so this is the second of two belts.
  writeFileSync(scriptFile, '\uFEFF' + script, 'utf8');

  const shell = resolveShell();
  const useWt = !request.elevated && hasWindowsTerminal();
  const fail = (error: string): TerminalResult => {
    console.error(`[terminal] ${error}`);
    return { ok: false, pid: null, scriptFile, pidFile, shell, usedWindowsTerminal: useWt, error };
  };

  /*
   * The working directory is checked before anything is spawned. A folder that does not exist
   * makes spawn fail with ENOENT before any window can appear. That is exactly what an unexpanded
   * `%USERPROFILE%/…` cwd did to every terminal on a portable node, and it is now said at once,
   * with the path.
   */
  try {
    if (!statSync(cwd).isDirectory()) return fail(`NOT A FOLDER — ${cwd}`);
  } catch {
    return fail(`WORKING DIRECTORY DOES NOT EXIST — ${cwd}`);
  }

  const { file, args } = request.elevated
    ? elevatedArgv(shell, cwd, scriptFile)
    : popoutArgv(shell, cwd, scriptFile, useWt);

  let child: ChildProcess;
  let spawnError = null as string | null;
  /** Set when the launcher itself exits non-zero: for the elevated helper, a refused or failed elevation. */
  let launcherFailure = null as string | null;
  let launcherStderr = '';
  try {
    /*
     * `detached` depends on WHAT is being launched, and getting it wrong is silent.
     *
     * On Windows `detached: true` sets DETACHED_PROCESS: the child gets no console. Electron main
     * is a GUI-subsystem process with none of its own to inherit, so a CONSOLE application started
     * this way does not run at all — measured from inside main, `powershell.exe` with a command
     * that writes a marker file produced nothing detached and worked immediately when not.
     *
     * `wt.exe` is fine detached because it is a GUI application that makes its own window and must
     * outlive us. The elevated helper is the opposite: a console PowerShell that asks the
     * Application Information service to start the program and then exits. It does not need to
     * outlive us — the elevated program is a child of that service, not of ours — and it cannot
     * run detached. That mismatch is why "launch as administrator" showed a dialog and did nothing.
     */
    const guiLauncher = file.toLowerCase() === 'wt.exe';
    child = spawn(file, args, {
      cwd,
      detached: guiLauncher,
      // The elevated helper's stderr is the only place a refused or failed elevation is written.
      // wt stays fully ignored: a detached GUI launcher holding a pipe open would outlive nothing useful.
      stdio: request.elevated ? ['ignore', 'ignore', 'pipe'] : 'ignore',
      windowsHide: request.elevated
    });
    child.stderr?.on('data', (chunk: Buffer) => { launcherStderr += chunk.toString(); });
    child.on('exit', (code) => {
      const said = launcherStderr.trim();
      if (code === null || code === 0) {
        if (said) console.log(`[terminal] launcher: ${said}`);
        return;
      }
      launcherFailure = code === UAC_DECLINED_EXIT
        ? 'UAC WAS DECLINED — NO ADMIN WINDOW WAS OPENED'
        : `${file} FAILED (exit ${code})${said ? ` — ${said.split(/\r?\n/).filter(Boolean).pop() ?? ''}` : ''}`;
    });
    /*
     * A spawn failure arrives as an `error` EVENT, not an exception — an unhandled one takes the
     * main process down. It is also the only place an ENOENT on wt.exe or pwsh.exe can surface,
     * so it is captured and reported rather than merely swallowed.
     */
    child.on('error', (err) => {
      spawnError = err.message;
      console.error(`[terminal] ${file} failed to start:`, err);
    });
    console.log(`[terminal] ${file} ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);
    if (guiLauncher) child.unref();
  } catch (err) {
    return fail(`COULD NOT RUN ${file} — ${(err as Error).message}`);
  }

  const confirmMs = request.confirmMs ?? (request.elevated ? 90_000 : 12_000);
  const failedAlready = (): string | null => (spawnError ? `${file} DID NOT START — ${spawnError}` : launcherFailure);
  const pid = await waitForPid(pidFile, confirmMs, failedAlready);

  if (pid === null) {
    return fail(failedAlready() ?? (request.elevated
      ? `NO ELEVATED SHELL APPEARED — the UAC prompt was not answered in ${confirmMs / 1000} s. The script is at ${scriptFile}`
      : `THE TERMINAL NEVER REPORTED IN — run this by hand to see why: ${scriptFile}`));
  }

  return { ok: true, pid, scriptFile, pidFile, shell, usedWindowsTerminal: useWt };
}
