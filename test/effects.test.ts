import { describe, expect, it } from 'vitest';
import {
  CHASE_PX_PER_SECOND,
  SPEED_MAX,
  SPEED_MIN,
  chaseRects,
  clampSpeed,
  cycleFrame,
  perimeterPoint,
  scanRect
} from '../src/renderer/board/effects.js';

/**
 * Node effects. William: "more checkboxes that enable different animated / visual effects like the
 * light pulse, and when those effects are enabled color and speed modifiers."
 *
 * What must hold: every lit pixel is inside the node, on whole pixels, and speed changes the pace
 * and nothing else.
 */

const inside = (r: { x: number; y: number; w: number; h: number }, w: number, h: number): boolean =>
  r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;
const whole = (r: { x: number; y: number; w: number; h: number }): boolean =>
  [r.x, r.y, r.w, r.h].every(Number.isInteger);

describe('speed', () => {
  it('defaults to 1 and is clamped to a sane range', () => {
    expect(clampSpeed(undefined)).toBe(1);
    expect(clampSpeed(Number.NaN)).toBe(1);
    expect(clampSpeed(100)).toBe(SPEED_MAX);
    expect(clampSpeed(0)).toBe(SPEED_MIN);
  });

  it('advances a cycle faster at double speed, and loops', () => {
    expect(cycleFrame(1, 12, 16)).toBe(12);
    expect(cycleFrame(1, 12, 16, 2)).toBe(8); // 24 frames into a 16-frame loop
    expect(cycleFrame(0, 12, 16, 4)).toBe(0);
  });
});

describe('perimeterPoint', () => {
  it('walks the edge clockwise from the top-left and comes back round', () => {
    expect(perimeterPoint(4, 3, 0)).toEqual({ x: 0, y: 0 });
    expect(perimeterPoint(4, 3, 3)).toEqual({ x: 3, y: 0 });
    expect(perimeterPoint(4, 3, 5)).toEqual({ x: 3, y: 2 });
    expect(perimeterPoint(4, 3, 8)).toEqual({ x: 0, y: 2 });
    expect(perimeterPoint(4, 3, 10)).toEqual({ x: 0, y: 0 });
    expect(perimeterPoint(4, 3, -1)).toEqual({ x: 0, y: 1 });
  });
});

describe('chase', () => {
  it('stays on the node, on whole pixels, at every moment', () => {
    for (let t = 0; t < 10; t += 0.07) {
      for (const r of chaseRects(96, 64, t, 1.7)) {
        expect(inside(r, 96, 64)).toBe(true);
        expect(whole(r)).toBe(true);
      }
    }
  });

  it('only ever lights the frame, never the face', () => {
    for (let t = 0; t < 10; t += 0.11) {
      for (const r of chaseRects(96, 64, t)) {
        const onEdge = r.x === 0 || r.y === 0 || r.x + r.w === 96 || r.y + r.h === 64;
        expect(onEdge).toBe(true);
      }
    }
  });

  it('moves twice as far at double speed', () => {
    const at = (speed: number) => chaseRects(400, 400, 1, speed)[0]!;
    expect(at(1).x).toBe(CHASE_PX_PER_SECOND);
    expect(at(2).x).toBe(CHASE_PX_PER_SECOND * 2);
  });

  it('draws nothing on a node too small to have a frame', () => {
    expect(chaseRects(3, 3, 1)).toEqual([]);
  });
});

describe('scan', () => {
  it('sweeps down the face, whole width, whole pixels', () => {
    const first = scanRect(64, 64, 0)!;
    const later = scanRect(64, 64, 0.5)!;
    expect(first.y).toBe(0);
    expect(later.y).toBeGreaterThan(first.y);
    expect(later.w).toBe(64);
    expect(whole(later)).toBe(true);
    expect(inside(later, 64, 64)).toBe(true);
  });

  it('pauses below the node between sweeps', () => {
    // At speed 1 a 64px node plus the pause is a 96px cycle: 2.4 s in, the line is at 96 % 96 = 0,
    // and just before that it is in the pause.
    expect(scanRect(64, 64, 2.3)).toBeNull();
  });
});
