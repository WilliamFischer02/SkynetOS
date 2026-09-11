import type { BoardNode } from './types.js';
import type { MailboxMessage } from './mailbox.js';

/**
 * The Face's standing orders: `codex/face-brief.md`.
 *
 * ── Why this is not just more mail ────────────────────────────────────────────────────────────
 *
 * The Face: "mail is a queue and a plan is a state." A message reaches the next Hands session that
 * opens before it is archived, and then it is gone. A standing order has to reach EVERY future
 * session until the Face changes its mind, so it lives in one file that is rewritten whole and
 * never appended to. A log stops being current, and a stale standing order is worse than none.
 *
 * ── Who writes it ─────────────────────────────────────────────────────────────────────────────
 *
 * The Face owns it and cannot write to this disk. It dictates a message carrying `standing: true`,
 * William carries it across in the panel like any other post, and SkynetOS writes the body over
 * this file and archives the message (services/face-brief.ts). The Hands never edit it; they
 * answer through `codex/mailbox/to-face/`. Earlier orders are not lost: every version is the body
 * of a message in `archive/`.
 */

export const FACE_BRIEF_REL = 'codex/face-brief.md';

/**
 * Which agent node is the Hands, among one board's nodes.
 *
 * A tag first, then the name. Searched for rather than hard-coded: the node was renamed from
 * "JARVIS Hands" to "JARVIS Prime" mid-project, and an id written into a source file would have
 * survived that only by luck.
 */
export function pickHandsNode(nodes: readonly BoardNode[]): BoardNode | null {
  const agents = nodes.filter((n) => n.kind === 'agent.code');
  return (
    agents.find((n) => n.tags?.includes('hands')) ??
    agents.find((n) => /jarvis/i.test(n.name)) ??
    null
  );
}

/** When a brief was written: its `written-at`, or `updated` from before the Face's protocol. */
export function briefWrittenAt(raw: string | null): string | null {
  if (!raw) return null;
  const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1] ?? '';
  const found = /^written-at:\s*(.+)$/im.exec(head)?.[1] ?? /^updated:\s*(.+)$/im.exec(head)?.[1] ?? '';
  return found.trim() || null;
}

/**
 * The file SkynetOS writes from a `standing:` message, in the Face's protocol, version 1.
 *
 * The Face specified the header: protocol, version, written-by, written-at, supersedes. SkynetOS
 * fills it in rather than taking it from the Face, because every field is a fact about delivery.
 * `written-at` is when the message actually landed in the mailbox (a language model typing an
 * ISO time guesses; the first one it sent said midnight). `supersedes` is the `written-at` of the
 * file being replaced, which the Face cannot see at the moment it writes. `source` is the archived
 * message, so every earlier version stays findable. A header the Face puts at the top of its own
 * body is dropped for the same reason: it would be a second account of the same facts, and the
 * two would disagree.
 */
export function formatFaceBrief(
  message: Pick<MailboxMessage, 'file' | 'subject' | 'sentAt' | 'body'>,
  supersedes: string | null = null
): string {
  const body = message.body.replace(/^\s*---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '').trim();
  return [
    '---',
    'protocol: face-brief',
    'version: 1',
    'written-by: face',
    `written-at: ${message.sentAt || 'unknown'}`,
    `supersedes: ${supersedes ?? 'none'}`,
    `source: codex/mailbox/archive/${message.file}`,
    '---',
    '',
    '<!-- Written by SkynetOS from a standing: message. The Face owns this file; do not edit it.',
    '     To change it, the Face sends a new standing: message, which replaces it whole. -->',
    '',
    body,
    ''
  ].join('\n');
}

/**
 * The standing orders, rendered for a session briefing. Null when there are none.
 *
 * Labelled as standing rather than new, so a session does not read orders it has been following
 * for a week as a fresh request to act.
 */
export function standingOrdersBlock(raw: string, displayPath = FACE_BRIEF_REL): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  const head = match?.[1] ?? '';
  const body = (match ? (match[2] ?? '') : raw).replace(/<!--[\s\S]*?-->/g, '').trim();
  if (!body) return null;
  const updated = head ? briefWrittenAt(raw) : null;
  return [
    `STANDING ORDERS FROM THE FACE (${displayPath}${updated ? `, last rewritten ${updated}` : ''})`,
    'These are standing, not new: they hold for every session until the Face replaces them. The Face',
    'owns this file and rewrites it whole. Do not edit it; answer through codex/mailbox/to-face/.',
    '',
    body
  ].join('\n');
}
