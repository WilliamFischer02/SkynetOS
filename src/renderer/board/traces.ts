/**
 * Copper traces.
 *
 * Two rules shape every line of this file:
 *
 * 1. **Everything is an axis-aligned filled rectangle.** Not a stroke, not a path, not a
 *    diagonal. A stroked line half a pixel off centre antialiases even with MSAA disabled, and
 *    a diagonal cannot be pixel-exact at all. Filled rects at integer coordinates are the only
 *    primitive that is guaranteed hard-edged, so orthogonal segments are all we draw.
 *    docs/02 anti-mush rules 6 and 7.
 *
 * 2. **Relation colour lives here.** An edge with `relation: "gameos"` draws its inner strand in
 *    GameOS's signal colour, so the wire leaving JARVIS toward a room carries the colour of the
 *    room you land in. Traces are geometry, not atlas sprites, so this costs the six-colour
 *    sprite budget nothing.
 *
 * routeOrthogonal below is the HAND-ROUTED path and the fallback: it honours explicit waypoints
 * from the board JSON, and it is what runs when A* cannot find a way through. The automatic
 * router is router.ts, which does A* on the half-grid with node footprints as obstacles.
 * Neither can emit a diagonal.
 *
 * Still not done, from docs/01: bundling parallel runs with a ribbon clamp.
 */

import { Container, Graphics } from 'pixi.js';
import type { BoardEdge, EdgeKind } from '@shared/types.js';
import { COPPER, COPPER_DARK, INK, SILK, hexToNumber, resolveWireToken, signalOf } from '@shared/palette.js';
import type { WireHandle } from './wire-geometry.js';
import { OUTLINE_PX } from './wire-lanes.js';
import { LEGACY_DEPENDS, dashPattern, dashPieces, type DashPattern } from './wire-geometry.js';

export interface Rect { x: number; y: number; w: number; h: number }
export interface Point { x: number; y: number }

/** Traces run on the 8px half-grid so they can pass between adjacent components. docs/02. */
export const HALF_GRID = 8;

const snap = (v: number) => Math.round(v / HALF_GRID) * HALF_GRID;

function centre(r: Rect): Point {
  return { x: snap(r.x + r.w / 2), y: snap(r.y + r.h / 2) };
}

/**
 * Exit point on a rect's boundary, on the face pointing at `toward`. Traces should leave a
 * component from its edge, the way a pin does, not from inside its body.
 */
export function exitPoint(r: Rect, toward: Point, horizontalFirst: boolean): Point {
  const c = centre(r);
  if (horizontalFirst) {
    return { x: toward.x >= c.x ? snap(r.x + r.w) : snap(r.x), y: c.y };
  }
  return { x: c.x, y: toward.y >= c.y ? snap(r.y + r.h) : snap(r.y) };
}

/**
 * Route from one footprint to another as an orthogonal polyline. Returns world-pixel points,
 * all snapped to the half-grid, with every consecutive pair sharing an x or a y.
 */
export function routeOrthogonal(from: Rect, to: Rect, waypoints?: [number, number][], tile = 16): Point[] {
  const a = centre(from);
  const b = centre(to);

  // Hand-routed wins. Waypoints are in TILES in the board JSON — that is the unit everything
  // else in the file uses, so converting here keeps the JSON readable.
  if (waypoints?.length) {
    const first = { x: waypoints[0]![0] * tile, y: waypoints[0]![1] * tile };
    const horizontalFirst = Math.abs(first.x - a.x) >= Math.abs(first.y - a.y);
    const start = exitPoint(from, first, horizontalFirst);
    const mid = waypoints.map(([x, y]) => ({ x: snap(x * tile), y: snap(y * tile) }));
    const last = mid[mid.length - 1]!;
    const end = exitPoint(to, last, Math.abs(last.x - b.x) >= Math.abs(last.y - b.y));
    // Waypoints are hand-placed and are under no obligation to line up with each other or with
    // the pin they leave from. Inserting the elbows here is what keeps the hard guarantee that
    // no segment is ever diagonal, whatever someone types into the board JSON.
    return dedupe(orthogonalise([start, ...mid, end], horizontalFirst));
  }

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const horizontalFirst = Math.abs(dx) >= Math.abs(dy);

  const start = exitPoint(from, b, horizontalFirst);
  const end = exitPoint(to, a, horizontalFirst);

  if (start.x === end.x || start.y === end.y) return dedupe([start, end]);

  // Two-bend Z: break at the midpoint of the dominant axis so parallel runs between the same
  // two columns of components do not all overlap on one line.
  if (horizontalFirst) {
    const midX = snap((start.x + end.x) / 2);
    return dedupe([start, { x: midX, y: start.y }, { x: midX, y: end.y }, end]);
  }
  const midY = snap((start.y + end.y) / 2);
  return dedupe([start, { x: start.x, y: midY }, { x: end.x, y: midY }, end]);
}

/**
 * Insert an elbow between any two consecutive points that differ on both axes, so the polyline
 * is guaranteed orthogonal no matter what the waypoints say.
 *
 * The elbow alternates: after a horizontal run, turn vertical first; after a vertical run, turn
 * horizontal first. That produces a clean staircase instead of a shape that doubles back, and
 * it keeps the first bend consistent with which face the trace left the component from.
 */
function orthogonalise(points: Point[], firstSegmentHorizontal: boolean): Point[] {
  if (points.length < 2) return points;
  const out: Point[] = [points[0]!];
  let horizontal = firstSegmentHorizontal;

  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1]!;
    const next = points[i]!;

    if (prev.x === next.x) { out.push(next); horizontal = false; continue; }
    if (prev.y === next.y) { out.push(next); horizontal = true; continue; }

    const elbow = horizontal ? { x: next.x, y: prev.y } : { x: prev.x, y: next.y };
    out.push(elbow, next);
    // The segment arriving at `next` runs perpendicular to the one that reached the elbow.
    horizontal = !horizontal;
  }
  return out;
}

function dedupe(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  return out;
}

/** Every segment of a route, as an axis-aligned rect of the given width. */
export function segmentRects(points: Point[], width: number): Rect[] {
  const rects: Rect[] = [];
  const half = Math.floor(width / 2);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (a.y === b.y) {
      const x0 = Math.min(a.x, b.x);
      const x1 = Math.max(a.x, b.x);
      rects.push({ x: x0 - half, y: a.y - half, w: x1 - x0 + width, h: width });
    } else {
      const y0 = Math.min(a.y, b.y);
      const y1 = Math.max(a.y, b.y);
      rects.push({ x: a.x - half, y: y0 - half, w: width, h: y1 - y0 + width });
    }
  }
  return rects;
}

/** Visual treatment per edge kind. Width means importance, not throughput. docs/02. */
export interface TraceStyle {
  /** Outer copper run width in px. */
  width: number;
  /** The run's colour, resolved to hex. Copper unless the edge names another token. */
  color: string;
  /** The outline's colour, resolved to hex. Ink (black) unless the edge names another token. */
  stroke: string;
  /** Draw a 1px inner strand, and in what colour. */
  innerColor?: string;
  /** The run is drawn in a pattern rather than solid. For callers that only ask "is it dashed". */
  dashed?: boolean;
  /** The run's pattern, or null for solid. */
  dash: DashPattern | null;
  /** The outline's pattern: `follow` outlines each piece of the run, null is a solid sleeve. */
  outlineDash: DashPattern | null | 'follow';
  /** The black edge's width on each side, in px. 0 draws no outline. */
  outlineWidth: number;
}

type KindStyle = Omit<TraceStyle, 'dash' | 'outlineDash' | 'outlineWidth'>;

/**
 * How one edge is drawn.
 *
 * `theme` resolves the edge's own `color` and `stroke` tokens, where `signal` and the masks mean
 * something different in every room. Without it, a `signal` token falls back to `roomSignal` and
 * the masks to ink.
 *
 * The kind sets the width and the strand; the edge's own `dash`, `outlineDash` and `outlineWidth`
 * go on top. A `depends` wire has always been dashed by kind, and an explicit `dash`, including
 * `solid`, overrides that.
 */
export function styleFor(
  edge: BoardEdge,
  roomSignal: string,
  theme?: { maskDark: string; maskLight: string; signal: string }
): TraceStyle {
  const base = kindStyle(edge, roomSignal, theme);
  const outlineWidth = edge.outlineWidth ?? OUTLINE_PX;
  const dash = edge.dash ? dashPattern(edge.dash, base.width) : base.dashed ? LEGACY_DEPENDS : null;
  const outlineDash = edge.outlineDash ? dashPattern(edge.outlineDash, base.width + 2 * outlineWidth) : 'follow';
  return { ...base, dashed: dash !== null, dash, outlineDash, outlineWidth };
}

function kindStyle(
  edge: BoardEdge,
  roomSignal: string,
  theme?: { maskDark: string; maskLight: string; signal: string }
): KindStyle {
  const base = edge.width ?? 2;
  const kind: EdgeKind = edge.kind;
  const palette = theme ?? { maskDark: INK, maskLight: INK, signal: roomSignal };
  const paint = {
    color: resolveWireToken(edge.color, palette, COPPER),
    stroke: resolveWireToken(edge.stroke, palette, INK)
  };

  switch (kind) {
    case 'supervises':
      // "Drawn as a distinct 1px inner-signal-colored trace inside a wider copper run, so the
      // JARVIS network is visually separable at a glance." docs/03. With a relation, the inner
      // strand takes the destination room's colour instead of this room's.
      return { ...paint, width: Math.max(3, base + 1), innerColor: signalOf(edge.relation, roomSignal) };
    case 'produces':
      return { ...paint, width: base + 1, innerColor: edge.relation ? signalOf(edge.relation, roomSignal) : undefined };
    case 'reads':
      return { ...paint, width: Math.max(2, base - 1) };
    case 'depends':
      return { ...paint, width: base, dashed: true };
    case 'deploys':
      return { ...paint, width: base + 1, innerColor: signalOf(edge.relation, roomSignal) };
    case 'syncs':
      return { ...paint, width: base + 1, innerColor: COPPER_DARK };
  }
}

/** The run as rectangles: solid segments, or the pattern's pieces carried continuously round every corner. */
export function runPieces(points: Point[], style: TraceStyle): Rect[] {
  return style.dash ? dashPieces(points, style.width, style.dash) : segmentRects(points, style.width);
}

/**
 * The outline as rectangles, `outlineWidth` wide on every side. `follow` outlines each piece of the
 * run (a dashed wire made of separate little outlined dashes), null is one solid sleeve (dashes of
 * copper inside a continuous black track), and a pattern is the outline's own dashes around the run.
 */
export function outlinePieces(points: Point[], style: TraceStyle): Rect[] {
  const ow = Math.max(0, style.outlineWidth);
  if (ow === 0) return [];
  const grow = (p: Rect): Rect => ({ x: p.x - ow, y: p.y - ow, w: p.w + 2 * ow, h: p.h + 2 * ow });
  if (style.outlineDash === 'follow') return runPieces(points, style).map(grow);
  if (style.outlineDash === null) return segmentRects(points, style.width).map(grow);
  return dashPieces(points, style.width + 2 * ow, style.outlineDash);
}

/** One wire, finished: outline, run, inner strand, and vias at the bends when asked. */
function drawWire(g: Graphics, points: Point[], style: TraceStyle, vias: boolean): void {
  const outline = outlinePieces(points, style);
  for (const p of outline) g.rect(p.x, p.y, p.w, p.h);
  if (outline.length) g.fill({ color: hexToNumber(style.stroke) });

  const run = runPieces(points, style);
  for (const p of run) g.rect(p.x, p.y, p.w, p.h);
  if (run.length) g.fill({ color: hexToNumber(style.color) });

  if (style.innerColor) {
    for (const rect of segmentRects(points, 1)) g.rect(rect.x, rect.y, rect.w, rect.h);
    g.fill({ color: hexToNumber(style.innerColor) });
  }

  // Vias: a dark centre at every bend, which is what a real board does when a trace changes
  // layer. Also hides the corner notch where two segments meet.
  if (vias && points.length > 2) {
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i]!;
      g.rect(p.x - 1, p.y - 1, 2, 2);
    }
    g.fill({ color: hexToNumber(COPPER_DARK) });
  }
}

export interface RoutedEdge {
  edge: BoardEdge;
  points: Point[];
  style: TraceStyle;
}

/** Snap an A* path's endpoints onto the component faces, so copper meets a pad, not thin air. */
export function attachEndpoints(points: Point[], from: Rect, to: Rect): Point[] {
  if (points.length < 2) return points;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const second = points[1]!;
  const penultimate = points[points.length - 2]!;
  const startHorizontal = first.y === second.y;
  const endHorizontal = last.y === penultimate.y;
  return dedupe([
    exitPoint(from, second, startHorizontal),
    ...points.slice(1, -1),
    exitPoint(to, penultimate, endHorizontal)
  ]);
}

/**
 * The selected wire, redrawn on the overlay with a halo in `halo`: every stretch of it wrapped in
 * a band `haloPx` wide, then the wire's own outline, run and strand over the top. Nothing is
 * translucent, so a selected wire reads as the same wire, lit.
 */
export function buildWireHighlight(points: Point[], style: TraceStyle, halo: string, haloPx: number): Graphics {
  const g = new Graphics();
  const runs = segmentRects(points, style.width);
  if (!runs.length) return g;
  // The halo is one continuous band even under a dashed or dotted wire, so a selected wire reads as
  // ONE wire, lit, rather than a row of lit dashes.
  const pad = Math.max(OUTLINE_PX, style.outlineWidth) + haloPx;
  for (const p of runs) g.rect(p.x - pad, p.y - pad, p.w + 2 * pad, p.h + 2 * pad);
  g.fill({ color: hexToNumber(halo) });
  drawWire(g, points, style, false);
  g.roundPixels = true;
  return g;
}

/**
 * A selected wire's handles, in Edit Board mode: a filled square on each end and elbow, a smaller
 * one in the middle of each segment long enough to bend, and a ring round the one Tab has focused.
 * Every handle carries a black edge, like every wire. Whole pixels, like the node resize handle.
 */
export function buildWireHandles(handles: readonly WireHandle[], focused: number, signal: string): Graphics {
  const g = new Graphics();
  const grips = handles.filter((h) => h.kind !== 'segment');
  const bends = handles.filter((h) => h.kind === 'segment');
  if (grips.length) {
    for (const h of grips) g.rect(h.x - 4, h.y - 4, 8, 8);
    g.fill({ color: hexToNumber(INK) });
    for (const h of grips) g.rect(h.x - 3, h.y - 3, 6, 6);
    g.fill({ color: hexToNumber(signal) });
    for (const h of grips) { g.rect(h.x - 3, h.y - 3, 6, 1); g.rect(h.x - 3, h.y - 3, 1, 6); }
    g.fill({ color: hexToNumber(SILK) });
  }
  if (bends.length) {
    for (const h of bends) g.rect(h.x - 3, h.y - 3, 6, 6);
    g.fill({ color: hexToNumber(INK) });
    for (const h of bends) g.rect(h.x - 2, h.y - 2, 4, 4);
    g.fill({ color: hexToNumber(SILK) });
  }
  const f = handles[focused];
  if (f) {
    const x = f.x - 7;
    const y = f.y - 7;
    g.rect(x, y, 14, 1);
    g.rect(x, y + 13, 14, 1);
    g.rect(x, y, 1, 14);
    g.rect(x + 13, y, 1, 14);
    g.fill({ color: hexToNumber(SILK) });
  }
  g.roundPixels = true;
  return g;
}

/**
 * Build the static copper layer. One Graphics for the whole room: traces only change when the
 * graph changes, so this is rebuilt on edit, not per frame.
 *
 * ── One wire at a time ───────────────────────────────────────────────────────────────────────
 *
 * Each wire is finished before the next begins: its black outline, then its run, then its inner
 * strand and its vias. The layers used to be drawn board-wide (all copper, then all strands), so
 * where two wires crossed they fused into one copper blob and you could not see which went where.
 * Drawn one at a time, a later wire passes OVER an earlier one with its black edge cutting across
 * it, which is how two wires on separate layers of a real board read. William: "all wires, even
 * drawn ones should have a black stroke for visual clarity."
 *
 * The outline is one whole pixel wide on every side, drawn as filled rects like everything else
 * here, never a stroke.
 */
export function buildTraceLayer(routed: RoutedEdge[]): Container {
  const layer = new Container();
  const g = new Graphics();

  for (const { points, style } of routed) {
    if (points.length < 2) continue;
    drawWire(g, points, style, true);
  }

  // Belt-and-braces: every coordinate here is already a whole number, and the camera rounds the
  // stage position every frame.
  g.roundPixels = true;
  layer.addChild(g);
  return layer;
}
