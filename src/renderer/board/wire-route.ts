/**
 * One wire's route: automatic, or shaped by hand.
 *
 * With no pins and no waypoints this is exactly the router the board has always had, A* between the
 * two nodes' centres with its endpoints moved out to the nearest faces, and the two-bend Z when A*
 * finds nothing. A wire nobody has touched looks the same as it always did.
 *
 * A PINNED end (`fromAnchor` / `toAnchor`) starts or finishes at that point on the node's edge,
 * leaving along the side's outward axis through a one-step stub. WAYPOINTS are routed through in
 * order, each leg its own A* run with the usual turn penalty, so a hand-shaped wire still goes around
 * components between the corners it was given. A leg A* cannot find is drawn as a plain elbow rather
 * than dropped.
 *
 * Pure: no Pixi, no DOM. test/wire-route.test.ts holds it.
 */

import type { BoardEdge } from '@shared/types.js';
import { HALF_GRID, attachEndpoints, exitPoint, routeOrthogonal, type Point, type Rect } from './traces.js';
import { routeAStar, type RouteGrid, type RouteObstacle } from './router.js';
import { anchorPoint, outward } from './wire-geometry.js';
import { simplify } from './wire-lanes.js';

export interface RouteContext {
  grid: RouteGrid;
  obstacles: RouteObstacle[];
  boardPx: { width: number; height: number };
  /** World pixels per tile: waypoints are stored in tiles. */
  tile: number;
}

export interface EdgeRoute {
  points: Point[];
  /** Every leg was found by A*. */
  routed: boolean;
  /** At least one leg fell back to a plain elbow. */
  fellBack: boolean;
}

const snap = (v: number): number => Math.round(v / HALF_GRID) * HALF_GRID;
const centre = (r: Rect): Point => ({ x: snap(r.x + r.w / 2), y: snap(r.y + r.h / 2) });

function elbow(a: Point, b: Point): Point[] {
  if (a.x === b.x && a.y === b.y) return [a];
  if (a.x === b.x || a.y === b.y) return [a, b];
  return [a, { x: b.x, y: a.y }, b];
}

/** Keep every corner of a path orthogonal, whatever the legs did at their joins. */
function orthogonal(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && prev.x !== p.x && prev.y !== p.y) out.push({ x: p.x, y: prev.y });
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

export function routeEdge(edge: BoardEdge, from: Rect, to: Rect, ctx: RouteContext): EdgeRoute {
  const fromObstacle: RouteObstacle = { ...from, nodeId: edge.from };
  const toObstacle: RouteObstacle = { ...to, nodeId: edge.to };
  const waypoints = edge.waypoints ?? [];

  if (!edge.fromAnchor && !edge.toAnchor && !waypoints.length) {
    const path = routeAStar({ from: fromObstacle, to: toObstacle, obstacles: ctx.obstacles, boardPx: ctx.boardPx }, ctx.grid);
    if (path) return { points: attachEndpoints(path, from, to), routed: true, fellBack: false };
    return { points: routeOrthogonal(from, to, undefined, ctx.tile), routed: false, fellBack: true };
  }

  const startPin = edge.fromAnchor ? anchorPoint(from, edge.fromAnchor) : null;
  const endPin = edge.toAnchor ? anchorPoint(to, edge.toAnchor) : null;
  const stub = (pin: Point, side: NonNullable<BoardEdge['fromAnchor']>['side']): Point => {
    const d = outward(side);
    return { x: pin.x + d.dx * HALF_GRID, y: pin.y + d.dy * HALF_GRID };
  };
  const first = startPin && edge.fromAnchor ? stub(startPin, edge.fromAnchor.side) : centre(from);
  const last = endPin && edge.toAnchor ? stub(endPin, edge.toAnchor.side) : centre(to);
  const stops: Point[] = [first, ...waypoints.map(([x, y]) => ({ x: snap(x * ctx.tile), y: snap(y * ctx.tile) })), last];

  let routed = true;
  const path: Point[] = [];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]!;
    const b = stops[i]!;
    /*
     * Only a leg that starts at `from`'s centre may carve through `from`, and only one that ends at
     * `to`'s centre through `to`. A pinned end is reached from outside its node, the way it faces,
     * never by cutting through the node to get round to it.
     */
    const carveFrom = i === 1 && !startPin;
    const carveTo = i === stops.length - 1 && !endPin;
    const leg = a.x === b.x && a.y === b.y
      ? [a]
      : routeAStar(
        { from: fromObstacle, to: toObstacle, obstacles: ctx.obstacles, boardPx: ctx.boardPx, start: a, goal: b, carveFrom, carveTo },
        ctx.grid
      );
    const pts = leg ?? elbow(a, b);
    if (!leg) routed = false;
    path.push(...(path.length ? pts.slice(1) : pts));
  }

  let points = simplify(orthogonal(path));
  if (startPin) points = [startPin, ...points];
  else if (points.length >= 2) points = [exitPoint(from, points[1]!, points[0]!.y === points[1]!.y), ...points.slice(1)];
  if (endPin) points = [...points, endPin];
  else if (points.length >= 2) {
    const pen = points[points.length - 2]!;
    const tail = points[points.length - 1]!;
    points = [...points.slice(0, -1), exitPoint(to, pen, tail.y === pen.y)];
  }
  return { points: simplify(orthogonal(points)), routed, fellBack: !routed };
}
