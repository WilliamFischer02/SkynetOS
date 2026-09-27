import { describe, expect, it } from 'vitest';
import {
  BAND_EDGES_HZ,
  LEVEL_BANDS,
  LEVEL_HOP_MS,
  SILENT_BANDS,
  analyseFrame,
  analyseTimeline,
  bandOf,
  fft,
  levelsAt,
  normaliseTimeline,
  smoothBands,
  syntheticLevels
} from '../packages/shared/speech-levels.js';

const sine = (hz: number, rate: number, n: number, amp = 0.5): Float32Array => {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
};

describe('fft', () => {
  it('puts a pure tone in the right bin', () => {
    const n = 512;
    const rate = 24_000;
    const bin = 40; // 40 * (24000/512) = 1875 Hz
    const re = sine((bin * rate) / n, rate, n, 1);
    const im = new Float32Array(n);
    fft(re, im);
    let best = 0;
    for (let k = 1; k < n / 2; k++) if (Math.hypot(re[k]!, im[k]!) > Math.hypot(re[best]!, im[best]!)) best = k;
    expect(best).toBe(bin);
  });

  it('refuses a size that is not a power of two', () => {
    expect(() => fft(new Float32Array(100), new Float32Array(100))).toThrow(/POWER OF TWO/);
  });
});

describe('analyseFrame: energy lands in the band of its frequency', () => {
  it.each([
    [120, 0],
    [250, 1],
    [500, 2],
    [1000, 3],
    [2000, 4],
    [4000, 5],
    [7000, 6],
    [10_000, 7]
  ])('%d Hz → band %d', (hz, band) => {
    const { bands, rms } = analyseFrame(sine(hz, 24_000, 512), 24_000);
    expect(bands).toHaveLength(LEVEL_BANDS);
    const loudest = bands.indexOf(Math.max(...bands));
    expect(loudest).toBe(band);
    expect(bandOf(hz)).toBe(band);
    expect(rms).toBeGreaterThan(0.3);
  });

  it('is silent for silence', () => {
    const { bands, rms } = analyseFrame(new Float32Array(512), 16_000);
    expect(rms).toBe(0);
    expect(bands.every((v) => v === 0)).toBe(true);
  });

  it('band edges are ascending and eight bands are declared', () => {
    for (let i = 1; i < BAND_EDGES_HZ.length; i++) expect(BAND_EDGES_HZ[i]!).toBeGreaterThan(BAND_EDGES_HZ[i - 1]!);
    expect(LEVEL_BANDS).toBe(8);
    expect(SILENT_BANDS).toHaveLength(8);
  });
});

describe('timeline', () => {
  it('has one frame per hop and normalises to a peak of one', () => {
    const rate = 16_000;
    const clip = sine(440, rate, rate); // one second
    const raw = analyseTimeline(clip, rate);
    expect(raw.length).toBe(Math.ceil(clip.length / Math.round((rate * LEVEL_HOP_MS) / 1000)));
    expect(raw[1]!.t - raw[0]!.t).toBe(LEVEL_HOP_MS);
    const norm = normaliseTimeline(raw);
    expect(Math.max(...norm.map((f) => f.rms))).toBeCloseTo(1, 5);
    const loudBand = bandOf(440);
    expect(Math.max(...norm.map((f) => f.bands[loudBand]!))).toBeCloseTo(1, 5);
    for (const f of norm) for (const v of f.bands) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });

  it('a silent clip normalises to zeros rather than NaN', () => {
    const norm = normaliseTimeline(analyseTimeline(new Float32Array(4000), 16_000));
    expect(norm.every((f) => f.rms === 0 && f.bands.every((v) => v === 0))).toBe(true);
  });

  it('levelsAt indexes by time and runs out after the last frame', () => {
    const timeline = normaliseTimeline(analyseTimeline(sine(300, 16_000, 8000), 16_000));
    expect(levelsAt(timeline, 0)).toBe(timeline[0]);
    expect(levelsAt(timeline, LEVEL_HOP_MS * 3 + 5)).toBe(timeline[3]);
    expect(levelsAt(timeline, 10_000)).toBeNull();
    expect(levelsAt([], 0)).toBeNull();
  });
});

describe('smoothing and the Windows-voice envelope', () => {
  it('rises fast and falls slowly, band by band', () => {
    const up = smoothBands(SILENT_BANDS, new Array(8).fill(1), 40);
    const down = smoothBands(new Array(8).fill(1), SILENT_BANDS, 40);
    expect(up[0]!).toBeGreaterThan(0.6);
    expect(down[0]!).toBeGreaterThan(0.8);
    expect(up.every((v, i) => v === up[0] || i > 0)).toBe(true);
  });

  it('never leaves 0..1 and treats bad input as silence', () => {
    const out = smoothBands([NaN, 2, -1], [Infinity, -3, 0.5], 1000);
    expect(out).toHaveLength(8);
    for (const v of out) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });

  it('synthesises a vowel-shaped spread that differs word to word and scales with level', () => {
    const a = syntheticLevels(1, 0);
    const b = syntheticLevels(1, 1);
    expect(a).toHaveLength(8);
    expect(a).not.toEqual(b);
    expect(Math.max(...a)).toBeCloseTo(1, 1);
    expect(syntheticLevels(0, 3).every((v) => v === 0)).toBe(true);
    for (const v of a) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
});
