import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { decodeAudio } from '@shared/aiff.js';
import {
  IMPORT_MAX_MS,
  IMPORT_MIN_MS,
  newProfile,
  nextImportId,
  normaliseProfile,
  parseTranscripts,
  profileFolder,
  profileSummary,
  profilesRoot,
  safeProfileName,
  trimSilence,
  type ProfileLine,
  type VoiceProfile
} from '@shared/speech.js';
import { DEFAULT_VOICE, transcriptOf } from '@shared/voice.js';
import { downsample, encodeWav, TARGET_RATE } from '@shared/voice-capture.js';

/**
 * Bring William's own voice clips into a voice profile (docs/11-JARVIS-VOICE.md § Voice profiles).
 *
 *   npm run profile:import -- <profile> [folder] [--transcribe]
 *
 * Every `.aif`, `.aiff` or `.wav` in the folder (default `<profile>/import/`) that the profile does
 * not already list is decoded here (packages/shared/aiff.ts; no ffmpeg, no dependency), mixed to
 * mono, resampled to 16 kHz, trimmed of leading and trailing silence, and written into the profile
 * folder as `line-import-NN.wav` with a `ProfileLine` of source `imported`. The original is read
 * and never modified, moved or deleted. Nothing is uploaded: the only network call is
 * `--transcribe`, to whisper-server on 127.0.0.1, which is started here only when that flag is
 * given (it takes the GPU and up to two minutes to load).
 *
 * Transcripts: `transcripts.txt` in the folder (`<file name>\t<text>` per line) wins; then
 * whisper, when asked; otherwise the line's text is left empty and the TRAIN panel says
 * NEEDS A TRANSCRIPT, where William types it.
 */

const LOCAL = process.env['LOCALAPPDATA'];
const SERVER = process.env['SKYNET_VOICE_SERVER'] ?? (LOCAL ? join(LOCAL, 'SkynetOS', 'voice', 'cuda', 'Release', 'whisper-server.exe') : '');
const MODEL = process.env['SKYNET_VOICE_MODEL'] ?? (LOCAL ? join(LOCAL, 'SkynetOS', 'voice', 'models', 'ggml-large-v3-turbo-q5_0.bin') : '');
const ACCEPTED = new Set(['.aif', '.aiff', '.wav']);

interface Args { profile: string; folder: string | null; transcribe: boolean }

function parseArgs(argv: string[]): Args | null {
  const rest = argv.filter((a) => !a.startsWith('--'));
  const transcribe = argv.includes('--transcribe');
  const profile = rest[0];
  if (!profile) return null;
  return { profile, folder: rest[1] ?? null, transcribe };
}

/** settings.json's voice port, read the way tools/voice-probe.ts reads the file: directly, never created. */
function voicePort(): number {
  try {
    const file = join(process.env['APPDATA'] ?? '', 'SkynetOS', 'settings.json');
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { voice?: { port?: number } };
    return typeof parsed.voice?.port === 'number' ? parsed.voice.port : DEFAULT_VOICE.port;
  } catch {
    return DEFAULT_VOICE.port;
  }
}

async function serverUp(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function startWhisper(port: number): Promise<ChildProcess> {
  for (const [name, path] of [['server', SERVER], ['model', MODEL]] as const) {
    if (!path || !existsSync(path)) throw new Error(`NO WHISPER ${name.toUpperCase()} AT ${path || '(LOCALAPPDATA unset)'} — RUN WITHOUT --transcribe AND TYPE THE TRANSCRIPTS`);
  }
  const server = spawn(SERVER, ['-m', MODEL, '--host', '127.0.0.1', '--port', String(port), '-t', '4', '-nt'], { cwd: dirname(SERVER), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout?.resume();
  server.stderr?.resume();
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    if (await serverUp(port)) return server;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  server.kill();
  throw new Error('whisper-server did not come up within 120 s');
}

async function transcribe(port: number, wav: Uint8Array): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'clip.wav');
  form.append('response_format', 'json');
  form.append('temperature', '0');
  const res = await fetch(`http://127.0.0.1:${port}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`whisper-server answered ${res.status}`);
  return transcriptOf(await res.json());
}

function loadOrCreate(folder: string, name: string): VoiceProfile {
  const file = join(folder, 'profile.json');
  if (!existsSync(file)) return newProfile(name, 'http://127.0.0.1:47832');
  let raw: unknown = null;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { raw = null; }
  return normaliseProfile(raw, name, 'http://127.0.0.1:47832');
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.log('usage: npm run profile:import -- <profile> [folder] [--transcribe]');
    console.log('       default folder: %LOCALAPPDATA%\\SkynetOS\\voice-profiles\\<profile>\\import');
    return 1;
  }
  const name = safeProfileName(args.profile);
  if (!name) { console.log('A PROFILE NAME IS LETTERS, DIGITS AND DASHES'); return 1; }
  const root = profilesRoot(LOCAL, join(tmpdir(), 'skynetos-voice-profiles'));
  const folder = profileFolder(root, name);
  const source = args.folder ?? join(folder, 'import');
  if (!existsSync(source)) {
    mkdirSync(source, { recursive: true });
    console.log(`made ${source} — drop .aif / .aiff / .wav clips there (and transcripts.txt, optional), then run this again`);
    return 0;
  }
  mkdirSync(folder, { recursive: true });
  let profile = loadOrCreate(folder, name);
  // A profile the tool made exists from this moment, so the TRAIN panel lists it before any clip lands.
  if (!existsSync(join(folder, 'profile.json'))) writeFileSync(join(folder, 'profile.json'), JSON.stringify(profile, null, 2) + '\n', 'utf8');
  const seen = new Set(profile.lines.map((l) => (l.original ?? '').toLowerCase()).filter(Boolean));
  const files = readdirSync(source).filter((f) => ACCEPTED.has(extname(f).toLowerCase())).sort();
  const fresh = files.filter((f) => !seen.has(f.toLowerCase()));
  console.log(`profile ${name} · ${folder}`);
  console.log(`${files.length} clip(s) in ${source}, ${fresh.length} not yet imported`);

  const transcriptFile = join(source, 'transcripts.txt');
  const transcripts = existsSync(transcriptFile) ? parseTranscripts(readFileSync(transcriptFile, 'utf8')) : new Map<string, string>();
  // A transcript that arrived after its clip was imported still lands: empty lines are filled first.
  let filled = 0;
  profile = {
    ...profile,
    lines: profile.lines.map((l) => {
      if (l.source !== 'imported' || l.text || !l.original) return l;
      const said = transcripts.get(l.original.toLowerCase());
      if (!said) return l;
      filled++;
      console.log(`text    ${l.original.padEnd(36)} "${said}" (from transcripts.txt)`);
      return { ...l, text: said };
    })
  };
  if (filled) writeFileSync(join(folder, 'profile.json'), JSON.stringify({ ...profile, updatedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8');
  if (!fresh.length) { console.log(summary(profile)); return 0; }
  const port = voicePort();
  let whisper: ChildProcess | null = null;
  let whisperPort: number | null = null;
  if (args.transcribe) {
    if (await serverUp(port)) whisperPort = port;
    else {
      const own = port + 71;
      console.log(`starting whisper-server on 127.0.0.1:${own} (up to two minutes) …`);
      whisper = await startWhisper(own);
      whisperPort = own;
    }
  }

  let added = 0;
  let refused = 0;
  try {
    for (const file of fresh) {
      const label = file.padEnd(36);
      let decoded;
      try {
        decoded = decodeAudio(new Uint8Array(readFileSync(join(source, file))));
      } catch (err) {
        console.log(`REFUSED ${label} ${(err as Error).message}`);
        refused++;
        continue;
      }
      if (decoded.sampleRate < TARGET_RATE) {
        console.log(`REFUSED ${label} ${decoded.sampleRate} Hz IS BELOW 16 kHz — RE-EXPORT AT 16 kHz OR HIGHER`);
        refused++;
        continue;
      }
      const mono = trimSilence(downsample(decoded.samples, decoded.sampleRate, TARGET_RATE));
      const ms = Math.round((mono.length / TARGET_RATE) * 1000);
      if (ms < IMPORT_MIN_MS) { console.log(`REFUSED ${label} ${ms} ms AFTER TRIMMING IS SHORTER THAN ${IMPORT_MIN_MS} ms`); refused++; continue; }
      if (ms > IMPORT_MAX_MS) { console.log(`REFUSED ${label} ${(ms / 1000).toFixed(1)} s IS LONGER THAN ${IMPORT_MAX_MS / 1000} s — SPLIT IT INTO SENTENCES`); refused++; continue; }
      const wav = encodeWav(mono, TARGET_RATE);
      const id = nextImportId(profile);
      const out = `line-${id}.wav`;
      writeFileSync(join(folder, out), wav);
      let text = transcripts.get(file.toLowerCase()) ?? '';
      let how = text ? 'transcripts.txt' : 'NO TRANSCRIPT YET';
      if (!text && whisperPort !== null) {
        try {
          text = await transcribe(whisperPort, wav);
          how = text ? 'whisper' : 'whisper heard nothing';
        } catch (err) {
          how = `whisper failed: ${(err as Error).message}`;
        }
      }
      const line: ProfileLine = { id, text, file: out, ms, recordedAt: new Date().toISOString(), source: 'imported', original: file };
      profile = { ...profile, updatedAt: line.recordedAt!, lines: [...profile.lines, line] };
      writeFileSync(join(folder, 'profile.json'), JSON.stringify(profile, null, 2) + '\n', 'utf8');
      added++;
      console.log(`ok      ${label} ${(ms / 1000).toFixed(1).padStart(5)} s  ${String(decoded.sampleRate).padStart(6)} Hz ${decoded.channels}ch → ${out}  ${text ? `"${text}"` : how}${text && how !== 'transcripts.txt' ? `  (${how})` : ''}`);
    }
  } finally {
    whisper?.kill();
  }
  console.log(`\n${added} imported, ${refused} refused. ${summary(profile)}`);
  const missing = profile.lines.filter((l) => l.source === 'imported' && !l.text).length;
  if (missing) console.log(`${missing} imported clip(s) have no transcript: type them in the hologram window's TRAIN panel, or add them to transcripts.txt and run this again.`);
  return 0;
}

function summary(profile: VoiceProfile): string {
  const s = profileSummary(profile);
  return `${s.recorded} of ${s.total} scripted lines recorded, ${s.imported} imported clip(s)${s.trained ? ', fitted' : ''}.`;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => { console.error((err as Error).message); process.exit(1); }
);
