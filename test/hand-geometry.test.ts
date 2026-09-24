/**
 * Hand geometry: invariant to the view, and — the harder promise — not fooled by noise.
 *
 * The second promise has a history worth keeping. The first version measured curl as the sum of the
 * flexion angles at a finger's three joints. That was exactly view-invariant and it collapsed under
 * realistic landmark noise, because an unsigned angle cannot average out: noise on a straight finger
 * always reads as some bend, never as negative bend. The last test in this file measures that bias
 * directly, so nobody can quietly bring the old estimator back.
 */

import { describe, expect, it } from 'vitest';
import { FULL_FINGER_CURL_ANGLE, closure, handGeometry } from './helpers/geometry-baseline.js';
import { DEFAULT_CAMERA, POSES, blendPose, mulberry32, render, type HandPose, type View } from '@shared/hand-synth.js';

const measure = (pose: HandPose, options: Parameters<typeof render>[1] = {}) => {
  const rendered = render(pose, options);
  return handGeometry({ landmarks: rendered.landmarks, world: rendered.world })!;
};

const views: View[] = [];
for (const yaw of [-70, -35, 0, 35, 70]) for (const pitch of [-40, 0, 40]) for (const roll of [-45, 0, 45]) views.push({ yaw, pitch, roll, x: 0, y: 0, distance: 0.6 });

describe('curl', () => {
  it('reads an open hand as open and a fist as closed', () => {
    expect(closure(measure(POSES.open))).toBeLessThan(0.05);
    expect(closure(measure(POSES.fist))).toBeGreaterThan(0.95);
  });

  it('orders the shapes a hand passes through as it closes', () => {
    const open = closure(measure(POSES.open));
    const relaxed = closure(measure(POSES.openRelaxed));
    const claw = closure(measure(POSES.claw));
    const fist = closure(measure(POSES.fist));
    expect(open).toBeLessThan(relaxed);
    expect(relaxed).toBeLessThan(claw);
    expect(claw).toBeLessThan(fist);
  });

  it('is the same from every angle a camera on a desk could see the hand from', () => {
    // World landmarks are rotated rigidly, so curl from them is exactly invariant. Fused points take
    // x and y from the picture, which carries perspective; once that is undone they must agree too.
    const worldOnly = (pose: HandPose, view: View) => {
      const rendered = render(pose, { view });
      return handGeometry({ landmarks: rendered.landmarks.map((p) => ({ ...p, x: Number.NaN })), world: rendered.world })!.curl;
    };
    for (const pose of [POSES.open, POSES.fist, POSES.peace, POSES.claw]) {
      const reference = measure(pose).curl;
      const worldReference = worldOnly(pose, views[22]!);
      for (const view of views) {
        measure(pose, { view }).curl.forEach((value, k) => expect(Math.abs(value - reference[k]!)).toBeLessThan(0.02));
        worldOnly(pose, view).forEach((value, k) => expect(Math.abs(value - worldReference[k]!)).toBeLessThan(0.005));
      }
    }
  });

  it('is not biased by noise — an open hand under landmark noise still reads as open', () => {
    const rng = mulberry32(5);
    let reach = 0;
    let angles = 0;
    let n = 0;
    for (const view of views) {
      const rendered = render(POSES.open, { view, imageNoise: 0.003, worldNoise: 0.004, rng });
      const g = handGeometry({ landmarks: rendered.landmarks, world: rendered.world })!;
      reach += closure(g);
      // The old estimator, recomputed from the same frame: summed unsigned joint angles.
      angles += (['index', 'middle', 'ring', 'pinky'] as const).reduce(
        (sum, finger) => sum + Math.min(1, g.flexion[finger].reduce((a, b) => a + b, 0) / FULL_FINGER_CURL_ANGLE),
        0
      ) / 4;
      n++;
    }
    expect(reach / n).toBeLessThan(0.15);
    // The bias the rewrite removed, measured rather than asserted from memory.
    expect(angles / n).toBeGreaterThan(reach / n + 0.1);
  });
});

describe('the peace sign and its near misses', () => {
  it('separates a V from two fingers held together by the gap between the tips', () => {
    expect(measure(POSES.peace).tipGap).toBeGreaterThan(measure(POSES.twoTogether).tipGap + 0.2);
  });

  it('stops trusting the gap when the fingers are curled', () => {
    expect(measure(POSES.peace).spreadWeight).toBeGreaterThan(0.9);
    expect(measure(POSES.fist).spreadWeight).toBeLessThan(0.1);
  });

  it('tells a thumbs-up from a fist by where the thumb is', () => {
    expect(measure(POSES.thumbsUp).thumbReach).toBeGreaterThan(measure(POSES.fist).thumbReach + 0.3);
    // …and a fist with the thumb beside the index is still a fist.
    expect(Math.abs(measure(POSES.fistThumbBeside).thumbReach - measure(POSES.fist).thumbReach)).toBeLessThan(0.15);
  });
});

describe('the pointer', () => {
  it('stays put while the hand closes, where a fingertip would travel a fifth of the frame', () => {
    const start = measure(POSES.openRelaxed).anchor;
    const tipStart = render(POSES.openRelaxed, {}).landmarks[8]!;
    let tipTravel = 0;
    for (const t of [0.25, 0.5, 0.75, 1]) {
      const pose = blendPose(POSES.openRelaxed, POSES.fist, t);
      const anchor = measure(pose).anchor;
      expect(Math.hypot(anchor.x - start.x, anchor.y - start.y)).toBeLessThan(1e-6);
      const tip = render(pose, {}).landmarks[8]!;
      tipTravel = Math.max(tipTravel, Math.hypot(tip.x - tipStart.x, tip.y - tipStart.y));
    }
    expect(tipTravel).toBeGreaterThan(0.15);
  });
});

describe('the palm side, from anatomy rather than from a label', () => {
  it('finds the palm facing the lens for either hand, raw or mirrored', () => {
    for (const chirality of ['right', 'left'] as const) {
      for (const mirrored of [false, true]) {
        for (const pose of [POSES.openRelaxed, POSES.fist, POSES.peace]) {
          const normal = measure(pose, { chirality, camera: { ...DEFAULT_CAMERA, mirrored } }).palmNormal;
          expect(normal).not.toBeNull();
          // Camera z points away from the lens, so a palm facing it has a negative z.
          expect(normal![2]).toBeLessThan(-0.9);
        }
      }
    }
  });
});

describe('sources', () => {
  it('fuses image and world landmarks when it has both, and says which it used', () => {
    const rendered = render(POSES.open, {});
    expect(handGeometry({ landmarks: rendered.landmarks, world: rendered.world })!.source).toBe('fused');
    expect(handGeometry({ landmarks: rendered.landmarks })!.source).toBe('image');
    expect(handGeometry({ landmarks: rendered.landmarks.map((p) => ({ ...p, x: Number.NaN })), world: rendered.world })!.source).toBe('world');
  });

  it('refuses a partial hand rather than inventing the rest', () => {
    const rendered = render(POSES.open, {});
    expect(handGeometry({ landmarks: rendered.landmarks.slice(0, 12) })).toBeNull();
  });
});
