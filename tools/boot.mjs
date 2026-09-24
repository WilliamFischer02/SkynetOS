#!/usr/bin/env node
/**
 * Start a refreshed SkynetOS.
 *
 *   npm run boot                 build, then start
 *   npm run boot -- --no-build   start the last build as it is
 *
 * Builds with electron-vite, then starts `electron .` from the repo root, detached, and exits. If
 * a SkynetOS is already running, the new copy asks it to close and takes over (see
 * src/main/services/instance.ts), so this one command is "restart with the latest code". If the
 * build fails, the last good build in out/ is started instead, and the log says so.
 *
 * This is also what the login script runs (npm run autostart:on), hidden, at Windows sign-in.
 * Every run appends a line to %APPDATA%/SkynetOS/boot.log, because a hidden start has no other
 * place to say what happened.
 */
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const logDir = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'SkynetOS');
mkdirSync(logDir, { recursive: true });
const logFile = join(logDir, 'boot.log');
const log = (line) => {
  const stamped = `${new Date().toISOString()} ${line}`;
  console.log(stamped);
  try { appendFileSync(logFile, `${stamped}\n`); } catch { /* the console still has it */ }
};

let build = 'skipped (--no-build)';
if (!process.argv.includes('--no-build')) {
  const viteBin = join(repo, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js');
  const result = spawnSync(process.execPath, [viteBin, 'build'], { cwd: repo, stdio: 'inherit', windowsHide: true });
  build = result.status === 0
    ? 'ok'
    : `FAILED (${result.error ? result.error.message : `exit ${result.status}`}) — starting the last good build`;
}

if (!existsSync(join(repo, 'out', 'main', 'index.js'))) {
  log(`build ${build}; there is no build in out/ to start — run npm run build:app and read its errors`);
  process.exit(1);
}

// A clean environment: never the dev server's URL (that belongs to `npm run dev`) and never the
// smoke harness's switches, which would make this copy screenshot itself and quit.
const env = { ...process.env };
for (const key of ['ELECTRON_RENDERER_URL', 'SKYNET_SMOKE_DIR', 'SKYNET_SMOKE_SHOTS_ONLY', 'ELECTRON_RUN_AS_NODE']) delete env[key];

const child = spawn(electron, ['.'], { cwd: repo, env, detached: true, stdio: 'ignore', windowsHide: false });
child.on('error', (err) => log(`build ${build}; SkynetOS DID NOT START — ${err.message}`));
child.unref();
log(`build ${build}; started SkynetOS, pid ${child.pid ?? '?'}. A copy already running hands over to it.`);
