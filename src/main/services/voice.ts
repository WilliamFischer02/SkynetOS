import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { app, BrowserWindow, session, type WebContents } from 'electron';
import {
  clampFollowUpNoSpeech,
  FOLLOW_UP_PAUSE_MS,
  mayListenAgain,
  parseWakeLine,
  transcriptOf,
  voiceReadiness,
  wakeScript,
  VOICE_OFF,
  type VoiceCapture,
  type VoiceHeard,
  type VoiceListen,
  type VoiceMicState,
  type VoiceStatus,
  type VoiceWake
} from '@shared/voice.js';
import { LEVEL_BANDS, type AudioLevels } from '@shared/speech-levels.js';
import type { ProfileRecordRequest } from '@shared/speech.js';
import {
  CONNECTIVE_EXTENSION_MS,
  CONTINUATION_REOPEN_MS,
  DEFAULT_ENDPOINT,
  SENTENCE_MAX_MS,
  encodeWav,
  endsInConnective,
  joinContinuation,
  listenTimeoutMs
} from '@shared/voice-capture.js';
import type { MicKind } from '@shared/turn.js';
import { getSettings, setVoiceEnabled as saveVoiceEnabled } from './settings.js';
import { allowMicrophoneOnly } from './permissions.js';
import { dispatch as turnDispatch, onTurn, sentence as turnSentence, turnState } from './turn.js';

/**
 * Voice control: the wake phrase, the microphone, and the speech engine — all on this machine.
 *
 * ── The pipeline ─────────────────────────────────────────────────────────────────────────────
 *
 *   1. Windows' own recogniser, loaded with a CLOSED grammar of the wake phrases, listens to the
 *      default input. It is structurally incapable of producing any other text.
 *   2. When it hears "Hey JARVIS", a hidden window opens the microphone for ONE sentence, decides
 *      when the sentence has ended (packages/shared/voice-capture.ts), and closes the microphone.
 *   3. The sentence goes to whisper-server on 127.0.0.1, which already holds the model loaded.
 *   4. The text goes to the board, which turns it into a command through the same grammar a gesture
 *      uses — or, if it is not a command, sends it to the Face as a question.
 *
 * ── Why this shape, and not the gate's ───────────────────────────────────────────────────────
 *
 * `tools/voice-gate.mjs` started whisper afresh for every sentence. Measured on William-Desktop on
 * 2026-09-12: loading and running whisper cold took 1,908 ms; a server holding the model took 108–153
 * ms a sentence, for base.en and large-v3-turbo alike. Turbo is markedly more accurate on real speech
 * and costs almost nothing extra once loaded, so the server holds turbo.
 *
 * Two traps found on the way, both handled here. The FIRST request after the model loads is slow —
 * 13 s for turbo while CUDA compiles kernels for this card — so the server is warmed on a sentence of
 * synthesised speech before the wake phrase is armed. And a request carrying a `prompt` field paid its
 * own warm-up (6.3 s), so none is sent.
 *
 * ── The guarantees, and where each is kept ───────────────────────────────────────────────────
 *
 *   - Nothing is transcribed before the wake phrase: only the closed grammar is listening.
 *   - Nothing is heard after the sentence: the capture window stops the stream when it ends.
 *   - Audio never leaves the machine: whisper-server binds 127.0.0.1 (checked in its own log) and the
 *     capture window's CSP allows no network at all.
 *   - No audio is written to disk. The sentence exists in memory between the window and the server.
 *   - Turning voice off stops every process — this switch is the hard mute, not a flag that is ignored.
 *   - Voice cannot approve a deletion (actOnIntent.ts), and no agent or phone can turn it on
 *     (packages/shared/ipc.ts: `voice:setEnabled` is in neither AGENT_METHODS nor REMOTE_METHODS).
 */

const PARTITION = 'voice';
/** Long enough for the first start after a reboot, when CUDA compiles for the card (~45 s measured). */
const READY_TIMEOUT_MS = 120_000;
/**
 * The backstop for one capture: the capture window's own limits are 4 s to start speaking and 20 s
 * of sentence (8 s until 2026-09-27), then 1.1 s of end silence and the 1.8 s connective extension;
 * 3 s spare. 29.9 s for a wake capture (`listenTimeoutMs`, packages/shared/voice-capture.ts); it was
 * 15 s. A follow-up window adds its own longer silence budget.
 */
const LISTEN_TIMEOUT_MS = listenTimeoutMs(DEFAULT_ENDPOINT.noSpeechMs);
/** Twenty seconds of 16 kHz mono is 640 kB. Anything far beyond that is not a sentence. */
const MAX_WAV_BYTES = 1_000_000;
/** The sentence the server is warmed on. Synthesised by Windows, never recorded. */
const WARMUP_SENTENCE = 'Jarvis, zoom in on the board.';

export interface VoiceHandlers {
  onStatus: (status: VoiceStatus) => void;
  onWake: (wake: VoiceWake) => void;
  onHeard: (heard: VoiceHeard) => void;
  /** Microphone levels while LISTENING, for the hologram's globe. Optional: nothing else needs them. */
  onLevels?: (levels: AudioLevels) => void;
}

let handlers: VoiceHandlers | null = null;
let status: VoiceStatus = { ...VOICE_OFF };
let server: ChildProcess | null = null;
let wake: ChildProcess | null = null;
let win: BrowserWindow | null = null;
/** Bumped on every start and stop, so work begun by an earlier run cannot act on a later one. */
let run = 0;
let busy = false;
let wokeAt = 0;
let wakeConfidence = 0;
let listenTimer: NodeJS.Timeout | null = null;
/* The follow-up window (docs/07 § Voice): the one capture that opens without the wake phrase. */
let followUpCapture = false;
let lastHeardAt = 0;
let lastCaptureWasSilence = false;
let followUpTimer: NodeJS.Timeout | null = null;
/*
 * The turn engine (services/turn.ts) is told what the capture window's TRACKS do (`voice:mic`), not
 * what main asked for, so the LISTENING light is on exactly while a microphone is. Which door opened
 * the capture in progress, and, for a sentence that stopped on a connective, its first half.
 */
let captureKind: MicKind | null = null;
let captureDetail: string | undefined;
let continuationCapture = false;
let continued = false;
let carried = '';

function resetCarry(): void {
  continuationCapture = false;
  continued = false;
  carried = '';
}

/** The turn's microphone is closed, whatever the capture window managed to say. */
function closeMicInTurn(): void {
  if (turnState().mic !== 'closed') turnDispatch({ type: 'micClosed' });
}

/**
 * The follow-up window opens when the TURN ends (docs/07 § Voice, 2026-09-27): on DONE, or on
 * WAITING once a question has been spoken. Not when a line stops being spoken, which is how it used
 * to open after the planner's read-back, before anything had moved.
 */
onTurn((prev, next) => {
  // A stop (a new turn id, straight to READY) inside the 350 ms before a follow-up window opens
  // cancels it: STOP opens nothing (bug sweep 2026-09-27; `listenAgain` itself is unchanged).
  if (next.turnId !== prev.turnId && next.phase === 'idle' && followUpTimer) {
    clearTimeout(followUpTimer);
    followUpTimer = null;
  }
  // Only a turn that began with a SPOKEN sentence: not a typed line, not a gesture's plan.
  if (next.origin !== 'voice') return;
  if (next.phase === 'done' && prev.phase !== 'done') listenAgain('done');
  else if (next.phase === 'waiting' && prev.phase !== 'waiting') listenAgain('asked');
});

export function setVoiceHandlers(next: VoiceHandlers): void {
  handlers = next;
}

const voiceDir = (): string =>
  process.env['LOCALAPPDATA'] ? join(process.env['LOCALAPPDATA'], 'SkynetOS', 'voice') : join(app.getPath('userData'), 'voice');

function readinessNow(): ReturnType<typeof voiceReadiness> {
  const voice = getSettings().voice;
  return voiceReadiness(voice, {
    server: Boolean(voice.server) && existsSync(voice.server),
    model: Boolean(voice.serverModel) && existsSync(voice.serverModel),
    // Windows 11 ships the recogniser; the sidecar reports FATAL if it does not, and that is shown.
    recogniser: true
  });
}

function publish(next: Partial<VoiceStatus>): void {
  const voice = getSettings().voice;
  status = { ...status, ...next, enabled: voice.enabled, muted: false, word: voice.phrases[0] ?? voice.word };
  handlers?.onStatus(status);
}

export function voiceStatus(): VoiceStatus {
  const voice = getSettings().voice;
  const current: VoiceStatus = { ...status, enabled: voice.enabled, word: voice.phrases[0] ?? voice.word, model: basename(voice.serverModel || '') };
  if (current.phase === 'off') {
    // Off, but say whether it COULD start, so the settings panel can tell him what is missing first.
    const ready = readinessNow();
    return ready.ok ? { ...current, error: undefined } : { ...current, error: ready.error };
  }
  return current;
}

/** Only the capture window may deliver a sentence. Checked by `registerIpc` on every call. */
export function isVoiceSender(sender: WebContents): boolean {
  return win !== null && !win.isDestroyed() && sender === win.webContents;
}

/** Voice on or off, remembered. Off is the hard mute: every process stops. */
export function setVoiceEnabled(on: boolean): VoiceStatus {
  const written = saveVoiceEnabled(on);
  if (!written.ok) {
    publish({ phase: 'unavailable', error: written.error ?? 'COULD NOT SAVE THE SETTING' });
    return voiceStatus();
  }
  if (!on) {
    stop();
    publish({ phase: 'off', error: undefined });
    return voiceStatus();
  }
  void start();
  return voiceStatus();
}

/** At launch: voice comes back on only if it was on when the app closed. */
export function restoreVoice(): void {
  if (getSettings().voice.enabled) void start();
}

export function stopVoice(): void {
  stop();
}

function stop(): void {
  run++;
  busy = false;
  followUpCapture = false;
  lastCaptureWasSilence = false;
  resetCarry();
  captureKind = null;
  // The capture window is destroyed below and can no longer say its tracks stopped.
  if (turnState().mic !== 'closed') turnDispatch({ type: 'nothingHeard' });
  if (followUpTimer) {
    clearTimeout(followUpTimer);
    followUpTimer = null;
  }
  if (pendingRecord) pendingRecord.resolve({ reason: 'error', error: 'VOICE WAS SWITCHED OFF' });
  if (listenTimer) {
    clearTimeout(listenTimer);
    listenTimer = null;
  }
  if (wake) {
    const child = wake;
    wake = null;
    try { child.kill(); } catch { /* already gone */ }
  }
  if (server) {
    const child = server;
    server = null;
    try { child.kill(); } catch { /* already gone */ }
  }
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}

async function start(): Promise<void> {
  stop();
  const mine = ++run;
  const voice = getSettings().voice;
  const ready = readinessNow();
  if (!ready.ok) {
    publish({ phase: 'unavailable', error: ready.error });
    return;
  }
  publish({ phase: 'starting', error: undefined, model: basename(voice.serverModel) });

  // ── 1. the speech engine, holding the model ─────────────────────────────────────────────────
  const child = spawn(
    voice.server,
    // Greedy decoding (whisper-server's default: no beam), no timestamps, English named rather than
    // left to the build's default so a build that defaults to 'auto' does not add a detection pass.
    ['-m', voice.serverModel, '--host', '127.0.0.1', '--port', String(voice.port), '-t', '4', '-nt', '-l', 'en'],
    { cwd: dirname(voice.server), windowsHide: true }
  );
  server = child;
  // Drained: a child whose output pipe fills up stops, and whisper-server logs every request.
  child.stdout?.on('data', () => undefined);
  child.stderr?.on('data', () => undefined);
  child.on('error', (err) => {
    if (server !== child) return;
    server = null;
    if (run === mine) publish({ phase: 'unavailable', error: `THE SPEECH ENGINE WOULD NOT START — ${err.message}` });
  });
  child.on('exit', (code) => {
    if (server !== child) return;
    server = null;
    if (run !== mine) return;
    stop();
    publish({ phase: 'unavailable', error: `THE SPEECH ENGINE STOPPED (exit ${code ?? '?'})` });
  });

  if (!(await waitForServer(voice.port, () => run !== mine))) {
    if (run !== mine) return;
    stop();
    publish({ phase: 'unavailable', error: 'THE SPEECH ENGINE DID NOT START WITHIN TWO MINUTES' });
    return;
  }

  // ── 2. warmed, so the first real sentence is not the one that pays for CUDA ─────────────────
  await warmUp(voice.port);
  if (run !== mine) return;

  // ── 3. the capture window, ready before it is needed; then the wake phrase ─────────────────
  ensureWindow();
  startWake(mine);
}

async function waitForServer(port: number, cancelled: () => boolean): Promise<boolean> {
  const until = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < until) {
    if (cancelled()) return false;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

/** Windows' speech synthesiser writes a WAV at 16 kHz. Nothing is recorded from any device. */
function synthesise(file: string, sentence: string): Promise<boolean> {
  const script = [
    'Add-Type -AssemblyName System.Speech',
    "$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo 16000, ([System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen), ([System.Speech.AudioFormat.AudioChannel]::Mono)",
    '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    `$synth.SetOutputToWaveFile('${file.replace(/'/g, "''")}', $format)`,
    `$synth.Speak('${sentence.replace(/'/g, "''")}')`,
    '$synth.Dispose()'
  ].join('; ');
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true });
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } resolve(false); }, 20_000);
    child.on('error', () => { clearTimeout(timer); resolve(false); });
    child.on('exit', (code) => { clearTimeout(timer); resolve(code === 0 && existsSync(file)); });
  });
}

async function warmUp(port: number): Promise<void> {
  const file = join(voiceDir(), 'warmup.wav');
  try {
    mkdirSync(dirname(file), { recursive: true });
    if (!existsSync(file)) await synthesise(file, WARMUP_SENTENCE);
  } catch {
    /* falls through to a tone */
  }
  const wav = existsSync(file) ? new Uint8Array(readFileSync(file)) : encodeWav(tone());
  // Twice: the first compiles, the second confirms the steady cost.
  for (let i = 0; i < 2; i++) {
    try {
      await transcribe(wav, port);
    } catch {
      /* a warm-up that fails is not a failure; the first real sentence will simply be slower */
    }
  }
}

/** A second of a voiced tone, for when there is no synthesiser to warm with. */
function tone(): Float32Array {
  const samples = new Float32Array(16000);
  for (let i = 0; i < samples.length; i++) samples[i] = 0.2 * Math.sin((2 * Math.PI * 180 * i) / 16000) * Math.sin((Math.PI * i) / samples.length);
  return samples;
}

async function transcribe(wav: Uint8Array, port: number): Promise<string> {
  const form = new FormData();
  const bytes = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
  form.append('file', new Blob([bytes], { type: 'audio/wav' }), 'sentence.wav');
  form.append('response_format', 'json');
  form.append('temperature', '0');
  const res = await fetch(`http://127.0.0.1:${port}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`the speech engine answered ${res.status}`);
  return transcriptOf(await res.json());
}

function startWake(mine: number): void {
  const voice = getSettings().voice;
  const file = join(voiceDir(), 'wake.ps1');
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, wakeScript(voice.phrases), 'utf8');
  } catch (err) {
    publish({ phase: 'unavailable', error: `COULD NOT WRITE THE WAKE GRAMMAR — ${(err as Error).message}` });
    return;
  }

  const launch = (shell: string): void => {
    const child = spawn(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true });
    wake = child;
    let buffer = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) onWakeLine(line, mine);
    });
    child.stderr?.on('data', (chunk: Buffer) => console.log(`[voice] wake: ${chunk.toString().trim().slice(0, 300)}`));
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (wake !== child) return;
      wake = null;
      // PowerShell 7 first; Windows PowerShell, which ships with Windows, if it is not installed.
      if (err.code === 'ENOENT' && shell === 'pwsh' && run === mine) {
        launch('powershell.exe');
        return;
      }
      if (run === mine) publish({ phase: 'unavailable', error: `THE WAKE PHRASE WOULD NOT START — ${err.message}` });
    });
    child.on('exit', (code) => {
      if (wake !== child) return;
      wake = null;
      if (run === mine && code !== 0) {
        publish({ phase: 'unavailable', error: 'THE WAKE PHRASE STOPPED — check Windows has a default microphone' });
      }
    });
  };
  launch('pwsh');
}

function onWakeLine(raw: string, mine: number): void {
  if (run !== mine) return;
  const line = parseWakeLine(raw);
  if (line.type === 'ready') {
    publish({ phase: 'waiting', error: undefined });
    return;
  }
  if (line.type === 'fatal') {
    publish({ phase: 'unavailable', error: line.message });
    return;
  }
  if (line.type !== 'wake') return;

  const voice = getSettings().voice;
  if (line.confidence < voice.confidence) {
    console.log(`[voice] wake ignored at ${line.confidence.toFixed(2)} (threshold ${voice.confidence})`);
    return;
  }
  // A wake phrase inside the sentence being captured is part of the sentence, not a second wake.
  if (busy) return;
  if (followUpTimer) { clearTimeout(followUpTimer); followUpTimer = null; }
  lastCaptureWasSilence = false;
  // During a busy turn the wake phrase still opens the microphone (the light says so), and what it
  // hears is HELD by the turn engine, never started over the running one; "stop" is obeyed at once.
  openMicrophone(mine, line.confidence, line.phrase, { captureLabel: voice.captureLabel }, 'wake');
}

/** One sentence into the capture window, on a wake or as a follow-up. `busy` until it answers. */
function openMicrophone(mine: number, confidence: number, phrase: string, request: VoiceListen, kind: MicKind): void {
  busy = true;
  captureKind = kind;
  captureDetail = undefined;
  if (!request.continuation) {
    followUpCapture = request.followUp === true;
    wokeAt = Date.now();
    wakeConfidence = confidence;
    resetCarry();
  }
  publish({ phase: 'listening' });
  if (!request.continuation) handlers?.onWake({ confidence, phrase });

  const target = ensureWindow();
  const send = (): void => {
    if (run === mine && !target.isDestroyed()) target.webContents.send('voice:listen', request);
  };
  if (target.webContents.isLoading()) target.webContents.once('did-finish-load', send);
  else send();
  if (listenTimer) clearTimeout(listenTimer);
  const timeout = request.continuation ? listenTimeoutMs(CONNECTIVE_EXTENSION_MS) : request.noSpeechMs ? listenTimeoutMs(request.noSpeechMs) : LISTEN_TIMEOUT_MS;
  listenTimer = setTimeout(() => finish('', mine, 'THE MICROPHONE DID NOT ANSWER'), timeout);
}

/**
 * The capture window's tracks (`voice:mic`, CAPTURE WINDOW ONLY): open, speech begun, closed.
 * Accepted only while a capture is actually open, like the levels. This, not `voice:listen` being
 * sent, is what turns the LISTENING light on and off (docs/11 § One turn at a time).
 */
export function voiceMic(state: VoiceMicState): { ok: boolean } {
  if (!busy && !pendingRecord) return { ok: false };
  const phase = state?.phase;
  if (phase === 'open') {
    turnDispatch({ type: 'micOpened', kind: captureKind ?? 'press', ...(continuationCapture ? { continuation: true } : {}), ...(captureDetail ? { detail: captureDetail } : {}) });
  } else if (phase === 'speech') {
    turnDispatch({ type: 'speechStarted' });
  } else if (phase === 'closed') {
    turnDispatch({ type: 'micClosed' });
  } else {
    return { ok: false };
  }
  return { ok: true };
}

/** Was a sentence heard within the last `ms`? services/speech.ts asks before a follow-up. */
export function heardRecently(ms: number): boolean {
  return lastHeardAt > 0 && Date.now() - lastHeardAt <= ms;
}

/**
 * The follow-up window (docs/07 § Voice): reopen the microphone for ONE more sentence without the
 * wake phrase, once the TURN has ended (DONE, or WAITING on a question it has spoken). The rules are
 * `mayListenAgain` in @shared/voice.ts, which asks `mayFollowUp` (packages/shared/turn.ts) besides
 * the 20 s heard window; this is the clock and the window. It waits FOLLOW_UP_PAUSE_MS so the room's
 * echo of JARVIS's last word is not the first thing it hears, and checks everything again then.
 * Silence closes it without a transcript (`voiceCaptured`), and after silence the next sentence
 * needs the wake phrase again. A FAILED turn never opens it.
 */
export function listenAgain(reason: 'done' | 'asked'): boolean {
  const voice = getSettings().voice;
  // The 20 s window is measured from the turn's END (William, 2026-09-27: a plan longer than 20 s
  // must still get its follow-up), so `lastHeardAt` only says that a sentence was heard at all.
  const endedAt = Date.now();
  const allowed = (): boolean =>
    !busy && !pendingRecord && mayListenAgain(status, voice, lastHeardAt ? Date.now() - endedAt : Number.POSITIVE_INFINITY, lastCaptureWasSilence, turnState());
  if (!allowed()) return false;
  if (!win || win.isDestroyed()) return false;
  const mine = run;
  if (followUpTimer) clearTimeout(followUpTimer);
  followUpTimer = setTimeout(() => {
    followUpTimer = null;
    if (run !== mine || !allowed()) return;
    console.log(`[voice] follow-up window after the turn ended (${reason})`);
    openMicrophone(mine, 1, 'follow-up', { captureLabel: voice.captureLabel, followUp: true, noSpeechMs: clampFollowUpNoSpeech(voice.followUpNoSpeechMs) }, 'followUp');
  }, FOLLOW_UP_PAUSE_MS);
  return true;
}

/*
 * The profile recorder (docs/11 § Voice profiles): ONE line into the same capture window, on a
 * user-only `profile:record` call. The window opens the microphone for that line and returns the
 * WAV the way it returns a sentence; `busy` is held so a wake phrase in the recording is not a
 * second wake. services/speech.ts writes the file into the profile folder; nothing is written here.
 */
let pendingRecord: { resolve: (capture: VoiceCapture) => void; timer: NodeJS.Timeout } | null = null;

export function recordOnce(req: ProfileRecordRequest): Promise<VoiceCapture> {
  if (!win || win.isDestroyed() || status.phase === 'off' || status.phase === 'unavailable' || status.phase === 'starting') {
    return Promise.resolve({ reason: 'error', error: 'THE MICROPHONE IS NOT ON' });
  }
  if (busy || pendingRecord) return Promise.resolve({ reason: 'error', error: 'THE MICROPHONE IS ALREADY IN USE' });
  const mine = run;
  const target = win;
  busy = true;
  // A press, not a sentence: the light comes on with the tracks, and no turn is started.
  captureKind = 'press';
  captureDetail = req.profile === 'dictation' ? 'DICTATION' : 'RECORDING A PROFILE LINE';
  publish({ phase: 'listening' });
  return new Promise<VoiceCapture>((resolve) => {
    const finishRecord = (capture: VoiceCapture): void => {
      if (pendingRecord) clearTimeout(pendingRecord.timer);
      pendingRecord = null;
      busy = false;
      captureKind = null;
      closeMicInTurn();
      if (run === mine) publish({ phase: 'waiting' });
      resolve(capture);
    };
    pendingRecord = {
      resolve: finishRecord,
      timer: setTimeout(() => finishRecord({ reason: 'error', error: 'THE MICROPHONE DID NOT ANSWER' }), req.maxMs + 8000)
    };
    const send = (): void => {
      if (run === mine && !target.isDestroyed()) target.webContents.send('voice:record', req);
      else finishRecord({ reason: 'error', error: 'VOICE WAS SWITCHED OFF' });
    };
    if (target.webContents.isLoading()) target.webContents.once('did-finish-load', send);
    else send();
  });
}

/**
 * Band levels from the capture window while it listens (F1, 2026-09-26). Forwarded to the
 * hologram and nowhere else; no audio, no recording, eight numbers and a loudness. Accepted only
 * while a capture is actually open, so a stale page cannot animate a closed microphone.
 */
export function voiceLevels(levels: AudioLevels): { ok: boolean } {
  if (!busy && !pendingRecord) return { ok: false };
  if (!levels || !Array.isArray(levels.bands)) return { ok: false };
  const bands = levels.bands.slice(0, LEVEL_BANDS).map((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0));
  while (bands.length < LEVEL_BANDS) bands.push(0);
  const rms = typeof levels.rms === 'number' && Number.isFinite(levels.rms) ? Math.min(1, Math.max(0, levels.rms)) : 0;
  handlers?.onLevels?.({ t: Date.now(), bands, rms });
  return { ok: true };
}

/** A sentence, or the reason there is none, from the capture window. */
export async function voiceCaptured(capture: VoiceCapture): Promise<{ ok: boolean }> {
  const mine = run;
  if (pendingRecord) {
    pendingRecord.resolve(capture);
    return { ok: true };
  }
  if (!busy) return { ok: false };
  if (listenTimer) {
    clearTimeout(listenTimer);
    listenTimer = null;
  }
  const closedAt = Date.now();
  // The tracks are stopped before a capture is delivered; should `voice:mic` not have said so, this does.
  closeMicInTurn();
  if (capture?.device) publish({ device: String(capture.device).slice(0, 120) });

  const raw = capture?.wav;
  const wav = raw && ArrayBuffer.isView(raw) ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) : null;
  if (!wav) {
    if (continuationCapture && capture?.reason !== 'error') {
      // He did not go on within the extension: the first half is the sentence.
      finish(carried, mine);
      return { ok: true };
    }
    if (followUpCapture && capture?.reason !== 'error') {
      // Silence in a follow-up window: nothing heard, nothing transcribed, nothing answered. The
      // exchange is over; the next sentence needs the wake phrase.
      followUpCapture = false;
      lastCaptureWasSilence = true;
      busy = false;
      captureKind = null;
      turnDispatch({ type: 'nothingHeard' });
      if (run === mine) publish({ phase: 'waiting' });
      return { ok: true };
    }
    if (continuationCapture) { finish(carried, mine); return { ok: true }; }
    finish('', mine, capture?.reason === 'error' ? `THE MICROPHONE WOULD NOT OPEN — ${capture.error ?? 'no reason given'}` : undefined);
    return { ok: true };
  }
  if (wav.byteLength > MAX_WAV_BYTES || wav.byteLength < 44 || String.fromCharCode(wav[0]!, wav[1]!, wav[2]!, wav[3]!) !== 'RIFF') {
    finish(continuationCapture ? carried : '', mine, continuationCapture ? undefined : 'THAT WAS NOT A SENTENCE');
    return { ok: false };
  }

  publish({ phase: 'thinking' });
  try {
    const text = await transcribe(wav, getSettings().voice.port);
    if (run !== mine) return { ok: true };
    if (continuationCapture) {
      finish(joinContinuation(carried, text), mine);
    } else if (!continued && text && endsInConnective(text) && Date.now() - closedAt <= CONTINUATION_REOPEN_MS) {
      continueSentence(text, wav.byteLength, mine);
    } else {
      if (text && endsInConnective(text) && !continued) console.log(`[voice] "${text}" ends on a connective, but the transcript took ${Date.now() - closedAt} ms (over ${CONTINUATION_REOPEN_MS}); not continued`);
      finish(text, mine);
    }
  } catch (err) {
    finish(continuationCapture ? carried : '', mine, continuationCapture ? undefined : `COULD NOT TRANSCRIBE — ${(err as Error).message}`);
  }
  return { ok: true };
}

/**
 * The sentence stopped on a connective ("open firefox and", "move it to"): it is not over. The
 * microphone reopens ONCE, within 400 ms of closing, as part of the same sentence (the same door,
 * the same turn, the light on again), for at most 1.8 s of silence and what is left of the 20 s
 * cap. What it hears is joined to the first half; if he says nothing more, the first half stands.
 * whisper-server has no streaming partials, so this is the whole of the "interim transcript" rule.
 */
function continueSentence(first: string, wavBytes: number, mine: number): void {
  continued = true;
  continuationCapture = true;
  carried = first;
  turnDispatch({ type: 'partialTranscript', text: first });
  const heardMs = Math.round(((wavBytes - 44) / 2 / 16_000) * 1000);
  const maxMs = Math.max(3000, SENTENCE_MAX_MS - heardMs);
  console.log(`[voice] "${first}" ends on a connective; listening ${CONNECTIVE_EXTENSION_MS} ms more for the rest`);
  openMicrophone(mine, wakeConfidence, 'continuation', { captureLabel: getSettings().voice.captureLabel, continuation: true, noSpeechMs: CONNECTIVE_EXTENSION_MS, maxMs }, captureKind ?? 'wake');
}

function finish(text: string, mine: number, error?: string): void {
  if (listenTimer) {
    clearTimeout(listenTimer);
    listenTimer = null;
  }
  if (run !== mine) return;
  // A continuation that timed out or failed still has its first half: that is the sentence.
  if (!text && continuationCapture && carried) { text = carried; error = undefined; }
  busy = false;
  followUpCapture = false;
  lastCaptureWasSilence = false;
  captureKind = null;
  resetCarry();
  closeMicInTurn();
  const ms = Date.now() - wokeAt;
  if (text) {
    lastHeardAt = Date.now();
    // The turn engine decides: a new turn (and `voice:heard` to the board), or held while one runs.
    publish({ phase: 'waiting' });
    turnSentence(text, { confidence: wakeConfidence, ms, origin: 'voice' });
    return;
  }
  // Nothing, or a fault. Shown on the board only when it was this turn's own sentence that came to
  // nothing; a wake during a busy turn that heard nothing leaves that turn alone.
  const t = turnState();
  const own = t.phase === 'listening' || (t.phase === 'heard' && !t.transcript) || t.phase === 'idle';
  if (error && own) turnDispatch({ type: 'failed', error });
  else turnDispatch({ type: 'nothingHeard' });
  if (own) handlers?.onHeard({ text: '', confidence: wakeConfidence, ms, ...(error ? { error } : {}) });
  publish({ phase: 'waiting' });
}

function ensureWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) return win;
  const ses = session.fromPartition(PARTITION);
  // A microphone and nothing else, on this partition and no other (services/permissions.ts).
  allowMicrophoneOnly(ses, 'voice');
  win = new BrowserWindow({
    show: false,
    width: 240,
    height: 120,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    title: 'SkynetOS — voice',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: PARTITION,
      // A hidden window's timers and audio must not be throttled while a sentence is being heard.
      backgroundThrottling: false,
      // An AudioContext in a window nobody clicked would otherwise start suspended and hear nothing.
      autoplayPolicy: 'no-user-gesture-required'
    }
  });
  win.on('closed', () => {
    win = null;
  });
  const dev = process.env['ELECTRON_RENDERER_URL'];
  void (dev ? win.loadURL(`${dev}/voice.html`) : win.loadFile(join(__dirname, '../renderer/voice.html')));
  return win;
}
