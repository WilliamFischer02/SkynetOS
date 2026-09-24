/**
 * The audit that answers "did training break everything?"
 *
 * William, 2026-09-11: "After the last training most of the gestures don't seem to be working so
 * also ensure the gesture learning and calibration isn't accidentally breaking the entire feature."
 *
 * These tests exist because the failure they describe is invisible. Nearest-neighbour has no
 * per-class isolation: one badly-taken example of a suppression pose can sit closer to CURSOR than
 * CURSOR's own examples do, and from then on every attempt to move the pointer classifies as
 * "ignore this" and the whole rig goes quiet with nothing on screen to say why.
 */

import { describe, expect, it } from 'vitest';
import {
  MIN_SAMPLES,
  VARIANTS,
  gestureHealth,
  isVariant,
  libraryHealth,
  readVariant,
  sanitiseLibrary,
  featuresOf,
  type GestureDefinition,
  type GestureLibrary
} from '@shared/gesture-library.js';
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

const POINT = makeHand({ fingers: { middle: false, ring: false, pinky: false } });
const FIST = makeHand({ fingers: { index: false, middle: false, ring: false, pinky: false }, thumb: false });

function trained(id: string, name: string, base: Hand, count = MIN_SAMPLES): GestureDefinition {
  return {
    id,
    name,
    utterance: '',
    frames: 1,
    kind: 'posture',
    createdAt: '2026-09-11T00:00:00.000Z',
    samples: Array.from({ length: count }, (_, i) => ({
      id: `${id}_s${i}`,
      keyframes: [featuresFor(vary(base, 0.01, i + 1))],
      capturedAt: '2026-09-11T00:00:00.000Z'
    }))
  };
}

const healthy = (): GestureLibrary => ({
  version: 2,
  gestures: [trained('g_point', 'CURSOR', POINT), trained('g_fist', 'ONE FIST', FIST)]
});

describe('a catalogue that was trained properly', () => {
  it('passes, and says so', () => {
    const report = libraryHealth(healthy());
    expect(report.ok).toBe(true);
    expect(report.drop).toHaveLength(0);
    expect(report.gestures.every((gesture) => gesture.usable)).toBe(true);
  });

  it('counts the examples and names the variants it has', () => {
    const library = healthy();
    library.gestures[0]!.samples.push({
      id: 'g_point_rough',
      keyframes: [featuresFor(vary(POINT, 0.02, 9))],
      capturedAt: '2026-09-11T00:00:00.000Z',
      variant: 'rough'
    });
    const health = gestureHealth(library.gestures[0]!, library);
    expect(health.sampleCount).toBe(MIN_SAMPLES + 1);
    expect(health.variants).toEqual(['clean', 'rough']);
  });
});

describe('one poisoned example', () => {
  /**
   * The exact fault William hit: a suppression pose recorded while the hand was actually in the
   * cursor shape. It is one row in a JSON file and it takes the whole feature down.
   */
  const poisoned = (): GestureLibrary => {
    const library = healthy();
    library.gestures[1]!.samples.push({
      id: 'g_fist_bad',
      // A FIST example that is really a POINT: nearer to CURSOR than to any of its own siblings.
      keyframes: [featuresFor(POINT)],
      capturedAt: '2026-09-11T00:00:01.000Z'
    });
    return library;
  };

  it('is found, named, and blamed on the gesture it would be misread as', () => {
    const report = libraryHealth(poisoned());
    expect(report.ok).toBe(false);
    expect(report.drop).toHaveLength(1);
    expect(report.drop[0]).toMatchObject({ gestureId: 'g_fist', sampleId: 'g_fist_bad' });
    const fist = report.gestures.find((gesture) => gesture.id === 'g_fist');
    expect(fist?.usable).toBe(false);
    expect(fist?.faults[0]).toMatchObject({ severity: 'drop', rival: 'CURSOR' });
  });

  it('does not condemn the gesture it collides with, which did nothing wrong', () => {
    const report = libraryHealth(poisoned());
    const cursor = report.gestures.find((gesture) => gesture.id === 'g_point');
    // CURSOR's own examples are all still nearest to each other. Only the intruder is at fault.
    expect(cursor?.faults.filter((fault) => fault.severity === 'drop')).toHaveLength(0);
  });

  it('reports which variant produced it, so a whole bad variant set can be recognised', () => {
    const library = healthy();
    library.gestures[1]!.samples.push({
      id: 'g_fist_bad',
      keyframes: [featuresFor(POINT)],
      capturedAt: '2026-09-11T00:00:01.000Z',
      variant: 'rough'
    });
    const health = gestureHealth(library.gestures[1]!, library);
    expect(health.faults[0]?.variant).toBe('rough');
  });

  it('ignores a gesture that has been switched off, because it is not in play', () => {
    const library = poisoned();
    library.gestures[1]!.disabled = true;
    expect(libraryHealth(library).ok).toBe(true);
  });
});

describe('a gesture with too few examples', () => {
  it('is not usable, but is not poisoned either', () => {
    const library: GestureLibrary = { version: 2, gestures: [trained('g_thin', 'THIN', POINT, 2), trained('g_fist', 'ONE FIST', FIST)] };
    const report = libraryHealth(library);
    const thin = report.gestures.find((gesture) => gesture.id === 'g_thin');
    expect(thin?.usable).toBe(false);
    expect(thin?.note).toContain('more example');
    // Nothing to repair: it needs more data, not less.
    expect(report.drop).toHaveLength(0);
    expect(report.ok).toBe(true);
  });
});

describe('variants', () => {
  it('offers the clean take plus the four alternatives William asked for', () => {
    expect(VARIANTS.map((spec) => spec.key)).toEqual(['clean', 'rough', 'angled', 'left-hand', 'far']);
    expect(VARIANTS.every((spec) => spec.blurb.length > 20)).toBe(true);
  });

  it('recognises its own keys and refuses anything else', () => {
    expect(isVariant('rough')).toBe(true);
    expect(isVariant('sloppy')).toBe(false);
    expect(isVariant(undefined)).toBe(false);
  });

  it('keeps recordings made under the old name for the left hand', () => {
    // `other-hand` was renamed `left-hand` on 2026-09-12. Those were real recordings of a real
    // hand; a rename must not silently throw them away.
    expect(readVariant('other-hand')).toBe('left-hand');
    expect(readVariant('left-hand')).toBe('left-hand');
    expect(readVariant('nonsense')).toBeNull();
  });

  it('survives a round trip through the file, and drops a label nobody defined', () => {
    const library = healthy();
    library.gestures[0]!.samples[0]!.variant = 'angled';
    const raw = JSON.parse(JSON.stringify(library)) as Record<string, unknown>;
    const gestures = (raw.gestures as { samples: Record<string, unknown>[] }[])!;
    gestures[0]!.samples[1]!.variant = 'nonsense';
    const back = sanitiseLibrary(raw);
    const point = back.gestures.find((gesture) => gesture.id === 'g_point');
    expect(point?.samples[0]?.variant).toBe('angled');
    expect(point?.samples[1]?.variant).toBeUndefined();
  });

  it('does not store the clean label, because absent already means clean', () => {
    const library = healthy();
    library.gestures[0]!.samples[0]!.variant = 'clean';
    const back = sanitiseLibrary(JSON.parse(JSON.stringify(library)));
    expect(back.gestures.find((gesture) => gesture.id === 'g_point')?.samples[0]?.variant).toBeUndefined();
  });
});
