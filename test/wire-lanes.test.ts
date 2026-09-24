import { describe, expect, it } from 'vitest';
import { LANE_GAP, OUTLINE_PX, separateParallel, simplify, wireAt, type LaneRoute } from '../src/renderer/board/wire-lanes.js';
import type { Point } from '../src/renderer/board/traces.js';

/**
 * Parallel runs. William: "make sure the software detects overlapping wires and I want it to create
 * the appearance both wires are run parallel."
 *
 * What must hold: two wires on the same line end up on different lines; wires that merely cross
 * or touch are left alone; and the result is still orthogonal, because a lane shift that tilted a
 * segment would put a diagonal on a board that has none.
 */

const orthogonal = (points: Point[]): boolean =>
  points.every((p, i) => i === 0 || p.x === points[i - 1]!.x || p.y === points[i - 1]!.y);

const route = (id: string, points: Point[], width = 2): LaneRoute => ({ id, points, width });

describe('simplify', () => {
  it('keeps only real corners', () => {
    expect(simplify([{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 8 }, { x: 16, y: 8 }]))
      .toEqual([{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 8 }]);
  });
});

describe('separateParallel', () => {
  it('puts two wires sharing a run onto two lanes, symmetric about the line', () => {
    const lanes = separateParallel([
      route('a', [{ x: 0, y: 40 }, { x: 100, y: 40 }]),
      route('b', [{ x: 20, y: 40 }, { x: 120, y: 40 }])
    ]);
    const ya = lanes.get('a')![0]!.y;
    const yb = lanes.get('b')![0]!.y;
    expect(ya).not.toBe(yb);
    // Pitch: the run, both outlines, and the gap, so the black edges never merge.
    expect(Math.abs(ya - yb)).toBe(2 + 2 * OUTLINE_PX + LANE_GAP);
    expect(Math.min(ya, yb)).toBeLessThan(40);
    expect(Math.max(ya, yb)).toBeGreaterThan(40);
  });

  it('spaces by the widest run in the group', () => {
    const lanes = separateParallel([
      route('thin', [{ x: 0, y: 0 }, { x: 0, y: 100 }], 2),
      route('wide', [{ x: 0, y: 10 }, { x: 0, y: 90 }], 4)
    ]);
    expect(Math.abs(lanes.get('thin')![0]!.x - lanes.get('wide')![0]!.x)).toBe(4 + 2 * OUTLINE_PX + LANE_GAP);
  });

  it('leaves wires that only cross, or only touch end to end, where they are', () => {
    const crossing = separateParallel([
      route('h', [{ x: 0, y: 40 }, { x: 100, y: 40 }]),
      route('v', [{ x: 50, y: 0 }, { x: 50, y: 100 }])
    ]);
    expect(crossing.get('h')).toEqual([{ x: 0, y: 40 }, { x: 100, y: 40 }]);
    expect(crossing.get('v')).toEqual([{ x: 50, y: 0 }, { x: 50, y: 100 }]);

    const touching = separateParallel([
      route('left', [{ x: 0, y: 40 }, { x: 50, y: 40 }]),
      route('right', [{ x: 50, y: 40 }, { x: 100, y: 40 }])
    ]);
    expect(touching.get('left')![0]!.y).toBe(40);
    expect(touching.get('right')![0]!.y).toBe(40);
  });

  it('stays orthogonal when the shared run is in the middle of an L', () => {
    // Both leave different nodes, share the horizontal stretch, then turn off to different ends.
    const lanes = separateParallel([
      route('a', [{ x: 0, y: 0 }, { x: 0, y: 40 }, { x: 100, y: 40 }, { x: 100, y: 80 }]),
      route('b', [{ x: 16, y: 0 }, { x: 16, y: 40 }, { x: 120, y: 40 }, { x: 120, y: 96 }])
    ]);
    for (const points of lanes.values()) expect(orthogonal(points)).toBe(true);
    expect(lanes.get('a')![1]!.y).not.toBe(lanes.get('b')![1]!.y);
    // The stretches before and after only changed length. They did not move sideways.
    expect(lanes.get('a')![0]!.x).toBe(0);
    expect(lanes.get('b')![3]!.x).toBe(120);
  });

  it('spreads three wires into three distinct lanes', () => {
    const lanes = separateParallel([
      route('a', [{ x: 0, y: 40 }, { x: 100, y: 40 }]),
      route('b', [{ x: 0, y: 40 }, { x: 100, y: 40 }]),
      route('c', [{ x: 0, y: 40 }, { x: 100, y: 40 }])
    ]);
    const ys = ['a', 'b', 'c'].map((id) => lanes.get(id)![0]!.y);
    expect(new Set(ys).size).toBe(3);
    expect(ys[1]).toBe(40);
  });

  it('lays out the same board the same way every time', () => {
    const input = [route('a', [{ x: 0, y: 40 }, { x: 100, y: 40 }]), route('b', [{ x: 0, y: 40 }, { x: 60, y: 40 }])];
    expect(separateParallel(input)).toEqual(separateParallel(input));
  });
});

describe('wireAt', () => {
  const wires = [route('a', [{ x: 0, y: 40 }, { x: 100, y: 40 }], 3), route('b', [{ x: 0, y: 46 }, { x: 100, y: 46 }], 3)];

  it('picks the wire under the point', () => {
    expect(wireAt(wires, 50, 40, 2)).toBe('a');
    expect(wireAt(wires, 50, 47, 2)).toBe('b');
  });

  it('picks the nearer of two close parallel wires', () => {
    expect(wireAt(wires, 50, 42, 3)).toBe('a');
    expect(wireAt(wires, 50, 44, 3)).toBe('b');
  });

  it('misses empty substrate', () => {
    expect(wireAt(wires, 50, 80, 2)).toBeNull();
    expect(wireAt(wires, 130, 40, 2)).toBeNull();
  });
});
