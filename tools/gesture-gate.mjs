/*
 * tools/gesture-gate.mjs — the hand-tracking gate.
 *
 * The camera gate (tools/camera-gate.mjs) proved the two webcams can both deliver 30 fps. That is
 * necessary and not sufficient: the question this one answers is whether landmarks can be pulled
 * off BOTH streams at that rate, and whether a fingertip sits still enough for a pinch-drag to feel
 * like holding something rather than like fighting a wasp.
 *
 * Three numbers decide the gesture design, so they are measured rather than assumed:
 *
 *   1. LANDMARK FPS per camera, with both landmarkers running at once. Below about 20 the
 *      interaction stops feeling continuous and pointing has to be replaced by dwell-and-confirm.
 *   2. DETECTION RATE — the share of processed frames in which a hand was found at all. A high fps
 *      with a 40% detection rate is a worse rig than a lower fps with 95%.
 *   3. FINGERTIP JITTER in pixels, with the hand held still. This is the one that sets the grid
 *      snap and the dead zone: docs/02 puts nodes on a 16 px grid, so jitter has to be well under
 *      half a tile at board scale or a held pinch will walk between cells on its own.
 *
 * Why a local HTTP server: MediaPipe fetches its wasm and its model, and fetch() is refused on
 * file:// in Chromium. 127.0.0.1 is also a secure context, which getUserMedia requires. Nothing is
 * exposed beyond the loopback interface and the server dies with the process.
 *
 * Usage:
 *   npx electron tools/gesture-gate.mjs [--seconds 45] [--width 1280] [--height 720]
 *                                       [--hands 1] [--delegate GPU|CPU] [--out .gesture-gate]
 * Writes: <out>/gate.json and one landmarked still per camera. Touches no board data.
 */

import { app, BrowserWindow } from 'electron';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
};

const seconds = Math.max(5, Number(arg('seconds', '45')));
const width = Number(arg('width', '1280'));
const height = Number(arg('height', '720'));
const hands = Number(arg('hands', '1'));
const delegate = String(arg('delegate', 'GPU')).toUpperCase() === 'CPU' ? 'CPU' : 'GPU';
const outDir = resolve(arg('out', '.gesture-gate'));

const REPO = resolve(import.meta.dirname, '..');
const MP = join(REPO, 'node_modules', '@mediapipe', 'tasks-vision');
const MODEL = arg('model', join(homedir(), 'AppData', 'Local', 'SkynetOS', 'vision', 'hand_landmarker.task'));

const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '').slice(0, 40);

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.task': 'application/octet-stream', '.map': 'application/json' };

/*
 * The page. It holds the measurement rather than main, because the landmarkers, the video elements
 * and the canvases all live here anyway, and a 200-line string passed to executeJavaScript is a
 * thing nobody can debug. Main calls window.__gate.run() and gets JSON back.
 *
 * No template literals below: this whole file is itself inside one.
 */
const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>SkynetOS - gesture gate</title>
<style>
  body { margin: 0; background: #0E1A14; color: #E9E4D6; font: 12px/1.5 "Cascadia Mono", Consolas, monospace; }
  #note { padding: 8px 12px; color: #7FE0B0; }
  #cams { display: flex; gap: 8px; padding: 0 8px; }
  .cam { flex: 1; min-width: 0; position: relative; }
  .cap { padding: 4px 0; color: #C08A3E; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  video { width: 100%; display: block; }
  canvas { position: absolute; left: 0; top: 25px; width: 100%; height: calc(100% - 25px); }
  #hud { padding: 8px 12px; color: #57C25A; white-space: pre; }
</style>
<div id="note">Hold ONE hand in view of both cameras. Keep it still for a few seconds when asked - that measures jitter.</div>
<div id="cams"></div>
<div id="hud"></div>
<script type="module">
  import { FilesetResolver, HandLandmarker } from '/vision_bundle.mjs';

  const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
  const files = await FilesetResolver.forVisionTasks('/wasm');
  const state = { files, cams: [] };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function draw(cam) {
    const ctx = cam.ctx;
    const w = cam.canvas.width;
    const h = cam.canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!cam.last || !cam.last.landmarks || !cam.last.landmarks.length) return;
    for (const hand of cam.last.landmarks) {
      ctx.strokeStyle = '#C08A3E';
      ctx.lineWidth = 2;
      for (const bone of BONES) {
        const a = hand[bone[0]];
        const b = hand[bone[1]];
        ctx.beginPath();
        ctx.moveTo(a.x * w, a.y * h);
        ctx.lineTo(b.x * w, b.y * h);
        ctx.stroke();
      }
      for (let i = 0; i < hand.length; i++) {
        ctx.fillStyle = i === 8 ? '#7FE0B0' : i === 4 ? '#E0A22E' : '#E9E4D6';
        ctx.beginPath();
        ctx.arc(hand[i].x * w, hand[i].y * h, i === 8 || i === 4 ? 5 : 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  window.__gate = {
    async run(opts) {
      const want = opts.wanted;
      try {
        const warm = await navigator.mediaDevices.getUserMedia({ video: true });
        warm.getTracks().forEach((t) => t.stop());
      } catch (e) {
        return { fatal: e.name + ': ' + e.message };
      }
      await sleep(250);
      const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      const match = all.filter((d) => want.some((n) => d.label.toLowerCase().includes(n)));
      const picked = match.length ? match : all.slice(0, 2);

      const host = document.getElementById('cams');
      host.innerHTML = '';
      state.cams = [];

      for (const device of picked) {
        const cam = { label: device.label, processed: 0, detected: 0, inferMs: 0, tips: [], last: null, lastTime: -1, stamp: 0, error: null };
        try {
          cam.stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: device.deviceId }, width: { exact: opts.width }, height: { exact: opts.height }, frameRate: { ideal: 30 } }
          });
        } catch (e) {
          cam.error = e.name + ': ' + e.message;
          state.cams.push(cam);
          continue;
        }
        const wrap = document.createElement('div');
        wrap.className = 'cam';
        const cap = document.createElement('div');
        cap.className = 'cap';
        cap.textContent = device.label;
        const video = document.createElement('video');
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        video.srcObject = cam.stream;
        const canvas = document.createElement('canvas');
        canvas.width = opts.width;
        canvas.height = opts.height;
        wrap.appendChild(cap);
        wrap.appendChild(video);
        wrap.appendChild(canvas);
        host.appendChild(wrap);
        cam.video = video;
        cam.canvas = canvas;
        cam.ctx = canvas.getContext('2d');
        // One landmarker per stream: VIDEO mode demands timestamps that only ever increase, and
        // two interleaved streams through one instance would violate that.
        cam.landmarker = await HandLandmarker.createFromOptions(state.files, {
          baseOptions: { modelAssetPath: '/model', delegate: opts.delegate },
          runningMode: 'VIDEO',
          numHands: opts.hands,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
        state.cams.push(cam);
      }

      const live = state.cams.filter((c) => c.stream && c.landmarker);
      if (!live.length) return { fatal: 'no camera opened', cameras: state.cams.map((c) => ({ label: c.label, error: c.error })) };
      await sleep(1200);

      const hud = document.getElementById('hud');
      const start = performance.now();
      const until = start + opts.seconds * 1000;
      // The jitter window: the last stretch of the run, by which time the hand is placed and still.
      const jitterFrom = until - Math.min(12000, opts.seconds * 400);

      while (performance.now() < until) {
        for (const cam of live) {
          if (cam.video.readyState < 2) continue;
          if (cam.video.currentTime === cam.lastTime) continue;
          cam.lastTime = cam.video.currentTime;
          cam.stamp = Math.max(cam.stamp + 1, Math.round(performance.now()));
          const t0 = performance.now();
          let result = null;
          try {
            result = cam.landmarker.detectForVideo(cam.video, cam.stamp);
          } catch (e) {
            cam.error = cam.error || ('detect: ' + e.message);
            continue;
          }
          cam.inferMs += performance.now() - t0;
          cam.processed++;
          cam.last = result;
          if (result.landmarks && result.landmarks.length) {
            cam.detected++;
            const tip = result.landmarks[0][8];
            if (performance.now() >= jitterFrom) cam.tips.push([tip.x * opts.width, tip.y * opts.height]);
          }
          draw(cam);
        }
        const left = Math.ceil((until - performance.now()) / 1000);
        hud.textContent = live.map((c) => c.label.slice(0, 28) + '  frames ' + c.processed + '  hands ' + c.detected).join('\\n')
          + '\\n' + left + 's left' + (performance.now() >= jitterFrom ? '  - HOLD STILL NOW' : '');
        await new Promise((r) => requestAnimationFrame(() => r()));
      }

      const out = [];
      for (const cam of state.cams) {
        let still = null;
        if (cam.stream && cam.video && cam.video.videoWidth) {
          const c = document.createElement('canvas');
          c.width = cam.video.videoWidth;
          c.height = cam.video.videoHeight;
          const cx = c.getContext('2d');
          cx.drawImage(cam.video, 0, 0);
          cx.drawImage(cam.canvas, 0, 0, c.width, c.height);
          still = c.toDataURL('image/png').split(',')[1];
        }
        // Jitter: RMS distance of the fingertip from its own mean, in source pixels.
        let jitter = null;
        let spread = null;
        if (cam.tips.length > 8) {
          const n = cam.tips.length;
          const mx = cam.tips.reduce((a, p) => a + p[0], 0) / n;
          const my = cam.tips.reduce((a, p) => a + p[1], 0) / n;
          const sq = cam.tips.reduce((a, p) => a + (p[0] - mx) * (p[0] - mx) + (p[1] - my) * (p[1] - my), 0) / n;
          jitter = Math.round(Math.sqrt(sq) * 10) / 10;
          const ds = cam.tips.map((p) => Math.hypot(p[0] - mx, p[1] - my)).sort((a, b) => a - b);
          spread = Math.round(ds[Math.floor(ds.length * 0.95)] * 10) / 10;
        }
        out.push({
          label: cam.label,
          error: cam.error,
          settings: cam.stream ? cam.stream.getVideoTracks()[0].getSettings() : null,
          processed: cam.processed,
          detected: cam.detected,
          fps: Math.round((cam.processed / opts.seconds) * 10) / 10,
          detectionRate: cam.processed ? Math.round((cam.detected / cam.processed) * 100) : null,
          meanInferenceMs: cam.processed ? Math.round((cam.inferMs / cam.processed) * 100) / 100 : null,
          jitterRmsPx: jitter,
          jitterP95Px: spread,
          jitterSamples: cam.tips.length,
          still
        });
      }
      for (const cam of state.cams) {
        if (cam.landmarker) cam.landmarker.close();
        if (cam.stream) cam.stream.getTracks().forEach((t) => t.stop());
      }
      return { cameras: out, videoInputs: all.map((d) => d.label) };
    }
  };
  window.__gateReady = true;
</script>
`;

const main = async () => {
  if (!existsSync(MODEL)) {
    console.log(`[gesture] NO MODEL AT ${MODEL}`);
    console.log('[gesture] fetch it with: curl -L -o "%LOCALAPPDATA%/SkynetOS/vision/hand_landmarker.task" https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task');
    app.exit(1);
    return;
  }
  if (!existsSync(join(MP, 'vision_bundle.mjs'))) {
    console.log(`[gesture] @mediapipe/tasks-vision is not installed at ${MP}`);
    app.exit(1);
    return;
  }
  mkdirSync(outDir, { recursive: true });

  // Loopback only, and only the three things the page needs.
  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    const send = (file) => {
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      createReadStream(file).pipe(res);
    };
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(PAGE);
      return;
    }
    if (url === '/model') return send(MODEL);
    if (url === '/vision_bundle.mjs') return send(join(MP, 'vision_bundle.mjs'));
    if (url.startsWith('/wasm/')) {
      const name = url.slice('/wasm/'.length);
      if (/^[a-z0-9_.-]+$/i.test(name) && existsSync(join(MP, 'wasm', name))) return send(join(MP, 'wasm', name));
    }
    res.writeHead(404).end('no');
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  console.log(`[gesture] serving MediaPipe from 127.0.0.1:${port} (loopback only)`);

  await app.whenReady();
  const win = new BrowserWindow({
    width: 1340,
    height: 720,
    show: true,
    title: 'SkynetOS — gesture gate',
    backgroundColor: '#0E1A14',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  win.webContents.setBackgroundThrottling(false);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.focus();
  const ses = win.webContents.session;
  ses.setPermissionRequestHandler((_wc, permission, done) => done(permission === 'media'));
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'media');
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log(`[gesture] page: ${message.slice(0, 300)}`);
  });
  await win.loadURL(`http://127.0.0.1:${port}/`);

  // The module script ends with __gateReady; wait for it rather than guessing at a delay.
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) {
    await new Promise((done) => setTimeout(done, 250));
    ready = await win.webContents.executeJavaScript('Boolean(window.__gateReady)').catch(() => false);
  }
  if (!ready) {
    console.log('[gesture] the page never finished loading MediaPipe — see the page errors above');
    app.exit(1);
    return;
  }
  console.log(`[gesture] tracking ${width}x${height}, ${hands} hand(s), ${delegate} delegate, ${seconds}s`);

  const opts = { seconds, width, height, hands, delegate, wanted: ['c920', 'c922'] };
  const result = await win.webContents.executeJavaScript(`window.__gate.run(${JSON.stringify(opts)})`);
  if (result.fatal) {
    console.log(`[gesture] FATAL ${result.fatal}`);
  } else {
    console.log(`[gesture] video inputs: ${JSON.stringify(result.videoInputs)}`);
    for (const cam of result.cameras) {
      if (cam.still) {
        const file = `${slug(cam.label)}-${width}x${height}.png`;
        writeFileSync(join(outDir, file), Buffer.from(cam.still, 'base64'));
        cam.stillFile = file;
        delete cam.still;
      }
      if (cam.error && !cam.processed) {
        console.log(`[gesture] ${cam.label}  FAILED ${cam.error}`);
        continue;
      }
      console.log(
        `[gesture] ${cam.label}  ${cam.fps} landmark fps  ${cam.detectionRate}% hands  ` +
        `${cam.meanInferenceMs} ms/frame  jitter rms ${cam.jitterRmsPx} px, p95 ${cam.jitterP95Px} px (${cam.jitterSamples} samples)`
      );
    }
  }
  const file = join(outDir, 'gate.json');
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), seconds, width, height, hands, delegate, ...result }, null, 2));
  console.log(`[gesture] wrote ${file}`);
  server.close();
  app.quit();
};

process.on('uncaughtException', (err) => {
  console.log(`[gesture] CRASHED ${err.stack ?? err.message}`);
  app.exit(1);
});

void main();
