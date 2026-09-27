import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { desktopScript, parseDesktopLine } from '../packages/shared/desktop.js';

/**
 * `npm run desktop:probe`: does the desktop helper compile and answer on this machine?
 *
 * READ-ONLY by construction: it sends `ping`, `windows` and one `lnk` (a Start Menu shortcut's
 * target), prints what came back, and closes stdin. It never launches, moves, clicks or types;
 * the first real plan is run from the hologram window with William watching (docs/11).
 */
function main(): void {
  const encoded = Buffer.from(desktopScript(), 'utf16le').toString('base64');
  const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const started = Date.now();
  let buffer = '';
  let sent = 0;
  const startMenu = process.env['APPDATA'] ? join(process.env['APPDATA'], 'Microsoft', 'Windows', 'Start Menu', 'Programs') : '';
  const lnk = startMenu && existsSync(startMenu) ? readdirSync(startMenu).find((f) => f.toLowerCase().endsWith('.lnk')) : undefined;
  const send = (obj: Record<string, unknown>): void => { sent++; proc.stdin.write(`${JSON.stringify({ id: sent, ...obj })}\n`); };
  const finish = (): void => { proc.stdin.end(); setTimeout(() => proc.kill(), 500); };
  proc.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let nl = buffer.indexOf('\n');
    while (nl !== -1) {
      const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1); nl = buffer.indexOf('\n');
      const parsed = parseDesktopLine(line);
      if (!parsed) { if (line.trim()) console.log(`  (helper) ${line.trim().slice(0, 160)}`); continue; }
      if (parsed['ready'] === true) {
        console.log(`READY in ${Date.now() - started} ms`);
        send({ op: 'ping' });
        continue;
      }
      if (parsed['pong'] === true) { console.log('PING ok'); send({ op: 'windows' }); continue; }
      if (Array.isArray(parsed['windows'])) {
        const wins = parsed['windows'] as { title: string; process: string; w: number; h2: number; fg: boolean }[];
        console.log(`WINDOWS ${wins.length} visible top-level; in front: ${wins.find((w) => w.fg)?.process ?? '?'}`);
        for (const w of wins.slice(0, 6)) console.log(`  ${(w.process || '?').padEnd(16)} ${w.w}x${w.h2}  ${w.title.slice(0, 60)}`);
        if (lnk) send({ op: 'lnk', path: join(startMenu, lnk) }); else finish();
        continue;
      }
      if (typeof parsed['target'] === 'string') { console.log(`LNK ${lnk} → ${parsed['target']}`); finish(); continue; }
      if (parsed['ok'] === false) { console.log(`FAULT ${String(parsed['error'])}`); finish(); }
    }
  });
  proc.stderr.on('data', (chunk: Buffer) => console.log(`  (stderr) ${chunk.toString('utf8').trim().slice(0, 200)}`));
  proc.on('exit', (code) => { console.log(`helper exited (${code ?? '?'}) after ${Date.now() - started} ms`); });
  setTimeout(() => { console.log('TIMEOUT — no READY in 30 s'); proc.kill(); }, 30_000).unref();
}

main();
