#!/usr/bin/env node
/**
 * Install the synthesis server's Python environment for voice profiles (docs/11 § Voice profiles,
 * roadmap M13.2). Idempotent: run it again and it repairs what is missing.
 *
 *   npm run speech:install            everything: venv, torch (CUDA 12.8), F5-TTS, a smoke import
 *   npm run speech:install -- --check only report what is there
 *
 * Where: %LOCALAPPDATA%/SkynetOS/voice/tts/venv, beside whisper's own folders. Outside the repo,
 * per machine, never committed. Python 3.10 (`py -3.10`) because the TTS packages are tested on it;
 * torch from the cu128 index because an RTX 50-series (Blackwell, sm_120) needs CUDA 12.8 wheels.
 * The model weights (about 1.3 GB) are fetched by F5-TTS itself on the first synthesis, into the
 * Hugging Face cache, not by this script.
 *
 * Downloads happen only when William runs this. Nothing in SkynetOS calls it.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const LOCAL = process.env['LOCALAPPDATA'] ?? '';
const ROOT = join(LOCAL, 'SkynetOS', 'voice', 'tts');
const VENV = join(ROOT, 'venv');
const PY = join(VENV, 'Scripts', 'python.exe');
const TORCH_INDEX = 'https://download.pytorch.org/whl/cu128';
const checkOnly = process.argv.includes('--check');

function run(cmd, args, label) {
  console.log(`\n> ${label}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', windowsHide: true });
  if (res.status !== 0) {
    console.log(`\nFAILED: ${label} (exit ${res.status ?? 'signal'})`);
    process.exit(1);
  }
}

function probe(args) {
  const res = spawnSync(PY, args, { encoding: 'utf8', windowsHide: true });
  return { ok: res.status === 0, out: (res.stdout || '').trim(), err: (res.stderr || '').trim() };
}

function report() {
  if (!existsSync(PY)) { console.log(`venv: MISSING (${VENV})`); return false; }
  const torch = probe(['-c', 'import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else "no cuda")']);
  console.log(`venv: ${VENV}`);
  console.log(`torch: ${torch.ok ? torch.out : 'MISSING'}`);
  const f5 = probe(['-c', 'import f5_tts, importlib.metadata as m; print(m.version("f5-tts"))']);
  console.log(`f5-tts: ${f5.ok ? f5.out : 'MISSING'}`);
  return torch.ok && f5.ok;
}

if (!LOCAL) { console.log('LOCALAPPDATA is not set; nowhere to install.'); process.exit(1); }
console.log(`Synthesis server environment at ${ROOT}`);
if (checkOnly) { process.exit(report() ? 0 : 1); }

mkdirSync(ROOT, { recursive: true });
if (!existsSync(PY)) {
  const launcher = spawnSync('py', ['-3.10', '-c', 'import sys; print(sys.version)'], { encoding: 'utf8', windowsHide: true });
  if (launcher.status !== 0) {
    console.log('Python 3.10 is not installed (py -3.10). Install it from python.org, then run this again.');
    process.exit(1);
  }
  console.log(`Python 3.10: ${launcher.stdout.trim()}`);
  run('py', ['-3.10', '-m', 'venv', VENV], 'create the venv');
}
run(PY, ['-m', 'pip', 'install', '--upgrade', 'pip', 'wheel'], 'upgrade pip');
run(PY, ['-m', 'pip', 'install', '--index-url', TORCH_INDEX, 'torch', 'torchaudio'], 'torch + torchaudio (CUDA 12.8 wheels, about 3 GB)');
run(PY, ['-m', 'pip', 'install', 'f5-tts'], 'F5-TTS');
const ok = report();
console.log(ok
  ? '\nReady. `npm run speech:serve` starts the server; the first synthesis downloads the model weights (about 1.3 GB).'
  : '\nSomething is still missing; read the lines above.');
process.exit(ok ? 0 : 1);
