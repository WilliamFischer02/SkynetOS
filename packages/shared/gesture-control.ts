/**
 * Gesture control: the machine that decides what your hands are asking for.
 *
 * ── The vocabulary, as William set it on 2026-09-12 ──────────────────────────────────────────
 *
 *   OPEN HAND           the cursor, and cursor movement mirrors the hand's movement.
 *   CLOSE, THEN OPEN    a left click.
 *   CLOSE AND HOLD      click-hold; move while holding and it drags.
 *   PEACE SIGN          a right click.
 *   TWO HANDS APART     zoom in — the hands pointed or facing towards each other, moving apart.
 *   TWO HANDS TOGETHER  zoom out — the same, moving together.
 *
 * ── Why the previous engine could not do any of it ───────────────────────────────────────────
 *
 * It was built for an earlier vocabulary: a pinched pen-grip for the cursor, the pinch closing for a
 * click, a wrist twist for the right click. Its gate for "this hand is driving" was the pointing
 * posture, which an open hand and a fist both fail — so under the new vocabulary no hand could ever
 * drive, and the only gesture that worked was the one that ignored hand shape entirely. That is
 * precisely what William saw: "the zoom feature is the only one starting to work."
 *
 * ── How this one decides ─────────────────────────────────────────────────────────────────────
 *
 * Four layers, each in its own file and each tested on its own:
 *
 *   hand-geometry.ts  3D shape from the landmarks: finger curl as reach, the V, the palm's normal.
 *   pose-model.ts     which pose, as a probability: geometry, fused with MediaPipe's pre-trained
 *                     classifier, sharpened by William's own recordings.
 *   one-euro.ts       the cursor filter: steady when still, no lag when moving.
 *   this file         TIME. Poses are smoothed, entered and left with hysteresis, and turned into
 *                     clicks, drags and zooms by what happens between frames.
 *
 * Three decisions in this file matter more than the rest:
 *
 *  1. The pointer is the PALM, not a fingertip (hand-geometry.ts measures a fingertip moving 22% of the
 *     frame as a fist closes; the palm moves by none of it). And the moment the hand starts closing —
 *     measured as the rate of change of closure, not as a class — the cursor is frozen, so the click
 *     lands where he was aiming rather than where the hand drifted while closing.
 *
 *  2. A fist is RELEASED by the hand opening, not by the classifier losing confidence. A classifier
 *     flickering for a frame in the middle of a drag must not drop whatever is being dragged.
 *
 *  3. Nothing here needs training. The geometric model is the baseline; recordings only sharpen it.
 *
 * Pure, owning no timers: every decision is made from the timestamps it is given, so a click, a drag
 * and a three-second halt are all tested in milliseconds against the synthetic hand.
 */

import type { Hand } from './gesture.js';
import { DEFAULT_ASPECT, closure, handGeometry, type GeometrySource, type HandGeometry } from './hand-geometry.js';
import { assignHands, DEFAULT_ROLE_CONFIG, type RawSide, type RoleConfig, type HandView } from './hand-roles.js';
import { CURSOR_FILTER, ZOOM_FILTER, oneEuro1D, oneEuro2D, type OneEuroConfig } from './one-euro.js';
import {
  ANATOMICAL_MODEL,
  POSE_CLASSES,
  argmax,
  cannedPosterior,
  classify,
  fuse,
  poseFeatures,
  refine,
  type FeatureVector,
  type PoseClass,
  type PoseFeatures,
  type Posterior
} from './pose-model.js';
import {
  DEFAULT_MARGIN,
  DEFAULT_THRESHOLD,
  MIN_SAMPLES,
  classifyGesture,
  distanceToKeyframe,
  featuresOf,
  isSuppression,
  type GestureAction,
  type GestureDefinition,
  type GestureLibrary
} from './gesture-library.js';

/** One hand as the vision page sees it. A bare landmark array is accepted too, for older callers. */
export interface HandObservation {
  landmarks: Hand;
  /** World landmarks in metres, when the landmarker provides them. */
  world?: Hand | null;
  /** The landmarker's own handedness label, untranslated. Nothing in the five controls depends on it. */
  label?: RawSide;
  /** The GestureRecognizer's canned gesture scores for this hand, when it is the engine running. */
  canned?: readonly { categoryName: string; score: number }[];
}

export type HandInput = Hand | HandObservation;

const asObservation = (input: HandInput): HandObservation => (Array.isArray(input) ? { landmarks: input } : input);

export interface ControlConfig {
  /** A pose is entered when its smoothed probability reaches this. */
  enter: number;
  /** And left when it falls below this. The gap between the two is the hysteresis. */
  exit: number;
  /** Time constant of the exponential smoothing on pose probabilities, ms. */
  poseTauMs: number;
  /** A fist held longer than this is a hold — a drag — rather than a click. */
  clickHoldMs: number;
  /** Shorter than this, a fist was a flicker, not a click. */
  clickMinMs: number;
  /** Palm travel while closed, in frame widths, that turns a click into a drag before the hold time. */
  dragSlop: number;
  /** While a fist is closed, it counts as released once mean closure falls below this. */
  releaseClosure: number;
  /** Closure rising faster than this (per second) means the hand is closing: freeze the cursor. */
  closingRate: number;
  /** How long the cursor stays frozen after a closing starts, if no fist or peace sign follows. */
  clickLockMs: number;
  doubleClickMs: number;
  /** A peace sign must be held this long to be a right click. */
  rightDwellMs: number;
  /** And the hand must leave it for this long before another right click can fire. */
  rightRearmMs: number;
  /** How much the pre-trained classifier's vote counts beside geometry (which counts 1). */
  cannedWeight: number;
  /** How much another camera's view of the same hand counts, when it is unambiguous. */
  corroborateWeight: number;
  /** Another camera's view older than this is not the same moment. */
  corroborateMs: number;
  /** Change in hand separation, in palm lengths, per zoom step. */
  zoomStep: number;
  /** How much the two hands must be turned towards each other, 0 to 1, for zoom to engage. */
  zoomMinOrientation: number;
  /**
   * Where a click lands: the cursor as it was this long before the closing motion was noticed. Noticing
   * lags the hand by a frame or two of smoothing, and a hand drifts as it closes, so "where the cursor is
   * now" is already a little past where he aimed.
   */
  clickLookbackMs: number;
  /**
   * A fist this certain in ONE frame, and this closed, is entered at once. Smoothing is for doubtful
   * frames; making an unambiguous fist wait two frames for it is what made a quick click feel late, and a
   * very quick one go missing.
   */
  fastEnter: number;
  fastClosure: number;
  /** Moving a closed fist starts a drag only once it has been closed this long: closing moves the hand too. */
  dragSlopMs: number;
  /** How long the cursor glides between two positions that are both right, rather than jumping. */
  handoverMs: number;
  /** Both hands in fists for this long halts every input. */
  bothFistsDwellMs: number;
  haltMs: number;
  /** Below this, a TRAINED recognition (the catalogue) is thrown away rather than acted on. */
  minConfidence: number;
  /** How long the keyframes of one trained sequence may take, end to end. */
  sequenceMs: number;
  /** A trained posture-to-ignore must be held this long before it takes hold. */
  suppressDwellMs: number;
  cursorFilter: OneEuroConfig;
  zoomFilter: OneEuroConfig;
  roles: RoleConfig;
}

export const DEFAULT_CONTROL_CONFIG: ControlConfig = {
  enter: 0.6,
  exit: 0.35,
  poseTauMs: 60,
  clickHoldMs: 320,
  clickMinMs: 40,
  dragSlop: 0.03,
  releaseClosure: 0.55,
  closingRate: 2,
  clickLockMs: 220,
  doubleClickMs: 400,
  rightDwellMs: 150,
  rightRearmMs: 250,
  cannedWeight: 0.6,
  corroborateWeight: 0.8,
  corroborateMs: 150,
  // About 0.12 of the frame width at arm's length — the step the old zoom used, which worked — but
  // measured in the hand's own palm lengths so it means the same near the camera and far from it.
  zoomStep: 1.1,
  zoomMinOrientation: 0.25,
  clickLookbackMs: 70,
  fastEnter: 0.85,
  fastClosure: 0.8,
  dragSlopMs: 150,
  handoverMs: 160,
  bothFistsDwellMs: 300,
  haltMs: 3000,
  minConfidence: 0.55,
  sequenceMs: 1500,
  suppressDwellMs: 250,
  cursorFilter: CURSOR_FILTER,
  zoomFilter: ZOOM_FILTER,
  // The cameras capture 16:9. Measuring hands in unsquared coordinates is what stopped upright hands driving.
  roles: { ...DEFAULT_ROLE_CONFIG, aspect: DEFAULT_ASPECT }
};

export type SuppressReason = 'rest' | 'ignore' | 'halt' | 'uncertain' | 'unreadable' | 'no-hand';

export type ControlEvent =
  | { type: 'cursor'; x: number; y: number }
  /** Where it lands travels with it: not always where the cursor was last drawn (see clickLookbackMs). */
  | { type: 'click'; button: 'left' | 'right'; count: 1 | 2; x: number; y: number }
  | { type: 'dragStart'; x: number; y: number }
  | { type: 'dragMove'; x: number; y: number; dx: number; dy: number }
  | { type: 'dragEnd'; x: number; y: number }
  | { type: 'scroll'; dx: number; dy: number }
  /** Zoom about this point: the cursor, which two raised hands place between them. */
  | { type: 'zoom'; direction: 'in' | 'out'; x: number; y: number }
  | { type: 'zoomLocked' }
  /** One hand closed like a book: the user is asking for manual control to switch off. */
  | { type: 'stopControl' }
  | { type: 'suppressed'; reason: SuppressReason; untilMs?: number }
  | { type: 'resumed' }
  | { type: 'gesture'; gestureId: string; name: string; utterance: string; confidence: number };

export interface ControlState {
  /** What the hands are doing, in words: "one hand driving", "hands resting", "no hands". */
  hands: string;
  suppressed: SuppressReason | null;
  haltUntilMs: number;
  dragging: boolean;
  zoomLocked: boolean;
  /** Two raised hands are placing the cursor between them. */
  twoHanded: boolean;
  cursor: { x: number; y: number } | null;
  /** The settled pose of the driving hand, or null between poses. */
  pose: PoseClass | null;
  /** The smoothed probability of the most likely pose, whether or not it has been entered. */
  confidence: number;
  posterior: Posterior | null;
  /** Mean curl of the driving hand's long fingers, 0 open … 1 closed. */
  closure: number;
  /** Where the 3D came from for the driving hand. */
  source: GeometrySource | null;
  /** How readable the driving hand is, 0 to 1. */
  readability: number;
  /** How many of William's own recorded keyframes sharpened the pose model. */
  refinedFrom: number;
}

export interface GestureControl {
  push(frame: { hands: HandInput[]; atMs: number }): ControlEvent[];
  /** Another camera's view of the same moment, folded into the driving hand's pose when unambiguous. */
  corroborate(frame: { hands: HandInput[]; atMs: number }): void;
  state(): ControlState;
  reset(): void;
}

const CONTROL_POSES: readonly PoseClass[] = ['open', 'fist', 'peace'];

/** Which pose each keyframe of a built-in gesture was recorded in, for sharpening the model. */
const KEYFRAME_POSES: Partial<Record<GestureAction, PoseClass[]>> = {
  cursor: ['open'],
  'left-click': ['open', 'fist'],
  'double-click': ['open', 'fist'],
  drag: ['fist', 'fist'],
  'right-click': ['open', 'peace']
};

/** William's recordings, as labelled pose examples. Only samples that carry pose features count. */
export function poseExamples(library: GestureLibrary): { pose: PoseClass; features: PoseFeatures }[] {
  const examples: { pose: PoseClass; features: PoseFeatures }[] = [];
  for (const gesture of library.gestures) {
    const poses = gesture.action ? KEYFRAME_POSES[gesture.action] : undefined;
    if (!poses || gesture.disabled) continue;
    for (const sample of gesture.samples) {
      (sample.pose ?? []).forEach((vector, k) => {
        if (vector.length !== 7 || !vector.every(Number.isFinite)) return;
        const pose = poses[Math.min(k, poses.length - 1)]!;
        examples.push({ pose, features: { values: vector.slice(0, 6) as FeatureVector, spreadWeight: vector[6]! } });
      });
    }
  }
  return examples;
}

const usable = (gesture: GestureDefinition): boolean => !gesture.disabled && gesture.samples.length >= MIN_SAMPLES;
const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * How much two hands are turned towards each other, 0 to 1.
 *
 * William described zoom two ways — "pointed towards each other" and "facing together" — and they are
 * different configurations: fingers aimed at the other hand, or palms turned to face it. Either
 * counts. Pointing comes from the direction of each hand in the picture and needs nothing else.
 * Facing needs to know which side of each hand is the palm; where the geometry could not tell, it
 * counts as neutral rather than as a refusal, so the zoom that already worked keeps working.
 */
export function orientationBetween(a: HandGeometry, b: HandGeometry): number {
  const dx = b.anchor.x - a.anchor.x;
  const dy = (b.anchor.y - a.anchor.y) / DEFAULT_ASPECT;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return 0;
  const ux = dx / length;
  const uy = dy / length;
  const pointing = (Math.max(0, a.axis.x * ux + a.axis.y * uy) + Math.max(0, -(b.axis.x * ux + b.axis.y * uy))) / 2;
  const facing =
    a.palmNormal && b.palmNormal
      ? (Math.max(0, a.palmNormal[0] * ux + a.palmNormal[1] * uy) + Math.max(0, -(b.palmNormal[0] * ux + b.palmNormal[1] * uy))) / 2
      : 0.5;
  return Math.max(pointing, facing);
}

/** Palm-to-palm distance in the hands' own palm lengths: the same number near the camera or far. */
export function separationOf(a: HandGeometry, b: HandGeometry): number {
  const dx = b.anchor.x - a.anchor.x;
  const dy = (b.anchor.y - a.anchor.y) / DEFAULT_ASPECT;
  const palm = (a.palm + b.palm) / 2;
  return palm > 1e-9 ? Math.hypot(dx, dy) / palm : 0;
}

export function createControl(
  library: GestureLibrary,
  config: ControlConfig = DEFAULT_CONTROL_CONFIG
): GestureControl {
  const sequences = library.gestures.filter((gesture) => usable(gesture) && gesture.frames > 1 && gesture.action !== 'left-click' && gesture.action !== 'right-click' && gesture.action !== 'double-click' && gesture.action !== 'drag');
  const examples = poseExamples(library);
  const model = refine(ANATOMICAL_MODEL, examples);

  let suppressed: SuppressReason | null = null;
  let suppressSince: number | null = null;
  let haltUntilMs: number | null = null;
  let handNote = 'no hands';
  let live = 0;
  const progress = new Map<string, { index: number; deadline: number }>();

  // ── the driving hand's track ────────────────────────────────────────────────────────────────
  let driverAnchor: { x: number; y: number } | null = null;
  let smoothed: Posterior | null = null;
  let pose: PoseClass | null = null;
  let lastAt: number | null = null;
  let lastClosure: number | null = null;
  let closingRate = 0;
  let currentClosure = 0;
  let source: GeometrySource | null = null;
  const cursorFilter = oneEuro2D(config.cursorFilter);
  let cursor: { x: number; y: number } | null = null;
  let lockUntil: number | null = null;
  let lockedAt: { x: number; y: number } | null = null;

  // ── the click, the hold and the drag ────────────────────────────────────────────────────────
  let fistAt: number | null = null;
  let fistPalm: { x: number; y: number } | null = null;
  let fistPoint: { x: number; y: number } | null = null;
  let fistFiltered: { x: number; y: number } | null = null;
  let dragging = false;
  let lastClickAt: number | null = null;

  // ── the right click ─────────────────────────────────────────────────────────────────────────
  let peaceSince: number | null = null;
  let rightArmed = true;
  let leftPeaceAt: number | null = null;

  // ── two hands ──────────────────────────────────────────────────────────────────────────────
  const zoomFilter = oneEuro1D(config.zoomFilter);
  let zoomBase: number | null = null;
  let zoomLocked = false;
  let bothFistsSince: number | null = null;

  let second: { posterior: Posterior; atMs: number } | null = null;

  // ── where the cursor has been, and the glide between two right answers ─────────────────────
  const trail: { at: number; x: number; y: number }[] = [];
  let handover: { from: { x: number; y: number }; atMs: number } | null = null;

  // ── two raised hands place the cursor between them ──────────────────────────────────────────
  const midFilter = oneEuro2D(config.cursorFilter);
  let twoHanded = false;
  /**
   * The hand that closed, or made a sign, while two were raised. It keeps the controls until what it started
   * is finished, whatever role assignment would otherwise pick — which with two hands up was often the other
   * hand, still open, so the click never came.
   */
  let actingAnchor: { x: number; y: number } | null = null;

  /** Every cursor position shown, for the last second: what a click looks back into. */
  const remember = (at: { x: number; y: number }, atMs: number): void => {
    cursor = at;
    trail.push({ at: atMs, x: at.x, y: at.y });
    while (trail.length > 0 && trail[0]!.at < atMs - 1000) trail.shift();
  };

  /** The cursor as it was at `atMs`, or the oldest remembered when that is further back than memory goes. */
  const cursorAt = (atMs: number): { x: number; y: number } | null => {
    for (let i = trail.length - 1; i >= 0; i--) {
      if (trail[i]!.at <= atMs) return { x: trail[i]!.x, y: trail[i]!.y };
    }
    return trail[0] ? { x: trail[0].x, y: trail[0].y } : null;
  };

  /** From wherever the cursor was to where it should now be, over handoverMs, so a change of source never jumps. */
  const glide = (target: { x: number; y: number }, atMs: number): { x: number; y: number } => {
    if (!handover) return target;
    const k = (atMs - handover.atMs) / config.handoverMs;
    if (k >= 1 || k < 0) {
      handover = null;
      return target;
    }
    const eased = k * k * (3 - 2 * k);
    return { x: handover.from.x + (target.x - handover.from.x) * eased, y: handover.from.y + (target.y - handover.from.y) * eased };
  };
  const startHandover = (atMs: number): void => {
    handover = cursor ? { from: { ...cursor }, atMs } : null;
  };

  const posteriorOf = (geometry: HandGeometry, observation: HandObservation): Posterior => {
    const geometric = classify(poseFeatures(geometry), model);
    const canned = cannedPosterior(observation.canned);
    return canned ? (fuse([{ posterior: geometric, weight: 1 }, { posterior: canned, weight: config.cannedWeight }]) ?? geometric) : geometric;
  };

  const controlness = (posterior: Posterior | null): number => (posterior ? posterior.open + posterior.fist + posterior.peace : 0);

  const resetTrack = (): void => {
    smoothed = null;
    pose = null;
    lastAt = null;
    lastClosure = null;
    closingRate = 0;
    cursorFilter.reset();
    lockUntil = null;
    lockedAt = null;
    fistAt = null;
    fistPalm = null;
    fistPoint = null;
    fistFiltered = null;
    peaceSince = null;
  };

  const reset = (): void => {
    resetTrack();
    suppressed = null;
    suppressSince = null;
    haltUntilMs = null;
    handNote = 'no hands';
    live = 0;
    progress.clear();
    driverAnchor = null;
    cursor = null;
    dragging = false;
    lastClickAt = null;
    rightArmed = true;
    leftPeaceAt = null;
    zoomFilter.reset();
    zoomBase = null;
    zoomLocked = false;
    bothFistsSince = null;
    second = null;
    source = null;
    currentClosure = 0;
    trail.length = 0;
    handover = null;
    midFilter.reset();
    twoHanded = false;
    actingAnchor = null;
  };

  const advanceSequences = (features: number[], atMs: number): GestureDefinition[] => {
    const finished: GestureDefinition[] = [];
    for (const gesture of sequences) {
      const state = progress.get(gesture.id);
      if (state && atMs > state.deadline) progress.delete(gesture.id);
      const index = progress.get(gesture.id)?.index ?? 0;
      if (distanceToKeyframe(features, gesture, index) > (gesture.threshold ?? DEFAULT_THRESHOLD)) continue;
      if (index + 1 >= gesture.frames) {
        progress.delete(gesture.id);
        finished.push(gesture);
      } else {
        progress.set(gesture.id, { index: index + 1, deadline: atMs + config.sequenceMs });
      }
    }
    return finished;
  };

  return {
    state: () => ({
      hands: handNote,
      suppressed,
      haltUntilMs: haltUntilMs ?? 0,
      dragging,
      zoomLocked,
      twoHanded,
      cursor: cursor ? { ...cursor } : null,
      pose,
      confidence: smoothed ? argmax(smoothed).p : 0,
      posterior: smoothed ? { ...smoothed } : null,
      closure: currentClosure,
      source,
      readability: live,
      refinedFrom: examples.length
    }),
    reset,

    corroborate({ hands, atMs }) {
      const candidates = hands
        .map(asObservation)
        .map((observation) => {
          const geometry = handGeometry({ landmarks: observation.landmarks, world: observation.world ?? null });
          return geometry ? posteriorOf(geometry, observation) : null;
        })
        .filter((posterior): posterior is Posterior => posterior !== null && controlness(posterior) >= 0.5);
      // Only when this camera sees exactly one hand that could be driving: with two, there is no way
      // to know which of them is the hand the other camera is following.
      second = candidates.length === 1 ? { posterior: candidates[0]!, atMs } : null;
    },

    push({ hands: inputs, atMs }) {
      const events: ControlEvent[] = [];
      const say = (reason: SuppressReason, untilMs?: number): void => {
        if (suppressed === reason) return;
        suppressed = reason;
        events.push(untilMs === undefined ? { type: 'suppressed', reason } : { type: 'suppressed', reason, untilMs });
      };
      const clear = (): void => {
        if (suppressed === null) return;
        suppressed = null;
        events.push({ type: 'resumed' });
      };
      /** End whatever the hand was in the middle of, without firing a click it did not finish. */
      const abandon = (): void => {
        if (dragging) {
          const where = cursor ?? fistPoint;
          if (where) events.push({ type: 'dragEnd', x: where.x, y: where.y });
          dragging = false;
        }
        fistAt = null;
        fistPalm = null;
        fistPoint = null;
        fistFiltered = null;
        lockUntil = null;
        lockedAt = null;
        peaceSince = null;
        pose = null;
      };

      if (haltUntilMs !== null && atMs < haltUntilMs) {
        say('halt', haltUntilMs);
        return events;
      }
      if (haltUntilMs !== null) {
        haltUntilMs = null;
        clear();
      }

      const observations = inputs.map(asObservation);
      if (!observations.length) {
        abandon();
        resetTrack();
        driverAnchor = null;
        zoomBase = null;
        bothFistsSince = null;
        twoHanded = false;
        midFilter.reset();
        handover = null;
        actingAnchor = null;
        live = 0;
        handNote = 'no hands';
        say('no-hand');
        return events;
      }

      // ── measure every hand once ───────────────────────────────────────────────────────────────
      const measured = observations.map((observation) => {
        const geometry = handGeometry({ landmarks: observation.landmarks, world: observation.world ?? null });
        return { observation, geometry, posterior: geometry ? posteriorOf(geometry, observation) : null };
      });

      /*
       * Keep the driver by POSITION. MediaPipe lists hands in no guaranteed order, so the index of the
       * hand that drove last frame says nothing about which hand it is this frame.
       */
      let previousIndex: number | null = null;
      if (driverAnchor) {
        let best = 0.2;
        measured.forEach((entry, index) => {
          if (!entry.geometry) return;
          const d = distance(entry.geometry.anchor, driverAnchor!);
          if (d < best) {
            best = d;
            previousIndex = index;
          }
        });
      }
      const assignment = assignHands(
        observations.map((observation) => observation.landmarks),
        previousIndex,
        config.roles,
        (index) => controlness(measured[index]?.posterior ?? null)
      );
      handNote = assignment.note;

      // ── two raised hands: the halt, and the zoom ──────────────────────────────────────────────
      const raised = assignment.hands.filter((view) => view.raised).sort((a, b) => b.readability - a.readability);
      const first = raised[0] ? measured[raised[0].index] : undefined;
      const other = raised[1] ? measured[raised[1].index] : undefined;
      if (first?.geometry && first.posterior && other?.geometry && other.posterior) {
        if (first.posterior.fist >= config.enter && other.posterior.fist >= config.enter) {
          bothFistsSince ??= atMs;
          if (atMs - bothFistsSince >= config.bothFistsDwellMs) {
            if (zoomBase !== null) {
              zoomLocked = true;
              events.push({ type: 'zoomLocked' });
            }
            abandon();
            zoomBase = null;
            bothFistsSince = null;
            haltUntilMs = atMs + config.haltMs;
            say('halt', haltUntilMs);
          }
          return events;
        }
        bothFistsSince = null;

        const openish = (posterior: Posterior): boolean => posterior.fist < config.enter && posterior.peace < config.enter;
        const firstOpen = openish(first.posterior);
        const otherOpen = openish(other.posterior);
        // A fist or a sign already under way belongs to its hand until it is released: going back to two
        // hands mid-click would abandon the very click that was about to land.
        if (firstOpen && otherOpen && pose !== 'fist' && pose !== 'peace') {
          /*
           * William, 2026-09-12: "holding both hands up far apart or close together should be registered as
           * the cursor, and zoom should always happen on where the cursor is … it allows me to place the
           * cursor where on screen and the software zooms into that location."
           *
           * So two raised hands place the cursor at the point between them, whether or not they are zooming,
           * and it glides there from wherever one hand had it rather than jumping half a frame.
           */
          abandon();
          resetTrack();
          clear();
          driverAnchor = null;
          if (!twoHanded) {
            twoHanded = true;
            midFilter.reset();
            startHandover(atMs);
          }
          const mid = midFilter.filter(
            (first.geometry.anchor.x + other.geometry.anchor.x) / 2,
            (first.geometry.anchor.y + other.geometry.anchor.y) / 2,
            atMs
          );
          const at = glide(mid, atMs);
          remember(at, atMs);
          events.push({ type: 'cursor', x: at.x, y: at.y });

          if (orientationBetween(first.geometry, other.geometry) < config.zoomMinOrientation) {
            // Up, but not turned towards each other: a cursor, and not a zoom.
            zoomBase = null;
            zoomLocked = false;
            zoomFilter.reset();
            return events;
          }
          const separation = zoomFilter.filter(separationOf(first.geometry, other.geometry), atMs);
          if (zoomLocked) {
            // Re-armed only by opening both hands again: a zoom does not resume wherever they drifted.
            if (first.posterior.open >= config.enter && other.posterior.open >= config.enter) {
              zoomLocked = false;
              zoomBase = separation;
            }
            return events;
          }
          zoomBase ??= separation;
          const change = separation - zoomBase;
          if (Math.abs(change) >= config.zoomStep) {
            // About the cursor: the point the two hands placed.
            events.push({ type: 'zoom', direction: change > 0 ? 'in' : 'out', x: at.x, y: at.y });
            zoomBase = separation;
          }
          return events;
        }
        if (twoHanded) {
          // One of the two has closed, or made a sign: THAT hand acts, at the point the two of them placed.
          driverAnchor = firstOpen ? other.geometry.anchor : first.geometry.anchor;
          actingAnchor = driverAnchor;
        }
      } else {
        bothFistsSince = null;
      }
      if (twoHanded) {
        twoHanded = false;
        midFilter.reset();
        startHandover(atMs);
      }
      zoomBase = null;
      zoomLocked = false;
      zoomFilter.reset();

      // ── which hand the catalogue is asked about ─────────────────────────────────────────────
      let driving = assignment.driver;
      if (actingAnchor) {
        // The hand that closed while two were up keeps the controls, found again by where it is.
        let nearest: HandView | null = null;
        let best = 0.2;
        for (const view of assignment.hands) {
          const anchor = measured[view.index]?.geometry?.anchor;
          if (!anchor || view.role === 'edge') continue;
          const d = distance(anchor, actingAnchor);
          if (d < best) {
            best = d;
            nearest = view;
          }
        }
        if (nearest) driving = nearest;
        else actingAnchor = null;
      }
      const subjectView =
        driving ??
        assignment.hands.filter((view) => view.role !== 'edge').sort((a, b) => b.readability - a.readability)[0] ??
        null;
      if (!subjectView) {
        abandon();
        say('unreadable');
        return events;
      }
      const subject = measured[subjectView.index]!;
      live = subjectView.readability;

      /*
       * The trained catalogue still has two jobs: postures to ignore, and sequences such as CLOSE THE
       * BOOK. A posture to ignore only wins when the geometry is NOT confident this is a control pose —
       * a mistrained HOLDING A MOUSE must never be able to swallow a clear fist.
       */
      const features = featuresOf(subject.observation.landmarks);
      const match = features ? classifyGesture(features, library, { margin: DEFAULT_MARGIN }) : null;
      const matched = match ? library.gestures.find((gesture) => gesture.id === match.gestureId) : undefined;
      const confident = match !== null && match.confidence * Math.max(live, 0.4) >= config.minConfidence;
      if (matched && isSuppression(matched) && confident && controlness(subject.posterior) < 0.5) {
        suppressSince ??= atMs;
        if (suppressed !== null || atMs - suppressSince >= config.suppressDwellMs) {
          abandon();
          say(matched.action === 'rest' ? 'rest' : 'ignore');
        }
        return events;
      }
      suppressSince = null;

      if (features) {
        for (const finished of advanceSequences(features, atMs)) {
          if (finished.action === 'stop-control') {
            abandon();
            events.push({ type: 'stopControl' });
            return events;
          }
          if (!finished.action && finished.utterance) {
            events.push({ type: 'gesture', gestureId: finished.id, name: finished.name, utterance: finished.utterance, confidence: match?.confidence ?? 1 });
          }
        }
      }

      if (!driving) {
        abandon();
        resetTrack();
        driverAnchor = null;
        say(assignment.hands.some((view) => view.role === 'resting') ? 'rest' : 'unreadable');
        return events;
      }
      clear();

      // ── the driving hand ────────────────────────────────────────────────────────────────────
      const hand = measured[driving.index]!;
      const geometry = hand.geometry!;
      if (driverAnchor && distance(driverAnchor, geometry.anchor) > 0.2) {
        // A different hand took over. Nothing half-done by the old one carries across.
        abandon();
        resetTrack();
      }
      driverAnchor = geometry.anchor;
      source = geometry.source;

      let posterior = hand.posterior!;
      const alone = assignment.hands.filter((view) => view.role !== 'edge').length === 1;
      if (second && alone && atMs - second.atMs <= config.corroborateMs) {
        posterior = fuse([{ posterior, weight: 1 }, { posterior: second.posterior, weight: config.corroborateWeight }]) ?? posterior;
      }

      const dt = lastAt === null ? 0 : Math.max(0, atMs - lastAt);
      const alpha = smoothed === null ? 1 : 1 - Math.exp(-dt / config.poseTauMs);
      const next = {} as Posterior;
      for (const c of POSE_CLASSES) next[c] = smoothed === null ? posterior[c] : smoothed[c] + alpha * (posterior[c] - smoothed[c]);
      smoothed = next;

      currentClosure = closure(geometry);
      if (lastClosure !== null && dt > 0) {
        const rate = (currentClosure - lastClosure) / (dt / 1000);
        closingRate += (1 - Math.exp(-dt / config.poseTauMs)) * (rate - closingRate);
      }
      lastClosure = currentClosure;
      lastAt = atMs;

      // ── which pose, with hysteresis ─────────────────────────────────────────────────────────
      const previous = pose;
      const top = argmax(smoothed);
      let settled: PoseClass | null = pose;
      if (settled !== null && smoothed[settled] < config.exit) settled = null;
      if (CONTROL_POSES.includes(top.pose) && top.pose !== settled && top.p >= config.enter) settled = top.pose;
      // An unmistakable fist in this very frame is a fist now, not two frames from now (fastEnter).
      if (previous !== 'fist' && settled !== 'fist' && posterior.fist >= config.fastEnter && currentClosure >= config.fastClosure) settled = 'fist';
      /*
       * A fist is released by the hand OPENING — in both directions. A classifier losing confidence while
       * the hand is still closed is not a release; and a hand that has visibly opened is released at
       * once, rather than when the smoothed probability finally decays past the exit line, which cost
       * two frames of latency on every click.
       */
      if (previous === 'fist') {
        if (currentClosure < config.releaseClosure) {
          if (settled === 'fist') settled = top.pose !== 'fist' && CONTROL_POSES.includes(top.pose) && top.p >= config.enter ? top.pose : null;
        } else if (settled !== 'open' && settled !== 'peace') {
          settled = 'fist';
        }
      }
      pose = settled;

      const filtered = cursorFilter.filter(geometry.anchor.x, geometry.anchor.y, atMs);

      // ── freeze the cursor the moment the hand starts to close ───────────────────────────────
      if (closingRate > config.closingRate && lockUntil === null && previous !== 'fist' && !dragging) {
        lockUntil = atMs + config.clickLockMs;
        lockedAt = cursorAt(atMs - config.clickLookbackMs) ?? cursor ?? filtered;
      }
      if (lockUntil !== null && atMs >= lockUntil && pose !== 'fist' && pose !== 'peace') {
        lockUntil = null;
        lockedAt = null;
      }

      // ── the fist: click, hold, drag ─────────────────────────────────────────────────────────
      if (pose === 'fist' && previous !== 'fist') {
        fistAt = atMs;
        fistPalm = geometry.anchor;
        fistPoint = lockedAt ?? cursorAt(atMs - config.clickLookbackMs) ?? cursor ?? filtered;
        fistFiltered = filtered;
      }
      if (pose === 'fist' && fistAt !== null && fistPalm && fistPoint && fistFiltered) {
        if (!dragging && (atMs - fistAt >= config.clickHoldMs || (atMs - fistAt >= config.dragSlopMs && distance(geometry.anchor, fistPalm) >= config.dragSlop))) {
          dragging = true;
          events.push({ type: 'dragStart', x: fistPoint.x, y: fistPoint.y });
        }
        if (dragging) {
          // Offset from where the fist closed, so the drag starts exactly on what was under the cursor.
          const at = { x: fistPoint.x + (filtered.x - fistFiltered.x), y: fistPoint.y + (filtered.y - fistFiltered.y) };
          remember(at, atMs);
          events.push({ type: 'dragMove', x: at.x, y: at.y, dx: at.x - fistPoint.x, dy: at.y - fistPoint.y });
        }
      }
      if (previous === 'fist' && pose !== 'fist') {
        if (dragging) {
          const where = cursor ?? fistPoint;
          if (where) events.push({ type: 'dragEnd', x: where.x, y: where.y });
          dragging = false;
        } else if (fistAt !== null && atMs - fistAt >= config.clickMinMs) {
          const count: 1 | 2 = lastClickAt !== null && atMs - lastClickAt <= config.doubleClickMs ? 2 : 1;
          lastClickAt = count === 2 ? null : atMs;
          const where = fistPoint ?? cursor ?? filtered;
          events.push({ type: 'click', button: 'left', count, x: where.x, y: where.y });
          cursor = where;
        }
        // The hand has usually drifted from where it clicked or dropped: the cursor glides back to it.
        startHandover(atMs);
        fistAt = null;
        fistPalm = null;
        fistPoint = null;
        fistFiltered = null;
        lockUntil = null;
        lockedAt = null;
      }

      // ── the peace sign: a right click, once per sign ────────────────────────────────────────
      if (pose === 'peace') {
        peaceSince ??= atMs;
        leftPeaceAt = null;
        if (rightArmed && atMs - peaceSince >= config.rightDwellMs) {
          const where = lockedAt ?? cursor ?? filtered;
          events.push({ type: 'click', button: 'right', count: 1, x: where.x, y: where.y });
          rightArmed = false;
        }
      } else {
        peaceSince = null;
        if (!rightArmed) {
          leftPeaceAt ??= atMs;
          if (atMs - leftPeaceAt >= config.rightRearmMs) {
            rightArmed = true;
            leftPeaceAt = null;
          }
        }
      }

      // ── the cursor ─────────────────────────────────────────────────────────────────────────
      // Once what the acting hand started is finished, roles decide again.
      if (actingAnchor) actingAnchor = pose === 'fist' || pose === 'peace' || dragging ? geometry.anchor : null;
      const frozen = (lockUntil !== null && atMs < lockUntil) || pose === 'fist' || pose === 'peace';
      if (!dragging && !frozen) {
        const at = glide(filtered, atMs);
        remember(at, atMs);
        events.push({ type: 'cursor', x: at.x, y: at.y });
      }
      return events;
    }
  };
}
