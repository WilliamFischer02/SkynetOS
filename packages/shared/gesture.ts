/**
 * Gesture recognition: hand landmarks in, gesture events out.
 *
 * The second producer for the intent bus (packages/shared/intent.ts). Voice arrives as words;
 * gesture arrives as 21 points per hand per frame, at about 26 fps on this desk. What both have in
 * common is that they end at the same command bus, so neither can do anything a keypress could not.
 *
 * PURE, and for the same reason intent.ts is: the interesting failures here are not in the camera.
 * They are in the thresholds — when a pinch counts as closed, how long a fist must be held, how far
 * a hand must travel before the board moves — and every one of those is a number that can be
 * tested against a synthetic hand without a webcam in the room.
 *
 * Every default below is derived from a measurement, not taste (docs/DECISIONS.md, 2026-09-11,
 * "Hand tracking is not the bottleneck; jitter is"):
 *
 *   - a fingertip held still wanders 8.1 px rms at 1280x720, with 14.1 px p95 excursions. That is
 *     0.63% and 1.1% of frame width, so DEAD_ZONE is 0.012 in normalised units — just past the p95
 *     — and nothing moves the board until the hand leaves it.
 *   - a single-frame classification at that jitter fires on noise, so every discrete gesture holds.
 *   - the cursor is a smoothed track. Raw landmarks are never handed to the board.
 */

/** One MediaPipe landmark, normalised 0..1 across the frame. `z` is relative depth, not metres. */
export interface Landmark { x: number; y: number; z?: number }

/** A hand: exactly 21 landmarks in MediaPipe's order. */
export type Hand = Landmark[];

export const WRIST = 0;
export const TIP = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 } as const;
export const PIP = { thumb: 3, index: 6, middle: 10, ring: 14, pinky: 18 } as const;
export const MCP = { thumb: 2, index: 5, middle: 9, ring: 13, pinky: 17 } as const;
export type Finger = keyof typeof TIP;

export type Pose = 'point' | 'pinch' | 'open' | 'fist' | 'unknown';

export interface GestureConfig {
  /** Pinch closes below this fraction of hand span, and opens above `pinchOpen`. Hysteresis. */
  pinchClose: number;
  pinchOpen: number;
  /** Normalised distance the hand must travel before a drag starts moving anything. */
  deadZone: number;
  /** How long a discrete pose must hold before it fires. */
  dwellMs: number;
  /** Two-hand separation change, as a fraction of the frame, per zoom step. */
  zoomStep: number;
  /** Smoothing: 0 is no smoothing, 1 never moves. Applied per axis, per frame. */
  smoothing: number;
  /** A hand missing for longer than this ends any drag in progress. */
  lostMs: number;
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  pinchClose: 0.35,
  pinchOpen: 0.5,
  // Just past the measured 14.1 px p95 excursion at 1280 px wide.
  deadZone: 0.012,
  dwellMs: 700,
  zoomStep: 0.12,
  smoothing: 0.6,
  lostMs: 300
};

export type GestureEvent =
  /** The smoothed pointer, in normalised frame coordinates. */
  | { type: 'cursor'; x: number; y: number }
  /** The pose, for the on-screen indicator. Emitted only when it changes. */
  | { type: 'pose'; pose: Pose }
  /** A pinch closed: grab whatever the cursor is over. */
  | { type: 'grabStart'; x: number; y: number }
  /** Movement since the grab started, past the dead zone, in normalised units. */
  | { type: 'grabMove'; x: number; y: number; dx: number; dy: number }
  | { type: 'grabEnd'; x: number; y: number }
  /** An open palm after something was held or selected. */
  | { type: 'release' }
  /** A fist held for `dwellMs`. Fires once per fist. */
  | { type: 'undo' }
  /** Two hands moving apart or together, one step per `zoomStep` of separation. */
  | { type: 'zoom'; direction: 'in' | 'out' };

export interface GestureFrame {
  /** Every hand the landmarker found this frame. Empty or absent means none. */
  hands?: Hand[];
  /** Frame time in milliseconds, monotonic. */
  atMs: number;
}

const dist = (a: Landmark, b: Landmark): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The hand's own scale: wrist to middle-finger knuckle. Every threshold is expressed against this
 * rather than in frame units, so a hand held near the lens behaves like one held far away.
 */
export function handSpan(hand: Hand): number {
  const wrist = hand[WRIST];
  const middle = hand[MCP.middle];
  if (!wrist || !middle) return 0;
  return Math.max(dist(wrist, middle), 1e-6);
}

/** A finger is extended when its tip is farther from the wrist than its middle joint. */
export function isExtended(hand: Hand, finger: Finger): boolean {
  const wrist = hand[WRIST];
  const tip = hand[TIP[finger]];
  const pip = hand[PIP[finger]];
  if (!wrist || !tip || !pip) return false;
  return dist(wrist, tip) > dist(wrist, pip) * 1.05;
}

/** Thumb-tip to index-tip, as a fraction of hand span. Below ~0.35 the fingers are touching. */
export function pinchDistance(hand: Hand): number {
  const thumb = hand[TIP.thumb];
  const index = hand[TIP.index];
  if (!thumb || !index) return Number.POSITIVE_INFINITY;
  return dist(thumb, index) / handSpan(hand);
}

/**
 * Which pose this hand is in, tested in order of how specific it is.
 *
 * Pinch is tested first and by distance alone, because a pinching index finger is curled and would
 * otherwise read as "not extended" and fall through to a fist.
 */
export function classifyPose(hand: Hand, config: GestureConfig = DEFAULT_GESTURE_CONFIG): Pose {
  if (hand.length < 21) return 'unknown';
  if (pinchDistance(hand) < config.pinchClose) return 'pinch';
  const index = isExtended(hand, 'index');
  const middle = isExtended(hand, 'middle');
  const ring = isExtended(hand, 'ring');
  const pinky = isExtended(hand, 'pinky');
  const count = [index, middle, ring, pinky].filter(Boolean).length;
  if (index && !middle && !ring && !pinky) return 'point';
  if (count >= 3) return 'open';
  if (count === 0) return 'fist';
  return 'unknown';
}

/** The pointer: the index fingertip, which is what the user is aiming with. */
export function pointerOf(hand: Hand): Landmark | null {
  return hand[TIP.index] ?? null;
}

interface TrackerState {
  pose: Pose;
  /** Smoothed cursor, or null before the first hand. */
  cursor: { x: number; y: number } | null;
  /** Where a pinch closed, and whether the dead zone has been broken yet. */
  grab: { x: number; y: number; moving: boolean } | null;
  /** When the current pose began, for dwell. */
  poseSince: number;
  /** The pose already acted on, so a held fist undoes once rather than every frame. */
  poseFired: boolean;
  /** Two-hand separation at the last zoom step. */
  zoomAnchor: number | null;
  /**
   * When a hand was last in view, or null for never. Null rather than 0: a frame stamped 0 is a
   * real frame, and using 0 as "never" made a hand first seen at time zero impossible to lose.
   */
  lastSeen: number | null;
  /** Something was grabbed or pointed at, so an open palm means "let go" rather than nothing. */
  engaged: boolean;
}

export interface GestureTracker {
  push(frame: GestureFrame): GestureEvent[];
  pose(): Pose;
  cursor(): { x: number; y: number } | null;
  /** Drop everything: manual control was switched off, or the cameras stopped. */
  reset(): void;
}

/**
 * The state machine. One instance per session of manual control; `push` per frame.
 *
 * It is a machine rather than a set of per-frame rules because every interesting behaviour here is
 * about time: hysteresis so a pinch does not chatter at the threshold, dwell so a fist is a
 * decision rather than a flicker, a dead zone so a held hand does not drag, and a timeout so a hand
 * leaving the frame does not leave a node stuck to the cursor.
 */
export function createTracker(config: GestureConfig = DEFAULT_GESTURE_CONFIG): GestureTracker {
  const state: TrackerState = {
    pose: 'unknown',
    cursor: null,
    grab: null,
    poseSince: 0,
    poseFired: false,
    zoomAnchor: null,
    lastSeen: null,
    engaged: false
  };

  const reset = (): void => {
    state.pose = 'unknown';
    state.cursor = null;
    state.grab = null;
    state.poseSince = 0;
    state.poseFired = false;
    state.zoomAnchor = null;
    state.lastSeen = null;
    state.engaged = false;
  };

  return {
    pose: () => state.pose,
    cursor: () => (state.cursor ? { ...state.cursor } : null),
    reset,

    push(frame: GestureFrame): GestureEvent[] {
      const events: GestureEvent[] = [];
      const hands = (frame.hands ?? []).filter((hand) => hand.length >= 21);

      // ── nothing in view ───────────────────────────────────────────────────────────────────
      if (!hands.length) {
        const gone = state.lastSeen !== null && frame.atMs - state.lastSeen > config.lostMs;
        if (gone && state.grab) {
          // A hand that left mid-drag drops what it was holding where it last was, rather than
          // leaving a node attached to a cursor that no longer exists.
          events.push({ type: 'grabEnd', x: state.grab.x, y: state.grab.y });
          state.grab = null;
        }
        if (gone && state.pose !== 'unknown') {
          state.pose = 'unknown';
          state.poseFired = false;
          events.push({ type: 'pose', pose: 'unknown' });
        }
        state.zoomAnchor = null;
        return events;
      }

      state.lastSeen = frame.atMs;

      // ── two hands: zoom, and nothing else ─────────────────────────────────────────────────
      if (hands.length >= 2) {
        const [a, b] = hands as [Hand, Hand];
        const wristA = a[WRIST];
        const wristB = b[WRIST];
        if (wristA && wristB) {
          const separation = dist(wristA, wristB);
          if (state.zoomAnchor === null) state.zoomAnchor = separation;
          const change = separation - state.zoomAnchor;
          if (Math.abs(change) >= config.zoomStep) {
            events.push({ type: 'zoom', direction: change > 0 ? 'in' : 'out' });
            state.zoomAnchor = separation;
          }
        }
        // A drag cannot survive a second hand entering: which hand was holding it is ambiguous.
        if (state.grab) {
          events.push({ type: 'grabEnd', x: state.grab.x, y: state.grab.y });
          state.grab = null;
        }
        return events;
      }

      state.zoomAnchor = null;
      const hand = hands[0]!;
      const pose = classifyPose(hand, config);
      const pointer = pointerOf(hand);
      if (!pointer) return events;

      // ── the cursor, smoothed ──────────────────────────────────────────────────────────────
      const k = Math.min(0.95, Math.max(0, config.smoothing));
      const next = state.cursor
        ? { x: state.cursor.x * k + pointer.x * (1 - k), y: state.cursor.y * k + pointer.y * (1 - k) }
        : { x: pointer.x, y: pointer.y };
      state.cursor = next;
      events.push({ type: 'cursor', x: next.x, y: next.y });

      /*
       * Pinch has two thresholds. Closing at 0.35 of hand span and opening at 0.5 means a hand
       * resting exactly on the boundary cannot rattle between grabbed and dropped, which at the
       * measured jitter it otherwise would, several times a second.
       */
      const pinch = pinchDistance(hand);
      const held = state.grab !== null;
      const closed = held ? pinch < config.pinchOpen : pinch < config.pinchClose;

      if (pose !== state.pose) {
        // A pinch in progress is not a pose change worth announcing mid-drag.
        state.pose = pose;
        state.poseSince = frame.atMs;
        state.poseFired = false;
        events.push({ type: 'pose', pose });
      }

      if (closed && !held) {
        state.grab = { x: next.x, y: next.y, moving: false };
        state.engaged = true;
        events.push({ type: 'grabStart', x: next.x, y: next.y });
      } else if (closed && state.grab) {
        const dx = next.x - state.grab.x;
        const dy = next.y - state.grab.y;
        // Nothing moves until the hand leaves the dead zone; after that every frame reports.
        if (state.grab.moving || Math.hypot(dx, dy) > config.deadZone) {
          state.grab.moving = true;
          events.push({ type: 'grabMove', x: next.x, y: next.y, dx, dy });
        }
      } else if (!closed && state.grab) {
        events.push({ type: 'grabEnd', x: next.x, y: next.y });
        state.grab = null;
      }

      // ── discrete poses, which must be held ────────────────────────────────────────────────
      if (!state.poseFired && frame.atMs - state.poseSince >= config.dwellMs) {
        if (pose === 'fist') {
          events.push({ type: 'undo' });
          state.poseFired = true;
        } else if (pose === 'open' && state.engaged) {
          events.push({ type: 'release' });
          state.poseFired = true;
          state.engaged = false;
        }
      }

      return events;
    }
  };
}
