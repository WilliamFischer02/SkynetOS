import type { NodeKind } from '@shared/types.js';
import { COPPER, COPPER_DARK, SILK } from '@shared/palette.js';
import type { NodeFrame } from '@shared/frames.js';
import { PROMPT_TO_NODE_TAB, promptLayout, type PromptLayout, type PromptRect } from '@shared/prompt.js';

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
    | 'prompt'     // agent.prompt — a pixel-art Claude message box
    | 'promptToNode' // agent.prompt-to-node — the same box, signal-framed, under a PROMPT → NODE tab
    | 'explorer'   // store.explorer — a little desktop window full of folders
    | 'plain';     // anything without a vocabulary entry yet
  /** Inset of the body from the footprint edge, in px. Leaves room for legs. */
  inset: number;
}

export const COMPONENT_STYLE: Record<NodeKind, ComponentStyle> = {
  'agent.code': { silhouette: 'dip', inset: 4 },
  // A drive under a chip: it reads as storage first, because that is what it works on.
  'agent.audit': { silhouette: 'drive', inset: 2 },
  'agent.chat': { silhouette: 'qfp', inset: 4 },
  'agent.jarvis': { silhouette: 'cpu', inset: 3 },
  // Inset 0: the box places itself with promptLayout, which the DOM overlay shares.
  'agent.prompt': { silhouette: 'prompt', inset: 0 },
  'agent.prompt-to-node': { silhouette: 'promptToNode', inset: 0 },
  'drive.room': { silhouette: 'ssd', inset: 2 },
  'store.repo': { silhouette: 'drive', inset: 2 },
  'store.folder': { silhouette: 'drive', inset: 2 },
  'store.explorer': { silhouette: 'explorer', inset: 2 },
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
    case 'prompt':
      drawPromptBox(d);
      break;
    case 'promptToNode':
      drawPromptToNode(d);
      break;
    case 'explorer': {
      body(d, bx, by, bw, bh);
      // Title bar: a signal strip with a close box — the one thing every desktop window had.
      const th = Math.max(3, Math.floor(bh / 6));
      px(d.ctx, d.signal, bx + 2, by + 2, bw - 4, th);
      px(d.ctx, COPPER_DARK, bx + bw - 2 - th, by + 2, th, th);
      // Folders in rows under it, each a tab and an outlined body. Rectangles only.
      for (let fy = by + th + 5; fy + 6 <= by + bh - 3; fy += 9) {
        for (let fx = bx + 4; fx + 8 <= bx + bw - 3; fx += 11) {
          px(d.ctx, COPPER, fx, fy, 4, 1);
          outline(d, COPPER, fx, fy + 1, 8, 5);
        }
      }
      break;
    }
    case 'plain':
    default:
      body(d, bx, by, bw, bh);
      break;
  }
}

/* ────────────────────────── the prompt box ────────────────────────── */

/** Stamp a little bitmap: `#` is a pixel, anything else is left alone. Clipped to `clip`. */
function glyph(ctx: CanvasRenderingContext2D, color: string, clip: PromptRect, rows: readonly string[]): void {
  const cols = Math.max(...rows.map((r) => r.length));
  const gx = clip.x + Math.floor((clip.w - cols) / 2);
  const gy = clip.y + Math.floor((clip.h - rows.length) / 2);
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const x = gx + c;
      const y = gy + r;
      if (row[c] !== '#' || x < clip.x || y < clip.y || x >= clip.x + clip.w || y >= clip.y + clip.h) continue;
      px(ctx, color, x, y, 1, 1);
    }
  });
}

/** A rounded rectangle in whole pixels: the corners stepped off, never curved. */
function roundedBox(ctx: CanvasRenderingContext2D, fill: string, edge: string, r: PromptRect): void {
  const { x, y, w, h } = r;
  if (w < 6 || h < 6) { px(ctx, fill, x, y, w, h); return; }
  px(ctx, fill, x + 2, y, w - 4, h);
  px(ctx, fill, x, y + 2, w, h - 4);
  px(ctx, fill, x + 1, y + 1, w - 2, h - 2);
  px(ctx, edge, x + 2, y, w - 4, 1);
  px(ctx, edge, x + 2, y + h - 1, w - 4, 1);
  px(ctx, edge, x, y + 2, 1, h - 4);
  px(ctx, edge, x + w - 1, y + 2, 1, h - 4);
  for (const [cx, cy] of [[x + 1, y + 1], [x + w - 2, y + 1], [x + 1, y + h - 2], [x + w - 2, y + h - 2]] as const) {
    px(ctx, edge, cx, cy, 1, 1);
  }
}

const PAPERCLIP = [
  '.###.',
  '#...#',
  '#.#.#',
  '#.#.#',
  '#.#.#',
  '#.#.#',
  '#.#.#',
  '.#.#.',
  '..#..'
] as const;

const SEND_ARROW = [
  '..#..',
  '.###.',
  '#.#.#',
  '..#..',
  '..#..',
  '..#..'
] as const;

/** Word lengths for the dim placeholder line — the shape of "How can I help you today?". */
const PLACEHOLDER_WORDS = [3, 3, 1, 4, 3, 6];

/**
 * The prompt node: a Claude-style message box, drawn in pixels.
 *
 * William: "the prompt box should be pixel art / mosaic rastered to look like a pixel art claude
 * prompt interface embedded in the board." A rounded box with a stepped-corner edge, a caret and a
 * dim placeholder line where the text goes, a paperclip bottom left and a filled send button bottom
 * right. The real textarea and buttons are DOM laid over exactly these pixels by
 * src/renderer/ui/PromptBoxes.tsx, using the same `promptLayout`. Below 1x zoom the overlay steps
 * aside and this drawing is all there is, which is why it has to read as a prompt box on its own.
 */
function drawPromptBox(d: DrawContext): void {
  drawPromptBody(d, promptLayout(d.w, d.h), SILK);
}

/**
 * The 5px-tall pixel letters the PROMPT → NODE tab is lettered in. Only the glyphs that label
 * needs. Drawn like PAPERCLIP: whole pixels, one palette colour, exact at every zoom, which the
 * chrome font could not be at 1x inside a 12px tab.
 */
const MICRO_FONT: Record<string, readonly string[]> = {
  P: ['##.', '#.#', '##.', '#..', '#..'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  '→': ['..#..', '...#.', '#####', '...#.', '..#..'],
  ' ': ['..', '..', '..', '..', '..']
};

/** Letter a line of MICRO_FONT from (x, y), one pixel between glyphs, clipped at `maxX`. */
function microText(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, text: string, maxX: number): void {
  let cx = x;
  for (const ch of text) {
    const rows = MICRO_FONT[ch] ?? MICRO_FONT[' ']!;
    const width = rows[0]?.length ?? 2;
    rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        if (row[c] === '#' && cx + c < maxX) px(ctx, color, cx + c, y + r, 1, 1);
      }
    });
    cx += width + 1;
  }
}

/** "Build": a plus in a square. The tab's icon, beside the words. */
const BUILD_GLYPH = [
  '#######',
  '#.....#',
  '#..#..#',
  '#.###.#',
  '#..#..#',
  '#.....#',
  '#######'
] as const;

const PROMPT_TO_NODE_LABEL = 'PROMPT → NODE';

/**
 * PROMPT → NODE: the message box, framed in the room's signal colour instead of silk, under a signal
 * folder tab lettered PROMPT → NODE with a build glyph.
 *
 * William: "add titling elements that show a prompt to node isn't a regular node." Two tells, both
 * drawn here so they survive every zoom, including below 1x where the overlay hides: the tab, and
 * the frame colour. The tab runs down over the box's top edge, so the two read as one part.
 */
function drawPromptToNode(d: DrawContext): void {
  const layout = promptLayout(d.w, d.h, { tab: PROMPT_TO_NODE_TAB });
  drawPromptBody(d, layout, d.signal);

  const tab = { x: d.x + layout.tab.x, y: d.y + layout.tab.y, w: layout.tab.w, h: layout.tab.h };
  if (tab.w < 8 || tab.h < 6) return;
  // Stepped top corners, then solid down to and over the box's top edge.
  px(d.ctx, d.signal, tab.x + 2, tab.y, tab.w - 4, 1);
  px(d.ctx, d.signal, tab.x + 1, tab.y + 1, tab.w - 2, 1);
  px(d.ctx, d.signal, tab.x, tab.y + 2, tab.w, tab.h - 1);
  // Square off the box's top-left step under the tab, so the join has no notch.
  px(d.ctx, d.signal, tab.x, tab.y + tab.h, 1, 3);

  const inner = { x: tab.x + 3, y: tab.y + 2, w: tab.w - 6, h: tab.h - 2 };
  glyph(d.ctx, d.maskLight, { x: inner.x, y: inner.y, w: BUILD_GLYPH[0].length, h: inner.h }, BUILD_GLYPH);
  microText(
    d.ctx,
    d.maskLight,
    inner.x + BUILD_GLYPH[0].length + 3,
    inner.y + Math.floor((inner.h - 5) / 2),
    PROMPT_TO_NODE_LABEL,
    inner.x + inner.w
  );
}

/** The message box itself, shared by both prompt kinds. `edge` is its frame colour. */
function drawPromptBody(d: DrawContext, layout: PromptLayout, edge: string): void {
  const at = (r: PromptRect): PromptRect => ({ x: d.x + r.x, y: d.y + r.y, w: r.w, h: r.h });
  const box = at(layout.box);
  const text = at(layout.text);
  const clip = at(layout.clip);
  const send = at(layout.send);

  roundedBox(d.ctx, d.maskLight, edge, box);

  // The caret, and the placeholder as dim word-shaped dashes on the first line.
  const lineY = text.y + Math.min(4, Math.max(0, text.h - 1));
  px(d.ctx, d.signal, text.x, text.y + 1, 1, Math.max(1, Math.min(7, text.h - 1)));
  let wx = text.x + 3;
  for (const word of PLACEHOLDER_WORDS) {
    const len = word * 2;
    if (wx + len > text.x + text.w) break;
    px(d.ctx, COPPER_DARK, wx, lineY, len, 1);
    wx += len + 2;
  }

  glyph(d.ctx, COPPER, clip, PAPERCLIP);
  roundedBox(d.ctx, d.signal, d.signal, send);
  glyph(d.ctx, d.maskLight, send, SEND_ARROW);
}

/* ────────────────────────── node frames and depth ────────────────────────── */

/**
 * Frames: the copper that hangs off the edge of a node.
 *
 * William: "with some nodes you've added an excellent copper leg sort of effect that looks like
 * mini copper wiring cascading from the side of a node; I want a variety of variations of these
 * sorts of effects to be togglable on each node."
 *
 * That effect was `legs()` on a `dip`, only available to `agent.code`, and only when the node had
 * no wallpaper — because a face image replaced the drawn package entirely. These are the same idea
 * made independent of kind and of whether there is a picture: a node's frame is a separate choice
 * from what it IS and what it shows.
 *
 * The frame draws in a MARGIN outside the footprint, the way the nameplate does. Collision,
 * routing and hit-testing keep running on the grid the board file describes — a framed node is not
 * a bigger node, it is a node with legs.
 */
export type { NodeFrame } from '@shared/frames.js';
export { NODE_FRAMES, isNodeFrame } from '@shared/frames.js';

/** How much room each frame needs outside the footprint, in px. */
export function frameMargin(frame: NodeFrame | undefined): number {
  switch (frame) {
    case 'dip':
    case 'quad':
    case 'fingers':
    case 'castellated':
      return 4;
    case 'tabs':
    case 'rails':
      return 3;
    case 'bga':
    case 'socket':
      return 2;
    default:
      return 0;
  }
}

/**
 * Draw a frame around a body at (x, y, w, h), using the `margin` of space outside it.
 *
 * Every variant is copper or copper-dark and nothing else. docs/02: copper is an EDGE colour —
 * traces, pads, pin legs, connector fingers — which is exactly the vocabulary a frame is made of.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  frame: NodeFrame,
  x: number,
  y: number,
  w: number,
  h: number,
  margin: number,
  signal: string
): void {
  if (frame === 'none' || margin <= 0 || w <= 4 || h <= 4) return;
  const d: DrawContext = { ctx, x, y, w, h, maskLight: '#000000', signal };

  switch (frame) {
    case 'dip':
      legs(d, 'left', x, y, w, h, margin);
      legs(d, 'right', x, y, w, h, margin);
      break;

    case 'quad':
      for (const edge of ['left', 'right', 'top', 'bottom'] as const) legs(d, edge, x, y, w, h, margin);
      break;

    case 'fingers': {
      // Edge-connector fingers along the bottom — wider and closer together than pin legs, which
      // is what makes a cartridge read as a cartridge rather than as a chip.
      for (let fx = x + 3; fx <= x + w - 6; fx += 7) px(ctx, COPPER, fx, y + h, 4, margin);
      px(ctx, COPPER_DARK, x + 2, y + h + margin - 1, w - 4, 1);
      break;
    }

    case 'tabs': {
      // Mounting tabs at the four corners, each with a hole. A real bracket.
      const t = margin + 2;
      for (const [tx, ty] of [[x - margin, y - margin], [x + w - t + margin, y - margin],
        [x - margin, y + h - t + margin], [x + w - t + margin, y + h - t + margin]]) {
        px(ctx, COPPER_DARK, tx as number, ty as number, t, t);
        px(ctx, COPPER, (tx as number) + 1, (ty as number) + 1, t - 2, t - 2);
        px(ctx, COPPER_DARK, (tx as number) + Math.floor(t / 2) - 1, (ty as number) + Math.floor(t / 2) - 1, 2, 2);
      }
      break;
    }

    case 'rails': {
      // A power rail top and bottom, with via dots along it. The look of a board's supply bus.
      px(ctx, COPPER, x - margin, y - margin, w + margin * 2, 2);
      px(ctx, COPPER, x - margin, y + h + margin - 2, w + margin * 2, 2);
      for (let rx = x; rx < x + w; rx += 8) {
        px(ctx, COPPER_DARK, rx, y - margin, 2, 2);
        px(ctx, COPPER_DARK, rx, y + h + margin - 2, 2, 2);
      }
      break;
    }

    case 'socket':
      // A socket ring: the component sits IN something. Two nested outlines, one tone apart.
      outline(d, COPPER_DARK, x - margin, y - margin, w + margin * 2, h + margin * 2);
      outline(d, COPPER, x - 1, y - 1, w + 2, h + 2);
      break;

    case 'bga': {
      // A pad array peeking out from underneath on all four sides — a chip you cannot see the
      // pins of, because they are under it.
      for (let bx = x + 2; bx < x + w - 2; bx += 5) {
        px(ctx, COPPER, bx, y - margin, 2, 2);
        px(ctx, COPPER, bx, y + h + margin - 2, 2, 2);
      }
      for (let by = y + 2; by < y + h - 2; by += 5) {
        px(ctx, COPPER, x - margin, by, 2, 2);
        px(ctx, COPPER, x + w + margin - 2, by, 2, 2);
      }
      break;
    }

    case 'castellated': {
      // Castellated edges: half-holes cut into the board edge, all the way round. The look of a
      // solder-down module.
      for (let cx = x + 2; cx < x + w - 2; cx += 6) {
        px(ctx, COPPER, cx, y - margin, 3, margin);
        px(ctx, COPPER, cx, y + h, 3, margin);
        px(ctx, COPPER_DARK, cx + 1, y - margin, 1, margin);
        px(ctx, COPPER_DARK, cx + 1, y + h, 1, margin);
      }
      for (let cy = y + 2; cy < y + h - 2; cy += 6) {
        px(ctx, COPPER, x - margin, cy, margin, 3);
        px(ctx, COPPER, x + w, cy, margin, 3);
      }
      break;
    }

    default:
      break;
  }
}

/**
 * The long-shadow depth stack, which is what a node's PRIORITY looks like.
 *
 * William wants priority to be visible as physical height: "level 3 or high priority nodes have 3
 * layers of node thickness... These should be relatively thin layers of depth though as I don't
 * want the items to look too protruded."
 *
 * So each level is TWO pixels, offset down and to the right, drawn darkest-first behind the body.
 * Two is the smallest offset that reads as a distinct step at 1:1 and still stacks to something
 * legible at five — a three-priority node sits 6px proud, which is visible across a room and never
 * looks like a tower.
 *
 * Flat colour per layer rather than a gradient: this is a 2D spoof of depth, and a gradient would
 * be both off-palette and blurred. The nearest layer is copper-dark and the ones behind it are
 * mask-dark, so the stack reads as a lit edge over shadow.
 */
export const DEPTH_STEP = 2;
export { MAX_PRIORITY } from '@shared/frames.js';
const MAX_PRIORITY_LOCAL = 5;

export function depthOffset(priority: number | undefined): number {
  const p = Math.max(0, Math.min(MAX_PRIORITY_LOCAL, Math.round(priority ?? 0)));
  return p * DEPTH_STEP;
}

export function drawDepth(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  priority: number,
  maskDark: string
): void {
  const levels = Math.max(0, Math.min(MAX_PRIORITY_LOCAL, Math.round(priority)));
  if (levels <= 0 || w <= 0 || h <= 0) return;

  /*
   * Farthest first, so each nearer layer paints over the one behind it.
   *
   * Every layer is mask-dark — this is SHADOW, and shadow is the absence of light rather than a
   * second material. An earlier version made the nearest layer copper-dark and the stack read as a
   * copper slab the component was sitting on: at three levels it looked protruded rather than
   * raised, which is the one thing William asked it not to do.
   *
   * What survives of that idea is a single copper-dark pixel line down the lit edges of the
   * nearest layer. One pixel is enough to say "this has a side"; anything more is a plinth.
   */
  for (let i = levels; i >= 1; i--) {
    const off = i * DEPTH_STEP;
    px(ctx, maskDark, x + off, y + off, w, h);
  }
  const near = DEPTH_STEP;
  px(ctx, COPPER_DARK, x + w, y + near, near, h - near);
  px(ctx, COPPER_DARK, x + near, y + h, w - near, near);
}
