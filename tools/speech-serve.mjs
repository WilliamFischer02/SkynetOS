#!/usr/bin/env node
/**
 * Start the synthesis server from the venv `npm run speech:install` made (docs/11 § Voice profiles).
 * Foreground, Ctrl+C stops it. SkynetOS itself starts it the same way when speech.backend is
 * "server" (services/speech.ts); this script is for trying it by hand.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const LOCAL = process.env['LOCALAPPDATA'] ?? '';
const PY = join(LOCAL, 'SkynetOS', 'voice', 'tts', 'venv', 'Scripts', 'python.exe');
if (!existsSync(PY)) {
  console.log(`No synthesis environment at ${PY}. Run: npm run speech:install`);
  process.exit(1);
}
const child = spawn(PY, [join(process.cwd(), 'tools', 'speech-server.py'), ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });
child.on('exit', (code) => process.exit(code ?? 0));
