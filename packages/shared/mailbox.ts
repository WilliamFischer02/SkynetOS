/**
 * The mailbox message format, and the parsing of it.
 *
 * Pure, and shared, because both sides of the IPC boundary and both halves of JARVIS need to agree
 * on it — and because an agent writing a reply by hand into `codex/mailbox/to-face/` must produce
 * something this can read back. That is the whole point of choosing a format a human and an LLM
 * can both write correctly from memory: YAML-ish frontmatter, then markdown.
 *
 *     ---
 *     from: face
 *     to: hands
 *     subject: Add a bracket for the performance mods
 *     sent: 2026-09-10T15:40:00.000Z
 *     ---
 *
 *     The body, in markdown, for as long as it needs to be.
 *
 * Everything is optional except the body. A file that is nothing but prose still parses — it
 * arrives with an empty subject and an unknown sender, which is better than being dropped.
 */

/** Who a message is FOR. The Face is the claude.ai conversation; the Hands are the terminal. */
export type MailSide = 'face' | 'hands';

export interface MailboxMessage {
  /** The filename, which is also the id. Chronological by construction. */
  file: string;
  from: string;
  to: MailSide;
  subject: string;
  /** ISO 8601. Empty when the file carried no `sent:` line. */
  sentAt: string;
  body: string;
  /** File mtime, epoch ms. 0 when it could not be read. */
  mtimeMs: number;
}

/** A filename that sorts chronologically and says what it is at a glance. */
export function messageFileName(now: Date, subject: string): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-').replace('Z', '');
  const slug = subject
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'message';
  return `${stamp}--${slug}.md`;
}

export function formatMessage(message: {
  from: string;
  to: MailSide;
  subject: string;
  sentAt: string;
  body: string;
}): string {
  return [
    '---',
    `from: ${message.from}`,
    `to: ${message.to}`,
    `subject: ${message.subject}`,
    `sent: ${message.sentAt}`,
    '---',
    '',
    message.body.trimEnd(),
    ''
  ].join('\n');
}

/**
 * Parse a message file. Never throws, and never returns nothing.
 *
 * A mailbox that silently drops a malformed message is the worst possible mailbox — the sender
 * believes it was delivered. So a file with no frontmatter comes back as a message whose whole
 * content is the body, and the reader sees it with an unknown sender rather than not at all.
 */
export function parseMessage(raw: string, file: string): Omit<MailboxMessage, 'file' | 'mtimeMs'> {
  const fallback = {
    from: 'unknown',
    to: 'hands' as MailSide,
    subject: file.replace(/^[\d-]+--/, '').replace(/\.md$/, '').replace(/-/g, ' '),
    sentAt: '',
    body: raw.trim()
  };

  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return fallback;

  const head = match[1] ?? '';
  const body = (match[2] ?? '').trim();
  const field = (name: string): string => {
    const found = new RegExp(`^${name}:\\s*(.*)$`, 'mi').exec(head);
    return (found?.[1] ?? '').trim();
  };

  const to = field('to').toLowerCase() === 'face' ? 'face' : 'hands';
  return {
    from: field('from') || fallback.from,
    to,
    subject: field('subject') || fallback.subject,
    sentAt: field('sent'),
    body: body || fallback.body
  };
}

/**
 * The plain-text form to put on the clipboard for the Face.
 *
 * The Face cannot open a file, so this is what actually crosses: a self-contained block that says
 * where it came from, so a conversation that receives it three days later still has the context.
 */
export function forClipboard(message: MailboxMessage): string {
  return [
    `[From the Hands — SkynetOS mailbox, ${message.file}]`,
    message.subject ? `Subject: ${message.subject}` : '',
    '',
    message.body,
    ''
  ].filter((line, i) => line !== '' || i > 0).join('\n');
}
