/**
 * Left and right: two facts, measured separately, and never allowed to stand in for each other.
 *
 * William, 2026-09-12: "it appears the inputs may be horizontally inverted - it continually thinks my
 * right hand is my left hand." And later the same day: "when moved the cursor movement in the program
 * should mirror the hand's movement."
 *
 * Those are two different questions. Which hand the landmarker SAYS it is belongs to the model's label
 * convention. Which way a hand moving to his right goes in the picture belongs to the camera. The first
 * attempt at this file tied them to one flag — and his report fits both "mirrored camera, documented
 * convention" and "raw camera, labels already right", which predict opposite cursor directions. So the
 * label has its own correction, the camera has its own measurement, and these tests keep them apart.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MIRRORED,
  cursorFraction,
  mirroredFromMotion,
  rightHandHasSmallerX,
  sideFromLabel
} from '@shared/hand-roles.js';
import { sanitiseCalibration, type CalibrationProfile } from '@shared/calibration.js';
import { DEFAULT_CAMERA, POSES, render } from '@shared/hand-synth.js';

describe('the label', () => {
  it('is taken as reported unless this rig says otherwise', () => {
    expect(sideFromLabel('Left')).toBe('left');
    expect(sideFromLabel('Right')).toBe('right');
  });

  it('is swapped, exactly, when the rig says to', () => {
    expect(sideFromLabel('Left', true)).toBe('right');
    expect(sideFromLabel('Right', true)).toBe('left');
  });

  it('says unknown rather than guessing', () => {
    expect(sideFromLabel('unknown')).toBe('unknown');
    expect(sideFromLabel(undefined, true)).toBe('unknown');
    expect(sideFromLabel('Middle')).toBe('unknown');
  });
});

describe('the camera', () => {
  it('defaults to a straight, unmirrored view — what the cursor has always assumed', () => {
    expect(DEFAULT_MIRRORED).toBe(false);
  });

  it('puts the person’s right hand on the picture’s left in a raw frame, and on its right in a mirrored one', () => {
    expect(rightHandHasSmallerX(false)).toBe(true);
    expect(rightHandHasSmallerX(true)).toBe(false);
  });

  it('is measured from a movement, and refuses to answer from too little of one', () => {
    expect(mirroredFromMotion(-0.2)).toBe(false);
    expect(mirroredFromMotion(0.2)).toBe(true);
    expect(mirroredFromMotion(0.02)).toBeNull();
  });
});

describe('the cursor goes the way the hand goes, on either kind of camera', () => {
  /*
   * The whole chain, on the synthetic camera: a hand moves to the person's right; the camera sees it
   * move one way or the other; the direction check measures which; the cursor then moves right.
   * The person faces the lens, so their right is the camera's −x.
   */
  const region = { x0: 0.18, x1: 0.82 };
  const palmX = (x: number, mirrored: boolean): number => {
    const { landmarks } = render(POSES.openRelaxed, { view: { yaw: 0, pitch: 0, roll: 0, x, y: 0, distance: 0.5 }, camera: { ...DEFAULT_CAMERA, mirrored } });
    return [0, 5, 9, 13, 17].reduce((sum, id) => sum + landmarks[id]!.x, 0) / 5;
  };

  for (const mirrored of [false, true]) {
    it(`${mirrored ? 'a mirroring' : 'a straight'} camera`, () => {
      const start = palmX(0.08, mirrored);
      const end = palmX(-0.08, mirrored);
      const measured = mirroredFromMotion(end - start);
      expect(measured).toBe(mirrored);
      expect(cursorFraction(end, region, measured!)).toBeGreaterThan(cursorFraction(start, region, measured!) + 0.2);
    });
  }

  it('and the wrong assumption would send it the wrong way — which is why it is measured', () => {
    const start = palmX(0.08, true);
    const end = palmX(-0.08, true);
    expect(cursorFraction(end, region, false)).toBeLessThan(cursorFraction(start, region, false));
  });

  it('clamps to the edges of the reach', () => {
    expect(cursorFraction(-1, region, true)).toBe(0);
    expect(cursorFraction(2, region, true)).toBe(1);
  });
});

describe('remembering both', () => {
  const base = {
    version: 1 as const,
    capturedAt: '2026-09-12T00:00:00.000Z',
    driver: 'HD CAM',
    cameras: [{ label: 'HD CAM', region: { x0: 0.2, x1: 0.8, y0: 0.2, y1: 0.8 } }]
  };

  it('keeps each camera’s measured mirroring, and the label correction, through the file', () => {
    const profile: CalibrationProfile = { ...base, cameras: [{ ...base.cameras[0]!, mirrored: true }], labelsSwapped: true };
    const back = sanitiseCalibration(JSON.parse(JSON.stringify(profile)))!;
    expect(back.cameras[0]!.mirrored).toBe(true);
    expect(back.labelsSwapped).toBe(true);
  });

  it('leaves both absent when nothing was measured or corrected', () => {
    const back = sanitiseCalibration(JSON.parse(JSON.stringify(base)))!;
    expect(back.cameras[0]!.mirrored).toBeUndefined();
    expect(back.labelsSwapped).toBeUndefined();
  });

  it('reads the earlier spellings as label corrections, and never as camera geometry', () => {
    // A profile-level `mirrored: true` meant "take the label as reported"; `false` meant "swap it".
    const asReported = sanitiseCalibration({ ...base, mirrored: true })!;
    const swapped = sanitiseCalibration({ ...base, mirrored: false })!;
    expect(asReported.labelsSwapped).toBe(false);
    expect(swapped.labelsSwapped).toBe(true);
    expect(asReported.cameras[0]!.mirrored).toBeUndefined();
    expect(swapped.cameras[0]!.mirrored).toBeUndefined();
  });
});
