import { describe, expect, it } from 'vitest';
import omggif from 'omggif';
import {
  GIF_CAPS,
  GIF_DEFAULT_DELAY_MS,
  GIF_MIN_DELAY_MS,
  compositeGif,
  gifFrameAt,
  isGifPath,
  normaliseDelay,
  planGifFrames
} from '../packages/shared/gif.js';

// omggif is CommonJS: the default import is the form every loader agrees on.
const { GifReader, GifWriter } = omggif;

/**
 * Real GIFs, written by omggif's own GifWriter, so the compositing is tested against the format
 * rather than against a mock of it. Palette: 0 transparent-able black, 1 red, 2 green, 3 blue.
 */
const PALETTE = [0x000000, 0xff0000, 0x00ff00, 0x0000ff];

function writeGif(
  width: number,
  height: number,
  frames: { x: number; y: number; w: number; h: number; fill: number; delay: number; disposal: number; transparent?: number; pixels?: number[] }[]
): Uint8Array {
  const buf = new Uint8Array(4096);
  const writer = new GifWriter(buf, width, height, { loop: 0, palette: PALETTE });
  for (const f of frames) {
    const pixels = f.pixels ?? new Array(f.w * f.h).fill(f.fill);
    writer.addFrame(f.x, f.y, f.w, f.h, pixels, {
      delay: f.delay,
      disposal: f.disposal,
      ...(f.transparent !== undefined ? { transparent: f.transparent } : {})
    });
  }
  return buf.slice(0, writer.end());
}

/** The RGBA of one pixel of a composited frame. */
function px(rgba: Uint8Array, width: number, x: number, y: number): number[] {
  const i = (y * width + x) * 4;
  return [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!, rgba[i + 3]!];
}

const RED = [255, 0, 0, 255];
const GREEN = [0, 255, 0, 255];
const BLUE = [0, 0, 255, 255];
const CLEAR = [0, 0, 0, 0];

function composite(bytes: Uint8Array): { frames: Uint8Array[]; delays: number[]; width: number } {
  const reader = new GifReader(bytes);
  const frames: Uint8Array[] = [];
  const delays = compositeGif(reader, reader.numFrames(), (_i, rgba) => frames.push(rgba.slice()));
  return { frames, delays, width: reader.width };
}

describe('compositeGif', () => {
  it('reads every frame and its delay, in milliseconds', () => {
    const bytes = writeGif(4, 4, [
      { x: 0, y: 0, w: 4, h: 4, fill: 1, delay: 10, disposal: 1 },
      { x: 0, y: 0, w: 4, h: 4, fill: 2, delay: 25, disposal: 1 },
      { x: 0, y: 0, w: 4, h: 4, fill: 3, delay: 7, disposal: 1 }
    ]);
    const { frames, delays, width } = composite(bytes);
    expect(frames).toHaveLength(3);
    expect(delays).toEqual([100, 250, 70]);
    expect(px(frames[0]!, width, 0, 0)).toEqual(RED);
    expect(px(frames[1]!, width, 3, 3)).toEqual(GREEN);
    expect(px(frames[2]!, width, 2, 1)).toEqual(BLUE);
  });

  it('keeps earlier pixels under a small patch (disposal 1: leave in place)', () => {
    const bytes = writeGif(4, 4, [
      { x: 0, y: 0, w: 4, h: 4, fill: 1, delay: 10, disposal: 1 },
      { x: 1, y: 1, w: 2, h: 2, fill: 2, delay: 10, disposal: 1 }
    ]);
    const { frames, width } = composite(bytes);
    expect(px(frames[1]!, width, 0, 0)).toEqual(RED);
    expect(px(frames[1]!, width, 1, 1)).toEqual(GREEN);
  });

  it('clears a patch to transparent when it asked for disposal 2', () => {
    const bytes = writeGif(4, 4, [
      { x: 0, y: 0, w: 4, h: 4, fill: 1, delay: 10, disposal: 1 },
      { x: 1, y: 1, w: 2, h: 2, fill: 2, delay: 10, disposal: 2 },
      { x: 3, y: 3, w: 1, h: 1, fill: 3, delay: 10, disposal: 1 }
    ]);
    const { frames, width } = composite(bytes);
    expect(px(frames[1]!, width, 1, 1)).toEqual(GREEN);
    // Frame 2 is drawn after frame 1's patch was cleared: the hole shows through, red stays around it.
    expect(px(frames[2]!, width, 1, 1)).toEqual(CLEAR);
    expect(px(frames[2]!, width, 0, 0)).toEqual(RED);
    expect(px(frames[2]!, width, 3, 3)).toEqual(BLUE);
  });

  it('restores what was underneath when it asked for disposal 3', () => {
    const bytes = writeGif(4, 4, [
      { x: 0, y: 0, w: 4, h: 4, fill: 1, delay: 10, disposal: 1 },
      { x: 0, y: 0, w: 2, h: 2, fill: 2, delay: 10, disposal: 3 },
      { x: 3, y: 3, w: 1, h: 1, fill: 3, delay: 10, disposal: 1 }
    ]);
    const { frames, width } = composite(bytes);
    expect(px(frames[1]!, width, 0, 0)).toEqual(GREEN);
    expect(px(frames[2]!, width, 0, 0)).toEqual(RED);
  });

  it('lets earlier frames show through transparent pixels of a later one', () => {
    // A 2x2 patch with index 0 marked transparent in two corners.
    const bytes = writeGif(2, 2, [
      { x: 0, y: 0, w: 2, h: 2, fill: 1, delay: 10, disposal: 1 },
      { x: 0, y: 0, w: 2, h: 2, fill: 0, delay: 10, disposal: 1, transparent: 0, pixels: [0, 3, 3, 0] }
    ]);
    const { frames, width } = composite(bytes);
    expect(px(frames[1]!, width, 0, 0)).toEqual(RED);
    expect(px(frames[1]!, width, 1, 0)).toEqual(BLUE);
  });

  it('stops at `keep`, and never reads past the last frame', () => {
    const bytes = writeGif(2, 2, [
      { x: 0, y: 0, w: 2, h: 2, fill: 1, delay: 10, disposal: 1 },
      { x: 0, y: 0, w: 2, h: 2, fill: 2, delay: 10, disposal: 1 },
      { x: 0, y: 0, w: 2, h: 2, fill: 3, delay: 10, disposal: 1 }
    ]);
    const reader = new GifReader(bytes);
    let seen = 0;
    expect(compositeGif(reader, 2, () => { seen++; })).toHaveLength(2);
    expect(seen).toBe(2);
    expect(compositeGif(reader, 99, () => undefined)).toHaveLength(3);
  });
});

describe('delays', () => {
  it('turns centiseconds into milliseconds, clamped the way browsers clamp them', () => {
    expect(normaliseDelay(0)).toBe(GIF_DEFAULT_DELAY_MS);
    expect(normaliseDelay(1)).toBe(GIF_DEFAULT_DELAY_MS);
    expect(normaliseDelay(2)).toBe(GIF_MIN_DELAY_MS);
    expect(normaliseDelay(4)).toBe(40);
    expect(normaliseDelay(Number.NaN)).toBe(GIF_DEFAULT_DELAY_MS);
  });

  it('schedules whole frames by their own delays and loops', () => {
    const delays = [100, 300, 100];
    expect(gifFrameAt(delays, 0)).toBe(0);
    expect(gifFrameAt(delays, 99)).toBe(0);
    expect(gifFrameAt(delays, 100)).toBe(1);
    expect(gifFrameAt(delays, 399)).toBe(1);
    expect(gifFrameAt(delays, 400)).toBe(2);
    expect(gifFrameAt(delays, 500)).toBe(0);
    expect(gifFrameAt(delays, 500 * 7 + 150)).toBe(1);
    expect(gifFrameAt([80], 12345)).toBe(0);
    expect(gifFrameAt([], 12345)).toBe(0);
  });
});

describe('caps', () => {
  it('keeps everything under the caps', () => {
    expect(planGifFrames(30, { width: 200, height: 200 }, { width: 64, height: 64 })).toEqual({ frames: 30, truncated: false, reason: null });
  });

  it('animates at most 120 frames and says so', () => {
    const plan = planGifFrames(500, { width: 50, height: 50 }, { width: 32, height: 32 });
    expect(plan.frames).toBe(GIF_CAPS.maxFrames);
    expect(plan.truncated).toBe(true);
    expect(plan.reason).toMatch(/500 FRAMES/);
  });

  it('bounds the decoded output for a big node', () => {
    // 640x480 RGBA is 1.2 MB a frame: 16 MB holds 13 of them.
    const plan = planGifFrames(60, { width: 640, height: 480 }, { width: 640, height: 480 });
    expect(plan.frames).toBe(13);
    expect(plan.truncated).toBe(true);
  });

  it('bounds the source pixels decoded, for a huge GIF', () => {
    const plan = planGifFrames(100, { width: 4000, height: 4000 }, { width: 64, height: 64 });
    expect(plan.frames).toBe(10);
    expect(plan.reason).toMatch(/SOURCE TOO LARGE/);
  });

  it('always keeps the first frame, so a GIF too big to animate is still a picture', () => {
    expect(planGifFrames(3, { width: 99999, height: 99999 }, { width: 99999, height: 99999 }).frames).toBe(1);
  });

  it('recognises a GIF by its extension', () => {
    expect(isGifPath('%SKYNET%/assets/sprites/spin.GIF')).toBe(true);
    expect(isGifPath('a.gif ')).toBe(true);
    expect(isGifPath('a.png')).toBe(false);
    expect(isGifPath(undefined)).toBe(false);
  });
});
