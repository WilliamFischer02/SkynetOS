/**
 * Wire geometry the router and the drawing share: dash patterns, pinned endpoints, and hand-moved
 * elbows.
 *
 * William: "add more wire type variations (dotted and dashed and solid strokes and fills, stroke
 * width modifier, and add the ability to manually reposition both endpoints of a wire to a desired
 * point along a nodes edge and it sticks to that point, as well as the ability to reposition elbows".
 *
 * Every shape here is whole pixels and orthogonal, the two rules the trace layer is built on:
 *
 *   - A dash is a filled axis-aligned rectangle cut from the route's centreline, never a stroked
 *     line with a dash array. Pixi strokes antialias; rectangles at integer coordinates cannot.
 *   - The pattern runs CONTINUOUSLY along the route, corner to corner, so a dashed wire reads as one
 *     dashed wire rather than a set of segments each starting its own pattern.
 *   - A reshaped route stays orthogonal. Moving an elbow moves the neighbouring corners along the
 *     axes they already share, and where a leg meets a pinned endpoint a small jog is inserted,
 *     so a diagonal can never appear.
 *
 * Pure: no Pixi, no DOM. test/wire-geometry.test.ts holds it.
 */

import type { AnchorSide, WireAnchor, WireDash } from '@shared/types.js';
import type { Point, Rect } from './traces.js';
import { simplify } from './wire-lanes.js';

/** The trace half-grid, as in traces.ts. Defined here as well so this module imports no drawing code. */
export const WIRE_GRID = 8;

const snapGrid = (v: number): number => Math.round(v / WIRE_GRID) * WIRE_GRID;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/* ────────────────────────── dashes ────────────────────────── */

export interface DashPattern {
  /** Pixels drawn. */
  on: number;
  /** Pixels skipped. */
  off: number;
}

/** A `depends` wire's long-standing look: eight on, eight off. */
export const LEGACY_DEPENDS: DashPattern = { on: 8, off: 8 };

/**
 * The pattern for a dash style at a given thickness, or null for solid. Scaled by the thickness so a
 * thick dotted wire is still a row of dots rather than a row of slivers: a dot is exactly as long as
 * the wire is wide.
 */
export function dashPattern(dash: WireDash | undefined, thickness: number): DashPattern | null {
  const u = Math.max(1, Math.round(thickness));
  if (dash === 'dashed') return { on: 4 * u, off: 3 * u };
  if (dash === 'dotted') return { on: u, off: 2 * u };
  return null;
}

/** Is the pattern drawing at this distance along the route? */
function isOn(distance: number, pattern: DashPattern): boolean {
  return distance % (pattern.on + pattern.off) < pattern.on;
}

/**
 * The "on" parts of a route as whole-pixel rectangles, `width` thick.
 *
 * The pattern is measured along the whole route, so it carries on round every corner. A corner
 * that falls inside an "on" stretch gets its square filled, and so do the two ends, which is what
 * makes a dashed wire meet a pad the way a solid one does.
 */
export function dashPieces(points: readonly Point[], width: number, pattern: DashPattern): Rect[] {
  const w = Math.max(1, Math.round(width));
  const half = Math.floor(w / 2);
  const period = pattern.on + pattern.off;
  const out: Rect[] = [];
  const square = (p: Point): Rect => ({ x: p.x - half, y: p.y - half, w, h: w });
  if (points.length < 2) return out;

  let travelled = 0;
  out.push(square(points[0]!));
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const horizontal = a.y === b.y;
    const length = horizontal ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
    if (length === 0) continue;
    const sign = horizontal ? Math.sign(b.x - a.x) : Math.sign(b.y - a.y);

    for (let k = Math.floor(travelled / period) * period; k < travelled + length; k += period) {
      const s0 = Math.max(k, travelled);
      const s1 = Math.min(k + pattern.on, travelled + length);
      if (s1 <= s0) continue;
      const p0 = (s0 - travelled) * sign;
      const p1 = (s1 - travelled) * sign;
      const lo = Math.min(p0, p1);
      const hi = Math.max(p0, p1);
      out.push(horizontal
        ? { x: a.x + lo, y: a.y - half, w: hi - lo, h: w }
        : { x: a.x - half, y: a.y + lo, w, h: hi - lo });
    }
    travelled += length;
    // A corner, or the far end, inside an "on" stretch: fill its square so the join is not notched.
    if (isOn(travelled, pattern) || i === points.length - 1) {
      if (i === points.length - 1 ? isOn(Math.max(0, travelled - 1), pattern) : true) out.push(square(b));
    }
  }
  return out;
}

/* ────────────────────────── pinned endpoints ────────────────────────── */

/** The unit step pointing out of a node through one of its sides. */
export function outward(side: AnchorSide): { dx: number; dy: number } {
  switch (side) {
    case 'top': return { dx: 0, dy: -1 };
    case 'right': return { dx: 1, dy: 0 };
    case 'bottom': return { dx: 0, dy: 1 };
    case 'left': return { dx: -1, dy: 0 };
  }
}

/**
 * The point on a node's edge an anchor names, on the trace half-grid.
 *
 * The offset is a fraction of the side, so a pin half-way along a node's right edge stays half-way
 * along it when the node grows. Snapped to the 8px half-grid the traces run on (rather than whole
 * 16px tiles), because a three-tile node's centre is a half tile, and that is exactly where the
 * router puts a wire by default.
 */
export function anchorPoint(rect: Rect, anchor: WireAnchor): Point {
  const t = clamp(anchor.offset, 0, 1);
  const left = snapGrid(rect.x);
  const top = snapGrid(rect.y);
  const right = snapGrid(rect.x + rect.w);
  const bottom = snapGrid(rect.y + rect.h);
  const along = (a: number, b: number): number => clamp(snapGrid(a + t * (b - a)), Math.min(a, b), Math.max(a, b));
  switch (anchor.side) {
    case 'top': return { x: along(left, right), y: top };
    case 'bottom': return { x: along(left, right), y: bottom };
    case 'left': return { x: left, y: along(top, bottom) };
    case 'right': return { x: right, y: along(top, bottom) };
  }
}

const round4 = (v: number): number => Math.round(v * 10_000) / 10_000;

/**
 * The anchor nearest a point: which side the point is closest to, and where along it. This is what
 * makes a dragged endpoint slide along the node's perimeter and turn the corner onto the next side
 * on its own, wherever the cursor goes.
 */
export function nearestAnchor(rect: Rect, p: Point): WireAnchor {
  const x0 = rect.x;
  const y0 = rect.y;
  const x1 = rect.x + rect.w;
  const y1 = rect.y + rect.h;
  const cx = clamp(p.x, x0, x1);
  const cy = clamp(p.y, y0, y1);
  const sides: { side: AnchorSide; d: number }[] = [
    { side: 'top', d: Math.hypot(p.x - cx, p.y - y0) },
    { side: 'right', d: Math.hypot(p.x - x1, p.y - cy) },
    { side: 'bottom', d: Math.hypot(p.x - cx, p.y - y1) },
    { side: 'left', d: Math.hypot(p.x - x0, p.y - cy) }
  ];
  const best = sides.reduce((a, b) => (b.d < a.d ? b : a));
  const horizontalSide = best.side === 'top' || best.side === 'bottom';
  const length = horizontalSide ? rect.w : rect.h;
  if (length <= 0) return { side: best.side, offset: 0.5 };
  const pos = horizontalSide ? snapGrid(cx) - x0 : snapGrid(cy) - y0;
  return { side: best.side, offset: round4(clamp(pos / length, 0, 1)) };
}

/**
 * Slide an anchor round a node's perimeter by whole half-grid steps: positive is clockwise. The
 * keyboard path for moving a pinned end, since a drag is mouse-only.
 */
export function slideAnchor(rect: Rect, anchor: WireAnchor, steps: number): WireAnchor {
  const w = rect.w;
  const h = rect.h;
  const perimeter = 2 * (w + h);
  if (perimeter <= 0) return anchor;
  const t = clamp(anchor.offset, 0, 1);
  // Distance clockwise from the top-left corner.
  const s = anchor.side === 'top' ? t * w
    : anchor.side === 'right' ? w + t * h
      : anchor.side === 'bottom' ? w + h + (1 - t) * w
        : 2 * w + h + (1 - t) * h;
  let next = (s + steps * WIRE_GRID) % perimeter;
  if (next < 0) next += perimeter;
  const p = next < w ? { x: rect.x + next, y: rect.y }
    : next < w + h ? { x: rect.x + w, y: rect.y + (next - w) }
      : next < 2 * w + h ? { x: rect.x + w - (next - w - h), y: rect.y + h }
        : { x: rect.x, y: rect.y + h - (next - 2 * w - h) };
  return nearestAnchor(rect, p);
}

/**
 * Slide an anchor one half-grid step the way an arrow key points. Of the two neighbouring steps
 * round the perimeter it takes the one that carries the point along the arrow, so Right moves right
 * on the bottom side too, and Down at a top corner turns down the side. An arrow that neither step
 * follows, pointing into or out of the node, returns the same anchor.
 */
export function nudgeAnchor(rect: Rect, anchor: WireAnchor, dx: number, dy: number): WireAnchor {
  const here = anchorPoint(rect, anchor);
  let best = anchor;
  let gain = 0;
  for (const steps of [1, -1]) {
    const next = slideAnchor(rect, anchor, steps);
    const p = anchorPoint(rect, next);
    const along = (p.x - here.x) * dx + (p.y - here.y) * dy;
    if (along > gain) { gain = along; best = next; }
  }
  return best;
}

/** "right 50%": how the inspector names an anchor. */
export function anchorLabel(anchor: WireAnchor | undefined): string {
  return anchor ? `${anchor.side} ${Math.round(clamp(anchor.offset, 0, 1) * 100)}%` : 'auto';
}

/* ────────────────────────── reshaping a route by hand ────────────────────────── */

type Dir = { dx: number; dy: number };

function directionOf(from: Point, to: Point): Dir {
  if (from.y === to.y && from.x !== to.x) return { dx: Math.sign(to.x - from.x), dy: 0 };
  if (from.x === to.x && from.y !== to.y) return { dx: 0, dy: Math.sign(to.y - from.y) };
  return { dx: 1, dy: 0 };
}

/**
 * The corners that carry a pinned end to `target` while leaving the end along `dir`, the axis it
 * already leaves on. Straight when `target` is already on that line; otherwise a jog half-way,
 * pushed at least one grid step outward so the wire never starts by doubling back into its node.
 */
function legFrom(end: Point, dir: Dir, target: Point): Point[] {
  if (dir.dx !== 0) {
    if (target.y === end.y) return [];
    let mx = snapGrid((end.x + target.x) / 2);
    if (Math.sign(mx - end.x) !== dir.dx) mx = end.x + dir.dx * WIRE_GRID;
    return [{ x: mx, y: end.y }, { x: mx, y: target.y }];
  }
  if (target.x === end.x) return [];
  let my = snapGrid((end.y + target.y) / 2);
  if (Math.sign(my - end.y) !== dir.dy) my = end.y + dir.dy * WIRE_GRID;
  return [{ x: end.x, y: my }, { x: target.x, y: my }];
}

/** Insert an elbow wherever two neighbours differ on both axes. A safety net; by construction there are none. */
function ensureOrthogonal(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && prev.x !== p.x && prev.y !== p.y) out.push({ x: p.x, y: prev.y });
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

/** Rebuild a route from its fixed ends and a new set of interior corners, keeping each end's axis. */
function reconnect(points: readonly Point[], interior: Point[]): Point[] {
  const start = points[0]!;
  const end = points[points.length - 1]!;
  const dirStart = directionOf(start, points[1]!);
  const dirEnd = directionOf(end, points[points.length - 2]!);
  if (!interior.length) return simplify(ensureOrthogonal([start, ...legFrom(start, dirStart, end), end]));
  const head = [start, ...legFrom(start, dirStart, interior[0]!)];
  const tail = [...legFrom(end, dirEnd, interior[interior.length - 1]!).reverse(), end];
  return simplify(ensureOrthogonal([...head, ...interior, ...tail]));
}

/**
 * Move corner `index` to `to`. Its two neighbouring corners slide along the axes they already share
 * with it, so both adjoining segments keep their orientation; where a neighbour is a pinned end, a
 * jog is inserted instead. The ends never move.
 */
export function moveElbow(points: readonly Point[], index: number, to: Point): Point[] {
  const n = points.length;
  if (n < 3 || index <= 0 || index >= n - 1) return points.map((p) => ({ ...p }));
  const interior = points.slice(1, -1).map((p) => ({ ...p }));
  const j = index - 1;
  const old = points[index]!;
  const prev = points[index - 1]!;
  const next = points[index + 1]!;
  interior[j] = { x: to.x, y: to.y };
  if (j - 1 >= 0) interior[j - 1] = prev.y === old.y ? { x: prev.x, y: to.y } : { x: to.x, y: prev.y };
  if (j + 1 < interior.length) interior[j + 1] = next.y === old.y ? { x: next.x, y: to.y } : { x: to.x, y: next.y };
  return reconnect(points, interior);
}

/**
 * Drag segment `index` (from point `index` to point `index + 1`) across its own axis, so it passes
 * through `to`. A segment touching a pinned end gets a jog at that end, and a straight wire with no
 * corners at all gets a detour through `to`: this is how a new bend is made.
 */
export function moveSegment(points: readonly Point[], index: number, to: Point): Point[] {
  const n = points.length;
  if (n < 2 || index < 0 || index >= n - 1) return points.map((p) => ({ ...p }));
  const a = points[index]!;
  const b = points[index + 1]!;
  if (n === 2) return reconnect(points, [{ x: to.x, y: to.y }]);
  const horizontal = a.y === b.y;
  const interior = points.slice(1, -1).map((p) => ({ ...p }));
  for (const k of [index - 1, index]) {
    if (k < 0 || k >= interior.length) continue;
    interior[k] = horizontal ? { x: interior[k]!.x, y: to.y } : { x: to.x, y: interior[k]!.y };
  }
  return reconnect(points, interior);
}

/** A route's interior corners as board waypoints, in whole tiles. The ends belong to the anchors. */
export function waypointsFrom(points: readonly Point[], tile: number): [number, number][] {
  const out: [number, number][] = [];
  for (const p of points.slice(1, -1)) {
    const wp: [number, number] = [Math.round(p.x / tile), Math.round(p.y / tile)];
    const last = out[out.length - 1];
    if (!last || last[0] !== wp[0] || last[1] !== wp[1]) out.push(wp);
  }
  return out;
}

/* ────────────────────────── handles ────────────────────────── */

export type WireHandleKind = 'from' | 'to' | 'elbow' | 'segment';

export interface WireHandle {
  kind: WireHandleKind;
  /** The point index for from/to/elbow; the segment's first point for a segment handle. */
  index: number;
  x: number;
  y: number;
}

/**
 * Every grabbable point on a selected wire: its two ends, each elbow, and the middle of every
 * segment long enough to bend. In the order Tab visits them: from, along the wire, to.
 */
export function wireHandles(points: readonly Point[]): WireHandle[] {
  const out: WireHandle[] = [];
  const n = points.length;
  if (n < 2) return out;
  out.push({ kind: 'from', index: 0, x: points[0]!.x, y: points[0]!.y });
  for (let i = 0; i < n - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (Math.abs(b.x - a.x) + Math.abs(b.y - a.y) >= 4 * WIRE_GRID) {
      out.push({ kind: 'segment', index: i, x: snapGrid((a.x + b.x) / 2), y: snapGrid((a.y + b.y) / 2) });
    }
    if (i + 1 < n - 1) out.push({ kind: 'elbow', index: i + 1, x: b.x, y: b.y });
  }
  out.push({ kind: 'to', index: n - 1, x: points[n - 1]!.x, y: points[n - 1]!.y });
  return out;
}

/** The handle under a point, within `tolerance` world pixels, preferring ends and elbows over segments. */
export function handleAt(handles: readonly WireHandle[], x: number, y: number, tolerance: number): WireHandle | null {
  let best: WireHandle | null = null;
  let bestScore = Infinity;
  for (const h of handles) {
    const d = Math.max(Math.abs(h.x - x), Math.abs(h.y - y));
    if (d > tolerance) continue;
    const score = d + (h.kind === 'segment' ? 0.5 : 0);
    if (score < bestScore) { bestScore = score; best = h; }
  }
  return best;
}
