/**
 * What a hand is doing, in numbers a person could check with a ruler.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────
 *
 * William, 2026-09-12: "out of all of the gestures click, right click, and cursor movement are the
 * most important … they are similar but they are adjacent actions so their poses MUST be similar
 * for the gesture control to flow."
 *
 * That sentence is the whole design problem, and the first version got it wrong. Cursor, click and
 * right-click were three CLASSES competing in a nearest-neighbour vote — but they are not three
 * different poses. They are one posture (finger and thumb out, aimed at the screen) separated by
 * two continuous quantities:
 *
 *   - APERTURE: how far apart the finger and thumb are. Open is the cursor, closed is a click,
 *     closed-and-held is a drag. There is no boundary between them, only a distance that changes.
 *   - ROLL: how far the hand has rotated about the axis pointing at the screen. A sharp change is
 *     the right click, and the hand is otherwise in the same shape throughout.
 *
 * Measuring them directly means the three "gestures" never compete: the classifier is not asked a
 * question it cannot answer well, and the poses can be as similar as they like — which is exactly
 * what makes the interaction flow.
 *
 * Everything here is scale-free (divided by the hand's own span) and pure.
 */

import { MCP, PIP, TIP, WRIST, handSpan, type Finger, type Hand } from './gesture.js';

export interface HandMetrics {
  /** Thumb tip to index tip, in hand spans. The cursor-to-click axis. */
  aperture: number;
  /** Tip distance from the wrist over knuckle distance from the wrist, per finger. Above ~1.6 is out. */
  extension: Record<Finger, number>;
  /** Angle of the knuckle line, in radians. Its CHANGE over time is the twist. */
  roll: number;
  /**
   * Palm width over palm length.
   *
   * A hand square to the camera measures near 0.9; one turned towards profile foreshortens the
   * knuckle line and falls away. This is how the rig can tell a side camera from a head-on one
   * without being told, and how it knows a hand has turned too far to be read reliably.
   */
  palmRatio: number;
  /** Index tip to pinky tip, in spans: an open hand from a closed one, independent of the thumb. */
  spread: number;
  /** Hand span as a fraction of the frame. A rough stand-in for how far away the hand is. */
  scale: number;
}

const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

const FINGERS: Finger[] = ['thumb', 'index', 'middle', 'ring', 'pinky'];

/*
 * Where a finger counts as out or gathered, on the tip-over-knuckle ratio.
 *
 * Measured against the synthetic hands: a straight finger is about 1.43 and a curled one about
 * 0.70. The first version put the "gathered" cut at 1.45, which called a fully open hand gathered
 * and would have made every open palm a cursor posture.
 */
const EXTENDED = 1.25;
const GATHERED = 1.15;

/**
 * Measure a hand, or return null when it cannot be measured honestly.
 *
 * Null is a real answer: a hand turned so far towards profile that its own knuckle line has
 * collapsed cannot give a reliable aperture or roll, and a guess there is worse than a gap —
 * it is what fires a click while the user is doing nothing.
 */
export function handMetrics(input: Hand, aspect = 1): HandMetrics | null {
  /*
   * Square the coordinates before measuring anything. Image x is normalised by the frame's width and y
   * by its height, so on the 16:9 cameras a raw distance is not a distance: an upright palm — width
   * across, length down — reads 44% narrower than it is. Found on 2026-09-12 when the synthetic camera
   * produced an honest 1280x720 frame: every upright hand fell under the readability gate and was
   * labelled "edge", so no hand could drive, while hands rotated a quarter turn passed. `aspect` is
   * width over height; 1 means the coordinates are already square, as the older test hands are.
   */
  const hand = aspect === 1 ? input : input.map((point) => ({ ...point, y: point.y / aspect }));
  if (hand.length < 21) return null;
  const wrist = hand[WRIST];
  const indexMcp = hand[MCP.index];
  const pinkyMcp = hand[MCP.pinky];
  const middleMcp = hand[MCP.middle];
  if (!wrist || !indexMcp || !pinkyMcp || !middleMcp) return null;

  const span = handSpan(hand);
  if (!(span > 0.001)) return null;

  const palmLength = distance(wrist, middleMcp);
  const palmWidth = distance(indexMcp, pinkyMcp);
  if (!(palmLength > 0)) return null;

  const extension = {} as Record<Finger, number>;
  for (const finger of FINGERS) {
    const tip = hand[TIP[finger]];
    const pip = hand[PIP[finger]];
    if (!tip || !pip) return null;
    const reach = distance(wrist, tip);
    const knuckle = distance(wrist, pip);
    extension[finger] = knuckle > 0 ? reach / knuckle : 0;
  }

  const thumbTip = hand[TIP.thumb];
  const indexTip = hand[TIP.index];
  const pinkyTip = hand[TIP.pinky];
  if (!thumbTip || !indexTip || !pinkyTip) return null;

  return {
    aperture: distance(thumbTip, indexTip) / span,
    extension,
    roll: Math.atan2(pinkyMcp.y - indexMcp.y, pinkyMcp.x - indexMcp.x),
    palmRatio: palmWidth / palmLength,
    spread: distance(indexTip, pinkyTip) / span,
    scale: span
  };
}

/** Signed difference between two angles, in radians, wrapped to [-π, π]. */
export function angleDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return delta;
}

/**
 * Is this the pointing posture — index out, thumb out, aimed at the screen?
 *
 * Deliberately tolerant about the aperture, because the same posture with the fingers touching is a
 * click and with them apart is the cursor. It asks about the SHAPE, and the aperture is measured
 * separately; that separation is what lets a click happen without leaving cursor control.
 */
export function isPointingPosture(metrics: HandMetrics): boolean {
  const { extension, spread, aperture } = metrics;
  // The three fingers that are NOT involved are gathered in. This is the reliable half of the test:
  // it separates the pen-grip family from an open hand, a fist being waved, and a hand on a mouse.
  const othersIn = extension.middle < GATHERED && extension.ring < GATHERED && extension.pinky < GATHERED;
  /*
   * The index is either out, or drawn in to meet the thumb — because a real pinch CURLS the index
   * finger. Requiring it to be extended was the first version's mistake, and it would have dropped
   * cursor control at the exact moment of clicking: the bug this rebuild exists to fix.
   */
  const inTheGrip = extension.index > EXTENDED || aperture < 0.45;
  // A fully open hand has a wide spread; a pointing hand's fingers are gathered.
  return othersIn && inTheGrip && spread < 1.6;
}

/**
 * How confidently a hand can be read at all, 0 to 1.
 *
 * Falls away as the palm turns towards profile, because every other measurement here is taken from
 * a knuckle line that is disappearing. The control machine multiplies its certainty by this, so a
 * hand turning away stops driving the board before it starts driving it wrongly.
 */
export function readability(metrics: HandMetrics): number {
  // 0.9 is square to the camera; below about 0.35 the hand is nearly edge-on.
  const ratio = Math.max(0, Math.min(1, (metrics.palmRatio - 0.25) / 0.5));
  // Too far away to resolve fingers: a hand smaller than ~6% of the frame is a guess.
  const size = Math.max(0, Math.min(1, (metrics.scale - 0.04) / 0.06));
  return Math.min(ratio, size);
}

/**
 * Which way a camera is looking at the hand, from the hand itself.
 *
 * William's rig is not symmetric: "one is closer to a side profile and one is more head on /
 * slightly looking down on the gestures". Rather than ask him to move cameras he cannot move, the
 * program works out what each one is looking at and uses each for what it is good for — the head-on
 * view for pointing and aperture, the side view for depth and for confirming a pinch actually
 * closed rather than merely appearing to.
 */
export type Viewpoint = 'frontal' | 'oblique' | 'profile';

export function viewpointOf(palmRatios: readonly number[]): { view: Viewpoint; median: number } {
  if (!palmRatios.length) return { view: 'oblique', median: 0 };
  const sorted = [...palmRatios].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  if (median >= 0.72) return { view: 'frontal', median };
  if (median >= 0.42) return { view: 'oblique', median };
  return { view: 'profile', median };
}
