import { describe, expect, it } from 'vitest';
import { ROTATIONS, isRotation, type Rotation } from '../packages/shared/types.js';
import { rotateRgba } from '../src/main/services/mosaic.js';

/**
 * Quarter turns on aesthetic assets.
 *
 * William: "aesthetic tiles / visual assets need to be able to be rotated."
 *
 * Quarter turns ONLY, and the reason is not fussiness: an arbitrary angle resamples every pixel,
 * and docs/02 §Anti-mush treats one soft pixel as a crash-severity bug. A quarter turn is a pure
 * permutation — every output pixel IS some input pixel, byte for byte — so it is exact.
 *
 * `rotateRgba` is the backdrop path. The tile path goes through the atlas texture's own `rotate`
 * field, which Pixi applies in UV space and which is exact for the same reason; that one is
 * guarded structurally in test/render-invariants.test.ts, because verifying it needs a GPU.
 */

/** A buffer where each pixel's red channel encodes its index, so a permutation is traceable. */
function grid(width: number, height: number): Buffer {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = i;          // r = index
    data[i * 4 + 1] = 0;
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }
  return data;
}

/** The red channel, as a grid of rows, so a turn is readable. */
function rows(data: Buffer, width: number, height: number): number[][] {
  const out: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) row.push(data[(y * width + x) * 4]!);
    out.push(row);
  }
  return out;
}

describe('the rotation type', () => {
  it('offers exactly the four quarter turns', () => {
    expect([...ROTATIONS]).toEqual([0, 90, 180, 270]);
  });

  it('rejects anything else', () => {
    // 45 degrees would have to resample. There is no such thing as a sharp 45-degree pixel turn.
    for (const bad of [45, 1, 360, -90, '90', null, undefined]) {
      expect(isRotation(bad), `${String(bad)} must not be a legal rotation`).toBe(false);
    }
  });
});

describe('rotateRgba turns a buffer exactly', () => {
  //  0 1 2
  //  3 4 5
  const src = grid(3, 2);

  it('leaves 0 alone, and does not copy', () => {
    const out = rotateRgba(src, 3, 2, 0);
    expect(out.width).toBe(3);
    expect(out.height).toBe(2);
    expect(out.data).toBe(src);
  });

  it('turns 90 degrees clockwise, swapping the axes', () => {
    const out = rotateRgba(src, 3, 2, 90);
    expect([out.width, out.height]).toEqual([2, 3]);
    // The left column (0,3) becomes the top row, bottom-to-top.
    expect(rows(out.data, out.width, out.height)).toEqual([
      [3, 0],
      [4, 1],
      [5, 2]
    ]);
  });

  it('turns 180 degrees', () => {
    const out = rotateRgba(src, 3, 2, 180);
    expect([out.width, out.height]).toEqual([3, 2]);
    expect(rows(out.data, out.width, out.height)).toEqual([
      [5, 4, 3],
      [2, 1, 0]
    ]);
  });

  it('turns 270 degrees clockwise', () => {
    const out = rotateRgba(src, 3, 2, 270);
    expect([out.width, out.height]).toEqual([2, 3]);
    expect(rows(out.data, out.width, out.height)).toEqual([
      [2, 5],
      [1, 4],
      [0, 3]
    ]);
  });

  it('is a permutation — every pixel survives, none is invented', () => {
    /*
     * The property that makes this legal under anti-mush. Nothing is averaged, so the multiset of
     * pixels out is exactly the multiset in.
     */
    for (const degrees of ROTATIONS) {
      const out = rotateRgba(grid(5, 3), 5, 3, degrees as Rotation);
      const seen = rows(out.data, out.width, out.height).flat().sort((a, b) => a - b);
      expect(seen, `${degrees} lost or invented a pixel`).toEqual([...Array(15).keys()]);
    }
  });

  it('four quarter turns return the original', () => {
    // The strongest statement of exactness available: no drift, because nothing is resampled.
    let current = { data: grid(4, 3), width: 4, height: 3 };
    for (let i = 0; i < 4; i++) current = rotateRgba(current.data, current.width, current.height, 90);
    expect([current.width, current.height]).toEqual([4, 3]);
    expect(rows(current.data, 4, 3)).toEqual(rows(grid(4, 3), 4, 3));
  });
});
