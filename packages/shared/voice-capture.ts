/**
 * One spoken sentence, from the moment the microphone opens to a WAV file whisper can read.
 *
 * This is the part of voice control that runs AFTER the wake phrase, inside the small hidden voice
 * window (src/renderer/voice.ts). It has three jobs, and each is pure so it can be tested on
 * synthetic audio rather than on anybody's room:
 *
 *  1. ENDPOINTING — deciding when the sentence started and when it finished, from the loudness of
 *     each 20 ms frame. The microphone is closed the moment the sentence ends, so this decides how
 *     long anything is heard at all.
 *  2. RESAMPLING — Chromium captures at 48 kHz; whisper wants 16 kHz.
 *  3. ENCODING — 16-bit mono PCM in a WAV container, which whisper-server reads without ffmpeg.
 *
 * ── Why endpointing is done here and not by whisper ──────────────────────────────────────────
 *
 * Because what is not recorded cannot be transcribed, stored or sent. The standing rule for voice is
 * "nothing captured before the wake word" (docs/07-SECURITY.md, Voice); the corollary this file keeps
 * is that nothing is kept after the sentence either. The window opens the microphone when the wake
 * phrase fires, this decides the sentence is over, and the stream is stopped — so a room that keeps
 * talking after "Hey JARVIS, zoom in" is not being listened to.
 *
 * ── How the decision is made ─────────────────────────────────────────────────────────────────
 *
 * The first 200 ms after the microphone opens set the room's NOISE FLOOR. Not its mean: people often
 * start talking straight after the wake phrase, and a mean taken over the first syllable would call
 * speech "quiet". The 20th percentile of those frames is the floor, capped so that even a sentence
 * spoken from the first instant cannot lift it into speech levels. Speech starts when frames stay
 * above three times that floor for 120 ms — long enough that a keyboard click is not a sentence —
 * and ends after 700 ms below 60% of the threshold. The gap between the two is hysteresis, so the
 * quiet between two words does not end the sentence.
 *
 * All time is counted in frames rather than read from a clock, so every test is exact and a slow
 * machine cannot change what was decided.
 */

/** whisper.cpp's input rate. */
export const TARGET_RATE = 16000;

export interface EndpointConfig {
  /** Loudness is measured over frames of this length, ms. */
  frameMs: number;
  /** The first this-many ms after opening set the noise floor. */
  calibrateMs: number;
  /** Speech is a frame this many times louder than the floor. */
  startRatio: number;
  /** …and never quieter than this, RMS of full scale, however quiet the room. About −48 dBFS. */
  minLevel: number;
  /** The highest the noise floor may be set, however loud the first 200 ms were. About −34 dBFS. */
  maxFloor: number;
  /** Speech must hold this long to count, ms. A click or a knock is shorter. */
  minSpeechMs: number;
  /** This much quiet after speech ends the sentence, ms. */
  endSilenceMs: number;
  /** Below this fraction of the start threshold counts as quiet. The gap is the hysteresis. */
  endRatio: number;
  /** Nobody spoke within this long of the microphone opening: give up, ms. */
  noSpeechMs: number;
  /** A sentence longer than this is cut off, ms. */
  maxMs: number;
  /** Kept before the detected start, so the first consonant is not clipped, ms. */
  preRollMs: number;
  /** Kept after the detected end, so the last one is not either, ms. */
  postRollMs: number;
}

export const DEFAULT_ENDPOINT: EndpointConfig = {
  frameMs: 20,
  calibrateMs: 200,
  startRatio: 3,
  minLevel: 0.004,
  maxFloor: 0.02,
  minSpeechMs: 120,
  endSilenceMs: 700,
  endRatio: 0.6,
  noSpeechMs: 4000,
  maxMs: 8000,
  preRollMs: 250,
  postRollMs: 150
};

export type EndpointState = 'calibrating' | 'waiting' | 'speaking' | 'done' | 'nothing';

export interface Endpointer {
  /** One frame's RMS level. Returns the state after it. Frames after `done` or `nothing` are ignored. */
  push(level: number): EndpointState;
  state(): EndpointState;
  /** Frames to keep, [start, end), once the sentence is done. */
  span(): { start: number; end: number } | null;
  /** The noise floor that was measured, for the record. */
  floor(): number;
}

export function createEndpointer(config: EndpointConfig = DEFAULT_ENDPOINT): Endpointer {
  const frames = (ms: number): number => Math.max(1, Math.round(ms / config.frameMs));
  const calibrateFrames = frames(config.calibrateMs);
  const minSpeechFrames = frames(config.minSpeechMs);
  const endSilenceFrames = frames(config.endSilenceMs);
  const noSpeechFrames = frames(config.noSpeechMs);
  const maxFrames = frames(config.maxMs);
  const preRoll = Math.round(config.preRollMs / config.frameMs);
  const postRoll = Math.round(config.postRollMs / config.frameMs);

  const calibration: number[] = [];
  let state: EndpointState = 'calibrating';
  let index = -1;
  let noise = 0;
  let threshold = config.minLevel;
  let loudRun = 0;
  let quietRun = 0;
  let start = -1;
  let end = -1;

  const setFloor = (): void => {
    const sorted = [...calibration].sort((a, b) => a - b);
    const low = sorted[Math.floor((sorted.length - 1) * 0.2)] ?? 0;
    noise = Math.min(config.maxFloor, low);
    threshold = Math.max(config.minLevel, noise * config.startRatio);
  };

  return {
    push(level) {
      if (state === 'done' || state === 'nothing') return state;
      index++;
      const value = Number.isFinite(level) && level > 0 ? level : 0;

      if (state === 'calibrating') {
        calibration.push(value);
        if (calibration.length < calibrateFrames) return state;
        setFloor();
        state = 'waiting';
        // The calibration frames may already hold the start of a sentence: count them.
        let run = 0;
        for (const frame of calibration) run = frame >= threshold ? run + 1 : 0;
        loudRun = run;
        if (loudRun >= minSpeechFrames) {
          state = 'speaking';
          start = Math.max(0, index - loudRun + 1 - preRoll);
        }
        return state;
      }

      if (state === 'waiting') {
        loudRun = value >= threshold ? loudRun + 1 : 0;
        if (loudRun >= minSpeechFrames) {
          state = 'speaking';
          start = Math.max(0, index - loudRun + 1 - preRoll);
          quietRun = 0;
        } else if (index + 1 >= noSpeechFrames) {
          state = 'nothing';
        }
        return state;
      }

      // speaking
      quietRun = value < threshold * config.endRatio ? quietRun + 1 : 0;
      if (quietRun >= endSilenceFrames) {
        state = 'done';
        end = index - quietRun + 1 + postRoll;
      } else if (index - start + 1 >= maxFrames) {
        state = 'done';
        end = index + 1;
      }
      return state;
    },
    state: () => state,
    span: () => (state === 'done' ? { start, end: Math.max(start + 1, end) } : null),
    floor: () => noise
  };
}

/** Root-mean-square level of one frame, as a fraction of full scale. */
export function rms(frame: Float32Array): number {
  if (!frame.length) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i]! * frame[i]!;
  return Math.sqrt(sum / frame.length);
}

/**
 * To 16 kHz by averaging each output sample's share of the input.
 *
 * A boxcar is a crude low-pass, and crude is enough: whisper was trained on audio far rougher than a
 * USB interface produces, and the alternative is a filter design this file does not need.
 */
export function downsample(input: Float32Array, fromRate: number, toRate = TARGET_RATE): Float32Array {
  if (fromRate === toRate) return input.slice();
  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const from = Math.floor(i * ratio);
    const to = Math.min(input.length, Math.max(from + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let k = from; k < to; k++) sum += input[k]!;
    out[i] = sum / (to - from);
  }
  return out;
}

/** 16-bit mono PCM WAV. Samples outside [-1, 1] are clipped rather than wrapped. */
export function encodeWav(samples: Float32Array, rate = TARGET_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const clipped = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, Math.round(clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff), true);
  }
  return bytes;
}
