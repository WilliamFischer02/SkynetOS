import { readdirSync } from 'node:fs';
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
