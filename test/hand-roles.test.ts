/**
 * Which hand is driving, which is helping, and which is just resting on the desk.
 *
 * William, 2026-09-12: "I don't think the program is easily interpreting the difference between one
 * hand resting, both hands resting, one hand up one down, other up other down; the cursor only
 * appears to work when both hands are present."
 *
 * Every one of those four cases is a test here, because the old code had no answer to any of them:
 * it took `hands[0]`, and MediaPipe returns hands in no guaranteed order.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_CONFIG, assignHands } from '@shared/hand-roles.js';
import { makeHand } from './helpers/hands.js';

/** The pointing posture: index out, the rest gathered. This is the hand that asks to drive. */
const pointing = (dx = 0, dy = 0) => makeHand({ fingers: { middle: false, ring: false, pinky: false }, dx, dy });
/** An open hand: in shot, doing nothing in particular. */
const open = (dx = 0, dy = 0) => makeHand({ dx, dy });

/** Far enough down that the palm centre falls below the resting line. */
const DOWN = 0.12;

describe('one hand', () => {
  it('drives when it is up and pointing', () => {
    const assignment = assignHands([pointing()]);
    expect(assignment.driver).not.toBeNull();
    expect(assignment.driver?.role).toBe('driver');
    expect(assignment.support).toBeNull();
    expect(assignment.note).toBe('one hand driving');
  });

  it('does not drive when it is resting, and says so rather than saying nothing is there', () => {
    const assignment = assignHands([open(0, DOWN)]);
    expect(assignment.driver).toBeNull();
    expect(assignment.hands[0]?.role).toBe('resting');
    expect(assignment.note).toBe('hands resting');
  });

  it('does not drive from the edge of frame, however good the pose is', () => {
    const assignment = assignHands([pointing(0.45)]);
    expect(assignment.driver).toBeNull();
    expect(assignment.hands[0]?.role).toBe('edge');
    expect(assignment.note).toBe('hands at the edge of frame');
  });
});

describe('two hands', () => {
  it('lets the raised one drive while the other rests — the case that used to take the cursor away', () => {
    const assignment = assignHands([open(-0.2, DOWN), pointing(0.15)]);
    expect(assignment.driver?.index).toBe(1);
    expect(assignment.hands[0]?.role).toBe('resting');
    // The resting hand is NOT a support: a hand on the desk must not make the machine think a
    // two-handed gesture is under way. That was the fault behind "the cursor only appears to work
    // when both hands are present".
    expect(assignment.support).toBeNull();
    expect(assignment.hands[0]?.raised).toBe(false);
  });

  it('reports both as available when both are up, whatever shape they are in', () => {
    // Two open hands: neither is asking to drive, but both are up — which is what a zoom is made of.
    const assignment = assignHands([open(-0.15), open(0.15)]);
    expect(assignment.hands.every((hand) => hand.raised)).toBe(true);
    expect(assignment.driver).toBeNull();
  });

  it('picks one driver, not two, when both are pointing', () => {
    const assignment = assignHands([pointing(-0.15), pointing(0.15)]);
    expect(assignment.driver).not.toBeNull();
    expect(assignment.hands.filter((hand) => hand.role === 'driver')).toHaveLength(1);
    expect(assignment.support).not.toBeNull();
    expect(assignment.note).toBe('two hands up');
  });

  it('keeps the driver it had, so the pointer does not flick between two raised hands', () => {
    const hands = [pointing(-0.15), pointing(0.02)];
    // Left to itself it would choose the more central hand…
    const fresh = assignHands(hands);
    expect(fresh.driver?.index).toBe(1);
    // …but a hand already driving keeps it unless the other is clearly better.
    const sticky = assignHands(hands, 0);
    expect(sticky.driver?.index).toBe(0);
  });

  it('hands the cursor over when the previous driver leaves the action area', () => {
    const assignment = assignHands([pointing(0.45), pointing(0.05)], 0);
    expect(assignment.driver?.index).toBe(1);
  });

  it('says nothing is driving when both are down', () => {
    const assignment = assignHands([open(-0.2, DOWN), open(0.2, DOWN)]);
    expect(assignment.driver).toBeNull();
    expect(assignment.note).toBe('hands resting');
  });
});

describe('no hands', () => {
  it('is a state with a name, not an absence', () => {
    const assignment = assignHands([]);
    expect(assignment.note).toBe('no hands');
    expect(assignment.driver).toBeNull();
    expect(assignment.hands).toHaveLength(0);
  });

  it('discards a partial hand rather than scoring it', () => {
    expect(assignHands([[{ x: 0.5, y: 0.5 }]]).hands).toHaveLength(0);
  });
});

describe('the boundary itself', () => {
  it('treats the outer margin of the frame as out of play, on every side', () => {
    const margin = DEFAULT_ROLE_CONFIG.margin;
    expect(margin).toBeGreaterThan(0);
    for (const [dx, dy] of [
      [-0.47, 0],
      [0.45, 0],
      [0, -0.7],
      [0, 0.25]
    ] as const) {
      expect(assignHands([pointing(dx, dy)]).hands[0]?.role).toBe('edge');
    }
  });
});
