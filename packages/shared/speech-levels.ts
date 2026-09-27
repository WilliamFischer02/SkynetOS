/**
 * Audio levels for the hologram: eight frequency bands and a loudness, thirty times a second.
 *
 * William, 2026-09-26: the globe should be audio-reactive, "frequency range detection converted
 * into horizontal distortion and volume detection to influence vertical distortion". So a spoken
 * line is analysed BEFORE it plays (the synthesis server hands main a WAV first) into a timeline
 * of `AudioLevels`, and main streams the timeline by wall clock while the sidecar plays the file.
 * The microphone side is the capture window's AnalyserNode, reduced to the same shape.
 *
 * Pure: a radix-2 FFT and a log-spaced band sum. No audio leaves the machine and nothing is
 * stored; a timeline lives in memory for the length of one line.
 */

export const LEVEL_BANDS = 8;
export const LEVEL_HOP_MS = 33;
export const LEVEL_FFT = 512;

export interface AudioLevels {
  /** ms from the start of the line (a timeline), or a wall-clock ms for live microphone levels. */
  t: number;
  /** `LEVEL_BANDS` values 0..1, low to high frequency. */
  bands: number[];
  /** 0..1 loudness. */
  rms: number;
}

/** Band edges in Hz, log-spaced from speech's floor to its sibilance; the last band runs to Nyquist. */
export const BAND_EDGES_HZ = [80, 160, 320, 640, 1280, 2560, 5120, 8000] as const;

/** In-place iterative radix-2 FFT on interleaved real/imag arrays. `n` must be a power of two. */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error('FFT SIZE MUST BE A POWER OF TWO');
  // Bit reversal.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!; re[i] = re[j]!; re[j] = tr;
      const ti = im[i]!; im[i] = im[j]!; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b]! * cr - im[b]! * ci;
        const xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr; im[b] = im[a]! - xi;
        re[a] = re[a]! + xr; im[a] = im[a]! + xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Which band a frequency falls in, 0..LEVEL_BANDS-1; below the floor counts as band 0. */
export function bandOf(hz: number): number {
  for (let b = 0; b < BAND_EDGES_HZ.length - 1; b++) if (hz < BAND_EDGES_HZ[b + 1]!) return b;
  return LEVEL_BANDS - 1;
}

/**
 * One frame of levels from `LEVEL_FFT` samples: band energies (root of the mean power per band,
 * so a band with more bins is not louder for it) and the frame's rms. Raw magnitudes; callers
 * normalise across the line (`normaliseTimeline`) or against a running peak (microphone).
 */
export function analyseFrame(samples: Float32Array, sampleRate: number): { bands: number[]; rms: number } {
  const n = LEVEL_FFT;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const s = samples[i] ?? 0;
    // Hann window, so a band does not leak into its neighbours.
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    re[i] = s * w;
    sq += s * s;
  }
  fft(re, im);
  const power = new Array<number>(LEVEL_BANDS).fill(0);
  const count = new Array<number>(LEVEL_BANDS).fill(0);
  const binHz = sampleRate / n;
  for (let k = 1; k < n / 2; k++) {
    const hz = k * binHz;
    if (hz < BAND_EDGES_HZ[0]!) continue;
    const b = bandOf(hz);
    power[b] = power[b]! + re[k]! * re[k]! + im[k]! * im[k]!;
    count[b] = count[b]! + 1;
  }
  const bands = power.map((p, b) => (count[b]! > 0 ? Math.sqrt(p / count[b]!) : 0));
  return { bands, rms: Math.sqrt(sq / n) };
}

/** Levels every `hopMs` across a mono clip, unnormalised. Synchronous; use `timelineChunked` in main. */
export function analyseTimeline(samples: Float32Array, sampleRate: number, hopMs = LEVEL_HOP_MS): AudioLevels[] {
  const hop = Math.max(1, Math.round((sampleRate * hopMs) / 1000));
  const out: AudioLevels[] = [];
  for (let start = 0, i = 0; start < samples.length; start += hop, i++) {
    const frame = samples.subarray(start, start + LEVEL_FFT);
    const { bands, rms } = analyseFrame(frame, sampleRate);
    out.push({ t: Math.round(i * hopMs), bands, rms });
  }
  return out;
}

/**
 * Scale a timeline so its loudest frame is 1 and each band's loudest moment is 1, with a soft
 * knee so quiet consonants still move something. A silent clip stays all zeros.
 */
export function normaliseTimeline(timeline: AudioLevels[]): AudioLevels[] {
  let peakRms = 0;
  const peakBand = new Array<number>(LEVEL_BANDS).fill(0);
  for (const f of timeline) {
    peakRms = Math.max(peakRms, f.rms);
    for (let b = 0; b < LEVEL_BANDS; b++) peakBand[b] = Math.max(peakBand[b]!, f.bands[b] ?? 0);
  }
  const knee = (v: number): number => Math.min(1, Math.pow(Math.max(0, v), 0.6));
  return timeline.map((f) => ({
    t: f.t,
    rms: peakRms > 0 ? knee(f.rms / peakRms) : 0,
    bands: f.bands.map((v, b) => (peakBand[b]! > 0 ? knee(v / peakBand[b]!) : 0))
  }));
}

/** The frame that applies at `atMs` into the line, or null once the timeline is spent. */
export function levelsAt(timeline: readonly AudioLevels[], atMs: number): AudioLevels | null {
  if (!timeline.length) return null;
  const last = timeline[timeline.length - 1]!;
  if (atMs > last.t + LEVEL_HOP_MS) return null;
  // Timelines are evenly spaced; index directly, clamped.
  const i = Math.max(0, Math.min(timeline.length - 1, Math.floor(atMs / LEVEL_HOP_MS)));
  return timeline[i]!;
}

/**
 * Windows' voice reports word boundaries, not audio, so its levels are synthesised: an attack at
 * every word that decays between them, spread over the bands in a fixed vowel-ish shape nudged by
 * the word's position so consecutive words differ. Deterministic for a given word index.
 */
export function syntheticLevels(level: number, wordIndex: number): number[] {
  const shape = [0.55, 0.9, 1, 0.8, 0.6, 0.45, 0.35, 0.25];
  return shape.map((s, b) => {
    const wobble = 0.15 * Math.sin(wordIndex * 1.7 + b * 2.3);
    return Math.max(0, Math.min(1, level * (s + wobble)));
  });
}

/** Exponential smoothing per band: fast up, slow down, so a burst registers and a gap does not snap. */
export function smoothBands(previous: readonly number[], target: readonly number[], dtMs: number, attackMs = 40, releaseMs = 250): number[] {
  const out = new Array<number>(LEVEL_BANDS);
  for (let b = 0; b < LEVEL_BANDS; b++) {
    const p = Number.isFinite(previous[b]) ? previous[b]! : 0;
    const g = Number.isFinite(target[b]) ? Math.min(1, Math.max(0, target[b]!)) : 0;
    const tau = g > p ? attackMs : releaseMs;
    const k = tau > 0 && dtMs > 0 ? 1 - Math.exp(-dtMs / tau) : 1;
    out[b] = p + (g - p) * k;
  }
  return out;
}

export const SILENT_BANDS: readonly number[] = Object.freeze(new Array<number>(LEVEL_BANDS).fill(0));
