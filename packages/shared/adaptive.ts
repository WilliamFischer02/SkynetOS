/**
 * Thresholds that tune themselves, continuously, to the hand in front of the camera.
 *
 * William, 2026-09-12: "dynamically tune the sensitivity of gesture control / manual mode
 * continuously throughout use to standardize the intensity and responsiveness."
 *
 * A fixed number for "the fingers are touching" cannot work across people, distances, lenses and
 * lighting: one person's closed pinch measures 0.18 hand-spans and another's 0.32, and the same
 * person measures differently at arm's length than close in. So nothing here is fixed. The model
 * watches what this hand actually does, learns where its own open and closed extremes sit, and puts
 * the thresholds between them.
 *
 * It is deliberately slow to widen and quick to narrow: a single frame of a badly-tracked thumb
 * should not stretch the scale, but a genuine change of posture should be picked up within a second
 * or two of use.
 *
 * Pure, and every step is a function of the previous state — so a session's worth of adaptation can
 * be replayed in a test without a camera.
 */

export interface ApertureModel {
  /** The smallest aperture this hand reliably reaches: a closed pinch. */
  closed: number;
  /** The largest: fingers comfortably apart, the cursor posture. */
  open: number;
  /** How many frames have contributed. Below `WARMUP` the defaults still lead. */
  samples: number;
}

/** Until this many frames have been seen, the starting numbers dominate. */
export const WARMUP = 60;

/** Where a new model starts: the measured behaviour of a hand at a keyboard's distance. */
export const DEFAULT_APERTURE: ApertureModel = { closed: 0.22, open: 0.85, samples: 0 };

/** The extremes can never be closer than this, or the thresholds would sit on top of each other. */
const MIN_RANGE = 0.25;

/** Pulled towards a new extreme this fast; the opposite direction decays far more slowly. */
const TOWARDS = 0.25;
const AWAY = 0.01;

/**
 * Fold one observation into the model.
 *
 * Extremes move quickly towards a new record and creep back slowly when they are not being
 * reached — so putting your hand down for a minute does not reset what it has learned, but genuinely
 * pinching tighter than before is picked up at once.
 */
export function updateAperture(model: ApertureModel, aperture: number): ApertureModel {
  if (!Number.isFinite(aperture) || aperture < 0 || aperture > 4) return model;
  const closed =
    aperture < model.closed
      ? model.closed + (aperture - model.closed) * TOWARDS
      : model.closed + (aperture - model.closed) * AWAY * 0.5;
  const open =
    aperture > model.open
      ? model.open + (aperture - model.open) * TOWARDS
      : model.open + (aperture - model.open) * AWAY * 0.5;
  // Never let the two extremes converge: a hand held still for a while must not make every
  // threshold identical and turn the smallest tremor into a click.
  const span = Math.max(MIN_RANGE, open - closed);
  const middle = (open + closed) / 2;
  return {
    closed: Math.max(0.02, middle - span / 2),
    open: Math.min(2.5, middle + span / 2),
    samples: Math.min(model.samples + 1, 10_000)
  };
}

export interface ApertureThresholds {
  /** Below this, the fingers count as touching. */
  close: number;
  /** Above this, they count as apart again. Always the larger of the two: this is the hysteresis. */
  open: number;
}

/**
 * Where to put the two thresholds, given what this hand does.
 *
 * A third of the way up the range closes and just over half opens, which leaves a band in the
 * middle where nothing changes — the hysteresis that stops a hand resting near the boundary from
 * clicking several times a second.
 *
 * Before `WARMUP` frames the model is blended with the defaults, so the first seconds of use behave
 * sensibly instead of following whatever the first two frames happened to measure.
 */
export function apertureThresholds(model: ApertureModel): ApertureThresholds {
  const weight = Math.min(1, model.samples / WARMUP);
  const closed = model.closed * weight + DEFAULT_APERTURE.closed * (1 - weight);
  const open = model.open * weight + DEFAULT_APERTURE.open * (1 - weight);
  const range = Math.max(MIN_RANGE, open - closed);
  /*
   * A third of the range closes and nearly two thirds opens. The gap between them is the whole
   * point: William's resting posture — pointer and thumb toward the screen, not touching — sat
   * BETWEEN the first version's two thresholds, so every tremor of his hand crossed one and the
   * board received a stream of double clicks while he was doing nothing at all.
   */
  return { close: closed + range * 0.3, open: closed + range * 0.62 };
}
