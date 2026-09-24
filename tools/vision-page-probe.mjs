/*
 * tools/vision-page-probe.mjs — why is manual control stuck at "starting"?
 *
 * "Starting" is published by main the moment the vision window is created, and replaced the moment
 * the page calls `vision:report`. Stuck there means no report ever arrived: the page died before
 * its first one, or it cannot reach main at all.
 *
 * The app's own output is unreadable — `tools/boot.mjs` starts it with `stdio: 'ignore'`, because a
 * sign-in start has no console to write to — so this reproduces the app's exact path instead:
 *
 *   - the BUILT page from out/renderer/vision.html,
 *   - over the real `skynet://vision` scheme with the app's route table,
 *   - with the real built preload,
 *   - and the two channels it needs, registered here so a call resolves rather than rejecting.
 *
 * Then it prints everything: every console message, every load failure, every 404, and every
 * report or batch of events the page manages to send.
 *
 * Usage: npx electron tools/vision-page-probe.mjs [--show] [--seconds 25] [--delegate GPU|CPU]
 */

import { app, BrowserWindow, ipcMain, net, protocol, session } from 'electron';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = resolve(import.meta.dirname, '..');
const OUT = join(REPO, 'out', 'renderer');
const PRELOAD = join(REPO, 'out', 'preload', 'index.cjs');
const MP = join(REPO, 'node_modules', '@mediapipe', 'tasks-vision');
const MODEL = join(homedir(), 'AppData', 'Local', 'SkynetOS', 'vision', 'hand_landmarker.task');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
};
/*
 * Everything is written to a FILE as well as stdout, and written synchronously.
 *
 * The first run of this probe printed nothing at all: Electron's stdout through a pipe is block
 * buffered, so a process that hangs — which is exactly the case being investigated — takes its
 * whole log with it. A log that only survives a clean exit is no use for diagnosing a hang.
 */
const LOG = join(REPO, '.vision-probe', 'page-probe.log');
mkdirSync(join(REPO, '.vision-probe'), { recursive: true });
writeFileSync(LOG, `[pageprobe] started ${new Date().toISOString()}\n`);
const say = (line) => {
  const text = `[pageprobe] ${line}`;
  console.log(text);
  try { appendFileSync(LOG, `${text}\n`); } catch { /* stdout still has it */ }
};

const seconds = Number(arg('seconds', '25'));
const delegate = String(arg('delegate', 'GPU')).toUpperCase() === 'CPU' ? 'CPU' : 'GPU';
const show = process.argv.includes('--show');

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png',
  '.woff2': 'font/woff2', '.task': 'application/octet-stream'
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'skynet', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

const serve = async (file, type) => {
  if (!file || !existsSync(file)) {
    say(`404 ${file}`);
    return new Response('not found', { status: 404 });
  }
  const res = await net.fetch(pathToFileURL(file).toString(), { bypassCustomProtocolHandlers: true });
  return new Response(res.body, { headers: { 'content-type': type ?? TYPES[extname(file)] ?? 'application/octet-stream' } });
};

const main = async () => {
  for (const [what, path] of [['built page', join(OUT, 'vision.html')], ['preload', PRELOAD], ['model', MODEL]]) {
    say(`${what}: ${existsSync(path) ? 'present' : 'MISSING'} — ${path}`);
  }

  await app.whenReady();

  /*
   * On the PARTITION's session, not the default one.
   *
   * This is the bug the probe found: `protocol.handle` from the top-level module registers on
   * `session.defaultSession` only, and the vision window runs in its own partition. The request
   * therefore reached no handler at all, `loadURL` never resolved, the page never ran, and manual
   * control sat at "starting" for ever with nothing in any log to say why.
   */
  session.fromPartition('vision-probe').protocol.handle('skynet', async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'vision') return new Response('no', { status: 404 });
    const path = url.pathname === '/' || url.pathname === '' ? '/vision.html' : url.pathname;
    say(`GET ${path}`);
    if (path === '/model') return serve(MODEL, 'application/octet-stream');
    if (path === '/vision_bundle.mjs') return serve(join(MP, 'vision_bundle.mjs'), 'text/javascript');
    if (path.startsWith('/wasm/')) {
      const name = path.slice('/wasm/'.length);
      if (!/^[a-z0-9_.-]+$/i.test(name)) return new Response('no', { status: 404 });
      return serve(join(MP, 'wasm', name));
    }
    const file = resolve(OUT, `.${path}`);
    if (!file.startsWith(OUT)) return new Response('no', { status: 403 });
    return serve(file);
  });

  // The two channels the page is allowed to call, so a report resolves instead of rejecting.
  ipcMain.handle('vision:report', (_event, report) => {
    say(`REPORT ${JSON.stringify(report)}`);
    return { ok: true };
  });
  ipcMain.handle('vision:events', (_event, events) => {
    const kinds = (events ?? []).map((e) => e.type).join(',');
    if (kinds) say(`EVENTS ${kinds}`);
    return { ok: true };
  });

  const ses = session.fromPartition('vision-probe');
  ses.setPermissionRequestHandler((_wc, permission, done) => done(permission === 'media'));
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'media');

  const win = new BrowserWindow({
    width: 640,
    height: 420,
    show,
    backgroundColor: '#0E1A14',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      partition: 'vision-probe'
    }
  });
  win.webContents.setBackgroundThrottling(false);

  // EVERY console message, not just warnings: the interesting one is usually an uncaught error.
  win.webContents.on('console-message', (_event, level, message, line, source) => {
    say(`page(${level}) ${message.slice(0, 400)}${source ? `  @${source.split('/').pop()}:${line}` : ''}`);
  });
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    say(`did-fail-load ${code} ${description} ${url}`);
  });
  win.webContents.on('preload-error', (_event, path, error) => {
    say(`PRELOAD ERROR ${path}: ${error.message}`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    say(`render process gone: ${details.reason}`);
  });

  const query = new URLSearchParams({ hands: '2', delegate, cameras: 'c920,c922' });
  say(`loading skynet://vision/vision.html?${query}`);
  await win.loadURL(`skynet://vision/vision.html?${query.toString()}`);

  // Is the bridge even there? This is the difference between "the page died" and "it cannot call".
  const bridge = await win.webContents.executeJavaScript(
    "({ skynet: typeof window.skynet, report: typeof window.skynet?.['vision:report'], keys: window.skynet ? Object.keys(window.skynet).length : 0 })"
  ).catch((err) => ({ error: err.message }));
  say(`bridge: ${JSON.stringify(bridge)}`);

  setTimeout(() => {
    say('done');
    app.quit();
  }, seconds * 1000);
};

process.on('uncaughtException', (err) => { say(`CRASHED ${err.stack ?? err.message}`); app.exit(1); });

void main();
