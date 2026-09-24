/**
 * The part that uses the training data to improve the recogniser rather than just describe it.
 *
 * William, 2026-09-12: "I want to ensure you're working on this gesture program with great detail
 * and interconnected data analysis that actually uses data sets and the training data to genuinely
 * iterate and improve on its algorithm."
 *
 * Two claims are under test, and both are the kind that are easy to fake:
 *
 *  1. The accuracy number is honest — it must be possible for it to be less than 100%. A
 *     nearest-neighbour classifier scored against its own training set without leaving the sample
 *     out reports perfection for ever, because every sample is zero from itself.
 *  2. The fitted thresholds come from the data. A gesture with tight examples must get a tighter
 *     threshold than one with loose examples, from the same code, with no constant deciding it.
 */

import { describe, expect, it } from 'vitest';
import {
  MIN_FITTED,
  MAX_FITTED,
  TRAVEL_FLOOR,
  analyseLibrary,
  separatedByTravel,
  travelOf,
  tunedLibrary
} from '@shared/gesture-analysis.js';
import { DEFAULT_THRESHOLD, MIN_SAMPLES, featuresOf, type GestureDefinition, type GestureLibrary } from '@shared/gesture-library.js';
import type { Hand } from '@shared/gesture.js';
import { makeHand } from './helpers/hands.js';

const featuresFor = (hand: Hand): number[] => {
  const features = featuresOf(hand);
  if (!features) throw new Error('the test hand should have produced features');
  return features;
};

const vary = (hand: Hand, amount: number, seed: number): Hand =>
  hand.map((point, i) => ({
    x: point.x + Math.sin((i + 1) * seed) * amount,
    y: point.y + Math.cos((i + 1) * seed) * amount
  }));

const OPEN = makeHand();
const FIST = makeHand({ fingers: { index: false, middle: false, ring: false, pinky: false }, thumb: false });
const PEACE = makeHand({ fingers: { ring: false, pinky: false } });

/**
 * `scatter` is the whole point of these fixtures: it is how differently the same gesture was
 * performed from take to take, which is exactly what the threshold is supposed to be fitted to.
 */
function trained(
  id: string,
  name: string,
  base: Hand,
  scatter: number,
  extra: Partial<GestureDefinition> = {}
): GestureDefinition {
  return {
    id,
    name,
    utterance: '',
    frames: 1,
    kind: 'posture',
    createdAt: '2026-09-12T00:00:00.000Z',
    samples: Array.from({ length: MIN_SAMPLES + 2 }, (_, i) => ({
      id: `${id}_s${i}`,
      keyframes: [featuresFor(vary(base, scatter, i + 1))],
      capturedAt: '2026-09-12T00:00:00.000Z'
    })),
    ...extra
  };
}

const separable = (): GestureLibrary => ({
  version: 2,
  gestures: [trained('g_open', 'CURSOR', OPEN, 0.004), trained('g_fist', 'LEFT CLICK', FIST, 0.004)]
});

describe('leave-one-out accuracy', () => {
  it('is 100% when the classes are genuinely apart', () => {
    const report = analyseLibrary(separable());
    expect(report.overall.total).toBe((MIN_SAMPLES + 2) * 2);
    expect(report.overall.accuracy).toBe(1);
    expect(report.note).toMatch(/classif/i);
  });

  it('CAN fail, which is the only reason to trust it when it passes', () => {
    /*
     * Two gestures that are the same pose with a hair between them. A scorer that did not remove
     * each sample before classifying it would report 100% here, because every sample is zero from
     * itself — so this test is what proves the measurement is real.
     */
    const muddled: GestureLibrary = {
      version: 2,
      gestures: [trained('g_a', 'FIST A', FIST, 0.02), trained('g_b', 'FIST B', vary(FIST, 0.002, 5), 0.02)]
    };
    const report = analyseLibrary(muddled);
    expect(report.overall.accuracy).toBeLessThan(1);
    const worst = report.gestures[0]!;
    expect(worst.confusedWith).toBeDefined();
    expect(worst.note).toMatch(/would be read as/);
  });

  it('puts the worst gesture first, so the report leads with what to fix', () => {
    const library = separable();
    library.gestures.push(trained('g_peace', 'RIGHT CLICK', PEACE, 0.09));
    const report = analyseLibrary(library);
    expect(report.gestures[0]!.separation).toBeLessThanOrEqual(report.gestures[report.gestures.length - 1]!.separation);
  });

  it('says which gestures it could not measure, instead of scoring them as zero', () => {
    const library = separable();
    library.gestures.push({ ...trained('g_thin', 'THIN', PEACE, 0.01), samples: [] });
    const report = analyseLibrary(library);
    expect(report.unmeasured.map((entry) => entry.name)).toContain('THIN');
    expect(report.gestures.some((score) => score.name === 'THIN')).toBe(false);
  });
});

describe('thresholds fitted from the data', () => {
  it('gives a tight class a tighter threshold than a loose one, from the same code', () => {
    const library: GestureLibrary = {
      version: 2,
      gestures: [trained('g_tight', 'TIGHT', OPEN, 0.002), trained('g_loose', 'LOOSE', FIST, 0.03)]
    };
    const report = analyseLibrary(library);
    const tight = report.gestures.find((score) => score.name === 'TIGHT')!;
    const loose = report.gestures.find((score) => score.name === 'LOOSE')!;
    expect(tight.spread).toBeLessThan(loose.spread);
    expect(tight.suggested).toBeLessThan(loose.suggested);
  });

  it('never fits outside the range a threshold can usefully take', () => {
    /*
     * The extremes of scatter that still produce a hand at all. Past about 0.06 the synthetic hand
     * is distorted enough that `featuresOf` refuses it — which is itself the right behaviour, and
     * the reason this fixture stops there rather than at something absurd.
     */
    const library: GestureLibrary = {
      version: 2,
      gestures: [trained('g_tiny', 'TINY', OPEN, 0.00001), trained('g_huge', 'HUGE', FIST, 0.05)]
    };
    for (const score of analyseLibrary(library).gestures) {
      expect(score.suggested).toBeGreaterThanOrEqual(MIN_FITTED);
      expect(score.suggested).toBeLessThanOrEqual(MAX_FITTED);
    }
  });

  it('writes them in, and reports what it changed', () => {
    const library: GestureLibrary = {
      version: 2,
      gestures: [trained('g_tight', 'TIGHT', OPEN, 0.002), trained('g_loose', 'LOOSE', FIST, 0.03)]
    };
    const result = tunedLibrary(library);
    expect(result.changed.length).toBeGreaterThan(0);
    for (const change of result.changed) expect(change.from).toBe(DEFAULT_THRESHOLD);
    const tuned = result.library.gestures.find((gesture) => gesture.id === 'g_tight');
    expect(tuned?.threshold).toBeGreaterThan(0);
    expect(tuned?.threshold).not.toBe(DEFAULT_THRESHOLD);
  });

  it('leaves a gesture alone when it has too few examples to fit anything', () => {
    const thin = trained('g_thin', 'THIN', PEACE, 0.01);
    thin.samples = thin.samples.slice(0, 2);
    const result = tunedLibrary({ version: 2, gestures: [...separable().gestures, thin] });
    expect(result.changed.map((change) => change.name)).not.toContain('THIN');
    expect(result.library.gestures.find((gesture) => gesture.id === 'g_thin')?.threshold).toBeUndefined();
  });

  it('is idempotent: tuning twice changes nothing the second time', () => {
    const once = tunedLibrary(separable());
    const twice = tunedLibrary(once.library);
    expect(twice.changed).toEqual([]);
  });
});

describe('travel, and why shape alone cannot separate a drag from a scroll', () => {
  const withPath = (id: string, name: string, dx: number, dy: number): GestureDefinition => ({
    id,
    name,
    utterance: '',
    frames: 2,
    kind: 'motion',
    travel: true,
    createdAt: '2026-09-12T00:00:00.000Z',
    samples: Array.from({ length: MIN_SAMPLES }, (_, i) => ({
      id: `${id}_s${i}`,
      // The same fist at both keyframes: the hand shape does not change, only where it is.
      keyframes: [featuresFor(vary(FIST, 0.004, i + 1)), featuresFor(vary(FIST, 0.004, i + 2))],
      path: [
        { x: 0.5, y: 0.5 },
        { x: 0.5 + dx, y: 0.5 + dy }
      ],
      capturedAt: '2026-09-12T00:00:00.000Z'
    }))
  });

  it('measures the axis the hand actually moved along', () => {
    expect(travelOf(withPath('g_drag', 'CLICK DRAG', 0.3, 0.01)).axis).toBe('across');
    expect(travelOf(withPath('g_scroll', 'SCROLL', 0.01, 0.3)).axis).toBe('down');
    expect(travelOf(withPath('g_diag', 'DIAGONAL', 0.2, 0.2)).axis).toBe('mixed');
  });

  it('calls it still when the hand barely moved, rather than inventing a direction', () => {
    const barely = travelOf(withPath('g_still', 'STILL', TRAVEL_FLOOR / 4, 0));
    expect(barely.axis).toBe('still');
  });

  it('reports nothing when no sample carried a path', () => {
    expect(travelOf(trained('g_open', 'CURSOR', OPEN, 0.004)).samples).toBe(0);
  });

  it('treats two travel gestures on different axes as separated, despite identical poses', () => {
    const drag = withPath('g_drag', 'CLICK DRAG', 0.3, 0.01);
    const scroll = withPath('g_scroll', 'SCROLL', 0.01, 0.3);
    expect(separatedByTravel(drag, scroll)).toBe(true);

    // And the report says so, rather than blaming the shapes for being the same shape.
    const report = analyseLibrary({ version: 2, gestures: [drag, scroll] });
    const worst = report.gestures[0]!;
    expect(worst.confusedWith?.resolvedByTravel).toBe(true);
    expect(worst.note).toMatch(/different axes/);
  });

  it('does not claim travel separates two gestures that go the same way', () => {
    expect(separatedByTravel(withPath('g_a', 'A', 0.3, 0), withPath('g_b', 'B', 0.3, 0))).toBe(false);
    // Nor when one of them is not a travel gesture at all.
    expect(separatedByTravel(withPath('g_a', 'A', 0.3, 0), trained('g_open', 'CURSOR', OPEN, 0.004))).toBe(false);
  });
});
