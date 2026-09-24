/**
 * The gesture catalogue: gestures William trains, and what they stand for.
 *
 * ── The idea that makes this small ────────────────────────────────────────────────────────────
 *
 * A trained gesture does not store an action. It stores WORDS — the same words the voice grammar
 * accepts (packages/shared/intent.ts). "Zoom in", "select the stalker", "give me manual control".
 * The board resolves them with `resolveIntent` exactly as it resolves something spoken, so:
 *
 *   - a new gesture needs no new mapping code, and no new authority;
 *   - voice and gesture cannot drift apart, because there is one grammar and one bus;
 *   - the gesture's meaning is legible in the catalogue — a row says "THUMBS UP → undo", not
 *     "THUMBS UP → handler #4";
 *   - and nothing a gesture can do could not be done by saying it, which is the security answer
 *     as well as the design one.
 *
 * The continuous half stays where it is: pointing, pinch-dragging and two-handed zoom are handled
 * frame by frame by the tracker in gesture.ts, because a drag is not a command, it is a hundred.
 *
 * ── What recognition is, and is not ───────────────────────────────────────────────────────────
 *
 * Nearest neighbour over normalised landmarks. Not a neural net, deliberately:
 *
 *   - it works from four or five examples, which is what a person will actually record;
 *   - a match can be explained ("0.11 hand-spans from your second FIST sample");
 *   - it needs no training step, no model file, and no GPU;
 *   - and it degrades honestly — an unfamiliar pose is far from everything, rather than being
 *     confidently sorted into whichever class a net happened to prefer.
 *
 * Features are translated to the wrist and scaled by hand span, so the same gesture reads the same
 * near or far, left or right of frame. They are NOT rotation-normalised, which is a choice: a
 * thumbs-up and a thumbs-down are the same hand rotated, and a catalogue that could not tell them
 * apart would be worse than one that asks you to hold a gesture the way you trained it.
 */

import { handSpan, type Hand } from './gesture.js';

/** 21 landmarks, x and y, wrist-relative and span-scaled. */
export const FEATURE_LENGTH = 42;

/**
 * No landmark may sit further than this from the wrist, in hand spans.
 *
 * A real hand fits inside about three: the middle fingertip is roughly two spans out, the thumb
 * less. Anything past this is not a big hand, it is a collapsed SPAN — see `featuresOf`.
 *
 * This is not theoretical. On 2026-09-12 the first real training run stored examples containing
 * -12.4 and -10.8, captured while a hand was turned edge-on to the camera: the wrist and the middle
 * knuckle landed almost on top of each other, the span went to nearly zero, and dividing by it
 * produced a vector fifty times too large. Those samples then dominate every distance they take
 * part in, so a gesture trained with one matches almost nothing — or everything.
 */
export const MAX_FEATURE = 6;

/**
 * The span must be at least this fraction of the hand's own bounding-box diagonal.
 *
 * A hand facing the camera measures about 0.45 by this test; one turned edge-on collapses towards
 * zero while its bounding box stays wide, which is exactly the case that has to be refused.
 */
export const MIN_SPAN_RATIO = 0.2;

/**
 * Distance in hand spans below which a pose counts as the trained gesture.
 *
 * Set from measurement, not taste. With the synthetic hands in test/helpers/hands.ts:
 *
 * | pair                        | mean  |  RMS  |  max  |
 * |-----------------------------|-------|-------|-------|
 * | POINT vs itself, varied     | 0.057 | 0.064 | 0.096 |
 * | POINT vs TWO FINGERS        | 0.086 | 0.274 | 1.100 |
 * | POINT vs FIST               | 0.171 | 0.355 | 1.100 |
 * | OPEN vs PINCH               | 0.121 | 0.352 | 1.318 |
 *
 * 0.20 sits in the gap between the worst same-gesture variation and the closest pair of genuinely
 * different poses, with about a factor of two either side.
 */
export const DEFAULT_THRESHOLD = 0.2;

/** A new example this close to an existing one teaches nothing: the trainer asks for another angle. */
export const DUPLICATE_DISTANCE = 0.05;

/** A new example this close to a DIFFERENT gesture would make both unreliable. */
export const CLASH_DISTANCE = 0.22;

/**
 * How many examples a gesture needs before it may be used.
 *
 * Four, because fewer describes one hand position rather than a gesture, and because the fourth is
 * where people naturally start varying the angle — which is the variation that makes it work.
 */
export const MIN_SAMPLES = 4;

/** Best must be this much closer than the runner-up, or the pose is called ambiguous. */
export const DEFAULT_MARGIN = 1.3;

/**
 * One recording of a gesture: its keyframes, in order.
 *
 * William, 2026-09-12: "gestures aren't single hand positions but movements between hand and arm
 * positions, so they require 2 to 3 keyframe / key points in the move to be captured so the
 * sequence can be practiced and completed."
 *
 * So a sample is a SEQUENCE. A one-keyframe gesture is a posture (the hand is simply held that
 * way); two is a move from one shape to another — a pinch and release, hands coming apart; three
 * carries a middle through which the move must pass, which is what separates a deliberate arc from
 * two unrelated poses that happened in order.
 */
export interface GestureSample {
  id: string;
  /**
   * One FEATURE_LENGTH vector per keyframe, in the order they are performed — for the MAIN hand.
   *
   * The main hand is the right one unless the sample says otherwise, because that is William's
   * dominant hand and a default that is usually right beats a default that is always ambiguous.
   */
  keyframes: number[][];
  /**
   * The second hand, for a two-handed gesture: one vector per keyframe, same length as `keyframes`.
   *
   * William, 2026-09-12: "when training zoom (a two-hand gesture) it only appears to be trying to
   * track the right hand now." It was, and a zoom recorded from one hand is not a recording of a
   * zoom — the whole content of the gesture is what the two hands do relative to each other.
   *
   * Kept as a separate track rather than appended to `keyframes` so that everything which reads
   * the main hand — classification, the health audit, the distance functions — carries on working
   * unchanged, and a one-handed gesture costs nothing.
   */
  offhand?: number[][];
  /**
   * Where the hand was in frame at each keyframe: palm centre, 0..1, one point per keyframe.
   *
   * Only meaningful for a `travel` gesture, where the distance and direction between the first and
   * last point IS the gesture. Recorded for every sample regardless, because it costs two numbers
   * and it is the only way to answer "how far does he actually drag?" from evidence rather than
   * from a guess.
   */
  path?: { x: number; y: number }[];
  /**
   * The pose features at each keyframe (pose-model.ts): thumb reach, four finger curls, tip gap, and
   * how far the gap can be trusted — seven numbers.
   *
   * This is what makes a recording TEACH the geometric model rather than only the nearest-neighbour
   * catalogue: `refine` moves each pose towards how William's own hand makes it. Taken from 3D
   * geometry, so a recording from the side camera teaches the same thing as one from the front.
   */
  pose?: number[][];
  /** ISO timestamp. Shown in the catalogue so a stale sample can be found and re-taken. */
  capturedAt: string;
  /** Which camera saw it, by label, so a gesture trained on one lens is identifiable. */
  camera?: string;
  /**
   * Which VARIANT of the gesture this recording is. Absent means the clean one.
   *
   * William, 2026-09-11: "for each captured gesture the interface should offer to also capture an
   * alternative gestures set that is the user explicitly doing a poor job of the gesture or other
   * angles of the gesture or other hand movements slightly that the feature knows to detect as the
   * gesture — sort of like the 'add other fingers' or 'with a mask' or 'with glasses' Face ID
   * features."
   *
   * He is right, and the reason is worth writing down: a class trained only on careful examples
   * has a boundary drawn around careful examples, so the gesture works while you are paying
   * attention to it and stops working the moment you stop — which is the moment you actually want
   * it. Recording the sloppy version deliberately moves the boundary out to where the hand really
   * goes. The label is kept, rather than the samples being thrown in anonymously, so the catalogue
   * can show which variants exist and the health check can say WHICH kind of example broke a
   * gesture when one does.
   */
  variant?: SampleVariant;
}

/**
 * The kinds of alternative take the wizard offers, after the clean one.
 *
 * Deliberately a closed list rather than free text: each has its own prompt and its own reason to
 * exist, and a variant nobody can describe is a variant nobody will record consistently.
 */
export type SampleVariant = 'clean' | 'rough' | 'angled' | 'left-hand' | 'far';

export interface VariantSpec {
  key: SampleVariant;
  /** Shown on the button. */
  name: string;
  /** Shown while it is being recorded: what to actually do differently. */
  blurb: string;
}

export const VARIANTS: readonly VariantSpec[] = [
  { key: 'clean', name: 'THE CLEAN ONE', blurb: 'Perform it properly, the way you mean it.' },
  {
    key: 'rough',
    name: 'A SLOPPY ONE',
    blurb: 'Now do it badly — half-hearted, rushed, not quite finishing the shape. This is how it will look when you are busy.'
  },
  {
    key: 'angled',
    name: 'FROM AN ANGLE',
    blurb: 'Same gesture, but turn your hand twenty or thirty degrees away from the camera and tilt it.'
  },
  {
    key: 'left-hand',
    name: 'THE LEFT HAND',
    /*
     * Named, not "the other hand". The main hand is the right one by default, so "other" is only
     * meaningful if you already know which one is main — and the person being prompted is the one
     * person who should not have to work that out.
     */
    blurb: 'The same gesture with your left hand, so either hand works.'
  },
  { key: 'far', name: 'FURTHER BACK', blurb: 'Sit back, or hold your hand out further, and do it again at that distance.' }
];

export const isVariant = (value: unknown): value is SampleVariant =>
  typeof value === 'string' && VARIANTS.some((spec) => spec.key === value);

/** `other-hand` was renamed `left-hand` on 2026-09-12; recordings made under the old name stand. */
export const readVariant = (value: unknown): SampleVariant | null =>
  value === 'other-hand' ? 'left-hand' : isVariant(value) ? value : null;

/** How many keyframes a gesture is built from. Chosen when it is created. */
export type FrameCount = 1 | 2 | 3;

/**
 * One hand or two.
 *
 * William, 2026-09-12: "Each training should have a toggle option that designates the gesture as
 * two-hand or one-hand, and the main hand should default to right hands so notate alternate hand
 * as left hand."
 *
 * It has to be declared rather than inferred. Inferring it from what is in shot means a gesture is
 * two-handed whenever a second hand happens to be resting on the desk, which is precisely the
 * confusion the hand roles were built to end.
 */
export type HandCount = 1 | 2;

/**
 * What the two hands are doing, which is a different question from how many there are.
 *
 * William, 2026-09-12: "the ability for the program to distinguish between a gesture being done on
 * one hand, a two hand gesture, or one gesture being done on both hands."
 *
 * Three cases, and they are genuinely three:
 *
 *  - `one`   one hand does it. The right hand unless the take says otherwise.
 *  - `two`   two hands do DIFFERENT things, and the gesture is the relationship between them: a
 *            zoom is not two hands each doing "zoom", it is two hands moving apart.
 *  - `both`  the SAME thing on each hand at once. Both fists is the fist gesture, mirrored — which
 *            is why it must not be recognised from one fist, and why one fist must not be
 *            recognised as half of it.
 *
 * Collapsing `both` into `two` was the old model, and it could not express the difference between
 * "make a fist with each hand" and "hold one hand still while the other moves".
 */
export type HandMode = 'one' | 'two' | 'both';

/** `hands: 2` was the shape for a few hours on 2026-09-12; it means `two`. */
export const modeOf = (gesture: Pick<GestureDefinition, 'mode' | 'hands'>): HandMode =>
  gesture.mode ?? (gesture.hands === 2 ? 'two' : 'one');

/** Absent means one hand: the common case, and what every gesture recorded before today was. */
export const handsOf = (gesture: Pick<GestureDefinition, 'mode' | 'hands'>): HandCount =>
  modeOf(gesture) === 'one' ? 1 : 2;

/** How the mode reads on a button and in a prompt. */
export const MODE_NAMES: Record<HandMode, { short: string; blurb: string }> = {
  one: { short: 'ONE HAND', blurb: 'Your right hand, unless the take says otherwise.' },
  two: { short: 'TWO HANDS', blurb: 'Both hands, doing different things — the gesture is how they relate.' },
  both: { short: 'BOTH, SAME', blurb: 'The same shape on each hand at once.' }
};

/**
 * What sort of thing a gesture is, which decides how the tracker uses it.
 *
 *  - `posture`  held still, and true for as long as it is held: the cursor hand, the resting hand.
 *  - `sequence` performed and finished: a pinch and release, a twist. Fires once.
 *  - `motion`   a posture plus travel, continuous while it lasts: drag, scroll.
 */
export type GestureKind = 'posture' | 'sequence' | 'motion';

/**
 * The behaviours the tracker implements itself, which a built-in gesture is bound to.
 *
 * A built-in binds to one of these rather than to words, because these are continuous, stateful
 * things — a drag is not a command, it is a hundred a second — and the intent bus takes commands.
 * A gesture William adds himself still binds to words, which is the general case.
 */
export type GestureAction =
  | 'cursor'
  | 'rest'
  | 'left-click'
  | 'double-click'
  | 'drag'
  | 'right-click'
  | 'scroll'
  | 'zoom-in'
  | 'zoom-out'
  /**
   * Recognised in order to be IGNORED. William, 2026-09-12: "moving hands around any pose in a
   * single handed fist, a hand holding a mouse or a hand holding a phone should not be detected for
   * inputs. hands on a keyboard should not be detected. A part of this is also training that the
   * gesture control should ignore."
   *
   * These are trained exactly like any other gesture, and they are arguably the most important ones
   * in the catalogue: a rig that cannot tell working from gesturing is worse than no rig, because
   * it acts while you are doing something else. Recognising a pose in order to do nothing is a
   * feature, not a contradiction.
   */
  | 'ignore'
  /**
   * One hand closing like the cover of a book: switch manual control OFF.
   *
   * William asked for it by that description, and it is a good one — it is a gesture nobody makes
   * by accident, and the way out of gesture control should never require reaching for the mouse.
   */
  | 'stop-control'
  /**
   * Both hands closed into separate fists: stop. Two meanings, decided by what is happening:
   *   - mid-zoom it ends the zoom and LOCKS it, so zooming must be started again from its opening
   *     pose rather than resuming wherever the hands drift to;
   *   - always, it suspends every gesture input for a few seconds.
   * One gesture, because that is what the hand does — the context supplies the rest.
   */
  | 'halt';

export interface GestureDefinition {
  id: string;
  /** What it is called in the catalogue. Uppercase by convention, like everything on the board. */
  name: string;
  /**
   * The words this gesture stands for, resolved by intent.ts. Empty means "recognise it and report
   * it, but do nothing" — which is how a gesture is trained and tested before it is given a job.
   */
  utterance: string;
  samples: GestureSample[];
  /** How many keyframes this gesture is made of. Fixed when it is created. */
  frames: FrameCount;
  /** Superseded by `mode` on 2026-09-12. Still read, so a file written that day still loads. */
  hands?: HandCount;
  /** One hand, two hands doing different things, or the same thing on both. Read via `modeOf`. */
  mode?: HandMode;
  /**
   * The gesture goes from somewhere to somewhere, and where is part of what it means.
   *
   * William, 2026-09-12: "some gestures like a click and drag / scroll is simply a gesture from two
   * different points on screen … drag or scroll effects should have it built into the training
   * architecture to prompt the user which points in-frame to use as their start and finish points."
   *
   * A travel gesture is trained differently — the prompts ask for a START position and a FINISH
   * position rather than two hand shapes — and it records where the hand actually was, so the
   * tracker can learn how far a real drag travels rather than being told by a constant.
   */
  travel?: boolean;
  kind: GestureKind;
  /**
   * A built-in behaviour this gesture drives, instead of words. Absent for gestures William adds,
   * which say something through the grammar instead.
   */
  action?: GestureAction;
  /**
   * Shipped with SkynetOS rather than added by hand. Its name, kind and action are fixed; its
   * examples, threshold, dwell and enabled state are William's to change, and it can be switched
   * off but not deleted — deleting it would only bring it back on the next launch.
   */
  builtIn?: boolean;
  /** What the wizard says while this is being trained, per keyframe. */
  prompts?: string[];
  /** Per-gesture override of DEFAULT_THRESHOLD: a deliberately loose or strict gesture. */
  threshold?: number;
  /** Hold this long before it fires, in ms. Absent uses the tracker's dwell. */
  dwellMs?: number;
  createdAt: string;
  /** Switched off without being deleted, so a gesture that misfires can be parked. */
  disabled?: boolean;
}

export interface GestureLibrary {
  /**
   * 1 — one feature vector per sample, no kind, no frames.
   * 2 — samples are keyframe sequences; definitions carry kind, frames and an optional action.
   * A version 1 file is migrated on read rather than discarded: those were real recordings.
   */
  version: 2;
  gestures: GestureDefinition[];
}

export const LIBRARY_VERSION = 2 as const;

export const EMPTY_LIBRARY: GestureLibrary = { version: LIBRARY_VERSION, gestures: [] };

/**
 * A hand as a comparable vector: wrist at the origin, one hand span as the unit.
 *
 * Returns null for a partial hand rather than padding it, because a padded hand is a plausible
 * vector for a pose that was never made.
 */
export function featuresOf(hand: Hand): number[] | null {
  if (hand.length < 21) return null;
  const wrist = hand[0];
  if (!wrist) return null;
  const span = handSpan(hand);
  if (!(span > 0)) return null;

  /*
   * Refuse a foreshortened hand rather than normalise it into nonsense. When the palm is edge-on,
   * the wrist and the middle knuckle are nearly the same point, so the span — the unit everything
   * else is divided by — collapses, and the result is a vector of enormous numbers that describes
   * no hand at all.
   */
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of hand) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const diagonal = Math.hypot(maxX - minX, maxY - minY);
  if (diagonal > 0 && span / diagonal < MIN_SPAN_RATIO) return null;

  const out: number[] = [];
  for (const point of hand) {
    out.push((point.x - wrist.x) / span, (point.y - wrist.y) / span);
  }
  // Belt and braces: even past the ratio test, a vector this large is not a hand.
  return out.every((value) => Math.abs(value) <= MAX_FEATURE) ? out : null;
}

/** Is this vector a plausible hand? Used when reading a file, which may predate the guard above. */
export function featuresPlausible(features: readonly number[]): boolean {
  return (
    features.length === FEATURE_LENGTH &&
    features.every((value) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_FEATURE)
  );
}

/**
 * Distance between two hands, in hand spans: the ROOT MEAN SQUARE of the per-landmark distances.
 *
 * It was the plain mean first, and that was wrong in a way worth recording. Curling three fingers
 * moves nine landmarks a long way and leaves twelve where they were, and a mean divides that
 * change by twenty-one: a pointing hand and a two-fingered one measured 0.086 apart by mean, while
 * one gesture varied against itself measured 0.057. Every gesture would have matched every other.
 *
 * RMS weights the landmarks that actually moved — the same pair measures 0.274 — while still
 * absorbing one badly-tracked finger, which `max` (1.100 for the same pair) would not: real
 * landmark noise is about 0.06 spans and occasionally much worse on a single fingertip.
 */
export function featureDistance(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (let i = 0; i < a.length; i += 2) {
    const distance = Math.hypot((a[i] ?? 0) - (b[i] ?? 0), (a[i + 1] ?? 0) - (b[i + 1] ?? 0));
    total += distance * distance;
  }
  return Math.sqrt(total / (a.length / 2));
}

/**
 * How close a hand is to one KEYFRAME of a gesture, across every recorded example of it.
 *
 * Keyframe 0 is what starts a gesture; the last is what completes it. The tracker walks the
 * keyframes in order with a time window between them, which is what makes a movement a movement
 * rather than two unrelated poses that happened in sequence.
 */
export function distanceToKeyframe(features: readonly number[], gesture: GestureDefinition, index: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const sample of gesture.samples) {
    const frame = sample.keyframes[index];
    if (!frame) continue;
    const distance = featureDistance(features, frame);
    if (distance < best) best = distance;
  }
  return best;
}

/** The closest stored example of a gesture's FIRST keyframe — what decides whether one is starting. */
export function distanceToGesture(features: readonly number[], gesture: GestureDefinition): number {
  return distanceToKeyframe(features, gesture, 0);
}

export interface GestureMatch {
  gestureId: string;
  name: string;
  utterance: string;
  /** Hand spans from the nearest stored example. */
  distance: number;
  /** 1 at an exact match, 0 at the threshold. For the indicator, not for the decision. */
  confidence: number;
  /** The next best gesture, when there was one. Shown while training, to explain a refusal. */
  runnerUp?: { name: string; distance: number };
}

export interface ClassifyOptions {
  margin?: number;
  /** Ignore this gesture — used while training it, so it cannot match itself. */
  exclude?: string;
}

/**
 * Which trained gesture this is, or null.
 *
 * Null is a first-class answer and the common one: a hand moving between poses is not a gesture,
 * and firing something on the way past is how gesture control gets a reputation.
 */
export function classifyGesture(
  features: readonly number[],
  library: GestureLibrary,
  options: ClassifyOptions = {}
): GestureMatch | null {
  const margin = options.margin ?? DEFAULT_MARGIN;
  const usable = library.gestures.filter(
    (gesture) =>
      !gesture.disabled &&
      gesture.id !== options.exclude &&
      gesture.samples.length >= MIN_SAMPLES
  );
  if (!usable.length) return null;

  const scored = usable
    .map((gesture) => ({ gesture, distance: distanceToGesture(features, gesture) }))
    .sort((a, b) => a.distance - b.distance);

  const best = scored[0];
  if (!best || !Number.isFinite(best.distance)) return null;
  const threshold = best.gesture.threshold ?? DEFAULT_THRESHOLD;
  if (best.distance > threshold) return null;

  const second = scored[1];
  // Ambiguous: two trained gestures fit almost equally well, so say nothing rather than guess.
  if (second && Number.isFinite(second.distance) && best.distance * margin > second.distance) {
    return null;
  }

  return {
    gestureId: best.gesture.id,
    name: best.gesture.name,
    utterance: best.gesture.utterance,
    distance: best.distance,
    confidence: Math.max(0, Math.min(1, 1 - best.distance / threshold)),
    ...(second && Number.isFinite(second.distance)
      ? { runnerUp: { name: second.gesture.name, distance: second.distance } }
      : {})
  };
}

/**
 * The gestures SkynetOS ships with: exactly the vocabulary William specified on 2026-09-12.
 *
 * They are in the catalogue from first run rather than described in a document, so they can be
 * seen, trained, tuned and switched off like anything else. What is fixed about them is their name,
 * their kind, their keyframe count and the behaviour they drive; their EXAMPLES are William's, and
 * an untrained built-in simply does not fire — `MIN_SAMPLES` applies to these as to any other.
 *
 * They bind to behaviours rather than to words because they are continuous and stateful: a drag is
 * not one command, it is a hundred a second, and the intent bus takes commands. A gesture added by
 * hand still binds to words, which remains the general case.
 */
export const BUILT_IN_GESTURES: readonly Omit<GestureDefinition, 'samples' | 'createdAt'>[] = [
  {
    id: 'g_cursor',
    name: 'CURSOR',
    utterance: '',
    kind: 'posture',
    frames: 1,
    action: 'cursor',
    builtIn: true,
    mode: 'one',
    /*
     * An open hand, and deliberately a loose one.
     *
     * William, 2026-09-12: "I'm going to make some of the poses less finite - cursor control will
     * now be a single, opened hand … open hand with closed or spread fingers will be cursor move."
     *
     * This is the right call and it is worth saying why. The old cursor pose was a pinch held
     * open, which is a precise shape — and a precise shape has to be held precisely, so the pose
     * competed with the click it sits next to and lost tracking whenever his attention moved. An
     * open hand is the most detectable thing a hand can do and it is unmistakable against a fist,
     * which is what the click now is. Fewer, coarser, more separable poses beat more, finer ones.
     */
    prompts: ['Hold one hand open, palm towards the camera. Fingers together or spread — whichever is comfortable.']
  },
  {
    id: 'g_rest',
    name: 'REST',
    utterance: '',
    kind: 'posture',
    frames: 1,
    action: 'rest',
    builtIn: true,
    // The most important one, and the least obvious: without it, typing looks like gesturing.
    prompts: ['Put your hands on the keyboard and mouse exactly as you do when you are working.']
  },
  {
    id: 'g_left_click',
    name: 'LEFT CLICK',
    utterance: '',
    kind: 'sequence',
    frames: 2,
    action: 'left-click',
    builtIn: true,
    mode: 'one',
    /*
     * The click is the CLOSING, not the fist. A fist held is a drag, so if the fist itself were the
     * click, every drag would begin by clicking whatever was underneath it.
     */
    prompts: [
      'Hold your hand open, palm towards the camera.',
      'Close it into a fist, knuckles towards the camera, all four fingers curled in.'
    ]
  },
  {
    id: 'g_double_click',
    name: 'DOUBLE CLICK',
    utterance: '',
    kind: 'sequence',
    frames: 2,
    action: 'double-click',
    builtIn: true,
    mode: 'one',
    // Same shape as a left click; what separates them is the window, which is `dwellMs` here.
    dwellMs: 400,
    prompts: ['Close into a fist and open again, twice, quickly.', 'Open your hand.']
  },
  {
    id: 'g_drag',
    name: 'CLICK DRAG',
    mode: 'one',
    travel: true,
    utterance: '',
    kind: 'motion',
    frames: 2,
    action: 'drag',
    builtIn: true,
    /*
     * Two points, not two shapes. William, 2026-09-12: "a click and drag / scroll is simply a
     * gesture from two different points on screen … prompt the user which points in-frame to use as
     * their start and finish points." The hand holds the same fist throughout; what is being
     * recorded is WHERE it started and WHERE it finished, and the distance between those is how the
     * tracker learns what counts as a real drag rather than a tremor.
     */
    prompts: [
      'Make a fist and put it where a drag should START — the far left of your working area.',
      'Keep the fist closed and move it to where the drag should FINISH — the far right.'
    ]
  },
  {
    id: 'g_right_click',
    name: 'RIGHT CLICK',
    utterance: '',
    kind: 'sequence',
    frames: 2,
    action: 'right-click',
    mode: 'one',
    builtIn: true,
    prompts: [
      'Hold your hand open, palm towards the camera.',
      'Close it into a peace sign — index and middle finger up, the rest curled in.'
    ]
  },
  {
    id: 'g_zoom_in',
    name: 'ZOOM IN',
    mode: 'two',
    utterance: '',
    kind: 'sequence',
    frames: 2,
    action: 'zoom-in',
    builtIn: true,
    prompts: ['Both hands together, cupped.', 'Draw them apart.']
  },
  {
    id: 'g_zoom_out',
    name: 'ZOOM OUT',
    mode: 'two',
    utterance: '',
    kind: 'sequence',
    frames: 2,
    action: 'zoom-out',
    builtIn: true,
    prompts: ['Both hands apart, open.', 'Bring them together, cupped.']
  },
  {
    id: 'g_scroll',
    name: 'SCROLL',
    mode: 'one',
    travel: true,
    utterance: '',
    kind: 'motion',
    frames: 2,
    action: 'scroll',
    builtIn: true,
    prompts: [
      'Take hold of the page — fist closed — at the TOP of where you would scroll.',
      'Keeping hold, move down to the BOTTOM of that stroke.'
    ]
  },
  {
    id: 'g_book_close',
    name: 'CLOSE THE BOOK',
    mode: 'one',
    utterance: '',
    kind: 'sequence',
    frames: 2,
    action: 'stop-control',
    builtIn: true,
    prompts: ['Hold one hand open and flat, palm to the side, like an open book.', 'Close it, as though shutting the cover.']
  },
  {
    id: 'g_halt',
    name: 'BOTH FISTS',
    /*
     * `both`, not `two`: it is the same fist on each hand, which is exactly the distinction that
     * keeps it from being confused with one fist — the click — and keeps one fist from being read
     * as half of it.
     */
    mode: 'both',
    utterance: '',
    kind: 'posture',
    frames: 1,
    action: 'halt',
    builtIn: true,
    prompts: ['Close both hands into separate fists, held apart.']
  },
  {
    id: 'g_ignore_mouse',
    name: 'HOLDING A MOUSE',
    mode: 'one',
    utterance: '',
    kind: 'posture',
    frames: 1,
    action: 'ignore',
    builtIn: true,
    prompts: ['Hold your mouse and move it as you normally would — this is trained to be ignored.']
  },
  {
    id: 'g_ignore_phone',
    name: 'HOLDING A PHONE',
    utterance: '',
    kind: 'posture',
    frames: 1,
    action: 'ignore',
    builtIn: true,
    prompts: ['Hold your phone as you normally would — this is trained to be ignored.']
  },
  {
    id: 'g_ignore_keyboard',
    name: 'ON THE KEYBOARD',
    utterance: '',
    kind: 'posture',
    frames: 1,
    action: 'ignore',
    builtIn: true,
    prompts: ['Put your hands on the keyboard and type — this is trained to be ignored.']
  }
];

/** Does recognising this gesture mean doing nothing? The suppression classes. */
export function isSuppression(gesture: Pick<GestureDefinition, 'action'>): boolean {
  return gesture.action === 'ignore' || gesture.action === 'rest';
}

/**
 * Put every built-in into a library that is missing one, keeping whatever William has already
 * trained or tuned.
 *
 * Run on every read, so a built-in added in a later version appears without anyone migrating
 * anything, and one deleted by hand comes back — deleting it could only ever be temporary, so the
 * catalogue offers OFF instead, which is honest about what it does.
 */
/**
 * Built-ins that used to ship and no longer do. Dropped on read, with their examples.
 *
 * `g_ignore_fist` — "ONE FIST", trained so that a fist moved around casually would be IGNORED.
 * On 2026-09-12 a fist became the click, so that gesture now says "never notice the click". It is
 * not a conflict the audit could resolve, because both classes would be behaving exactly as
 * trained. Retiring it takes its examples with it, which is right: they were examples of a rule
 * that no longer exists.
 *
 * A retired built-in has to be removed rather than merely dropped from the table, because
 * `sanitiseLibrary` keeps whatever is in the file — so without this it would linger for ever as a
 * gesture nobody can delete.
 */
export const RETIRED_BUILT_INS: readonly string[] = ['g_ignore_fist'];

export function withBuiltIns(library: GestureLibrary): GestureLibrary {
  const byId = new Map(library.gestures.map((gesture) => [gesture.id, gesture]));
  const gestures: GestureDefinition[] = [];
  for (const seed of BUILT_IN_GESTURES) {
    const existing = byId.get(seed.id);
    byId.delete(seed.id);
    gestures.push({
      ...seed,
      // Fixed by the seed: name, kind, frames, action, prompts. William's: samples and the tuning.
      samples: existing?.samples ?? [],
      createdAt: existing?.createdAt ?? new Date(0).toISOString(),
      ...(existing?.threshold !== undefined ? { threshold: existing.threshold } : {}),
      ...(existing?.dwellMs !== undefined ? { dwellMs: existing.dwellMs } : seed.dwellMs !== undefined ? { dwellMs: seed.dwellMs } : {}),
      ...(existing?.disabled ? { disabled: true } : {})
    });
  }
  // Everything he added himself, in the order he added it.
  for (const gesture of library.gestures) if (byId.has(gesture.id)) gestures.push(gesture);
  return { version: LIBRARY_VERSION, gestures };
}

/**
 * Is this a usable example? Called as each sample is taken, so the trainer can say why not.
 *
 * Two failures are worth catching while the hand is still up, because both are invisible later:
 * a sample that is nearly identical to one already taken (which teaches nothing), and one that sits
 * on top of a DIFFERENT gesture (which will make both unreliable and neither obviously wrong).
 */
export interface SampleVerdict {
  ok: boolean;
  reason?: string;
  /** The gesture it collides with, if any. */
  clash?: { name: string; distance: number };
}

export function judgeSample(
  features: readonly number[],
  gesture: Pick<GestureDefinition, 'id' | 'samples'>,
  library: GestureLibrary,
  /** Which keyframe is being captured. Only the first is checked against other gestures. */
  keyframe = 0
): SampleVerdict {
  // Two different failures, and they need different advice: part of the hand is out of frame, or
  // the hand is turned so far edge-on that its own measurements collapsed.
  if (features.length !== FEATURE_LENGTH) {
    return { ok: false, reason: 'THAT WAS NOT A WHOLE HAND — keep all of it in frame' };
  }
  if (!featuresPlausible(features)) {
    return { ok: false, reason: 'TURN YOUR PALM TOWARDS THE CAMERA — that hand was too edge-on to read' };
  }
  /*
   * Only the FIRST keyframe is checked against other gestures. A middle or final keyframe may
   * legitimately look like somebody else's starting pose — an open hand ends a click and begins a
   * zoom — and it is the opening shape that has to be distinguishable for a sequence to be picked
   * up at all.
   */
  for (const other of keyframe === 0 ? library.gestures : []) {
    if (other.id === gesture.id || other.disabled || other.samples.length < MIN_SAMPLES) continue;
    const distance = distanceToGesture(features, other);
    if (distance < CLASH_DISTANCE) {
      return {
        ok: false,
        reason: `TOO CLOSE TO ${other.name} — they would be confused for each other`,
        clash: { name: other.name, distance }
      };
    }
  }
  // Near-duplicates are allowed but not counted as progress: variety is what makes four examples
  // better than one, so the trainer asks for a different angle instead of banking it.
  const nearest = gesture.samples.length
    ? distanceToKeyframe(features, gesture as GestureDefinition, keyframe)
    : Number.POSITIVE_INFINITY;
  if (nearest < DUPLICATE_DISTANCE) {
    return { ok: false, reason: 'ALMOST IDENTICAL TO THE LAST ONE — change the angle a little' };
  }
  return { ok: true };
}

/** Ready to use, or what it still needs. */
export function gestureReadiness(gesture: GestureDefinition): { ready: boolean; note: string } {
  if (gesture.samples.length < MIN_SAMPLES) {
    const missing = MIN_SAMPLES - gesture.samples.length;
    return { ready: false, note: `${missing} more example${missing === 1 ? '' : 's'} needed` };
  }
  if (!gesture.utterance.trim()) return { ready: true, note: 'recognised, but does nothing yet' };
  return { ready: true, note: gesture.utterance };
}

/*
 * ── Why a health check exists at all ─────────────────────────────────────────────────────────
 *
 * William, 2026-09-11: "After the last training most of the gestures don't seem to be working so
 * also ensure the gesture learning and calibration isn't accidentally breaking the entire feature."
 *
 * It could, and here is the hole it went through. `judgeSample` refuses an example that lands on
 * top of ANOTHER gesture — but only against gestures that already have MIN_SAMPLES, because a
 * class with two examples in it is not yet a class to be judged against. Train the catalogue in
 * order, therefore, and the first few gestures are recorded before anything is complete enough to
 * collide with, so the guard is not yet armed. By the time it is, the damage is on disk.
 *
 * Worse, the damage is silent and it is GLOBAL. Nearest-neighbour has no per-class isolation: one
 * example of ON THE KEYBOARD recorded with the fingers half-pointing sits nearer to CURSOR than
 * CURSOR's own examples do, so every attempt to move the pointer classifies as a suppression pose
 * and the whole rig goes dead. Nothing looks broken. One number moved.
 *
 * So the library is audited as a whole, after the fact, by the rule that actually matters:
 *
 *   A sample is bad if it sits closer to a DIFFERENT gesture than to its own siblings.
 *
 * That is not a heuristic about angles or lighting, it is the classifier's own decision rule
 * turned back on the training set — a sample that fails it will be misread every single time it
 * is the nearest neighbour, and will drag its whole class over the boundary with it.
 */

/** Below this, a sample and a different gesture are close enough to be worth warning about. */
export const HEALTH_WARN_RATIO = 1.35;

export interface SampleFault {
  sampleId: string;
  /** `drop` will be misread every time; `watch` is uncomfortably close but still on its own side. */
  severity: 'drop' | 'watch';
  reason: string;
  /** The gesture it is too close to. */
  rival: string;
  variant?: SampleVariant;
}

export interface GestureHealth {
  id: string;
  name: string;
  /** Enough examples, none of them poisonous. */
  usable: boolean;
  note: string;
  faults: SampleFault[];
  /** Which variants have been recorded, so the wizard can offer the missing ones. */
  variants: SampleVariant[];
  sampleCount: number;
}

export interface LibraryHealth {
  ok: boolean;
  note: string;
  gestures: GestureHealth[];
  /** Every sample the audit would remove, ready for a one-click repair. */
  drop: { gestureId: string; sampleId: string; reason: string }[];
}

/** Distance from one vector to a gesture's first keyframes, ignoring one sample by id. */
function distanceToClass(features: readonly number[], gesture: GestureDefinition, exceptId?: string): number {
  let best = Number.POSITIVE_INFINITY;
  for (const sample of gesture.samples) {
    if (sample.id === exceptId) continue;
    const frame = sample.keyframes[0];
    if (!frame) continue;
    const distance = featureDistance(features, frame);
    if (distance < best) best = distance;
  }
  return best;
}

/** Audit one gesture against the rest of the catalogue. */
export function gestureHealth(gesture: GestureDefinition, library: GestureLibrary): GestureHealth {
  const faults: SampleFault[] = [];
  const rivals = library.gestures.filter(
    (other) => other.id !== gesture.id && !other.disabled && other.samples.length > 0
  );

  for (const sample of gesture.samples) {
    const first = sample.keyframes[0];
    if (!first) continue;
    /*
     * "Its own siblings" excludes the sample itself, or every sample would measure zero from its
     * own class and nothing could ever fail.
     */
    const own = distanceToClass(first, gesture, sample.id);
    let nearest: { name: string; distance: number } | null = null;
    for (const other of rivals) {
      const distance = distanceToClass(first, other);
      if (!nearest || distance < nearest.distance) nearest = { name: other.name, distance };
    }
    if (!nearest || !Number.isFinite(nearest.distance)) continue;
    // A lone sample has no siblings to be nearer to; judge it on the clash distance instead.
    const hasSiblings = Number.isFinite(own);
    const mine = hasSiblings ? own : CLASH_DISTANCE;
    /*
     * "Nearer to something else" is necessary but NOT sufficient, and getting that wrong would
     * have been the same bug in a new coat. When one bad example lands on top of CURSOR, every
     * CURSOR example is also nearer to the intruder than to its own siblings — so a rule that
     * stopped at the first test would condemn the intruder AND the whole of CURSOR, and a repair
     * would delete the gesture that did nothing wrong.
     *
     * The second test is the one that separates them: does this sample belong with its own kind
     * at all? The intruder sits a quarter of a hand span from every real FIST, so it does not.
     * Each real CURSOR sample sits two hundredths from its siblings, so it does, foreign body or
     * no foreign body — and it is recorded as something to WATCH, not something to drop.
     */
    const stray = !hasSiblings || own > CLASH_DISTANCE;
    if (nearest.distance < mine && stray) {
      faults.push({
        sampleId: sample.id,
        severity: 'drop',
        reason: `nearer to ${nearest.name} than to its own examples`,
        rival: nearest.name,
        ...(sample.variant ? { variant: sample.variant } : {})
      });
    } else if (nearest.distance < mine * HEALTH_WARN_RATIO) {
      faults.push({
        sampleId: sample.id,
        severity: 'watch',
        reason: `uncomfortably close to ${nearest.name}`,
        rival: nearest.name,
        ...(sample.variant ? { variant: sample.variant } : {})
      });
    }
  }

  const variants = [...new Set(gesture.samples.map((sample) => sample.variant ?? 'clean'))];
  const bad = faults.filter((fault) => fault.severity === 'drop');
  const usable = gesture.samples.length >= MIN_SAMPLES && bad.length === 0;
  const note = bad.length
    ? `${bad.length} example${bad.length === 1 ? '' : 's'} would be misread as ${bad[0]!.rival}`
    : gesture.samples.length < MIN_SAMPLES
      ? `${MIN_SAMPLES - gesture.samples.length} more example${MIN_SAMPLES - gesture.samples.length === 1 ? '' : 's'} needed`
      : faults.length
        ? `close to ${faults[0]!.rival} — worth another angle`
        : 'good';

  return { id: gesture.id, name: gesture.name, usable, note, faults, variants, sampleCount: gesture.samples.length };
}

/** Audit the whole catalogue. Cheap enough to run after every training pass. */
export function libraryHealth(library: GestureLibrary): LibraryHealth {
  const gestures = library.gestures.filter((gesture) => !gesture.disabled).map((gesture) => gestureHealth(gesture, library));
  const drop = gestures.flatMap((health) =>
    health.faults
      .filter((fault) => fault.severity === 'drop')
      .map((fault) => ({ gestureId: health.id, sampleId: fault.sampleId, reason: fault.reason }))
  );
  const broken = gestures.filter((health) => health.faults.some((fault) => fault.severity === 'drop'));
  const note = drop.length
    ? `${drop.length} example${drop.length === 1 ? '' : 's'} across ${broken.length} gesture${broken.length === 1 ? '' : 's'} would be misread. Repair drops them; nothing else is touched.`
    : gestures.every((health) => health.usable)
      ? 'Every gesture is trained and distinct.'
      : 'Some gestures still need examples, but nothing in the catalogue is poisoned.';
  return { ok: drop.length === 0, note, gestures, drop };
}

/**
 * What the board sends to create or rename a gesture. Lives here rather than in the main-process
 * store because the IPC contract (packages/shared/ipc.ts) has to name it, and shared code cannot
 * import from src/main.
 */
export interface SaveGestureInput {
  /** Absent to create. */
  id?: string;
  name: string;
  utterance?: string;
  /**
   * How many keyframes the gesture is made of, chosen when it is created and fixed afterwards:
   * changing it would invalidate every example already recorded. Ignored when editing.
   */
  frames?: FrameCount;
  threshold?: number;
  dwellMs?: number;
  disabled?: boolean;
}

/** A name that will not be confused with another, trimmed and uppercased for the board's voice. */
export function normaliseGestureName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toUpperCase().slice(0, 32);
}

export function nameIsFree(name: string, library: GestureLibrary, exclude?: string): boolean {
  const wanted = normaliseGestureName(name);
  if (!wanted) return false;
  return !library.gestures.some((gesture) => gesture.id !== exclude && gesture.name === wanted);
}

/** Ids are made here, not by the caller, so a library file cannot end up with two of the same. */
export function freeGestureId(library: GestureLibrary, seed: string): string {
  const base = `g_${normaliseGestureName(seed).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`.slice(0, 40) || 'g_gesture';
  if (!library.gestures.some((gesture) => gesture.id === base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}_${n}`;
    if (!library.gestures.some((gesture) => gesture.id === candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
}

/**
 * A library read off disk, made safe.
 *
 * Everything is checked rather than trusted: the file is hand-editable, a sample with the wrong
 * feature length would poison every comparison it took part in, and a gesture whose samples are all
 * dropped must not silently become a gesture that matches nothing at zero distance.
 */
export function sanitiseLibrary(raw: unknown): GestureLibrary {
  // Deliberately loose: this is a file, possibly hand-edited, possibly written by an older build.
  const source = (raw ?? {}) as { version?: unknown; gestures?: unknown };
  const version = typeof source.version === 'number' ? source.version : 0;
  if (!Array.isArray(source.gestures) || (version !== 1 && version !== LIBRARY_VERSION)) {
    return withBuiltIns(EMPTY_LIBRARY);
  }

  const gestures: GestureDefinition[] = [];
  for (const entry of source.gestures) {
    const gesture = entry as Partial<GestureDefinition> & { samples?: unknown };
    if (typeof gesture.id !== 'string' || typeof gesture.name !== 'string') continue;
    // A built-in that no longer ships goes, and takes its examples with it. See RETIRED_BUILT_INS.
    if (RETIRED_BUILT_INS.includes(gesture.id)) continue;

    const frames: FrameCount = gesture.frames === 2 ? 2 : gesture.frames === 3 ? 3 : 1;
    const kind: GestureKind =
      gesture.kind === 'sequence' ? 'sequence' : gesture.kind === 'motion' ? 'motion' : 'posture';

    const rawSamples = Array.isArray(gesture.samples) ? gesture.samples : [];
    const samples: GestureSample[] = [];
    for (const value of rawSamples) {
      const sample = value as Partial<GestureSample> & { features?: unknown };
      if (!sample || typeof sample.id !== 'string') continue;
      /*
       * Version 1 stored one vector per sample under `features`. Those were real recordings of a
       * real hand, so they are migrated into single-keyframe sequences rather than thrown away.
       */
      const keyframes: number[][] = Array.isArray(sample.keyframes)
        ? (sample.keyframes as unknown[]).filter((frame): frame is number[] => Array.isArray(frame) && featuresPlausible(frame))
        : Array.isArray(sample.features) && featuresPlausible(sample.features as number[])
          ? [sample.features as number[]]
          : [];
      // A recording that lost a keyframe cannot complete the sequence, so it is not kept.
      if (keyframes.length !== frames) continue;
      /*
       * The second hand, kept only if it is complete. A two-handed recording missing half of one
       * keyframe describes a gesture that was never made, and half a zoom is not a small error —
       * the whole content of the gesture is what the two hands do relative to each other.
       */
      const offhand: number[][] = Array.isArray(sample.offhand)
        ? (sample.offhand as unknown[]).filter((frame): frame is number[] => Array.isArray(frame) && featuresPlausible(frame))
        : [];
      const variant = readVariant(sample.variant);
      const path = Array.isArray(sample.path)
        ? (sample.path as unknown[])
            .filter((point): point is { x: number; y: number } => {
              const at = point as { x?: unknown; y?: unknown };
              return typeof at.x === 'number' && typeof at.y === 'number' && Number.isFinite(at.x) && Number.isFinite(at.y);
            })
            .map((point) => ({ x: point.x, y: point.y }))
        : [];
      const pose = Array.isArray(sample.pose)
        ? (sample.pose as unknown[]).filter(
            (frame): frame is number[] =>
              Array.isArray(frame) && frame.length === 7 && frame.every((v) => typeof v === 'number' && Number.isFinite(v))
          )
        : [];
      samples.push({
        id: sample.id,
        keyframes,
        ...(offhand.length === frames ? { offhand } : {}),
        ...(path.length === frames ? { path } : {}),
        ...(pose.length === frames ? { pose } : {}),
        capturedAt: typeof sample.capturedAt === 'string' ? sample.capturedAt : new Date(0).toISOString(),
        ...(typeof sample.camera === 'string' ? { camera: sample.camera } : {}),
        ...(variant && variant !== 'clean' ? { variant } : {})
      });
    }

    gestures.push({
      id: gesture.id,
      name: normaliseGestureName(gesture.name),
      utterance: typeof gesture.utterance === 'string' ? gesture.utterance : '',
      samples,
      frames,
      mode: modeOf(gesture),
      ...(gesture.travel === true ? { travel: true } : {}),
      kind,
      ...(gesture.action ? { action: gesture.action } : {}),
      ...(gesture.builtIn === true ? { builtIn: true } : {}),
      ...(Array.isArray(gesture.prompts) ? { prompts: gesture.prompts.filter((p) => typeof p === 'string') } : {}),
      createdAt: typeof gesture.createdAt === 'string' ? gesture.createdAt : new Date(0).toISOString(),
      ...(typeof gesture.threshold === 'number' && gesture.threshold > 0 && gesture.threshold < 2
        ? { threshold: gesture.threshold }
        : {}),
      ...(typeof gesture.dwellMs === 'number' && gesture.dwellMs >= 0 ? { dwellMs: gesture.dwellMs } : {}),
      ...(gesture.disabled === true ? { disabled: true } : {})
    });
  }

  return withBuiltIns({ version: LIBRARY_VERSION, gestures });
}
