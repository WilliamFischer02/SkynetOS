/**
 * Whether a frame is worth analysing, and how to correct it before it is.
 *
 * William, 2026-09-12: "as the lighting environment may change, I think it's crucial the program
 * knows how to ensure what is actually captured and analyzed for data and gesture capture has
 * already been processed so the image / data's contents are as contrasty and bright / sharp as
 * possible for analysis … ensure no data throws off the whole pool by being severly underexposed
 * and ensure the program knows how to filter out artifacted or all black, all white, or blurry data
 * points."
 *
 * Two separate jobs, and the distinction matters:
 *
 *   1. CORRECT what can be corrected. An under-exposed frame is still a frame; stretching it before
 *      the landmarker sees it is free accuracy. The live preview stays raw — what the corrected
 *      frame looks like is of no interest to a person, and a preview that brightens itself hides
 *      the very problem the user needs to see and fix.
 *   2. REJECT what cannot. A black frame, a blown-out frame and a motion-blurred frame contain no
 *      hand to find, and a training example taken from one poisons every comparison it later takes
 *      part in — which has already happened once here, with samples full of numbers fifty times too
 *      large.
 *
 * Pure: it takes statistics, not pixels, so the sampling can happen wherever it is cheapest and the
 * decisions can be tested without an image.
 */

export interface FrameStats {
  /** Mean luma, 0 to 1. */
  mean: number;
  /** Fraction of pixels at or near black, and at or near white. */
  black: number;
  white: number;
  /**
   * Mean absolute difference between neighbouring pixels, 0 to 1: a cheap stand-in for focus.
   * A blurred or smeared frame has little local contrast however bright it is.
   */
  detail: number;
}

export type FrameFault = 'dark' | 'blown' | 'flat' | 'blurred';

export interface FrameVerdict {
  /** Analyse this frame? */
  usable: boolean;
  /** Safe to record as a training example? Stricter: a frame can be good enough to track but not to learn from. */
  trainable: boolean;
  faults: FrameFault[];
  /** Multiply the analysed frame's brightness and contrast by these before handing it over. */
  correction: { brightness: number; contrast: number };
  /** One line for the monitor, when something is wrong. */
  note: string | null;
}

/** Below this mean luma a frame is too dark to read; above, too blown out. */
const DARK = 0.14;
const BLOWN = 0.86;
/** More than this share of the frame stuck at an extreme is clipping, not contrast. */
const CLIPPED = 0.4;
/** Local contrast below this is a smear: out of focus, or moving too fast. */
const BLUR = 0.012;
/** Even a usable frame is not worth learning from below this. */
const TRAIN_DETAIL = 0.02;

/** Aim the correction at this mean luma: bright enough for the landmarker, short of clipping. */
const TARGET_MEAN = 0.45;

export function judgeFrame(stats: FrameStats): FrameVerdict {
  const faults: FrameFault[] = [];
  if (stats.mean < DARK || stats.black > CLIPPED) faults.push('dark');
  if (stats.mean > BLOWN || stats.white > CLIPPED) faults.push('blown');
  if (stats.detail < BLUR) faults.push('blurred');
  else if (stats.detail < TRAIN_DETAIL) faults.push('flat');

  /*
   * Brightness is a simple ratio towards the target, clamped so a nearly-black frame is not
   * multiplied into noise — at some point the answer is "turn a light on", not more gain.
   */
  const brightness = stats.mean > 0.01 ? Math.min(2.2, Math.max(0.6, TARGET_MEAN / stats.mean)) : 1;
  // Contrast is raised when local detail is low and never when the frame is already clipping.
  const clipping = stats.black + stats.white;
  const contrast = clipping > 0.25 ? 1 : Math.min(1.6, Math.max(1, 1 + (0.05 - Math.min(stats.detail, 0.05)) * 8));

  const fatal = faults.includes('dark') || faults.includes('blown') || faults.includes('blurred');
  const note = fatal
    ? faults.includes('dark')
      ? 'TOO DARK TO READ — add light, or move out of the backlight'
      : faults.includes('blown')
        ? 'BLOWN OUT — too much light behind you'
        : 'BLURRED — hold still, or the camera needs more light to shorten its exposure'
    : faults.includes('flat')
      ? 'LOW CONTRAST — usable, but not good enough to learn from'
      : null;

  return {
    usable: !fatal,
    trainable: !fatal && !faults.includes('flat'),
    faults,
    correction: { brightness, contrast },
    note
  };
}

/**
 * Statistics from a small greyscale sample of a frame.
 *
 * Sampled, not exhaustive: a 64x36 grid is ample for an exposure decision and costs nothing, where
 * reading a million pixels every frame would cost more than the landmarking does.
 */
export function statsFromLuma(luma: ArrayLike<number>, width: number, height: number): FrameStats {
  const count = Math.min(luma.length, width * height);
  if (!count) return { mean: 0, black: 1, white: 0, detail: 0 };
  let total = 0;
  let black = 0;
  let white = 0;
  for (let i = 0; i < count; i++) {
    const value = luma[i] ?? 0;
    total += value;
    if (value <= 0.04) black++;
    else if (value >= 0.96) white++;
  }
  // Horizontal neighbour differences: enough to tell a smear from an edge, and one pass.
  let detail = 0;
  let pairs = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 1; x < width; x++) {
      const index = y * width + x;
      if (index >= count) break;
      detail += Math.abs((luma[index] ?? 0) - (luma[index - 1] ?? 0));
      pairs++;
    }
  }
  return {
    mean: total / count,
    black: black / count,
    white: white / count,
    detail: pairs ? detail / pairs : 0
  };
}
