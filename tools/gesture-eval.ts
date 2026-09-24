/*
 * tools/gesture-eval.ts — how accurate is the pose model, measured rather than asserted?
 *
 *   npm run gesture:eval
 *
 * Renders every pose in hand-synth.ts across 45 views (yaw ±70°, pitch ±40°, roll ±45°), both hands,
 * raw and mirrored cameras, with 7° of natural joint variation and landmark noise, and scores:
 *
 *   1. the shipped geometric model (ANATOMICAL_MODEL), per frame and on a three-frame mean — what the
 *      controller's smoothing sees;
 *   2. an ORACLE — the same model family fitted to one half of the data and scored on the other — which
 *      shows how separable the features are, independent of any hand-set number. A gap between the two
 *      is a prior to fix; a low oracle is a feature to fix.
 *
 * What it measures is the MATHS. The renderer does not model how MediaPipe itself degrades when a hand
 * is edge-on, so these figures are an upper bound on the real system and a guide to tuning it — never a
 * claim about what the cameras will do. William's own recordings are what close that gap.
 */

import { DEFAULT_CAMERA, POSES, jitterPose, mulberry32, render, type PoseName, type View } from '../packages/shared/hand-synth.js';
import { handGeometry } from '../packages/shared/hand-geometry.js';
import {
  ANATOMICAL_MODEL,
  POSE_CLASSES,
  argmax,
  classify,
  poseFeatures,
  type Component,
  type FeatureVector,
  type PoseClass,
  type PoseFeatures,
  type PoseModel
} from '../packages/shared/pose-model.js';

const NAMES = Object.keys(POSES) as PoseName[];
const TRUTH: Record<PoseName, PoseClass> = {
  open: 'open',
  openRelaxed: 'open',
  fist: 'fist',
  fistThumbBeside: 'fist',
  peace: 'peace',
  point: 'point',
  twoTogether: 'other',
  thumbsUp: 'other',
  claw: 'other'
};
const NEAR_MISSES: readonly PoseName[] = ['twoTogether', 'thumbsUp', 'claw'];

const VIEWS: View[] = [];
for (const yaw of [-70, -35, 0, 35, 70]) {
  for (const pitch of [-40, 0, 40]) {
    for (const roll of [-45, 0, 45]) VIEWS.push({ yaw, pitch, roll, x: 0, y: 0, distance: 0.6 });
  }
}

interface Row {
  name: PoseName;
  pose: PoseClass;
  yaw: number;
  frames: PoseFeatures[];
}

function dataset(seed: number, framesPerSample: number): Row[] {
  const rng = mulberry32(seed);
  const rows: Row[] = [];
  for (const name of NAMES) {
    for (const view of VIEWS) {
      for (const chirality of ['right', 'left'] as const) {
        for (const mirrored of [false, true]) {
          const pose = jitterPose(POSES[name], rng, 7);
          const frames: PoseFeatures[] = [];
          for (let f = 0; f < framesPerSample; f++) {
            const rendered = render(pose, { view, chirality, camera: { ...DEFAULT_CAMERA, mirrored }, imageNoise: 0.003, worldNoise: 0.004, rng });
            const geometry = handGeometry({ landmarks: rendered.landmarks, world: rendered.world });
            if (geometry) frames.push(poseFeatures(geometry));
          }
          rows.push({ name, pose: TRUTH[name], yaw: Math.abs(view.yaw), frames });
        }
      }
    }
  }
  return rows;
}

const mean = (frames: PoseFeatures[]): PoseFeatures => ({
  values: [0, 1, 2, 3, 4, 5].map((k) => frames.reduce((sum, f) => sum + f.values[k]!, 0) / frames.length) as FeatureVector,
  spreadWeight: frames.reduce((sum, f) => sum + f.spreadWeight, 0) / frames.length
});

const pct = (hits: number, total: number): string => `${((100 * hits) / Math.max(1, total)).toFixed(1)}%`;

function score(label: string, model: PoseModel, rows: Row[], smoothed: boolean): void {
  const confusion = new Map<string, number>();
  const byName = new Map<PoseName, { hits: number; total: number }>();
  const byYaw = new Map<number, { hits: number; total: number }>();
  let hits = 0;
  let total = 0;
  let nearMisses = 0;
  let falseControls = 0;

  for (const row of rows) {
    for (const features of smoothed ? [mean(row.frames)] : row.frames) {
      const predicted = argmax(classify(features, model)).pose;
      const hit = predicted === row.pose;
      hits += hit ? 1 : 0;
      total++;
      confusion.set(`${row.pose}>${predicted}`, (confusion.get(`${row.pose}>${predicted}`) ?? 0) + 1);
      const name = byName.get(row.name) ?? { hits: 0, total: 0 };
      name.hits += hit ? 1 : 0;
      name.total++;
      byName.set(row.name, name);
      const yaw = byYaw.get(row.yaw) ?? { hits: 0, total: 0 };
      yaw.hits += hit ? 1 : 0;
      yaw.total++;
      byYaw.set(row.yaw, yaw);
      if (NEAR_MISSES.includes(row.name)) {
        nearMisses++;
        if (predicted === 'open' || predicted === 'fist' || predicted === 'peace') falseControls++;
      }
    }
  }

  console.log(`\n${label}${smoothed ? ' · three-frame mean' : ' · per frame'}`);
  console.log(`  accuracy ${pct(hits, total)}   near-misses taken as a control ${pct(falseControls, nearMisses)}`);
  console.log(`  by pose   ${NAMES.map((name) => `${name} ${pct(byName.get(name)!.hits, byName.get(name)!.total)}`).join('  ')}`);
  console.log(`  by |yaw|  ${[...byYaw.entries()].sort((a, b) => a[0] - b[0]).map(([yaw, b]) => `${yaw}° ${pct(b.hits, b.total)}`).join('  ')}`);
  console.log(`  true\\pred ${POSE_CLASSES.map((c) => c.padStart(7)).join('')}`);
  for (const truth of POSE_CLASSES) {
    console.log(`  ${truth.padEnd(9)}${POSE_CLASSES.map((p) => String(confusion.get(`${truth}>${p}`) ?? 0).padStart(7)).join('')}`);
  }
}

function oracle(rows: Row[]): PoseModel {
  const fit = (frames: PoseFeatures[], label: string, weight: number): Component => {
    const centre = [0, 1, 2, 3, 4, 5].map((k) => frames.reduce((sum, f) => sum + f.values[k]!, 0) / frames.length) as FeatureVector;
    const spread = [0, 1, 2, 3, 4, 5].map((k) =>
      Math.max(0.01, Math.sqrt(frames.reduce((sum, f) => sum + (f.values[k]! - centre[k]!) ** 2, 0) / frames.length))
    ) as FeatureVector;
    return { label, mean: centre, scale: spread, weight };
  };
  const framesWhere = (keep: (row: Row) => boolean): PoseFeatures[] => rows.filter(keep).flatMap((row) => row.frames);
  const classes = {} as PoseModel['classes'];
  for (const pose of ['open', 'fist', 'peace', 'point'] as PoseClass[]) {
    classes[pose] = { prior: ANATOMICAL_MODEL.classes[pose].prior, components: [fit(framesWhere((row) => row.pose === pose), pose, 1)] };
  }
  classes.other = {
    prior: ANATOMICAL_MODEL.classes.other.prior,
    components: NEAR_MISSES.map((name) => fit(framesWhere((row) => row.name === name), name, 1 / NEAR_MISSES.length))
  };
  return { nu: ANATOMICAL_MODEL.nu, classes };
}

const test = dataset(2, 3);
score('shipped geometric model', ANATOMICAL_MODEL, test, false);
score('shipped geometric model', ANATOMICAL_MODEL, test, true);
score('oracle, fitted on held-out data', oracle(dataset(1, 1)), test, false);
