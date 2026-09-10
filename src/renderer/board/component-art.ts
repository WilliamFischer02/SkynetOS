import type { NodeKind } from '@shared/types.js';
import { COPPER, COPPER_DARK, SILK } from '@shared/palette.js';

/**
 * Per-kind component silhouettes.
 *
 * Every node used to be the same rectangle with a different label, so a board was a wall of
 * identical boxes and you had to read every one to know what it was. A real board is legible at a
 * glance because the PACKAGES differ — a DIP does not look like a drive does not like a connector.
 * That difference is what this file draws.
 *
 * These are drawn from the locked palette rather than lifted from a vendor sheet. The sheets in
 * `assets/vendor/` are a roguelike pack with no circuit components in them at all (see
 * `assets/vendor/kenney_1-bit-pack/SOURCE.md`), so an honest kitbash of a DIP or an HDD is not
 * available from what is on disk — and `docs/05` is explicit that a labelled rectangle beats a bad
 * kitbash. What IS available is the component vocabulary in `docs/02`, drawn straight.
 *
 * Everything here obeys the same rules as the rest of the board: flat fills, whole pixels, no
 * diagonals, no gradients, and only colours from `skynet.gpl`.
 */

export interface ComponentStyle {
  /** How the package body is drawn. */
  silhouette:
    | 'dip'        // agent.code — a chip with pin legs down each side
    | 'qfp'        // agent.chat — leads on all four sides, a heat-spreader lid
    | 'cpu'        // agent.jarvis — big socketed CPU with a pad array
    | 'drive'      // store.repo / store.folder — a drive with a label plate
    | 'ssd'        // drive.room — an M.2 module with a shield can
    | 'eprom'      // file.document — an EPROM with a paper label window
    | 'switch'     // file.exe — a push-button switch with a cap
    | 'cartridge'  // file.artifact — a removable cartridge with connector fingers
    | 'jack'       // link.url / store.cloud — an RJ45 jack
    | 'vreg'       // service.process — a voltage regulator with a tab
    | 'crystal'    // task.scheduled — a crystal oscillator can
    | 'psu'        // monitor.system — a PSU block with gauges
    | 'plain';     // anything without a vocabulary entry yet
  /** Inset of the body from the footprint edge, in px. Leaves room for legs. */
  inset: number;
}

export const COMPONENT_STYLE: Record<NodeKind, ComponentStyle> = {
  'agent.code': { silhouette: 'dip', inset: 4 },
  'agent.chat': { silhouette: 'qfp', inset: 4 },
  'agent.jarvis': { silhouette: 'cpu', inset: 3 },
  'drive.room': { silhouette: 'ssd', inset: 2 },
  'store.repo': { silhouette: 'drive', inset: 2 },
  'store.folder': { silhouette: 'drive', inset: 2 },
  'store.cloud': { silhouette: 'jack', inset: 2 },
  'file.document': { silhouette: 'eprom', inset: 2 },
  'file.exe': { silhouette: 'switch', inset: 2 },
  'file.artifact': { silhouette: 'cartridge', inset: 2 },
  'link.url': { silhouette: 'jack', inset: 2 },
  'service.process': { silhouette: 'vreg', inset: 2 },
  'task.scheduled': { silhouette: 'crystal', inset: 1 },
  'monitor.system': { silhouette: 'psu', inset: 2 },
  'note.silk': { silhouette: 'plain', inset: 0 },
  'group.zone': { silhouette: 'plain', inset: 0 },
  // Nothing to draw: a decor.image with no picture is an empty frame, which is exactly right.
  'decor.image': { silhouette: 'plain', inset: 0 },
  // Never drawn: a decor.part's art comes from the atlas, not from this file.
  'decor.part': { silhouette: 'plain', inset: 0 }
};

export interface DrawContext {
  ctx: CanvasRenderingContext2D;
  /** Footprint area to draw the package into, in px. */
  x: number;
  y: number;
  w: number;
  h: number;
  maskLight: string;
  /** The room's signal colour, for the one accent each package is allowed. */
  signal: string;
}

const px = (ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number): void => {
  if (w <= 0 || h <= 0) return;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
};

/** A filled box with a 1px silk edge and a copper-dark bevel on the bottom-right. */
function body(d: DrawContext, x: number, y: number, w: number, h: number, fill?: string): void {
  px(d.ctx, fill ?? d.maskLight, x, y, w, h);
  px(d.ctx, SILK, x, y, w, 1);
  px(d.ctx, SILK, x, y + h - 1, w, 1);
  px(d.ctx, SILK, x, y, 1, h);
  px(d.ctx, SILK, x + w - 1, y, 1, h);
  px(d.ctx, COPPER_DARK, x + 1, y + h - 2, w - 2, 1);
  px(d.ctx, COPPER_DARK, x + w - 2, y + 1, 1, h - 2);
}

/**
 * A 1px outline. THE most important helper in this file.
 *
 * The first version of these silhouettes used copper as a FILL — a shield can was a solid
 * copper-dark rectangle covering the whole package, a drive's label plate was a solid bar. On
 * screen every component came out as a brown slab and the board looked worse than the plain
 * rectangles it replaced. docs/02 is explicit about what copper is for: "traces, pads, pin legs,
 * connector fingers". It is an EDGE colour, not a surface colour. Package bodies stay mask-light;
 * copper draws their detail.
 */
function outline(d: DrawContext, color: string, x: number, y: number, w: number, h: number): void {
  if (w <= 0 || h <= 0) return;
  px(d.ctx, color, x, y, w, 1);
  px(d.ctx, color, x, y + h - 1, w, 1);
  px(d.ctx, color, x, y, 1, h);
  px(d.ctx, color, x + w - 1, y, 1, h);
}

/** Evenly spaced pin legs along one edge. The thing that makes a chip read as a chip. */
function legs(
  d: DrawContext,
  edge: 'left' | 'right' | 'top' | 'bottom',
  x: number, y: number, w: number, h: number,
  length: number
): void {
  const pitch = 6;
  const thickness = 2;
  if (edge === 'left' || edge === 'right') {
    const lx = edge === 'left' ? x - length : x + w;
    for (let py = y + 4; py <= y + h - 4 - thickness; py += pitch) px(d.ctx, COPPER, lx, py, length, thickness);
  } else {
    const ly = edge === 'top' ? y - length : y + h;
    for (let pxx = x + 4; pxx <= x + w - 4 - thickness; pxx += pitch) px(d.ctx, COPPER, pxx, ly, thickness, length);
  }
}

/**
 * Draw a package. The area given is the node's footprint; the package insets itself so its legs,
 * fingers or tab have somewhere to live without leaving the footprint.
 *
 * Discipline, learned by getting it wrong once: the body is mask-light, and copper appears only
 * as outlines, pads, legs and fingers. Large copper fills turn the board into a wall of brown.
 */
export function drawComponent(d: DrawContext, style: ComponentStyle): void {
  const i = style.inset;
  const bx = d.x + i;
  const by = d.y + i;
  const bw = d.w - i * 2;
  const bh = d.h - i * 2;
  if (bw <= 2 || bh <= 2) { body(d, d.x, d.y, d.w, d.h); return; }

  switch (style.silhouette) {
    case 'dip': {
      body(d, bx, by, bw, bh);
      legs(d, 'left', bx, by, bw, bh, i);
      legs(d, 'right', bx, by, bw, bh, i);
      // Pin-1 notch on the top edge — how you orient a real DIP.
      px(d.ctx, COPPER_DARK, bx + Math.floor(bw / 2) - 2, by + 1, 4, 2);
      break;
    }
    case 'qfp': {
      body(d, bx, by, bw, bh);
      for (const edge of ['left', 'right', 'top', 'bottom'] as const) legs(d, edge, bx, by, bw, bh, i);
      // Heat-spreader lid as an outline, which is what makes a QFP read as senior to a DIP.
      outline(d, COPPER, bx + 4, by + 4, bw - 8, bh - 8);
      px(d.ctx, COPPER_DARK, bx + 6, by + 6, 2, 2);
      break;
    }
    case 'cpu': {
      body(d, bx, by, bw, bh);
      for (const edge of ['left', 'right', 'top', 'bottom'] as const) legs(d, edge, bx, by, bw, bh, i);
      // Gold pad array — sparse dots, the only pad array on the board.
      for (let py = by + 7; py < by + bh - 7; py += 6) {
        for (let pxx = bx + 7; pxx < bx + bw - 7; pxx += 6) px(d.ctx, COPPER, pxx, py, 2, 2);
      }
      // Socket key in the corner, so it has an orientation like the real thing.
      px(d.ctx, d.signal, bx + 3, by + 3, 3, 3);
      break;
    }
    case 'drive': {
      body(d, bx, by, bw, bh);
      // Label plate: an outlined strip across the top, not a solid bar.
      outline(d, COPPER, bx + 3, by + 3, bw - 6, Math.max(4, Math.floor(bh / 4)));
      // Platter: a ring, drawn as two nested outlines. Rectangles only — no diagonals.
      const r = Math.max(4, Math.floor(Math.min(bw, bh) / 4));
      const cx = bx + Math.floor(bw / 2) - r;
      const cy = by + Math.floor(bh * 0.62) - Math.floor(r / 2);
      outline(d, COPPER, cx, cy, r * 2, r);
      px(d.ctx, COPPER_DARK, cx + r - 1, cy + Math.floor(r / 2) - 1, 2, 2);
      // Actuator arm, parked off to one side.
      px(d.ctx, SILK, cx + r * 2 - 1, cy + 1, 1, r - 2);
      break;
    }
    case 'ssd': {
      body(d, bx, by, bw, bh);
      // Shield can as an OUTLINE with screws — a filled can covered the entire module.
      outline(d, COPPER, bx + 3, by + 3, bw - 6, bh - 6);
      const screws: [number, number][] = [
        [bx + 5, by + 5], [bx + bw - 7, by + 5],
        [bx + 5, by + bh - 7], [bx + bw - 7, by + bh - 7]
      ];
      for (const [sx, sy] of screws) px(d.ctx, COPPER_DARK, sx, sy, 2, 2);
      // Edge connector on the left: this is what says "it slots into something".
      for (let py = by + 6; py < by + bh - 6; py += 5) px(d.ctx, COPPER, bx - i, py, i + 2, 2);
      break;
    }
    case 'eprom': {
      body(d, bx, by, bw, bh);
      legs(d, 'left', bx, by, bw, bh, i);
      legs(d, 'right', bx, by, bw, bh, i);
      // The quartz window an EPROM is known for: a silk-edged opening, not a filled block.
      const wh = Math.max(3, Math.floor(bh / 3));
      outline(d, SILK, bx + 3, by + 3, bw - 6, wh);
      px(d.ctx, COPPER_DARK, bx + 5, by + 5, bw - 10, Math.max(1, wh - 4));
      break;
    }
    case 'switch': {
      body(d, bx, by, bw, bh);
      // Translucent cap: a raised inner square in signal, which lights while the process lives.
      const cw = Math.max(4, bw - 10);
      const ch = Math.max(4, bh - 10);
      const cxs = bx + Math.floor((bw - cw) / 2);
      const cys = by + Math.floor((bh - ch) / 2);
      outline(d, d.signal, cxs, cys, cw, ch);
      px(d.ctx, d.signal, cxs + 2, cys + 2, cw - 4, ch - 4);
      px(d.ctx, COPPER_DARK, cxs, cys + ch - 1, cw, 1);
      break;
    }
    case 'cartridge': {
      body(d, bx, by, bw, bh);
      // Connector fingers along the bottom — visually, the drag handle.
      for (let pxx = bx + 3; pxx < bx + bw - 3; pxx += 4) px(d.ctx, COPPER, pxx, by + bh - 5, 2, 4);
      // Grip ridges along the top.
      for (let pxx = bx + 4; pxx < bx + bw - 4; pxx += 3) px(d.ctx, COPPER_DARK, pxx, by + 2, 1, 3);
      break;
    }
    case 'jack': {
      body(d, bx, by, bw, bh);
      // RJ45 mouth: an outlined opening with contacts across the top of it.
      outline(d, COPPER, bx + 2, by + 4, bw - 4, bh - 6);
      for (let pxx = bx + 4; pxx < bx + bw - 4; pxx += 3) px(d.ctx, COPPER, pxx, by + 5, 1, 3);
      // Latch tab.
      px(d.ctx, SILK, bx + Math.floor(bw / 2) - 2, by + 1, 4, 3);
      break;
    }
    case 'vreg': {
      body(d, bx, by, bw, bh);
      // Metal tab across the top, outlined, with its mounting hole.
      const th = Math.max(4, Math.floor(bh / 3));
      outline(d, SILK, bx + 2, by + 2, bw - 4, th);
      px(d.ctx, COPPER_DARK, bx + Math.floor(bw / 2) - 1, by + 3, 2, 2);
      // Three legs, because that is what a regulator has.
      const quarter = Math.max(2, Math.floor(bw / 4));
      for (let k = 1; k <= 3; k++) px(d.ctx, COPPER, bx + quarter * k - 1, by + bh, 2, i);
      break;
    }
    case 'crystal': {
      // A metal can: stepped corners rather than a curve, because diagonals are forbidden.
      px(d.ctx, d.maskLight, bx + 1, by, bw - 2, bh);
      px(d.ctx, d.maskLight, bx, by + 1, bw, bh - 2);
      outline(d, COPPER, bx, by + 1, bw, bh - 2);
      px(d.ctx, COPPER, bx + 1, by, bw - 2, 1);
      px(d.ctx, COPPER, bx + 1, by + bh - 1, bw - 2, 1);
      px(d.ctx, COPPER_DARK, bx + 3, by + Math.floor(bh / 2), bw - 6, 1);
      break;
    }
    case 'psu': {
      body(d, bx, by, bw, bh);
      // Three gauges, outlined, each with a signal-coloured needle bar.
      const gw = Math.max(4, Math.floor((bw - 10) / 3));
      for (let k = 0; k < 3; k++) {
        const gx = bx + 4 + k * (gw + 1);
        const gh = bh - 10;
        outline(d, COPPER, gx, by + 4, gw, gh);
        px(d.ctx, d.signal, gx + 1, by + 4 + gh - 2 - Math.floor((gh - 4) * (0.3 + k * 0.2)), gw - 2, 2);
      }
      // Vent slots along the bottom.
      for (let pxx = bx + 4; pxx < bx + bw - 4; pxx += 3) px(d.ctx, COPPER_DARK, pxx, by + bh - 4, 1, 2);
      break;
    }
    case 'plain':
    default:
      body(d, bx, by, bw, bh);
      break;
  }
}
