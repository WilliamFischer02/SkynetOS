import { describe, expect, it } from 'vitest';
import { isDoubleTap, isTap, pinchStep, PINCH_IN, PINCH_OUT } from '../src/renderer/board/touch.js';

describe('pinch', () => {
  it('steps one exact level per clear spread or squeeze, never a fraction', () => {
    expect(pinchStep(PINCH_IN)).toBe(1);
    expect(pinchStep(1.6)).toBe(1);
    expect(pinchStep(PINCH_OUT)).toBe(-1);
    expect(pinchStep(0.5)).toBe(-1);
    expect(pinchStep(1.1)).toBe(0);
    expect(pinchStep(0.9)).toBe(0);
  });

  it('ignores nonsense ratios', () => {
    expect(pinchStep(Number.NaN)).toBe(0);
    expect(pinchStep(0)).toBe(0);
    expect(pinchStep(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('taps', () => {
  it('is a tap when quick and still, not when slow or dragged', () => {
    expect(isTap({ x: 0, y: 0, t: 0 }, { x: 3, y: 4, t: 200 })).toBe(true);
    expect(isTap({ x: 0, y: 0, t: 0 }, { x: 0, y: 0, t: 800 })).toBe(false);
    expect(isTap({ x: 0, y: 0, t: 0 }, { x: 30, y: 0, t: 100 })).toBe(false);
  });

  it('is a double tap when the second lands near the first, soon after', () => {
    expect(isDoubleTap({ x: 10, y: 10, t: 0 }, { x: 14, y: 12, t: 250 })).toBe(true);
    expect(isDoubleTap({ x: 10, y: 10, t: 0 }, { x: 14, y: 12, t: 500 })).toBe(false);
    expect(isDoubleTap({ x: 10, y: 10, t: 0 }, { x: 90, y: 10, t: 100 })).toBe(false);
    expect(isDoubleTap(null, { x: 0, y: 0, t: 0 })).toBe(false);
  });
});
