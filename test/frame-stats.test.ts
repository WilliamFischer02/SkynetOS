import { describe, expect, it } from 'vitest';
import { FRAME_WINDOW_MS, frameReadout, quantile, summariseFrames, type FrameSample } from '../packages/shared/frame-stats.js';

/** The hologram's perf readout (Ctrl+Shift+P): fps, p50/p95 frame ms and skipped repaints over two seconds. */
describe('summariseFrames', () => {
  it('counts only the last two seconds, at 60 Hz', () => {
    const samples: FrameSample[] = [];
    for (let i = 0; i < 300; i++) samples.push({ t: i * (1000 / 60), ms: i % 10 === 0 ? 9 : 2, skipped: i % 50 === 0 });
    const now = samples[samples.length - 1]!.t;
    const out = summariseFrames(samples, now, FRAME_WINDOW_MS);
    expect(out.fps).toBe(60);
    expect(out.frames).toBeGreaterThanOrEqual(120);
    expect(out.frames).toBeLessThanOrEqual(121);
    expect(out.p50).toBe(2);
    expect(out.p95).toBe(9);
    expect(out.skipped).toBe(2);
  });

  it('is zero with nothing drawn, and says PAUSED when the window is hidden', () => {
    expect(summariseFrames([], 1000)).toEqual({ fps: 0, p50: 0, p95: 0, skipped: 0, frames: 0 });
    expect(frameReadout(summariseFrames([], 1000), true)).toBe('PAUSED · window hidden');
    expect(frameReadout({ fps: 60, p50: 1.234, p95: 3.4, skipped: 0, frames: 120 })).toBe('60 fps · 1.2/3.4 ms p50/p95 · 0 skipped');
  });

  it('takes nearest-rank quantiles', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(quantile([1, 2, 3, 4], 0.95)).toBe(4);
    expect(quantile([], 0.5)).toBe(0);
  });
});
