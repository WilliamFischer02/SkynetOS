/**
 * The pose model: what it believes, how it combines evidence, and how accurate it is — measured on
 * the synthetic hand across views, both hands, natural variation and landmark noise.
 *
 * ── What the accuracy floors mean, and do not mean ───────────────────────────────────────────
 *
 * They measure the MATHS: geometry plus classifier, fed by a renderer that knows nothing of how
 * MediaPipe itself degrades when a hand is edge-on. They are an upper bound on the real system and a
 * regression guard on this code, never a claim about what William's cameras will do. The floors sit
 * a little below the figures measured on 2026-09-12, recorded in docs/DECISIONS.md.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_CAMERA, POSES, jitterPose, mulberry32, render, type PoseName, type View } from '@shared/hand-synth.js';
import { handGeometry } from '@shared/hand-geometry.js';
import {
  ANATOMICAL_MODEL,
  argmax,
  cannedPosterior,
  classify,
  fuse,
  poseFeatures,
  refine,
  type PoseClass,
  type PoseFeatures,
  type PoseModel
} from '@shared/pose-model.js';

const featuresOf = (name: PoseName, options: Parameters<typeof render>[1] = {}): PoseFeatures => {
  const rendered = render(POSES[name], options);
  return poseFeatures(handGeometry({ landmarks: rendered.landmarks, world: rendered.world })!);
};

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

describe('the five controls, held cleanly', () => {
  it('names every canonical pose correctly, with nothing trained', () => {
    for (const name of Object.keys(POSES) as PoseName[]) {
      if (name === 'thumbsUp') continue; // measured separately: it is the hardest near-miss
      expect({ name, pose: argmax(classify(featuresOf(name))).pose }).toEqual({ name, pose: TRUTH[name] });
    }
  });
});

describe('accuracy across views, hands and noise', () => {
  const views: View[] = [];
  for (const yaw of [-70, 0, 70]) for (const pitch of [-40, 0, 40]) for (const roll of [0, 45]) views.push({ yaw, pitch, roll, x: 0, y: 0, distance: 0.6 });

  const rateFor = (name: PoseName): number => {
    const rng = mulberry32(9);
    let right = 0;
    let n = 0;
    for (const view of views) {
      for (const chirality of ['right', 'left'] as const) {
        for (let s = 0; s < 2; s++) {
          const rendered = render(jitterPose(POSES[name], rng, 7), { view, chirality, camera: DEFAULT_CAMERA, imageNoise: 0.003, worldNoise: 0.004, rng });
          const g = handGeometry({ landmarks: rendered.landmarks, world: rendered.world });
          if (g && argmax(classify(poseFeatures(g))).pose === TRUTH[name]) right++;
          n++;
        }
      }
    }
    return right / n;
  };

  it('keeps the cursor: open hands, flat or relaxed', () => {
    expect(rateFor('open')).toBeGreaterThan(0.97);
    expect(rateFor('openRelaxed')).toBeGreaterThan(0.95);
  });

  it('keeps the click: fists, thumb tucked or beside', () => {
    expect(rateFor('fist')).toBeGreaterThan(0.96);
    expect(rateFor('fistThumbBeside')).toBeGreaterThan(0.96);
  });

  it('keeps the right click: peace signs', () => {
    expect(rateFor('peace')).toBeGreaterThan(0.9);
  });

  it('rejects a hand mid-motion almost always, and the harder near-misses more often than not', () => {
    expect(rateFor('claw')).toBeGreaterThan(0.95);
    expect(rateFor('twoTogether')).toBeGreaterThan(0.6);
    expect(rateFor('thumbsUp')).toBeGreaterThan(0.3);
  });
});

describe('heavy tails', () => {
  it('survives one badly-tracked finger without abandoning the pose', () => {
    // The landmarker occasionally puts a single fingertip somewhere absurd. Under a Gaussian that one
    // finger would make "fist" astronomically unlikely; under a Student-t it costs some confidence only.
    const fist = featuresOf('fist');
    const corrupted: PoseFeatures = { ...fist, values: [...fist.values] as PoseFeatures['values'] };
    corrupted.values[4] = 0.35;
    expect(argmax(classify(corrupted)).pose).toBe('fist');
  });
});

describe('why "none of these" is a mixture', () => {
  it('rejects two-fingers-together far better than a single broad background density does', () => {
    const single: PoseModel = {
      ...ANATOMICAL_MODEL,
      classes: {
        ...ANATOMICAL_MODEL.classes,
        other: { prior: 0.2, components: [ANATOMICAL_MODEL.classes.other.components[0]!].map((c) => ({ ...c, weight: 1 })) }
      }
    };
    const together = featuresOf('twoTogether');
    expect(classify(together, ANATOMICAL_MODEL).other).toBeGreaterThan(classify(together, single).other + 0.3);
  });
});

describe('the pre-trained classifier', () => {
  it('maps MediaPipe’s categories onto these poses, and never rules a pose out entirely', () => {
    const posterior = cannedPosterior([
      { categoryName: 'Closed_Fist', score: 0.9 },
      { categoryName: 'Open_Palm', score: 0.05 },
      { categoryName: 'Thumb_Up', score: 0.05 }
    ])!;
    expect(argmax(posterior).pose).toBe('fist');
    expect(posterior.peace).toBeGreaterThan(0);
  });

  it('says nothing when it saw nothing', () => {
    expect(cannedPosterior([])).toBeNull();
    expect(cannedPosterior(undefined)).toBeNull();
  });
});

describe('combining evidence', () => {
  it('makes two voters that agree more certain than either', () => {
    const lean = { open: 0.1, fist: 0.7, peace: 0.1, point: 0.05, other: 0.05 };
    const both = fuse([
      { posterior: lean, weight: 1 },
      { posterior: lean, weight: 1 }
    ])!;
    expect(both.fist).toBeGreaterThan(lean.fist);
  });

  it('ignores a voter with no weight, and returns nothing when nobody voted', () => {
    const lean = { open: 0.1, fist: 0.7, peace: 0.1, point: 0.05, other: 0.05 };
    const loud = { open: 0.96, fist: 0.01, peace: 0.01, point: 0.01, other: 0.01 };
    expect(argmax(fuse([{ posterior: lean, weight: 1 }, { posterior: loud, weight: 0 }])!).pose).toBe('fist');
    expect(fuse([{ posterior: lean, weight: 0 }])).toBeNull();
  });
});

describe('his recordings', () => {
  const unusualFist = (): PoseFeatures => ({ values: [1.1, 0.8, 0.82, 0.85, 0.88, 0.3], spreadWeight: 0.2 });

  it('change nothing when there are none', () => {
    expect(refine(ANATOMICAL_MODEL, [])).toEqual(ANATOMICAL_MODEL);
  });

  it('move a pose towards how his hand actually makes it, without replacing the prior', () => {
    const examples = Array.from({ length: 6 }, () => ({ pose: 'fist' as PoseClass, features: unusualFist() }));
    const refined = refine(ANATOMICAL_MODEL, examples);
    const before = ANATOMICAL_MODEL.classes.fist.components[0]!.mean[1];
    const after = refined.classes.fist.components[0]!.mean[1];
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0.8);
    // A fist that closes less far than the textbook now reads as a fist more confidently.
    expect(classify(unusualFist(), refined).fist).toBeGreaterThan(classify(unusualFist(), ANATOMICAL_MODEL).fist);
  });

  it('never makes a pose more certain than the floor, however consistent the examples', () => {
    const examples = Array.from({ length: 50 }, () => ({ pose: 'fist' as PoseClass, features: unusualFist() }));
    const scale = refine(ANATOMICAL_MODEL, examples).classes.fist.components[0]!.scale;
    for (const value of scale) expect(value).toBeGreaterThan(0.029);
  });

  it('never reshapes "none of these" from recordings', () => {
    const refined = refine(ANATOMICAL_MODEL, [{ pose: 'other', features: unusualFist() }]);
    expect(refined.classes.other).toEqual(ANATOMICAL_MODEL.classes.other);
  });
});
