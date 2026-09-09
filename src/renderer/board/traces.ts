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
 * The router is deliberately dumb: a two-bend orthogonal Z, no A*, no obstacle avoidance, no
 * bundling. docs/06 puts the real router at M2. Until then this makes the edge data visible and
 * exercised, which is what "data before pixels" needs, and it is replaced wholesale later.
 */

import { Container, Graphics } from 'pixi.js';
import type { BoardEdge, EdgeKind } from '@shared/types.js';
import { COPPER, COPPER_DARK, hexToNumber, signalOf } from '@shared/palette.js';

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
function exitPoint(r: Rect, toward: Point, horizontalFirst: boolean): Point {
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
  /** Draw a 1px inner strand, and in what colour. */
  innerColor?: string;
  /** Draw the run as alternating on/off tiles rather than solid. */
  dashed?: boolean;
}

export function styleFor(edge: BoardEdge, roomSignal: string): TraceStyle {
  const base = edge.width ?? 2;
  const kind: EdgeKind = edge.kind;

  switch (kind) {
    case 'supervises':
      // "Drawn as a distinct 1px inner-signal-colored trace inside a wider copper run, so the
      // JARVIS network is visually separable at a glance." docs/03. With a relation, the inner
      // strand takes the destination room's colour instead of this room's.
      return { width: Math.max(3, base + 1), innerColor: signalOf(edge.relation, roomSignal) };
    case 'produces':
      return { width: base + 1, innerColor: edge.relation ? signalOf(edge.relation, roomSignal) : undefined };
    case 'reads':
      return { width: Math.max(2, base - 1) };
    case 'depends':
      return { width: base, dashed: true };
    case 'deploys':
      return { width: base + 1, innerColor: signalOf(edge.relation, roomSignal) };
    case 'syncs':
      return { width: base + 1, innerColor: COPPER_DARK };
  }
}

/** Split a rect into 8-on / 8-off tiles along its long axis, for `depends`. */
function dashRects(rect: Rect): Rect[] {
  const out: Rect[] = [];
  const horizontal = rect.w >= rect.h;
  const length = horizontal ? rect.w : rect.h;
  for (let offset = 0; offset < length; offset += HALF_GRID * 2) {
    const run = Math.min(HALF_GRID, length - offset);
    out.push(horizontal
      ? { x: rect.x + offset, y: rect.y, w: run, h: rect.h }
      : { x: rect.x, y: rect.y + offset, w: rect.w, h: run });
  }
  return out;
}

export interface RoutedEdge {
  edge: BoardEdge;
  points: Point[];
  style: TraceStyle;
}

/**
 * Build the static copper layer. One Graphics for the whole room: traces only change when the
 * graph changes, so this is rebuilt on edit, not per frame.
 */
export function buildTraceLayer(routed: RoutedEdge[]): Container {
  const layer = new Container();
  const copper = new Graphics();
  const inner = new Graphics();

  for (const { points, style } of routed) {
    for (const rect of segmentRects(points, style.width)) {
      const pieces = style.dashed ? dashRects(rect) : [rect];
      for (const p of pieces) copper.rect(p.x, p.y, p.w, p.h);
    }
  }
  copper.fill({ color: hexToNumber(COPPER) });

  // Vias: a copper ring with a dark centre at every bend, which is what a real board does when
  // a trace changes layer. Also hides the corner notch where two segments meet.
  const viaDark = new Graphics();
  for (const { points, style } of routed) {
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i]!;
      viaDark.rect(p.x - 1, p.y - 1, 2, 2);
    }
    if (style.innerColor) {
      for (const rect of segmentRects(points, 1)) inner.rect(rect.x, rect.y, rect.w, rect.h);
    }
  }
  viaDark.fill({ color: hexToNumber(COPPER_DARK) });

  layer.addChild(copper, viaDark);

  // Inner strands are drawn per-colour so a room can carry several relation colours at once.
  const byColor = new Map<string, RoutedEdge[]>();
  for (const r of routed) {
    if (!r.style.innerColor) continue;
    const list = byColor.get(r.style.innerColor) ?? [];
    list.push(r);
    byColor.set(r.style.innerColor, list);
  }
  for (const [color, edges] of byColor) {
    const g = new Graphics();
    for (const { points } of edges) {
      for (const rect of segmentRects(points, 1)) g.rect(rect.x, rect.y, rect.w, rect.h);
    }
    g.fill({ color: hexToNumber(color) });
    layer.addChild(g);
  }

  inner.destroy();
  // roundPixels is a ViewContainer property, so it is set on each Graphics rather than on the
  // group. It is belt-and-braces anyway: every coordinate here is already a whole number, and
  // the camera rounds the stage position every frame.
  for (const child of layer.children) {
    if ('roundPixels' in child) (child as { roundPixels: boolean }).roundPixels = true;
  }
  return layer;
}
