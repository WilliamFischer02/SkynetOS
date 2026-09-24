/*
 * tools/gesture-model-probe.mjs — does the pre-trained gesture model load and RUN inside Electron?
 *
 * The vision page now prefers MediaPipe's GestureRecognizer (landmarks, world landmarks and Google's
 * pre-trained gesture scores in one inference) and falls back to the plain HandLandmarker if it will
 * not load. That fallback means a broken model would fail SILENTLY — gestures would still work, on
 * geometry alone, and nobody would know the pre-trained half had never run. So this answers the
 * question directly, before William ever turns the cameras on:
 *
 *   - the bundle imports from the page's own origin;
 *   - the wasm fileset and gesture_recognizer.task load over skynet://;
 *   - the recognizer is created on the requested delegate;
 *   - recognizeForVideo runs, returns the fields the controller reads, and how long a frame takes.
 *
 * It opens NO camera. The frame is a blank canvas: the question is whether the model runs, not what
 * it sees, and a probe that needed a hand in front of a lens could not be run without asking him.
 *
 *   npx electron tools/gesture-model-probe.mjs [--cpu]
 *
 * Logged synchronously to .vision-probe/gesture-model-probe.log as well as stdout (Electron's stdout
 * through a pipe is block-buffered, so a hang would take its log with it), with a watchdog, and with
 * the work inside an unawaited main() — a top-level await deadlocks app.whenReady().
 */

import { app, BrowserWindow, net, protocol } from 'electron';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = resolve(import.meta.dirname, '..');
const MP = join(REPO, 'node_modules', '@mediapipe', 'tasks-vision');
const MODEL = join(homedir(), 'AppData', 'Local', 'SkynetOS', 'vision', 'gesture_recognizer.task');
const OUT = join(REPO, '.vision-probe');
const DELEGATE = process.argv.includes('--cpu') ? 'CPU' : 'GPU';

mkdirSync(OUT, { recursive: true });
const LOG = join(OUT, 'gesture-model-probe.log');
writeFileSync(LOG, `[model] started ${new Date().toISOString()} delegate ${DELEGATE}\n`);
const say = (line) => {
  console.log(`[model] ${line}`);
  try {
    appendFileSync(LOG, `[model] ${line}\n`);
  } catch {
    /* the console line is still worth having */
  }
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'skynet', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

/** The vision page's own policy, so this tests the page that ships rather than a friendlier one. */
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "connect-src 'self'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');

const PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>gesture model probe</title>
</head>
<body>
<script type="module" src="./gesture-probe.mjs"></script>
</body>
</html>
`;

const PROBE_JS = `
  window.__probe = { done: false, ok: false, error: null, steps: [], result: null };
  const step = (name, detail) => {
    const line = detail ? name + ': ' + detail : name;
    window.__probe.steps.push(line);
    console.log('[model] ' + line);
  };
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  try {
    step('importing the bundle from the page origin');
    const { FilesetResolver, GestureRecognizer } = await import('./vision_bundle.mjs');

    step('loading the wasm fileset over skynet://');
    const files = await FilesetResolver.forVisionTasks('skynet://vision/wasm');

    step('creating the recognizer', '${DELEGATE}');
    const started = performance.now();
    const recognizer = await GestureRecognizer.createFromOptions(files, {
      baseOptions: { modelAssetPath: 'skynet://vision/gesture-model', delegate: '${DELEGATE}' },
      runningMode: 'VIDEO',
      numHands: 2,
      cannedGesturesClassifierOptions: { maxResults: 8, scoreThreshold: 0 }
    });
    step('created', Math.round(performance.now() - started) + ' ms');

    // A blank frame. No camera is opened.
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext('2d');
    context.fillStyle = '#404040';
    context.fillRect(0, 0, 1280, 720);

    const times = [];
    let result = null;
    for (let i = 0; i < 12; i++) {
      const at = performance.now();
      result = recognizer.recognizeForVideo(canvas, 1000 + i * 33);
      times.push(performance.now() - at);
    }
    const fields = Object.keys(result).sort().join(',');
    // The first frames include GPU warm-up; the median of the rest is the steady cost.
    const steady = median(times.slice(2));
    step('ran 12 frames', 'steady ' + steady.toFixed(1) + ' ms/frame; fields ' + fields + '; hands ' + result.landmarks.length);
    window.__probe.result = { fields, hands: result.landmarks.length, steadyMs: steady };
    recognizer.close();

    const needed = ['gestures', 'handedness', 'landmarks', 'worldLandmarks'];
    window.__probe.ok = needed.every((field) => field in result) && result.landmarks.length === 0;
    if (!window.__probe.ok) window.__probe.error = 'unexpected result shape: ' + fields;
  } catch (err) {
    window.__probe.error = (err && err.message) || String(err);
  } finally {
    window.__probe.done = true;
  }
`;

const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.task': 'application/octet-stream' };

const main = async () => {
  const watchdog = setTimeout(() => {
    say('FAIL  the probe itself hung — no verdict');
    app.exit(2);
  }, 90_000);

  if (!existsSync(MODEL)) {
    say(`FAIL  no model at ${MODEL}`);
    app.exit(1);
    return;
  }
  writeFileSync(join(OUT, 'gesture-probe.html'), PAGE);
  writeFileSync(join(OUT, 'gesture-probe.mjs'), PROBE_JS);
  copyFileSync(join(MP, 'vision_bundle.mjs'), join(OUT, 'vision_bundle.mjs'));

  await app.whenReady();

  protocol.handle('skynet', (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'vision') return new Response('no', { status: 404 });
    let file = null;
    if (url.pathname === '/' || url.pathname === '/index.html') file = join(OUT, 'gesture-probe.html');
    else if (url.pathname === '/gesture-probe.mjs') file = join(OUT, 'gesture-probe.mjs');
    else if (url.pathname === '/vision_bundle.mjs') file = join(MP, 'vision_bundle.mjs');
    else if (url.pathname === '/gesture-model') file = MODEL;
    else if (url.pathname.startsWith('/wasm/')) {
      const name = url.pathname.slice('/wasm/'.length);
      if (/^[a-z0-9_.-]+$/i.test(name)) file = join(MP, 'wasm', name);
    }
    if (!file || !existsSync(file)) {
      say(`404 ${request.url}`);
      return new Response('no', { status: 404 });
    }
    const ext = file.slice(file.lastIndexOf('.'));
    return net
      .fetch(pathToFileURL(file).toString(), { bypassCustomProtocolHandlers: true })
      .then((res) => new Response(res.body, { headers: { 'content-type': TYPES[ext] ?? 'application/octet-stream' } }));
  });

  const win = new BrowserWindow({
    width: 480,
    height: 320,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.on('console-message', (_event, _level, message) => {
    if (message.startsWith('[model]')) say(message.slice('[model] '.length));
    else say(`page: ${message.slice(0, 300)}`);
  });

  await win.loadURL('skynet://vision/index.html');

  let report = null;
  for (let i = 0; i < 300 && !report; i++) {
    await new Promise((done) => setTimeout(done, 200));
    const state = await win.webContents.executeJavaScript('window.__probe').catch(() => null);
    if (state?.done) report = state;
  }

  clearTimeout(watchdog);
  if (!report) say('FAIL  the page never finished');
  else if (report.ok) say(`OK  the pre-trained gesture model loads and runs in-app on ${DELEGATE}: ${report.result.steadyMs.toFixed(1)} ms a frame`);
  else say(`FAIL  ${report.error}`);
  win.destroy();
  app.exit(report?.ok ? 0 : 1);
};

process.on('uncaughtException', (err) => {
  say(`CRASHED ${err.stack ?? err.message}`);
  app.exit(2);
});

void main();
