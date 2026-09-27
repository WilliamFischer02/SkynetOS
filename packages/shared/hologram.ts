import type { VoicePhase } from './voice.js';
import type { SpeechState } from './speech.js';
import type { DesktopState } from './desktop.js';

/**
 * JARVIS Voice: the small square window with the hologram in it (docs/11-JARVIS-VOICE.md).
 *
 * Types, and the pure half of the window: which mood wins, how a per-word level is smoothed, what
 * the caption says, and the sphere itself as a grid of palette indices. Main
 * (services/hologram-window.ts) opens the window; the renderer (#hologram) blits the grid at a
 * whole-number scale. The window is a VIEW over three streams it never owns: the voice pipeline
 * (`voice:*` events), speech playback (`speech:state`) and desktop control (`desktop:state`). It
 * opens no microphone of its own, which is what keeps docs/07 "Voice" true with it on screen.
 */

export interface HologramSettings {
  /** Open the window when SkynetOS starts. Written only by the user-only `hologram:setEnabled`. */
  enabled: boolean;
  /** Float above other windows. A view preference, file-only. */
  alwaysOnTop: boolean;
  /** The square's side in DIPs. Rendered at a whole-number scale of a small canvas. */
  size: number;
}

export const DEFAULT_HOLOGRAM: HologramSettings = {
  enabled: false,
  alwaysOnTop: true,
  size: 480
};

/** The square's side when the setting is absent or out of range. 2026-09-26: doubled from 240. */
export const HOLOGRAM_DEFAULT_SIZE = 480;
export const HOLOGRAM_MIN_SIZE = 160;
export const HOLOGRAM_MAX_SIZE = 960;

/** DESK layout: the window stands at a monitor's right edge, full work-area height, this wide per tall. */
export const HOLOGRAM_DESK_RATIO = 0.6;

export interface HologramRect { x: number; y: number; width: number; height: number }

/** A saved or configured size made safe: whole pixels inside the bounds, the default when absent. */
export function clampHologramSize(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : HOLOGRAM_DEFAULT_SIZE;
  return Math.max(HOLOGRAM_MIN_SIZE, Math.min(HOLOGRAM_MAX_SIZE, n));
}

/**
 * Where the window goes in DESK mode: monitor one's work area, right edge, full height, width a
 * multiple of 8 so the GL canvas keeps whole-pixel columns at every scale.
 */
export function deskBounds(work: HologramRect, ratio = HOLOGRAM_DESK_RATIO): HologramRect {
  const height = Math.max(HOLOGRAM_MIN_SIZE, Math.floor(work.height));
  const width = Math.max(HOLOGRAM_MIN_SIZE, Math.min(Math.floor(work.width), Math.round((height * ratio) / 8) * 8));
  return { x: work.x + work.width - width, y: work.y, width, height };
}

/**
 * Brightness the whole picture runs at, per mood: LISTENING is a full brightening (William:
 * "a full brightening animation between listening and dormant so that the voice capabilities
 * activation is clear"), dormant sits low, everything else is nominal.
 */
export function brightnessFor(mood: HologramMood): number {
  switch (mood) {
    case 'listening': return 1.35;
    case 'speaking': return 1.1;
    case 'acting': return 1.05;
    case 'thinking': return 0.95;
    case 'idle': return 0.8;
    case 'fault': return 0.9;
    case 'off': return 0.45;
  }
}

/** Ramp times for the brightening: quick up so a wake reads at once, slower down so it does not snap. */
export const BRIGHTEN_UP_MS = 180;
export const BRIGHTEN_DOWN_MS = 400;

export interface HologramStatus {
  enabled: boolean;
  /** The window exists (it may be minimised). */
  open: boolean;
  minimized: boolean;
  alwaysOnTop: boolean;
  /** DESK layout: on monitor one, full height (docs/11). Absent from an older main. */
  desk?: boolean;
}

/**
 * What the sphere is doing, in order of precedence when several are true at once. `fault` wins:
 * a broken engine is the thing to show, not a calm idle.
 */
export type HologramMood = 'fault' | 'acting' | 'speaking' | 'listening' | 'thinking' | 'idle' | 'off';

/** The line's route while the synthesis server loads: shown as WARMING THE VOICE over the mood. */
export function isWarming(speech: SpeechState | null): boolean {
  return speech?.warming === true;
}

/* ────────────────────────── mood ────────────────────────── */

/**
 * The one mood the sphere shows, from the three streams. Precedence is the order of the
 * HologramMood union: a fault beats everything, acting (the desktop is moving) beats speech,
 * speech beats listening, and voice's own phases fill in the rest. Voice `off` with nothing else
 * going on is `off`; the sphere is dim, not gone, because the window still takes typed commands.
 */
export function moodFrom(voice: VoicePhase, speech: SpeechState | null, desktop: DesktopState | null): HologramMood {
  if (voice === 'unavailable') return 'fault';
  if (desktop?.busy) return 'acting';
  if (speech?.speaking) return 'speaking';
  if (voice === 'listening') return 'listening';
  if (voice === 'thinking' || voice === 'starting') return 'thinking';
  if (voice === 'waiting') return 'idle';
  return 'off';
}

/* ────────────────────────── level ────────────────────────── */

export interface LevelSmoothing {
  /** How fast the level rises toward a louder target, ms to cover ~63%. */
  attackMs: number;
  /** How fast it falls toward a quieter one. Slower than attack, so a word leaves a swell. */
  decayMs: number;
}

export const DEFAULT_LEVEL_SMOOTHING: LevelSmoothing = { attackMs: 60, decayMs: 260 };

/** Exponential approach: fast up, slow down. Clamped to 0..1; a bad input counts as silence. */
export function smoothLevel(previous: number, target: number, dtMs: number, smoothing: LevelSmoothing = DEFAULT_LEVEL_SMOOTHING): number {
  const prev = Number.isFinite(previous) ? Math.min(1, Math.max(0, previous)) : 0;
  const goal = Number.isFinite(target) ? Math.min(1, Math.max(0, target)) : 0;
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  const tau = goal > prev ? smoothing.attackMs : smoothing.decayMs;
  const k = tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
  return prev + (goal - prev) * k;
}

/* ────────────────────────── caption ────────────────────────── */

export interface CaptionInput {
  mood: HologramMood;
  voice: VoicePhase;
  voiceError?: string;
  wakeWord?: string;
  /** The last sentence heard, if any. */
  heard?: string | null;
  /** What was said back, or done, if any. */
  said?: string | null;
  /** The desktop step in progress. */
  desktop?: DesktopState | null;
  /** The sentence being spoken. */
  speech?: SpeechState | null;
  /** Stream mode: never print what was heard or said. */
  streamMode?: boolean;
}

/** The one ALL-CAPS line under the sphere. Precedence follows the mood. */
export function captionFor(input: CaptionInput): string {
  const hide = input.streamMode === true;
  switch (input.mood) {
    case 'fault':
      return (input.voiceError || 'VOICE IS UNAVAILABLE').toUpperCase();
    case 'acting': {
      const d = input.desktop;
      const step = d?.index !== undefined && d.total !== undefined ? `STEP ${d.index + 1} OF ${d.total}` : 'WORKING';
      return hide ? step : `${step}${d?.message ? ` — ${d.message}` : ''}`.toUpperCase();
    }
    case 'speaking':
      return hide ? 'SPEAKING' : (input.speech?.text || input.said || 'SPEAKING').toUpperCase();
    case 'listening':
      return 'LISTENING';
    case 'thinking':
      return input.voice === 'starting' ? 'STARTING THE SPEECH ENGINE' : hide ? 'THINKING' : `THINKING${input.heard ? ` — ${input.heard}` : ''}`.toUpperCase();
    case 'idle':
      if (!hide && input.said) return input.said.toUpperCase();
      if (!hide && input.heard) return input.heard.toUpperCase();
      return `READY — SAY ${(input.wakeWord || 'JARVIS').toUpperCase()}`;
    case 'off':
      return hide || !input.said ? 'MICROPHONE OFF — TYPE A COMMAND BELOW' : input.said.toUpperCase();
  }
}

/* ────────────────────────── the sphere ────────────────────────── */

/** The canvas's logical side. The renderer scales it by a whole number. */
export const SPHERE_SIZE = 80;

/** Six blues from near-black to white-cyan, plus white. Index 0 is the empty window. */
export const HOLOGRAM_PALETTE = ['#04090F', '#0B1E36', '#12466E', '#1F80B8', '#48C8F0', '#B8F4FF', '#FFFFFF'] as const;
/** The same ramp in amber, for a fault. */
export const HOLOGRAM_FAULT_PALETTE = ['#0F0904', '#3A2208', '#6E4412', '#B87A1E', '#F0BE46', '#FFE9B8', '#FFFFFF'] as const;

export function paletteFor(mood: HologramMood): readonly string[] {
  return mood === 'fault' ? HOLOGRAM_FAULT_PALETTE : HOLOGRAM_PALETTE;
}

export interface SphereFrame {
  /** Logical size; the output is size*size indices. */
  size: number;
  /** Milliseconds; drives breath, rings, band, orbit. */
  t: number;
  mood: HologramMood;
  /** 0..1, the smoothed speech level. */
  level: number;
  reducedMotion: boolean;
  /** This frame is a flicker frame: the image sits one pixel right and one step dimmer. */
  flicker: boolean;
}

// 4x4 Bayer matrix, 0..15.
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
] as const;

const TWO_PI = Math.PI * 2;
const LIT = 5; // shading levels 1..5; 6 is white, kept for highlights
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Whether a frame at time t should be a flicker frame: about one in ninety, deterministic. */
export function flickerAt(t: number, reducedMotion: boolean): boolean {
  if (reducedMotion) return false;
  const tick = Math.floor(t / 33);
  // A cheap hash of the frame number; roughly 1.1% of frames.
  return ((tick * 2654435761) >>> 0) % 91 === 0;
}

/**
 * The sphere as palette indices, row-major. Everything is integer pixels: no anti-aliasing, no
 * blending. Shading is a Bayer dither over the ramp, rings are whole pixels brightened one step,
 * scanlines darken every odd row one step (applyScanlines), and the ground disc is dithered too.
 */
export function renderSphere(frame: SphereFrame): Uint8Array {
  const size = Math.max(8, Math.floor(frame.size));
  const out = new Uint8Array(size * size);
  const still = frame.mood === 'fault' || (frame.reducedMotion && frame.mood !== 'speaking');
  const t = still ? 0 : frame.t;
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2 - size * 0.04;
  const base = size * 0.34;

  let radius = base;
  if (frame.mood === 'idle' || frame.mood === 'off') radius = base * (1 + (frame.reducedMotion || frame.mood === 'off' ? 0.02 : 0.045) * Math.sin(TWO_PI * (t / 4000)));
  if (frame.mood === 'speaking') radius = base * (1 + 0.2 * clamp(frame.level, 0, 1));
  if (frame.mood === 'listening') radius = base * 1.03;

  const dim = frame.mood === 'off' ? 0.42 : 1;
  const ringPhase = frame.reducedMotion ? 0 : t / 6000;
  const bandY = frame.mood === 'thinking' ? cy - radius + ((t / 1200) % 1) * radius * 2 : -1;
  const shift = frame.flicker ? 1 : 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x - shift;
      const dx = (px - cx) / radius;
      const dy = (y - cy) / radius;
      const d2 = dx * dx + dy * dy;
      let idx = 0;
      if (d2 <= 1) {
        const nz = Math.sqrt(1 - d2);
        // Light from the upper left, plus a rim so the edge reads as glass.
        const lit = clamp(0.3 + 0.7 * (-0.45 * dx - 0.5 * dy + 0.55 * nz), 0, 1);
        const rim = d2 > 0.82 ? 0.25 : 0;
        let shade = clamp((lit + rim) * dim, 0, 1);
        // Latitude rings drifting down the sphere: whole pixels, one step brighter.
        const lat = Math.asin(clamp(dy, -1, 1)) / Math.PI + 0.5; // 0..1
        const ring = ((lat * 7 + ringPhase * 7) % 1 + 1) % 1 < 0.14;
        if (frame.mood !== 'off' && ring) shade = clamp(shade + 0.22, 0, 1);
        if (bandY >= 0 && Math.abs(y - bandY) <= 1) shade = clamp(shade + 0.3, 0, 1);
        const level = shade * LIT + BAYER[y & 3]![px & 3]! / 16;
        idx = clamp(Math.floor(level) + 1, 1, LIT + 1);
        if (frame.flicker) idx = Math.max(1, idx - 1);
      }
      out[y * size + x] = idx;
    }
  }

  // Listening: rings expanding outward from the sphere, outside it, fading as they go.
  if (frame.mood === 'listening') {
    const reach = size * 0.49;
    for (let k = 0; k < 3; k++) {
      const p = frame.reducedMotion ? (k + 1) / 4 : (((t / 1100) + k / 3) % 1);
      const rr = radius + p * (reach - radius);
      if (rr <= radius) continue;
      const shade = p < 0.5 ? 4 : 3;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dpx = Math.hypot(x - cx, y - cy);
          if (Math.abs(dpx - rr) < 0.75 && out[y * size + x] === 0) out[y * size + x] = shade;
        }
      }
    }
  }

  // Acting: a small dot orbiting the sphere.
  if (frame.mood === 'acting') {
    const a = frame.reducedMotion ? 0.3 : TWO_PI * ((t / 1500) % 1);
    const ox = Math.round(cx + Math.cos(a) * radius * 1.28);
    const oy = Math.round(cy + Math.sin(a) * radius * 0.36);
    const behind = Math.sin(a) < 0;
    for (let yy = oy; yy < oy + 2; yy++) {
      for (let xx = ox; xx < ox + 2; xx++) {
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const i = yy * size + xx;
        if (behind && out[i] !== 0) continue;
        out[i] = 6;
      }
    }
  }

  // The ground disc: a dithered ellipse under the sphere.
  const gy = cy + radius + 3;
  const grx = radius * 0.95;
  for (let y = Math.floor(gy - 3); y <= Math.ceil(gy + 3); y++) {
    for (let x = 0; x < size; x++) {
      if (y < 0 || y >= size) continue;
      const ex = (x - cx) / grx;
      const ey = (y - gy) / 2.6;
      const e = ex * ex + ey * ey;
      if (e > 1) continue;
      const i = y * size + x;
      if (out[i] !== 0) continue;
      const shade = (1 - e) * 1.6 * dim + BAYER[y & 3]![x & 3]! / 16;
      out[i] = shade >= 1 ? 2 : shade >= 0.5 ? 1 : 0;
    }
  }

  return applyScanlines(out, size);
}

/** Every odd row one step darker, never below 1 inside the image, and never touching empty pixels. */
export function applyScanlines(indices: Uint8Array, size: number): Uint8Array {
  for (let y = 1; y < size; y += 2) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const v = indices[i]!;
      if (v > 1) indices[i] = v - 1;
    }
  }
  return indices;
}
