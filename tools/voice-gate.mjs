/*
 * tools/voice-gate.mjs — the wake word and utterance gate.
 *
 * The Face's brief, 2026-09-11, and William's answer to it: voice that edits the board live, with
 * the wake word from the start. The hard constraint is docs/07 shaped: "Audio is processed locally
 * and never leaves the machine. Nothing captured before the wake word."
 *
 * How that constraint is actually met here, rather than promised:
 *
 *   - BEFORE the wake word, the only thing listening is Windows' own recogniser loaded with a
 *     grammar of ONE WORD. It is structurally incapable of producing any other text: not a
 *     transcript, not a partial, not a confidence list over a vocabulary. No audio is retained and
 *     nothing is written to disk.
 *   - AFTER the wake word, whisper.cpp is started, transcribes the utterance locally on the GPU,
 *     and is killed when the utterance ends. Nothing is uploaded; whisper.cpp has no network path.
 *
 * The cost of that strictness is one model load per activation (~0.7 s), so a command must follow
 * the wake word after a beat rather than in the same breath. Measured, not assumed: this gate
 * reports the latency from wake to text for every utterance.
 *
 * Usage:
 *   npx electron ... no. This is plain node:
 *   node tools/voice-gate.mjs [--seconds 120] [--capture -1] [--word jarvis] [--confidence 0.6]
 *                             [--model <ggml.bin>] [--exe <whisper-stream.exe>]
 *
 * Writes nothing except its own log to stdout, and a generated .ps1 beside the whisper install
 * (outside this public repo). Touches no board data.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
};

const VOICE = join(homedir(), 'AppData', 'Local', 'SkynetOS', 'voice');
const seconds = Number(arg('seconds', '120'));
const capture = String(arg('capture', '-1'));
/*
 * The wake phrases, comma separated. William asked for "Hey, JARVIS", and a one-word grammar does
 * not match a two-word utterance: Windows' recogniser compares what it heard against the WHOLE
 * grammar, so "hey jarvis" against a grammar containing only "jarvis" is a no-match, not a hit.
 * Both spellings are therefore in the grammar — and it is still a closed grammar of two phrases,
 * so nothing else can be recognised before one of them fires.
 */
const phrases = String(arg('word', 'hey jarvis,jarvis'))
  .split(',')
  .map((phrase) => phrase.trim().toLowerCase())
  .filter((phrase) => /^[a-z]+( [a-z]+)*$/.test(phrase));
const word = phrases[0] ?? 'jarvis';
const minConfidence = Number(arg('confidence', '0.6'));
const model = arg('model', join(VOICE, 'models', 'ggml-base.en.bin'));
const exe = arg('exe', join(VOICE, 'cuda', 'Release', 'whisper-stream.exe'));
/** How long an utterance may run before whisper is stopped regardless. */
const UTTERANCE_MS = 9000;

/*
 * The wake sidecar. One word, nothing else, on the Windows default input. `Recognize()` blocks and
 * returns one result at a time, which is all this needs and avoids event plumbing in PowerShell.
 * It prints one line per hit and nothing else, so the parent can trust every line it reads.
 */
const WAKE_PS1 = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$choices = New-Object System.Speech.Recognition.Choices
${phrases.map((phrase) => `$choices.Add('${phrase}')`).join('\n')}
$builder = New-Object System.Speech.Recognition.GrammarBuilder
$builder.Append($choices)
$grammar = New-Object System.Speech.Recognition.Grammar $builder
$rec.LoadGrammar($grammar)
try { $rec.SetInputToDefaultAudioDevice() } catch { Write-Output ('FATAL no default input device: ' + $_.Exception.Message); exit 1 }
Write-Output ('READY listening for: ${phrases.join(' / ')}')
while ($true) {
  try { $result = $rec.Recognize([TimeSpan]::FromSeconds(30)) } catch { Write-Output ('FATAL ' + $_.Exception.Message); exit 1 }
  if ($result -ne $null) {
    Write-Output ('WAKE ' + $result.Confidence.ToString('0.00') + ' ' + $result.Text)
  }
}
`;

mkdirSync(VOICE, { recursive: true });
const wakeScript = join(VOICE, 'wake-gate.ps1');
writeFileSync(wakeScript, WAKE_PS1, 'utf8');

const log = (...parts) => console.log(`[voice] ${parts.join(' ')}`);
const stamp = () => new Date().toISOString().slice(11, 23);

let wakes = 0;
let utterances = 0;
const results = [];
let listening = null; // the running whisper process, if any

/** Start whisper for one utterance, resolve with { text, ms } or { text: null }. */
const transcribeOnce = (wokeAt) =>
  new Promise((done) => {
    const child = spawn(
      exe,
      ['-m', model, '-c', capture, '--step', '0', '--length', String(UTTERANCE_MS), '-vth', '0.6', '-t', '4'],
      { windowsHide: true }
    );
    listening = child;
    let text = '';
    let readyAt = 0;
    const finish = () => {
      if (!listening) return;
      listening = null;
      try { child.kill(); } catch { /* already gone */ }
      clearTimeout(timer);
      const clean = text.replace(/\s+/g, ' ').trim();
      done({ text: clean || null, ms: Date.now() - wokeAt, warmMs: readyAt ? readyAt - wokeAt : null });
    };
    const timer = setTimeout(finish, UTTERANCE_MS + 4000);
    const read = (buffer) => {
      const s = buffer.toString();
      if (!readyAt && /start speaking|transcription \d+|\[Start speaking\]/i.test(s)) readyAt = Date.now();
      // Everything that is not a banner line is transcript.
      for (const line of s.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        if (/^(ggml_|load_backend|init:|whisper_|main:|system_info|\[Start speaking\]|### )/i.test(t)) continue;
        if (/^\[.*\]$/.test(t)) continue;
        text += ' ' + t;
        // A VAD-bounded utterance arrives as one block; stop as soon as there is one.
        if (text.trim().length > 1) setTimeout(finish, 400);
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('error', (err) => { log('whisper FAILED to start:', err.message); finish(); });
  });

const wake = spawn('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wakeScript], { windowsHide: true });
let buffer = '';
let busy = false;

wake.stdout.on('data', async (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('READY')) { log(stamp(), t, `— say "${word}", wait a beat, then speak a command`); continue; }
    if (t.startsWith('FATAL')) { log(stamp(), t); process.exit(1); }
    if (!t.startsWith('WAKE')) { log(stamp(), 'wake sidecar said:', t); continue; }

    const confidence = Number(t.split(' ')[1]);
    wakes++;
    if (confidence < minConfidence) { log(stamp(), `wake ignored, confidence ${confidence.toFixed(2)} < ${minConfidence}`); continue; }
    if (busy) { log(stamp(), 'wake while already listening — ignored'); continue; }
    busy = true;
    const wokeAt = Date.now();
    log(stamp(), `WAKE confidence ${confidence.toFixed(2)} — whisper starting`);
    const out = await transcribeOnce(wokeAt);
    busy = false;
    if (out.text) {
      utterances++;
      results.push(out);
      log(stamp(), `heard after ${out.ms} ms (whisper ready at ${out.warmMs ?? '?'} ms): "${out.text}"`);
    } else {
      log(stamp(), `nothing heard (${out.ms} ms). Speak after the wake word, not over it.`);
    }
  }
});
wake.stderr.on('data', (chunk) => log('wake stderr:', chunk.toString().trim().slice(0, 300)));
wake.on('error', (err) => { log('wake sidecar FAILED to start:', err.message); process.exit(1); });

const stop = () => {
  try { wake.kill(); } catch { /* already gone */ }
  if (listening) { try { listening.kill(); } catch { /* already gone */ } }
  const warm = results.map((r) => r.warmMs).filter((n) => typeof n === 'number');
  log('----');
  log(`wakes: ${wakes}   utterances transcribed: ${utterances}`);
  if (results.length) {
    const avg = (xs) => Math.round(xs.reduce((a, x) => a + x, 0) / xs.length);
    log(`wake to text: ${results.map((r) => r.ms + 'ms').join(', ')}  (mean ${avg(results.map((r) => r.ms))} ms)`);
    if (warm.length) log(`of which model load: mean ${avg(warm)} ms`);
    for (const r of results) log(`  "${r.text}"`);
  }
  process.exit(0);
};

setTimeout(stop, seconds * 1000);
process.on('SIGINT', stop);
log(`running ${seconds}s. Model: ${model}`);
log(`capture device for whisper: ${capture} (-1 = Windows default, which is also what the wake word uses)`);
