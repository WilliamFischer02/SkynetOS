/*
 * tools/vision-protocol-probe.mjs — can MediaPipe load INSIDE the app?
 *
 * The gesture gate (tools/gesture-gate.mjs) proved the landmarker works, but it cheated: it served
 * everything over http://127.0.0.1, which the app itself will never do. In production the renderer
 * is a `file://` page under a strict CSP, and docs/07 forbids pulling code in from off-machine.
 *
 * MediaPipe needs three things that a plain file:// page refuses:
 *   1. to fetch its .wasm binary (fetch is refused on the file: scheme),
 *   2. to inject a <script> for its wasm glue (createElement("script") with a URL),
 *   3. to instantiate WebAssembly, which a strict `script-src` blocks without 'wasm-unsafe-eval'.
 *
 * So this probes the intended production arrangement, with nothing else in the way: a privileged
 * `skynet://` scheme serving the wasm and the model from disk, a file:// page, and the exact CSP
 * the vision page will ship with. It creates NO camera stream — the question here is CSP and
 * protocol, not capture, and a probe that needs a hand in front of it proves less.
 *
 * Usage: npx electron tools/vision-protocol-probe.mjs [--worker-src]
 *   --worker-src  also allow `worker-src blob:`, to find out whether MediaPipe needs it.
 */

import { app, BrowserWindow, net, protocol } from 'electron';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = resolve(import.meta.dirname, '..');
const MP = join(REPO, 'node_modules', '@mediapipe', 'tasks-vision');
const MODEL = join(homedir(), 'AppData', 'Local', 'SkynetOS', 'vision', 'hand_landmarker.task');
const OUT = join(REPO, '.vision-probe');
const allowWorker = process.argv.includes('--worker-src');

/*
 * Registered before app ready, which is the only time it may be done. `standard` and `secure` make
 * it a proper origin so fetch and module loading behave; `supportFetchAPI` is what lets MediaPipe
 * fetch the .wasm at all. No `bypassCSP`: the CSP below still governs the page, deliberately.
 */
protocol.registerSchemesAsPrivileged([
  { scheme: 'skynet', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

/*
 * The page itself is served from skynet://vision, so the wasm, the model and the bundle are all
 * SAME ORIGIN and 'self' covers them. The first attempt kept the page on file:// and allowed
 * `skynet:` in script-src; Chromium refused it at the CORS layer, before CSP got a say:
 * "Cross origin requests are only supported for protocol schemes: chrome, ..., http, https".
 * A privileged custom scheme cannot rescue a file:// origin, so the origin has to move.
 *
 * 'wasm-unsafe-eval' is the one real concession, and it is unavoidable: MediaPipe compiles a wasm
 * module at runtime. It permits WebAssembly instantiation and nothing else — not eval, not inline
 * script, not remote script. `frame-ancestors` is omitted because it is ignored in a meta CSP.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "connect-src 'self'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  ...(allowWorker ? ['worker-src blob:'] : []),
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');

const PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>vision protocol probe</title>
</head>
<body style="background:#0E1A14;color:#E9E4D6;font:13px monospace;padding:12px">
<pre id="log">starting…</pre>
<!-- An external module, not inline: the built renderer's script is a file too, and a strict CSP
     refuses inline script. Testing with inline script would test a page we will never ship. -->
<script type="module" src="./probe.mjs"></script>
</body>
</html>
`;

const PROBE_JS = `
  const log = (line) => {
    document.getElementById('log').textContent += '\\n' + line;
    console.log('[probe] ' + line);
  };
  window.__probe = { done: false, ok: false, error: null, steps: [] };
  const step = (name, detail) => { window.__probe.steps.push(name + (detail ? ': ' + detail : '')); log(name + (detail ? ': ' + detail : '')); };

  try {
    step('importing the bundle from the page origin');
    const { FilesetResolver, HandLandmarker } = await import('./vision_bundle.mjs');

    step('fetching the wasm fileset over skynet://');
    const files = await FilesetResolver.forVisionTasks('skynet://vision/wasm');

    step('creating the landmarker with the model over skynet://');
    const landmarker = await HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: 'skynet://vision/model', delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 1
    });

    step('landmarker created', typeof landmarker.detectForVideo === 'function' ? 'detectForVideo present' : 'NO detect method');
    landmarker.close();
    window.__probe.ok = true;
  } catch (err) {
    window.__probe.error = (err && err.message) || String(err);
    log('FAILED: ' + window.__probe.error);
  } finally {
    window.__probe.done = true;
  }
`;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.task': 'application/octet-stream' };

const main = async () => {
  if (!existsSync(MODEL)) { console.log(`[probe] no model at ${MODEL}`); app.exit(1); return; }
  mkdirSync(OUT, { recursive: true });
  // The bundle sits beside the page so it loads as 'self', exactly as the built renderer will.
  copyFileSync(join(MP, 'vision_bundle.mjs'), join(OUT, 'vision_bundle.mjs'));
  writeFileSync(join(OUT, 'probe.html'), PAGE);
  writeFileSync(join(OUT, 'probe.mjs'), PROBE_JS);

  await app.whenReady();

  protocol.handle('skynet', (request) => {
    const url = new URL(request.url);
    // One host, and an explicit route table. Nothing is resolved from the URL against a directory.
    if (url.hostname !== 'vision') return new Response('no', { status: 404 });
    let file = null;
    if (url.pathname === '/' || url.pathname === '/index.html') file = join(OUT, 'probe.html');
    else if (url.pathname === '/probe.mjs') file = join(OUT, 'probe.mjs');
    else if (url.pathname === '/vision_bundle.mjs') file = join(MP, 'vision_bundle.mjs');
    else if (url.pathname === '/model') file = MODEL;
    else if (url.pathname.startsWith('/wasm/')) {
      const name = url.pathname.slice('/wasm/'.length);
      if (/^[a-z0-9_.-]+$/i.test(name)) file = join(MP, 'wasm', name);
    }
    if (!file || !existsSync(file)) {
      console.log(`[probe] 404 ${request.url}`);
      return new Response('no', { status: 404 });
    }
    console.log(`[probe] serving ${url.pathname}`);
    const ext = file.slice(file.lastIndexOf('.'));
    return net.fetch(pathToFileURL(file).toString(), { bypassCustomProtocolHandlers: true })
      .then((res) => new Response(res.body, { headers: { 'content-type': TYPES[ext] ?? 'application/octet-stream' } }));
  });

  const win = new BrowserWindow({
    width: 720,
    height: 420,
    show: true,
    title: 'SkynetOS — vision protocol probe',
    backgroundColor: '#0E1A14',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.on('console-message', (_e, level, message) => {
    if (!message.startsWith('[probe]')) console.log(`[probe] page(${level}): ${message.slice(0, 400)}`);
  });

  console.log(`[probe] CSP: ${CSP}`);
  await win.loadURL('skynet://vision/index.html');

  let report = null;
  for (let i = 0; i < 100 && !report; i++) {
    await new Promise((done) => setTimeout(done, 200));
    const state = await win.webContents.executeJavaScript('window.__probe').catch(() => null);
    if (state?.done) report = state;
  }

  if (!report) console.log('[probe] TIMED OUT — the page never finished');
  else {
    console.log(`[probe] steps: ${JSON.stringify(report.steps, null, 2)}`);
    console.log(report.ok ? '[probe] RESULT: MediaPipe loads in-app over skynet:// under this CSP' : `[probe] RESULT: FAILED — ${report.error}`);
  }
  app.quit();
};

process.on('uncaughtException', (err) => { console.log(`[probe] CRASHED ${err.stack ?? err.message}`); app.exit(1); });

void main();
