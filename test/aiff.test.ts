import { describe, expect, it } from 'vitest';
import { decodeAiff, decodeAudio, decodeWav, readExtended80 } from '../packages/shared/aiff.js';

/* ── builders: the files are made here, from known samples, and decoded back ── */

function extended80(rate: number): Uint8Array {
  // rate = mantissa * 2^(exp - 16383 - 63), mantissa normalised with the top bit set.
  const out = new Uint8Array(10);
  if (rate === 0) return out;
  let exponent = 16383 + 63;
  let m = rate;
  while (m >= Math.pow(2, 64)) { m /= 2; exponent++; }
  while (m < Math.pow(2, 63)) { m *= 2; exponent--; }
  const view = new DataView(out.buffer);
  view.setUint16(0, exponent, false);
  view.setUint32(2, Math.floor(m / 4294967296), false);
  view.setUint32(6, m % 4294967296, false);
  return out;
}

function chunk(id: string, body: Uint8Array, bigEndian: boolean): Uint8Array {
  const out = new Uint8Array(8 + body.length + (body.length & 1));
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, body.length, !bigEndian);
  out.set(body, 8);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function pcm(frames: number[][], bits: number, littleEndian: boolean): Uint8Array {
  const bytesPer = bits / 8;
  const channels = frames[0]!.length;
  const out = new Uint8Array(frames.length * channels * bytesPer);
  const view = new DataView(out.buffer);
  let at = 0;
  const top = Math.pow(2, bits - 1);
  for (const frame of frames) {
    for (const value of frame) {
      // A file can hold at most 2^(bits-1)-1, so full scale clips, exactly as a recorder would.
      const int = Math.max(-top, Math.min(top - 1, Math.round(value * top)));
      if (bits === 8) view.setInt8(at, int);
      else if (bits === 16) view.setInt16(at, int, littleEndian);
      else if (bits === 24) {
        const raw = int < 0 ? int + 0x1000000 : int;
        const b = [(raw >> 16) & 0xff, (raw >> 8) & 0xff, raw & 0xff];
        if (littleEndian) b.reverse();
        out.set(b, at);
      } else view.setInt32(at, int, littleEndian);
      at += bytesPer;
    }
  }
  return out;
}

function aiff(frames: number[][], rate: number, bits: number, opts: { aifc?: 'NONE' | 'sowt' | 'ima4' } = {}): Uint8Array {
  const channels = frames[0]!.length;
  const comm = new Uint8Array(opts.aifc ? 24 : 18);
  const cv = new DataView(comm.buffer);
  cv.setInt16(0, channels, false);
  cv.setUint32(2, frames.length, false);
  cv.setInt16(6, bits, false);
  comm.set(extended80(rate), 8);
  if (opts.aifc) { for (let i = 0; i < 4; i++) comm[18 + i] = opts.aifc.charCodeAt(i); comm[22] = 0; comm[23] = 0; }
  const ssnd = concat([new Uint8Array(8), pcm(frames, bits, opts.aifc === 'sowt')]);
  const body = concat([chunk('COMM', comm, true), chunk('SSND', ssnd, true)]);
  const form = new Uint8Array(12);
  for (let i = 0; i < 4; i++) { form[i] = 'FORM'.charCodeAt(i); form[8 + i] = (opts.aifc ? 'AIFC' : 'AIFF').charCodeAt(i); }
  new DataView(form.buffer).setUint32(4, 4 + body.length, false);
  return concat([form, body]);
}

function wav(frames: number[][], rate: number, bits: number, float = false): Uint8Array {
  const channels = frames[0]!.length;
  const fmt = new Uint8Array(16);
  const fv = new DataView(fmt.buffer);
  fv.setUint16(0, float ? 3 : 1, true);
  fv.setUint16(2, channels, true);
  fv.setUint32(4, rate, true);
  fv.setUint32(8, rate * channels * (bits / 8), true);
  fv.setUint16(12, channels * (bits / 8), true);
  fv.setUint16(14, bits, true);
  let data: Uint8Array;
  if (float) {
    data = new Uint8Array(frames.length * channels * 4);
    const dv = new DataView(data.buffer);
    let at = 0;
    for (const frame of frames) for (const v of frame) { dv.setFloat32(at, v, true); at += 4; }
  } else if (bits === 8) {
    data = new Uint8Array(frames.flat().map((v) => Math.round(v * 128) + 128));
  } else data = pcm(frames, bits, true);
  const body = concat([chunk('fmt ', fmt, false), chunk('data', data, false)]);
  const riff = new Uint8Array(12);
  for (let i = 0; i < 4; i++) { riff[i] = 'RIFF'.charCodeAt(i); riff[8 + i] = 'WAVE'.charCodeAt(i); }
  new DataView(riff.buffer).setUint32(4, 4 + body.length, true);
  return concat([riff, body]);
}

// Nothing at exactly +1: a PCM file cannot hold it, and the builder clips it to 1 - 2^(1-bits).
const MONO = [[0], [0.5], [-0.5], [0.25], [-1], [0.75]];
const STEREO = [[0.5, -0.5], [0.875, 0], [-0.25, 0.75]];

function close(a: Float32Array, expected: number[], tolerance = 1e-4): void {
  expect(a.length).toBe(expected.length);
  for (let i = 0; i < a.length; i++) expect(Math.abs(a[i]! - expected[i]!)).toBeLessThan(tolerance);
}

describe('readExtended80', () => {
  it('reads the sample rates a recorder writes', () => {
    for (const rate of [44100, 48000, 96000, 22050, 16000, 8000, 192000]) {
      expect(readExtended80(extended80(rate), 0)).toBe(rate);
    }
  });
  it('reads zero, and refuses a NaN', () => {
    expect(readExtended80(new Uint8Array(10), 0)).toBe(0);
    const nan = new Uint8Array(10); nan[0] = 0x7f; nan[1] = 0xff;
    expect(() => readExtended80(nan, 0)).toThrow(/NOT A NUMBER/);
  });
});

describe('decodeAiff', () => {
  it('decodes 16-bit mono at 44.1 kHz back to the samples', () => {
    const d = decodeAiff(aiff(MONO, 44100, 16));
    expect(d.sampleRate).toBe(44100);
    expect(d.channels).toBe(1);
    close(d.samples, MONO.flat());
  });
  it('decodes 8, 24 and 32-bit', () => {
    for (const bits of [8, 24, 32]) close(decodeAiff(aiff(MONO, 48000, bits)).samples, MONO.flat(), bits === 8 ? 1e-2 : 1e-4);
  });
  it('mixes stereo down to mono by averaging', () => {
    const d = decodeAiff(aiff(STEREO, 48000, 16));
    expect(d.channels).toBe(2);
    close(d.samples, STEREO.map(([l, r]) => (l! + r!) / 2));
  });
  it('accepts AIFF-C NONE and sowt (little-endian PCM)', () => {
    close(decodeAiff(aiff(MONO, 96000, 16, { aifc: 'NONE' })).samples, MONO.flat());
    close(decodeAiff(aiff(MONO, 96000, 16, { aifc: 'sowt' })).samples, MONO.flat());
  });
  it('refuses a compressed AIFF-C with the sentence', () => {
    expect(() => decodeAiff(aiff(MONO, 44100, 16, { aifc: 'ima4' }))).toThrow(/AIFF-C "ima4" IS COMPRESSED — EXPORT AS UNCOMPRESSED AIFF OR WAV/);
  });
  it('refuses what is not an AIFF, and a file with no sound', () => {
    expect(() => decodeAiff(new Uint8Array(20))).toThrow(/NOT AN AIFF/);
    const noSound = aiff(MONO, 44100, 16).subarray(0, 12 + 8 + 18);
    expect(() => decodeAiff(noSound)).toThrow(/NO SOUND DATA/);
  });
});

describe('decodeWav', () => {
  it('decodes PCM 16, 24, 32 and 8-bit unsigned', () => {
    for (const bits of [16, 24, 32]) close(decodeWav(wav(MONO, 16000, bits)).samples, MONO.flat());
    close(decodeWav(wav(MONO, 16000, 8)).samples, MONO.flat(), 1e-2);
  });
  it('decodes float 32 and mixes stereo', () => {
    close(decodeWav(wav(MONO, 22050, 32, true)).samples, MONO.flat());
    close(decodeWav(wav(STEREO, 22050, 16)).samples, STEREO.map(([l, r]) => (l! + r!) / 2));
  });
  it('refuses a compressed WAV', () => {
    const bad = wav(MONO, 8000, 16);
    bad[20] = 0x55; // format 0x55, MP3
    expect(() => decodeWav(bad)).toThrow(/COMPRESSED/);
  });
});

describe('decodeAudio', () => {
  it('goes by the header, not the extension', () => {
    expect(decodeAudio(aiff(MONO, 44100, 16)).sampleRate).toBe(44100);
    expect(decodeAudio(wav(MONO, 16000, 16)).sampleRate).toBe(16000);
    expect(() => decodeAudio(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toThrow(/NOT AN AIFF OR WAV/);
  });
});
