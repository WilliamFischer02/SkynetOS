import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import {
  BASE_SPEECH_MODEL,
  chooseVoice,
  clampWarmWait,
  isLoopbackUrl,
  speechRoute,
  newProfile,
  normaliseProfile,
  parseSpeechLine,
  profileSummary,
  profilesRoot,
  safeProfileName,
  sanitiseSpeech,
  speechScript,
  type ProfileLine,
  type ProfileRecordRequest,
  type ProfileRecordResult,
  type SpeechRequest,
  type SpeechState,
  type SpeechStatus,
  type SpeechVia,
  type VoiceProfile,
  type VoiceProfileSummary
} from '@shared/speech.js';
import { getSettings, setSpeechBackend as writeSpeechBackend, setSpeechEnabled as writeSpeechEnabled, setSpeechVoice as writeSpeechVoice } from './settings.js';
import { recordOnce, voiceStatus } from './voice.js';
import { dispatch as turnDispatch } from './turn.js';
import { markTurn } from './turn-timing.js';
import { bankedWav, buildAckBank, type AckBankDeps } from './ack-bank.js';
import { splitFirstSentence } from '@shared/ack.js';
import { ONE_MOMENT } from '@shared/turn.js';
import { decodeWav, type DecodedAudio } from '@shared/aiff.js';
import { LEVEL_FFT, LEVEL_HOP_MS, SILENT_BANDS, analyseTimeline, levelsAt, normaliseTimeline, syntheticLevels, type AudioLevels } from '@shared/speech-levels.js';

/**
 * JARVIS talks back (docs/11-JARVIS-VOICE.md § Speech), and voice profiles (§ Voice profiles).
 *
 * Two backends, one sidecar. Windows' own synthesiser runs in a PowerShell sidecar
 * (`speechScript`, packages/shared/speech.ts) that reads JSON lines and reports START, WORD and
 * DONE, so the hologram can pulse with the words. A local synthesis server, when William has one,
 * answers with a WAV that the same sidecar plays; when it is not running, `sapi` speaks instead so
 * JARVIS is never mute. Nothing here opens a microphone: the profile recorder borrows the voice
 * capture window for ONE line per `profile:record`, which is user-only.
 *
 * Guarantees, and where each is kept:
 *   - Nothing speaks that a user-only channel did not ask for: `speech:say` is in neither
 *     AGENT_METHODS nor REMOTE_METHODS (test/jarvis-voice-contract.test.ts).
 *   - Audio never leaves the machine: the server must be a loopback URL (`isLoopbackUrl`); the
 *     sidecar has no network at all.
 *   - A recording happens only on `profile:record`, into the profile's own folder, and the text of
 *     the line is the only thing written beside it.
 */

const READY_TIMEOUT_MS = 20_000;
// A line of 400 characters takes the GPU a few seconds; the first line after a start also waits for
// the model, which `/warm` is asked to load as soon as the server answers.
const SERVER_TIMEOUT_MS = 90_000;

export interface SpeechHandlers {
  onState(state: SpeechState): void;
  /** Eight band levels and a loudness, thirty a second while a line plays (F1, 2026-09-26). */
  onLevels?(levels: AudioLevels): void;
}
let speechHandlers: SpeechHandlers | null = null;
export function setSpeechHandlers(next: SpeechHandlers): void { speechHandlers = next; }
export function speechHandlersInUse(): SpeechHandlers | null { return speechHandlers; }

let child: ChildProcess | null = null;
let ready = false;
let readyWaiters: ((ok: boolean) => void)[] = [];
let voices: string[] = [];
let current: string | null = null;
let fatal: string | null = null;
let speaking = false;
let speakingText = '';
let speakingChars = 0;
let queue: { text: string; wav?: string; levels?: AudioLevels[]; via: SpeechVia; bank?: boolean }[] = [];
/**
 * Bumped by every stop (and every interrupting line). A `say` still synthesising when it changes
 * drops what it made instead of queueing it: "stop" during a 1.4 s synthesis used to be followed
 * by the line anyway (bug sweep, 2026-09-27).
 */
let speechEpoch = 0;
/** Who is speaking the line in progress, for `speech:state` (the window's "what speaks" line). */
let speakingVia: SpeechVia = 'sapi';
/**
 * The line in progress is JARVIS speaking (not a profile recording played back), so the turn engine
 * hears `speakStart` when it starts and `speakEnd` exactly once when the sidecar says it ended
 * (docs/11 § One turn at a time). The follow-up window no longer hangs off the end of a line: it
 * waits for the TURN to end (services/turn.ts, voice.ts `listenAgain`).
 */
let turnLine = false;
/** `say` calls still synthesising or waiting for the server: not yet queued, but not silence either. */
let saysInFlight = 0;

function lineStarted(text: string, via: SpeechVia = speakingVia, bank = false): void {
  // Also when a line follows straight on from the last (a reply's second sentence): the turn stays
  // SPEAKING and only its words change, instead of flickering back to THINKING between them.
  turnLine = true;
  turnDispatch({ type: 'speakStart', text });
  // "One moment." belongs to the sentence being held, not to the turn it interrupts.
  if (text !== ONE_MOMENT) markTurn('firstAudio', { via: bank ? 'bank' : via === 'server' ? 'server' : 'sapi' });
}

/** Another JARVIS line is queued and will start the moment this one ends. */
function moreToSay(): boolean {
  return ready && queue.length > 0 && queue[0]!.via !== 'recording';
}

function lineEnded(): void {
  if (!turnLine) return;
  turnLine = false;
  turnDispatch({ type: 'speakEnd' });
}
let serverDown: string | null = null;
/**
 * The server's two states that `serverDown` cannot tell apart: answering at all, and having its
 * model loaded. A line routed to a server that is up but cold takes minutes and then times out,
 * which is how the first line after boot used to come out in Microsoft David's voice.
 */
let serverUp = false;
let warm = false;
let warming: Promise<boolean> | null = null;
/** How often a held line looks again while the server starts. */
const WAIT_POLL_MS = 250;
let playWaiters: ((ok: boolean) => void)[] = [];

/*
 * Levels for the hologram (packages/shared/speech-levels.ts). A server line is analysed from its
 * WAV before it plays and streamed by wall clock; a Windows line has no audio to analyse, so its
 * levels are synthesised from the word boundaries the sidecar reports. Either way, thirty a second
 * to `onLevels`, and silence the moment the line ends.
 */
const LEVELS_TICK_MS = LEVEL_HOP_MS;
let levelsTimer: ReturnType<typeof setInterval> | null = null;
let levelsStartedAt = 0;
let levelsTimeline: AudioLevels[] | null = null;
let sapiLevel = 0;
let sapiWord = 0;

function stopLevels(): void {
  if (levelsTimer) { clearInterval(levelsTimer); levelsTimer = null; }
  levelsTimeline = null;
  speechHandlers?.onLevels?.({ t: 0, bands: [...SILENT_BANDS], rms: 0 });
}

function startLevels(timeline: AudioLevels[] | null): void {
  if (levelsTimer) clearInterval(levelsTimer);
  levelsStartedAt = Date.now();
  levelsTimeline = timeline;
  sapiLevel = 1;
  sapiWord = 0;
  levelsTimer = setInterval(() => {
    const at = Date.now() - levelsStartedAt;
    if (levelsTimeline) {
      const frame = levelsAt(levelsTimeline, at);
      if (frame) speechHandlers?.onLevels?.({ t: at, bands: frame.bands, rms: frame.rms });
      else speechHandlers?.onLevels?.({ t: at, bands: [...SILENT_BANDS], rms: 0 });
      return;
    }
    // Windows' voice: decay between words; `word` bumps `sapiLevel` back up.
    sapiLevel = Math.max(0, sapiLevel - LEVELS_TICK_MS / 320);
    speechHandlers?.onLevels?.({ t: at, bands: syntheticLevels(sapiLevel, sapiWord), rms: sapiLevel });
  }, LEVELS_TICK_MS);
}

/**
 * Decode a WAV the server wrote and analyse it in slices, yielding to the event loop between them
 * so a long line never stalls main. Returns null when the file cannot be read; the line still plays.
 */
async function analyseWav(file: string): Promise<AudioLevels[] | null> {
  let decoded: DecodedAudio;
  try {
    decoded = decodeWav(new Uint8Array(readFileSync(file)));
  } catch (err) {
    console.log(`[speech] could not analyse ${file}: ${(err as Error).message}`);
    return null;
  }
  const hop = Math.max(1, Math.round((decoded.sampleRate * LEVEL_HOP_MS) / 1000));
  const total = Math.ceil(decoded.samples.length / hop);
  const out: AudioLevels[] = [];
  const SLICE = 60; // about two seconds of audio per turn of the loop
  for (let i = 0; i < total; i += SLICE) {
    const end = Math.min(total, i + SLICE);
    const from = i * hop;
    const to = Math.min(decoded.samples.length, (end - 1) * hop + LEVEL_FFT);
    const part = analyseTimeline(decoded.samples.subarray(from, to), decoded.sampleRate);
    for (let k = 0; k < end - i && k < part.length; k++) out.push({ t: Math.round((i + k) * LEVEL_HOP_MS), bands: part[k]!.bands, rms: part[k]!.rms });
    await new Promise<void>((r) => setImmediate(r));
  }
  return normaliseTimeline(out);
}
/** Bumped on every kill so a line from an old sidecar cannot change the new one's state. */
let run = 0;

const voiceDir = (): string =>
  process.env['LOCALAPPDATA'] ? join(process.env['LOCALAPPDATA'], 'SkynetOS', 'voice') : join(app.getPath('userData'), 'voice');
// ONE rule with tools/profile-import.ts (`profilesRoot` in @shared/speech.ts): the importer runs
// outside Electron and must land its WAVs where the app looks for them.
const profilesDir = (): string => profilesRoot(process.env['LOCALAPPDATA'], join(app.getPath('userData'), 'voice-profiles'));

function push(state: SpeechState): void {
  speechHandlers?.onState(state);
  // M13.3: the planner waits for its read-back to finish before the plan runs.
  if (!state.speaking && !state.warming) releaseIdle();
}

function releaseIdle(): void {
  if (speaking || queue.length > 0 || saysInFlight > 0 || !idleWaiters.length) return;
  const waiters = idleWaiters;
  idleWaiters = [];
  for (const w of waiters) w();
}

let idleWaiters: (() => void)[] = [];

/**
 * Resolves true when nothing is being said, nothing is queued and no `say` is still synthesising
 * (the `done`, `stopped`, `played` or exit of the last line), false after `timeoutMs`. The planner
 * runs a plan only after its line is spoken, and the turn engine ends a turn only then
 * (services/turn.ts `finishTurn`), so the follow-up never opens over JARVIS's own voice.
 */
export function whenSpeechIdle(timeoutMs = 30_000): Promise<boolean> {
  if (!speaking && queue.length === 0 && saysInFlight === 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (): void => { clearTimeout(timer); resolve(true); };
    const timer = setTimeout(() => { idleWaiters = idleWaiters.filter((w) => w !== done); resolve(false); }, Math.max(0, timeoutMs));
    idleWaiters.push(done);
  });
}

function chosenVoice(): string | null {
  return chooseVoice(voices, getSettings().speech.voice);
}

/**
 * The checkpoint each profile speaks with, as the server's `GET /profile/<name>` last named it
 * (2026-09-27, the "what speaks" line). Filled in the background; nothing waits for it.
 */
const modelByProfile = new Map<string, string>();

/**
 * Ask the server which checkpoint the current profile speaks with, and remember the answer. Called
 * when the backend is switched, when the server warms, and after a synthesis (a fine-tune that
 * failed to load is only known after the first line). Never awaited by a line; a failure keeps
 * whatever was cached.
 */
function refreshModel(): void {
  void fetchModel();
}

/** The checkpoint the current profile speaks with, asked of the server now; null when it cannot say. */
async function fetchModel(): Promise<string | null> {
  const s = getSettings().speech;
  const profile = s.profile.trim();
  if (s.backend !== 'server' || !profile || !isLoopbackUrl(s.server)) return null;
  try {
    const res = await fetch(`${s.server.replace(/\/$/, '')}/profile/${encodeURIComponent(profile)}`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) { modelByProfile.delete(profile); return null; }
    const body = (await res.json().catch(() => ({}))) as { model?: unknown; finetune?: unknown; finetuneError?: unknown };
    // A fine-tune that would not load speaks with the base model; say that, not the checkpoint.
    const tuned = body.finetune && !body.finetuneError && typeof body.model === 'string' ? body.model : null;
    const model = tuned ?? BASE_SPEECH_MODEL;
    modelByProfile.set(profile, model);
    return model;
  } catch {
    return modelByProfile.get(profile) ?? null; // the cached answer stands
  }
}

/* ── the acknowledgement bank (services/ack-bank.ts; docs/11 § Where the time goes) ── */

const bankDeps: AckBankDeps = {
  profileDir: (profile) => join(profilesDir(), profile),
  synthesise: (text, profile) => synthesiseBytes(text, profile),
  busy: () => speaking || queue.length > 0 || saysInFlight > 0,
  stillWanted: (profile) => {
    const s = getSettings().speech;
    return s.enabled && s.backend === 'server' && s.profile.trim() === profile && serverUp && warm;
  }
};

/**
 * Once the server is warm: the checkpoint named, and the bank built (or topped up, or rebuilt for a
 * new checkpoint) in the background, a line at a time and only while nothing is being said.
 */
async function refreshBank(): Promise<void> {
  const s = getSettings().speech;
  const profile = s.profile.trim();
  if (!s.enabled || s.backend !== 'server' || !profile) return;
  const model = await fetchModel();
  if (!model) return;
  try { await buildAckBank(bankDeps, profile, model); } catch (err) { console.warn('[speech] the acknowledgement bank failed:', (err as Error).message); }
}

/** The banked WAV for exactly this line in the current profile's voice, or null. */
function bankedLine(text: string): string | null {
  const s = getSettings().speech;
  const profile = s.profile.trim();
  if (s.backend !== 'server' || !profile) return null;
  try { return bankedWav(bankDeps, profile, modelByProfile.get(profile) ?? null, text); } catch { return null; }
}

const bankLevels = new Map<string, AudioLevels[] | null>();
async function levelsFor(file: string, cacheIt: boolean): Promise<AudioLevels[] | undefined> {
  if (cacheIt && bankLevels.has(file)) return bankLevels.get(file) ?? undefined;
  const levels = await analyseWav(file);
  if (cacheIt) bankLevels.set(file, levels);
  return levels ?? undefined;
}

/** Why the server is down, in William's words when it cannot be started at all, rather than a fetch error. */
function serverDownWhy(server: string): string {
  if (serverDown && /^(NO SYNTHESIS|tools\/speech-server)/.test(serverDown)) return serverDown;
  return `SERVER NOT RUNNING AT ${server}`;
}

export function speechStatus(): SpeechStatus {
  const s = getSettings().speech;
  // The voice list and the voice in use are known only once the sidecar has answered; start it
  // (no audio, no microphone) so the window can say which Windows voice would speak.
  if (s.enabled && !child && !fatal) void ensureSidecar();
  const base: SpeechStatus = { enabled: s.enabled, backend: s.backend, available: ready, voice: current, voices: [...voices], speaking, warm: serverUp && warm };
  if (s.backend === 'server') {
    base.profile = s.profile;
    const model = modelByProfile.get(s.profile.trim());
    if (model) base.model = model;
  }
  if (fatal) return { ...base, error: fatal };
  if (s.backend === 'server') {
    if (!isLoopbackUrl(s.server)) return { ...base, error: `THE SYNTHESIS SERVER MUST BE ON 127.0.0.1 — ${s.server} IS NOT` };
    // While the server is starting or loading its model it is WARMING, not down.
    const starting = serverStarting !== null || warming !== null;
    if (serverDown && !starting) return { ...base, error: `${serverDownWhy(s.server)} — SEE docs/11 § Installing a synthesis server (SPEAKING WITH WINDOWS' VOICE MEANWHILE)` };
  }
  if (ready && voices.length && !voices.some((v) => /george|ryan|hazel|susan|united kingdom|en-gb/i.test(v))) {
    return { ...base, voice: current ? `${current} (no British voice installed yet)` : current };
  }
  return base;
}

export function setSpeechEnabled(on: boolean): SpeechStatus {
  writeSpeechEnabled(on);
  if (!on) stopSpeaking();
  return speechStatus();
}

/**
 * The Windows voice (`speech.voice`), from the list the sidecar reported, or '' for "choose"
 * (`chooseVoice`). User-only (`speech:setVoice`, the TRAIN panel's voices dropdown). It is the
 * voice of the `sapi` backend and of every line the server backend falls back on.
 */
export function setSpeechVoice(name: unknown): SpeechStatus {
  const want = typeof name === 'string' ? name.trim() : '';
  if (want && !voices.includes(want)) throw new Error(voices.length ? `NO WINDOWS VOICE CALLED ${want.toUpperCase()}` : 'THE WINDOWS VOICES ARE NOT KNOWN YET — SWITCH SAY ON');
  const written = writeSpeechVoice(want);
  if (!written.ok) throw new Error(written.error ?? 'COULD NOT SAVE THE VOICE');
  // The sidecar selects the voice per line; `current` says which one the next line will use.
  if (ready) current = chosenVoice() ?? current;
  return speechStatus();
}

/* ────────────────────────── the sidecar ────────────────────────── */

function ensureSidecar(): Promise<boolean> {
  if (child && ready) return Promise.resolve(true);
  if (child) return new Promise((resolve) => readyWaiters.push(resolve));
  const mine = ++run;
  fatal = null;
  const file = join(voiceDir(), 'speech.ps1');
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, speechScript(), 'utf8');
  } catch (err) {
    fatal = `COULD NOT WRITE THE SPEECH SIDECAR — ${(err as Error).message}`;
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    readyWaiters.push(resolve);
    const timer = setTimeout(() => { if (!ready && run === mine) settle(false, 'THE SPEECH SIDECAR DID NOT ANSWER IN 20 S'); }, READY_TIMEOUT_MS);
    const settle = (ok: boolean, why?: string): void => {
      clearTimeout(timer);
      if (why) fatal = why;
      const waiters = readyWaiters;
      readyWaiters = [];
      for (const w of waiters) w(ok);
    };
    const launch = (shell: string): void => {
      const proc = spawn(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      child = proc;
      let buffer = '';
      proc.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) onLine(line, mine, settle);
      });
      proc.stderr?.on('data', (chunk: Buffer) => console.log(`[speech] ${chunk.toString().trim().slice(0, 300)}`));
      proc.on('error', (err: NodeJS.ErrnoException) => {
        if (child !== proc) return;
        child = null;
        if (err.code === 'ENOENT' && shell === 'powershell.exe' && run === mine) { launch('pwsh'); return; }
        ready = false;
        settle(false, `THE SPEECH SIDECAR WOULD NOT START — ${err.message}`);
      });
      proc.on('exit', (code) => {
        if (child !== proc) return;
        child = null;
        ready = false;
        if (speaking) { speaking = false; push({ speaking: false }); }
        lineEnded();
        if (run === mine && code !== 0 && !fatal) fatal = 'THE SPEECH SIDECAR STOPPED';
        settle(false);
      });
    };
    // Windows PowerShell first: the C# wrapper compiles against .NET Framework's System.Speech there
    // without ceremony; pwsh 7's Add-Type needs a reference set this script does not carry.
    launch('powershell.exe');
  });
}

function onLine(raw: string, mine: number, settle: (ok: boolean, why?: string) => void): void {
  if (run !== mine) return;
  const line = parseSpeechLine(raw);
  switch (line.type) {
    case 'voices':
      voices = line.voices;
      return;
    case 'ready':
      ready = true;
      current = chosenVoice() ?? line.voice;
      settle(true);
      pump();
      return;
    case 'voice':
      current = line.voice;
      return;
    case 'fatal':
      ready = false;
      settle(false, line.message);
      return;
    case 'start':
      speakingChars = line.chars || speakingText.length || 1;
      push({ speaking: true, text: speakingText, progress: 0, level: 1, via: speakingVia });
      startLevels(null);
      if (speakingVia !== 'recording') lineStarted(speakingText, speakingVia);
      return;
    case 'word':
      push({ speaking: true, text: speakingText, progress: Math.min(1, (line.position + line.length) / speakingChars), level: 1, via: speakingVia });
      sapiLevel = 1;
      sapiWord++;
      return;
    case 'done':
    case 'stopped': {
      speaking = false;
      speakingText = '';
      // The next line is already made (a reply's second sentence): straight on, no gap in the turn.
      if (moreToSay()) { pump(); return; }
      lineEnded();
      stopLevels();
      push({ speaking: false });
      pump();
      // The follow-up window used to open here, at the end of any line that answered a sentence.
      // It now waits for the TURN to end (services/turn.ts; voice.ts `listenAgain`).
      return;
    }
    case 'played': {
      const waiters = playWaiters;
      playWaiters = [];
      for (const w of waiters) w(true);
      speaking = false;
      if (moreToSay()) { pump(); return; }
      lineEnded();
      stopLevels();
      push({ speaking: false });
      pump();
      return;
    }
    case 'fault':
      console.log(`[speech] fault: ${line.message}`);
      if (line.message.startsWith('play')) {
        const waiters = playWaiters;
        playWaiters = [];
        for (const w of waiters) w(false);
        speaking = false;
        lineEnded();
        stopLevels();
        push({ speaking: false });
        pump();
      }
      return;
    default:
      console.log(`[speech] ${line.text.slice(0, 200)}`);
  }
}

function sendToSidecar(message: Record<string, unknown>): boolean {
  if (!child || !child.stdin || child.stdin.destroyed) return false;
  child.stdin.write(JSON.stringify(message) + '\n');
  return true;
}

function pump(): void {
  if (speaking || !ready) return;
  const next = queue.shift();
  if (!next) return;
  const s = getSettings().speech;
  speaking = true;
  speakingText = next.text;
  speakingVia = next.via;
  if (next.wav) {
    push({ speaking: true, text: next.text, progress: 0, level: 1, via: next.via });
    if (!sendToSidecar({ play: next.wav })) { speaking = false; lineEnded(); stopLevels(); push({ speaking: false }); return; }
    // A server line reports nothing until PLAYED: it has started the moment the file is sent.
    if (next.via !== 'recording') lineStarted(next.text, next.via, next.bank === true);
    // The sidecar's `play` blocks its loop for the WAV's length and reports nothing until PLAYED,
    // so the timeline is streamed by wall clock from the moment the command went out.
    startLevels(next.levels ?? null);
    return;
  }
  if (!sendToSidecar({ say: next.text, voice: chosenVoice() ?? '', rate: s.rate, volume: s.volume })) {
    speaking = false;
    lineEnded();
    stopLevels();
    push({ speaking: false });
  }
}

/* ────────────────────────── the server backend ────────────────────────── */

/**
 * One line through the server, as WAV bytes (or null, with `serverDown` saying why). Used by `say`
 * and by the acknowledgement bank's build.
 */
async function synthesiseBytes(text: string, profile?: string): Promise<Uint8Array | null> {
  const s = getSettings().speech;
  if (!isLoopbackUrl(s.server)) { serverDown = 'not loopback'; return null; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_TIMEOUT_MS);
  try {
    const res = await fetch(`${s.server.replace(/\/$/, '')}/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, profile: (profile ?? s.profile) || undefined }),
      signal: controller.signal
    });
    if (!res.ok) { serverDown = `answered ${res.status}`; return null; }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength < 44 || String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) !== 'RIFF') { serverDown = 'did not answer with a WAV'; return null; }
    serverDown = null;
    serverUp = true;
    return bytes;
  } catch (err) {
    serverDown = (err as Error).message;
    serverUp = false;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Spoken lines rotate through eight files. One `latest.wav` meant a line queued behind another was
 * overwritten by the next synthesis before it played (it said the wrong words), and a reply split
 * at its first sentence always has two in flight.
 */
const SPOKEN_FILES = 8;
let spokenSlot = 0;

async function synthesiseOnServer(text: string): Promise<string | null> {
  const bytes = await synthesiseBytes(text);
  if (!bytes) return null;
  try {
    const dir = join(voiceDir(), 'spoken');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `line-${spokenSlot}.wav`);
    spokenSlot = (spokenSlot + 1) % SPOKEN_FILES;
    writeFileSync(file, bytes);
    refreshModel();
    return file;
  } catch (err) {
    // The disk, not the server: the line falls back to Windows' voice, the server stays up.
    console.log(`[speech] could not write the synthesised line: ${(err as Error).message}`);
    return null;
  }
}

/* ── the server's own process (docs/11 § Installing a synthesis server) ── */

let server: ChildProcess | null = null;
let serverStarting: Promise<boolean> | null = null;

/** The venv `npm run speech:install` makes, beside whisper's folders. */
function synthPython(): string {
  return join(voiceDir(), 'tts', 'venv', 'Scripts', 'python.exe');
}

function synthScript(): string {
  // The repo's tools/speech-server.py, next to the app in dev and in resources when packaged.
  const dev = join(process.cwd(), 'tools', 'speech-server.py');
  if (existsSync(dev)) return dev;
  return join(process.resourcesPath ?? process.cwd(), 'tools', 'speech-server.py');
}

function serverPort(): number {
  try { return Number(new URL(getSettings().speech.server).port) || 47832; } catch { return 47832; }
}

/**
 * Start tools/speech-server.py from the venv when the backend is `server` and nothing answers.
 * Once per app run unless it exits; a missing venv is reported in `serverDown`, never installed
 * from here (that is `npm run speech:install`, William's command, because it downloads).
 */
export async function startSynthServer(): Promise<boolean> {
  if (server && server.exitCode === null) return true;
  if (serverStarting) return serverStarting;
  const py = synthPython();
  const script = synthScript();
  if (!existsSync(py)) { serverDown = `NO SYNTHESIS ENVIRONMENT — RUN npm run speech:install`; return false; }
  if (!existsSync(script)) { serverDown = `tools/speech-server.py NOT FOUND AT ${script}`; return false; }
  serverStarting = (async () => {
    const proc = spawn(py, [script, '--port', String(serverPort())], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    server = proc;
    proc.stderr?.on('data', (chunk: Buffer) => { for (const line of chunk.toString('utf8').split(/\r?\n/)) if (line.trim()) console.log(line.trim()); });
    proc.on('exit', (code) => {
      console.log(`[speech] synthesis server exited (${code})`);
      if (server === proc) server = null;
      // Whatever a held line was waiting for is gone; `speechRoute` sends it to Windows' voice.
      serverUp = false;
      warm = false;
    });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && server === proc) {
      if (await checkServer()) {
        console.log('[speech] synthesis server is up; loading the model');
        void warmServer();
        return true;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  })().finally(() => { serverStarting = null; });
  return serverStarting;
}

/**
 * Ask the server to load its model, once at a time, and remember that it did. Idempotent on the
 * server's side, so it is safe to ask a server William started himself. `warm` is what lets
 * `speechRoute` tell "up" from "ready to speak in his voice".
 */
function warmServer(): Promise<boolean> {
  if (warming) return warming;
  if (warm && serverUp) return Promise.resolve(true);
  warming = (async () => {
    try {
      const res = await fetch(`${getSettings().speech.server.replace(/[/]$/, '')}/warm`, { signal: AbortSignal.timeout(180_000) });
      if (!res.ok) { console.log(`[speech] model warm-up answered ${res.status}`); return false; }
      const body = (await res.json().catch(() => ({}))) as { seconds?: number; device?: string };
      console.log(`[speech] model ready on ${body.device ?? '?'} in ${body.seconds ?? '?'} s`);
      serverUp = true;
      warm = true;
      void refreshBank();
      return true;
    } catch (err) {
      console.log(`[speech] model warm-up failed: ${(err as Error).message}`);
      return false;
    }
  })().finally(() => { warming = null; });
  return warming;
}

/**
 * Boot: when the backend is `server`, start it now and load the model, so the first line of the
 * day is not the one that finds out the server is cold. Called once from main after the handlers
 * are set. Nothing is spoken; nothing is installed (a missing venv is only reported).
 */
export function startSpeechAtBoot(): void {
  if (getSettings().speech.backend !== 'server') return;
  void (async () => {
    if (await checkServer()) { void warmServer(); return; }
    await startSynthServer();
  })();
}

function stopSynthServer(): void {
  const proc = server;
  server = null;
  if (proc && proc.exitCode === null) { try { proc.kill(); } catch { /* going anyway */ } }
}

/** Which voice: Windows' own, or a profile through the server. Writes the setting and acts on it. */
export async function setSpeechBackend(req: { backend: 'sapi' | 'server'; profile?: string }): Promise<SpeechStatus> {
  const backend = req?.backend === 'server' ? 'server' : 'sapi';
  const profile = typeof req?.profile === 'string' ? req.profile.trim() : getSettings().speech.profile;
  const written = writeSpeechBackend(backend, profile);
  if (!written.ok) throw new Error(written.error ?? 'COULD NOT SAVE THE SPEECH SETTING');
  if (backend === 'server') {
    if (await checkServer()) { refreshModel(); void warmServer().then((ok) => { if (ok) void refreshBank(); }); }
    else await startSynthServer();
  }
  return speechStatus();
}

/** Is the server up? Cheap, cached in `serverDown`, for the status line. */
export async function checkServer(): Promise<boolean> {
  const s = getSettings().speech;
  if (s.backend !== 'server') return false;
  if (!isLoopbackUrl(s.server)) { serverDown = 'not loopback'; return false; }
  try {
    const res = await fetch(`${s.server.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(2000) });
    serverDown = res.ok ? null : `answered ${res.status}`;
    serverUp = res.ok;
    if (!res.ok) warm = false;
    return res.ok;
  } catch (err) {
    serverDown = (err as Error).message;
    serverUp = false;
    warm = false;
    return false;
  }
}

/** Wait for the server while `speechRoute` says so; the answer is where the line goes. */
async function awaitServer(text: string): Promise<'server' | 'sapi'> {
  const started = Date.now();
  const warmWaitMs = clampWarmWait(getSettings().speech.warmWaitMs);
  let held = false;
  for (;;) {
    const route = speechRoute({
      backend: getSettings().speech.backend,
      serverUp,
      warm,
      starting: serverStarting !== null || warming !== null,
      waitedMs: Date.now() - started,
      warmWaitMs
    });
    if (route !== 'wait') {
      if (held) push({ speaking: false, warming: false });
      if (route === 'sapi' && held) console.log(`[speech] waited ${Math.round((Date.now() - started) / 1000)} s for the synthesis server (${serverDown ?? 'still loading'}) — speaking with Windows' voice`);
      return route;
    }
    if (!held) {
      held = true;
      push({ speaking: false, warming: true, text });
    }
    // Up but cold and nobody asking: ask. (A server William started himself lands here.)
    if (serverUp && !warm && !warming) void warmServer();
    await new Promise((r) => setTimeout(r, WAIT_POLL_MS));
  }
}

/* ────────────────────────── the public surface ────────────────────────── */

/**
 * While a `say` is synthesising, the turn engine is told every 5 s that work is still going on, so
 * its 60 s watchdog does not call a slow synthesis (a cold server, a long line) "nothing happened".
 */
let heartbeat: ReturnType<typeof setInterval> | null = null;
function syncHeartbeat(): void {
  if (saysInFlight > 0 && !heartbeat) {
    heartbeat = setInterval(() => turnDispatch({ type: 'progress' }), 5000);
    heartbeat.unref?.();
  } else if (saysInFlight === 0 && heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
}

export async function say(req: SpeechRequest): Promise<{ ok: boolean; error?: string }> {
  const s = getSettings().speech;
  if (!s.enabled) return { ok: false, error: 'SPEECH IS OFF — SWITCH IT ON IN THE HOLOGRAM WINDOW' };
  const text = sanitiseSpeech(req?.text);
  if (!text) return { ok: false, error: 'NOTHING TO SAY' };
  // The first line a sentence gets is also when main knew what to do with it (turn-timing.ts).
  if (text !== ONE_MOMENT) markTurn('intent', { path: 'board' });
  // Counted from here until the line is queued, so `whenSpeechIdle` does not call a line that is
  // still being synthesised "silence" (a turn would end, and the follow-up open, over it).
  saysInFlight++;
  syncHeartbeat();
  try {
    return await sayCounted(req, text);
  } finally {
    saysInFlight--;
    syncHeartbeat();
    releaseIdle();
  }
}

async function sayCounted(req: SpeechRequest, text: string): Promise<{ ok: boolean; error?: string }> {
  const s = getSettings().speech;
  const up = await ensureSidecar();
  if (!up) return { ok: false, error: fatal ?? 'THE SPEECH SIDECAR IS NOT AVAILABLE' };
  if (req.interrupt) {
    queue = [];
    speechEpoch++;
    if (speaking) sendToSidecar({ stop: true });
  }
  const epoch = speechEpoch;
  const enqueue = (item: (typeof queue)[number]): boolean => {
    // Stopped while this was being made: it is not said (bug sweep 2026-09-27).
    if (epoch !== speechEpoch) return false;
    queue.push(item);
    pump();
    return true;
  };
  if (s.backend === 'server') {
    // A banked acknowledgement plays at once, in the profile's voice, with no synthesis at all.
    const banked = bankedLine(text);
    if (banked) {
      markTurn('synthStart');
      const levels = await levelsFor(banked, true);
      enqueue({ text, wav: banked, via: 'server', bank: true, ...(levels ? { levels } : {}) });
      return { ok: true };
    }
    // Not up and nobody starting it: start it, without waiting here; `awaitServer` holds the line.
    if (!serverUp && !server && !serverStarting) void startSynthServer();
    const route = await awaitServer(text);
    if (epoch !== speechEpoch) return { ok: true };
    if (route === 'server') {
      // The first sentence first: it starts playing while the rest is synthesised behind it.
      const parts = splitFirstSentence(text) ?? [text];
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        const bankedPart = bankedLine(part);
        markTurn('synthStart');
        const file = bankedPart ?? (await synthesiseOnServer(part));
        if (epoch !== speechEpoch) return { ok: true };
        if (!file) {
          console.log(`[speech] server ${s.server} failed the synthesis (${serverDown}) — speaking with Windows' voice`);
          enqueue({ text: parts.slice(i).join(' '), via: 'sapi' });
          return { ok: true };
        }
        const levels = await levelsFor(file, Boolean(bankedPart));
        if (!enqueue({ text: part, wav: file, via: 'server', ...(bankedPart ? { bank: true } : {}), ...(levels ? { levels } : {}) })) return { ok: true };
      }
      return { ok: true };
    }
    if (!serverUp && !server && !serverStarting) {
      console.log(`[speech] server ${s.server} unavailable (${serverDown}) — speaking with Windows' voice`);
    }
  }
  enqueue({ text, via: 'sapi' });
  return { ok: true };
}

export function stopSpeaking(): { ok: boolean } {
  queue = [];
  speechEpoch++;
  stopLevels();
  // A line the sidecar can no longer report on still ends for the turn.
  if (!child) lineEnded();
  if (!child) return { ok: false };
  sendToSidecar({ stop: true });
  return { ok: true };
}

/** will-quit: the sidecar goes with the app. */
export function stopSpeech(): void {
  stopSynthServer();
  run++;
  queue = [];
  ready = false;
  const proc = child;
  child = null;
  if (proc) {
    try { proc.stdin?.end(); } catch { /* closing anyway */ }
    try { proc.kill(); } catch { /* already gone */ }
  }
}

/* ────────────────────────── voice profiles ────────────────────────── */

function profileFile(name: string): string {
  return join(profilesDir(), name, 'profile.json');
}

function loadProfile(name: string): VoiceProfile | null {
  const file = profileFile(name);
  if (!existsSync(file)) return null;
  let raw: unknown = null;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { raw = null; }
  return normaliseProfile(raw, name, getSettings().speech.server);
}

function saveProfile(profile: VoiceProfile): void {
  const file = profileFile(profile.name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(profile, null, 2) + '\n', 'utf8');
}

export function listProfiles(): VoiceProfileSummary[] {
  const dir = profilesDir();
  if (!existsSync(dir)) return [];
  const out: VoiceProfileSummary[] = [];
  for (const entry of readdirSync(dir)) {
    try {
      if (!statSync(join(dir, entry)).isDirectory()) continue;
    } catch { continue; }
    const name = safeProfileName(entry);
    if (!name || name !== entry) continue;
    const profile = loadProfile(name);
    if (profile) out.push(profileSummary(profile));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function readProfile(name: string): VoiceProfile | null {
  const safe = safeProfileName(name);
  return safe ? loadProfile(safe) : null;
}

export function createProfile(name: string): { ok: boolean; profile?: VoiceProfile; error?: string } {
  const safe = safeProfileName(name);
  if (!safe) return { ok: false, error: 'A PROFILE NAME IS LETTERS, DIGITS AND DASHES' };
  if (existsSync(profileFile(safe))) return { ok: false, error: `A PROFILE CALLED ${safe.toUpperCase()} ALREADY EXISTS` };
  const profile = newProfile(safe, getSettings().speech.server);
  try {
    saveProfile(profile);
  } catch (err) {
    return { ok: false, error: `COULD NOT WRITE THE PROFILE — ${(err as Error).message}` };
  }
  return { ok: true, profile };
}

/**
 * ONE line, ONE microphone opening, ONE wav. The capture window does the listening (it is the
 * only window with a microphone grant), which means voice control must be on. The WAV is the
 * sentence alone at 16 kHz mono, as every capture is; the profile folder is the only place it goes.
 */
export async function recordProfileLine(req: ProfileRecordRequest): Promise<ProfileRecordResult> {
  const safe = safeProfileName(req?.profile);
  if (!safe) return { ok: false, error: 'NO SUCH PROFILE' };
  const profile = loadProfile(safe);
  if (!profile) return { ok: false, error: `NO PROFILE CALLED ${safe.toUpperCase()} — CREATE IT FIRST` };
  const line = profile.lines.find((l) => l.id === req.lineId);
  if (!line) return { ok: false, error: 'NO SUCH LINE IN THIS PROFILE' };
  const phase = voiceStatus().phase;
  if (phase === 'off' || phase === 'unavailable' || phase === 'starting') return { ok: false, error: 'TURN THE MICROPHONE ON FIRST (MIC SWITCH)' };
  if (speaking) stopSpeaking();

  const started = Date.now();
  const maxMs = Math.max(2000, Math.min(15_000, Number(req.maxMs) || 12_000));
  const capture = await recordOnce({ profile: safe, lineId: line.id, maxMs });
  const raw = capture?.wav;
  const wav = raw && ArrayBuffer.isView(raw) ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) : null;
  if (!wav) {
    return { ok: false, error: capture?.reason === 'error' ? `THE MICROPHONE WOULD NOT OPEN — ${capture.error ?? 'no reason given'}` : 'NOTHING WAS HEARD — READ THE LINE, THEN PAUSE' };
  }
  if (wav.byteLength < 44 || String.fromCharCode(wav[0]!, wav[1]!, wav[2]!, wav[3]!) !== 'RIFF') return { ok: false, error: 'THAT WAS NOT A RECORDING' };

  const file = `line-${line.id}.wav`;
  try {
    writeFileSync(join(profilesDir(), safe, file), wav);
  } catch (err) {
    return { ok: false, error: `COULD NOT WRITE THE RECORDING — ${(err as Error).message}` };
  }
  // 16 kHz, 16-bit mono: two bytes per sample, minus the 44-byte header.
  const ms = Math.round(((wav.byteLength - 44) / 2 / 16_000) * 1000);
  const recorded: ProfileLine = { ...line, file, ms, recordedAt: new Date().toISOString() };
  const next: VoiceProfile = { ...profile, updatedAt: new Date().toISOString(), lines: profile.lines.map((l) => (l.id === line.id ? recorded : l)) };
  try {
    saveProfile(next);
  } catch (err) {
    return { ok: false, error: `RECORDED, BUT COULD NOT UPDATE profile.json — ${(err as Error).message}` };
  }
  console.log(`[speech] profile ${safe}: recorded ${line.id} (${ms} ms, ${Date.now() - started} ms end to end)`);
  return { ok: true, line: recorded };
}

/**
 * Set or correct what a line says. Imported clips arrive with a whisper transcript or none at all,
 * and a profile is only as good as its transcripts; scripted lines may be corrected too, if William
 * read one differently. Text only: the file is never touched.
 */
export function setProfileLineText(req: { profile: string; lineId: string; text: string }): { ok: boolean; error?: string } {
  const safe = safeProfileName(req?.profile);
  const profile = safe ? loadProfile(safe) : null;
  if (!safe || !profile) return { ok: false, error: 'NO SUCH PROFILE' };
  const line = profile.lines.find((l) => l.id === req.lineId);
  if (!line) return { ok: false, error: 'NO SUCH LINE IN THIS PROFILE' };
  const text = sanitiseSpeech(req.text);
  const next: VoiceProfile = { ...profile, updatedAt: new Date().toISOString(), lines: profile.lines.map((l) => (l.id === line.id ? { ...l, text } : l)) };
  try {
    saveProfile(next);
  } catch (err) {
    return { ok: false, error: `COULD NOT UPDATE profile.json — ${(err as Error).message}` };
  }
  return { ok: true };
}

export async function playProfileLine(req: { profile: string; lineId: string }): Promise<{ ok: boolean; error?: string }> {
  const safe = safeProfileName(req?.profile);
  const profile = safe ? loadProfile(safe) : null;
  if (!safe || !profile) return { ok: false, error: 'NO SUCH PROFILE' };
  const line = profile.lines.find((l) => l.id === req.lineId);
  if (!line?.file) return { ok: false, error: 'THAT LINE HAS NOT BEEN RECORDED' };
  const path = join(profilesDir(), safe, line.file);
  if (!existsSync(path)) return { ok: false, error: 'THE RECORDING IS MISSING FROM DISK' };
  const up = await ensureSidecar();
  if (!up) return { ok: false, error: fatal ?? 'THE SPEECH SIDECAR IS NOT AVAILABLE' };
  if (speaking) { queue = []; speechEpoch++; sendToSidecar({ stop: true }); }
  const done = new Promise<boolean>((resolve) => playWaiters.push(resolve));
  queue.push({ text: line.text, wav: path, via: 'recording' });
  pump();
  const ok = await done;
  return ok ? { ok: true } : { ok: false, error: 'WINDOWS COULD NOT PLAY THE FILE' };
}
