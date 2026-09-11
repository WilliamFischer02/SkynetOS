import { describe, expect, it } from 'vitest';
import {
  courierHub,
  elbowPath,
  joinOrthogonal,
  pathLength,
  pointAt,
  wirePath,
  type Wire
} from '../src/renderer/board/courier-paths.js';
import type { Point } from '../src/renderer/board/traces.js';

/**
 * The couriers' roads. William: "the bots don't follow the wires; their base paths should be
 * along drawn or generated wires, so the wires are the paths basically."
 *
 * The rule that matters most is the one the whole board is built on: no diagonal, ever. A road
 * assembled from several traces has joins in it, and a join is exactly where a diagonal would
 * sneak in.
 */

const orthogonal = (points: Point[]): boolean =>
  points.every((p, i) => i === 0 || p.x === points[i - 1]!.x || p.y === points[i - 1]!.y);

// Three nodes in a row, A - B - C, wired A->B and C->B (the second drawn backwards on purpose).
const ab: Wire = { id: 'e1', from: 'A', to: 'B', points: [{ x: 32, y: 40 }, { x: 96, y: 40 }] };
const cb: Wire = { id: 'e2', from: 'C', to: 'B', points: [{ x: 200, y: 88 }, { x: 160, y: 88 }, { x: 160, y: 56 }, { x: 128, y: 56 }] };

describe('geometry', () => {
  it('measures an orthogonal path', () => {
    expect(pathLength([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }])).toBe(15);
  });

  it('finds the point a distance along it, and which way that stretch runs', () => {
    const path = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }];
    expect(pointAt(path, 5)).toEqual({ x: 5, y: 0, horizontal: true, along: 0.5 });
    expect(pointAt(path, 20)).toEqual({ x: 10, y: 10, horizontal: false, along: 0.5 });
  });

  it('stops at the end rather than walking off it', () => {
    const path = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(pointAt(path, 999)).toMatchObject({ x: 10, y: 0 });
  });

  it('bridges two traces that meet on different faces of a chip with an elbow, not a diagonal', () => {
    const joined = joinOrthogonal([{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 20, y: 30 }, { x: 40, y: 30 }]);
    expect(orthogonal(joined)).toBe(true);
    expect(joined).toContainEqual({ x: 20, y: 0 });
  });
});

describe('the road along the wires', () => {
  it('walks every trace between the hub and the destination, through the chip in between', () => {
    const path = wirePath('A', 'C', [ab, cb]);
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ x: 32, y: 40 });
    // It arrives at C's end of the second trace, which was drawn from C, so it was walked backwards.
    expect(path![path!.length - 1]).toEqual({ x: 200, y: 88 });
    expect(orthogonal(path!)).toBe(true);
    // Every point of both traces is on the road.
    for (const p of [...ab.points, ...cb.points]) expect(path).toContainEqual(p);
  });

  it('takes the shorter of two ways round', () => {
    const long: Wire = { id: 'x', from: 'A', to: 'C', points: [{ x: 0, y: 0 }, { x: 0, y: 900 }, { x: 900, y: 900 }] };
    const path = wirePath('A', 'C', [long, ab, cb])!;
    expect(pathLength(path)).toBeLessThan(pathLength(long.points));
  });

  it('is null when the wires do not join the two, so the caller can generate a road', () => {
    expect(wirePath('A', 'Z', [ab, cb])).toBeNull();
    expect(wirePath('A', 'A', [ab])).toBeNull();
  });

  it('chooses the same road every time for the same board', () => {
    const twin: Wire = { ...ab, id: 'e9' };
    expect(wirePath('A', 'B', [ab, twin])).toEqual(wirePath('A', 'B', [ab, twin]));
  });
});

describe('where couriers set off from', () => {
  it('is the JARVIS head when the board has one, wired or not', () => {
    const nodes = [{ id: 'A', kind: 'agent.code' }, { id: 'J', kind: 'agent.jarvis' }];
    expect(courierHub(nodes, [ab])).toBe('J');
  });

  it('is the best-connected node inside a room', () => {
    const nodes = [{ id: 'A', kind: 'agent.code' }, { id: 'B', kind: 'store.repo' }, { id: 'C', kind: 'agent.code' }];
    expect(courierHub(nodes, [ab, cb])).toBe('B');
  });

  it('is nobody on a board with no wiring', () => {
    expect(courierHub([{ id: 'A', kind: 'agent.code' }], [])).toBeNull();
  });
});

describe('the last resort', () => {
  it('is an L, horizontal first', () => {
    expect(elbowPath({ x: 0, y: 0 }, { x: 10, y: 20 })).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }]);
  });
});
