/**
 * The trace auto-router.
 *
 * Replaces the M1 placeholder, which drew a two-bend Z with no idea what was in the way — you
 * could watch the `s1_repo_skynet -> j1_github` run pass straight through U2 on the root board.
 *
 * This is A* on the 8px half-grid with node footprints as obstacles, which is close to what a
 * real autorouter does. Three details do the aesthetic work:
 *
 *   1. **A turn penalty.** Without one, A* returns a staircase — every step alternating axis,
 *      because a staircase and an L are the same length on a grid. Copper does not staircase.
 *      Charging for a direction change makes long straight runs strictly cheaper.
 *   2. **Endpoints are exempt from their own obstacle.** A trace has to start and end inside the
 *      component it connects to, so both pads are carved out of the obstacle map.
 *   3. **A deterministic tie-break.** Same board in, same copper out, every launch — otherwise a
 *      screenshot diff is worthless and the board looks different every time you open it.
 *
 * Pure: no Pixi, no DOM. test/router.test.ts proves the routes are orthogonal, obstacle-free and
 * stable.
 */

import type { Point, Rect } from './traces.js';
import { HALF_GRID } from './traces.js';

export interface RouteObstacle extends Rect {
  nodeId: string;
}

export interface RouteRequest {
  from: RouteObstacle;
  to: RouteObstacle;
  obstacles: RouteObstacle[];
  /** Board extent in world pixels. */
  boardPx: { width: number; height: number };
}

/** Cost of changing direction, in grid steps. 3 is enough to make an L beat a staircase. */
const TURN_COST = 3;
/** Cost of running through a cell adjacent to an obstacle — keeps copper off component edges. */
const HUG_COST = 2;
/** Give up rather than hang if a board is pathological. 200k nodes is far beyond any real room. */
const MAX_EXPANSIONS = 200_000;

const DIRS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 }
] as const;

/** Minimal binary heap. A sorted array turns routing a dense room into seconds. */
class MinHeap {
  private readonly heap: { key: number; value: number }[] = [];

  get size(): number { return this.heap.length; }

  push(key: number, value: number): void {
    this.heap.push({ key, value });
    let i = this.heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[parent]!.key <= this.heap[i]!.key) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i]!, this.heap[parent]!];
      i = parent;
    }
  }

  pop(): number | undefined {
    const top = this.heap[0];
    if (!top) return undefined;
    const last = this.heap.pop()!;
    if (this.heap.length) {
      this.heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.heap.length && this.heap[l]!.key < this.heap[smallest]!.key) smallest = l;
        if (r < this.heap.length && this.heap[r]!.key < this.heap[smallest]!.key) smallest = r;
        if (smallest === i) break;
        [this.heap[smallest], this.heap[i]] = [this.heap[i]!, this.heap[smallest]!];
        i = smallest;
      }
    }
    return top.value;
  }
}

export interface RouteGrid {
  cols: number;
  rows: number;
  /** 0 = free, 1 = blocked, 2 = adjacent to a blocked cell. */
  cells: Uint8Array;
}

/** Build the obstacle map once per board, then route every edge against it. */
export function buildRouteGrid(
  obstacles: RouteObstacle[],
  boardPx: { width: number; height: number }
): RouteGrid {
  const cols = Math.ceil(boardPx.width / HALF_GRID) + 1;
  const rows = Math.ceil(boardPx.height / HALF_GRID) + 1;
  const cells = new Uint8Array(cols * rows);

  for (const o of obstacles) {
    const x0 = Math.floor(o.x / HALF_GRID);
    const y0 = Math.floor(o.y / HALF_GRID);
    const x1 = Math.ceil((o.x + o.w) / HALF_GRID);
    const y1 = Math.ceil((o.y + o.h) / HALF_GRID);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
        cells[y * cols + x] = 1;
      }
    }
  }

  // Mark the halo separately so routing can prefer to keep its distance without being forbidden
  // from squeezing through a one-cell gap when that is the only way past.
  const halo = new Uint8Array(cells);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (cells[y * cols + x] !== 1) continue;
      for (const d of DIRS) {
        const nx = x + d.dx;
        const ny = y + d.dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (halo[ny * cols + nx] === 0) halo[ny * cols + nx] = 2;
      }
    }
  }

  return { cols, rows, cells: halo };
}

/** Carve a rect back out of the grid, so a trace may enter its own endpoints. */
function carve(grid: RouteGrid, rect: Rect, out: Set<number>): void {
  const x0 = Math.floor(rect.x / HALF_GRID);
  const y0 = Math.floor(rect.y / HALF_GRID);
  const x1 = Math.ceil((rect.x + rect.w) / HALF_GRID);
  const y1 = Math.ceil((rect.y + rect.h) / HALF_GRID);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (x < 0 || y < 0 || x >= grid.cols || y >= grid.rows) continue;
      out.add(y * grid.cols + x);
    }
  }
}

/** Centre of a rect, snapped to the half-grid, as grid coordinates. */
function centreCell(rect: Rect, grid: RouteGrid): { x: number; y: number } {
  return {
    x: Math.min(grid.cols - 1, Math.max(0, Math.round((rect.x + rect.w / 2) / HALF_GRID))),
    y: Math.min(grid.rows - 1, Math.max(0, Math.round((rect.y + rect.h / 2) / HALF_GRID)))
  };
}

/**
 * A* with a turn penalty. State is (cell, incoming direction), so a turn can be charged for —
 * plain cell-based A* cannot express "arriving here going east costs less than going north".
 */
export function routeAStar(request: RouteRequest, grid: RouteGrid): Point[] | null {
  const { cols, rows, cells } = grid;
  const start = centreCell(request.from, grid);
  const goal = centreCell(request.to, grid);
  if (start.x === goal.x && start.y === goal.y) return null;

  const passable = new Set<number>();
  carve(grid, request.from, passable);
  carve(grid, request.to, passable);

  const isFree = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return false;
    const i = y * cols + x;
    return cells[i] !== 1 || passable.has(i);
  };
  const penalty = (x: number, y: number): number => {
    const i = y * cols + x;
    return cells[i] === 2 && !passable.has(i) ? HUG_COST : 0;
  };

  // 5 direction slots: 0-3 are DIRS, 4 is "no direction yet" at the start.
  const stateCount = cols * rows * 5;
  const gScore = new Float64Array(stateCount).fill(Infinity);
  const cameFrom = new Int32Array(stateCount).fill(-1);
  const open = new MinHeap();

  const startState = (start.y * cols + start.x) * 5 + 4;
  gScore[startState] = 0;
  open.push(Math.abs(goal.x - start.x) + Math.abs(goal.y - start.y), startState);

  const closed = new Uint8Array(stateCount);
  let expansions = 0;
  let goalState = -1;

  while (open.size) {
    const state = open.pop()!;
    if (closed[state]) continue;
    closed[state] = 1;
    if (++expansions > MAX_EXPANSIONS) break;

    const cell = Math.floor(state / 5);
    const dir = state % 5;
    const x = cell % cols;
    const y = Math.floor(cell / cols);

    if (x === goal.x && y === goal.y) { goalState = state; break; }

    for (let d = 0; d < 4; d++) {
      const nx = x + DIRS[d]!.dx;
      const ny = y + DIRS[d]!.dy;
      if (!isFree(nx, ny)) continue;

      const nextState = (ny * cols + nx) * 5 + d;
      if (closed[nextState]) continue;

      const turn = dir !== 4 && dir !== d ? TURN_COST : 0;
      const tentative = gScore[state]! + 1 + turn + penalty(nx, ny);
      if (tentative >= gScore[nextState]!) continue;

      gScore[nextState] = tentative;
      cameFrom[nextState] = state;
      open.push(tentative + Math.abs(goal.x - nx) + Math.abs(goal.y - ny), nextState);
    }
  }

  if (goalState < 0) return null;

  const cellsOut: { x: number; y: number }[] = [];
  for (let s = goalState; s >= 0; s = cameFrom[s]!) {
    const cell = Math.floor(s / 5);
    cellsOut.push({ x: cell % cols, y: Math.floor(cell / cols) });
    if (cameFrom[s] === -1) break;
  }
  cellsOut.reverse();

  // Collapse the per-cell path down to its corners. A trace is a handful of segments, not
  // hundreds of one-cell steps, and everything downstream draws segments.
  const points: Point[] = [];
  for (let i = 0; i < cellsOut.length; i++) {
    const prev = cellsOut[i - 1];
    const cur = cellsOut[i]!;
    const next = cellsOut[i + 1];
    const isCorner =
      !prev || !next ||
      (cur.x - prev.x !== next.x - cur.x) || (cur.y - prev.y !== next.y - cur.y);
    if (isCorner) points.push({ x: cur.x * HALF_GRID, y: cur.y * HALF_GRID });
  }

  return points.length >= 2 ? points : null;
}
