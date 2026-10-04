/**
 * The acknowledgement bank (docs/11 § One turn at a time → Where the time goes; rules in docs/07
 * § JARVIS Voice). Pure: the lines, their keys, and the sentence split. services/ack-bank.ts writes
 * and reads the files; services/speech.ts plays a banked line instead of synthesising it.
 *
 * Measured on William-Desktop, 2026-09-27: the F5 server takes 1,020–1,070 ms to synthesise even a
 * two-word line (the cost is mostly fixed: 32 steps over the reference plus the line), and the
 * sidecar starts a WAV in under 100 ms. A short line JARVIS says often, synthesised ONCE at warm-up
 * in the profile's own voice and played from disk, starts a second sooner every time it is said.
 *
 * The match is EXACT (after the whitespace `sanitiseSpeech` collapses): "Done." is banked, "Done,
 * sir." is not, and a line that is not banked is synthesised as before. Nothing here is a template.
 */

/** Said by the turn engine, the planner, the board and the rule grammar, word for word. */
export const ACK_LINES: readonly string[] = [
  // The brief's short lines (2026-09-27).
  'Right away.',
  'One moment.',
  'Done.',
  'Opening it now.',
  'On it.',
  'Which one?',
  'I heard you.',
  'Same as last time.',
  'Stopping.',
  'That is refused.',
  // The planner's and the turn engine's fixed phrases (services/planner.ts, services/turn.ts).
  'Very well.',
  'Stopped before I began, as asked.',
  'I am still working out the last request.',
  'That timed out; nothing happened for a minute.',
  // replyFor (packages/shared/desktop.ts) and actOnIntent's fixed lines.
  'Stopped there, as asked.',
  'Cancelled.',
  // The rule grammar's fixed replies (packages/shared/intent.ts), the ones said most.
  'Undone.',
  'Redone.',
  'Going up.',
  'Cleared.',
  'Sent.',
  'Back to the board.',
  'Stopped transcribing.',
  'Voice off. The microphone is closed.'
];

/** How a line is compared: the whitespace `sanitiseSpeech` collapses, and nothing else. */
export function ackText(text: unknown): string {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
}

/** FNV-1a, 32-bit, as 8 hex digits. Enough to name a file; the index holds the text itself. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * The file a banked line lives in: keyed by profile, checkpoint and text, so a line synthesised by
 * one checkpoint is never played for another (the bank is rebuilt when the checkpoint changes).
 */
export function ackFile(profile: string, checkpoint: string, text: string): string {
  return `${fnv1a(`${profile}\n${checkpoint}\n${ackText(text)}`)}.wav`;
}

/** `ack/index.json`: which checkpoint the bank was built with, and which line is in which file. */
export interface AckIndex {
  profile: string;
  checkpoint: string;
  builtAt: string;
  lines: Record<string, string>;
}

/** An index read from disk, or null when it is not one. */
export function normaliseAckIndex(raw: unknown): AckIndex | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o['profile'] !== 'string' || typeof o['checkpoint'] !== 'string' || !o['lines'] || typeof o['lines'] !== 'object') return null;
  const lines: Record<string, string> = {};
  for (const [text, file] of Object.entries(o['lines'] as Record<string, unknown>)) {
    if (typeof file === 'string' && /^[0-9a-f]{8}\.wav$/.test(file)) lines[ackText(text)] = file;
  }
  return { profile: o['profile'], checkpoint: o['checkpoint'], builtAt: typeof o['builtAt'] === 'string' ? o['builtAt'] : '', lines };
}

/**
 * What is still to be synthesised: every line, when the index is for another profile or checkpoint
 * (a rebuild); otherwise only the lines it does not hold.
 */
export function ackToBuild(index: AckIndex | null, profile: string, checkpoint: string, lines: readonly string[] = ACK_LINES): { rebuild: boolean; missing: string[] } {
  const rebuild = !index || index.profile !== profile || index.checkpoint !== checkpoint;
  const have = rebuild ? {} : index!.lines;
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const line of lines) {
    const t = ackText(line);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    if (!have[t]) missing.push(t);
  }
  return { rebuild, missing };
}

/** The banked file for exactly this text, or null (the line is synthesised as usual). */
export function ackLookup(index: AckIndex | null, profile: string, checkpoint: string | null, text: string): string | null {
  if (!index || index.profile !== profile) return null;
  // A checkpoint the server has named since must be the one the bank was built with.
  if (checkpoint && index.checkpoint !== checkpoint) return null;
  return index.lines[ackText(text)] ?? null;
}

/* ────────────────────────── the first sentence first ────────────────────────── */

/**
 * A reply split at its first sentence end, so sentence one can be synthesised (and start playing)
 * while the rest is synthesised behind it. Measured 2026-09-27: 1,160 ms for a 10-word first
 * sentence against 1,361 ms for the 19-word reply. Null when there is nothing to gain: one
 * sentence, or a first "sentence" too short to stand alone ("Mr." / "No."), or a rest that is.
 */
export function splitFirstSentence(text: string, minFirst = 12, minRest = 12): [string, string] | null {
  const t = ackText(text);
  // The first . ? ! (or ; after a clause) followed by a space and a capital, a digit or a quote.
  const re = /[.?!;](?=\s+["'“‘(]?[A-Z0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const cut = m.index + 1;
    const first = t.slice(0, cut).trim();
    const rest = t.slice(cut).trim();
    if (first.length < minFirst) continue;
    // Abbreviations that end in a full stop are not sentence ends.
    if (/\b(?:Mr|Mrs|Ms|Dr|St|No|vs|etc|e\.g|i\.e)\.$/i.test(first)) continue;
    if (rest.length < minRest) return null;
    return [first, rest];
  }
  return null;
}
