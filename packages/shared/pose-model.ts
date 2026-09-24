/**
 * Which pose a hand is in, as a probability — from anatomy first, sharpened by William's own data.
 *
 * William, 2026-09-12: "I think a combination of open data set resources and pre-built packages, the
 * 'training' feature you're developing, and recreating the gestures' fundamental ligature / geometry
 * 'animation' combined into the training data, all combined to create a powerful camera-based
 * gesture control system."
 *
 * That sentence names three sources of evidence, and this file is where they meet:
 *
 *  1. ANATOMY AND GEOMETRY. Each pose is a region of feature space that follows from how the hand is
 *     built, measured on the synthetic hand (hand-synth.ts) from every angle and under landmark noise.
 *     These work with no training at all, which is the "stable baseline" he asked for — the cursor and
 *     the click must not depend on how well a particular afternoon's recordings went.
 *
 *  2. A PRE-TRAINED MODEL. MediaPipe's GestureRecognizer ships a classifier trained by Google on a
 *     large corpus of labelled hands, with Open_Palm, Closed_Fist and Victory among its classes —
 *     three of William's five. Where it is running, its opinion is folded in.
 *
 *  3. HIS RECORDINGS. Every example taken in the trainer carries the same features, and they move
 *     each pose towards how HIS hand makes it — a Bayesian update of the geometric prior, so a handful
 *     of examples adjusts the model without being able to overwrite it.
 *
 * ── Features ─────────────────────────────────────────────────────────────────────────────────
 *
 * Six, all of them long-lever measurements chosen because they survive noise (hand-geometry.ts):
 * thumb reach, the curl of each long finger, and the gap between the index and middle fingertips.
 * The gap only counts in proportion to how straight those two fingers are.
 *
 * ── Densities ────────────────────────────────────────────────────────────────────────────────
 *
 * Each class is a MIXTURE of products of independent Student-t densities (ν = 4).
 *
 * Student-t rather than Gaussian because the landmarker occasionally puts one fingertip somewhere
 * wrong: under a Gaussian one bad finger makes the right pose astronomically unlikely, under a t it
 * costs some confidence and no more.
 *
 * A mixture because of what was measured on 2026-09-12. With a single broad density for "none of
 * these", an oracle fitted to held-out synthetic data scored the four control poses at 99.7% and still
 * called two out of three near-misses a control — every thumbs-up a click, every two-fingers-together a
 * right click. The features separated them perfectly well; the model could not, because "none of
 * these" is not one shape. A thumbs-up lives next to the fist, two fingers together live next to the
 * peace sign, a hand mid-motion lives between everything. So `other` is built from components placed
 * at exactly those near-misses, plus a broad background — the standard treatment of hard negatives.
 *
 * ── Asymmetric costs ─────────────────────────────────────────────────────────────────────────
 *
 * Not every mistake costs the same. A missed click is a failure William notices every time; a
 * thumbs-up read as a click is a gesture he does not use. So the fist is given a generous thumb, and
 * the thumbs-up component is narrow and lightly weighted. Every such choice is stated where it is made.
 */

import type { HandGeometry } from './hand-geometry.js';

export type PoseClass = 'open' | 'fist' | 'peace' | 'point' | 'other';

export const POSE_CLASSES: readonly PoseClass[] = ['open', 'fist', 'peace', 'point', 'other'];

/** thumb reach (palm lengths), index, middle, ring, pinky curl (0..1), index–middle tip gap (palm lengths). */
export type FeatureVector = [number, number, number, number, number, number];

export const FEATURE_NAMES = ['thumb reach', 'index', 'middle', 'ring', 'pinky', 'tip gap'] as const;

export interface PoseFeatures {
  values: FeatureVector;
  /** How much to trust the tip gap, 0 to 1. */
  spreadWeight: number;
}

export function poseFeatures(geometry: HandGeometry): PoseFeatures {
  const [, i, m, r, p] = geometry.curl;
  return { values: [geometry.thumbReach, i, m, r, p, geometry.tipGap], spreadWeight: geometry.spreadWeight };
}

export interface Component {
  mean: FeatureVector;
  scale: FeatureVector;
  /** Share of its class. A class's component weights sum to 1. */
  weight: number;
  /** What this component stands for, for diagnostics. */
  label: string;
}

export interface Density {
  /** Prior probability of the class before any hand is seen. */
  prior: number;
  components: Component[];
}

export interface PoseModel {
  classes: Record<PoseClass, Density>;
  /** Degrees of freedom of the Student-t. Lower is heavier-tailed. */
  nu: number;
}

const one = (label: string, mean: FeatureVector, scale: FeatureVector): Component[] => [{ label, mean, scale, weight: 1 }];

/**
 * The geometric baseline.
 *
 * Means are the fused-source measurements of the synthetic poses under landmark noise, from 45 views
 * spanning yaw ±70°, pitch ±40° and roll ±45° (the table is in docs/DECISIONS.md, 2026-09-12). Scales
 * are the measured spread widened by about half again, because a real hand varies more than a model
 * of one and a real landmarker errs in ways the renderer does not. `open` covers everything from a flat
 * hand to the relaxed curl people actually hold.
 */
export const ANATOMICAL_MODEL: PoseModel = {
  nu: 4,
  classes: {
    open: { prior: 0.3, components: one('open hand', [1.29, 0.14, 0.14, 0.15, 0.19, 0.43], [0.22, 0.13, 0.12, 0.13, 0.16, 0.17]) },
    // A fist with the thumb BESIDE the index measures the same thumb reach as one with it tucked (0.99 against
    // 1.00), so the fist needs no extra room for its thumb, and the thumbs-up at 1.40 stays out.
    fist: { prior: 0.25, components: one('fist', [0.98, 0.97, 0.98, 0.98, 0.96, 0.23], [0.16, 0.06, 0.06, 0.05, 0.08, 0.4]) },
    peace: { prior: 0.15, components: one('peace', [1.04, 0.09, 0.1, 0.98, 0.97, 0.65], [0.18, 0.09, 0.08, 0.06, 0.07, 0.15]) },
    point: { prior: 0.1, components: one('point', [1.05, 0.1, 0.98, 0.97, 0.96, 1.15], [0.18, 0.09, 0.06, 0.06, 0.07, 0.5]) },
    other: {
      prior: 0.2,
      components: [
        { label: 'anything', mean: [1.2, 0.5, 0.5, 0.5, 0.5, 0.4], scale: [0.4, 0.35, 0.35, 0.35, 0.35, 0.4], weight: 0.35 },
        // Two fingers up but TOGETHER: exactly the peace sign except for the gap.
        { label: 'two together', mean: [1.06, 0.11, 0.08, 0.97, 0.96, 0.34], scale: [0.16, 0.09, 0.08, 0.06, 0.07, 0.12], weight: 0.25 },
        // A hand passing between open and closed: every finger half-curled.
        { label: 'mid-motion', mean: [1.14, 0.52, 0.53, 0.55, 0.56, 0.29], scale: [0.17, 0.13, 0.13, 0.14, 0.14, 0.12], weight: 0.25 },
        // A thumbs-up: a fist with the thumb far out. Narrow and light — see "asymmetric costs".
        { label: 'thumbs up', mean: [1.42, 0.97, 0.98, 0.98, 0.96, 0.24], scale: [0.16, 0.06, 0.05, 0.05, 0.07, 0.4], weight: 0.15 }
      ]
    }
  }
};

/*
 * log Γ((ν+1)/2) − log Γ(ν/2) − ½ log(νπ), for ν = 4: Γ(2.5) = 1.329340388, Γ(2) = 1.
 * A constant rather than a computation, because JavaScript has no log-gamma and ν is fixed.
 */
const T4_LOG_NORMALISER = Math.log(1.329340388) - 0.5 * Math.log(4 * Math.PI);

function logStudentT(x: number, mean: number, scale: number, nu: number): number {
  const z = (x - mean) / scale;
  const normaliser = nu === 4 ? T4_LOG_NORMALISER : -0.5 * Math.log(nu * Math.PI);
  return normaliser - Math.log(scale) - ((nu + 1) / 2) * Math.log(1 + (z * z) / nu);
}

function logComponent(features: PoseFeatures, component: Component, nu: number): number {
  let total = Math.log(component.weight);
  for (let k = 0; k < 5; k++) total += logStudentT(features.values[k]!, component.mean[k]!, component.scale[k]!, nu);
  // The gap is weighted by how straight the two fingers are: a gap between curled fingers is noise.
  total += features.spreadWeight * logStudentT(features.values[5], component.mean[5], component.scale[5], nu);
  return total;
}

/** log(Σ exp), without overflowing. */
function logSumExp(values: number[]): number {
  const peak = Math.max(...values);
  if (!Number.isFinite(peak)) return peak;
  return peak + Math.log(values.reduce((sum, v) => sum + Math.exp(v - peak), 0));
}

/** Log-likelihood of the features under one class, prior included. */
export function logScore(features: PoseFeatures, density: Density, nu: number): number {
  return Math.log(density.prior) + logSumExp(density.components.map((c) => logComponent(features, c, nu)));
}

export type Posterior = Record<PoseClass, number>;

/** Softmax over log scores, numerically stable. */
export function normalise(logs: Record<PoseClass, number>): Posterior {
  const peak = Math.max(...POSE_CLASSES.map((c) => logs[c]));
  let sum = 0;
  const out = {} as Posterior;
  for (const c of POSE_CLASSES) {
    const value = Math.exp(logs[c] - peak);
    out[c] = value;
    sum += value;
  }
  for (const c of POSE_CLASSES) out[c] /= sum;
  return out;
}

export function classify(features: PoseFeatures, model: PoseModel = ANATOMICAL_MODEL): Posterior {
  const logs = {} as Record<PoseClass, number>;
  for (const c of POSE_CLASSES) logs[c] = logScore(features, model.classes[c], model.nu);
  return normalise(logs);
}

export const argmax = (posterior: Posterior): { pose: PoseClass; p: number } => {
  let best: PoseClass = 'other';
  for (const c of POSE_CLASSES) if (posterior[c] > posterior[best]) best = c;
  return { pose: best, p: posterior[best] };
};

// ── the pre-trained model's opinion ─────────────────────────────────────────────────────────

/** MediaPipe's canned gesture names, mapped onto these classes. */
const CANNED: Record<string, PoseClass> = {
  Open_Palm: 'open',
  Closed_Fist: 'fist',
  Victory: 'peace',
  Pointing_Up: 'point',
  None: 'other',
  Thumb_Up: 'other',
  Thumb_Down: 'other',
  ILoveYou: 'other'
};

/**
 * The GestureRecognizer's scores as a posterior over these classes, or null when it said nothing.
 *
 * A floor keeps any class from being ruled out entirely: this is one voter among several, and a voter
 * that can veto is not voting.
 */
export function cannedPosterior(categories: readonly { categoryName: string; score: number }[] | undefined): Posterior | null {
  if (!categories?.length) return null;
  const out: Posterior = { open: 0, fist: 0, peace: 0, point: 0, other: 0 };
  let seen = 0;
  for (const category of categories) {
    const mapped = CANNED[category.categoryName];
    if (!mapped || !Number.isFinite(category.score)) continue;
    out[mapped] += Math.max(0, category.score);
    seen += Math.max(0, category.score);
  }
  if (seen <= 0) return null;
  const floor = 0.03;
  let sum = 0;
  for (const c of POSE_CLASSES) {
    out[c] = out[c] / seen + floor;
    sum += out[c];
  }
  for (const c of POSE_CLASSES) out[c] /= sum;
  return out;
}

/**
 * Combine several posteriors: a weighted product of experts, renormalised.
 *
 * In log space a weighted sum, which is the right operation for independent evidence — two cameras
 * that each think it is probably a fist make it more certainly a fist, where averaging would leave it
 * as uncertain as either. The weights temper each voter: a camera looking at the hand edge-on, or a
 * model that is not running, counts for less or nothing.
 */
export function fuse(votes: readonly { posterior: Posterior; weight: number }[]): Posterior | null {
  const usable = votes.filter((vote) => vote.weight > 0);
  if (!usable.length) return null;
  const logs = { open: 0, fist: 0, peace: 0, point: 0, other: 0 } as Record<PoseClass, number>;
  for (const vote of usable) {
    for (const c of POSE_CLASSES) logs[c] += vote.weight * Math.log(Math.max(1e-9, vote.posterior[c]));
  }
  return normalise(logs);
}

// ── his recordings ──────────────────────────────────────────────────────────────────────────

/** How many examples the geometric prior is worth. Six recordings move a pose halfway to them. */
export const PRIOR_STRENGTH = 6;

/** Nothing is ever allowed to become more certain than this, however consistent the examples. */
const SCALE_FLOOR: FeatureVector = [0.06, 0.03, 0.03, 0.03, 0.03, 0.04];

/**
 * The geometric model, moved towards William's own examples of each pose.
 *
 * The conjugate update for a location-scale family with the prior treated as `PRIOR_STRENGTH`
 * pseudo-observations: the mean becomes a weighted average of the prior mean and the sample mean, and
 * the scale a weighted pooling of the prior variance and the samples' scatter about the new mean. With
 * no examples it is exactly the prior; with a few it leans towards them; it never becomes more certain
 * than SCALE_FLOOR, because six identical recordings describe one moment, not a pose.
 *
 * Only single-component classes are refined. Nobody records examples of "none of these", and letting a
 * handful of mislabelled takes reshape the rejection class is how a catalogue quietly learns to call
 * everything a click.
 */
export function refine(
  model: PoseModel,
  examples: readonly { pose: PoseClass; features: PoseFeatures }[],
  strength = PRIOR_STRENGTH
): PoseModel {
  const classes = { ...model.classes };
  for (const pose of POSE_CLASSES) {
    const density = model.classes[pose];
    if (density.components.length !== 1) continue;
    const mine = examples.filter((example) => example.pose === pose);
    if (!mine.length) continue;
    const prior = density.components[0]!;
    const n = mine.length;
    const mean = prior.mean.map((mu, k) => {
      const sum = mine.reduce((total, example) => total + example.features.values[k]!, 0);
      return (strength * mu + sum) / (strength + n);
    }) as FeatureVector;
    const scale = prior.scale.map((sigma, k) => {
      const scatter = mine.reduce((total, example) => total + (example.features.values[k]! - mean[k]!) ** 2, 0);
      const variance = (strength * sigma * sigma + scatter) / (strength + n);
      return Math.max(SCALE_FLOOR[k]!, Math.sqrt(variance));
    }) as FeatureVector;
    classes[pose] = { prior: density.prior, components: [{ ...prior, mean, scale }] };
  }
  return { ...model, classes };
}
