import { COPPER, COPPER_DARK, SILK, hexToRgb } from '@shared/palette.js';
import type { BoardTheme } from '@shared/types.js';

/**
 * The pulse glow: energy travelling outward from a node's centre.
 *
 * William: "certain background images I want to have an animated pulsing glow as if energy is
 * flowing in them from their center outwards specifically."
 *
 * ── Why it is not a glow ──────────────────────────────────────────────────────────────────────
 *
 * The obvious implementation is a radial gradient at low opacity, animated. That is four separate
 * violations of docs/02 in one line: a gradient, partial alpha, off-palette colours, and a soft
 * edge. On this board it would look like a smear of light sitting on top of pixel art, which is
 * exactly the mush the whole project is organised against.
 *
 * So the glow is a PALETTE SHIFT instead. The room's six colours are already a brightness ramp —
 * mask-dark at the shadows, silk at the highlights — and the mosaic pipeline has already reduced
 * every image to exactly those six. An expanding ring simply pushes the pixels it passes over one
 * or two steps UP that ramp and lets them fall back as it leaves.
 *
 * Nothing is blended, nothing is translucent, every frame contains exactly the same six colours
 * the image already had, and the wave is made of whole pixels. It reads as charge moving through
 * the material rather than as light shining on it — which is what was asked for, and it happens to
 * be the only version of it this board can legally draw.
 *
 * Frames are built once per image and cycled, because doing this per frame for a 320x224 backdrop
 * at 60fps is ~4M pixel operations a second for decoration.
 */

/** How many frames one full pulse takes. 16 at 12fps is a wave every 1.3s — a heartbeat, not a strobe. */
export const GLOW_FRAMES = 16;

/** Frames per second the cycle advances at. */
export const GLOW_FPS = 12;

/** Width of the travelling band, as a fraction of the node's half-diagonal. */
const BAND = 0.22;

/**
 * The room's six colours, sorted dark to light.
 *
 * The same ramp `themeRamp` builds in src/main/services/mosaic.ts, and it has to stay the same
 * one: these frames are shifts along the exact ladder the mosaic was quantised onto. A different
 * ordering here would map a pixel to a colour the dither never intended and the image would
 * change hue as the wave passed, rather than brighten.
 */
export function rampFor(theme: BoardTheme): [number, number, number][] {
  const luma = (c: [number, number, number]): number => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  return [theme.maskDark, theme.maskLight, COPPER_DARK, COPPER, theme.signal, SILK]
    .map((hex) => hexToRgb(hex))
    .sort((a, b) => luma(a) - luma(b));
}

/** Nearest ramp index for a pixel, by exact match first and then by distance. */
function rampIndex(ramp: [number, number, number][], r: number, g: number, b: number): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < ramp.length; i++) {
    const c = ramp[i]!;
    if (c[0] === r && c[1] === g && c[2] === b) return i;
    const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
    if (d < bestDistance) { bestDistance = d; best = i; }
  }
  return best;
}

/**
 * Build one pulse cycle for an already-dithered image.
 *
 * Returns GLOW_FRAMES canvases, each the same size as the source. Frame 0 has the wave at the
 * centre; by the last frame it has passed the corners and the image is back to itself, so the
 * cycle loops without a seam.
 */
export function buildGlowFrames(
  source: HTMLImageElement,
  theme: BoardTheme
): HTMLCanvasElement[] {
  const width = source.width;
  const height = source.height;
  if (!width || !height) return [];

  const read = document.createElement('canvas');
  read.width = width;
  read.height = height;
  const readCtx = read.getContext('2d', { willReadFrequently: true });
  if (!readCtx) return [];
  readCtx.imageSmoothingEnabled = false;
  readCtx.drawImage(source, 0, 0);

  let pixels: ImageData;
  try {
    pixels = readCtx.getImageData(0, 0, width, height);
  } catch {
    // A tainted canvas cannot be read back. Mosaics are data: URLs so this should not happen,
    // but a glow that fails must degrade to a still image rather than to an exception.
    return [];
  }

  const ramp = rampFor(theme);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const maxRadius = Math.hypot(cx, cy);

  /*
   * Precompute the ramp index of every source pixel once. Recomputing the nearest-colour search
   * inside the frame loop would run it sixteen times per pixel for no reason — for a 320x224
   * backdrop that is 17 million distance calculations instead of one million.
   */
  const baseIndex = new Uint8Array(width * height);
  const radius = new Float32Array(width * height);
  const opaque = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const p = i * 4;
      opaque[i] = pixels.data[p + 3]! >= 128 ? 1 : 0;
      if (!opaque[i]) continue;
      baseIndex[i] = rampIndex(ramp, pixels.data[p]!, pixels.data[p + 1]!, pixels.data[p + 2]!);
      radius[i] = Math.hypot(x - cx, y - cy) / maxRadius;
    }
  }

  const frames: HTMLCanvasElement[] = [];
  const top = ramp.length - 1;

  for (let frame = 0; frame < GLOW_FRAMES; frame++) {
    // The wave front travels from the centre out past the corner, so the last frames are calm.
    const front = (frame / GLOW_FRAMES) * (1 + BAND * 2) - BAND;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) break;
    const out = ctx.createImageData(width, height);

    for (let i = 0; i < width * height; i++) {
      const p = i * 4;
      if (!opaque[i]) { out.data[p + 3] = 0; continue; }

      /*
       * Distance from the wave front, in band widths. Two steps up at the crest and one on the
       * shoulders — a hard two-level step rather than a smooth falloff, because the ramp only has
       * six rungs and anything finer would just round to the same colours anyway.
       */
      const distance = Math.abs(radius[i]! - front) / BAND;
      const lift = distance < 0.45 ? 2 : distance < 1 ? 1 : 0;

      const c = ramp[Math.min(top, baseIndex[i]! + lift)]!;
      out.data[p] = c[0];
      out.data[p + 1] = c[1];
      out.data[p + 2] = c[2];
      out.data[p + 3] = 255;
    }

    ctx.putImageData(out, 0, 0);
    /*
     * The placeholder texture cache keys on the face, and a canvas has no `src`. Without a stamp
     * every frame of a cycle would hash identically, the cache would return frame 0 forever, and
     * the pulse would be a still image that cost sixteen canvases to produce.
     */
    canvas.dataset['glowKey'] = `${width}x${height}:${frame}`;
    frames.push(canvas);
  }

  return frames;
}
