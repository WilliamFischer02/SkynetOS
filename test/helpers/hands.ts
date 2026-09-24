import { TIP, type Finger, type Hand } from '../../packages/shared/gesture.js';

/**
 * A synthetic right hand, palm to camera, fingers up.
 *
 * The wrist sits at the bottom and the knuckles at y 0.70, so the span (wrist to middle knuckle) is
 * exactly 0.20 of frame height. Every threshold in gesture.ts and gesture-library.ts is expressed
 * against that span, so one set of numbers stands in for a hand at any distance — and `dx`/`dy`
 * move the whole hand to prove it.
 *
 * Shared by test/gesture.test.ts and test/gesture-library.test.ts: two builders would drift, and a
 * pose that means one thing to the tracker and another to the catalogue is exactly the bug neither
 * test would catch.
 */

const FINGER_X: Record<Exclude<Finger, 'thumb'>, number> = { index: 0.44, middle: 0.50, ring: 0.56, pinky: 0.61 };

export interface HandOptions {
  fingers?: Partial<Record<Exclude<Finger, 'thumb'>, boolean>>;
  thumb?: boolean;
  /** Put the index tip this far from the thumb tip, in span units (0.2 of the frame). */
  pinchGap?: number;
  dx?: number;
  dy?: number;
  /** Scale the whole hand about the wrist: a hand held closer to the lens. */
  scale?: number;
}

export function makeHand(options: HandOptions = {}): Hand {
  const { fingers = {}, thumb = true, pinchGap, dx = 0, dy = 0, scale = 1 } = options;
  const wristX = 0.5;
  const wristY = 0.9;
  // Scaled about the wrist, so a bigger hand is the same gesture nearer the camera.
  const point = (x: number, y: number) => ({
    x: wristX + (x - wristX) * scale + dx,
    y: wristY + (y - wristY) * scale + dy
  });
  const hand: Hand = new Array(21).fill(null).map(() => point(wristX, wristY));

  hand[0] = point(0.50, 0.90); // wrist

  if (thumb) {
    hand[1] = point(0.44, 0.86);
    hand[2] = point(0.40, 0.82);
    hand[3] = point(0.36, 0.78);
    hand[4] = point(0.32, 0.74);
  } else {
    hand[1] = point(0.46, 0.86);
    hand[2] = point(0.46, 0.84);
    hand[3] = point(0.46, 0.83);
    hand[4] = point(0.46, 0.82);
  }

  const order: Exclude<Finger, 'thumb'>[] = ['index', 'middle', 'ring', 'pinky'];
  order.forEach((finger, i) => {
    const base = 5 + i * 4;
    const x = FINGER_X[finger];
    const extended = fingers[finger] ?? true;
    hand[base] = point(x, 0.70);
    if (extended) {
      hand[base + 1] = point(x, 0.62);
      hand[base + 2] = point(x, 0.56);
      hand[base + 3] = point(x, 0.50);
    } else {
      hand[base + 1] = point(x, 0.64);
      hand[base + 2] = point(x, 0.68);
      hand[base + 3] = point(x, 0.72);
    }
  });

  if (pinchGap !== undefined) {
    const thumbTip = hand[TIP.thumb]!;
    hand[TIP.index] = { x: thumbTip.x + pinchGap * 0.2 * scale, y: thumbTip.y + 0.004 * scale };
    hand[6] = { x: (hand[5]!.x + thumbTip.x) / 2, y: point(0, 0.66).y };
    hand[7] = { x: thumbTip.x + 0.02, y: point(0, 0.70).y };
  }
  return hand;
}

/** The four poses the built-in vocabulary uses, for tests that only need one of each. */
export const OPEN_HAND = makeHand();
export const POINTING = makeHand({ fingers: { middle: false, ring: false, pinky: false } });
export const FIST = makeHand({ fingers: { index: false, middle: false, ring: false, pinky: false }, thumb: false });
export const PINCHING = makeHand({ pinchGap: 0.1 });
