/**
 * A room's overall look: whole-board colour, a dithered vignette, and a tiled background.
 *
 * William: "add overall board effects / color scheme customizations that render the board in its
 * entirety with a filtered hue adjustment, add a vignette option and add the ability to select an
 * image that is a perfect square and that image can be tiled as the board background, or else it
 * defaults to what it already is. enable background image tile is a toggle."
 *
 * Pure: no DOM, no Pixi, no Electron. The renderer, main and the tests all read the same limits.
 *
 * The rule that holds throughout: a look with nothing set is today's board, pixel for pixel. Every
 * field is optional, `cleanLook` drops the ones sitting at their defaults, and an empty look is
 * removed from the board file altogether rather than stored as `{}`.
 */

import type { BoardLook } from './types.js';
import { isWireToken } from './palette.js';

export const LOOK_LIMITS = {
  hue: { min: -180, max: 180, neutral: 0 },
  saturation: { min: 0, max: 200, neutral: 100 },
  brightness: { min: 50, max: 150, neutral: 100 },
  contrast: { min: 50, max: 150, neutral: 100 },
  vignetteStrength: { min: 1, max: 4, neutral: 2 },
  tileScale: { min: 1, max: 4, neutral: 1 }
} as const;

type NumericKey = keyof typeof LOOK_LIMITS;

/** The numeric fields, clamped to their range and rounded to whole units. Non-numbers fall back. */
export function clampLookNumber(key: NumericKey, value: unknown): number {
  const { min, max, neutral } = LOOK_LIMITS[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return neutral;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Every field resolved: what the renderer actually draws with. */
export interface ResolvedLook {
  hue: number;
  saturation: number;
  brightness: number;
  contrast: number;
  vignette: boolean;
  vignetteStrength: number;
  vignetteColor: string;
  tileImage: string | null;
  tileEnabled: boolean;
  tileScale: number;
}

export function resolveLook(look: BoardLook | undefined | null): ResolvedLook {
  const l = look ?? {};
  return {
    hue: clampLookNumber('hue', l.hue),
    saturation: clampLookNumber('saturation', l.saturation),
    brightness: clampLookNumber('brightness', l.brightness),
    contrast: clampLookNumber('contrast', l.contrast),
    vignette: l.vignette === true,
    vignetteStrength: clampLookNumber('vignetteStrength', l.vignetteStrength),
    vignetteColor: l.vignetteColor && isWireToken(l.vignetteColor) ? l.vignetteColor : 'ink',
    tileImage: typeof l.tileImage === 'string' && l.tileImage.trim() ? l.tileImage.trim() : null,
    tileEnabled: l.tileEnabled === true,
    tileScale: clampLookNumber('tileScale', l.tileScale)
  };
}

/**
 * The look as it should be STORED: clamped, with every field at its default dropped, and null when
 * nothing is left. Null is what the command bus writes as "remove `look` from the board".
 *
 * The tile image survives with the toggle off: "enable background image tile is a toggle", so
 * switching it off and on again should not make you browse for the picture a second time.
 */
export function cleanLook(look: BoardLook | undefined | null): BoardLook | null {
  if (!look) return null;
  const r = resolveLook(look);
  const out: BoardLook = {};
  if (r.hue !== LOOK_LIMITS.hue.neutral) out.hue = r.hue;
  if (r.saturation !== LOOK_LIMITS.saturation.neutral) out.saturation = r.saturation;
  if (r.brightness !== LOOK_LIMITS.brightness.neutral) out.brightness = r.brightness;
  if (r.contrast !== LOOK_LIMITS.contrast.neutral) out.contrast = r.contrast;
  if (r.vignette) out.vignette = true;
  if (r.vignetteStrength !== LOOK_LIMITS.vignetteStrength.neutral) out.vignetteStrength = r.vignetteStrength;
  if (r.vignetteColor !== 'ink') out.vignetteColor = r.vignetteColor;
  if (r.tileImage) out.tileImage = r.tileImage;
  if (r.tileEnabled) out.tileEnabled = true;
  if (r.tileScale !== LOOK_LIMITS.tileScale.neutral) out.tileScale = r.tileScale;
  return Object.keys(out).length ? out : null;
}

/**
 * What `board.update` does to `look`, and its exact inverse. Pure, so the undo is testable without
 * a board file: applying `inverse` to the result gives back exactly what was there before,
 * including "absent" (null).
 */
export function applyLookPatch(
  current: BoardLook | undefined | null,
  requested: BoardLook | null
): { look: BoardLook | null; inverse: BoardLook | null; changed: boolean } {
  const before = cleanLook(current);
  const after = cleanLook(requested);
  return { look: after, inverse: before, changed: JSON.stringify(before) !== JSON.stringify(after) };
}

/**
 * The whole-board colour transform, as a CSS filter on the board canvas. Empty string when neutral,
 * so a default board carries no filter at all and costs nothing.
 *
 * Every function here is a per-pixel colour matrix: nothing is sampled from a neighbour, so a pixel
 * stays exactly where it was and exactly as sharp. What it does NOT do is keep the palette: a
 * hue-rotated copper is not copper. That is the point of the control, it is off by default, and
 * docs/02 records it as the one deliberate exception.
 */
export function lookFilter(look: BoardLook | undefined | null): string {
  const r = resolveLook(look);
  const parts: string[] = [];
  if (r.hue !== 0) parts.push(`hue-rotate(${r.hue}deg)`);
  if (r.saturation !== 100) parts.push(`saturate(${r.saturation}%)`);
  if (r.brightness !== 100) parts.push(`brightness(${r.brightness}%)`);
  if (r.contrast !== 100) parts.push(`contrast(${r.contrast}%)`);
  return parts.join(' ');
}

/* ─────────────────────────────── tiled background ─────────────────────────────── */

/** The largest tile, in board pixels. A bigger picture is downsampled to this before dithering. */
export const TILE_MAX_PX = 256;
/** The smallest tile. Anything smaller repeats so often it reads as noise rather than a pattern. */
export const TILE_MIN_PX = 8;

export type SquareCheck = { ok: true; size: number } | { ok: false; reason: string };

/** William: "an image that is a perfect square". Anything else is refused, with its size. */
export function squareCheck(width: number, height: number): SquareCheck {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return { ok: false, reason: 'NOT A DECODABLE IMAGE' };
  }
  if (width !== height) return { ok: false, reason: `NOT SQUARE — ${width}x${height}` };
  return { ok: true, size: width };
}

/** The tile's size on the board: the picture's own size, held between TILE_MIN_PX and TILE_MAX_PX. */
export function tileSourcePx(size: number): number {
  return Math.min(TILE_MAX_PX, Math.max(TILE_MIN_PX, Math.round(size)));
}

/* ─────────────────────────────────── vignette ─────────────────────────────────── */

/**
 * The 8x8 ordered-dither matrix. Thresholds 0..63; a pixel paints when its density beats its cell.
 * Ordered, not error-diffused, so the pattern is locked to the grid and does not crawl as the
 * window resizes.
 */
export const BAYER8: readonly number[] = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21
];

/** Where the darkening starts (as a fraction of the half-diagonal) and how dense the corners get. */
const VIGNETTE_STEPS: readonly { inner: number; corner: number }[] = [
  { inner: 0.95, corner: 0.5 },
  { inner: 0.85, corner: 0.65 },
  { inner: 0.75, corner: 0.8 },
  { inner: 0.65, corner: 1 }
];

/**
 * Coverage at a point, 0..1. `nx`, `ny` run -1..1 from the centre to the edges; the corners sit at
 * radius √2. Linear in radius past the inner edge, so the dither bands step evenly.
 */
export function vignetteDensity(nx: number, ny: number, strength: number): number {
  const step = VIGNETTE_STEPS[clampLookNumber('vignetteStrength', strength) - 1] ?? VIGNETTE_STEPS[1]!;
  const r = Math.hypot(nx, ny);
  if (r <= step.inner) return 0;
  const t = Math.min(1, (r - step.inner) / (Math.SQRT2 - step.inner));
  return t * step.corner;
}

/**
 * The vignette as a 1-bit mask, cols x rows, row-major: 1 means paint the vignette colour there.
 * Built once per resize or setting change, never per frame.
 */
export function vignetteMask(cols: number, rows: number, strength: number): Uint8Array {
  const w = Math.max(0, Math.floor(cols));
  const h = Math.max(0, Math.floor(rows));
  const mask = new Uint8Array(w * h);
  if (!w || !h) return mask;
  const cx = w / 2;
  const cy = h / 2;
  for (let y = 0; y < h; y++) {
    const ny = (y + 0.5 - cy) / cy;
    for (let x = 0; x < w; x++) {
      const d = vignetteDensity((x + 0.5 - cx) / cx, ny, strength);
      if (d <= 0) continue;
      const threshold = ((BAYER8[(y & 7) * 8 + (x & 7)] ?? 0) + 0.5) / 64;
      if (d > threshold) mask[y * w + x] = 1;
    }
  }
  return mask;
}

/**
 * The size of one vignette pixel on screen, in device pixels. Chunky enough to read as pixel art
 * rather than a soft shade, and an integer so the canvas scales by a whole number.
 */
export function vignetteCellPx(uiScale: number): number {
  return Math.max(2, Math.round(uiScale) * 3);
}
