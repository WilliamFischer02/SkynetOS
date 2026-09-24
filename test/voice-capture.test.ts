/**
 * The post-wake sentence, on synthetic audio. The endpointer decides how long the microphone stays
 * open, so each of these is really a test of how long anything is heard at all.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_ENDPOINT, TARGET_RATE, createEndpointer, downsample, encodeWav, rms } from '@shared/voice-capture.js';
import { gaussian, mulberry32 } from '@shared/hand-synth.js';

const FRAME = DEFAULT_ENDPOINT.frameMs;

/** Frame levels for a script of [level, ms] pieces, with a little jitter so nothing is perfectly flat. */
function levels(script: [number, number][], seed = 1): number[] {
  const rng = mulberry32(seed);
  const out: number[] = [];
  for (const [level, ms] of script) {
    for (let i = 0; i < Math.round(ms / FRAME); i++) out.push(Math.max(0, level * (1 + gaussian(rng) * 0.1)));
  }
  return out;
}

const run = (frames: number[]) => {
  const endpointer = createEndpointer();
  let state = endpointer.state();
  for (const level of frames) state = endpointer.push(level);
  return { state, span: endpointer.span(), floor: endpointer.floor() };
};

const ROOM = 0.002; // a quiet room: about −54 dBFS
const VOICE = 0.08; // speech at a desk microphone

describe('a sentence after the wake phrase', () => {
  it('is found, with a little kept either side of it', () => {
    const { state, span } = run(levels([[ROOM, 400], [VOICE, 1200], [ROOM, 1000]]));
    expect(state).toBe('done');
    // Speech began at 400 ms; 250 ms of pre-roll is kept.
    expect(span!.start * FRAME).toBeGreaterThanOrEqual(100);
    expect(span!.start * FRAME).toBeLessThanOrEqual(200);
    // It ended at 1600 ms; 150 ms of post-roll.
    expect(span!.end * FRAME).toBeGreaterThanOrEqual(1700);
    expect(span!.end * FRAME).toBeLessThanOrEqual(1800);
  });

  it('is not ended by the quiet between two words', () => {
    const { state, span } = run(levels([[ROOM, 300], [VOICE, 500], [ROOM, 400], [VOICE, 600], [ROOM, 1000]]));
    expect(state).toBe('done');
    expect(span!.end * FRAME).toBeGreaterThan(1700);
  });

  it('is found even when he starts talking the instant the microphone opens', () => {
    // No quiet first 200 ms to measure the room from: the floor must not rise to meet the voice.
    const { state, floor } = run(levels([[VOICE, 1500], [ROOM, 1000]]));
    expect(state).toBe('done');
    expect(floor).toBeLessThanOrEqual(DEFAULT_ENDPOINT.maxFloor);
  });

  it('is cut off at the maximum length rather than listening for ever', () => {
    const { state, span } = run(levels([[ROOM, 300], [VOICE, 20000]]));
    expect(state).toBe('done');
    expect((span!.end - span!.start) * FRAME).toBeLessThanOrEqual(DEFAULT_ENDPOINT.maxMs + DEFAULT_ENDPOINT.preRollMs);
  });
});

describe('things that are not a sentence', () => {
  it('gives up on silence, and says so', () => {
    const { state, span } = run(levels([[ROOM, 6000]]));
    expect(state).toBe('nothing');
    expect(span).toBeNull();
  });

  it('ignores a click or a knock', () => {
    const { state } = run(levels([[ROOM, 500], [0.3, 60], [ROOM, 5000]]));
    expect(state).toBe('nothing');
  });

  it('stops deciding once it has decided', () => {
    const endpointer = createEndpointer();
    for (const level of levels([[ROOM, 5000]])) endpointer.push(level);
    expect(endpointer.push(VOICE)).toBe('nothing');
  });
});

describe('audio for whisper', () => {
  it('measures level as a fraction of full scale', () => {
    expect(rms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5, 9);
    expect(rms(new Float32Array(0))).toBe(0);
  });

  it('downsamples 48 kHz to 16 kHz, keeping length and level', () => {
    const input = new Float32Array(48000).fill(0.25);
    const out = downsample(input, 48000);
    expect(out.length).toBe(TARGET_RATE);
    expect(out[100]).toBeCloseTo(0.25, 9);
  });

  it('writes a WAV whisper can read: RIFF, 16 kHz, 16-bit, mono, and clipped rather than wrapped', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2, -2]));
    const view = new DataView(wav.buffer);
    const tag = (offset: number): string => String.fromCharCode(...wav.slice(offset, offset + 4));
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(tag(36)).toBe('data');
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(40, true)).toBe(10);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-32768);
    expect(view.getInt16(50, true)).toBe(32767);
    expect(view.getInt16(52, true)).toBe(-32768);
  });
});
