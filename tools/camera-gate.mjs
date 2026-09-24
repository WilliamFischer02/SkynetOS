/*
 * tools/camera-gate.mjs — the dual-camera feasibility gate.
 *
 * The Face's brief, 2026-09-11: two webcams frequently cannot both run at 720p30 on one USB
 * controller. They negotiate bandwidth when they connect, and the second one either fails to open
 * or crawls. So this opens EVERY selected camera before it measures any of them, then reports the
 * frame rate each one actually delivers, second by second. Below 25 sustained on either camera the
 * gesture design changes: separate controllers, or 848x480.
 *
 * It runs on Chromium's capture stack (getUserMedia) rather than ffmpeg, for two reasons: there is
 * no ffmpeg on this machine, and if gesture capture ends up in the renderer this is the stack it
 * will use. Two honest limits of that choice:
 *   - getUserMedia cannot demand MJPEG. Chromium picks the payload format, and for 720p30 on UVC
 *     hardware it asks for MJPEG, but this is not a UVC negotiation trace. Read the numbers as
 *     "what the app would get".
 *   - `width`/`height` as `exact` constrain the TRACK, and Chromium may crop or rescale from a
 *     different native format to satisfy them. Starved bandwidth still shows up as delivered FPS,
 *     which is what the gate is measuring.
 *
 * Usage:  npx electron tools/camera-gate.mjs [--seconds 60] [--out .camera-gate] [--modes 1280x720,848x480]
 * Writes: <out>/gate.json, <out>/gate.html, and one still per camera per mode.
 * Reads no board data, writes nothing outside <out>, takes no single-instance lock, and so cannot
 * disturb a running SkynetOS.
 */

import { app, BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const seconds = Math.max(5, Number(arg('seconds', '60')));
const outDir = resolve(arg('out', '.camera-gate'));
const modes = arg('modes', '1280x720,848x480')
  .split(',')
  .map((m) => m.trim().split('x').map(Number))
  .filter(([w, h]) => w > 0 && h > 0);
/* The two webcams. The Cam Link 4K is an HDMI capture card, not a camera, and is left alone. */
const WANTED = ['c920', 'c922'];

const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '').slice(0, 40);

const HTML = `<!doctype html>
<meta charset="utf-8">
<title>SkynetOS — camera gate</title>
<style>
  body { margin: 0; background: #0b0f0c; color: #d8cfc0; font: 13px/1.4 Consolas, monospace; }
  #note { padding: 8px 12px; color: #7fe3a1; }
  #cams { display: flex; gap: 8px; padding: 0 8px; }
  .cam { flex: 1; min-width: 0; }
  .cap { padding: 4px 0; color: #c98a3c; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  video { width: 100%; background: #000; image-rendering: auto; }
</style>
<div id="note">Hold the checkerboard where BOTH views can see it — in the 90&deg; corner, angled. A still from each camera is saved at the end of every mode.</div>
<div id="cams"></div>
`;

/** The page side: open every camera, then count presented frames per wall-clock second. */
const pageScript = (wantW, wantH, secs, wanted) => `(async () => {
  const wantW = ${wantW}, wantH = ${wantH}, secs = ${secs}, WANTED = ${JSON.stringify(wanted)};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Device labels stay empty until a grant has happened once, so ask, stop, then enumerate.
  try {
    const warm = await navigator.mediaDevices.getUserMedia({ video: true });
    warm.getTracks().forEach((t) => t.stop());
  } catch (e) {
    return { fatal: e.name + ': ' + e.message };
  }
  await sleep(300);
  const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  const match = all.filter((d) => WANTED.some((n) => d.label.toLowerCase().includes(n)));
  const picked = match.length >= 2 ? match : all;

  // Open them ALL before measuring any: the bandwidth negotiation happens at connect.
  const cams = [];
  for (const d of picked) {
    const cam = { label: d.label, deviceId: d.deviceId.slice(0, 8), frames: 0, seen: 0, buckets: [], delivered: [], seenTotal: 0 };
    try {
      cam.stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: d.deviceId }, width: { exact: wantW }, height: { exact: wantH }, frameRate: { ideal: 30 } }
      });
      cam.settings = cam.stream.getVideoTracks()[0].getSettings();
    } catch (e) {
      cam.error = e.name + ': ' + e.message;
      // A refusal is not a dead end: say what this camera WOULD give unconstrained.
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: d.deviceId } } });
        cam.fallbackSettings = s.getVideoTracks()[0].getSettings();
        s.getTracks().forEach((t) => t.stop());
      } catch (e2) { cam.fallbackError = e2.name + ': ' + e2.message; }
    }
    cams.push(cam);
  }

  // On screen, so the checkerboard can be placed while it measures.
  const host = document.getElementById('cams');
  host.innerHTML = '';
  for (const cam of cams) {
    const wrap = document.createElement('div');
    wrap.className = 'cam';
    const cap = document.createElement('div');
    cap.className = 'cap';
    cap.textContent = cam.label + (cam.error ? '  — ' + cam.error : '');
    const v = document.createElement('video');
    v.autoplay = true; v.muted = true; v.playsInline = true;
    if (cam.stream) v.srcObject = cam.stream;
    wrap.append(cap, v);
    host.append(wrap);
    cam.video = v;
  }
  await sleep(1500);

  const start = performance.now();
  for (const cam of cams) {
    if (!cam.stream || !cam.video.requestVideoFrameCallback) continue;
    const tick = () => {
      cam.frames++;
      if (performance.now() - start < secs * 1000 + 2000) cam.video.requestVideoFrameCallback(tick);
    };
    cam.video.requestVideoFrameCallback(tick);
  }
  for (let s = 0; s < secs; s++) {
    const at = start + (s + 1) * 1000;
    while (performance.now() < at) await sleep(20);
    for (const cam of cams) {
      cam.buckets.push(cam.frames - cam.seen);
      cam.seen = cam.frames;
      /*
       * Presented frames (requestVideoFrameCallback) are throttled when the window is not in
       * front: the first run of this gate read 0 fps for 48 s at 720p while the pipeline was in
       * fact delivering 30. totalVideoFrames counts what the capture pipeline produced, which is
       * the question the gate is actually asking.
       */
      const q = cam.video.getVideoPlaybackQuality ? cam.video.getVideoPlaybackQuality() : null;
      const total = q ? q.totalVideoFrames : 0;
      cam.delivered.push(total - cam.seenTotal);
      cam.seenTotal = total;
    }
  }

  const out = [];
  for (const cam of cams) {
    let still = null;
    if (cam.stream && cam.video.videoWidth) {
      const c = document.createElement('canvas');
      c.width = cam.video.videoWidth;
      c.height = cam.video.videoHeight;
      c.getContext('2d').drawImage(cam.video, 0, 0);
      still = c.toDataURL('image/png').split(',')[1];
    }
    // The first two seconds are ramp-up and are not part of "sustained".
    const steady = cam.buckets.slice(2);
    const steadyDelivered = cam.delivered.slice(2);
    const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, x) => a + x, 0) / xs.length) * 10) / 10 : null);
    const q = cam.video.getVideoPlaybackQuality ? cam.video.getVideoPlaybackQuality() : null;
    out.push({
      label: cam.label,
      deviceId: cam.deviceId,
      error: cam.error ?? null,
      settings: cam.settings ?? null,
      fallbackSettings: cam.fallbackSettings ?? null,
      fallbackError: cam.fallbackError ?? null,
      /** What the capture pipeline produced. This is the gate's number. */
      deliveredPerSecond: cam.delivered,
      mean: avg(steadyDelivered),
      min: steadyDelivered.length ? Math.min(...steadyDelivered) : null,
      /** What reached the compositor. Lower than delivered means the window was not in front. */
      presentedPerSecond: cam.buckets,
      presentedMean: avg(steady),
      droppedFrames: q ? q.droppedVideoFrames : null,
      totalFrames: q ? q.totalVideoFrames : null,
      still
    });
  }
  for (const cam of cams) if (cam.stream) cam.stream.getTracks().forEach((t) => t.stop());
  return { want: wantW + 'x' + wantH, videoInputs: all.map((d) => d.label), opened: picked.length, cameras: out };
})()`;

const main = async () => {
  await app.whenReady();
  mkdirSync(outDir, { recursive: true });
  const page = join(outDir, 'gate.html');
  writeFileSync(page, HTML);

  const win = new BrowserWindow({
    width: 1340,
    height: 640,
    show: true,
    title: 'SkynetOS — camera gate',
    backgroundColor: '#0b0f0c',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  // A window behind another one stops presenting frames, which the first run of this gate read as
  // a dead camera. Kept in front and unthrottled, so the measurement is of hardware, not of focus.
  win.webContents.setBackgroundThrottling(false);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.focus();
  const ses = win.webContents.session;
  ses.setPermissionRequestHandler((_wc, permission, done) => done(permission === 'media'));
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'media');
  await win.loadFile(page);

  const results = [];
  for (const [w, h] of modes) {
    console.log(`[gate] ${w}x${h}: opening every camera at once, then measuring ${seconds}s`);
    const r = await win.webContents.executeJavaScript(pageScript(w, h, seconds, WANTED));
    if (r.fatal) {
      console.log(`[gate] ${w}x${h} FATAL ${r.fatal}`);
      results.push({ mode: `${w}x${h}`, fatal: r.fatal });
      break;
    }
    console.log(`[gate] video inputs seen: ${JSON.stringify(r.videoInputs)}`);
    for (const cam of r.cameras) {
      if (cam.still) {
        const file = `${slug(cam.label)}-${w}x${h}.png`;
        writeFileSync(join(outDir, file), Buffer.from(cam.still, 'base64'));
        cam.stillFile = file;
        delete cam.still;
      }
      const line = cam.error
        ? `FAILED ${cam.error}${cam.fallbackSettings ? `  (unconstrained it gives ${cam.fallbackSettings.width}x${cam.fallbackSettings.height}@${cam.fallbackSettings.frameRate})` : ''}`
        : `${cam.settings.width}x${cam.settings.height}@${cam.settings.frameRate}  delivered mean ${cam.mean} fps  min ${cam.min}  (presented mean ${cam.presentedMean}, dropped ${cam.droppedFrames}/${cam.totalFrames})`;
      console.log(`[gate] ${w}x${h}  ${cam.label}  ${line}`);
      console.log(`[gate] ${w}x${h}  ${cam.label}  delivered per second: ${JSON.stringify(cam.deliveredPerSecond)}`);
    }
    results.push({ mode: `${w}x${h}`, ...r });
    await new Promise((done) => setTimeout(done, 1500));
  }

  const file = join(outDir, 'gate.json');
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), seconds, results }, null, 2));
  console.log(`[gate] wrote ${file}`);
  app.quit();
};

process.on('uncaughtException', (err) => {
  console.log(`[gate] CRASHED ${err.stack ?? err.message}`);
  app.exit(1);
});

void main();
