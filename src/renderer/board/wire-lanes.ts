/**
 * Wires that share a run are drawn side by side, and a wire can be picked out by clicking it.
 *
 * William: "make sure the software detects overlapping wires and I want it to create the
 * appearance both wires are run parallel." The router lays every trace on the 8px half-grid, so
 * two traces heading the same way through the same gap land on exactly the same line and draw as
 * one thicker wire. Nobody can tell there are two, or which one goes where.
 *
 * `separateParallel` finds those shared runs and moves each wire onto its own lane beside the
 * others, the way a real board runs a bus. It shifts a whole segment across its own axis. Each
 * corner joins one horizontal and one vertical segment, and a shift only ever moves a corner along
 * the axis its segment crosses, so the neighbouring segments stretch or shrink and stay orthogonal.
 * No diagonal can appear, which is the rule the whole board is built on.
 *
 * Pure: no Pixi, no DOM. test/wire-lanes.test.ts holds it.
 */

import type { Point } from './traces.js';

export interface LaneRoute {
  id: string;
  points: Point[];
  /** Drawn width of the copper run, in px. The lanes are spaced by the widest run in a group. */
  width: number;
  /** The black edge on each side, in px (a wire's `outlineWidth`). Absent: OUTLINE_PX. */
  outline?: number;
}

/** Substrate left between two outlined runs, in px, so each wire's black edge stays visible. */
export const LANE_GAP = 1;

/** The outline every wire carries, in px on each side. See traces.ts `buildTraceLayer`. */
export const OUTLINE_PX = 1;

/**
 * Drop duplicate points and points in the middle of a straight run, so every vertex is a real
 * corner. The lane shift relies on each corner joining exactly one horizontal and one vertical
 * segment.
 */
export function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    const prev = out[out.length - 2];
    if (prev && last && ((prev.x === last.x && last.x === p.x) || (prev.y === last.y && last.y === p.y))) {
      out[out.length - 1] = { x: p.x, y: p.y };
      continue;
    }
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

interface Segment {
  id: string;
  /** Position of the route in the input, for a deterministic lane order. */
  order: number;
  /** Index of the segment's END point in the simplified polyline. */
  index: number;
  horizontal: boolean;
  lo: number;
  hi: number;
  width: number;
  outline: number;
}

/**
 * Give every wire in a shared run its own lane.
 *
 * Two segments share a run when they lie on the same line and their spans overlap by more than a
 * point. Touching end to end is not sharing, and neither is crossing. A run shared by n wires
 * spreads them symmetrically about the original line, spaced by the widest run plus both outlines
 * plus `gap`, in board order, so the same board always lays out the same way. Returns every route's
 * points, shifted where needed and untouched elsewhere.
 */
export function separateParallel(routes: readonly LaneRoute[], gap = LANE_GAP): Map<string, Point[]> {
  const paths = new Map<string, Point[]>();
  const groups = new Map<string, Segment[]>();

  routes.forEach((route, order) => {
    const points = simplify(route.points);
    paths.set(route.id, points);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const horizontal = a.y === b.y;
      if (!horizontal && a.x !== b.x) continue; // Not orthogonal: not ours to move.
      const lo = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
      const hi = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
      if (hi === lo) continue;
      const key = horizontal ? `h:${a.y}` : `v:${a.x}`;
      const list = groups.get(key) ?? [];
      list.push({ id: route.id, order, index: i, horizontal, lo, hi, width: route.width, outline: route.outline ?? OUTLINE_PX });
      groups.set(key, list);
    }
  });

  const shifts: { id: string; index: number; horizontal: boolean; offset: number }[] = [];

  for (const segments of groups.values()) {
    segments.sort((p, q) => p.lo - q.lo || p.order - q.order);
    let cluster: Segment[] = [];
    let reach = -Infinity;

    const flush = (): void => {
      const lanes = [...new Map(cluster.map((s) => [s.id, s.order] as const))]
        .sort((a, b) => a[1] - b[1])
        .map(([id]) => id);
      if (lanes.length > 1) {
        // The widest run INCLUDING its own outline, so a thick-edged wire never overlaps its neighbour's.
        const pitch = Math.max(...cluster.map((s) => s.width + 2 * s.outline)) + gap;
        lanes.forEach((id, lane) => {
          const offset = Math.round((lane - (lanes.length - 1) / 2) * pitch);
          if (offset === 0) return;
          for (const s of cluster) if (s.id === id) shifts.push({ id, index: s.index, horizontal: s.horizontal, offset });
        });
      }
      cluster = [];
      reach = -Infinity;
    };

    for (const segment of segments) {
      if (cluster.length && segment.lo >= reach) flush();
      cluster.push(segment);
      reach = Math.max(reach, segment.hi);
    }
    flush();
  }

  const out = new Map<string, Point[]>();
  for (const [id, points] of paths) out.set(id, points.map((p) => ({ x: p.x, y: p.y })));
  for (const shift of shifts) {
    const points = out.get(shift.id);
    const a = points?.[shift.index - 1];
    const b = points?.[shift.index];
    if (!a || !b) continue;
    if (shift.horizontal) { a.y += shift.offset; b.y += shift.offset; }
    else { a.x += shift.offset; b.x += shift.offset; }
  }
  return out;
}

/**
 * The wire under a point, or null.
 *
 * Nearest wins, within half its width plus `tolerance`. The caller passes the tolerance in world
 * pixels, scaled by zoom, so the target is the same number of screen pixels at every zoom, the way
 * port hovering works.
 */
export function wireAt(routes: readonly LaneRoute[], x: number, y: number, tolerance: number): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const route of routes) {
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1]!;
      const b = route.points[i]!;
      const lx = Math.min(a.x, b.x);
      const hx = Math.max(a.x, b.x);
      const ly = Math.min(a.y, b.y);
      const hy = Math.max(a.y, b.y);
      const dx = x < lx ? lx - x : x > hx ? x - hx : 0;
      const dy = y < ly ? ly - y : y > hy ? y - hy : 0;
      const distance = Math.hypot(dx, dy);
      if (distance <= route.width / 2 + tolerance && distance < bestDistance) {
        bestDistance = distance;
        best = route.id;
      }
    }
  }
  return best;
}
