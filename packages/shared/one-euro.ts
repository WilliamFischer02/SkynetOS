/**
 * The One Euro filter: jitter-free when the hand is still, lag-free when it moves.
 *
 * William, 2026-09-12: "open hand is the cursor and when moved the cursor movement in the program
 * should mirror the hand's movement."
 *
 * Mirroring a hand faithfully is two requirements that pull against each other. A landmark on a
 * perfectly still hand still wanders by several pixels a frame, so an unfiltered cursor shivers;
 * filter that away with a plain moving average and the cursor then trails a moving hand by a
 * quarter of a second, which reads as the board being drunk. No fixed amount of smoothing satisfies
 * both, because the right amount depends on how fast the hand is going.
 *
 * Casiez, Roussel and Vogel, "1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input in
 * Interactive Systems" (CHI 2012) is the standard answer, and the reason it is standard is that it
 * makes that dependency explicit: a first-order low-pass whose cutoff frequency RISES with the
 * measured speed. At rest the cutoff is low and jitter is removed; in motion it climbs and the lag
 * goes with it. Two parameters, each with one job:
 *
 *   - `minCutoff` (Hz) sets how much jitter survives at rest. Lower is steadier and laggier.
 *   - `beta` sets how fast the cutoff climbs with speed. Higher is more responsive in motion.
 *
 * Speed here is measured in frame-widths per second, so `beta` is in those units too. The 2D filter
 * shares ONE cutoff across both axes, computed from the speed of the whole point rather than each
 * axis alone: filtering x and y independently makes a diagonal movement lag more on whichever axis
 * happens to be moving slower, which bends straight strokes.
 *
 * Pure: every call is given its own timestamp, so a test can drive it at any frame rate.
 */

export interface OneEuroConfig {
  /** Cutoff at rest, in hertz. */
  minCutoff: number;
  /** How much the cutoff rises per unit of speed (frame-widths per second). */
  beta: number;
  /** Cutoff for the speed estimate itself, in hertz. */
  dCutoff: number;
}

/**
 * For the cursor, in normalised frame coordinates. Chosen from a measured sweep, 2026-09-12.
 *
 * The first values (1 Hz, β 8) cut still-hand jitter only 2.2x; lowering the rest cutoff alone barely
 * helped, because on a still hand the NOISE registers as speed and β raises the cutoff with it. So all
 * three were swept (.vision-probe/tune-one-euro.ts: rest cutoff 0.3–1 Hz, β 2–12, derivative cutoff
 * 0.5 and 1 Hz), each scored on a still palm with landmark noise and on sweeps at 1 and 0.3 frame
 * widths a second. At 0.45 Hz and β 12:
 *
 *   - jitter falls 3.5x on raw landmark noise, 4.1x on the palm anchor, which averages five landmarks;
 *   - a brisk sweep lags by one hundredth of the frame width — the least of the whole grid;
 *   - a fixed low-pass equally steady at rest would lag by 0.35, which is the problem this filter solves.
 *
 * The derivative cutoff stays at the published 1 Hz. Half that scored a little steadier at rest, but it
 * slows how quickly the filter notices a hand has STARTED to move, which a steady-state sweep does not
 * measure and a person feels at once.
 */
export const CURSOR_FILTER: OneEuroConfig = { minCutoff: 0.45, beta: 12, dCutoff: 1.0 };

/** For the two-handed zoom separation, which is a slower, larger signal. */
export const ZOOM_FILTER: OneEuroConfig = { minCutoff: 1.5, beta: 2, dCutoff: 1.0 };

/**
 * A gap longer than this means the hand was lost and found again. The filter restarts rather than
 * smoothing a straight line through a period when it saw nothing.
 */
const GAP_RESET_S = 0.3;

/** The smoothing factor for a first-order low-pass at `cutoff` Hz, sampled `dt` seconds apart. */
export function smoothingFactor(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export interface OneEuro2D {
  filter(x: number, y: number, atMs: number): { x: number; y: number };
  reset(): void;
}

export function oneEuro2D(config: OneEuroConfig = CURSOR_FILTER): OneEuro2D {
  let last: { x: number; y: number; atMs: number } | null = null;
  let vx = 0;
  let vy = 0;

  return {
    filter(x, y, atMs) {
      if (!last) {
        last = { x, y, atMs };
        return { x, y };
      }
      // The same frame delivered twice: nothing new was measured, so nothing new is said.
      if (atMs <= last.atMs) return { x: last.x, y: last.y };
      const dt = (atMs - last.atMs) / 1000;
      if (dt > GAP_RESET_S) {
        last = { x, y, atMs };
        vx = 0;
        vy = 0;
        return { x, y };
      }

      // Speed, itself low-passed: the raw derivative of a noisy signal is mostly noise.
      const dAlpha = smoothingFactor(config.dCutoff, dt);
      vx += dAlpha * ((x - last.x) / dt - vx);
      vy += dAlpha * ((y - last.y) / dt - vy);
      const speed = Math.hypot(vx, vy);

      const alpha = smoothingFactor(config.minCutoff + config.beta * speed, dt);
      const next = { x: last.x + alpha * (x - last.x), y: last.y + alpha * (y - last.y), atMs };
      last = next;
      return { x: next.x, y: next.y };
    },
    reset() {
      last = null;
      vx = 0;
      vy = 0;
    }
  };
}

export interface OneEuro1D {
  filter(value: number, atMs: number): number;
  reset(): void;
}

export function oneEuro1D(config: OneEuroConfig): OneEuro1D {
  const inner = oneEuro2D(config);
  return {
    filter: (value, atMs) => inner.filter(value, 0, atMs).x,
    reset: () => inner.reset()
  };
}
