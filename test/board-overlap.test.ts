import { describe, expect, it } from 'vitest';
import type { BoardNode } from '../packages/shared/types.js';
import { checkBoard, overlaps } from '../prime/tools/board-overlap.js';

const node = (id: string, kind: BoardNode['kind'], x: number, y: number, footprint?: { w: number; h: number }): BoardNode =>
  ({ id, kind, name: id, pos: { x, y }, ...(footprint ? { footprint } : {}) }) as BoardNode;

describe('board-overlap (prime/tools)', () => {
  it('sees two boxes touch only when they share a cell', () => {
    expect(overlaps({ id: 'a', x: 0, y: 0, w: 2, h: 2 }, { id: 'b', x: 2, y: 0, w: 2, h: 2 })).toBe(false);
    expect(overlaps({ id: 'a', x: 0, y: 0, w: 2, h: 2 }, { id: 'b', x: 1, y: 1, w: 2, h: 2 })).toBe(true);
  });

  it('reports every overlapping pair of mounted nodes by id', () => {
    const board = { grid: { width: 40, height: 40 }, nodes: [node('a', 'store.repo', 0, 0), node('b', 'store.repo', 2, 1), node('c', 'store.repo', 20, 20)] };
    expect(checkBoard(board).pairs).toEqual([['a', 'b']]);
  });

  it('ignores printed kinds, which occupy nothing, whatever footprint they carry', () => {
    // A zone or a screw carries a footprint for its own drawing; the real boards are full of them.
    const board = {
      nodes: [
        node('a', 'store.repo', 0, 0),
        node('z', 'group.zone', 0, 0, { w: 20, h: 20 }),
        node('s', 'decor.part', 0, 0, { w: 1, h: 1 }),
        node('n', 'note.silk', 1, 1)
      ]
    };
    expect(checkBoard(board).pairs).toEqual([]);
  });

  it('names a node that leaves the grid, and trusts an explicit footprint over the default', () => {
    const board = { grid: { width: 10, height: 10 }, nodes: [node('big', 'link.url', 8, 8, { w: 4, h: 1 }), node('fits', 'link.url', 8, 0)] };
    expect(checkBoard(board).outside).toEqual(['big']);
  });

  it('is quiet on an empty board and one with no grid', () => {
    expect(checkBoard({})).toEqual({ pairs: [], outside: [] });
    expect(checkBoard({ nodes: [node('a', 'store.repo', 999, 999)] }).outside).toEqual([]);
  });
});
