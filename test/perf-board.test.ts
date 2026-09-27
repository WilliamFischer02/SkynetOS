import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { footprintOf, isPrinted, type Board } from '../packages/shared/types.js';
import { layoutRects } from '../src/renderer/board/layout.js';
import { buildRouteGrid, routeAStar, type RouteObstacle } from '../src/renderer/board/router.js';
import { validateBoard } from '../src/main/services/board-store.js';

/*
 * Where a room's open time goes, per board, in numbers rather than adjectives (2026-09-26 audit).
 *
 * The three pure stages a `board:load` pays before anything is drawn: parse + schema validation
 * (main), the hit-test layout (renderer), and the auto-router for every unrouted trace (renderer).
 * The bounds are generous on purpose: this test exists to PRINT the table on every run and to
 * fail only when something becomes an order of magnitude slower, not to flake on a busy machine.
 */

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

function obstaclesOf(board: Board): RouteObstacle[] {
  return board.nodes
    .filter((n) => !isPrinted(n.kind))
    .map((n) => {
      const fp = footprintOf(n);
      return { nodeId: n.id, x: n.pos.x * TILE, y: n.pos.y * TILE, w: Math.max(TILE, fp.w * TILE), h: Math.max(TILE, fp.h * TILE) };
    });
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

const files = walk(join(process.cwd(), 'board'));

describe('board load cost, per board', () => {
  const rows: string[] = [];

  it.each(files.map((f) => [f.replace(process.cwd(), '').replace(/\\/g, '/'), f] as const))('%s', (_label, file) => {
    const text = readFileSync(file, 'utf8');
    const RUNS = 5;
    const parseMs: number[] = [];
    const layoutMs: number[] = [];
    const routeMs: number[] = [];
    let board!: Board;
    let routed = 0;
    for (let i = 0; i < RUNS; i++) {
      let t = performance.now();
      const parsed = JSON.parse(text) as unknown;
      const problems = validateBoard(parsed);
      parseMs.push(performance.now() - t);
      expect(problems).toEqual([]);
      board = parsed as Board;

      t = performance.now();
      layoutRects(board, true);
      layoutMs.push(performance.now() - t);

      t = performance.now();
      const obstacles = obstaclesOf(board);
      const boardPx = { width: board.grid.width * TILE, height: board.grid.height * TILE };
      const grid = buildRouteGrid(obstacles, boardPx);
      const rectById = new Map(obstacles.map((o) => [o.nodeId, o] as const));
      routed = 0;
      for (const edge of board.edges.filter((e) => !e.waypoints?.length)) {
        const from = rectById.get(edge.from);
        const to = rectById.get(edge.to);
        if (!from || !to) continue;
        routeAStar({ from, to, obstacles, boardPx }, grid);
        routed++;
      }
      routeMs.push(performance.now() - t);
    }
    const row = `${board.id.padEnd(12)} ${String(board.nodes.length).padStart(3)} nodes ${String(routed).padStart(3)} routed | parse+validate ${median(parseMs).toFixed(1).padStart(6)} ms | layout ${median(layoutMs).toFixed(1).padStart(6)} ms | route ${median(routeMs).toFixed(1).padStart(7)} ms`;
    rows.push(row);
    console.log(`[perf] ${row}`);
    expect(median(parseMs)).toBeLessThan(250);
    expect(median(layoutMs)).toBeLessThan(150);
    expect(median(routeMs)).toBeLessThan(2500);
  });
});
