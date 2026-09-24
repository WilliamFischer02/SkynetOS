/**
 * What the training data says about the recogniser, and how to make the recogniser better with it.
 *
 * William, 2026-09-12: "I want to ensure you're working on this gesture program with great detail
 * and interconnected data analysis that actually uses data sets and the training data to genuinely
 * iterate and improve on its algorithm."
 *
 * The catalogue up to now could only grow. It could tell you how many examples a gesture had, and
 * (since the health audit) which examples were poisonous, but it could not answer the only question
 * that matters — WILL THIS WORK — and it could not use its own recordings to make itself better.
 * This file does both, and it does them by measurement rather than by assertion.
 *
 * ── Leave-one-out, which is the honest version of "how accurate is it?" ──────────────────────
 *
 * Take each recorded example out of the catalogue, classify it against everything that remains, and
 * see whether it comes back to its own gesture. That is exactly the decision the tracker makes at
 * run time, on data the classifier has not been given for that decision, so the number it produces
 * is the real one. Testing a nearest-neighbour classifier against its own training set without
 * removing the sample first would report 100% for ever, because every sample is at distance zero
 * from itself: a measurement that cannot fail measures nothing.
 *
 * ── Fitting the thresholds, which is where the data changes the algorithm ────────────────────
 *
 * Every gesture has a threshold: how close a pose must be to count. It shipped as one constant for
 * all of them, which cannot be right — an open hand varies far less between takes than a peace sign
 * does, and a class with tight examples deserves a tight threshold while a loose one needs room.
 *
 * So each gesture's threshold is fitted from two measured quantities: how far its own examples sit
 * from each other (the spread), and how close the nearest DIFFERENT gesture gets (the rival). The
 * threshold goes between them — at their geometric mean, because these are ratios rather than
 * positions, so the midpoint that matters is multiplicative. A class whose rival is closer than its
 * own spread cannot be separated by shape at all, and is reported as such rather than being given a
 * threshold that pretends otherwise.
 *
 * ── Travel, and why shape alone cannot separate a drag from a scroll ─────────────────────────
 *
 * Both are a closed fist. Their first keyframes are the same pose because they ARE the same pose;
 * what differs is where the hand goes — a drag runs across, a scroll runs down. Any analysis that
 * looked only at hand shape would report them as hopelessly confused and would be right to, while
 * being entirely useless. So travel gestures carry a measured axis, taken from the paths actually
 * recorded, and a confusion between two travel gestures on different axes is reported as resolved
 * by travel rather than as a fault. This is the interconnection: the shape data and the path data
 * only mean something together.
 */

import {
  DEFAULT_THRESHOLD,
  MIN_SAMPLES,
  distanceToKeyframe,
  featureDistance,
  type GestureDefinition,
  type GestureLibrary
} from './gesture-library.js';

/** Never fit a threshold outside this range, however the numbers come out. */
export const MIN_FITTED = 0.08;
export const MAX_FITTED = 0.5;

/**
 * How far a travel gesture must actually travel, as a fraction of the frame, before its measured
 * axis is believed. Below this the hand did not really go anywhere and the "direction" is noise.
 */
export const TRAVEL_FLOOR = 0.08;

export type TravelAxis = 'across' | 'down' | 'mixed' | 'still';

export interface TravelStats {
  /** How many samples carried a usable path. */
  samples: number;
  /** Mean signed displacement from the first keyframe to the last, in frame widths and heights. */
  dx: number;
  dy: number;
  /** Mean straight-line distance covered. */
  distance: number;
  axis: TravelAxis;
}

export interface GestureScore {
  id: string;
  name: string;
  total: number;
  correct: number;
  /** 0 to 1. A gesture with no examples scores 0 rather than dividing by nothing. */
  accuracy: number;
  /** What it is most often mistaken for, when it is mistaken for anything. */
  confusedWith?: { name: string; times: number; resolvedByTravel: boolean };
  /** The 90th percentile of the distances between its own examples. */
  spread: number;
  /** The closest any other gesture's examples come to this one's. */
  rival: number;
  /**
   * `rival / spread`. Above 1 the class stands on its own; below 1 the nearest other gesture is
   * inside this one's own scatter and no threshold can save it.
   */
  separation: number;
  /** The threshold this gesture's own data asks for. */
  suggested: number;
  /** Present only for a `travel` gesture. */
  travel?: TravelStats;
  note: string;
}

export interface Analysis {
  overall: { correct: number; total: number; accuracy: number };
  /** Every gesture with enough examples to be measured, worst first. */
  gestures: GestureScore[];
  /** Gestures that could not be measured, and why. */
  unmeasured: { name: string; reason: string }[];
  note: string;
}

/** Linear-interpolated quantile. Small samples are the normal case here, so no binning. */
function quantile(values: number[], q: number): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  const lowValue = sorted[low] ?? 0;
  if (low === high) return lowValue;
  return lowValue + ((sorted[high] ?? lowValue) - lowValue) * (at - low);
}

/** Where a sample's hand went, first keyframe to last. */
export function travelOf(gesture: GestureDefinition): TravelStats {
  const moves: { dx: number; dy: number }[] = [];
  for (const sample of gesture.samples) {
    const path = sample.path;
    if (!path || path.length < 2) continue;
    const from = path[0]!;
    const to = path[path.length - 1]!;
    moves.push({ dx: to.x - from.x, dy: to.y - from.y });
  }
  if (!moves.length) return { samples: 0, dx: 0, dy: 0, distance: 0, axis: 'still' };
  const dx = moves.reduce((sum, move) => sum + move.dx, 0) / moves.length;
  const dy = moves.reduce((sum, move) => sum + move.dy, 0) / moves.length;
  const distance = moves.reduce((sum, move) => sum + Math.hypot(move.dx, move.dy), 0) / moves.length;
  let axis: TravelAxis = 'still';
  if (distance >= TRAVEL_FLOOR) {
    const across = Math.abs(dx);
    const down = Math.abs(dy);
    // Two to one is the line between "mostly this way" and "diagonal": below it, calling an axis
    // would be asserting a direction the hand did not commit to.
    axis = across > down * 2 ? 'across' : down > across * 2 ? 'down' : 'mixed';
  }
  return { samples: moves.length, dx, dy, distance, axis };
}

/** Do these two gestures separate by where the hand goes, whatever their shapes do? */
export function separatedByTravel(a: GestureDefinition, b: GestureDefinition): boolean {
  if (!a.travel || !b.travel) return false;
  const one = travelOf(a);
  const other = travelOf(b);
  if (one.axis === 'still' || other.axis === 'still' || one.axis === 'mixed' || other.axis === 'mixed') return false;
  return one.axis !== other.axis;
}

/**
 * Score the catalogue against itself, leaving each example out in turn.
 *
 * Only the FIRST keyframe is scored, because that is the pose that decides whether a gesture is
 * starting at all; the later keyframes are only reached once the tracker has already committed.
 */
export function analyseLibrary(library: GestureLibrary): Analysis {
  const live = library.gestures.filter((gesture) => !gesture.disabled);
  const measurable = live.filter((gesture) => gesture.samples.length >= 2);
  const unmeasured: { name: string; reason: string }[] = live
    .filter((gesture) => gesture.samples.length < 2)
    .map((gesture) => ({
      name: gesture.name,
      reason: gesture.samples.length
        ? 'one example: nothing to check it against'
        : 'no examples yet'
    }));

  const scores: GestureScore[] = [];
  let correctAll = 0;
  let totalAll = 0;

  for (const gesture of measurable) {
    const ownDistances: number[] = [];
    const rivalDistances: number[] = [];
    const confusions = new Map<string, number>();
    let correct = 0;
    let total = 0;

    for (const sample of gesture.samples) {
      const first = sample.keyframes[0];
      if (!first) continue;
      total++;

      // Its own class, with itself taken out — the leave-one-out step.
      let own = Number.POSITIVE_INFINITY;
      for (const sibling of gesture.samples) {
        if (sibling.id === sample.id) continue;
        const frame = sibling.keyframes[0];
        if (!frame) continue;
        own = Math.min(own, featureDistance(first, frame));
      }

      let bestRival: { gesture: GestureDefinition; distance: number } | null = null;
      for (const other of live) {
        if (other.id === gesture.id || !other.samples.length) continue;
        const distance = distanceToKeyframe(first, other, 0);
        if (!Number.isFinite(distance)) continue;
        if (!bestRival || distance < bestRival.distance) bestRival = { gesture: other, distance };
      }

      if (Number.isFinite(own)) ownDistances.push(own);
      if (bestRival) rivalDistances.push(bestRival.distance);

      if (!bestRival || own <= bestRival.distance) {
        correct++;
      } else {
        confusions.set(bestRival.gesture.id, (confusions.get(bestRival.gesture.id) ?? 0) + 1);
      }
    }

    const spread = ownDistances.length ? quantile(ownDistances, 0.9) : Number.NaN;
    const rival = rivalDistances.length ? Math.min(...rivalDistances) : Number.POSITIVE_INFINITY;
    const separation = Number.isFinite(spread) && spread > 0 ? rival / spread : Number.POSITIVE_INFINITY;

    /*
     * The fitted threshold: the geometric mean of the spread and the rival, so it sits the same
     * factor above one as below the other. When the rival is closer than the spread there is no
     * gap to sit in, so the threshold hugs the class's own scatter and the note says plainly that
     * shape alone will not do it.
     */
    let suggested: number;
    if (!Number.isFinite(spread)) suggested = DEFAULT_THRESHOLD;
    else if (Number.isFinite(rival) && rival > spread) suggested = Math.sqrt(spread * rival);
    else suggested = spread * 0.9;
    suggested = Math.min(MAX_FITTED, Math.max(MIN_FITTED, Number(suggested.toFixed(3))));

    let confusedWith: GestureScore['confusedWith'];
    if (confusions.size) {
      const [id, times] = [...confusions.entries()].sort((a, b) => b[1] - a[1])[0]!;
      const other = live.find((entry) => entry.id === id);
      if (other) {
        confusedWith = { name: other.name, times, resolvedByTravel: separatedByTravel(gesture, other) };
      }
    }

    const travel = gesture.travel ? travelOf(gesture) : undefined;
    const accuracy = total ? correct / total : 0;
    const note = !total
      ? 'nothing to measure'
      : confusedWith && !confusedWith.resolvedByTravel
        ? `${total - correct} of ${total} would be read as ${confusedWith.name}`
        : confusedWith
          ? `looks like ${confusedWith.name}, but they travel on different axes — that is what tells them apart`
          : separation > 2
            ? 'clean'
            : 'correct, but close to its neighbours';

    correctAll += correct;
    totalAll += total;
    scores.push({
      id: gesture.id,
      name: gesture.name,
      total,
      correct,
      accuracy,
      ...(confusedWith ? { confusedWith } : {}),
      spread: Number.isFinite(spread) ? Number(spread.toFixed(3)) : 0,
      rival: Number.isFinite(rival) ? Number(rival.toFixed(3)) : 0,
      separation: Number.isFinite(separation) ? Number(separation.toFixed(2)) : 99,
      suggested,
      ...(travel ? { travel } : {}),
      note
    });
  }

  scores.sort((a, b) => a.accuracy - b.accuracy || a.separation - b.separation);
  const accuracy = totalAll ? correctAll / totalAll : 0;
  const broken = scores.filter((score) => score.accuracy < 1);
  const note = !totalAll
    ? 'Nothing is trained yet, so there is nothing to measure.'
    : broken.length
      ? `${Math.round(accuracy * 100)}% of your ${totalAll} examples classify correctly. ${broken.length} gesture${broken.length === 1 ? '' : 's'} would be misread — worst first below.`
      : `Every one of your ${totalAll} examples classifies correctly. Tightest margin: ${scores[0]?.name} at ${scores[0]?.separation}x.`;

  return { overall: { correct: correctAll, total: totalAll, accuracy }, gestures: scores, unmeasured, note };
}

export interface TuneResult {
  library: GestureLibrary;
  changed: { name: string; from: number; to: number }[];
  before: number;
  after: number;
  note: string;
}

/**
 * Write each gesture's fitted threshold into the catalogue.
 *
 * This is the step that makes the data do something. A gesture with tight, well-separated examples
 * gets a tighter threshold than the shipped constant and stops matching things it should not; a
 * gesture whose examples genuinely vary gets a looser one and stops failing to match itself.
 *
 * Only gestures with enough examples to have measured anything are touched — fitting a threshold
 * from two recordings would be fitting it to noise.
 */
export function tunedLibrary(library: GestureLibrary): TuneResult {
  const before = analyseLibrary(library);
  const byId = new Map(before.gestures.map((score) => [score.id, score]));
  const changed: { name: string; from: number; to: number }[] = [];

  const gestures = library.gestures.map((gesture) => {
    const score = byId.get(gesture.id);
    if (!score || gesture.samples.length < MIN_SAMPLES) return gesture;
    const from = gesture.threshold ?? DEFAULT_THRESHOLD;
    if (Math.abs(from - score.suggested) < 0.005) return gesture;
    changed.push({ name: gesture.name, from, to: score.suggested });
    return { ...gesture, threshold: score.suggested };
  });

  const next: GestureLibrary = { ...library, gestures };
  const after = analyseLibrary(next);
  return {
    library: next,
    changed,
    before: before.overall.accuracy,
    after: after.overall.accuracy,
    note: changed.length
      ? `Fitted ${changed.length} threshold${changed.length === 1 ? '' : 's'} to your own examples.`
      : 'Every threshold already matches what your examples ask for.'
  };
}
