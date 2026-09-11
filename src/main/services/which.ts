import { lstatSync, readdirSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * Finding an executable on PATH, on Windows, correctly.
 *
 * ── The bug this file exists to kill ──────────────────────────────────────────────────────────
 *
 * SkynetOS decided whether Windows Terminal was installed like this:
 *
 *     existsSync(`${LOCALAPPDATA}/Microsoft/WindowsApps/wt.exe`)
 *
 * On this machine — and on every Windows 11 machine — that is **false**, and `wt.exe` is
 * installed. `wt.exe`, `pwsh.exe`, `python.exe` and everything else under `WindowsApps` are App
 * Execution Aliases: zero-length reparse points that `CreateProcess` resolves but `stat` cannot,
 * so `statSync` throws EACCES and `existsSync` answers "no".
 *
 * The consequences ran the whole length of the launch path. `hasWindowsTerminal()` was always
 * false, so the terminal was never opened through wt. The shell resolver fell through to
 * `powershell.exe` 5.1. Electron's main process is a GUI-subsystem process with no console of
 * its own, so spawning a console app from it detached opened no visible window at all. Two
 * silent misdetections stacked into "clicking the chip does nothing", with no error anywhere.
 *
 * `readdirSync` on the same directory lists every one of those aliases perfectly — the entries
 * are fine, it is only following them that fails. So resolution is done by listing PATH
 * directories and matching names, which works for aliases and ordinary executables alike and
 * never spawns a process to answer the question.
 */

/** Resolution is stable for the life of the process, and PATH scans are not free. */
const cache = new Map<string, string | null>();

function pathDirs(): string[] {
  const raw = process.env['PATH'] ?? process.env['Path'] ?? '';
  return raw.split(delimiter).map((d) => d.trim().replace(/^"|"$/g, '')).filter(Boolean);
}

/**
 * The full path to `name` on PATH, or null.
 *
 * Case-insensitive, because Windows is, and a PATH entry that cannot be read is skipped rather
 * than throwing — a stale PATH entry pointing at an unplugged drive is common and must not break
 * the lookup of everything after it.
 */
export function which(name: string): string | null {
  const key = name.toLowerCase();
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  for (const dir of pathDirs()) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    const match = entries.find((e) => e.toLowerCase() === key);
    if (match) {
      const full = join(dir, match);
      cache.set(key, full);
      return full;
    }
  }
  cache.set(key, null);
  return null;
}

export function hasExecutable(name: string): boolean {
  return which(name) !== null;
}

/** Forget cached resolutions. For tests, and for a PATH that changed under a running app. */
export function clearWhichCache(): void {
  cache.clear();
}

/**
 * ── The other half of the same bug ───────────────────────────────────────────────────────────
 *
 * `which()` above fixed "is Windows Terminal installed". This fixes the mirror image: "is the
 * thing this node points at real", asked of a path the user typed or picked.
 *
 * `services/target-resolver.ts` asked it with `existsSync`, which is the one test that LIES about
 * an App Execution Alias. Measured on this machine, for
 * `%LOCALAPPDATA%/Microsoft/WindowsApps/wt.exe`:
 *
 *     existsSync        false     <- stat under the covers
 *     statSync          THROWS EACCES
 *     lstatSync         ok, size 93, isSymbolicLink
 *     accessSync(X_OK)  ok
 *     readdirSync       lists it
 *
 * So a `file.exe` node pointed at Notepad, Paint, Terminal or any other Store app rendered as
 * TARGET NOT FOUND — a broken footprint on the board for a program that launches perfectly. That
 * reads exactly like a permissions problem, which is how it ends up costing someone an afternoon
 * granting themselves Full Control over `C:\Program Files\WindowsApps`. It is not one: nothing is
 * being denied. An APPEXECLINK reparse point has no file content to open, and only `CreateProcess`
 * knows how to follow it.
 */

/** Does this path exist — including things `stat` refuses to follow? */
export function pathExists(absPath: string): boolean {
  try {
    lstatSync(absPath);
    return true;
  } catch {
    return false;
  }
}

export interface PathInfo {
  kind: 'file' | 'directory';
  sizeBytes: number;
  mtimeMs: number;
  /**
   * A Windows App Execution Alias: launchable, but not readable and not stat-able.
   *
   * Detected by the only signature that is actually specific — `stat` fails where `lstat`
   * succeeds. An ordinary symlink resolves under `stat` to the file it points at, so it never
   * lands here; a dangling one fails both.
   */
  alias?: true;
}

/**
 * What is at this path, or null if nothing is.
 *
 * Falls back to `lstat` when `stat` throws, which is what makes an alias visible at all. Size and
 * mtime are reported as 0 for one: the reparse buffer's 93 bytes is not the size of anything a
 * person cares about, and showing it in a launch dialog would be a confident lie.
 */
export function pathInfo(absPath: string): PathInfo | null {
  try {
    const s = statSync(absPath);
    return { kind: s.isDirectory() ? 'directory' : 'file', sizeBytes: s.size, mtimeMs: s.mtimeMs };
  } catch {
    try {
      lstatSync(absPath);
      return { kind: 'file', sizeBytes: 0, mtimeMs: 0, alias: true };
    } catch {
      return null;
    }
  }
}
