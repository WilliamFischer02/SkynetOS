/**
 * The JARVIS avatar: a face that talks when JARVIS talks.
 *
 * William: "frames for face / mouth poses for an avatar for ANY Jarvis iteration whether web or
 * terminal … cycles through mouth movement frames of the face graphic when jarvis is working or
 * talking or responding, idle at a still face and blink when not talking … the head should have a
 * slight vertical wobble — a low floaty effect."
 *
 * Pure: which files in the frames folder mean what, what frame shows at a given moment, and how
 * far the head floats. The disk half is src/main/services/avatar-frames.ts; the windows and the
 * board logo build on both.
 *
 * Frames folder: assets/avatar/<name>/ (default `jarvis`). See its README.md for the rules.
 */

export const AVATAR_ROOT_REL = 'assets/avatar';
export const DEFAULT_AVATAR = 'jarvis';

export type AvatarPose = 'idle' | 'blink' | 'talk';
/** What JARVIS is doing, as far as the face is concerned. */
export type AvatarMood = 'idle' | 'speaking';

export interface AvatarFrameSet {
  /** The still face. Required: without it there is no avatar, only a warning. */
  idle: string | null;
  /** Eyes closing, in order. Played forward then back, so a blink opens again on its own. */
  blink: string[];
  /** Mouth poses, in order, cycled while JARVIS is speaking or working. */
  talk: string[];
  /** Files that were ignored, and why. Shown so a misnamed frame is not a mystery. */
  warnings: string[];
}

const FRAME = /^(idle|blink|talk)(?:[-_ ]?(\d{1,3}))?\.png$/i;

/** Sort a folder listing into the three poses. Numbered frames play in number order. */
export function parseFrameNames(files: readonly string[]): AvatarFrameSet {
  const set: AvatarFrameSet = { idle: null, blink: [], talk: [], warnings: [] };
  const numbered: Record<'blink' | 'talk', { n: number; file: string }[]> = { blink: [], talk: [] };

  for (const file of files) {
    if (/^readme\.md$/i.test(file) || /^avatar(\.example)?\.json$/i.test(file) || file.startsWith('.')) continue;
    const match = FRAME.exec(file);
    if (!match) {
      if (/\.(png|gif|jpe?g|webp|bmp)$/i.test(file)) set.warnings.push(`${file}: not a recognised name (idle.png, blink-01.png, talk-01.png)`);
      else set.warnings.push(`${file}: not a PNG frame, ignored`);
      continue;
    }
    const pose = match[1]!.toLowerCase() as AvatarPose;
    const n = match[2] ? Number.parseInt(match[2], 10) : 0;
    if (pose === 'idle') {
      if (set.idle && set.idle !== file) set.warnings.push(`${file}: a second idle frame; using ${set.idle}`);
      else set.idle = file;
    } else {
      numbered[pose].push({ n, file });
    }
  }
  for (const pose of ['blink', 'talk'] as const) {
    set[pose] = numbered[pose].sort((a, b) => a.n - b.n || a.file.localeCompare(b.file)).map((f) => f.file);
  }
  if (!set.idle) set.warnings.unshift('idle.png is missing: the avatar needs a still face to show');
  return set;
}

export interface AvatarTiming {
  /** Mouth frames per second while speaking. */
  talkFps: number;
  /** A blink comes every this many ms, picked between the two for each blink so it never ticks like a clock. */
  blinkEveryMs: [number, number];
  /** How long each blink frame is held. */
  blinkFrameMs: number;
  /** How far the head floats up and down, in the frame's own pixels. Whole pixels only. */
  wobblePx: number;
  /** One full float, down and back up. */
  wobblePeriodMs: number;
  /** Window scale. 0 means the largest whole number that fits the default window. */
  scale: number;
}

export const DEFAULT_TIMING: AvatarTiming = {
  talkFps: 8,
  blinkEveryMs: [2500, 6000],
  blinkFrameMs: 60,
  wobblePx: 2,
  wobblePeriodMs: 2400,
  scale: 0
};

const clamp = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/** An `avatar.json` beside the frames overrides the defaults. Anything missing or silly falls back. */
export function readTiming(raw: unknown): AvatarTiming {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const every = Array.isArray(o['blinkEveryMs']) ? o['blinkEveryMs'] : [];
  const lo = clamp(every[0], 500, 60_000, DEFAULT_TIMING.blinkEveryMs[0]);
  const hi = clamp(every[1], lo, 60_000, Math.max(lo, DEFAULT_TIMING.blinkEveryMs[1]));
  return {
    talkFps: clamp(o['talkFps'], 1, 30, DEFAULT_TIMING.talkFps),
    blinkEveryMs: [lo, hi],
    blinkFrameMs: clamp(o['blinkFrameMs'], 16, 500, DEFAULT_TIMING.blinkFrameMs),
    wobblePx: Math.round(clamp(o['wobblePx'], 0, 16, DEFAULT_TIMING.wobblePx)),
    wobblePeriodMs: clamp(o['wobblePeriodMs'], 400, 20_000, DEFAULT_TIMING.wobblePeriodMs),
    scale: Math.round(clamp(o['scale'], 0, 16, DEFAULT_TIMING.scale))
  };
}

/** A small deterministic hash, so blink spacing is irregular but the same every run. */
function hash(n: number): number {
  let x = (n + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** The blink frames as played: closing, then opening again (without repeating the fully closed frame). */
function blinkSequence(blink: readonly string[]): string[] {
  if (blink.length <= 1) return [...blink];
  return [...blink, ...blink.slice(0, -1).reverse()];
}

/**
 * The frame to show at time `t` (ms, any monotonic clock).
 *
 * Speaking cycles the mouth. Idle holds the still face and blinks now and then. With no talk
 * frames a speaking face still blinks rather than freezing, and with no blink frames an idle face
 * simply holds. A missing pose never breaks the avatar.
 */
export function avatarFrameAt(
  set: Pick<AvatarFrameSet, 'idle' | 'blink' | 'talk'>,
  mood: AvatarMood,
  t: number,
  timing: AvatarTiming = DEFAULT_TIMING
): { file: string | null; pose: AvatarPose } {
  if (mood === 'speaking' && set.talk.length) {
    const i = Math.floor((t / 1000) * timing.talkFps) % set.talk.length;
    return { file: set.talk[i]!, pose: 'talk' };
  }

  const sequence = blinkSequence(set.blink);
  if (sequence.length) {
    // Walk blink slots: each has its own irregular gap, then the blink itself.
    const [lo, hi] = timing.blinkEveryMs;
    const blinkMs = sequence.length * timing.blinkFrameMs;
    let start = 0;
    for (let k = 0; k < 100_000; k++) {
      const gap = lo + hash(k) * (hi - lo);
      const blinkAt = start + gap;
      if (t < blinkAt) break;
      if (t < blinkAt + blinkMs) {
        const i = Math.min(sequence.length - 1, Math.floor((t - blinkAt) / timing.blinkFrameMs));
        return { file: sequence[i]!, pose: 'blink' };
      }
      start = blinkAt + blinkMs;
    }
  }
  return { file: set.idle, pose: 'idle' };
}

/**
 * The float: a whole-pixel vertical offset, stepping through a sine. Rounded, so the head moves a
 * pixel at a time and holds between steps, never sitting on a fraction (docs/02).
 */
export function wobbleOffset(t: number, timing: AvatarTiming = DEFAULT_TIMING): number {
  if (timing.wobblePx <= 0) return 0;
  const phase = (t % timing.wobblePeriodMs) / timing.wobblePeriodMs;
  return Math.round(Math.sin(phase * Math.PI * 2) * timing.wobblePx);
}

/** The largest whole-number scale at which a frame fits a box. At least 1. */
export function fitScale(frame: { width: number; height: number }, box: { width: number; height: number }): number {
  if (frame.width <= 0 || frame.height <= 0) return 1;
  return Math.max(1, Math.floor(Math.min(box.width / frame.width, box.height / frame.height)));
}

/**
 * How the animated face fills a node's logo box (`logoSource: avatar-live`).
 *
 * The box always leaves room for the float above and below, so the head never leaves its box as it
 * bobs. A box that can hold at least one whole frame takes it at the largest whole-number scale
 * that fits, exactly as the face window does: `integer: true`, `ratio` is that scale, `divisor` 1.
 * A smaller box cannot hold the art at any whole scale, so it takes every Nth pixel, the smallest
 * whole `divisor` that fits: `integer: false`, `ratio` 1/N. An exact decimation, like the overview
 * zooms (docs/02 rule 4): nearest-neighbour, no colour invented. Never a smoothed fraction.
 *
 * The float is `Math.round(wobbleOffset(t) * ratio)` world pixels, so it stays a whole pixel.
 */
export function liveLogoLayout(
  frame: { width: number; height: number },
  box: { width: number; height: number },
  wobblePx: number
): { integer: boolean; ratio: number; divisor: number; width: number; height: number } {
  if (frame.width <= 0 || frame.height <= 0 || box.width <= 0 || box.height <= 0) {
    return { integer: false, ratio: 0, divisor: 0, width: 0, height: 0 };
  }
  const float = Math.max(0, wobblePx);
  const fit = Math.min(box.width / frame.width, box.height / (frame.height + 2 * float));
  const whole = Math.floor(fit);
  if (whole >= 1) {
    return { integer: true, ratio: whole, divisor: 1, width: frame.width * whole, height: frame.height * whole };
  }
  const divisor = Math.max(2, Math.ceil(Math.max(frame.width / box.width, (frame.height + 2 * float) / box.height)));
  return {
    integer: false,
    ratio: 1 / divisor,
    divisor,
    width: Math.max(1, Math.floor(frame.width / divisor)),
    height: Math.max(1, Math.floor(frame.height / divisor))
  };
}

/**
 * A frames folder as the windows and the board receive it: frames as data URLs, validated.
 * Built by src/main/services/avatar-frames.ts; crosses IPC on `avatar:frames`.
 */
export interface AvatarPayload {
  name: string;
  /** Absolute folder, forward slashes. */
  dir: string;
  ok: boolean;
  /** Frame size in pixels; every frame must match the still face. */
  width: number;
  height: number;
  idle: string | null;
  blink: string[];
  talk: string[];
  timing: AvatarTiming;
  warnings: string[];
}

/** Width and height from a PNG's IHDR chunk, or null when it is not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return null;
  const u32 = (o: number): number => ((bytes[o]! << 24) | (bytes[o + 1]! << 16) | (bytes[o + 2]! << 8) | bytes[o + 3]!) >>> 0;
  return { width: u32(16), height: u32(20) };
}
