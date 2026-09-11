import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { boardRoot } from './board-store.js';
import type { MailboxMessage, MailSide } from '@shared/mailbox.js';
import { formatMessage, liftPastedHeader, messageFileName, normaliseSide, parseMessage } from '@shared/mailbox.js';

/**
 * The mailbox: how the Face and the Hands talk to each other.
 *
 * ── The problem ───────────────────────────────────────────────────────────────────────────────
 *
 * JARVIS is two things wearing one name. The Face is a claude.ai conversation and cannot see this
 * disk, ever. The Hands are a Claude Code session and can do anything on it. There is no wire
 * between them, so everything the Face decides reached the disk only because William carried it
 * across by hand — the copy-paste he has said, repeatedly, that he does not want.
 *
 * ── Why files, and why SkynetOS in the middle ─────────────────────────────────────────────────
 *
 * The Hands read and write files natively, so a directory in the repo is the cheapest possible
 * inbox for them: no protocol, no server, no credentials, and it survives a crash, a restart and a
 * `git clone`. The Face cannot reach it at all — which is exactly why SkynetOS has to be the wire.
 * It writes what the Face said into `to-hands/`, and it puts what the Hands wrote onto the
 * clipboard for the Face in one click. One click each way instead of a transcription.
 *
 * The last mile is the important one: unread `to-hands` messages are folded into the session
 * BRIEFING on the next launch (see session-manager.ts), so the Hands do not have to remember to
 * look. A mailbox nobody checks is a drawer.
 *
 * ── Where it lives ────────────────────────────────────────────────────────────────────────────
 *
 * `codex/mailbox/`, next to the board files, because it is part of the project's memory and
 * belongs in git alongside everything else JARVIS knows. Deliberately NOT in userData: a message
 * that disappears when you move machines is not correspondence, it is a notification.
 */

export const MAILBOX_DIRNAME = 'mailbox';

/** `<repo>/codex/mailbox`. Derived from the board root so it follows a packaged install. */
export function mailboxRoot(): string {
  return join(boardRoot(), '..', 'codex', MAILBOX_DIRNAME);
}

function sideDir(side: MailSide): string {
  return join(mailboxRoot(), side === 'hands' ? 'to-hands' : 'to-face');
}

function archiveDir(): string {
  return join(mailboxRoot(), 'archive');
}

function ensureDirs(): void {
  for (const dir of [sideDir('hands'), sideDir('face'), archiveDir()]) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Read one side's unread messages, oldest first.
 *
 * Oldest first because correspondence is a sequence: reading a reply before the thing it replies
 * to is worse than waiting. A file that fails to parse is returned as a message whose body is the
 * raw text rather than being skipped — a message you cannot read is still a message you were sent,
 * and silently dropping it is the worst possible failure for a mailbox.
 */
export function listMail(side: MailSide | string): MailboxMessage[] {
  const which = normaliseSide(side);
  if (!which) return [];
  ensureDirs();
  const dir = sideDir(which);
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  } catch {
    return [];
  }

  const out: MailboxMessage[] = [];
  for (const file of files) {
    const full = join(dir, file);
    let raw: string;
    try {
      raw = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(full).mtimeMs;
    } catch { /* a file that vanished mid-read contributes its parse and no mtime */ }

    out.push({ ...parseMessage(raw, file), file, to: which, mtimeMs });
  }
  return out;
}

export function unreadCount(side: MailSide): number {
  return listMail(side).length;
}

/**
 * Leave a message. Returns the file it was written to.
 *
 * The filename carries the timestamp so the directory sorts chronologically in Explorer, in git,
 * and in `readdirSync` — no index file to keep in step, and no ordering that depends on anything
 * but the names themselves.
 */
export function sendMail(
  to: MailSide | string,
  message: { from?: string; subject: string; body: string }
): { ok: boolean; file?: string; error?: string } {
  const side = normaliseSide(to);
  if (!side) return { ok: false, error: `NO SUCH MAILBOX — "${to}". Use "to-hands" or "to-face".` };
  ensureDirs();

  /*
   * A pasted header is lifted, not wrapped.
   *
   * The Face writes whole messages, header included, and William pastes them into the panel as
   * they are. Wrapping that in a second header buried the Face's `run:` in the body, where it
   * means nothing, so an autonomous run could never arrive through the panel. `run:` and
   * `standing:` only mean something to the Hands, so they are kept only on post going that way.
   * This grants nothing new: anything that can call this could already write a flagged file
   * into to-hands/ directly.
   */
  const lifted = liftPastedHeader(message.body);
  const subject = message.subject.trim() || lifted?.subject || 'No subject';
  const body = lifted ? lifted.body : message.body;
  if (!body.trim()) return { ok: false, error: 'NOTHING TO SEND — the message has a header and no body' };

  const now = new Date();
  const file = join(sideDir(side), messageFileName(now, subject));
  try {
    writeFileSync(
      file,
      formatMessage({
        from: message.from?.trim() || 'unknown',
        to: side,
        subject,
        sentAt: now.toISOString(),
        body,
        ...(side === 'hands' && lifted ? { run: lifted.run, standing: lifted.standing } : {})
      }),
      'utf8'
    );
    return { ok: true, file };
  } catch (err) {
    return { ok: false, error: `COULD NOT WRITE ${file} — ${(err as Error).message}` };
  }
}

/**
 * Mark a message read by moving it to `archive/`.
 *
 * Moved rather than deleted, and rather than flagged in place. docs/07 forbids unattended
 * destruction, and a mailbox is exactly where you want the history: "what did the Face actually
 * ask for" is a question you ask weeks later. The archive is chronological and git-tracked.
 */
export function archiveMail(side: MailSide | string, file: string): { ok: boolean; error?: string } {
  const which = normaliseSide(side);
  if (!which) return { ok: false, error: `NO SUCH MAILBOX — "${side}". Use "to-hands" or "to-face".` };
  ensureDirs();
  // The filename comes from a listing, but it crosses IPC — so it is re-derived rather than
  // trusted. A `..` here would be a path traversal into the repo.
  const safe = file.replace(/[\\/]/g, '');
  const from = join(sideDir(which), safe);
  if (!existsSync(from)) return { ok: false, error: `NO SUCH MESSAGE — ${safe}` };
  try {
    renameSync(from, join(archiveDir(), safe));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function listArchive(limit = 50): MailboxMessage[] {
  ensureDirs();
  let files: string[];
  try {
    files = readdirSync(archiveDir()).filter((f) => f.endsWith('.md')).sort().reverse().slice(0, limit);
  } catch {
    return [];
  }
  return files.map((file) => {
    let raw = '';
    try { raw = readFileSync(join(archiveDir(), file), 'utf8'); } catch { /* unreadable */ }
    const parsed = parseMessage(raw, file);
    return { ...parsed, file, to: parsed.to, mtimeMs: 0 };
  });
}

/**
 * The unread `to-hands` mail, rendered for a session briefing.
 *
 * This is the last mile: the Hands are handed their post as they open, rather than being asked to
 * remember to check a directory. Returns null when there is nothing waiting, so a quiet mailbox
 * adds nothing to the prompt.
 */
export function mailForBriefing(): string | null {
  const mail = listMail('hands');
  if (!mail.length) return null;

  // Absolute, because a chip's working directory need not be this repo: U3 runs from C:/dev, and
  // "codex/mailbox/" relative to that is a directory that does not exist.
  const where = mailboxRoot().replace(/\\/g, '/');
  const lines: string[] = [];
  lines.push(`You have ${mail.length} unread message${mail.length === 1 ? '' : 's'} in ${where}/to-hands/.`);
  lines.push('Read them first, act on what they ask, and reply by writing a file into');
  lines.push(`${where}/to-face/ (the format is in ${where}/README.md). Move anything you have`);
  lines.push(`dealt with into ${where}/archive/ — do not delete it.`);
  lines.push('');
  for (const message of mail) {
    lines.push(`  - ${message.file} — "${message.subject}" from ${message.from}`);
  }
  return lines.join('\n');
}
