import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Does a Claude Code conversation actually exist?
 *
 * ── Why this file had to be written ───────────────────────────────────────────────────────────
 *
 * SkynetOS assigns conversation ids rather than scraping them (launch-args.ts explains why), and
 * it recorded the id in `sessions` BEFORE spawning so that a crash mid-launch could not orphan a
 * conversation. That was the right instinct and it produced the worst bug in the project.
 *
 * If the launch then fails, the id is still in the database — naming a conversation that was
 * never created. Every later click passes it to `--resume`, Claude Code answers
 * "No conversation found with session ID: ...", exits 1, and the window closes. The chip is now
 * permanently broken and nothing in the UI can tell you why.
 *
 * It was not hypothetical. On 2026-09-10 every one of the four conversation ids in this
 * machine's database was a phantom: `claude` had never once started successfully from the board,
 * and fifteen recorded "sessions" were all the same failure repeating.
 *
 * Claude Code keeps each conversation as `~/.claude/projects/<mangled-cwd>/<uuid>.jsonl`. That is
 * a real artifact on a real disk, so "is this conversation resumable" is a question with a true
 * answer instead of an assumption. Prime directive 1.
 */

export function claudeProjectsDir(): string {
  return join(homedir(), '.claude', 'projects');
}

/**
 * Claude Code's directory name for a working directory: every character that is not a letter or
 * a digit becomes `-`, so `C:\dev\SkynetOS` is `C--dev-SkynetOS`.
 *
 * Derived, but never TRUSTED — `conversationExists` falls back to scanning every project folder.
 * The mangling is another program's private detail and could change; a conversation that has
 * moved between directories would also miss. Scanning seven folders costs nothing, and being
 * wrong here means silently breaking a chip.
 */
export function projectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

export function conversationFile(sessionId: string, cwd?: string): string | null {
  if (!/^[0-9a-fA-F-]{32,40}$/.test(sessionId)) return null;
  const root = claudeProjectsDir();
  if (!existsSync(root)) return null;

  if (cwd) {
    const direct = join(root, projectDirName(cwd.replace(/\//g, '\\')), `${sessionId}.jsonl`);
    if (existsSync(direct)) return direct;
  }

  try {
    for (const entry of readdirSync(root)) {
      const candidate = join(root, entry, `${sessionId}.jsonl`);
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    return null;
  }
  return null;
}

/** True only when there is a conversation on disk that `claude --resume` can actually open. */
export function conversationExists(sessionId: string | null, cwd?: string): boolean {
  if (!sessionId) return false;
  return conversationFile(sessionId, cwd) !== null;
}

/** When the conversation was last written to, for the inspector. Null when there is none. */
export function conversationMtime(sessionId: string | null, cwd?: string): number | null {
  if (!sessionId) return null;
  const file = conversationFile(sessionId, cwd);
  if (!file) return null;
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
}
