/**
 * JARVIS's voice, out loud, once.
 *
 * Starts the speech sidecar exactly as services/speech.ts does, outside Electron, prints the voices
 * Windows has and the one `chooseVoice` picks, says one line and reports the timings. It opens no
 * microphone. Whether it was audible is for the person in the room to say.
 *
 *   npm run speech:probe
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chooseVoice, DEFAULT_SPEECH, parseSpeechLine, speechScript } from '@shared/speech.js';

const LINE = 'Speech is available, sir. Microsoft David, until a British voice is installed.';
const OUT = join(tmpdir(), 'skynetos-speech-probe');

function main(): void {
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, 'speech.ps1');
  writeFileSync(file, speechScript(), 'utf8');
  const started = Date.now();
  let voices: string[] = [];
  let chosen: string | null = null;
  let words = 0;
  let spokeAt = 0;

  const launch = (shell: string): void => {
    const child = spawn(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const raw of lines) {
        const line = parseSpeechLine(raw);
        switch (line.type) {
          case 'voices':
            voices = line.voices;
            console.log(`installed voices (${voices.length}): ${voices.join(' | ')}`);
            break;
          case 'ready': {
            console.log(`sidecar ready in ${Date.now() - started} ms, default voice ${line.voice}`);
            chosen = chooseVoice(voices, DEFAULT_SPEECH.voice);
            const british = voices.some((v) => /george|ryan|hazel|susan|united kingdom|en-gb/i.test(v));
            console.log(`chosen: ${chosen}${british ? '' : ' (no British voice installed: Settings > Time & Language > Speech > Add voices > English (United Kingdom))'}`);
            spokeAt = Date.now();
            child.stdin.write(JSON.stringify({ say: LINE, voice: chosen ?? '', rate: DEFAULT_SPEECH.rate, volume: DEFAULT_SPEECH.volume }) + '\n');
            break;
          }
          case 'voice':
            console.log(`speaking with ${line.voice}`);
            break;
          case 'start':
            console.log(`started after ${Date.now() - spokeAt} ms (${line.chars} chars)`);
            break;
          case 'word':
            words++;
            break;
          case 'done':
            console.log(`done: ${words} word events in ${Date.now() - spokeAt} ms`);
            child.stdin.end();
            break;
          case 'fatal':
            console.log(`FATAL ${line.message}`);
            child.stdin.end();
            process.exitCode = 1;
            break;
          default:
            console.log(`[sidecar] ${raw}`);
        }
      }
    });
    child.stderr.on('data', (chunk: Buffer) => console.log(`[stderr] ${chunk.toString().trim().slice(0, 300)}`));
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT' && shell === 'powershell.exe') { launch('pwsh'); return; }
      console.log(`could not start ${shell}: ${err.message}`);
      process.exitCode = 1;
    });
    child.on('exit', (code) => console.log(`sidecar exited ${code} after ${Date.now() - started} ms`));
  };
  launch('powershell.exe');
  setTimeout(() => { console.log('gave up after 40 s'); process.exit(1); }, 40_000).unref();
}

main();
