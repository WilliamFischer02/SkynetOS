import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMING,
  avatarFrameAt,
  fitScale,
  parseFrameNames,
  pngSize,
  readTiming,
  wobbleOffset
} from '../packages/shared/avatar.js';

describe('parseFrameNames', () => {
  it('sorts frames into poses, numbered frames in number order', () => {
    const set = parseFrameNames(['talk-10.png', 'idle.png', 'talk-2.png', 'blink-02.png', 'blink-01.png', 'talk-1.png', 'README.md']);
    expect(set.idle).toBe('idle.png');
    expect(set.blink).toEqual(['blink-01.png', 'blink-02.png']);
    expect(set.talk).toEqual(['talk-1.png', 'talk-2.png', 'talk-10.png']);
    expect(set.warnings).toEqual([]);
  });

  it('warns about a missing still face and misnamed files instead of failing', () => {
    const set = parseFrameNames(['mouth_open.png', 'notes.txt', 'talk-01.png']);
    expect(set.idle).toBeNull();
    expect(set.warnings[0]).toMatch(/idle\.png is missing/);
    expect(set.warnings.some((w) => w.startsWith('mouth_open.png'))).toBe(true);
    expect(set.warnings.some((w) => w.startsWith('notes.txt'))).toBe(true);
  });

  it('accepts talk01, talk_01 and TALK-01 alike', () => {
    expect(parseFrameNames(['idle.png', 'talk01.png', 'talk_02.png', 'TALK-03.PNG']).talk).toHaveLength(3);
  });
});

describe('avatarFrameAt', () => {
  const set = { idle: 'idle.png', blink: ['b1.png', 'b2.png'], talk: ['t1.png', 't2.png', 't3.png'] };

  it('cycles the mouth while speaking, at talkFps', () => {
    const frames = [0, 125, 250, 375].map((t) => avatarFrameAt(set, 'speaking', t).file);
    expect(frames).toEqual(['t1.png', 't2.png', 't3.png', 't1.png']);
  });

  it('holds the still face when idle, and blinks now and then', () => {
    const seen = new Set<string | null>();
    for (let t = 0; t < 30_000; t += 20) seen.add(avatarFrameAt(set, 'idle', t).file);
    expect(seen.has('idle.png')).toBe(true);
    expect(seen.has('b2.png')).toBe(true);
    expect(seen.has('t1.png')).toBe(false);
    // Mostly still: a blink is a few frames every few seconds.
    let blinking = 0;
    for (let t = 0; t < 30_000; t += 20) if (avatarFrameAt(set, 'idle', t).pose === 'blink') blinking++;
    expect(blinking / 1500).toBeLessThan(0.1);
  });

  it('never freezes on a missing pose', () => {
    expect(avatarFrameAt({ idle: 'idle.png', blink: [], talk: [] }, 'speaking', 500).file).toBe('idle.png');
    expect(avatarFrameAt({ idle: null, blink: [], talk: [] }, 'idle', 500).file).toBeNull();
  });

  it('is deterministic: the same moment shows the same frame', () => {
    expect(avatarFrameAt(set, 'idle', 12_345)).toEqual(avatarFrameAt(set, 'idle', 12_345));
  });
});

describe('the float', () => {
  it('moves whole pixels only, within the wobble range', () => {
    for (let t = 0; t < 5000; t += 37) {
      const y = wobbleOffset(t);
      expect(Number.isInteger(y)).toBe(true);
      expect(Math.abs(y)).toBeLessThanOrEqual(DEFAULT_TIMING.wobblePx);
    }
  });

  it('can be switched off', () => {
    expect(wobbleOffset(600, { ...DEFAULT_TIMING, wobblePx: 0 })).toBe(0);
  });
});

describe('timing and sizes', () => {
  it('reads avatar.json overrides and clamps nonsense', () => {
    const t = readTiming({ talkFps: 12, blinkEveryMs: [100, 90_000], wobblePx: 3.7, scale: 4 });
    expect(t.talkFps).toBe(12);
    expect(t.blinkEveryMs).toEqual([500, 60_000]);
    expect(t.wobblePx).toBe(4);
    expect(t.scale).toBe(4);
    expect(readTiming('garbage')).toEqual(DEFAULT_TIMING);
  });

  it('fits by whole numbers only', () => {
    expect(fitScale({ width: 64, height: 64 }, { width: 300, height: 200 })).toBe(3);
    expect(fitScale({ width: 400, height: 400 }, { width: 300, height: 200 })).toBe(1);
  });

  it('reads a PNG size from its header and refuses what is not a PNG', () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    png.set([0, 0, 0, 64], 16);
    png.set([0, 0, 0, 48], 20);
    expect(pngSize(png)).toEqual({ width: 64, height: 48 });
    expect(pngSize(new Uint8Array(24))).toBeNull();
  });
});
