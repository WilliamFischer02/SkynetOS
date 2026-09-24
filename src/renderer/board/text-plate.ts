import { COPPER_DARK, brighten, resolveToken } from '@shared/palette.js';
import type { BoardNode, BoardTheme } from '@shared/types.js';
import { renderSilkText, type SilkSize } from './silkscreen.js';

/**
 * Silkscreen text with an optional plate behind it: colour, outline, a rounded box, and a pulse.
 *
 * ── Why a plate at all ────────────────────────────────────────────────────────────────────────
 *
 * William: "add the ability to add a text box behind text nodes like the u1 jurisdiction text -
 * make it a rounded pixel art box that adjusts to text length."
 *
 * `U1 — PRIMARY JURISDICTION: ALL` was printed straight onto the substrate, so it collided with
 * traces, backdrops and couriers passing underneath and became unreadable exactly where the board
 * was busiest. A plate is what a real board does: it leaves bare mask under a printed legend.
 *
 * ── What "rounded" means at this size ─────────────────────────────────────────────────────────
 *
 * Not a border-radius. At 1:1 a corner radius is a decision about ONE pixel, so the plate simply
 * omits its four corner pixels and steps the border in by one — the standard pixel-art rounded
 * box. Anything smoother is anti-aliasing, which docs/02 forbids.
 *
 * ── Sizing ────────────────────────────────────────────────────────────────────────────────────
 *
 * The plate is measured from the rendered text, every time, so it "adjusts to text length" by
 * construction rather than by anyone maintaining a width. Multi-line text is supported: `\n`
 * splits, and the plate takes the widest line.
 */

export const PLATE_PAD_X = 4;
export const PLATE_PAD_Y = 3;
/** Gap between lines, in px. One row of clearance reads as a paragraph, not as a double space. */
export const LINE_GAP = 2;

export interface TextRender {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

export interface TextStyle {
  size: SilkSize;
  /** Resolved hex, already looked up from the node's token against the room theme. */
  color: string;
  /** Resolved hex for a 1px outline around every glyph, or null for none. */
  stroke: string | null;
  /** Draw the plate behind the text. */
  plate: boolean;
  /** Resolved hex for the plate's fill and its border. */
  plateFill: string;
  plateBorder: string;
}

/** Turn a node's fields into a resolved style. One place, so notes and nameplates agree. */
export function styleForNode(node: BoardNode, theme: BoardTheme, defaultSize: SilkSize = 11): TextStyle {
  const color = resolveToken(node.textColor, theme);
  return {
    size: node.size === 22 ? 22 : defaultSize,
    color,
    stroke: node.textStroke ? resolveToken(node.textStroke, theme, COPPER_DARK) : null,
    plate: node.textPlate === true,
    plateFill: resolveToken(node.plateColor, theme, theme.maskDark),
    plateBorder: resolveToken(node.plateBorder, theme, COPPER_DARK)
  };
}

/**
 * Draw the plate: a filled box with a 1px border and its four corner pixels omitted.
 *
 * The border is drawn as four filled rects rather than a strokeRect. A 1px stroke straddles the
 * pixel boundary and lands as two half-lit rows — the same reason `buildZone` does it this way.
 */
export function drawPlate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  border: string
): void {
  if (w < 4 || h < 4) return;

  ctx.fillStyle = fill;
  // The body, inset by one pixel at each end of each edge — which is what leaves the corners bare.
  ctx.fillRect(x + 1, y, w - 2, h);
  ctx.fillRect(x, y + 1, w, h - 2);

  ctx.fillStyle = border;
  ctx.fillRect(x + 1, y, w - 2, 1);
  ctx.fillRect(x + 1, y + h - 1, w - 2, 1);
  ctx.fillRect(x, y + 1, 1, h - 2);
  ctx.fillRect(x + w - 1, y + 1, 1, h - 2);
  // The single stepped pixel at each corner. This is the whole of "rounded" at 1:1.
  ctx.fillRect(x + 1, y + 1, 1, 1);
  ctx.fillRect(x + w - 2, y + 1, 1, 1);
  ctx.fillRect(x + 1, y + h - 2, 1, 1);
  ctx.fillRect(x + w - 2, y + h - 2, 1, 1);
}

/**
 * Render one block of silkscreen text, with plate, stroke and colour applied.
 *
 * `glowStep` shifts the text colour up the room's ramp — 0 is the node's own colour, 1 and 2 are
 * one and two rungs brighter. Cycling it is the text equivalent of the wallpaper pulse glow, and
 * it is a palette shift for the same reason: docs/02 has no room for a translucent halo.
 */
export function renderTextBlock(
  text: string,
  style: TextStyle,
  theme: BoardTheme,
  glowStep = 0,
  /** The colour at the glow's peak (step 2), as hex, when the node names one (`textGlowColor`). */
  crest?: string
): TextRender | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return null;

  const color = glowStep >= 2 && crest ? crest : glowStep > 0 ? brighten(style.color, glowStep, theme) : style.color;
  const rendered = lines.map((line) => renderSilkText(line, style.size, color));
  const textW = rendered.reduce((max, r) => Math.max(max, r.width), 1);
  const textH = rendered.reduce((sum, r) => sum + r.height, 0) + LINE_GAP * (rendered.length - 1);

  // A stroke needs a pixel of room on every side, or the outline is clipped by the canvas edge.
  const strokePad = style.stroke ? 1 : 0;
  const padX = (style.plate ? PLATE_PAD_X : 0) + strokePad;
  const padY = (style.plate ? PLATE_PAD_Y : 0) + strokePad;

  const width = textW + padX * 2;
  const height = textH + padY * 2;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;

  if (style.plate) drawPlate(ctx, 0, 0, width, height, style.plateFill, style.plateBorder);

  /*
   * The outline: the same glyphs stamped eight times, one pixel out in each direction, in the
   * stroke colour — then the real text on top.
   *
   * Crude, exact, and entirely whole pixels, which is the only kind of outline this board can
   * have. `ctx.strokeText` and `shadowBlur` both anti-alias, and `renderSilkText` thresholds
   * alpha to binary and forces one exact colour, so re-rendering in the stroke colour is what
   * keeps the outline palette-legal rather than a tinted blur.
   */
  if (style.stroke) {
    let sy = padY;
    for (const line of lines) {
      const outline = renderSilkText(line, style.size, style.stroke);
      const sx = padX + Math.floor((textW - outline.width) / 2);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.drawImage(outline.canvas, sx + (dx as number), sy + (dy as number));
      }
      sy += outline.height + LINE_GAP;
    }
  }

  let y = padY;
  for (const line of rendered) {
    ctx.drawImage(line.canvas, padX + Math.floor((textW - line.width) / 2), y);
    y += line.height + LINE_GAP;
  }

  return { canvas, width, height };
}

/**
 * The size a node's text block will occupy, without drawing it.
 *
 * Used for hit-testing, so a text node's grab box is its real extent rather than an estimate.
 * William: "the bounding boxes of the text node does not expand to fit the text within."
 */
export function measureTextBlock(node: BoardNode, theme: BoardTheme): { w: number; h: number } {
  const style = styleForNode(node, theme);
  const text = (node.text ?? node.name ?? '').trim();
  const block = renderTextBlock(text, style, theme);
  return block ? { w: block.width, h: block.height } : { w: 16, h: 16 };
}
