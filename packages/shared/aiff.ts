/**
 * AIFF and WAV decoding, ours, because the profile importer has no ffmpeg and takes no dependency.
 *
 * What a voice profile needs is mono float samples and a rate; the rest of each format is chunks.
 * AIFF (FORM/AIFF) is big-endian PCM with an 80-bit extended sample rate; AIFF-C (FORM/AIFC) is the
 * same with a compression type, of which only `NONE` and `sowt` (little-endian PCM, what a Mac
 * writes) are PCM. Anything compressed is refused with a sentence, not guessed at. WAV covers PCM
 * 8/16/24/32 and float 32, plain or WAVE_FORMAT_EXTENSIBLE. Both mix to mono by averaging.
 */

export interface DecodedAudio {
  sampleRate: number;
  /** Channels in the file; `samples` is already mono. */
  channels: number;
  samples: Float32Array;
}

const ascii = (bytes: Uint8Array, offset: number, length: number): string => {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i] ?? 0);
  return out;
};

/**
 * An IEEE 754 80-bit extended float, big-endian: 1 sign bit, 15 exponent bits, a 64-bit mantissa
 * with the integer bit explicit. Sample rates are small integers, so a double holds them exactly.
 */
export function readExtended80(bytes: Uint8Array, offset: number): number {
  if (offset + 10 > bytes.length) throw new Error('AIFF COMM CHUNK IS TRUNCATED');
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 10);
  const se = view.getUint16(0, false);
  const sign = se & 0x8000 ? -1 : 1;
  const exponent = se & 0x7fff;
  const hi = view.getUint32(2, false);
  const lo = view.getUint32(6, false);
  if (exponent === 0 && hi === 0 && lo === 0) return 0;
  if (exponent === 0x7fff) throw new Error('AIFF SAMPLE RATE IS NOT A NUMBER');
  const mantissa = hi * 4294967296 + lo;
  return sign * mantissa * Math.pow(2, exponent - 16383 - 63);
}

function pcmToFloat(bytes: Uint8Array, offset: number, frames: number, channels: number, bits: number, littleEndian: boolean): Float32Array {
  const bytesPer = bits / 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(frames);
  const scale = 1 / Math.pow(2, bits - 1);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const at = offset + (f * channels + c) * bytesPer;
      let value: number;
      if (bits === 8) value = view.getInt8(at);
      else if (bits === 16) value = view.getInt16(at, littleEndian);
      else if (bits === 24) {
        const b0 = bytes[at]!;
        const b1 = bytes[at + 1]!;
        const b2 = bytes[at + 2]!;
        const raw = littleEndian ? (b2 << 16) | (b1 << 8) | b0 : (b0 << 16) | (b1 << 8) | b2;
        value = raw & 0x800000 ? raw - 0x1000000 : raw;
      } else value = view.getInt32(at, littleEndian);
      sum += value * scale;
    }
    out[f] = sum / channels;
  }
  return out;
}

export function decodeAiff(bytes: Uint8Array): DecodedAudio {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== 'FORM') throw new Error('NOT AN AIFF FILE (NO FORM HEADER)');
  const kind = ascii(bytes, 8, 4);
  if (kind !== 'AIFF' && kind !== 'AIFC') throw new Error(`NOT AN AIFF FILE (FORM TYPE "${kind}")`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let channels = 0;
  let frames = 0;
  let bits = 0;
  let rate = 0;
  let littleEndian = false;
  let haveComm = false;
  let data: { offset: number; length: number } | null = null;

  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = ascii(bytes, at, 4);
    const size = view.getUint32(at + 4, false);
    const body = at + 8;
    if (id === 'COMM') {
      if (size < 18) throw new Error('AIFF COMM CHUNK IS TOO SHORT');
      channels = view.getInt16(body, false);
      frames = view.getUint32(body + 2, false);
      bits = view.getInt16(body + 6, false);
      rate = readExtended80(bytes, body + 8);
      if (kind === 'AIFC') {
        const compression = size >= 22 ? ascii(bytes, body + 18, 4) : 'NONE';
        if (compression === 'sowt') littleEndian = true;
        else if (compression !== 'NONE') throw new Error(`AIFF-C "${compression}" IS COMPRESSED — EXPORT AS UNCOMPRESSED AIFF OR WAV`);
      }
      haveComm = true;
    } else if (id === 'SSND') {
      const offset = view.getUint32(body, false);
      data = { offset: body + 8 + offset, length: Math.max(0, Math.min(size, bytes.length - body) - 8 - offset) };
    }
    at = body + size + (size & 1);
  }
  if (!haveComm) throw new Error('AIFF FILE HAS NO COMM CHUNK');
  if (!data) throw new Error('AIFF FILE HAS NO SOUND DATA');
  if (![8, 16, 24, 32].includes(bits)) throw new Error(`AIFF SAMPLE SIZE ${bits} IS NOT SUPPORTED (8, 16, 24 OR 32)`);
  if (channels < 1 || channels > 8) throw new Error(`AIFF HAS ${channels} CHANNELS`);
  if (!(rate > 0)) throw new Error('AIFF SAMPLE RATE IS MISSING');
  const available = Math.floor(data.length / (channels * (bits / 8)));
  const count = Math.min(frames || available, available);
  return { sampleRate: Math.round(rate), channels, samples: pcmToFloat(bytes, data.offset, count, channels, bits, littleEndian) };
}

export function decodeWav(bytes: Uint8Array): DecodedAudio {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') throw new Error('NOT A WAV FILE (NO RIFF/WAVE HEADER)');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format = 0;
  let channels = 0;
  let rate = 0;
  let bits = 0;
  let data: { offset: number; length: number } | null = null;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = ascii(bytes, at, 4);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ') {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      rate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format is the first two bytes of the sub-format GUID.
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true);
    } else if (id === 'data') {
      data = { offset: body, length: Math.min(size, bytes.length - body) };
    }
    at = body + size + (size & 1);
  }
  if (!channels || !rate) throw new Error('WAV FILE HAS NO FMT CHUNK');
  if (!data) throw new Error('WAV FILE HAS NO DATA CHUNK');
  const frames = Math.floor(data.length / (channels * (bits / 8)));
  if (format === 3) {
    if (bits !== 32) throw new Error(`WAV FLOAT ${bits}-BIT IS NOT SUPPORTED`);
    const out = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      let sum = 0;
      for (let c = 0; c < channels; c++) sum += view.getFloat32(data.offset + (f * channels + c) * 4, true);
      out[f] = sum / channels;
    }
    return { sampleRate: rate, channels, samples: out };
  }
  if (format !== 1) throw new Error(`WAV FORMAT ${format} IS COMPRESSED — EXPORT AS PCM WAV`);
  if (![8, 16, 24, 32].includes(bits)) throw new Error(`WAV SAMPLE SIZE ${bits} IS NOT SUPPORTED`);
  if (bits === 8) {
    // 8-bit WAV is unsigned, unlike every other depth.
    const out = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      let sum = 0;
      for (let c = 0; c < channels; c++) sum += (bytes[data.offset + f * channels + c]! - 128) / 128;
      out[f] = sum / channels;
    }
    return { sampleRate: rate, channels, samples: out };
  }
  return { sampleRate: rate, channels, samples: pcmToFloat(bytes, data.offset, frames, channels, bits, true) };
}

/** By the file's own header, whatever its extension says. */
export function decodeAudio(bytes: Uint8Array): DecodedAudio {
  const magic = ascii(bytes, 0, 4);
  if (magic === 'FORM') return decodeAiff(bytes);
  if (magic === 'RIFF') return decodeWav(bytes);
  throw new Error('NOT AN AIFF OR WAV FILE');
}
