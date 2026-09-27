/**
 * Dictation: one press to start, one to stop, the words typed into whatever has focus.
 *
 * William, 2026-09-26: "a voice dictate button, one click to start, one click after that to stop,
 * listens and transcribes from the microphone between." Everything that decides is here and pure;
 * src/main/services/dictate.ts owns the microphone, whisper and the keystrokes.
 *
 * Shape of a take: the capture window records at most 15 s at a time (its own cap for a profile
 * line), so a dictation is a CHAIN of takes, each transcribed and typed as it lands, until the
 * second press, `DICTATE_MAX_MS` in total, or a take that heard nothing. The second press is
 * honoured at the next take boundary: the microphone cannot be cut mid-take from here.
 *
 * docs/07 § Voice: the microphone opens only on William's press or hotkey, the audio goes to
 * whisper on 127.0.0.1 and nowhere else, and nothing is written to disk.
 */

export type DictatePhase = 'idle' | 'listening' | 'transcribing' | 'typing';

export interface DictateStatus {
  phase: DictatePhase;
  /** The global shortcut, as Electron spells it. */
  hotkey: string;
  /** False when the shortcut could not be registered (another program holds it). Never fatal. */
  hotkeyOk: boolean;
  /** ms since epoch when the current dictation began. */
  startedAt?: number;
  /** Characters typed so far in this dictation. */
  typed: number;
  /** The last transcript typed, for the caption. */
  lastText?: string;
  error?: string;
  maxMs: number;
}

export const DICTATE_HOTKEY = 'CommandOrControl+Alt+D';
/** A whole dictation, all takes together. */
export const DICTATE_MAX_MS = 60_000;
/** One take: the capture window's own ceiling for a recorded line. */
export const DICTATE_TAKE_MS = 15_000;
/** SendKeys is sent in pieces this long, 20 ms apart, so a long sentence cannot jam the target. */
export const DICTATE_CHUNK_CHARS = 200;

export type DictateEvent = 'toggle' | 'captured' | 'nothing' | 'typed' | 'failed' | 'timeout';

/**
 * The state machine. `toggle` while idle starts; while listening it asks to stop (the phase stays
 * `listening` until the take ends, which is why `stopRequested` is tracked beside it by main).
 */
export function nextPhase(phase: DictatePhase, event: DictateEvent): DictatePhase {
  switch (phase) {
    case 'idle':
      return event === 'toggle' ? 'listening' : 'idle';
    case 'listening':
      if (event === 'captured') return 'transcribing';
      if (event === 'nothing' || event === 'failed' || event === 'timeout') return 'idle';
      return 'listening';
    case 'transcribing':
      if (event === 'typed') return 'typing';
      if (event === 'failed' || event === 'timeout') return 'idle';
      return 'transcribing';
    case 'typing':
      // After typing, main decides: another take (back to listening) or done (idle).
      if (event === 'toggle' || event === 'failed' || event === 'timeout' || event === 'nothing') return 'idle';
      if (event === 'captured') return 'listening';
      return 'typing';
  }
}

/** Another take is worth opening: not asked to stop, and time left for at least a short one. */
export function mayTakeAgain(input: { stopRequested: boolean; startedAt: number; now: number; maxMs?: number }): boolean {
  if (input.stopRequested) return false;
  const limit = input.maxMs ?? DICTATE_MAX_MS;
  return input.now - input.startedAt < limit - 2000;
}

/** Split typed text into pieces of at most `max` characters, at spaces where there are any. */
export function chunkText(text: string, max: number = DICTATE_CHUNK_CHARS): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(' ', max);
    if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^ /, '');
  }
  if (rest.length) out.push(rest);
  return out;
}

/**
 * Escape text for System.Windows.Forms.SendKeys: `+ ^ % ~ ( ) { } [ ]` are operators there and
 * must be wrapped in braces; a newline is Enter and a tab is Tab. Everything else is sent as is.
 */
export function escapeSendKeys(text: string): string {
  let out = '';
  for (const ch of text) {
    if (ch === '\r') continue;
    if (ch === '\n') { out += '{ENTER}'; continue; }
    if (ch === '\t') { out += '{TAB}'; continue; }
    if ('+^%~(){}[]'.includes(ch)) { out += `{${ch}}`; continue; }
    out += ch;
  }
  return out;
}

/** A whisper transcript, cleaned: bracketed noise tags gone, spaces folded, one trailing space. */
export function cleanTranscript(raw: string): string {
  const text = raw.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  return text;
}

/** The status the service starts from. */
export function idleStatus(hotkeyOk: boolean, hotkey: string = DICTATE_HOTKEY): DictateStatus {
  return { phase: 'idle', hotkey, hotkeyOk, typed: 0, maxMs: DICTATE_MAX_MS };
}
