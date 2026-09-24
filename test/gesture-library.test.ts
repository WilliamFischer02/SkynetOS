import { describe, expect, it } from 'vitest';
import type { Hand } from '../packages/shared/gesture.js';
import {
  BUILT_IN_GESTURES,
  DEFAULT_THRESHOLD,
  EMPTY_LIBRARY,
  FEATURE_LENGTH,
  MIN_SAMPLES,
  RETIRED_BUILT_INS,
  classifyGesture,
  distanceToGesture,
  featureDistance,
  featuresOf,
  freeGestureId,
  gestureReadiness,
  judgeSample,
  nameIsFree,
  normaliseGestureName,
  isSuppression,
  sanitiseLibrary,
  withBuiltIns,
  type GestureDefinition,
  type GestureLibrary
} from '../packages/shared/gesture-library.js';
import { makeHand } from './helpers/hands.js';

/**
 * Deterministic small variation — one gesture performed slightly differently, which is what four
 * examples are for. 0.01 of frame height on a 0.2 span is about 0.05 hand spans: past the
 * near-duplicate guard, nowhere near the match threshold.
 */
const vary = (hand: Hand, amount: number, seed: number): Hand =>
  hand.map((point, i) => ({
    x: point.x + Math.sin((i + 1) * seed) * amount,
    y: point.y + Math.cos((i + 1) * seed) * amount
  }));

const featuresFor = (hand: Hand): number[] => {
  const features = featuresOf(hand);
  if (!features) throw new Error('the test hand should have produced features');
  return features;
};

const POINT = makeHand({ fingers: { middle: false, ring: false, pinky: false } });
const FIST = makeHand({ fingers: { index: false, middle: false, ring: false, pinky: false }, thumb: false });
const OPEN = makeHand();

/** A trained one-keyframe gesture: MIN_SAMPLES examples of one pose, each a little different. */
function trained(id: string, name: string, utterance: string, base: Hand): GestureDefinition {
  return {
    id,
    name,
    utterance,
    frames: 1,
    kind: 'posture',
    createdAt: '2026-09-11T00:00:00.000Z',
    samples: Array.from({ length: MIN_SAMPLES }, (_, i) => ({
      id: `${id}_s${i}`,
      keyframes: [featuresFor(vary(base, 0.01, i + 1))],
      capturedAt: '2026-09-11T00:00:00.000Z'
    }))
  };
}

const library: GestureLibrary = {
  version: 2,
  gestures: [trained('g_point', 'POINT', 'select the stalker', POINT), trained('g_fist', 'FIST', 'undo', FIST)]
};

describe('featuresOf', () => {
  it('produces one number per landmark coordinate, wrist at the origin', () => {
    const features = featuresFor(POINT);
    expect(features).toHaveLength(FEATURE_LENGTH);
    expect(features[0]).toBe(0);
    expect(features[1]).toBe(0);
  });

  it('is the same hand wherever it is in frame and however big it is', () => {
    // This is the whole point of normalising: a gesture trained at arm's length must match the
    // same gesture made closer and off to one side.
    const moved = featuresFor(makeHand({ fingers: { middle: false, ring: false, pinky: false }, dx: 0.22, dy: -0.13 }));
    const nearer = featuresFor(makeHand({ fingers: { middle: false, ring: false, pinky: false }, scale: 1.7 }));
    expect(featureDistance(featuresFor(POINT), moved)).toBeCloseTo(0, 6);
    expect(featureDistance(featuresFor(POINT), nearer)).toBeCloseTo(0, 6);
  });

  it('refuses a partial hand rather than padding it', () => {
    expect(featuresOf(POINT.slice(0, 12))).toBeNull();
  });
});

describe('featureDistance', () => {
  it('is zero for the same hand and infinite for mismatched vectors', () => {
    expect(featureDistance(featuresFor(FIST), featuresFor(FIST))).toBe(0);
    expect(featureDistance([1, 2], [1, 2, 3, 4])).toBe(Number.POSITIVE_INFINITY);
    expect(featureDistance([], [])).toBe(Number.POSITIVE_INFINITY);
  });

  it('reads in hand spans, so the numbers mean something', () => {
    // A whole different pose is a long way off; the same pose varied slightly is not.
    expect(featureDistance(featuresFor(POINT), featuresFor(FIST))).toBeGreaterThan(DEFAULT_THRESHOLD);
    expect(featureDistance(featuresFor(POINT), featuresFor(vary(POINT, 0.01, 3)))).toBeLessThan(0.2);
  });
});

describe('classifyGesture', () => {
  it('recognises a trained gesture and carries the words it stands for', () => {
    const match = classifyGesture(featuresFor(vary(POINT, 0.008, 9)), library);
    expect(match).not.toBeNull();
    expect(match?.gestureId).toBe('g_point');
    expect(match?.utterance).toBe('select the stalker');
    expect(match?.confidence).toBeGreaterThan(0.4);
    expect(match?.distance).toBeLessThan(DEFAULT_THRESHOLD);
  });

  it('says nothing about a pose it was never taught', () => {
    // An open palm is neither trained gesture. Null is the correct answer, and the common one:
    // a hand moving between poses must not fire whatever it passes closest to.
    expect(classifyGesture(featuresFor(OPEN), library)).toBeNull();
  });

  it('refuses to choose between two gestures that look alike', () => {
    const confusable: GestureLibrary = {
      version: 2,
      gestures: [trained('g_a', 'FIST A', 'undo', FIST), trained('g_b', 'FIST B', 'redo', vary(FIST, 0.004, 9))]
    };
    expect(classifyGesture(featuresFor(FIST), confusable)).toBeNull();
  });

  it('ignores a gesture that is not finished, disabled, or excluded', () => {
    const half: GestureDefinition = { ...trained('g_half', 'HALF', 'undo', FIST), samples: trained('g_half', 'HALF', 'undo', FIST).samples.slice(0, MIN_SAMPLES - 1) };
    expect(classifyGesture(featuresFor(FIST), { version: 2, gestures: [half] })).toBeNull();

    const off: GestureDefinition = { ...trained('g_off', 'OFF', 'undo', FIST), disabled: true };
    expect(classifyGesture(featuresFor(FIST), { version: 2, gestures: [off] })).toBeNull();

    // Excluded: used while training a gesture, so it cannot match itself.
    expect(classifyGesture(featuresFor(FIST), library, { exclude: 'g_fist' })).toBeNull();
  });

  it('returns nothing for an empty catalogue', () => {
    expect(classifyGesture(featuresFor(FIST), EMPTY_LIBRARY)).toBeNull();
  });

  it('respects a gesture\'s own threshold', () => {
    const strict: GestureLibrary = {
      version: 2,
      gestures: [{ ...trained('g_strict', 'STRICT', 'undo', FIST), threshold: 0.01 }]
    };
    expect(classifyGesture(featuresFor(vary(FIST, 0.01, 11)), strict)).toBeNull();
  });
});

describe('judgeSample', () => {
  const blank = { id: 'g_new', samples: [] };

  it('accepts a whole hand that is unlike anything already trained', () => {
    expect(judgeSample(featuresFor(OPEN), blank, library)).toEqual({ ok: true });
  });

  it('rejects a partial hand', () => {
    const verdict = judgeSample([1, 2, 3], blank, library);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/whole hand/i);
  });

  it('rejects a hand turned too far edge-on, which is a different fault', () => {
    /*
     * The real one, from the first training run on 2026-09-12: a hand nearly side-on collapses the
     * wrist-to-knuckle span everything is divided by, and the stored vector contained values past
     * twelve. Such a sample dominates every distance it takes part in.
     */
    const exploded = new Array(FEATURE_LENGTH).fill(0).map((_, i) => (i === 8 ? -12.4 : 0.3));
    const verdict = judgeSample(exploded, blank, library);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/edge-on/i);
  });


  it('refuses a sample that sits on top of another gesture, and names it', () => {
    const verdict = judgeSample(featuresFor(FIST), blank, library);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/TOO CLOSE TO FIST/);
    expect(verdict.clash?.name).toBe('FIST');
  });

  it('refuses a near-duplicate of the sample just taken', () => {
    const partial = { id: 'g_new', samples: [{ id: 's1', keyframes: [featuresFor(OPEN)], capturedAt: 'x' }] };
    // Moving your hand across the frame is not a second example: the features are normalised, so
    // it is the same vector. The trainer has to ask for a different angle instead.
    const moved = featuresFor(makeHand({ dx: 0.2, dy: 0.1 }));
    const verdict = judgeSample(moved, partial, library);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/ALMOST IDENTICAL/);
  });
});

describe('catalogue housekeeping', () => {
  it('says what a gesture still needs', () => {
    const one = { ...trained('g_x', 'X', '', FIST), samples: trained('g_x', 'X', '', FIST).samples.slice(0, 1) };
    expect(gestureReadiness(one)).toEqual({ ready: false, note: '3 more examples needed' });
    expect(gestureReadiness(trained('g_y', 'Y', '', FIST))).toEqual({ ready: true, note: 'recognised, but does nothing yet' });
    expect(gestureReadiness(trained('g_z', 'Z', 'undo', FIST))).toEqual({ ready: true, note: 'undo' });
  });

  it('normalises names and keeps them unique', () => {
    expect(normaliseGestureName('  thumbs   up ')).toBe('THUMBS UP');
    expect(nameIsFree('point', library)).toBe(false);
    expect(nameIsFree('POINT', library, 'g_point')).toBe(true);
    expect(nameIsFree('   ', library)).toBe(false);
    expect(nameIsFree('THUMBS UP', library)).toBe(true);
  });

  it('mints ids that cannot collide', () => {
    expect(freeGestureId(EMPTY_LIBRARY, 'Thumbs Up')).toBe('g_thumbs_up');
    const taken: GestureLibrary = { version: 2, gestures: [{ ...trained('g_thumbs_up', 'THUMBS UP', '', FIST) }] };
    expect(freeGestureId(taken, 'thumbs up')).toBe('g_thumbs_up_2');
  });
});

describe('sanitiseLibrary', () => {
  const find = (library: GestureLibrary, id: string): GestureDefinition | undefined =>
    library.gestures.find((gesture) => gesture.id === id);

  it('drops keyframes of the wrong shape instead of trusting the file', () => {
    const cleaned = sanitiseLibrary({
      version: 2,
      gestures: [
        {
          id: 'g_a', name: 'a', utterance: 'undo', createdAt: 'x', frames: 1, kind: 'posture',
          samples: [
            { id: 'ok', keyframes: [featuresFor(FIST)], capturedAt: 'x' },
            { id: 'short', keyframes: [[1, 2, 3]], capturedAt: 'x' },
            { id: 'nan', keyframes: [new Array(FEATURE_LENGTH).fill(Number.NaN)], capturedAt: 'x' }
          ]
        }
      ]
    });
    expect(find(cleaned, 'g_a')?.samples.map((sample) => sample.id)).toEqual(['ok']);
    expect(find(cleaned, 'g_a')?.name).toBe('A');
  });

  it('migrates a version 1 library rather than throwing away real recordings', () => {
    const migrated = sanitiseLibrary({
      version: 1,
      gestures: [{ id: 'g_old', name: 'old', utterance: 'undo', createdAt: 'x', samples: [{ id: 's1', features: featuresFor(FIST), capturedAt: 'x' }] }]
    });
    const old = find(migrated, 'g_old');
    expect(migrated.version).toBe(2);
    expect(old?.frames).toBe(1);
    expect(old?.samples[0]?.keyframes).toHaveLength(1);
    expect(old?.samples[0]?.keyframes[0]).toEqual(featuresFor(FIST));
  });

  it('drops a recording that is missing a keyframe, because it cannot complete the sequence', () => {
    const cleaned = sanitiseLibrary({
      version: 2,
      gestures: [{
        id: 'g_seq', name: 'SEQ', utterance: '', createdAt: 'x', frames: 2, kind: 'sequence',
        samples: [
          { id: 'whole', keyframes: [featuresFor(FIST), featuresFor(OPEN)], capturedAt: 'x' },
          { id: 'half', keyframes: [featuresFor(FIST)], capturedAt: 'x' }
        ]
      }]
    });
    expect(find(cleaned, 'g_seq')?.samples.map((sample) => sample.id)).toEqual(['whole']);
  });

  it('drops exploded samples, so stored rubbish stops counting', () => {
    const poisoned = sanitiseLibrary({
      version: 2,
      gestures: [{
        id: 'g_p', name: 'P', utterance: '', createdAt: 'x', frames: 1, kind: 'posture',
        samples: [
          { id: 'good', keyframes: [featuresFor(FIST)], capturedAt: 'x' },
          { id: 'exploded', keyframes: [new Array(FEATURE_LENGTH).fill(0).map((_, i) => (i === 3 ? 10.4 : 0.2))], capturedAt: 'x' }
        ]
      }]
    });
    expect(find(poisoned, 'g_p')?.samples.map((sample) => sample.id)).toEqual(['good']);
  });

  it('refuses another version, or anything that is not a library, and still seeds the built-ins', () => {
    for (const bad of [{ version: 9, gestures: [] }, null, 'nonsense']) {
      expect(sanitiseLibrary(bad).gestures).toHaveLength(BUILT_IN_GESTURES.length);
    }
  });
});

describe('the built-in vocabulary', () => {
  it('includes the postures that exist to be ignored', () => {
    // The rig has to tell working from gesturing, so "recognise this and do nothing" is trained
    // like anything else — and these are the poses William is in most of the day.
    const ignored = BUILT_IN_GESTURES.filter((gesture) => gesture.action === 'ignore').map((gesture) => gesture.name);
    /*
     * ONE FIST used to be here. It was retired on 2026-09-12, when a closed fist became the CLICK:
     * a gesture trained to ignore a fist now reads as "never notice the click", and no audit could
     * resolve that because both classes would be behaving exactly as trained. See RETIRED_BUILT_INS.
     */
    expect(ignored).toEqual(['HOLDING A MOUSE', 'HOLDING A PHONE', 'ON THE KEYBOARD']);
    expect(RETIRED_BUILT_INS).toContain('g_ignore_fist');
    for (const gesture of BUILT_IN_GESTURES) {
      if (gesture.action === 'ignore') expect(isSuppression(gesture)).toBe(true);
    }
    expect(isSuppression({ action: 'rest' })).toBe(true);
    expect(isSuppression({ action: 'cursor' })).toBe(false);
  });

  it('ships every gesture William specified, present from first run', () => {
    expect(BUILT_IN_GESTURES.map((gesture) => gesture.name)).toEqual([
      'CURSOR', 'REST', 'LEFT CLICK', 'DOUBLE CLICK', 'CLICK DRAG', 'RIGHT CLICK', 'ZOOM IN', 'ZOOM OUT', 'SCROLL',
      'CLOSE THE BOOK',
      'BOTH FISTS', 'HOLDING A MOUSE', 'HOLDING A PHONE', 'ON THE KEYBOARD'
    ]);
  });

  it('describes each one as a posture, a sequence or a movement, with its keyframes', () => {
    const byName = new Map(BUILT_IN_GESTURES.map((gesture) => [gesture.name, gesture]));
    expect(byName.get('CURSOR')).toMatchObject({ kind: 'posture', frames: 1, action: 'cursor' });
    expect(byName.get('REST')).toMatchObject({ kind: 'posture', frames: 1, action: 'rest' });
    expect(byName.get('LEFT CLICK')).toMatchObject({ kind: 'sequence', frames: 2, action: 'left-click' });
    // The 2026-09-12 vocabulary: an open hand is the cursor, a fist is the click, a peace sign is
    // the right click, and drag and scroll are TRAVEL gestures — two positions, not two shapes.
    expect(byName.get('RIGHT CLICK')).toMatchObject({ kind: 'sequence', frames: 2, action: 'right-click' });
    expect(byName.get('CLICK DRAG')).toMatchObject({ kind: 'motion', frames: 2, action: 'drag', travel: true });
    expect(byName.get('SCROLL')).toMatchObject({ kind: 'motion', frames: 2, action: 'scroll', travel: true });
    expect(byName.get('BOTH FISTS')).toMatchObject({ kind: 'posture', frames: 1, action: 'halt', mode: 'both' });
    expect(byName.get('ZOOM IN')).toMatchObject({ mode: 'two' });
    expect(byName.get('CURSOR')).toMatchObject({ mode: 'one' });
    // Every built-in tells the wizard what to say, once per keyframe.
    for (const gesture of BUILT_IN_GESTURES) expect(gesture.prompts).toHaveLength(gesture.frames);
  });

  it('is untrained to begin with, so nothing fires until William teaches it', () => {
    const fresh = withBuiltIns(EMPTY_LIBRARY);
    for (const gesture of fresh.gestures) expect(gesture.samples).toEqual([]);
    expect(classifyGesture(featuresFor(FIST), fresh)).toBeNull();
  });

  it('keeps what he trained and tuned, and puts back one he deleted', () => {
    const trainedCursor = { ...trained('g_cursor', 'WRONG NAME', 'nonsense', FIST), threshold: 0.11, disabled: true };
    const merged = withBuiltIns({ version: 2, gestures: [trainedCursor] });
    const cursor = merged.gestures.find((gesture) => gesture.id === 'g_cursor');
    // His: the examples, the threshold, the off switch. The seed's: what it is and what it does.
    expect(cursor?.samples).toHaveLength(MIN_SAMPLES);
    expect(cursor?.threshold).toBe(0.11);
    expect(cursor?.disabled).toBe(true);
    expect(cursor?.name).toBe('CURSOR');
    expect(cursor?.action).toBe('cursor');
    expect(merged.gestures).toHaveLength(BUILT_IN_GESTURES.length);
  });

  it('keeps gestures he added himself, after the built-ins', () => {
    const mine = trained('g_mine', 'MINE', 'undo', FIST);
    const merged = withBuiltIns({ version: 2, gestures: [mine] });
    expect(merged.gestures).toHaveLength(BUILT_IN_GESTURES.length + 1);
    expect(merged.gestures[merged.gestures.length - 1]?.id).toBe('g_mine');
  });
});
