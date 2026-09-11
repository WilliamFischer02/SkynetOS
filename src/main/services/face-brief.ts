import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatFaceBrief, standingOrdersBlock } from '@shared/face-brief.js';
import { archiveMail, listMail, mailboxRoot } from './mailbox.js';

/**
 * The Face's standing orders on disk. The format and the reasoning are in
 * packages/shared/face-brief.ts; this is the reading and the writing.
 */

/** `<repo>/codex/face-brief.md`, beside the mailbox that feeds it. */
export function faceBriefPath(): string {
  return join(mailboxRoot(), '..', 'face-brief.md');
}

/** The standing orders for a Hands briefing, or null when there are none. */
export function standingOrdersForBriefing(): string | null {
  const file = faceBriefPath();
  if (!existsSync(file)) return null;
  try {
    return standingOrdersBlock(readFileSync(file, 'utf8'), file.replace(/\\/g, '/'));
  } catch {
    return null;
  }
}

export interface StandingResult {
  file: string;
  subject: string;
  ok: boolean;
  error?: string;
}

/**
 * Turn `standing:` post into the standing orders.
 *
 * Oldest first, so when two arrive together the newer one is what is left in the file.
 *
 * Written BEFORE archiving, the opposite of mail-dispatch.ts, for the opposite reason. There a
 * repeated launch does harm, so the message is consumed first. Here a file written twice with the
 * same body does none, so a crash between the two steps just means the next sweep writes the same
 * orders again. What must not happen is an archived message whose orders never reached the file.
 *
 * Not gated on `autoRunMail`: this starts nothing. It changes what the next Hands session is told,
 * which is what every message in to-hands/ already does.
 */
export function applyStandingOrders(): StandingResult[] {
  const results: StandingResult[] = [];
  for (const message of listMail('hands').filter((m) => m.standing)) {
    try {
      writeFileSync(faceBriefPath(), formatFaceBrief(message), 'utf8');
    } catch (err) {
      results.push({
        file: message.file,
        subject: message.subject,
        ok: false,
        error: `COULD NOT WRITE ${faceBriefPath()} — ${(err as Error).message}`
      });
      continue;
    }
    const archived = archiveMail('hands', message.file);
    results.push({
      file: message.file,
      subject: message.subject,
      ok: archived.ok,
      ...(archived.ok ? {} : { error: archived.error ?? 'COULD NOT ARCHIVE' })
    });
  }
  return results;
}
