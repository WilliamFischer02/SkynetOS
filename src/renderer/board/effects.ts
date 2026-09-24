/**
 * The animated effects a node can switch on, beyond the pulse glow and the text glow.
 *
 * William: "I want to add more checkboxes that enable different animated / visual effects like the
 * light pulse, and when those effects are enabled color and speed modifiers for the animation to add
 * graphical editability."
 *
 * Every effect here is whole pixels in one palette colour, drawn on a layer over the node, never a
 * gradient, a fade or a blend. That is docs/02 §Anti-mush, and it is also why the effects read as
 * part of the hardware rather than as a filter laid over it.
 *
 *   - **Chase**: a short run of lit pixels travelling clockwise round the node's frame, the way a
 *     marquee light or a status ring does.
 *   - **Scan**: a bright line sweeping down across the node's face and pausing below it, a CRT
 *     scanline or a sensor sweep.
 *
 * Speed is a multiplier, 0.25 to 4, with 1 the tuned default. Colour is a palette token resolved by
 * the caller against the room's theme.
 *
 * Pure: no Pixi, no DOM. test/effects.test.ts holds the geometry.
 */

export interface Rect { x: number; y: number; w: number; h: number }

/** How often the effect layer is redrawn. 20fps: smooth enough for a light, cheap enough for a board. */
export const EFFECT_FPS = 20;

/** Speed multipliers are clamped to this range, whatever the board file says. */
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4;

export function clampSpeed(speed: number | undefined): number {
  if (speed === undefined || !Number.isFinite(speed)) return 1;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));
}

/** Chase: px travelled per second at speed 1, how long the lit run is, and how thick. */
export const CHASE_PX_PER_SECOND = 48;
export const CHASE_LENGTH = 10;
export const CHASE_THICKNESS = 2;

/** Scan: px swept per second at speed 1, the pause below the node, and the line's thickness. */
export const SCAN_PX_PER_SECOND = 40;
export const SCAN_PAUSE_PX = 32;
export const SCAN_THICKNESS = 2;

/**
 * A point a distance `d` clockwise round the inside edge of a `w` x `h` box, starting at the top
 * left. The ring is inset by nothing: it runs along the node's own outermost pixels.
 */
export function perimeterPoint(w: number, h: number, d: number): { x: number; y: number } {
  const top = w - 1;
  const right = h - 1;
  const perimeter = 2 * top + 2 * right;
  if (perimeter <= 0) return { x: 0, y: 0 };
  let p = ((Math.floor(d) % perimeter) + perimeter) % perimeter;
  if (p < top) return { x: p, y: 0 };
  p -= top;
  if (p < right) return { x: top, y: p };
  p -= right;
  if (p < top) return { x: top - p, y: right };
  p -= top;
  return { x: 0, y: right - p };
}

/**
 * The lit pixels of a chase at time `t` seconds, relative to the node's top-left, as squares
 * `thickness` wide. The head is the leading square; the run trails behind it.
 */
export function chaseRects(
  w: number,
  h: number,
  t: number,
  speed = 1,
  length = CHASE_LENGTH,
  thickness = CHASE_THICKNESS
): Rect[] {
  if (w < thickness * 2 || h < thickness * 2) return [];
  // The ring is walked on a grid `thickness` pixels coarse, so the squares tile without overlap.
  const cols = Math.floor(w / thickness);
  const rows = Math.floor(h / thickness);
  const head = Math.floor(t * CHASE_PX_PER_SECOND * clampSpeed(speed) / thickness);
  const run = Math.max(1, Math.round(length / thickness));
  const out: Rect[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < run; i++) {
    const cell = perimeterPoint(cols, rows, head - i);
    const key = `${cell.x},${cell.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ x: cell.x * thickness, y: cell.y * thickness, w: thickness, h: thickness });
  }
  return out;
}

/**
 * The scan line at time `t` seconds, relative to the node's top-left, or null while it is paused
 * below the node. It sweeps top to bottom, then waits out `SCAN_PAUSE_PX` worth of travel before
 * the next sweep, so it reads as a periodic sweep rather than a constant stripe.
 */
export function scanRect(w: number, h: number, t: number, speed = 1, thickness = SCAN_THICKNESS): Rect | null {
  if (w <= 0 || h <= thickness) return null;
  const cycle = h + SCAN_PAUSE_PX;
  const y = Math.floor(t * SCAN_PX_PER_SECOND * clampSpeed(speed)) % cycle;
  if (y > h - thickness) return null;
  return { x: 0, y, w, h: thickness };
}

/**
 * How far a glow cycle has advanced, for a node with its own speed. `frames` is the cycle length
 * and `fps` its base rate; the result is the frame to show at `t` seconds.
 */
export function cycleFrame(t: number, fps: number, frames: number, speed = 1): number {
  if (frames <= 0) return 0;
  return Math.floor(t * fps * clampSpeed(speed)) % frames;
}
