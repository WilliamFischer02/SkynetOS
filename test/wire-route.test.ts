import { describe, expect, it } from 'vitest';
import type { BoardEdge } from '../packages/shared/types.js';
import { attachEndpoints, type Point } from '../src/renderer/board/traces.js';
import { buildRouteGrid, routeAStar, type RouteObstacle } from '../src/renderer/board/router.js';
import { anchorPoint } from '../src/renderer/board/wire-geometry.js';
import { routeEdge } from '../src/renderer/board/wire-route.js';

/**
 * One wire's route, automatic or shaped by hand. A wire nobody touched routes exactly as before;
 * a pinned end starts on its node's edge; waypoints are passed through in order, around obstacles.
 */

const boardPx = { width: 640, height: 480 };
const a: RouteObstacle = { nodeId: 'a', x: 32, y: 48, w: 64, h: 48 };
const b: RouteObstacle = { nodeId: 'b', x: 448, y: 320, w: 64, h: 48 };
const wall: RouteObstacle = { nodeId: 'wall', x: 224, y: 0, w: 32, h: 400 };
const obstacles = [a, b, wall];
const grid = buildRouteGrid(obstacles, boardPx);
const ctx = { grid, obstacles, boardPx, tile: 16 };
const edge = (over: Partial<BoardEdge> = {}): BoardEdge => ({ id: 'e1', from: 'a', to: 'b', kind: 'reads', ...over });

const isOrthogonal = (points: readonly Point[]): boolean =>
  points.every((p, i) => i === 0 || p.x === points[i - 1]!.x || p.y === points[i - 1]!.y);
/** Does the polyline pass through this point, on a segment or at a corner? */
const passesThrough = (points: readonly Point[], q: Point): boolean =>
  points.some((p, i) => {
    if (i === 0) return p.x === q.x && p.y === q.y;
    const o = points[i - 1]!;
    return (o.x === p.x && p.x === q.x && q.y >= Math.min(o.y, p.y) && q.y <= Math.max(o.y, p.y)) ||
      (o.y === p.y && p.y === q.y && q.x >= Math.min(o.x, p.x) && q.x <= Math.max(o.x, p.x));
  });

describe('routeEdge', () => {
  it('routes an untouched wire exactly as the board always has', () => {
    const route = routeEdge(edge(), a, b, ctx);
    const path = routeAStar({ from: a, to: b, obstacles, boardPx }, grid)!;
    expect(route.points).toEqual(attachEndpoints(path, a, b));
    expect(route.routed).toBe(true);
  });

  it('starts and ends a pinned wire exactly at its anchors, leaving along each side', () => {
    const fromAnchor = { side: 'bottom' as const, offset: 0.25 };
    const toAnchor = { side: 'top' as const, offset: 0.75 };
    const route = routeEdge(edge({ fromAnchor, toAnchor }), a, b, ctx);
    const start = anchorPoint(a, fromAnchor);
    const end = anchorPoint(b, toAnchor);
    expect(route.points[0]).toEqual(start);
    expect(route.points[route.points.length - 1]).toEqual(end);
    expect(isOrthogonal(route.points)).toBe(true);
    // Leaves the bottom side going down, arrives at the top side coming down.
    expect(route.points[1]!.x).toBe(start.x);
    expect(route.points[1]!.y).toBeGreaterThan(start.y);
    const pen = route.points[route.points.length - 2]!;
    expect(pen.x).toBe(end.x);
    expect(pen.y).toBeLessThan(end.y);
  });

  it('passes through every waypoint, in order, and stays orthogonal', () => {
    const waypoints: [number, number][] = [[10, 26], [20, 26]];
    const route = routeEdge(edge({ waypoints }), a, b, ctx);
    expect(isOrthogonal(route.points)).toBe(true);
    for (const [x, y] of waypoints) expect(passesThrough(route.points, { x: x * 16, y: y * 16 }), `${x},${y}`).toBe(true);
  });

  it('routes each leg around a component, not through it', () => {
    // The wall stands between the two waypoints' columns; the leg must go under it (y > 400).
    const route = routeEdge(edge({ waypoints: [[8, 10], [20, 10]] }), a, b, ctx);
    expect(isOrthogonal(route.points)).toBe(true);
    const insideWall = route.points.some((p, i) => {
      if (i === 0) return false;
      const o = route.points[i - 1]!;
      const minX = Math.min(o.x, p.x); const maxX = Math.max(o.x, p.x);
      const minY = Math.min(o.y, p.y); const maxY = Math.max(o.y, p.y);
      return maxX > wall.x && minX < wall.x + wall.w && maxY > wall.y && minY < wall.y + wall.h;
    });
    expect(insideWall).toBe(false);
  });

  it('draws a plain elbow for a leg nothing can reach, rather than dropping the wire', () => {
    const boxed = buildRouteGrid([...obstacles, { nodeId: 'box', x: 0, y: 0, w: 640, h: 480 }], boardPx);
    const route = routeEdge(edge({ waypoints: [[20, 26]] }), a, b, { ...ctx, grid: boxed });
    expect(route.points.length).toBeGreaterThanOrEqual(2);
    expect(isOrthogonal(route.points)).toBe(true);
  });
});
