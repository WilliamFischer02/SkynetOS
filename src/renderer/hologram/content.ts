import type { FolderContent, HoloContent, HoloKind, PaperContent, TerminalContent, TerminalOp } from '@shared/holo-scene.js';

/**
 * What is drawn inside the globe when an item is at the centre: a tall sheet of paper for a
 * document, a small terminal being typed for code, a grid for a folder. Each is painted on a
 * 2D canvas at a fixed logical size and uploaded as a texture; scene.ts scales it by a whole
 * number so the text stays crisp.
 *
 * William, 2026-09-26: "set up a cache or render optimization system so the render can be
 * real-time"; "rove between changes at a slight delay that allows it to do less adding and
 * removing of characters". So: the paper is painted one visible window at a time and cached by
 * (content, scroll line); the terminal player applies at most `TYPE_BUDGET` characters a frame,
 * and when it falls more than a few ops behind it jumps the backlog and types only the latest.
 */

export const CONTENT_W = 192;
export const PAPER_H = 256;
export const PANEL_H = 144;
export const LINE_H = 13;
const FONT = '11px "Departure Mono", ui-monospace, monospace';
const INK = '#48c8f0';
const BRIGHT = '#b8f4ff';
const DIM = '#12466e';
const PAPER_BG = '#0b1e36';
const TERM_BG = '#04090f';
export const TYPE_BUDGET = 20;
export const ROVE_BEHIND_OPS = 3;
export const PAPER_LINES_PER_S = 1.5;

export function hashText(parts: readonly string[]): string {
  let h = 2166136261;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      h ^= part.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0x9e3779b9;
  }
  return (h >>> 0).toString(16);
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function frame(ctx: CanvasRenderingContext2D, w: number, h: number, title: string, bg: string): void {
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = DIM;
  ctx.fillRect(0, 0, w, LINE_H + 1);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  ctx.font = FONT;
  ctx.textBaseline = 'top';
  ctx.fillStyle = BRIGHT;
  ctx.fillText(clip(ctx, title.toUpperCase(), w - 8), 4, 1);
}

function clip(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

export const KIND_GLYPH: Record<HoloKind, string> = { doc: 'D', code: 'C', model: 'M', folder: 'F', exe: 'X', image: 'I', other: '·' };

/* ────────────────────────── paper ────────────────────────── */

export interface PaperView { canvas: HTMLCanvasElement; key: string }

/** The visible window of a document at `scrollLine` (fractional; painted at whole lines). */
export function paintPaper(content: PaperContent, scrollLine: number, cache: Map<string, PaperView>): PaperView {
  const top = Math.max(0, Math.floor(scrollLine));
  const key = `${hashText(content.lines)}:${top}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = makeCanvas(CONTENT_W, PAPER_H);
  const ctx = canvas.getContext('2d')!;
  frame(ctx, CONTENT_W, PAPER_H, content.title, PAPER_BG);
  ctx.fillStyle = INK;
  const rows = Math.floor((PAPER_H - LINE_H - 6) / LINE_H);
  for (let r = 0; r < rows; r++) {
    const line = content.lines[top + r];
    if (line === undefined) break;
    ctx.fillText(clip(ctx, line, CONTENT_W - 8), 4, LINE_H + 3 + r * LINE_H);
  }
  // A scroll thumb on the right edge, so the length of the document reads.
  if (content.lines.length > rows) {
    const trackH = PAPER_H - LINE_H - 4;
    const thumbH = Math.max(6, Math.round((rows / content.lines.length) * trackH));
    const thumbY = LINE_H + 2 + Math.round((top / content.lines.length) * trackH);
    ctx.fillStyle = DIM;
    ctx.fillRect(CONTENT_W - 3, LINE_H + 2, 2, trackH);
    ctx.fillStyle = BRIGHT;
    ctx.fillRect(CONTENT_W - 3, thumbY, 2, thumbH);
  }
  if (cache.size > 12) cache.delete(cache.keys().next().value!);
  const view = { canvas, key };
  cache.set(key, view);
  return view;
}

/* ────────────────────────── terminal ────────────────────────── */

/**
 * Plays a terminal's ops by wall clock, a budget of characters a frame, jumping the backlog when
 * it is far behind. `update` returns true when the canvas changed and needs re-uploading.
 */
export class TerminalPlayer {
  readonly canvas = makeCanvas(CONTENT_W, PANEL_H);
  private readonly ctx = this.canvas.getContext('2d')!;
  private lines: string[];
  private next = 0;
  /** Characters of `ops[next]` already applied. */
  private typed = 0;
  private cursorLine = 0;
  private dirty = true;
  private blink = 0;

  constructor(private readonly content: TerminalContent) {
    this.lines = [...content.lines];
    this.paint();
  }

  get key(): string { return hashText([this.content.title, ...this.content.lines, String(this.content.ops.length)]); }

  update(elapsedMs: number, now: number): boolean {
    const ops = this.content.ops;
    let budget = TYPE_BUDGET;
    while (this.next < ops.length && ops[this.next]!.at <= elapsedMs && budget > 0) {
      const op = ops[this.next]!;
      // Behind by several ops: land this one whole. Only the newest is worth watching typed.
      const behind = this.next + ROVE_BEHIND_OPS < ops.length && ops[this.next + ROVE_BEHIND_OPS]!.at <= elapsedMs;
      budget = this.apply(op, behind ? Number.POSITIVE_INFINITY : budget);
      if (this.typed >= op.text.length || op.kind === 'delete') { this.next++; this.typed = 0; }
      this.dirty = true;
    }
    const blink = Math.floor(now / 500) & 1;
    if (blink !== this.blink) { this.blink = blink; this.dirty = true; }
    if (!this.dirty) return false;
    this.paint();
    this.dirty = false;
    return true;
  }

  /** Apply up to `budget` characters of `op`; returns what is left of the budget. */
  private apply(op: TerminalOp, budget: number): number {
    const line = Math.max(0, Math.min(this.lines.length, op.line));
    this.cursorLine = line;
    if (op.kind === 'delete') {
      if (line < this.lines.length) this.lines.splice(line, 1);
      return budget - 1;
    }
    if (this.typed === 0) {
      if (op.kind === 'insert') this.lines.splice(line, 0, '');
      else this.lines[line] = '';
    }
    const take = Math.min(op.text.length - this.typed, budget);
    this.lines[line] = (this.lines[line] ?? '') + op.text.slice(this.typed, this.typed + take);
    this.typed += take;
    return budget - take;
  }

  private paint(): void {
    const ctx = this.ctx;
    frame(ctx, CONTENT_W, PANEL_H, `${this.content.title}${this.content.language ? ` · ${this.content.language}` : ''}`, TERM_BG);
    const rows = Math.floor((PANEL_H - LINE_H - 6) / LINE_H);
    // Keep the cursor's line in view: show the window ending at or after it.
    const first = Math.max(0, Math.min(this.lines.length - rows, this.cursorLine - rows + 2));
    ctx.fillStyle = INK;
    for (let r = 0; r < rows; r++) {
      const idx = first + r;
      const text = this.lines[idx];
      if (text === undefined) break;
      const y = LINE_H + 3 + r * LINE_H;
      ctx.fillStyle = idx === this.cursorLine ? BRIGHT : INK;
      const shown = clip(ctx, text, CONTENT_W - 12);
      ctx.fillText(shown, 4, y);
      if (idx === this.cursorLine && this.blink === 0 && this.next < this.content.ops.length) {
        const x = 4 + ctx.measureText(shown).width + 1;
        ctx.fillRect(Math.min(x, CONTENT_W - 8), y, 6, LINE_H - 2);
      }
    }
  }
}

/* ────────────────────────── folder, none ────────────────────────── */

export function paintFolder(content: FolderContent): HTMLCanvasElement {
  const canvas = makeCanvas(CONTENT_W, PANEL_H);
  const ctx = canvas.getContext('2d')!;
  frame(ctx, CONTENT_W, PANEL_H, content.title, TERM_BG);
  const cols = 2;
  const cellW = Math.floor((CONTENT_W - 8) / cols);
  const rows = Math.floor((PANEL_H - LINE_H - 6) / LINE_H);
  const shown = content.entries.slice(0, cols * rows);
  shown.forEach((entry, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = 4 + c * cellW;
    const y = LINE_H + 3 + r * LINE_H;
    ctx.fillStyle = entry.kind === 'folder' ? BRIGHT : INK;
    ctx.fillText(KIND_GLYPH[entry.kind], x, y);
    ctx.fillStyle = INK;
    ctx.fillText(clip(ctx, entry.name, cellW - 14), x + 10, y);
  });
  if (content.entries.length > shown.length) {
    ctx.fillStyle = DIM;
    ctx.fillText(`+${content.entries.length - shown.length}`, CONTENT_W - 28, PANEL_H - LINE_H - 1);
  }
  return canvas;
}

export function paintNone(title: string, kind: HoloKind): HTMLCanvasElement {
  const canvas = makeCanvas(CONTENT_W, PANEL_H);
  const ctx = canvas.getContext('2d')!;
  frame(ctx, CONTENT_W, PANEL_H, title, TERM_BG);
  ctx.font = '44px "Departure Mono", ui-monospace, monospace';
  ctx.fillStyle = DIM;
  ctx.fillText(KIND_GLYPH[kind], CONTENT_W / 2 - 14, PANEL_H / 2 - 16);
  return canvas;
}

/** A 16x16 glyph for an item with no icon of its own. */
export function paintGlyph(kind: HoloKind): HTMLCanvasElement {
  const canvas = makeCanvas(16, 16);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = DIM;
  ctx.fillRect(0, 0, 16, 16);
  ctx.strokeStyle = INK;
  ctx.strokeRect(0.5, 0.5, 15, 15);
  ctx.font = FONT;
  ctx.textBaseline = 'top';
  ctx.fillStyle = BRIGHT;
  ctx.fillText(KIND_GLYPH[kind], 5, 2);
  return canvas;
}

/** A small text plate (the queue count). */
export function paintPlate(text: string): HTMLCanvasElement {
  const w = Math.max(16, text.length * 7 + 8);
  const canvas = makeCanvas(w, LINE_H + 2);
  const ctx = canvas.getContext('2d')!;
  ctx.font = FONT;
  ctx.textBaseline = 'top';
  ctx.fillStyle = INK;
  ctx.fillText(text, 4, 1);
  return canvas;
}

export function contentKey(content: HoloContent): string {
  switch (content.type) {
    case 'paper': return `paper:${hashText(content.lines)}`;
    case 'terminal': return `term:${hashText([content.title, ...content.lines, String(content.ops.length)])}`;
    case 'wire': return `wire:${content.title}:${content.verts.length}:${content.edges.length}`;
    case 'folder': return `folder:${content.title}:${content.entries.length}`;
    case 'none': return `none:${content.title}`;
  }
}
