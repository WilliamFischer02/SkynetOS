/**
 * Animated GIFs as wallpapers and logos.
 *
 * William: "add gifs as an image file type that can be use as a logo or wallpaper."
 *
 * A GIF is not a picture, it is a small program for building pictures: every frame is a patch laid
 * over the frames before it, and each frame says what happens to its patch afterwards (leave it,
 * clear it, or restore what was under it). Showing only the raw patches gives the torn, flickering
 * mess every half-finished GIF viewer is known for. So this composites exactly as a browser does,
 * frame by frame, and hands each finished frame to the caller, which dithers it onto the room's
 * palette like any other image (src/main/services/mosaic.ts). docs/02 holds: a GIF on the board is
 * still six colours and binary alpha, it just changes over time.
 *
 * Pure. The decoder (omggif's GifReader) is passed in through the narrow interface below, so this
 * module has no dependency and the tests can feed it GIFs written by omggif's own GifWriter.
 */

/** What compositing needs from a decoder. omggif's GifReader satisfies it as-is. */
export interface GifReaderLike {
  width: number;
  height: number;
  numFrames(): number;
  frameInfo(frame: number): { x: number; y: number; width: number; height: number; delay: number; disposal: number };
  /** Writes the frame's non-transparent pixels onto a full-canvas RGBA buffer, leaving the rest untouched. */
  decodeAndBlitFrameRGBA(frame: number, pixels: Uint8Array | Uint8ClampedArray): void;
}

export interface GifCaps {
  /** Frames animated at most. Anything after is dropped, and the inspector says so. */
  maxFrames: number;
  /** Decoded, dithered output across every kept frame, in bytes (RGBA at the node's box size). */
  maxOutputBytes: number;
  /** Source pixels composited across every kept frame: a bound on decode time for a huge GIF. */
  maxSourcePixels: number;
}

export const GIF_CAPS: GifCaps = {
  maxFrames: 120,
  maxOutputBytes: 16 * 1024 * 1024,
  maxSourcePixels: 160_000_000
};

/** Browsers clamp very short delays; so does this, or a 0-delay GIF would spin the ticker. */
export const GIF_MIN_DELAY_MS = 20;
/** What a GIF that names no delay (0 or 1 centisecond) plays at, as it does in every browser. */
export const GIF_DEFAULT_DELAY_MS = 100;

/** A frame's delay, from the file's centiseconds to milliseconds, clamped the way browsers clamp it. */
export function normaliseDelay(centiseconds: number): number {
  if (!Number.isFinite(centiseconds) || centiseconds <= 1) return GIF_DEFAULT_DELAY_MS;
  return Math.max(GIF_MIN_DELAY_MS, Math.round(centiseconds * 10));
}

export function isGifPath(path: string | undefined | null): boolean {
  return typeof path === 'string' && /\.gif$/i.test(path.trim());
}

export interface GifPlan {
  /** How many frames to composite and keep. At least 1 for any GIF with a frame. */
  frames: number;
  truncated: boolean;
  /** Why, in the inspector's words, when frames were dropped. */
  reason: string | null;
}

/**
 * How many of a GIF's frames can be kept, given the caps. The first frame always is: a GIF too big
 * to animate is still a picture, and it falls back to exactly that.
 */
export function planGifFrames(
  total: number,
  source: { width: number; height: number },
  output: { width: number; height: number },
  caps: GifCaps = GIF_CAPS
): GifPlan {
  if (total <= 0) return { frames: 0, truncated: false, reason: 'THE GIF HAS NO FRAMES' };
  let keep = Math.min(total, caps.maxFrames);
  let reason: string | null = total > caps.maxFrames ? `${total} FRAMES — ONLY THE FIRST ${caps.maxFrames} ANIMATE` : null;

  const perOutput = Math.max(1, output.width * output.height * 4);
  const byOutput = Math.max(1, Math.floor(caps.maxOutputBytes / perOutput));
  if (keep > byOutput) {
    keep = byOutput;
    reason = `TOO LARGE TO ANIMATE WHOLE AT THIS SIZE — FIRST ${keep} OF ${total} FRAMES (${Math.round(caps.maxOutputBytes / 1048576)} MB LIMIT)`;
  }
  const perSource = Math.max(1, source.width * source.height);
  const bySource = Math.max(1, Math.floor(caps.maxSourcePixels / perSource));
  if (keep > bySource) {
    keep = bySource;
    reason = `SOURCE TOO LARGE TO DECODE WHOLE — FIRST ${keep} OF ${total} FRAMES`;
  }
  return { frames: keep, truncated: keep < total, reason };
}

function clearRect(canvas: Uint8Array, canvasW: number, canvasH: number, r: { x: number; y: number; width: number; height: number }): void {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(canvasW, r.x + r.width);
  const y1 = Math.min(canvasH, r.y + r.height);
  for (let y = y0; y < y1; y++) canvas.fill(0, (y * canvasW + x0) * 4, (y * canvasW + x1) * 4);
}

/**
 * Composite the first `keep` frames onto a full-size canvas, honouring each frame's disposal, and
 * hand each finished frame to `onFrame` (RGBA, width x height, straight alpha) with its delay in ms.
 *
 * The buffer passed to `onFrame` is reused for the next frame: copy what you need before returning.
 *
 * Disposal, as browsers do it: 0 and 1 leave the frame in place; 2 clears its rectangle to
 * transparent (GIF's "background" is transparent in every browser that matters); 3 restores what was
 * there before the frame was drawn.
 */
export function compositeGif(
  reader: GifReaderLike,
  keep: number,
  onFrame: (index: number, rgba: Uint8Array, delayMs: number) => void
): number[] {
  const w = reader.width;
  const h = reader.height;
  const canvas = new Uint8Array(w * h * 4);
  const delays: number[] = [];
  let previous: { x: number; y: number; width: number; height: number; disposal: number } | null = null;
  let saved: Uint8Array | null = null;
  const frames = Math.min(keep, reader.numFrames());

  for (let i = 0; i < frames; i++) {
    if (previous) {
      if (previous.disposal === 2) clearRect(canvas, w, h, previous);
      else if (previous.disposal === 3 && saved) canvas.set(saved);
    }
    const info = reader.frameInfo(i);
    saved = info.disposal === 3 ? canvas.slice() : null;
    reader.decodeAndBlitFrameRGBA(i, canvas);
    const delay = normaliseDelay(info.delay);
    delays.push(delay);
    onFrame(i, canvas, delay);
    previous = info;
  }
  return delays;
}

/**
 * Which frame shows at time `t` (ms, any monotonic clock), looping forever. Whole frames only:
 * the board steps from one to the next, it never blends.
 */
export function gifFrameAt(delays: readonly number[], t: number): number {
  if (delays.length <= 1) return 0;
  const total = delays.reduce((sum, d) => sum + d, 0);
  if (total <= 0) return 0;
  let r = ((t % total) + total) % total;
  for (let i = 0; i < delays.length; i++) {
    const d = delays[i]!;
    if (r < d) return i;
    r -= d;
  }
  return delays.length - 1;
}
