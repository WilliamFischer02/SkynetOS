import { describe, expect, it } from 'vitest';
import { makeHand } from './helpers/hands.js';
import {
  classifyPose,
  createTracker,
  DEFAULT_GESTURE_CONFIG,
  handSpan,
  isExtended,
  pinchDistance,
  TIP,
  type GestureConfig,
  type GestureEvent,
  type Hand
} from '../packages/shared/gesture.js';

const OPEN = makeHand();
const POINT = makeHand({ fingers: { middle: false, ring: false, pinky: false } });
const FIST = makeHand({ fingers: { index: false, middle: false, ring: false, pinky: false }, thumb: false });
const PINCH = makeHand({ pinchGap: 0.1 });

/** Smoothing off, so the geometry tests measure geometry and not the filter. */
const RAW: GestureConfig = { ...DEFAULT_GESTURE_CONFIG, smoothing: 0 };

const types = (events: GestureEvent[]): string[] => events.map((e) => e.type);

describe('hand geometry', () => {
  it('measures span from the wrist to the middle knuckle', () => {
    expect(handSpan(OPEN)).toBeCloseTo(0.2, 5);
  });

  it('knows an extended finger from a curled one', () => {
    expect(isExtended(OPEN, 'index')).toBe(true);
    expect(isExtended(OPEN, 'pinky')).toBe(true);
    expect(isExtended(POINT, 'index')).toBe(true);
    expect(isExtended(POINT, 'middle')).toBe(false);
    expect(isExtended(FIST, 'index')).toBe(false);
  });

  it('measures a pinch against the hand\'s own size, not the frame', () => {
    expect(pinchDistance(PINCH)).toBeLessThan(DEFAULT_GESTURE_CONFIG.pinchClose);
    expect(pinchDistance(OPEN)).toBeGreaterThan(1);
    // The same hand half the size, twice as far away, pinches at the same number.
    const far = makeHand({ pinchGap: 0.1, dx: 0.2, dy: 0.1 });
    expect(pinchDistance(far)).toBeCloseTo(pinchDistance(PINCH), 5);
  });
});

describe('classifyPose', () => {
  it('names the four poses the vocabulary uses', () => {
    expect(classifyPose(OPEN)).toBe('open');
    expect(classifyPose(POINT)).toBe('point');
    expect(classifyPose(FIST)).toBe('fist');
    expect(classifyPose(PINCH)).toBe('pinch');
  });

  it('reads a pinch as a pinch even though the index finger is curled', () => {
    // The failure this guards: testing extension first makes every pinch look like a fist.
    expect(isExtended(PINCH, 'index')).toBe(false);
    expect(classifyPose(PINCH)).toBe('pinch');
  });

  it('says unknown rather than guessing at a partial hand', () => {
    expect(classifyPose(OPEN.slice(0, 12))).toBe('unknown');
  });
});

describe('createTracker — the cursor', () => {
  it('reports a smoothed cursor, exact on the first frame', () => {
    const tracker = createTracker();
    const first = tracker.push({ hands: [POINT], atMs: 0 });
    const tip = POINT[TIP.index]!;
    expect(first[0]).toMatchObject({ type: 'cursor', x: tip.x, y: tip.y });

    // Moved 0.10 to the right: with smoothing 0.6 the cursor covers 40% of it this frame.
    const moved = makeHand({ fingers: { middle: false, ring: false, pinky: false }, dx: 0.1 });
    const second = tracker.push({ hands: [moved], atMs: 33 });
    const cursor = second.find((e) => e.type === 'cursor') as { x: number };
    expect(cursor.x).toBeCloseTo(tip.x + 0.04, 5);
    expect(cursor.x).toBeLessThan(tip.x + 0.1);
  });
});

describe('createTracker — pinch to drag', () => {
  it('grabs on a pinch and holds still inside the dead zone', () => {
    const tracker = createTracker(RAW);
    expect(types(tracker.push({ hands: [PINCH], atMs: 0 }))).toContain('grabStart');

    // Half a dead zone of travel: the board must not move at all.
    const nudged = makeHand({ pinchGap: 0.1, dx: RAW.deadZone / 2 });
    expect(types(tracker.push({ hands: [nudged], atMs: 33 }))).not.toContain('grabMove');
  });

  it('drags once the hand leaves the dead zone, and keeps dragging after', () => {
    const tracker = createTracker(RAW);
    tracker.push({ hands: [PINCH], atMs: 0 });
    const out = makeHand({ pinchGap: 0.1, dx: 0.05 });
    const moved = tracker.push({ hands: [out], atMs: 33 }).find((e) => e.type === 'grabMove') as { dx: number };
    expect(moved).toBeDefined();
    expect(moved.dx).toBeCloseTo(0.05, 5);
    // Back inside the dead zone, but a drag is already running: it reports rather than sticking.
    const back = makeHand({ pinchGap: 0.1, dx: 0.001 });
    expect(types(tracker.push({ hands: [back], atMs: 66 }))).toContain('grabMove');
  });

  it('does not let a pinch on the threshold chatter', () => {
    const tracker = createTracker(RAW);
    tracker.push({ hands: [makeHand({ pinchGap: 0.3 }) ], atMs: 0 }); // 0.3 < 0.35: closed
    // 0.42 span apart: above the close threshold but below the open one, so it stays held.
    const between = makeHand({ pinchGap: 0.42 });
    expect(types(tracker.push({ hands: [between], atMs: 33 }))).not.toContain('grabEnd');
    // Past the open threshold: released.
    expect(types(tracker.push({ hands: [makeHand({ pinchGap: 0.8 })], atMs: 66 }))).toContain('grabEnd');
  });

  it('drops what it holds when the hand leaves the frame', () => {
    const tracker = createTracker(RAW);
    tracker.push({ hands: [PINCH], atMs: 0 });
    expect(types(tracker.push({ hands: [], atMs: 100 }))).toEqual([]); // inside lostMs: still held
    expect(types(tracker.push({ hands: [], atMs: 500 }))).toContain('grabEnd');
    // And only once.
    expect(types(tracker.push({ hands: [], atMs: 900 }))).not.toContain('grabEnd');
  });
});

describe('createTracker — poses that must be held', () => {
  it('undoes on a held fist, once, not on a flicker', () => {
    const tracker = createTracker(RAW);
    expect(types(tracker.push({ hands: [FIST], atMs: 0 }))).not.toContain('undo');
    expect(types(tracker.push({ hands: [FIST], atMs: 300 }))).not.toContain('undo');
    expect(types(tracker.push({ hands: [FIST], atMs: 800 }))).toContain('undo');
    expect(types(tracker.push({ hands: [FIST], atMs: 1200 }))).not.toContain('undo');
  });

  it('releases on a held open palm, but only after something was held', () => {
    const fresh = createTracker(RAW);
    fresh.push({ hands: [OPEN], atMs: 0 });
    expect(types(fresh.push({ hands: [OPEN], atMs: 900 }))).not.toContain('release');

    const engaged = createTracker(RAW);
    engaged.push({ hands: [PINCH], atMs: 0 });
    engaged.push({ hands: [makeHand({ pinchGap: 0.9 })], atMs: 33 });
    engaged.push({ hands: [OPEN], atMs: 66 });
    expect(types(engaged.push({ hands: [OPEN], atMs: 900 }))).toContain('release');
  });
});

describe('createTracker — two hands', () => {
  it('zooms in when they part and out when they close, one step at a time', () => {
    const tracker = createTracker(RAW);
    const left = makeHand();
    const right = makeHand({ dx: 0.2 });
    expect(types(tracker.push({ hands: [left, right], atMs: 0 }))).toEqual([]);

    const further = makeHand({ dx: 0.2 + DEFAULT_GESTURE_CONFIG.zoomStep + 0.01 });
    const zoomIn = tracker.push({ hands: [left, further], atMs: 33 });
    expect(zoomIn).toEqual([{ type: 'zoom', direction: 'in' }]);

    // Back together by more than a step from the new anchor.
    const closer = makeHand({ dx: 0.1 });
    expect(tracker.push({ hands: [left, closer], atMs: 66 })).toEqual([{ type: 'zoom', direction: 'out' }]);
  });

  it('ends a drag rather than guessing which hand was holding it', () => {
    const tracker = createTracker(RAW);
    tracker.push({ hands: [PINCH], atMs: 0 });
    expect(types(tracker.push({ hands: [PINCH, makeHand({ dx: 0.25 })], atMs: 33 }))).toContain('grabEnd');
  });
});

describe('createTracker — reset', () => {
  it('forgets everything when manual control is switched off', () => {
    const tracker = createTracker(RAW);
    tracker.push({ hands: [PINCH], atMs: 0 });
    expect(tracker.cursor()).not.toBeNull();
    tracker.reset();
    expect(tracker.cursor()).toBeNull();
    expect(tracker.pose()).toBe('unknown');
    // A pinch after a reset is a fresh grab, not a continuation.
    expect(types(tracker.push({ hands: [PINCH], atMs: 1000 }))).toContain('grabStart');
  });
});
