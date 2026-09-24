/**
 * npm run autostart:on | autostart:off | autostart:status
 *
 * Starts SkynetOS with Windows, or stops doing so, for THIS user on THIS machine. It writes the
 * same Run value and login script as the LOOK panel's "Start SkynetOS with Windows" switch
 * (src/main/services/autostart.ts); both take their text from packages/shared/boot.ts.
 *
 * Per machine: the login script holds this machine's absolute paths and lives in
 * %APPDATA%/SkynetOS, never in the repo, because the repo is public.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  autostartCommand,
  bootVbs,
  parseRunValue,
  regAddArgs,
  regDeleteArgs,
  regQueryArgs,
  RUN_KEY,
  RUN_VALUE
} from '../packages/shared/boot.js';

const repo = resolve(process.cwd());
const userData = join(process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'), 'SkynetOS');
const vbsPath = join(userData, 'boot.vbs');
const wscript = join(process.env['SystemRoot'] ?? 'C:/Windows', 'System32', 'wscript.exe');

function reg(args: string[]): { ok: boolean; out: string } {
  try {
    return { ok: true, out: execFileSync('reg.exe', args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` || e.message };
  }
}

function status(): string | null {
  const q = reg(regQueryArgs());
  return q.ok ? parseRunValue(q.out) : null;
}

const action = process.argv[2] ?? 'status';

if (process.platform !== 'win32') {
  console.log('Start with Windows is Windows-only.');
  process.exit(0);
}

if (action === 'on') {
  if (!existsSync(join(repo, 'tools', 'boot.mjs'))) {
    console.error(`Run this from the SkynetOS repo root: no tools/boot.mjs under ${repo}`);
    process.exit(1);
  }
  mkdirSync(userData, { recursive: true });
  // UTF-16LE with a BOM: wscript reads that as Unicode, so a path with any non-ASCII character survives.
  writeFileSync(vbsPath, '\uFEFF' + bootVbs({ node: process.execPath, script: join(repo, 'tools', 'boot.mjs'), repo }), 'utf16le');
  const added = reg(regAddArgs(autostartCommand(wscript, vbsPath)));
  if (!added.ok) {
    console.error(`reg.exe refused: ${added.out.trim()}`);
    process.exit(1);
  }
  console.log(`ON. ${RUN_KEY}\\${RUN_VALUE} = ${status() ?? '(could not read it back)'}`);
  console.log(`Login script: ${vbsPath} (runs ${process.execPath} tools/boot.mjs, hidden)`);
} else if (action === 'off') {
  const removed = reg(regDeleteArgs());
  const left = status();
  if (left !== null) {
    console.error(`Still set: ${left}\n${removed.out.trim()}`);
    process.exit(1);
  }
  console.log(`OFF. No ${RUN_VALUE} value under ${RUN_KEY}.`);
} else {
  const value = status();
  console.log(value ? `ON: ${value}` : 'OFF');
}
