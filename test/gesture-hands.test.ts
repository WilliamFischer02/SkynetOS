/**
 * One hand or two, and which hand is which.
 *
 * William, 2026-09-12: "when training zoom (a two-hand gesture) it only appears to be trying to
 * track the right hand now. Each training should have a toggle option that designates the gesture
 * as two-hand or one-hand, and the main hand should default to right hands so notate alternate
 * hand as left hand."
 *
 * A zoom recorded from one hand is not a quieter recording of a zoom — the entire content of the
 * gesture is what the two hands do relative to each other, so half of it is not a weaker example,
 * it is an example of something else.
 */

import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_GESTURES,
  FEATURE_LENGTH,
  MIN_SAMPLES,
  featuresOf,
  handsOf,
  sanitiseLibrary,
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

const OPEN = makeHand();
const OTHER = makeHand({ dx: 0.2 });

function twoHanded(id: string, name: string): GestureDefinition {
  return {
    id,
    name,
    utterance: '',
    frames: 2,
    hands: 2,
    kind: 'sequence',
    createdAt: '2026-09-12T00:00:00.000Z',
    samples: Array.from({ length: MIN_SAMPLES }, (_, i) => ({
      id: `${id}_s${i}`,
      keyframes: [featuresFor(OPEN), featuresFor(OPEN)],
      offhand: [featuresFor(OTHER), featuresFor(OTHER)],
      capturedAt: '2026-09-12T00:00:00.000Z'
    }))
  };
}

describe('how many hands a gesture uses', () => {
  it('is one unless it says otherwise, so nothing recorded before today changed meaning', () => {
    expect(handsOf({ hands: undefined })).toBe(1);
    expect(handsOf({ hands: 1 })).toBe(1);
    expect(handsOf({ hands: 2 })).toBe(2);
  });

  it('is declared on the built-ins that genuinely need two', () => {
    const twoHands = BUILT_IN_GESTURES.filter((gesture) => handsOf(gesture) === 2).map((gesture) => gesture.name);
    expect(twoHands).toEqual(['ZOOM IN', 'ZOOM OUT', 'BOTH FISTS']);
  });

  it('leaves every one-handed built-in alone', () => {
    // CLOSE THE BOOK in particular: William described it as one hand shutting like a cover, and a
    // gesture that demanded both would be unreachable while the other hand is on the mouse.
    const book = BUILT_IN_GESTURES.find((gesture) => gesture.name === 'CLOSE THE BOOK');
    expect(book && handsOf(book)).toBe(1);
  });
});

describe('the off-hand track', () => {
  it('survives a round trip through the file', () => {
    const library: GestureLibrary = { version: 2, gestures: [twoHanded('g_zoom', 'ZOOM IN')] };
    const back = sanitiseLibrary(JSON.parse(JSON.stringify(library)));
    const zoom = back.gestures.find((gesture) => gesture.id === 'g_zoom');
    expect(handsOf(zoom!)).toBe(2);
    expect(zoom?.samples[0]?.offhand).toHaveLength(2);
    expect(zoom?.samples[0]?.offhand?.[0]).toHaveLength(FEATURE_LENGTH);
  });

  it('is dropped when it is incomplete, rather than kept as half a gesture', () => {
    const library: GestureLibrary = { version: 2, gestures: [twoHanded('g_zoom', 'ZOOM IN')] };
    const raw = JSON.parse(JSON.stringify(library)) as { gestures: { samples: { offhand?: unknown }[] }[] };
    // One keyframe of the second hand goes missing: a recording of a zoom that cannot say what the
    // other hand was doing at the end of it.
    raw.gestures[0]!.samples[0]!.offhand = [featuresFor(OTHER)];
    // `sanitiseLibrary` folds the built-ins back in, so the gesture under test is found by id
    // rather than assumed to be first.
    const zoom = sanitiseLibrary(raw).gestures.find((gesture) => gesture.id === 'g_zoom');
    expect(zoom?.samples[0]?.offhand).toBeUndefined();
    // The main track is still good, so the sample itself is not thrown away.
    expect(zoom?.samples[0]?.keyframes).toHaveLength(2);
  });

  it('is not invented for a one-handed gesture', () => {
    const library: GestureLibrary = {
      version: 2,
      gestures: [
        {
          id: 'g_point',
          name: 'CURSOR',
          utterance: '',
          frames: 1,
          kind: 'posture',
          createdAt: '2026-09-12T00:00:00.000Z',
          samples: [{ id: 's1', keyframes: [featuresFor(OPEN)], capturedAt: '2026-09-12T00:00:00.000Z' }]
        }
      ]
    };
    const point = sanitiseLibrary(JSON.parse(JSON.stringify(library))).gestures.find((g) => g.id === 'g_point');
    expect(point?.samples[0]?.offhand).toBeUndefined();
    expect(point?.hands).toBeUndefined();
  });
});
