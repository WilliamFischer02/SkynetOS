import { describe, expect, it } from 'vitest';
import { boxesOverlap, plateOrder, pushBelow, type PlateBox } from '../src/renderer/ui/stack-plates.js';

/**
 * Chrome plates pinned to board positions — phantom plates, drag badges — keep a readable size
 * while the board zooms out, so neighbours can land on one another. The rule they share: place
 * top to bottom, push each one below whatever it would cover.
 */

describe('boxesOverlap', () => {
  const a: PlateBox = { x: 0, y: 0, w: 10, h: 10 };

  it('is false for boxes that merely touch', () => {
    expect(boxesOverlap(a, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
    expect(boxesOverlap(a, { x: 0, y: 10, w: 10, h: 10 })).toBe(false);
  });

  it('is true for a shared pixel', () => {
    expect(boxesOverlap(a, { x: 9, y: 9, w: 10, h: 10 })).toBe(true);
  });
});

describe('pushBelow', () => {
  it('leaves a plate where it is when nothing is placed', () => {
    expect(pushBelow({ x: 5, y: 7, w: 100, h: 20 }, [], 2)).toBe(7);
  });

  it('leaves a plate alone beside, not over, a placed one', () => {
    const placed = [{ x: 0, y: 0, w: 100, h: 20 }];
    expect(pushBelow({ x: 100, y: 0, w: 100, h: 20 }, placed, 2)).toBe(0);
  });

  it('pushes a covering plate to just below the one it covered, plus the gap', () => {
    const placed = [{ x: 0, y: 0, w: 100, h: 20 }];
    // DIRTY PLUSH over PANIC: same column, four pixels apart at overview zoom.
    expect(pushBelow({ x: 10, y: 4, w: 100, h: 20 }, placed, 2)).toBe(22);
  });

  it('keeps pushing until it clears a stack, and never moves up', () => {
    const placed = [
      { x: 0, y: 0, w: 100, h: 20 },
      { x: 0, y: 22, w: 100, h: 20 }
    ];
    expect(pushBelow({ x: 0, y: 1, w: 100, h: 20 }, placed, 2)).toBe(44);
    expect(pushBelow({ x: 0, y: 60, w: 100, h: 20 }, placed, 2)).toBe(60);
  });

  it('never moves a plate sideways', () => {
    const box = { x: 3, y: 0, w: 50, h: 10 };
    pushBelow(box, [{ x: 0, y: 0, w: 100, h: 20 }], 1);
    expect(box.x).toBe(3);
  });
});

describe('plateOrder', () => {
  it('sorts top to bottom, then left to right', () => {
    const plates = [{ x: 5, y: 10 }, { x: 0, y: 10 }, { x: 9, y: 0 }];
    expect([...plates].sort(plateOrder)).toEqual([{ x: 9, y: 0 }, { x: 0, y: 10 }, { x: 5, y: 10 }]);
  });
});
