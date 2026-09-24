import { describe, expect, it } from 'vitest';
import { HALF_GRID, type Point, type Rect } from '../src/renderer/board/traces.js';
import {
  WIRE_GRID,
  anchorLabel,
  anchorPoint,
  dashPattern,
  dashPieces,
  handleAt,
  moveElbow,
  moveSegment,
  nearestAnchor,
  nudgeAnchor,
  slideAnchor,
  waypointsFrom,
  wireHandles
} from '../src/renderer/board/wire-geometry.js';

/**
 * Wire styles, pinned ends and hand-moved elbows. William: "add more wire type variations (dotted
 * and dashed and solid strokes and fills, stroke width modifier, and add the ability to manually
 * reposition both endpoints of a wire to a desired point along a nodes edge and it sticks to that
 * point, as well as the ability to reposition elbows as well."
 */

const isOrthogonal = (points: readonly Point[]): boolean =>
  points.every((p, i) => i === 0 || p.x === points[i - 1]!.x || p.y === points[i - 1]!.y);
const whole = (r: Rect): boolean => [r.x, r.y, r.w, r.h].every(Number.isInteger) && r.w > 0 && r.h > 0;

describe('the grid', () => {
  it('is the traces half-grid', () => {
    expect(WIRE_GRID).toBe(HALF_GRID);
  });
});

describe('dash patterns', () => {
  it('are null for solid and scale with the thickness', () => {
    expect(dashPattern('solid', 2)).toBeNull();
    expect(dashPattern(undefined, 2)).toBeNull();
    expect(dashPattern('dashed', 2)).toEqual({ on: 8, off: 6 });
    expect(dashPattern('dotted', 3)).toEqual({ on: 3, off: 6 });
  });

  it('cut a route into whole-pixel rectangles of the run width', () => {
    const route: Point[] = [{ x: 0, y: 32 }, { x: 96, y: 32 }, { x: 96, y: 128 }];
    for (const width of [1, 2, 3, 4]) {
      for (const dash of ['dashed', 'dotted'] as const) {
        const pieces = dashPieces(route, width, dashPattern(dash, width)!);
        expect(pieces.length).toBeGreaterThan(2);
        for (const p of pieces) {
          expect(whole(p), JSON.stringify(p)).toBe(true);
          expect(Math.min(p.w, p.h)).toBe(width);
        }
      }
    }
  });

  it('carry the pattern round a corner instead of restarting it', () => {
    // 20px along, turn, 20px more; dashes of 8 on / 6 off. Continuous: the run after the corner
    // resumes the pattern at 20 (6px into its second "on"), not at 0.
    const route: Point[] = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }];
    const pattern = { on: 8, off: 6 };
    const pieces = dashPieces(route, 2, pattern);
    const vertical = pieces.filter((p) => p.x === 19 && p.w === 2 && p.y >= 0);
    // The stretch that began at 14 runs on round the corner to 22: its tail is the first 2px down.
    expect(vertical.some((p) => p.y === 0 && p.h === 2)).toBe(true);
    // The next "on" starts at distance 28, which is 8px down the second segment. Restarting the
    // pattern at the corner would have put it at 0 instead.
    expect(vertical.some((p) => p.y === 8 && p.h === 8)).toBe(true);
    expect(vertical.some((p) => p.y === 0 && p.h === 8)).toBe(false);
  });

  it('draw the exact amount of "on" the pattern says, along the whole route', () => {
    const route: Point[] = [{ x: 0, y: 0 }, { x: 70, y: 0 }];
    const pieces = dashPieces(route, 1, { on: 4, off: 3 }).filter((p) => p.w !== 1 || p.h !== 1);
    const drawn = pieces.reduce((sum, p) => sum + p.w, 0);
    expect(drawn).toBe(40); // ten full periods of 7, each with 4 on
  });
});

describe('pinned ends', () => {
  const node: Rect = { x: 32, y: 48, w: 64, h: 48 };

  it('name a point on each side, a fraction along it, on the half-grid', () => {
    expect(anchorPoint(node, { side: 'top', offset: 0.5 })).toEqual({ x: 64, y: 48 });
    expect(anchorPoint(node, { side: 'right', offset: 0 })).toEqual({ x: 96, y: 48 });
    expect(anchorPoint(node, { side: 'bottom', offset: 1 })).toEqual({ x: 96, y: 96 });
    expect(anchorPoint(node, { side: 'left', offset: 0.5 })).toEqual({ x: 32, y: 72 });
    const p = anchorPoint(node, { side: 'top', offset: 0.33 });
    expect(p.x % WIRE_GRID).toBe(0);
  });

  it('stay at the same place on the node when it is moved or resized', () => {
    const anchor = { side: 'right' as const, offset: 0.5 };
    const moved = { ...node, x: node.x + 160, y: node.y + 32 };
    const grown = { ...node, h: node.h * 2 };
    expect(anchorPoint(moved, anchor)).toEqual({ x: 256, y: 104 });
    expect(anchorPoint(grown, anchor)).toEqual({ x: 96, y: 96 });
  });

  it('take the side nearest the cursor, and slide round a corner on their own', () => {
    expect(nearestAnchor(node, { x: 64, y: 40 }).side).toBe('top');
    expect(nearestAnchor(node, { x: 110, y: 70 }).side).toBe('right');
    expect(nearestAnchor(node, { x: 64, y: 120 }).side).toBe('bottom');
    expect(nearestAnchor(node, { x: 10, y: 72 })).toEqual({ side: 'left', offset: 0.5 });
    // Past the top-right corner, following the edge: the anchor changes sides.
    expect(nearestAnchor(node, { x: 100, y: 44 }).side).toBe('top');
    expect(nearestAnchor(node, { x: 104, y: 60 }).side).toBe('right');
  });

  it('round-trip: the nearest anchor to an anchor point is that anchor', () => {
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      for (const offset of [0, 0.25, 0.5, 0.75, 1]) {
        const back = nearestAnchor(node, anchorPoint(node, { side, offset }));
        expect(anchorPoint(node, back)).toEqual(anchorPoint(node, { side, offset }));
      }
    }
  });

  it('slide by whole grid steps round the perimeter with the keyboard, both ways', () => {
    let a = { side: 'top' as const, offset: 1 } as { side: 'top' | 'right' | 'bottom' | 'left'; offset: number };
    a = slideAnchor(node, a, 1);
    expect(a.side).toBe('right');
    expect(anchorPoint(node, a)).toEqual({ x: 96, y: 56 });
    a = slideAnchor(node, a, -2);
    expect(a.side).toBe('top');
    // A full lap comes back to where it started.
    const start = { side: 'left' as const, offset: 0.5 };
    const lap = (2 * (node.w + node.h)) / WIRE_GRID;
    expect(anchorPoint(node, slideAnchor(node, start, lap))).toEqual(anchorPoint(node, start));
  });

  it('move the way an arrow key points, on every side and round a corner', () => {
    // Right moves right on the bottom side too, where a clockwise step would go left.
    const bottom = { side: 'bottom' as const, offset: 0.5 };
    expect(anchorPoint(node, nudgeAnchor(node, bottom, 1, 0))).toEqual({ x: 72, y: 96 });
    expect(anchorPoint(node, nudgeAnchor(node, bottom, -1, 0))).toEqual({ x: 56, y: 96 });
    // Up moves up on the left side.
    const left = { side: 'left' as const, offset: 0.5 };
    expect(anchorPoint(node, nudgeAnchor(node, left, 0, -1))).toEqual({ x: 32, y: 64 });
    // Down at the top-right corner turns down the right side.
    expect(anchorPoint(node, nudgeAnchor(node, { side: 'top', offset: 1 }, 0, 1))).toEqual({ x: 96, y: 56 });
    // An arrow into or out of the node leaves the end where it is.
    const top = { side: 'top' as const, offset: 0.5 };
    expect(nudgeAnchor(node, top, 0, 1)).toBe(top);
    expect(nudgeAnchor(node, top, 0, -1)).toBe(top);
  });

  it('read in the inspector as a side and a percentage', () => {
    expect(anchorLabel({ side: 'right', offset: 0.5 })).toBe('right 50%');
    expect(anchorLabel(undefined)).toBe('auto');
  });
});

describe('moving elbows and segments', () => {
  // Leaves a node's right side at (96, 64), runs to (160, 64), down to (160, 192), right to (256, 192).
  const route: Point[] = [{ x: 96, y: 64 }, { x: 160, y: 64 }, { x: 160, y: 192 }, { x: 256, y: 192 }];

  it('moves an elbow and keeps every segment orthogonal, the ends where they were', () => {
    const moved = moveElbow(route, 1, { x: 192, y: 96 });
    expect(isOrthogonal(moved)).toBe(true);
    expect(moved[0]).toEqual(route[0]);
    expect(moved[moved.length - 1]).toEqual(route[route.length - 1]);
    expect(moved).toContainEqual({ x: 192, y: 96 });
  });

  it('keeps each pinned end leaving along its own axis', () => {
    const moved = moveElbow(route, 1, { x: 192, y: 96 });
    // The first segment still leaves horizontally from the right side.
    expect(moved[0]!.y).toBe(moved[1]!.y);
    // The last segment still arrives horizontally.
    expect(moved[moved.length - 1]!.y).toBe(moved[moved.length - 2]!.y);
  });

  it('drags a segment across its axis', () => {
    const moved = moveSegment(route, 1, { x: 208, y: 128 });
    expect(isOrthogonal(moved)).toBe(true);
    expect(moved.some((p, i) => i > 0 && p.x === 208 && moved[i - 1]!.x === 208)).toBe(true);
  });

  it('bends a straight wire through the point it was dragged to', () => {
    const straight: Point[] = [{ x: 0, y: 64 }, { x: 256, y: 64 }];
    const bent = moveSegment(straight, 0, { x: 128, y: 160 });
    expect(isOrthogonal(bent)).toBe(true);
    // Through the point, on a segment: a corner in the middle of a straight run is simplified away.
    const through = bent.some((p, i) => i > 0 && p.y === 160 && bent[i - 1]!.y === 160 &&
      Math.min(p.x, bent[i - 1]!.x) <= 128 && Math.max(p.x, bent[i - 1]!.x) >= 128);
    expect(through).toBe(true);
    expect(bent[0]).toEqual(straight[0]);
    expect(bent[bent.length - 1]).toEqual(straight[1]);
  });

  it('saves the interior corners as whole-tile waypoints', () => {
    expect(waypointsFrom(route, 16)).toEqual([[10, 4], [10, 12]]);
    expect(waypointsFrom([{ x: 0, y: 0 }, { x: 64, y: 0 }], 16)).toEqual([]);
  });
});

describe('handles', () => {
  const route: Point[] = [{ x: 96, y: 64 }, { x: 160, y: 64 }, { x: 160, y: 192 }, { x: 256, y: 192 }];

  it('are the two ends, every elbow and the middle of every bendable segment, in wire order', () => {
    const kinds = wireHandles(route).map((h) => h.kind);
    expect(kinds[0]).toBe('from');
    expect(kinds[kinds.length - 1]).toBe('to');
    expect(kinds.filter((k) => k === 'elbow')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'segment').length).toBeGreaterThanOrEqual(2);
  });

  it('are found under the cursor, ends and elbows before a segment', () => {
    const handles = wireHandles(route);
    expect(handleAt(handles, 161, 65, 4)?.kind).toBe('elbow');
    expect(handleAt(handles, 97, 63, 4)?.kind).toBe('from');
    expect(handleAt(handles, 400, 400, 4)).toBeNull();
  });
});
