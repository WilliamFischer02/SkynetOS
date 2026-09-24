/**
 * The synthetic hand has to be right before anything measured with it can be trusted — and it was
 * wrong twice on 2026-09-12, both times in ways that would have been blamed on the maths it was
 * testing. Both are tests here.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAMERA,
  FRONTAL,
  POSES,
  blendPose,
  mulberry32,
  render,
  skeleton,
  staggeredBlend,
  type Vec3
} from '@shared/hand-synth.js';

const length = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('the skeleton', () => {
  it('has adult proportions: a palm of about 95 mm and a middle finger of about 91 mm', () => {
    const bones = skeleton(POSES.open);
    expect(length(bones[0]!, bones[9]!)).toBeCloseTo(0.095, 2);
    const middle = length(bones[9]!, bones[10]!) + length(bones[10]!, bones[11]!) + length(bones[11]!, bones[12]!);
    expect(middle).toBeCloseTo(0.091, 3);
  });

  it('keeps bone lengths fixed however the joints bend', () => {
    const open = skeleton(POSES.open);
    const fist = skeleton(POSES.fist);
    for (const [a, b] of [[5, 6], [6, 7], [7, 8], [17, 18], [2, 3], [3, 4]] as const) {
      expect(length(fist[a]!, fist[b]!)).toBeCloseTo(length(open[a]!, open[b]!), 9);
    }
  });
});

describe('the camera', () => {
  it('puts a frontal palm in the middle of the picture', () => {
    const { landmarks } = render(POSES.open, { view: FRONTAL });
    const ids = [0, 5, 9, 13, 17];
    const x = ids.reduce((sum, id) => sum + landmarks[id]!.x, 0) / ids.length;
    const y = ids.reduce((sum, id) => sum + landmarks[id]!.y, 0) / ids.length;
    expect(x).toBeCloseTo(0.5, 2);
    expect(y).toBeCloseTo(0.5, 2);
  });

  it('keeps the PALM where it is while the fingers close — the placement fault of 2026-09-12', () => {
    // The first renderer placed the hand by the centre of all 21 points, so every closing fist
    // dragged the whole hand 8% of the frame towards the palm. A real palm does not move.
    const ids = [0, 5, 9, 13, 17];
    const palm = (t: number): { x: number; y: number } => {
      const { landmarks } = render(blendPose(POSES.openRelaxed, POSES.fist, t), {});
      return {
        x: ids.reduce((sum, id) => sum + landmarks[id]!.x, 0) / ids.length,
        y: ids.reduce((sum, id) => sum + landmarks[id]!.y, 0) / ids.length
      };
    };
    const start = palm(0);
    for (const t of [0.25, 0.5, 0.75, 1]) {
      const at = palm(t);
      expect(Math.hypot(at.x - start.x, at.y - start.y)).toBeLessThan(1e-9);
    }
  });

  it('shows a right hand with its thumb on the right of a raw frame, and a left hand mirrored', () => {
    const right = render(POSES.open, { chirality: 'right' }).landmarks;
    const left = render(POSES.open, { chirality: 'left' }).landmarks;
    expect(right[4]!.x).toBeGreaterThan(right[0]!.x);
    expect(left[4]!.x).toBeLessThan(left[0]!.x);
  });

  it('flips a mirrored camera exactly, in the picture and in the world landmarks', () => {
    const raw = render(POSES.peace, { camera: DEFAULT_CAMERA });
    const mirrored = render(POSES.peace, { camera: { ...DEFAULT_CAMERA, mirrored: true } });
    raw.landmarks.forEach((point, k) => expect(mirrored.landmarks[k]!.x).toBeCloseTo(1 - point.x, 12));
    raw.world.forEach((point, k) => expect(mirrored.world[k]!.x).toBeCloseTo(-point.x, 12));
    expect(mirrored.label).not.toBe(raw.label);
  });
});

describe('movement', () => {
  it('blends from one pose to the other, exactly at each end', () => {
    expect(blendPose(POSES.open, POSES.fist, 0).index.mcp).toBeCloseTo(POSES.open.index.mcp, 9);
    expect(blendPose(POSES.open, POSES.fist, 1).index.mcp).toBeCloseTo(POSES.fist.index.mcp, 9);
  });

  it('closes little finger first and still starts and finishes on the poses — the timing fault of 2026-09-12', () => {
    // The first stagger never reached either end: its "fist" had the index only 80% closed.
    const start = staggeredBlend(POSES.openRelaxed, POSES.fist, 0);
    const end = staggeredBlend(POSES.openRelaxed, POSES.fist, 1);
    for (const finger of ['index', 'middle', 'ring', 'pinky'] as const) {
      expect(start[finger].mcp).toBeCloseTo(POSES.openRelaxed[finger].mcp, 9);
      expect(end[finger].mcp).toBeCloseTo(POSES.fist[finger].mcp, 9);
    }
    const midway = staggeredBlend(POSES.openRelaxed, POSES.fist, 0.4);
    expect(midway.pinky.mcp).toBeGreaterThan(midway.index.mcp);
  });

  it('draws the same random hands every run', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
});
