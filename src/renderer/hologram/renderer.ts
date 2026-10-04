import type { HoloScene } from '@shared/holo-scene.js';
import { BRIGHTEN_DOWN_MS, BRIGHTEN_UP_MS, brightnessFor, flickerAt, paletteFor, smoothLevel, type HologramMood } from '@shared/hologram.js';
import { LEVEL_BANDS, SILENT_BANDS, smoothBands, type AudioLevels } from '@shared/speech-levels.js';
import { FRAME_WINDOW_MS, summariseFrames, type FrameSample, type FrameSummary } from '@shared/frame-stats.js';
import { createTarget, globeScale, mul3, resizeTarget, rotationX, rotationY, rotationZ, type Target } from './gl.js';
import { Globe } from './globe.js';
import { Post } from './post.js';
import { SceneLayer } from './scene.js';
import { Wisps } from './wisps.js';

/**
 * The hologram renderer: one WebGL2 context, one loop, three passes.
 *
 *   1. intensity: the globe grid, its pinned dots and the wisps, added together in an offscreen
 *      target (post.ts colours it, so nothing here knows about blue);
 *   2. post: dither onto the palette at 1:1 device pixels, with the glass disc, the LISTENING
 *      halo and the scanline;
 *   3. overlay: the scene's icons and the centre panel, crisp and in colour.
 *
 * Everything animated is smoothed here from the last event: band levels (attack 40 ms, release
 * 250 ms), brightness (180 ms up, 400 ms down), rotation speed by mood. The loop STOPS when the
 * document is hidden (the window minimised or hidden: Electron reports both as `document.hidden`)
 * and no frame is requested until `visibilitychange` says it is visible again (2026-09-27; before,
 * it kept re-arming requestAnimationFrame and returned early). Budget: under 4 ms a frame at 480 px
 * on an RTX-class GPU; when the previous frame took over 8 ms the 2D repaints of the content panel
 * are skipped for a frame, and counted (`stats().window.skipped`, the perf readout).
 */

export interface RendererStats {
  frameMs: number;
  fps: number;
  frames: number;
  /** fps, p50/p95 frame ms and skipped repaints over the last two seconds (packages/shared/frame-stats.ts). */
  window: FrameSummary;
  /** The loop is stopped because the window is hidden or minimised. */
  paused: boolean;
}

/** Samples kept for the perf readout: two seconds at up to 240 Hz. */
const FRAME_RING = 480;

export interface HologramRenderer {
  setMood(mood: HologramMood): void;
  /**
   * The LISTENING light (2026-09-27): on exactly while a capture track is open (the turn's `mic`,
   * from the capture window's own tracks), independent of the mood. Before, the halo was keyed to
   * `mood === 'listening'`, and any mood that outranked it (a desktop step, a line being spoken)
   * put the light out while the microphone was still open.
   */
  setListening(on: boolean): void;
  /** WAITING on a question: a soft brightening, less than LISTENING. */
  setWaiting(on: boolean): void;
  setSpeechLevels(levels: AudioLevels): void;
  setMicLevels(levels: AudioLevels): void;
  setWarming(on: boolean): void;
  setScene(scene: HoloScene): void;
  setReducedMotion(on: boolean): void;
  start(): void;
  stop(): void;
  destroy(): void;
  stats(): RendererStats;
}

const AXIS_TILT = 0.38;
const BUDGET_SKIP_MS = 8;

export function createHologramRenderer(canvas: HTMLCanvasElement): HologramRenderer {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: true, powerPreference: 'high-performance', desynchronized: true });
  if (!gl) throw new Error('WEBGL2 IS NOT AVAILABLE IN THIS WINDOW');

  const globe = new Globe(gl);
  const wisps = new Wisps(gl);
  const post = new Post(gl);
  const scene = new SceneLayer(gl, globe);
  let target: Target = createTarget(gl, 8, 8);

  let mood: HologramMood = 'off';
  let listeningOn = false;
  let waitingOn = false;
  let warming = false;
  let reduced = false;
  let speech: AudioLevels | null = null;
  let speechAt = 0;
  let mic: AudioLevels | null = null;
  let micAt = 0;
  let bands: number[] = [...SILENT_BANDS];
  let rms = 0;
  let bright = brightnessFor('off');
  let halo = 0;
  let grid = 1;
  let angle = 0;
  let lastT = 0;
  let raf = 0;
  let running = false;
  let lastFrameMs = 0;
  let frames = 0;
  let fpsWindowStart = 0;
  let fpsWindowFrames = 0;
  let fps = 0;
  let spread = 1;
  let paused = false;
  const ring: FrameSample[] = [];
  let ringAt = 0;

  /*
   * The backing store is the canvas's size in DEVICE pixels, as a ResizeObserver reports it
   * (`device-pixel-content-box`, exact at any devicePixelRatio), so one canvas pixel is one device
   * pixel and the post pass's dither stays 1:1 (2026-09-27, the resizable window). Before the
   * first report, or where that box is not supported, CSS size x devicePixelRatio, rounded.
   */
  let deviceW = 0;
  let deviceH = 0;
  let observer: ResizeObserver | null = null;
  try {
    observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const box = entry.devicePixelContentBoxSize?.[0];
      if (box) { deviceW = Math.round(box.inlineSize); deviceH = Math.round(box.blockSize); return; }
      const dpr = window.devicePixelRatio || 1;
      deviceW = Math.round(entry.contentRect.width * dpr);
      deviceH = Math.round(entry.contentRect.height * dpr);
    });
    try { observer.observe(canvas, { box: 'device-pixel-content-box' }); } catch { observer.observe(canvas); }
  } catch { observer = null; }

  const resize = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(8, deviceW || Math.round(canvas.clientWidth * dpr));
    const h = Math.max(8, deviceH || Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    resizeTarget(gl, target, w, h);
  };

  const breathBands: number[] = new Array<number>(LEVEL_BANDS).fill(0);

  const frame = (t: number): void => {
    if (!running) return;
    // Hidden or minimised: stop asking for frames at all; `onVisibility` restarts the loop.
    if (document.hidden) { paused = true; raf = 0; lastT = 0; return; }
    raf = requestAnimationFrame(frame);
    const started = performance.now();
    const dt = lastT ? Math.min(100, t - lastT) : 16;
    lastT = t;
    resize();
    const w = canvas.width;
    const h = canvas.height;
    const aspect = w / h;
    const scale = globeScale(w, h);

    // Sources: the line being spoken, else the microphone, else a resting breath.
    const speaking = mood === 'speaking' && speech && t - speechAt < 400;
    const listening = listeningOn || mood === 'listening';
    let targetBands: readonly number[] = SILENT_BANDS;
    let targetRms = 0;
    if (speaking && speech) { targetBands = speech.bands; targetRms = speech.rms; }
    else if (listening && mic && performance.now() - micAt < 400) { targetBands = mic.bands.map((v) => v * 0.7); targetRms = mic.rms * 0.5; }
    else if (!reduced && mood !== 'off' && mood !== 'fault') {
      // The resting breath, every frame: one reused array rather than one allocated per frame.
      const breath = 0.06 + 0.05 * Math.sin(t / 1400);
      breathBands[0] = breath; breathBands[1] = breath * 0.6;
      targetBands = breathBands;
      targetRms = breath * 0.5;
    }
    bands = smoothBands(bands, targetBands, dt);
    rms = smoothLevel(rms, targetRms, dt, { attackMs: 40, decayMs: 250 });

    // Brightness: the LISTENING brightening is a ramp, not a switch, and it holds for as long as a
    // track is open whatever else is going on. THINKING is a slow pulse; ACTING a quicker one, so
    // work in progress never looks like rest; WAITING (a question) a soft brightening.
    const pulse = mood === 'thinking' ? 0.9 + 0.1 * Math.sin(t / 350) : mood === 'acting' && !reduced ? 1 + 0.12 * Math.sin(t / 160) : 1;
    const base = brightnessFor(mood) * (warming ? 0.8 + 0.15 * Math.sin(t / 600) : 1) * pulse;
    const wantBright = Math.max(base, listening ? brightnessFor('listening') : 0, waitingOn ? 1.1 : 0);
    bright = smoothLevel(bright / 1.5, wantBright / 1.5, dt, { attackMs: BRIGHTEN_UP_MS, decayMs: BRIGHTEN_DOWN_MS }) * 1.5;
    halo = smoothLevel(halo, listening ? 1 : waitingOn ? 0.35 : 0, dt, { attackMs: BRIGHTEN_UP_MS, decayMs: BRIGHTEN_DOWN_MS });
    spread = 1 + 0.18 * halo;
    const focus = scene.focusStrength(t);
    grid = smoothLevel(grid, 1 - 0.6 * focus, dt, { attackMs: 200, decayMs: 200 });

    // Rotation: steady, slower while thinking, a touch faster with loudness, still on a fault.
    const speed = mood === 'fault' || (reduced && mood !== 'speaking') ? 0 : mood === 'thinking' ? 0.35 : 1 + rms * 0.6;
    angle += dt * 0.00022 * speed;
    const rot = mul3(rotationZ(0.12), mul3(rotationX(AXIS_TILT), rotationY(angle)));

    // 1. Intensity pass.
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    const pointPx = Math.max(1.5, (h / 480) * 2.2);
    globe.use({ rot, scale, aspect, bands, rms, gridAlpha: grid * (mood === 'off' ? 0.75 : 1), pointSize: pointPx });
    globe.drawGrid();
    const wispCount = wisps.update(t, Math.max(rms, halo * 0.4), spread, speed === 0 ? 0.001 : speed);
    globe.drawLines(wisps.glBuffer, wispCount, mood === 'off' ? 0.5 : 1, 1);
    const pins = scene.pins();
    if (pins) globe.setPins(pins);
    globe.drawPins(1.2, pointPx * 2.2);

    // 2. Post pass onto the canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    const avgBand = bands.reduce((s, v) => s + v, 0) / LEVEL_BANDS;
    post.draw(target.texture, {
      palette: paletteFor(mood),
      bright,
      centre: [w / 2, h / 2],
      radius: scale * h * 0.5 * (1 + 0.12 * avgBand),
      disc: mood === 'off' ? 0.16 : 0.26,
      halo,
      scan: true,
      flicker: flickerAt(t, reduced)
    });

    // 3. Overlay.
    const repaint = lastFrameMs <= BUDGET_SKIP_MS;
    scene.draw({ rot, scale, aspect, width: w, height: h, now: t }, repaint, spread);

    lastFrameMs = performance.now() - started;
    const sample = { t, ms: lastFrameMs, skipped: !repaint };
    if (ring.length < FRAME_RING) ring.push(sample);
    else { ring[ringAt] = sample; ringAt = (ringAt + 1) % FRAME_RING; }
    frames++;
    fpsWindowFrames++;
    if (!fpsWindowStart) fpsWindowStart = t;
    if (t - fpsWindowStart >= 1000) { fps = Math.round((fpsWindowFrames * 1000) / (t - fpsWindowStart)); fpsWindowStart = t; fpsWindowFrames = 0; }
  };

  const onVisibility = (): void => {
    if (document.hidden) return;
    lastT = 0;
    if (running && paused) { paused = false; raf = requestAnimationFrame(frame); }
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    setMood(next) { mood = next; },
    setListening(on) { listeningOn = on; },
    setWaiting(on) { waitingOn = on; },
    setSpeechLevels(levels) { speech = levels; speechAt = performance.now(); },
    setMicLevels(levels) { mic = levels; micAt = performance.now(); },
    setWarming(on) { warming = on; },
    setScene(next) { scene.setScene(next, performance.now()); },
    setReducedMotion(on) { reduced = on; },
    start() { if (running) return; running = true; paused = false; lastT = 0; raf = requestAnimationFrame(frame); },
    stop() { running = false; paused = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
    destroy() {
      this.stop();
      observer?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      scene.destroy();
      post.destroy();
      wisps.destroy();
      globe.destroy();
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
      target = { framebuffer: target.framebuffer, texture: target.texture, width: 0, height: 0 };
    },
    stats() { return { frameMs: lastFrameMs, fps, frames, window: summariseFrames(ring, performance.now(), FRAME_WINDOW_MS), paused }; }
  };
}
