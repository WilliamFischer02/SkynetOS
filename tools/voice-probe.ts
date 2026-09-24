/**
 * The speech engine end to end, WITHOUT a microphone.
 *
 * Windows' speech synthesiser speaks a handful of sentences into WAV files. whisper-server is started with
 * the arguments services/voice.ts uses, on a spare port so a running SkynetOS is not disturbed. Each file is
 * posted the way the service posts a captured sentence, and each transcript goes through the same cleaning
 * and the same grammar the board uses.
 *
 * What it cannot test is the wake phrase and the microphone: those need a person in the room, and a probe
 * that opened a microphone without one would break the rule it exists to check (docs/07-SECURITY.md, Voice).
 *
 *   npm run voice:probe
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { resolveIntent, type Intent, type IntentContext } from '@shared/intent.js';
import { DEFAULT_VOICE, transcriptOf } from '@shared/voice.js';

const LOCAL = process.env['LOCALAPPDATA'] ?? '';
const SERVER = process.env['SKYNET_VOICE_SERVER'] ?? join(LOCAL, 'SkynetOS', 'voice', 'cuda', 'Release', 'whisper-server.exe');
const MODEL = process.env['SKYNET_VOICE_MODEL'] ?? join(LOCAL, 'SkynetOS', 'voice', 'models', 'ggml-large-v3-turbo-q5_0.bin');
const PORT = DEFAULT_VOICE.port + 68;
const OUT = join(tmpdir(), 'skynetos-voice-probe');

interface Case {
  file: string;
  say: string;
  /** What the grammar must make of it, when that is part of the contract. */
  expect?: (intent: Intent) => boolean;
  expectWords: string;
}

const CASES: Case[] = [
  { file: 'zoom.wav', say: 'Zoom in on the board.', expectWords: 'any' },
  { file: 'manual.wav', say: 'Give me manual control.', expectWords: 'any' },
  {
    file: 'stop.wav',
    say: 'Stop listening.',
    expectWords: 'voiceControl off',
    expect: (intent) => intent.kind === 'view' && intent.action.type === 'voiceControl' && !intent.action.on
  },
  {
    file: 'question.wav',
    say: 'What did I work on yesterday?',
    expectWords: 'a question for the Face',
    expect: (intent) => intent.kind === 'unknown' && !intent.understood
  }
];

const context: IntentContext = { boardId: 'root', nodes: [], edges: [], selectedId: null, actor: 'voice' };

function quote(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

function synthesise(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const script = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    '$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo 16000, ([System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen), ([System.Speech.AudioFormat.AudioChannel]::Mono)',
    ...CASES.flatMap((c) => [`$s.SetOutputToWaveFile(${quote(join(OUT, c.file))}, $f)`, `$s.Speak(${quote(c.say)})`]),
    '$s.SetOutputToNull()'
  ].join('\r\n');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true });
    child.stdout.resume();
    child.stderr.resume();
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`speech synthesiser exited ${code}`))));
  });
}

async function waitForServer(): Promise<void> {
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('whisper-server did not come up within 120 s');
}

async function transcribe(file: string): Promise<{ text: string; ms: number }> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(readFileSync(file))], { type: 'audio/wav' }), 'sentence.wav');
  form.append('response_format', 'json');
  form.append('temperature', '0');
  const started = performance.now();
  const res = await fetch(`http://127.0.0.1:${PORT}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`whisper-server answered ${res.status}`);
  const text = transcriptOf(await res.json());
  return { text, ms: Math.round(performance.now() - started) };
}

function describeIntent(intent: Intent): string {
  if (intent.kind === 'view') return `view ${intent.action.type}`;
  if (intent.kind === 'unknown') return `unknown (${intent.understood ? 'a command it could not carry out' : 'not a command: goes to the Face'})`;
  return intent.kind;
}

async function main(): Promise<number> {
  for (const [name, path] of [['server', SERVER], ['model', MODEL]] as const) {
    if (!existsSync(path)) {
      console.error(`FAIL  no ${name} at ${path}`);
      return 1;
    }
  }
  console.log(`engine  ${basename(SERVER)} · ${basename(MODEL)} · 127.0.0.1:${PORT}`);
  await synthesise();

  const loadStarted = performance.now();
  const server = spawn(SERVER, ['-m', MODEL, '--host', '127.0.0.1', '--port', String(PORT), '-t', '4', '-nt'], {
    cwd: dirname(SERVER),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.resume();
  server.stderr.resume();
  let failures = 0;
  try {
    await waitForServer();
    console.log(`loaded  ${Math.round(performance.now() - loadStarted)} ms`);
    const first = join(OUT, CASES[0]!.file);
    for (let n = 1; n <= 2; n++) console.log(`warm ${n}  ${(await transcribe(first)).ms} ms`);

    for (const c of CASES) {
      const { text, ms } = await transcribe(join(OUT, c.file));
      const intent = resolveIntent(text, context);
      const heard = text.length > 0;
      const meant = c.expect ? c.expect(intent) : true;
      if (!heard || !meant) failures++;
      console.log(`${heard && meant ? 'PASS' : 'FAIL'}  ${String(ms).padStart(4)} ms  said "${c.say}"  heard "${text}"  → ${describeIntent(intent)}${c.expect ? `  (want ${c.expectWords})` : ''}`);
    }
  } finally {
    server.kill();
  }
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED — no microphone was opened');
  return failures ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`FAIL  ${(err as Error).message}`);
    process.exit(1);
  }
);
