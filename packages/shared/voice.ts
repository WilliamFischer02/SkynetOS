/**
 * Voice control: what the two halves agree on.
 *
 * The split matters more than the types. Main runs the microphone and produces TEXT; the renderer
 * turns text into a typed command (intent.ts) and acts on it. Main is deliberately ignorant of
 * which room is on screen and what is selected, because those live in the renderer's store, and a
 * second copy of them in main would be a second source of truth about the board — prime directive
 * 2's exact failure mode.
 *
 * So a spoken command travels: wake word → whisper → `voice:heard` → `resolveIntent` → the same
 * command bus a keypress uses, attributed `voice`. Nothing new can be done by voice that could not
 * be done by hand, and deletion still stops at the dialog docs/07 requires.
 */

export interface VoiceSettings {
  /** OFF by default. Only William's own switch turns it on; see docs/07. */
  enabled: boolean;
  /** The single word the pre-wake grammar contains. Nothing else can be recognised before it. */
  word: string;
  /**
   * `whisper-stream.exe`, absolute, and its ggml model. Both live OUTSIDE this repo — the CUDA
   * build unpacks to about 700 MB and the repo is public — so they are paths, not vendored files.
   * Empty means "not installed", which the status reports rather than crashing on.
   */
  exe: string;
  model: string;
  /**
   * whisper-server.exe, absolute. It holds the model loaded for as long as voice is on, so a sentence
   * costs about a tenth of a second rather than the 1.9 s of starting whisper afresh — measured on
   * William-Desktop, 2026-09-12. It binds 127.0.0.1 and nothing else. `exe` and `model` above are the
   * older one-shot engine, kept for tools/voice-gate.mjs.
   */
  server: string;
  /** The model the server holds. large-v3-turbo: 118–153 ms a sentence once warm, and far more accurate. */
  serverModel: string;
  /** The loopback port the server listens on. */
  port: number;
  /**
   * The wake phrases. A closed grammar: before one of these is heard, nothing else can be recognised.
   * Plain lower-case words only, because they are written into a PowerShell script.
   */
  phrases: string[];
  /**
   * Part of the name of the microphone to open AFTER the wake phrase — "volt", say. Empty means the
   * Windows default. The wake phrase itself always listens to the Windows default: Windows' recogniser
   * can listen to nothing else.
   */
  captureLabel: string;
  /** SDL capture device index, or -1 for whatever Windows calls default. */
  capture: number;
  /** Wake-word confidence below which a hit is ignored, 0 to 1. */
  confidence: number;
}

export const DEFAULT_VOICE: VoiceSettings = {
  enabled: false,
  word: 'jarvis',
  exe: '',
  model: '',
  capture: -1,
  confidence: 0.6,
  server: '',
  serverModel: '',
  port: 47831,
  phrases: ['hey jarvis', 'jarvis'],
  captureLabel: ''
};

/** What the board shows before main has said anything. */
export const VOICE_OFF: VoiceStatus = { phase: 'off', enabled: false, muted: false, word: 'hey jarvis' };

/** A wake phrase: plain lower-case words separated by single spaces. Nothing that could escape a script. */
export const WAKE_PHRASE = /^[a-z]+( [a-z]+)*$/;

/**
 * - `off`          switched off. This is the hard mute: every process is stopped, not ignored.
 * - `unavailable`  switched on but it cannot run: no recogniser, no speech engine, no model.
 * - `starting`     the speech engine is loading its model and warming up. The first start after a
 *                  reboot takes longer, while CUDA compiles for this card.
 * - `waiting`      the closed wake grammar is listening, and nothing else is.
 * - `listening`    the wake phrase fired; the capture window has the microphone for one sentence.
 * - `thinking`     the sentence is being transcribed, on this machine.
 */
export type VoicePhase = 'off' | 'unavailable' | 'starting' | 'waiting' | 'listening' | 'thinking';

export interface VoiceStatus {
  phase: VoicePhase;
  enabled: boolean;
  /** The hard mute docs/07 asks for: stops the sidecar outright, not just the handling of it. */
  muted: boolean;
  word: string;
  /** Why it is `unavailable`, in words fit to put on screen. */
  error?: string;
  /** The microphone the last sentence was heard on. */
  device?: string;
  /** The speech model's file name. */
  model?: string;
}

/** One utterance, as heard. Never written to disk. */
export interface VoiceHeard {
  text: string;
  /** The wake word's confidence, which is what opened the microphone at all. */
  confidence: number;
  /** Wake to transcript, in milliseconds, for the record and for tuning. */
  ms: number;
  /** Why there is no text, when something went wrong rather than nobody speaking. */
  error?: string;
}

/**
 * Is this install usable? Pure so the UI can say exactly what is missing without probing disk.
 * The caller supplies the results of its own existence checks.
 */
export function voiceReadiness(
  settings: VoiceSettings,
  present: { server: boolean; model: boolean; recogniser: boolean }
): { ok: true } | { ok: false; error: string } {
  if (!settings.server) return { ok: false, error: 'THE SPEECH ENGINE IS NOT INSTALLED — set voice.server in settings.json' };
  if (!present.server) return { ok: false, error: `WHISPER SERVER NOT FOUND AT ${settings.server}` };
  if (!settings.serverModel) return { ok: false, error: 'NO SPEECH MODEL — set voice.serverModel in settings.json' };
  if (!present.model) return { ok: false, error: `SPEECH MODEL NOT FOUND AT ${settings.serverModel}` };
  if (!present.recogniser) return { ok: false, error: 'WINDOWS HAS NO SPEECH RECOGNISER FOR THE WAKE PHRASE' };
  const phrases = settings.phrases ?? [];
  if (!phrases.length || phrases.some((phrase) => !WAKE_PHRASE.test(phrase))) {
    return { ok: false, error: 'THE WAKE PHRASES MUST BE PLAIN WORDS — for example "hey jarvis"' };
  }
  return { ok: true };
}

/** One sentence from the capture window: its audio, or why there is none. */
export interface VoiceCapture {
  /** 16 kHz mono WAV of the sentence alone. Absent when nothing was said or the microphone failed. */
  wav?: Uint8Array;
  /** The microphone that was opened, by name. */
  device?: string;
  reason?: 'nothing' | 'error';
  error?: string;
}

/** Main to the capture window: the wake phrase fired, open the microphone for one sentence. */
export interface VoiceListen {
  captureLabel: string;
}

/** Main to the board: the wake phrase fired. */
export interface VoiceWake {
  confidence: number;
  phrase: string;
}

/** What the summoned dock is showing. Renderer-only state, typed here beside the events that drive it. */
export interface VoiceMoment {
  stage: 'listening' | 'thinking' | 'nothing' | 'did' | 'asking' | 'sending';
  text?: string;
  say?: string;
}

/**
 * The wake sidecar, as a PowerShell script: Windows' own recogniser with a grammar of the wake phrases
 * and NOTHING else.
 *
 * That is the whole of the "nothing transcribed before the wake word" guarantee, so it is worth being
 * precise about why it holds. A `Choices` grammar can only ever return one of its choices; there is no
 * dictation grammar loaded, so there is no path by which this process emits any other text. It prints
 * READY once, WAKE with a confidence each time a phrase is heard, and FATAL if it cannot run.
 *
 * The confidence is formatted with the invariant culture: on a German or French Windows it would
 * otherwise print "0,95".
 */
export function wakeScript(phrases: readonly string[]): string {
  const clean = phrases.map((phrase) => phrase.trim().toLowerCase());
  if (!clean.length || clean.some((phrase) => !WAKE_PHRASE.test(phrase))) {
    throw new Error('wake phrases must be plain lower-case words');
  }
  return [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Speech',
    '$rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine',
    '$choices = New-Object System.Speech.Recognition.Choices',
    ...clean.map((phrase) => `$choices.Add('${phrase}')`),
    '$builder = New-Object System.Speech.Recognition.GrammarBuilder',
    '$builder.Append($choices)',
    '$rec.LoadGrammar((New-Object System.Speech.Recognition.Grammar $builder))',
    "try { $rec.SetInputToDefaultAudioDevice() } catch { Write-Output ('FATAL no default microphone in Windows: ' + $_.Exception.Message); exit 1 }",
    `Write-Output 'READY listening for: ${clean.join(' / ')}'`,
    '$invariant = [System.Globalization.CultureInfo]::InvariantCulture',
    'while ($true) {',
    "  try { $result = $rec.Recognize([TimeSpan]::FromSeconds(30)) } catch { Write-Output ('FATAL ' + $_.Exception.Message); exit 1 }",
    "  if ($result -ne $null) { Write-Output ('WAKE ' + $result.Confidence.ToString('0.00', $invariant) + ' ' + $result.Text) }",
    '}'
  ].join('\r\n');
}

export type WakeLine =
  | { type: 'ready' }
  | { type: 'wake'; confidence: number; phrase: string }
  | { type: 'fatal'; message: string }
  | { type: 'other'; text: string };

/** One line from the sidecar. Anything that is not READY, WAKE or FATAL is only logged. */
export function parseWakeLine(line: string): WakeLine {
  const text = line.trim();
  if (text.startsWith('READY')) return { type: 'ready' };
  if (text.startsWith('FATAL')) return { type: 'fatal', message: text.slice(5).trim() || 'THE WAKE PHRASE FAILED' };
  const match = /^WAKE\s+([0-9]+[.,][0-9]+|[0-9]+)\s+(.+)$/.exec(text);
  if (match) {
    const confidence = Number(match[1]!.replace(',', '.'));
    if (Number.isFinite(confidence)) return { type: 'wake', confidence, phrase: match[2]!.trim().toLowerCase() };
  }
  return { type: 'other', text };
}

/**
 * The words from whisper-server's JSON, with its markers for non-speech removed.
 *
 * Whisper writes "[BLANK_AUDIO]", "(keyboard clicking)" and the like for sounds that are not words. A
 * sentence that is nothing but those, or nothing but punctuation, is no sentence.
 */
export function transcriptOf(raw: unknown): string {
  const text = raw && typeof raw === 'object' && typeof (raw as { text?: unknown }).text === 'string' ? (raw as { text: string }).text : '';
  const cleaned = text.replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ').replace(/\s+/g, ' ').trim();
  return /[a-z0-9]/i.test(cleaned) ? cleaned : '';
}
