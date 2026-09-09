import { describe, expect, it } from 'vitest';
import {
  HALF_GRID,
  routeOrthogonal,
  segmentRects,
  styleFor,
  type Point,
  type Rect
} from '../src/renderer/board/traces.js';
import { ROOM_THEMES } from '../packages/shared/palette.js';
import type { BoardEdge } from '../packages/shared/types.js';

const a: Rect = { x: 64, y: 64, w: 48, h: 48 };
const b: Rect = { x: 320, y: 240, w: 64, h: 48 };

function isOrthogonal(points: Point[]): boolean {
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1]!;
    const q = points[i]!;
    if (p.x !== q.x && p.y !== q.y) return false;
  }
  return true;
}

describe('routeOrthogonal', () => {
  it('produces only horizontal and vertical segments — never a diagonal', () => {
    // Anti-mush rule 7: diagonals are pre-drawn, never rotated, and never rasterised as a line.
    expect(isOrthogonal(routeOrthogonal(a, b))).toBe(true);
    expect(isOrthogonal(routeOrthogonal(b, a))).toBe(true);
  });

  it('lands every point on the 8px half-grid', () => {
    for (const p of routeOrthogonal(a, b)) {
      expect(p.x % HALF_GRID).toBe(0);
      expect(p.y % HALF_GRID).toBe(0);
    }
  });

  it('keeps every coordinate a whole number', () => {
    for (const p of routeOrthogonal(a, b)) {
      expect(Number.isInteger(p.x)).toBe(true);
      expect(Number.isInteger(p.y)).toBe(true);
    }
  });

  it('is deterministic — the same graph routes identically every time', () => {
    expect(routeOrthogonal(a, b)).toEqual(routeOrthogonal(a, b));
  });

  it('emits no zero-length segments', () => {
    const points = routeOrthogonal(a, b);
    for (let i = 1; i < points.length; i++) {
      expect(points[i]).not.toEqual(points[i - 1]);
    }
  });

  it('starts and ends outside the node bodies, not in their centres', () => {
    const points = routeOrthogonal(a, b);
    const start = points[0]!;
    const end = points[points.length - 1]!;
    const insideA = start.x > a.x && start.x < a.x + a.w && start.y > a.y && start.y < a.y + a.h;
    const insideB = end.x > b.x && end.x < b.x + b.w && end.y > b.y && end.y < b.y + b.h;
    expect(insideA).toBe(false);
    expect(insideB).toBe(false);
  });

  it('routes straight when the two nodes share an axis', () => {
    const left: Rect = { x: 0, y: 100, w: 48, h: 48 };
    const right: Rect = { x: 300, y: 100, w: 48, h: 48 };
    const points = routeOrthogonal(left, right);
    expect(points).toHaveLength(2);
    expect(points[0]!.y).toBe(points[1]!.y);
  });

  it('honours hand-routed waypoints, converting them from tiles to pixels', () => {
    const points = routeOrthogonal(a, b, [[12, 8], [12, 14]], 16);
    expect(isOrthogonal(points)).toBe(true);
    expect(points.some((p) => p.x === 12 * 16 && p.y === 8 * 16)).toBe(true);
    expect(points.some((p) => p.x === 12 * 16 && p.y === 14 * 16)).toBe(true);
  });
});

describe('segmentRects', () => {
  it('turns a route into whole-pixel axis-aligned rectangles', () => {
    for (const rect of segmentRects(routeOrthogonal(a, b), 3)) {
      expect(Number.isInteger(rect.x)).toBe(true);
      expect(Number.isInteger(rect.y)).toBe(true);
      expect(Number.isInteger(rect.w)).toBe(true);
      expect(Number.isInteger(rect.h)).toBe(true);
      expect(rect.w).toBeGreaterThan(0);
      expect(rect.h).toBeGreaterThan(0);
    }
  });

  it('gives a horizontal run the requested thickness', () => {
    const rects = segmentRects([{ x: 0, y: 32 }, { x: 64, y: 32 }], 3);
    expect(rects).toHaveLength(1);
    expect(rects[0]!.h).toBe(3);
    expect(rects[0]!.w).toBe(64 + 3);
  });

  it('gives a vertical run the requested thickness', () => {
    const rects = segmentRects([{ x: 32, y: 0 }, { x: 32, y: 64 }], 2);
    expect(rects).toHaveLength(1);
    expect(rects[0]!.w).toBe(2);
  });
});

describe('styleFor — relation colour', () => {
  const edge = (over: Partial<BoardEdge>): BoardEdge => ({
    id: 'e1', from: 'a', to: 'b', kind: 'supervises', ...over
  });

  it('draws a supervises trace with an inner signal strand', () => {
    const style = styleFor(edge({}), ROOM_THEMES.root.signal);
    expect(style.innerColor).toBe(ROOM_THEMES.root.signal);
    expect(style.width).toBeGreaterThanOrEqual(3);
  });

  it("takes the RELATED room's signal when the edge names one", () => {
    // This is the whole mechanism: a wire from JARVIS to the GameOS drive carries GameOS blue,
    // so which room a wire leads to is visible without reading the label.
    expect(styleFor(edge({ relation: 'gameos' }), ROOM_THEMES.root.signal).innerColor)
      .toBe(ROOM_THEMES.gameos.signal);
    expect(styleFor(edge({ relation: 'minecraftos' }), ROOM_THEMES.root.signal).innerColor)
      .toBe(ROOM_THEMES.minecraftos.signal);
    expect(styleFor(edge({ relation: 'storyos' }), ROOM_THEMES.root.signal).innerColor)
      .toBe(ROOM_THEMES.storyos.signal);
  });

  it('falls back to the room signal when the relation names a board that does not exist', () => {
    expect(styleFor(edge({ relation: 'nope' }), ROOM_THEMES.root.signal).innerColor)
      .toBe(ROOM_THEMES.root.signal);
  });

  it('dashes depends and thins reads', () => {
    expect(styleFor(edge({ kind: 'depends' }), ROOM_THEMES.root.signal).dashed).toBe(true);
    expect(styleFor(edge({ kind: 'reads', width: 3 }), ROOM_THEMES.root.signal).width)
      .toBeLessThan(styleFor(edge({ kind: 'produces', width: 3 }), ROOM_THEMES.root.signal).width);
  });

  it('gives every edge kind a positive whole-number width', () => {
    for (const kind of ['produces', 'reads', 'depends', 'deploys', 'syncs', 'supervises'] as const) {
      const style = styleFor(edge({ kind }), ROOM_THEMES.root.signal);
      expect(Number.isInteger(style.width)).toBe(true);
      expect(style.width).toBeGreaterThan(0);
    }
  });
});
