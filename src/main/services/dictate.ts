/**
 * Dictation: press once (DICTATE in the JARVIS window, or Ctrl+Alt+D anywhere), speak, press
 * again; what was heard is typed into whichever window has focus.
 *
 * William, 2026-09-26: "a voice dictate button, one click to start, one click after that to stop,
 * listens and transcribes from the microphone between." The rules are packages/shared/dictate.ts;
 * this file is the microphone, whisper and the keystrokes.
 *
 * docs/07 § Voice, held to here:
 *   - the microphone opens only on his press or his hotkey, through the same capture window the
 *     profile recorder uses (`recordOnce`), one take of at most 15 s at a time;
 *   - the audio goes to whisper-server on 127.0.0.1 and nowhere else; no file is written;
 *   - the text is typed with System.Windows.Forms.SendKeys from a short PowerShell, never through
 *     the desktop helper, so dictation works with desktop control OFF and moves nothing but the caret;
 *   - `dictate:toggle` and `dictate:status` are user-only; a global shortcut is registered for the
 *     hotkey and its failure is reported, never fatal.
 */
import { BrowserWindow, app, globalShortcut } from 'electron';
import { spawn } from 'node:child_process';
import {
  DICTATE_HOTKEY,
  DICTATE_MAX_MS,
  DICTATE_TAKE_MS,
  chunkText,
  cleanTranscript,
  escapeSendKeys,
  idleStatus,
  mayTakeAgain,
  nextPhase,
  type DictatePhase,
  type DictateStatus
} from '@shared/dictate.js';
import { getSettings } from './settings.js';
import { recordOnce, voiceStatus } from './voice.js';

let status: DictateStatus = idleStatus(false);
let stopRequested = false;
let running: Promise<void> | null = null;

function publish(patch: Partial<DictateStatus>): void {
  status = { ...status, ...patch };
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('dictate:state', status);
  }
}

export function dictateStatus(): DictateStatus {
  return status;
}

/** One press: start when idle, otherwise ask the running dictation to stop at the next take. */
export function toggleDictation(): DictateStatus {
  if (status.phase === 'idle' && !running) {
    stopRequested = false;
    running = dictation().catch((err: unknown) => {
      publish({ phase: 'idle', error: `DICTATION FAILED — ${(err as Error).message}` });
    }).finally(() => { running = null; });
    return status;
  }
  stopRequested = true;
  publish({});
  return status;
}

async function dictation(): Promise<void> {
  const voice = voiceStatus();
  if (voice.phase === 'off' || voice.phase === 'unavailable' || voice.phase === 'starting') {
    publish({ phase: 'idle', error: 'TURN THE MICROPHONE ON FIRST — MIC IN THE JARVIS WINDOW, OR VOICE ON THE BOARD' });
    return;
  }
  const startedAt = Date.now();
  let phase: DictatePhase = nextPhase('idle', 'toggle');
  publish({ phase, startedAt, typed: 0, error: undefined, lastText: undefined });
  const port = getSettings().voice.port;

  for (;;) {
    const left = DICTATE_MAX_MS - (Date.now() - startedAt);
    const capture = await recordOnce({ profile: 'dictation', lineId: `take-${Date.now()}`, maxMs: Math.max(2000, Math.min(DICTATE_TAKE_MS, left)) });
    if (capture.reason === 'error') {
      phase = nextPhase(phase, 'failed');
      publish({ phase, error: capture.error ?? 'THE MICROPHONE WOULD NOT OPEN' });
      return;
    }
    const raw = capture.wav;
    const wav = raw && ArrayBuffer.isView(raw) ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) : null;
    if (!wav || wav.byteLength < 44) {
      // Silence: nothing heard, nothing typed, and the dictation is over.
      phase = nextPhase(phase, 'nothing');
      publish({ phase });
      return;
    }
    phase = nextPhase(phase, 'captured');
    publish({ phase });
    let text = '';
    try {
      text = cleanTranscript(await whisper(wav, port));
    } catch (err) {
      phase = nextPhase(phase, 'failed');
      publish({ phase, error: `COULD NOT TRANSCRIBE — ${(err as Error).message}` });
      return;
    }
    if (text) {
      phase = nextPhase(phase, 'typed');
      publish({ phase, lastText: text });
      await typeText(`${text} `);
      publish({ typed: status.typed + text.length + 1 });
    }
    if (!mayTakeAgain({ stopRequested, startedAt, now: Date.now() })) {
      phase = nextPhase(phase, stopRequested ? 'toggle' : 'timeout');
      publish({ phase });
      return;
    }
    phase = nextPhase(phase, 'captured');
    publish({ phase });
  }
}

/** The same call services/voice.ts makes for a sentence; whisper-server holds the model loaded. */
async function whisper(wav: Uint8Array, port: number): Promise<string> {
  const form = new FormData();
  const bytes = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
  form.append('file', new Blob([bytes], { type: 'audio/wav' }), 'dictation.wav');
  form.append('response_format', 'json');
  form.append('temperature', '0');
  const res = await fetch(`http://127.0.0.1:${port}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`the speech engine answered ${res.status}`);
  const body = (await res.json()) as { text?: unknown };
  return typeof body.text === 'string' ? body.text : '';
}

/**
 * Type into the focused window with SendKeys, in chunks 20 ms apart. The text travels as base64
 * inside the command line, so no quoting rule of PowerShell's can change a character of it.
 */
function typeText(text: string): Promise<void> {
  const pieces = chunkText(text).map(escapeSendKeys);
  if (!pieces.length) return Promise.resolve();
  const payload = Buffer.from(JSON.stringify(pieces), 'utf8').toString('base64');
  const script =
    'Add-Type -AssemblyName System.Windows.Forms; ' +
    `$pieces = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json; ` +
    'foreach ($p in $pieces) { [System.Windows.Forms.SendKeys]::SendWait($p); Start-Sleep -Milliseconds 20 }';
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr?.on('data', (chunk: Buffer) => console.log(`[dictate] sendkeys: ${chunk.toString().trim().slice(0, 200)}`));
    child.on('exit', finish);
    child.on('error', (err) => { console.log(`[dictate] could not start powershell — ${err.message}`); finish(); });
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } finish(); }, 30_000);
  });
}

/** At startup: the hotkey. Skipped in a smoke run, where a global shortcut would outlive the test. */
export function initDictate(): void {
  if (process.env['SKYNET_SMOKE_DIR']) return;
  const register = (): void => {
    let ok = false;
    try {
      ok = globalShortcut.register(DICTATE_HOTKEY, () => { toggleDictation(); });
    } catch (err) {
      console.log(`[dictate] hotkey ${DICTATE_HOTKEY} failed — ${(err as Error).message}`);
    }
    status = { ...idleStatus(ok), ...(ok ? {} : { error: `${DICTATE_HOTKEY} IS HELD BY ANOTHER PROGRAM — USE THE DICTATE BUTTON` }) };
    if (!ok) console.log(`[dictate] could not register ${DICTATE_HOTKEY}; the button still works`);
  };
  if (app.isReady()) register();
  else void app.whenReady().then(register);
  app.on('will-quit', () => {
    try { globalShortcut.unregister(DICTATE_HOTKEY); } catch { /* already gone */ }
  });
}
