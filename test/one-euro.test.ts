/**
 * The cursor filter keeps two promises that pull against each other: steady when the hand is still,
 * and not lagging when it moves. Each promise is a test, measured against a plain low-pass filter
 * tuned to the same stillness — which is the thing the One Euro filter exists to beat.
 *
 * Both are averaged over several random draws. A filtered signal is strongly correlated from frame to
 * frame, so one draw of a few seconds holds only a handful of independent samples, and a test on it
 * measures the draw rather than the filter — which is how the first version of this file passed a
 * requirement on one seed that the parameters did not actually meet.
 */

import { describe, expect, it } from 'vitest';
import { CURSOR_FILTER, oneEuro1D, oneEuro2D, smoothingFactor } from '@shared/one-euro.js';
import { gaussian, mulberry32 } from '@shared/hand-synth.js';

const FRAME = 33;

const sd = (values: number[]): number => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
};

describe('a still hand', () => {
  it('shakes at least three times less than the raw landmarks do', () => {
    let ratio = 0;
    const seeds = [1, 2, 3, 4, 5];
    for (const seed of seeds) {
      const rng = mulberry32(seed);
      const filter = oneEuro2D(CURSOR_FILTER);
      const raw: number[] = [];
      const out: number[] = [];
      // Four seconds of a motionless palm with landmark-sized noise: about 4 px at 1280 wide.
      for (let i = 0; i < 120; i++) {
        const x = 0.5 + gaussian(rng) * 0.003;
        const y = 0.5 + gaussian(rng) * 0.003;
        const filtered = filter.filter(x, y, i * FRAME);
        if (i >= 30) {
          raw.push(x);
          out.push(filtered.x);
        }
      }
      ratio += sd(raw) / sd(out);
    }
    expect(ratio / seeds.length).toBeGreaterThan(3);
  });
});

describe('a moving hand', () => {
  it('lags a sweep by a fraction of what a fixed filter with the same stillness would', () => {
    const speed = 1; // a frame width per second: a brisk sweep across the desk
    const euro = oneEuro1D(CURSOR_FILTER);
    // A plain first-order low-pass at the One Euro filter's resting cutoff: equally steady when still.
    let fixed: number | null = null;
    let lagEuro = 0;
    let lagFixed = 0;
    for (let i = 0; i < 45; i++) {
      const at = i * FRAME;
      const x = (speed * at) / 1000;
      const e = euro.filter(x, at);
      const alpha = smoothingFactor(CURSOR_FILTER.minCutoff, FRAME / 1000);
      fixed = fixed === null ? x : fixed + alpha * (x - fixed);
      lagEuro = x - e;
      lagFixed = x - fixed;
    }
    expect(lagEuro).toBeLessThan(0.02);
    expect(lagEuro).toBeLessThan(lagFixed / 10);
  });
});

describe('timing', () => {
  it('says nothing new for a frame delivered twice', () => {
    const filter = oneEuro2D();
    filter.filter(0.2, 0.2, 0);
    const once = filter.filter(0.3, 0.3, 33);
    expect(filter.filter(0.9, 0.9, 33)).toEqual(once);
  });

  it('starts again after the hand was lost, instead of drawing a line through the gap', () => {
    const filter = oneEuro2D();
    filter.filter(0.1, 0.1, 0);
    filter.filter(0.1, 0.1, 33);
    // Half a second later the hand reappears across the frame: it is where it is, not partway there.
    expect(filter.filter(0.8, 0.8, 533)).toEqual({ x: 0.8, y: 0.8 });
  });

  it('keeps the smoothing factor a proper fraction', () => {
    for (const cutoff of [0.5, 1, 10, 100]) {
      const a = smoothingFactor(cutoff, FRAME / 1000);
      expect(a).toBeGreaterThan(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });
});
