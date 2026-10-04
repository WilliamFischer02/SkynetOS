/**
 * Frame-time statistics for the hologram's perf readout (docs/11 § The globe, 2026-09-27).
 *
 * The renderer (src/renderer/hologram/renderer.ts) records one sample per drawn frame into a small
 * ring; the readout (`?perf=1`, SKYNET_PERF, or Ctrl+Shift+P in the window) asks for a summary a few
 * times a second. Pure, so the arithmetic is tested without a GPU.
 */

export interface FrameSample {
  /** rAF timestamp of the frame, ms. */
  t: number;
  /** CPU time spent building and submitting the frame, ms. */
  ms: number;
  /** The content panel's 2D repaint was skipped because the previous frame ran over budget. */
  skipped: boolean;
}

export interface FrameSummary {
  /** Frames drawn per second over the window. */
  fps: number;
  /** Median and 95th-percentile frame time over the window, ms. */
  p50: number;
  p95: number;
  /** Frames in the window whose content repaint was skipped. */
  skipped: number;
  /** Frames in the window. */
  frames: number;
}

/** The window the readout summarises. */
export const FRAME_WINDOW_MS = 2000;

/** The value at quantile `q` (0..1) of an ascending array, nearest-rank; 0 when empty. */
export function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return 0;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[rank]!;
}

/** fps, p50, p95 and skips over the samples within `windowMs` of `now`. */
export function summariseFrames(samples: readonly FrameSample[], now: number, windowMs = FRAME_WINDOW_MS): FrameSummary {
  const recent = samples.filter((s) => now - s.t <= windowMs && s.t <= now);
  if (!recent.length) return { fps: 0, p50: 0, p95: 0, skipped: 0, frames: 0 };
  const times = recent.map((s) => s.ms).sort((a, b) => a - b);
  // Intervals between the first and last frame in the window, so a pause before the window does not count.
  let first = Infinity;
  let last = -Infinity;
  for (const s of recent) { first = Math.min(first, s.t); last = Math.max(last, s.t); }
  const fps = recent.length > 1 ? Math.round(((recent.length - 1) * 1000) / Math.max(1, last - first)) : 0;
  return {
    fps,
    p50: quantile(times, 0.5),
    p95: quantile(times, 0.95),
    skipped: recent.filter((s) => s.skipped).length,
    frames: recent.length
  };
}

/** The corner readout, one line: `60 fps · 1.2/3.4 ms p50/p95 · 0 skipped`. */
export function frameReadout(summary: FrameSummary, paused = false): string {
  if (paused) return 'PAUSED · window hidden';
  return `${summary.fps} fps · ${summary.p50.toFixed(1)}/${summary.p95.toFixed(1)} ms p50/p95 · ${summary.skipped} skipped`;
}
