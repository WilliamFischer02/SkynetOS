import { describe, expect, it } from 'vitest';
import { MCP, type Hand } from '../packages/shared/gesture.js';
import {
  angleDelta,
  handMetrics,
  isPointingPosture,
  readability,
  viewpointOf
} from '../packages/shared/hand-metrics.js';
import { DEFAULT_APERTURE, apertureThresholds, updateAperture, WARMUP } from '../packages/shared/adaptive.js';
import { judgeFrame, statsFromLuma } from '../packages/shared/frame-quality.js';
import { makeHand } from './helpers/hands.js';

const POINT = makeHand({ fingers: { middle: false, ring: false, pinky: false } });
/** A pen-grip pinch: finger and thumb together, the other three gathered — how a person points. */
const PINCH = makeHand({ pinchGap: 0.1, fingers: { middle: false, ring: false, pinky: false } });
const OPEN = makeHand();
const FIST = makeHand({ fingers: { index: false, middle: false, ring: false, pinky: false }, thumb: false });

const metricsFor = (hand: Hand) => {
  const metrics = handMetrics(hand);
  if (!metrics) throw new Error('the test hand should have measured');
  return metrics;
};

/**
 * Roll the knuckle line about its own midpoint, leaving the fingertips where they are.
 *
 * That is what a twist of the wrist looks like to a camera: the hand turns about the axis pointing
 * at the lens, so the knuckles swing while the fingertip stays roughly put. Rotating the whole hand
 * about the wrist would be a different gesture — a sweep — and the detector deliberately refuses it.
 */
function withRoll(hand: Hand, radians: number): Hand {
  const index = hand[MCP.index]!;
  const pinky = hand[MCP.pinky]!;
  const midX = (index.x + pinky.x) / 2;
  const midY = (index.y + pinky.y) / 2;
  const half = Math.hypot(pinky.x - index.x, pinky.y - index.y) / 2;
  const base = Math.atan2(pinky.y - index.y, pinky.x - index.x);
  const turned = base + radians;
  const next = [...hand];
  next[MCP.index] = { x: midX - Math.cos(turned) * half, y: midY - Math.sin(turned) * half };
  next[MCP.pinky] = { x: midX + Math.cos(turned) * half, y: midY + Math.sin(turned) * half };
  return next;
}

describe('handMetrics', () => {
  it('measures the aperture as the cursor-to-click axis', () => {
    // One number separates the two, which is the whole point: they are not different poses.
    expect(metricsFor(PINCH).aperture).toBeLessThan(0.3);
    expect(metricsFor(POINT).aperture).toBeGreaterThan(1);
  });

  it('measures which fingers are out', () => {
    const open = metricsFor(OPEN).extension;
    const point = metricsFor(POINT).extension;
    expect(open.middle).toBeGreaterThan(1.25);
    expect(point.middle).toBeLessThan(1.1);
    expect(point.index).toBeGreaterThan(1.25);
  });

  it('refuses a hand it cannot measure', () => {
    expect(handMetrics(POINT.slice(0, 10))).toBeNull();
  });

  it('reads scale from the hand, so distance does not change the numbers', () => {
    const near = metricsFor(makeHand({ pinchGap: 0.1, fingers: { middle: false, ring: false, pinky: false }, scale: 1.8 }));
    expect(near.aperture).toBeCloseTo(metricsFor(PINCH).aperture, 5);
    expect(near.scale).toBeGreaterThan(metricsFor(PINCH).scale);
  });
});

describe('isPointingPosture', () => {
  it('holds through a pinch, which is the bug this rebuild exists to fix', () => {
    // Cursor control must not drop at the moment of clicking.
    expect(isPointingPosture(metricsFor(POINT))).toBe(true);
    expect(isPointingPosture(metricsFor(PINCH))).toBe(true);
  });

  it('is not an open hand, and not a fist', () => {
    expect(isPointingPosture(metricsFor(OPEN))).toBe(false);
    expect(isPointingPosture(metricsFor(FIST))).toBe(false);
  });
});

describe('readability and viewpoint', () => {
  it('falls away as the palm turns towards profile', () => {
    const square = metricsFor(POINT);
    expect(readability(square)).toBeGreaterThan(0.5);

    // Collapse the knuckle line: the hand is turning edge-on and every measurement gets shakier.
    const turning = [...POINT];
    turning[MCP.pinky] = { x: POINT[MCP.index]!.x + 0.02, y: POINT[MCP.pinky]!.y };
    expect(readability(metricsFor(turning))).toBeLessThan(0.3);
  });

  it('works out how a camera is looking at the hand, rather than being told', () => {
    // William's rig is not symmetric: one camera is near profile, one head-on.
    expect(viewpointOf([0.85, 0.9, 0.88]).view).toBe('frontal');
    expect(viewpointOf([0.55, 0.6, 0.5]).view).toBe('oblique');
    expect(viewpointOf([0.3, 0.25, 0.35]).view).toBe('profile');
    expect(viewpointOf([]).view).toBe('oblique');
  });
});

describe('angleDelta', () => {
  it('wraps, so a twist across the -π boundary is small and not enormous', () => {
    expect(angleDelta(3.1, -3.1)).toBeCloseTo(0.0832, 3);
    expect(angleDelta(0, 1)).toBeCloseTo(1, 5);
    expect(angleDelta(1, 0)).toBeCloseTo(-1, 5);
  });
});

describe('adaptive aperture', () => {
  it('starts from sensible defaults and leans on them until it has watched a while', () => {
    const early = apertureThresholds(DEFAULT_APERTURE);
    expect(early.close).toBeGreaterThan(0.3);
    expect(early.open).toBeGreaterThan(early.close);
  });

  it('learns a tighter pinch than the default, and moves the thresholds with it', () => {
    let model = DEFAULT_APERTURE;
    // A hand whose closed pinch is 0.08 and open is 0.6 — smaller hands, or further away.
    for (let i = 0; i < WARMUP * 2; i++) model = updateAperture(model, i % 2 === 0 ? 0.08 : 0.6);
    expect(model.closed).toBeLessThan(0.2);
    const thresholds = apertureThresholds(model);
    expect(thresholds.close).toBeLessThan(apertureThresholds(DEFAULT_APERTURE).close);
    // Still hysteretic: opening takes more than closing, or a resting hand clicks all day.
    expect(thresholds.open).toBeGreaterThan(thresholds.close);
  });

  it('never lets the two extremes collapse onto each other', () => {
    let model = DEFAULT_APERTURE;
    // A hand held perfectly still for a long time must not turn every tremor into a click.
    for (let i = 0; i < 500; i++) model = updateAperture(model, 0.4);
    expect(model.open - model.closed).toBeGreaterThan(0.2);
  });

  it('ignores impossible readings rather than learning from them', () => {
    const model = updateAperture(DEFAULT_APERTURE, Number.NaN);
    expect(model).toEqual(DEFAULT_APERTURE);
    expect(updateAperture(DEFAULT_APERTURE, 99)).toEqual(DEFAULT_APERTURE);
  });
});

describe('frame quality', () => {
  const stats = (over: Partial<Parameters<typeof judgeFrame>[0]>) =>
    judgeFrame({ mean: 0.45, black: 0.02, white: 0.02, detail: 0.05, ...over });

  it('passes a well-exposed, sharp frame and asks for no correction', () => {
    const verdict = stats({});
    expect(verdict.usable).toBe(true);
    expect(verdict.trainable).toBe(true);
    expect(verdict.faults).toEqual([]);
    expect(verdict.correction.brightness).toBeCloseTo(1, 1);
  });

  it('rejects a black frame and a blown one, and says which', () => {
    expect(stats({ mean: 0.05, black: 0.8 }).usable).toBe(false);
    expect(stats({ mean: 0.05, black: 0.8 }).note).toMatch(/TOO DARK/);
    expect(stats({ mean: 0.95, white: 0.7 }).usable).toBe(false);
    expect(stats({ mean: 0.95, white: 0.7 }).note).toMatch(/BLOWN OUT/);
  });

  it('rejects a blurred frame however well exposed it is', () => {
    const verdict = stats({ detail: 0.005 });
    expect(verdict.usable).toBe(false);
    expect(verdict.faults).toContain('blurred');
  });

  it('will track from a low-contrast frame but refuses to LEARN from one', () => {
    // The distinction that matters: a poor frame costs one frame of tracking, but a poor training
    // example poisons every comparison it takes part in, for as long as it is stored.
    const verdict = stats({ detail: 0.015 });
    expect(verdict.usable).toBe(true);
    expect(verdict.trainable).toBe(false);
  });

  it('brightens an under-exposed frame towards the target, within reason', () => {
    const dim = stats({ mean: 0.2 });
    expect(dim.correction.brightness).toBeGreaterThan(1.5);
    expect(dim.correction.brightness).toBeLessThanOrEqual(2.2);
    // And never tries to gain up a frame that is essentially black: the answer there is a lamp.
    expect(stats({ mean: 0.005, black: 0.9 }).correction.brightness).toBe(1);
  });

  it('computes its statistics from a small greyscale sample', () => {
    const black = statsFromLuma(new Array(64).fill(0), 8, 8);
    expect(black.mean).toBe(0);
    expect(black.black).toBe(1);
    expect(black.detail).toBe(0);

    // A checkerboard: mid mean, no clipping, plenty of local detail.
    const checks = Array.from({ length: 64 }, (_, i) => ((i % 8) + Math.floor(i / 8)) % 2);
    const busy = statsFromLuma(checks, 8, 8);
    expect(busy.mean).toBeCloseTo(0.5, 5);
    expect(busy.detail).toBeCloseTo(1, 5);
  });
});

export { withRoll };
