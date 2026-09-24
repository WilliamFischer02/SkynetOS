import { describe, expect, it } from 'vitest';
import {
  OP_CLOSE,
  OP_CONT,
  OP_PING,
  OP_TEXT,
  acceptKey,
  decodeClientFrames,
  encodeClientFrame,
  encodeFrame
} from '../src/main/services/websocket.js';

describe('the handshake', () => {
  it('matches the RFC 6455 worked example', () => {
    expect(acceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });
});

describe('frames', () => {
  it('decodes masked client text at all three length encodings', () => {
    for (const size of [5, 300, 70_000]) {
      const text = 'x'.repeat(size);
      const decoded = decodeClientFrames(encodeClientFrame(OP_TEXT, Buffer.from(text)), 1_000_000);
      if ('error' in decoded) throw new Error(`error ${decoded.error}`);
      expect(decoded.frames).toHaveLength(1);
      expect(decoded.frames[0]!.payload.toString()).toBe(text);
      expect(decoded.rest.length).toBe(0);
    }
  });

  it('waits for the rest of a frame split across reads', () => {
    const whole = encodeClientFrame(OP_TEXT, Buffer.from('hello world'));
    const first = decodeClientFrames(whole.subarray(0, 7), 1000);
    if ('error' in first) throw new Error('error');
    expect(first.frames).toHaveLength(0);
    expect(first.rest.length).toBe(7);
  });

  it('refuses an unmasked client frame, and anything over the cap', () => {
    expect(decodeClientFrames(encodeFrame(OP_TEXT, Buffer.from('hi')), 1000)).toEqual({ error: 1002 });
    expect(decodeClientFrames(encodeClientFrame(OP_TEXT, Buffer.alloc(2000)), 1000)).toEqual({ error: 1009 });
  });

  it('refuses a fragmented or oversized control frame', () => {
    expect(decodeClientFrames(encodeClientFrame(OP_PING, Buffer.from('x'), undefined, false), 1000)).toEqual({ error: 1002 });
    expect(decodeClientFrames(encodeClientFrame(OP_CLOSE, Buffer.alloc(200)), 1000)).toEqual({ error: 1002 });
  });

  it('reads a fragmented message as its parts, in order', () => {
    const parts = Buffer.concat([
      encodeClientFrame(OP_TEXT, Buffer.from('hel'), undefined, false),
      encodeClientFrame(OP_CONT, Buffer.from('lo'), undefined, true)
    ]);
    const decoded = decodeClientFrames(parts, 1000);
    if ('error' in decoded) throw new Error('error');
    expect(decoded.frames.map((f) => [f.opcode, f.fin, f.payload.toString()])).toEqual([[OP_TEXT, false, 'hel'], [OP_CONT, true, 'lo']]);
  });

  it('writes server frames unmasked, with the right length header', () => {
    expect([...encodeFrame(OP_TEXT, Buffer.from('ab')).subarray(0, 2)]).toEqual([0x81, 2]);
    const mid = encodeFrame(OP_TEXT, Buffer.alloc(300));
    expect(mid[1]).toBe(126);
    expect(mid.readUInt16BE(2)).toBe(300);
    const big = encodeFrame(OP_TEXT, Buffer.alloc(70_000));
    expect(big[1]).toBe(127);
    expect(Number(big.readBigUInt64BE(2))).toBe(70_000);
  });
});
