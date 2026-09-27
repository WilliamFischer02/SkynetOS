/**
 * Motion for the board camera, and nothing else: how the picture gets from where it is to where
 * the camera was told to go. Pure, so test/motion.test.ts can hold the numbers.
 *
 * William, 2026-09-26: "when rendering zooms on the board I want you to make it smooth, kind of
 * like a transcoded, eased speed from what the actual mouse zoom wheel is doing … do the same for
 * dragging with mouse movements or hand gestures."
 *
 * ── The shape ─────────────────────────────────────────────────────────────────────────────────
 *
 * The camera the rest of BoardCanvas writes (`cameraStore`) is the TARGET: the wheel, the keys,
 * a drag, a minimap jump all set it instantly, exactly as before. What changed is that the stage
 * is drawn from a second camera, the SHOWN one, which a critically damped spring pulls toward the
 * target every frame. Critically damped because it is the fastest approach with no overshoot: a
 * board that swings past the zoom you asked for and comes back reads as loose, and an
 * under-damped drag lands a node somewhere you did not put it.
 *
 * The spring is stepped in closed form, not by Euler integration, so two frames of dt/2 land
 * exactly where one frame of dt does. A 144 Hz monitor and a 30 Hz one see the same motion.
 *
 * ── Zoom and the anti-mush rule ───────────────────────────────────────────────────────────────
 *
 * docs/02 rule 4: the stage is never rendered at a fractional zoom. While the shown zoom is
 * between two levels the stage renders at the LOWER level and the canvas element is scaled up by
 * CSS (`renderPlan`), with `image-rendering: pixelated`, so every pixel on screen is still one of
 * the rendered ones; the picture is chunkier for 160 ms and then snaps to the exact level and is
 * re-rendered once. The lower level, never the upper, so the scale is ≥ 1 and the canvas always
 * covers the viewport.
 *
 * While a zoom is in flight the shown x/y are not sprung: they are DERIVED from the anchor, so the
 * world point under the cursor stays under the cursor at every intermediate zoom. When the zoom
 * settles the pan spring takes over from wherever that left the camera, which is exactly the
 * target, so nothing jumps.
 */
import { ZOOM_LEVELS, type Camera, type Zoom } from './camera.js';

/** "Settled" means within this fraction of the distance travelled. */
export const SETTLE_TOLERANCE = 0.005;
/** A mouse drag should feel attached: it settles in about a frame and a half at 60 Hz. */
export const MOUSE_PAN_SETTLE_MS = 90;
/** A hand is noisier than a mouse; a softer spring is what makes the cursor look deliberate. */
export const GESTURE_PAN_SETTLE_MS = 180;
export const ZOOM_SETTLE_MS = 160;
/** Momentum after a released drag dies within this. */
export const GLIDE_MS = 250;
/** Below this speed (world px per second) a glide is over. */
export const GLIDE_STOP_SPEED = 2;

/**
 * The natural frequency ω (per second) of a critically damped spring that closes all but
 * `tolerance` of its distance in `settleMs`, from rest. Solved once per settle time by bisection
 * on e^{-u}(1 + u) = tolerance, u = ω·t.
 */
export function omegaForSettle(settleMs: number, tolerance = SETTLE_TOLERANCE): number {
  let lo = 0;
  let hi = 64;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (Math.exp(-mid) * (1 + mid) > tolerance) lo = mid; else hi = mid;
  }
  return hi / (Math.max(1, settleMs) / 1000);
}

export interface Spring {
  x: number;
  /** Velocity, per second. */
  v: number;
}

/**
 * One step of a critically damped spring toward `target`, in closed form:
 * x(t) = target + (A + B t) e^{-ωt}, with A = x0 − target and B = v0 + ωA.
 */
export function stepSpring(s: Spring, target: number, omega: number, dtMs: number): Spring {
  const t = Math.max(0, dtMs) / 1000;
  const a = s.x - target;
  const b = s.v + omega * a;
  const e = Math.exp(-omega * t);
  const x = target + (a + b * t) * e;
  const v = (b - omega * (a + b * t)) * e;
  return { x, v };
}

/** Screen point a zoom is happening about, in canvas pixels. */
export interface ZoomAnchor { ax: number; ay: number }

export interface Glide { vx: number; vy: number; msLeft: number }

export interface MotionState {
  x: Spring;
  y: Spring;
  zoom: Spring;
  /** Set while a zoom tween is in flight; cleared when it settles. */
  anchor: ZoomAnchor | null;
  /** The target zoom last seen, so a change can be noticed. */
  lastTargetZoom: number;
  glide: Glide | null;
  /** Which spring the pan uses: the mouse's or the hand's. */
  panSettleMs: number;
}

export function initialMotion(cam: Camera): MotionState {
  return {
    x: { x: cam.x, v: 0 },
    y: { x: cam.y, v: 0 },
    zoom: { x: cam.zoom, v: 0 },
    anchor: null,
    lastTargetZoom: cam.zoom,
    glide: null,
    panSettleMs: MOUSE_PAN_SETTLE_MS
  };
}

/** Put the shown camera exactly on the target: a new room, or a press that must not lag. */
export function snapMotion(m: MotionState, cam: Camera): void {
  m.x = { x: cam.x, v: 0 };
  m.y = { x: cam.y, v: 0 };
  m.zoom = { x: cam.zoom, v: 0 };
  m.anchor = null;
  m.lastTargetZoom = cam.zoom;
  m.glide = null;
}

export interface Shown { x: number; y: number; zoom: number }

export interface MotionResult {
  shown: Shown;
  /** False when nothing is in flight: the caller may skip the transform work entirely. */
  moving: boolean;
}

const ZOOM_MIN = ZOOM_LEVELS[0];
const ZOOM_MAX = ZOOM_LEVELS[ZOOM_LEVELS.length - 1] ?? 1;

/**
 * Advance the shown camera one frame toward `target`.
 *
 * `anchorHint` is where the last zoom command pointed (the cursor for the wheel, the viewport
 * centre for the keys); it is consumed only when the target zoom has changed since last frame.
 */
export function stepMotion(m: MotionState, target: Camera, dtMs: number, anchorHint: ZoomAnchor): MotionResult {
  const dt = Math.min(100, Math.max(0, dtMs));

  if (target.zoom !== m.lastTargetZoom) {
    m.lastTargetZoom = target.zoom;
    m.anchor = { ...anchorHint };
  }

  let moving = false;

  // Zoom.
  if (m.anchor) {
    const next = stepSpring(m.zoom, target.zoom, omegaForSettle(ZOOM_SETTLE_MS), dt);
    next.x = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next.x));
    // Within a fifth of a percent of a level: closer than one device pixel of scale at any size.
    if (Math.abs(next.x - target.zoom) < 0.002) {
      m.zoom = { x: target.zoom, v: 0 };
      // The anchor keeps the world point fixed right up to the last frame; land exactly on target.
      m.x = { x: target.x, v: 0 };
      m.y = { x: target.y, v: 0 };
      m.anchor = null;
      moving = true; // one more frame: the caller re-renders at the exact level
      return { shown: { x: m.x.x, y: m.y.x, zoom: m.zoom.x }, moving };
    }
    m.zoom = next;
    // Derived position: the anchor's world point stays under the anchor at this zoom.
    const worldX = target.x + m.anchor.ax / target.zoom;
    const worldY = target.y + m.anchor.ay / target.zoom;
    m.x = { x: worldX - m.anchor.ax / m.zoom.x, v: 0 };
    m.y = { x: worldY - m.anchor.ay / m.zoom.x, v: 0 };
    return { shown: { x: m.x.x, y: m.y.x, zoom: m.zoom.x }, moving: true };
  }

  // Pan.
  const omega = omegaForSettle(m.panSettleMs);
  for (const axis of ['x', 'y'] as const) {
    const t = target[axis];
    const s = m[axis];
    if (s.x === t && s.v === 0) continue;
    const next = stepSpring(s, t, omega, dt);
    // Settled when within a hundredth of a world pixel: under one device pixel at every level.
    if (Math.abs(next.x - t) < 0.01 && Math.abs(next.v) < 1) {
      m[axis] = { x: t, v: 0 };
      moving = true;
    } else {
      m[axis] = next;
      moving = true;
    }
  }

  return { shown: { x: m.x.x, y: m.y.x, zoom: m.zoom.x }, moving };
}

/**
 * Momentum after a released drag: the target keeps moving with a decaying velocity for at most
 * GLIDE_MS. Returns the advanced target; the caller clamps it to the board. Velocity in world
 * pixels per second.
 */
export function startGlide(m: MotionState, vx: number, vy: number): void {
  if (!Number.isFinite(vx) || !Number.isFinite(vy)) return;
  if (Math.hypot(vx, vy) < GLIDE_STOP_SPEED) return;
  m.glide = { vx, vy, msLeft: GLIDE_MS };
}

export function applyGlide(m: MotionState, target: Camera, dtMs: number): Camera {
  const g = m.glide;
  if (!g) return target;
  const dt = Math.min(g.msLeft, Math.max(0, dtMs));
  // Exponential decay with a time constant a quarter of the glide, so it is 2% of itself at the end.
  const tau = GLIDE_MS / 4;
  const k = Math.exp(-dt / tau);
  // Distance covered over dt by a velocity decaying from v to v·k: v·τ·(1 − k).
  const dx = g.vx * (tau / 1000) * (1 - k);
  const dy = g.vy * (tau / 1000) * (1 - k);
  g.vx *= k;
  g.vy *= k;
  g.msLeft -= dt;
  if (g.msLeft <= 0 || Math.hypot(g.vx, g.vy) < GLIDE_STOP_SPEED) m.glide = null;
  return { x: target.x + dx, y: target.y + dy, zoom: target.zoom };
}

export interface RenderPlan {
  /** The exact level the stage renders at. */
  level: Zoom;
  /** ≥ 1: how much the canvas element is scaled up by CSS to show the in-between zoom. */
  scale: number;
}

/** The largest exact level at or below the shown zoom, and the CSS scale that makes up the rest. */
export function renderPlan(shownZoom: number): RenderPlan {
  const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, shownZoom));
  let level: Zoom = ZOOM_LEVELS[0];
  for (const candidate of ZOOM_LEVELS) if (candidate <= z + 1e-9) level = candidate;
  const scale = z / level;
  return { level, scale: Math.abs(scale - 1) < 1e-6 ? 1 : scale };
}

/**
 * A layer's offset, in world pixels, that makes it move at `factor` of the camera while landing
 * on a whole device pixel. The stage sits at −round(cam·zoom); the layer's screen position is
 * that plus offset·zoom = −round(cam·zoom·factor), which is whole by construction.
 */
export function parallaxOffset(camWorld: number, zoom: number, factor: number): number {
  return (Math.round(camWorld * zoom) - Math.round(camWorld * zoom * factor)) / zoom;
}

/** The layers that sit below the components, and how much of the camera's motion they take. */
export const PARALLAX = { substrate: 0.94, parts: 0.97 } as const;
