/**
 * Which hand is driving, which is helping, and which is just resting on the desk.
 *
 * William, 2026-09-12: "I don't think the program is easily interpreting the difference between one
 * hand resting, both hands resting, one hand up one down … per-hand detection that can seamlessly
 * swap between left or right hand or both or neither based on whether the hands started positioned
 * sort of within title action boundries of the feed or fall on the outside edges or offscreen."
 *
 * The old code took `hands[0]` and hoped. MediaPipe returns hands in no guaranteed order, so which
 * hand that was changed frame to frame — and a hand resting on the desk was as likely to be picked
 * as the one being pointed. Everything downstream then behaved as though the user kept swapping
 * hands mid-gesture, which is precisely what it looked like.
 *
 * So roles are assigned explicitly, every frame, from three things a camera can actually see:
 *
 *   1. WHERE the hand is. There is an action boundary — a margin inside the frame — and a hand
 *      outside it is on its way in or out of shot, not driving anything. This is the "title safe"
 *      idea from broadcast, and it exists for the same reason: the edges are where things are
 *      half-visible and unreliable.
 *   2. WHAT SHAPE it is in. A hand in the pointing posture is asking to drive; one that is not, low
 *      in the frame, is resting.
 *   3. HOW WELL it can be read (hand-metrics.ts) — a hand turning towards profile stops being
 *      trusted before it starts being wrong.
 *
 * Pure, and every rule is a test.
 */

import type { Hand } from './gesture.js';
import { handMetrics, isPointingPosture, readability, type HandMetrics } from './hand-metrics.js';

/**
 * Which of the person's hands this is, as they would name it.
 *
 * `unknown` is a real answer, not a failure: a hand half out of frame or turned edge-on genuinely
 * cannot be told apart, and guessing would be worse than saying so — a gesture trained as the left
 * hand because the camera guessed wrong is a gesture that never fires.
 */
export type Side = 'left' | 'right' | 'unknown';

/** The landmarker's own label, passed through untranslated. `Left`/`Right` are its spellings. */
export type RawSide = 'Left' | 'Right' | 'unknown';

/**
 * ── Which way round the picture is, and why NOTHING may assume it ────────────────────────────
 *
 * William, 2026-09-12: "it appears the inputs may be horizontally inverted - it continually thinks
 * my right hand is my left hand."
 *
 * Two separate pieces of code had each made their own guess about this, which is how a single
 * wrong assumption became two bugs:
 *
 *   1. MediaPipe labels handedness ASSUMING the image it was given is mirrored — selfie view. So
 *      its label is only correct if that assumption happens to hold for this camera.
 *   2. Any reasoning from POSITION — "the hand further left in frame is the right hand" — depends
 *      on exactly the same thing, and a toggle that fixed the label would silently leave this
 *      half wrong. That was the deeper fault: the correction could not have fully worked.
 *
 * Whether a webcam hands over a mirrored frame is a property of the camera and its driver. It
 * cannot be known in advance and it must not be guessed twice. So it is ONE calibrated fact,
 * answered by the person in front of the camera during the AIM phase, stored with the calibration
 * because it describes this desk, and everything that needs to know derives from it.
 *
 * The default is `true` — most webcams present a mirror, which is why a video call looks like a
 * looking glass — but the default is only what holds until he is asked.
 */
/*
 * ── Correction, later the same day: they are TWO facts, not one ──────────────────────────────
 *
 * The note above says one calibrated fact should drive both the handedness label and anything that
 * reasons from position. That was wrong, and it is worth the paragraph. Whether the frame is mirrored
 * is a property of the CAMERA. What MediaPipe's label means is a property of the MODEL. William's
 * report — "it continually thinks my right hand is my left hand", made while the labels were being
 * swapped — fits a mirrored camera under the documented convention, and fits the label simply being
 * right on a raw camera just as well. Those two explanations predict OPPOSITE cursor directions, so
 * tying them together would have fixed the labels and silently reversed the cursor.
 *
 * So `labelsSwapped` corrects the label and nothing else; the SWAP L/R buttons set it. `mirrored` is
 * per-camera geometry, MEASURED in the AIM phase by asking for a movement to his right and reading which
 * way it went in the picture; the cursor direction and the position fallback use it and nothing else.
 */

/**
 * Logitech's C920 and C922 hand the browser an unmirrored frame — mirroring a self-view is something
 * applications do in their own preview — and the cursor mapping has always assumed a raw frame, which
 * nobody reported as backwards. So the geometric default is raw, until the AIM phase measures it.
 */
export const DEFAULT_MIRRORED = false;

/**
 * The person's hand, from the landmarker's label: as reported, unless this rig says to swap it.
 *
 * As-reported is the default because that is what William's report of 2026-09-12 asked for: it was made
 * with a swap in force, and said the swap was wrong.
 */
export function sideFromLabel(raw: RawSide | string | undefined, swapped = false): Side {
  if (raw !== 'Left' && raw !== 'Right') return 'unknown';
  const asReported: Side = raw === 'Left' ? 'left' : 'right';
  if (!swapped) return asReported;
  return asReported === 'left' ? 'right' : 'left';
}

/**
 * In frame coordinates, does the person's RIGHT hand have the smaller x?
 *
 * Pure geometry: the camera faces the person, so in a raw frame their right hand is on the picture's
 * left. It depends on the camera's mirroring and never on the label convention.
 */
export const rightHandHasSmallerX = (mirrored: boolean): boolean => !mirrored;

/**
 * A camera's mirroring, from a movement to the person's right: in a raw frame the hand's x shrinks, in a
 * mirrored one it grows. Null when the hand moved too little, in frame widths, to say.
 */
export const mirroredFromMotion = (dxWhenMovingRight: number): boolean | null =>
  Math.abs(dxWhenMovingRight) < 0.05 ? null : dxWhenMovingRight > 0;

/**
 * Camera x to the cursor's horizontal fraction across the board, so the cursor goes the way the hand
 * goes: in a raw frame the hand moving to HIS right moves to the picture's left, so the mapping is
 * reversed; in a mirrored frame it is not. The reach region is reversed with it, or the whole mapping
 * would shift by however far his reach is off-centre.
 */
export function cursorFraction(x: number, region: { x0: number; x1: number }, mirrored: boolean): number {
  const width = region.x1 - region.x0;
  const u = mirrored ? (x - region.x0) / width : (region.x1 - x) / width;
  return Math.min(1, Math.max(0, u));
}

export type HandRole =
  /** Driving the cursor. At most one. */
  | 'driver'
  /** In shot, in a usable posture, and available for two-handed gestures. */
  | 'support'
  /** In shot but not asking for anything: on the desk, on the keyboard, holding a mouse. */
  | 'resting'
  /** At the edge of frame, half out of shot, or too turned away to read. */
  | 'edge';

export interface RoleConfig {
  /** Fraction of the frame at each edge that is NOT the action area. */
  margin: number;
  /** Below this readability a hand cannot drive, whatever it is doing. */
  minReadability: number;
  /** Below this height (fraction of frame, from the top) a hand is down on the desk. */
  restingBelow: number;
  /**
   * Once a hand is driving it keeps driving until it is clearly worse than the alternative, by this
   * margin of score. Without it, two hands both in the pointing posture swap the cursor between them
   * several times a second.
   */
  stickiness: number;
  /**
   * The frame's width over its height, so hands are measured in square units (hand-metrics.ts). 1 means
   * the landmarks are already square. The live controller passes the cameras' 16:9 — see
   * DEFAULT_CONTROL_CONFIG — and leaving it at 1 there is the bug that stopped every upright hand driving.
   */
  aspect: number;
}

export const DEFAULT_ROLE_CONFIG: RoleConfig = {
  margin: 0.06,
  minReadability: 0.25,
  restingBelow: 0.78,
  stickiness: 0.15,
  aspect: 1
};

export interface HandView {
  /** Index into the frame's hands array. */
  index: number;
  hand: Hand;
  metrics: HandMetrics;
  role: HandRole;
  /** Palm centre, for the boundary test. */
  at: { x: number; y: number };
  readability: number;
  pointing: boolean;
  /**
   * Up off the desk, and readable. A two-handed gesture needs two of these — NOT two hands in shot,
   * because a hand resting beside a pointing one would otherwise put the machine into a zoom and
   * take the cursor away.
   */
  raised: boolean;
  /** How good a driver this hand would be, 0 to 1. Only meaningful for a candidate. */
  score: number;
}

export interface HandAssignment {
  hands: HandView[];
  driver: HandView | null;
  support: HandView | null;
  /** One line for the monitor, so "why is nothing happening" is answerable at a glance. */
  note: string;
}

const palmOf = (hand: Hand): { x: number; y: number } | null => {
  // Wrist and the four knuckles: steadier than any single landmark, and unaffected by the fingers.
  const ids = [0, 5, 9, 13, 17];
  let x = 0;
  let y = 0;
  for (const id of ids) {
    const point = hand[id];
    if (!point) return null;
    x += point.x;
    y += point.y;
  }
  return { x: x / ids.length, y: y / ids.length };
};

/**
 * Assign roles for one frame.
 *
 * `previousDriver` is the index of whatever was driving last frame, which is what makes the choice
 * sticky: a hand keeps the cursor unless another is meaningfully better, so the pointer does not
 * flick between two raised hands.
 */
export function assignHands(
  hands: readonly Hand[],
  previousDriver: number | null = null,
  config: RoleConfig = DEFAULT_ROLE_CONFIG,
  /**
   * How likely each hand (by index) is to be in a CONTROL pose, 0 to 1.
   *
   * Supplied by gesture-control.ts from the pose model. Without it the old test applies — the pointing
   * posture — kept for anything that still asks the old question. It was that old test which made
   * William's new vocabulary unusable: an open hand and a fist both fail it, so on 2026-09-12 no hand
   * could ever drive and only the shape-blind zoom worked.
   */
  candidate?: (index: number) => number
): HandAssignment {
  const views: HandView[] = [];

  hands.forEach((hand, index) => {
    const metrics = handMetrics(hand, config.aspect);
    const at = palmOf(hand);
    if (!metrics || !at) return;
    const read = readability(metrics);
    const pointing = candidate ? candidate(index) >= 0.5 : isPointingPosture(metrics);

    const outside =
      at.x < config.margin || at.x > 1 - config.margin || at.y < config.margin || at.y > 1 - config.margin;

    let role: HandRole;
    if (outside || read < config.minReadability) role = 'edge';
    // Under the control-pose gate a hand down by the desk rests whatever shape it is in: an open hand is
    // the shape a resting hand is most often in, and it is also the cursor.
    else if (candidate && at.y > config.restingBelow) role = 'resting';
    else if (!pointing && at.y > config.restingBelow) role = 'resting';
    else if (!pointing) role = 'resting';
    else role = 'support';

    /*
     * How good a driver: readable, well inside the frame, and raised rather than down by the desk.
     * Centre-weighted because the middle of the picture is where the lens is sharpest and the hand
     * is least likely to be clipped mid-gesture.
     */
    const centred = 1 - Math.min(1, Math.hypot(at.x - 0.5, at.y - 0.5) * 1.6);
    const raised = Math.max(0, Math.min(1, (config.restingBelow - at.y) / config.restingBelow));
    const score = role === 'support' ? read * 0.5 + centred * 0.3 + raised * 0.2 : 0;

    views.push({
      index,
      hand,
      metrics,
      role,
      at,
      readability: read,
      pointing,
      raised: role !== 'edge' && at.y <= config.restingBelow,
      score
    });
  });

  const candidates = views.filter((view) => view.role === 'support');
  let driver: HandView | null = null;
  if (candidates.length) {
    const best = candidates.reduce((a, b) => (b.score > a.score ? b : a));
    const held = candidates.find((view) => view.index === previousDriver);
    // Sticky: the hand that was driving keeps it unless another is clearly better.
    driver = held && best.score - held.score < config.stickiness ? held : best;
    driver.role = 'driver';
  }
  const support = candidates.find((view) => view !== driver) ?? null;

  const note = driver
    ? candidates.length > 1
      ? 'two hands up'
      : 'one hand driving'
    : views.length
      ? views.every((view) => view.role === 'resting')
        ? 'hands resting'
        : 'hands at the edge of frame'
      : 'no hands';

  return { hands: views, driver, support, note };
}
