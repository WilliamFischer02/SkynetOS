/**
 * Silkscreen text.
 *
 * docs/02 anti-mush rule 8: text is bitmap, no sub-pixel antialiasing. Departure Mono is a pixel
 * font and renders crisp at its design size, but canvas text rasterisation is still free to lay
 * down partial-alpha edge pixels depending on the platform's font stack — and rule 1 says every
 * pixel is alpha 0 or alpha 255, full stop.
 *
 * So we do not trust the rasteriser: draw the glyphs, then threshold the alpha channel to binary
 * and force every surviving pixel to one exact palette colour. Whatever canvas does, what comes
 * out of here is palette-clean and hard-edged by construction.
 */

import { SILK } from '@shared/palette.js';

/** Departure Mono is pixel-perfect only at multiples of 11. docs/02 §Grid & sizes. */
export type SilkSize = 11 | 22;

export const SILK_FONT_FAMILY = 'Departure Mono';

let fontReady: Promise<void> | null = null;

/**
 * Load the font once. Everything that measures or draws text must await this first — measuring
 * before the face is ready silently falls back to the generic monospace metrics and every label
 * comes out the wrong width.
 */
export function ensureSilkFont(fontUrl: string): Promise<void> {
  if (fontReady) return fontReady;
  fontReady = (async () => {
    const face = new FontFace(SILK_FONT_FAMILY, `url(${JSON.stringify(fontUrl)})`);
    await face.load();
    document.fonts.add(face);
    // Chromium wants an explicit load at each size it will actually rasterise.
    await Promise.all([
      document.fonts.load(`11px "${SILK_FONT_FAMILY}"`),
      document.fonts.load(`22px "${SILK_FONT_FAMILY}"`)
    ]);
  })();
  return fontReady;
}

function newCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  return canvas;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas context unavailable — cannot rasterise silkscreen text');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/**
 * Force every pixel to either fully transparent or exactly `hex`. This is the step that makes
 * the output pass `npm run validate:assets`-equivalent purity regardless of the rasteriser.
 */
function thresholdToColor(ctx: CanvasRenderingContext2D, w: number, h: number, hex: string): void {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    if ((d[i + 3] ?? 0) >= 128) {
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    } else {
      d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 0;
    }
  }
  ctx.putImageData(image, 0, 0);
}

export interface SilkTextResult {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

/**
 * Rasterise a line of silkscreen. Returns a canvas with binary alpha and exactly one colour.
 * Board copy is engraved industrial labelling, so callers pass already-uppercased strings.
 */
export function renderSilkText(text: string, size: SilkSize = 11, color: string = SILK): SilkTextResult {
  const font = `${size}px "${SILK_FONT_FAMILY}", monospace`;

  const measureCanvas = newCanvas(1, 1);
  const measureCtx = context2d(measureCanvas);
  measureCtx.font = font;
  const metrics = measureCtx.measureText(text);

  // Integer box. Departure Mono's ascent/descent at 11px fit inside 1.5x the em with room to spare.
  const width = Math.max(1, Math.ceil(metrics.width));
  const ascent = Math.ceil(metrics.actualBoundingBoxAscent || size);
  const descent = Math.ceil(metrics.actualBoundingBoxDescent || 0);
  const height = Math.max(1, ascent + descent);

  const canvas = newCanvas(width, height);
  const ctx = context2d(canvas);
  ctx.font = font;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  // Integer baseline: a fractional one is where half-lit rows come from.
  ctx.fillText(text, 0, ascent);

  thresholdToColor(ctx, width, height, color);
  return { canvas, width, height };
}

/** Width of a string in pixels at a given silkscreen size, without drawing it. */
export function measureSilkText(text: string, size: SilkSize = 11): number {
  const ctx = context2d(newCanvas(1, 1));
  ctx.font = `${size}px "${SILK_FONT_FAMILY}", monospace`;
  return Math.ceil(ctx.measureText(text).width);
}
