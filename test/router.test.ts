import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { footprintOf, type Board } from '../packages/shared/types.js';
import { buildRouteGrid, routeAStar, type RouteObstacle } from '../src/renderer/board/router.js';
import { HALF_GRID, attachEndpoints, segmentRects, type Point } from '../src/renderer/board/traces.js';

const TILE = 16;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '.snapshots') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.board.json')) out.push(p);
  }
  return out;
}

const boards = walk(join(process.cwd(), 'board')).map((f) => JSON.parse(readFileSync(f, 'utf8')) as Board);

function obstaclesOf(board: Board): RouteObstacle[] {
  return board.nodes
    .filter((n) => n.kind !== 'note.silk' && n.kind !== 'group.zone')
    .map((n) => {
      const fp = footprintOf(n);
      return {
        nodeId: n.id,
        x: n.pos.x * TILE,
        y: n.pos.y * TILE,
        w: Math.max(TILE, fp.w * TILE),
        h: Math.max(TILE, fp.h * TILE)
      };
    });
}

function boardPxOf(board: Board) {
  return { width: board.grid.width * TILE, height: board.grid.height * TILE };
}

function isOrthogonal(points: Point[]): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (a.x !== b.x && a.y !== b.y) return false;
  }
  return true;
}

/** Does any 1px-wide segment of this route pass through the interior of a foreign footprint? */
function crossings(points: Point[], obstacles: RouteObstacle[], from: string, to: string): string[] {
  const hits = new Set<string>();
  for (const rect of segmentRects(points, 1)) {
    for (const o of obstacles) {
      if (o.nodeId === from || o.nodeId === to) continue;
      // Inset by one half-grid cell: a trace is allowed to graze an edge, not to cut through.
      const ix = o.x + HALF_GRID;
      const iy = o.y + HALF_GRID;
      const iw = o.w - 2 * HALF_GRID;
      const ih = o.h - 2 * HALF_GRID;
      if (iw <= 0 || ih <= 0) continue;
      if (rect.x < ix + iw && rect.x + rect.w > ix && rect.y < iy + ih && rect.y + rect.h > iy) {
        hits.add(o.nodeId);
      }
    }
  }
  return [...hits];
}

describe('A* router on the real seeded boards', () => {
  for (const board of boards) {
    describe(board.id, () => {
      const obstacles = obstaclesOf(board);
      const boardPx = boardPxOf(board);
      const grid = buildRouteGrid(obstacles, boardPx);
      const rectById = new Map(obstacles.map((o) => [o.nodeId, o] as const));

      const auto = board.edges.filter((e) => !e.waypoints?.length);

      it('has traces to route', () => {
        expect(auto.length).toBeGreaterThan(0);
      });

      it('routes every trace without cutting through another component', () => {
        const problems: string[] = [];
        for (const edge of auto) {
          const from = rectById.get(edge.from);
          const to = rectById.get(edge.to);
          if (!from || !to) continue;
          const path = routeAStar({ from, to, obstacles, boardPx }, grid);
          if (!path) { problems.push(`${edge.id}: no route found`); continue; }
          const points = attachEndpoints(path, from, to);
          const through = crossings(points, obstacles, edge.from, edge.to);
          if (through.length) problems.push(`${edge.id} passes through ${through.join(', ')}`);
        }
        expect(problems).toEqual([]);
      });

      it('emits only orthogonal segments', () => {
        for (const edge of auto) {
          const from = rectById.get(edge.from);
          const to = rectById.get(edge.to);
          if (!from || !to) continue;
          const path = routeAStar({ from, to, obstacles, boardPx }, grid);
          if (!path) continue;
          expect(isOrthogonal(attachEndpoints(path, from, to)), `${edge.id} has a diagonal`).toBe(true);
        }
      });

      it('keeps every point on the 8px half-grid and on whole pixels', () => {
        for (const edge of auto) {
          const from = rectById.get(edge.from);
          const to = rectById.get(edge.to);
          if (!from || !to) continue;
          const path = routeAStar({ from, to, obstacles, boardPx }, grid);
          if (!path) continue;
          for (const p of attachEndpoints(path, from, to)) {
            expect(Number.isInteger(p.x)).toBe(true);
            expect(Number.isInteger(p.y)).toBe(true);
            expect(p.x % HALF_GRID).toBe(0);
            expect(p.y % HALF_GRID).toBe(0);
          }
        }
      });

      it('is deterministic — same board in, same copper out', () => {
        for (const edge of auto.slice(0, 4)) {
          const from = rectById.get(edge.from);
          const to = rectById.get(edge.to);
          if (!from || !to) continue;
          const a = routeAStar({ from, to, obstacles, boardPx }, grid);
          const b = routeAStar({ from, to, obstacles, boardPx }, grid);
          expect(a).toEqual(b);
        }
      });
    });
  }
});

describe('the specific bug this router was written to fix', () => {
  it('routes s1_repo_skynet -> j1_github around U2 instead of through it', () => {
    // On the root board these two endpoints line up horizontally across u2_agent_skynet, and the
    // M1 two-bend router drove a copper run straight through the middle of it.
    const root = boards.find((b) => b.id === 'root')!;
    const obstacles = obstaclesOf(root);
    const boardPx = boardPxOf(root);
    const grid = buildRouteGrid(obstacles, boardPx);
    const from = obstacles.find((o) => o.nodeId === 's1_repo_skynet')!;
    const to = obstacles.find((o) => o.nodeId === 'j1_github')!;

    const path = routeAStar({ from, to, obstacles, boardPx }, grid);
    expect(path).not.toBeNull();
    const points = attachEndpoints(path!, from, to);
    expect(crossings(points, obstacles, 's1_repo_skynet', 'j1_github')).toEqual([]);
  });
});

describe('turn penalty', () => {
  it('prefers a straight run over a staircase of equal length', () => {
    // Both are the same Manhattan distance. Without a turn penalty A* picks arbitrarily and
    // produces a staircase, which copper never does.
    const boardPx = { width: 640, height: 640 };
    const from: RouteObstacle = { nodeId: 'a', x: 32, y: 300, w: 32, h: 32 };
    const to: RouteObstacle = { nodeId: 'b', x: 480, y: 300, w: 32, h: 32 };
    const obstacles = [from, to];
    const grid = buildRouteGrid(obstacles, boardPx);
    const path = routeAStar({ from, to, obstacles, boardPx }, grid);
    expect(path).not.toBeNull();
    // A clear straight shot should collapse to exactly two corner points.
    expect(path!.length).toBe(2);
  });

  it('bends around a wall rather than giving up', () => {
    const boardPx = { width: 640, height: 640 };
    const from: RouteObstacle = { nodeId: 'a', x: 32, y: 300, w: 32, h: 32 };
    const to: RouteObstacle = { nodeId: 'b', x: 480, y: 300, w: 32, h: 32 };
    const wall: RouteObstacle = { nodeId: 'wall', x: 240, y: 160, w: 32, h: 320 };
    const obstacles = [from, to, wall];
    const grid = buildRouteGrid(obstacles, boardPx);
    const path = routeAStar({ from, to, obstacles, boardPx }, grid);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(2);
    expect(crossings(attachEndpoints(path!, from, to), obstacles, 'a', 'b')).toEqual([]);
  });

  it('returns null when the target is fully walled in, rather than hanging', () => {
    const boardPx = { width: 320, height: 320 };
    const from: RouteObstacle = { nodeId: 'a', x: 16, y: 16, w: 32, h: 32 };
    const to: RouteObstacle = { nodeId: 'b', x: 160, y: 160, w: 32, h: 32 };
    const walls: RouteObstacle[] = [
      { nodeId: 'w1', x: 144, y: 144, w: 64, h: 16 },
      { nodeId: 'w2', x: 144, y: 192, w: 64, h: 16 },
      { nodeId: 'w3', x: 144, y: 144, w: 16, h: 64 },
      { nodeId: 'w4', x: 192, y: 144, w: 16, h: 64 }
    ];
    const obstacles = [from, to, ...walls];
    const grid = buildRouteGrid(obstacles, boardPx);
    expect(routeAStar({ from, to, obstacles, boardPx }, grid)).toBeNull();
  });
});
