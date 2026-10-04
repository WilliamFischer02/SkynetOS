import { describe, expect, it } from 'vitest';
import {
  applyScanlines,
  captionFor,
  flickerAt,
  HOLOGRAM_FAULT_PALETTE,
  HOLOGRAM_PALETTE,
  moodFrom,
  paletteFor,
  renderSphere,
  smoothLevel,
  SPHERE_SIZE,
  type SphereFrame
} from '../packages/shared/hologram.js';

const frame = (over: Partial<SphereFrame> = {}): SphereFrame => ({ size: SPHERE_SIZE, t: 1234, mood: 'idle', level: 0, reducedMotion: false, flicker: false, ...over });
const lit = (px: Uint8Array): number => px.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);
const sum = (px: Uint8Array): number => px.reduce((n, v) => n + v, 0);

describe('moodFrom: which stream wins', () => {
  it('a fault beats everything, acting beats speech, speech beats listening', () => {
    expect(moodFrom('unavailable', { speaking: true }, { busy: true })).toBe('fault');
    expect(moodFrom('listening', { speaking: true }, { busy: true })).toBe('acting');
    expect(moodFrom('listening', { speaking: true }, { busy: false })).toBe('speaking');
    expect(moodFrom('listening', { speaking: false }, null)).toBe('listening');
  });

  it('voice phases fill in the rest, and off with nothing else is off', () => {
    expect(moodFrom('thinking', null, null)).toBe('thinking');
    expect(moodFrom('starting', null, null)).toBe('thinking');
    expect(moodFrom('waiting', null, null)).toBe('idle');
    expect(moodFrom('off', null, null)).toBe('off');
    expect(moodFrom('off', { speaking: true }, null)).toBe('speaking');
  });
});

describe('smoothLevel', () => {
  it('rises quickly and falls slowly', () => {
    const up = smoothLevel(0, 1, 60);
    const down = smoothLevel(1, 0, 60);
    expect(up).toBeGreaterThan(0.6);
    expect(1 - down).toBeLessThan(0.3);
  });

  it('never leaves 0..1 and treats bad input as silence', () => {
    expect(smoothLevel(0.5, 7, 1000)).toBeLessThanOrEqual(1);
    expect(smoothLevel(Number.NaN, Number.NaN, 100)).toBe(0);
    expect(smoothLevel(0.5, 0.5, -5)).toBe(0.5);
  });
});

describe('captionFor', () => {
  it('follows the mood and hides words in stream mode', () => {
    expect(captionFor({ mood: 'idle', voice: 'waiting', wakeWord: 'jarvis' })).toBe('READY — SAY JARVIS');
    expect(captionFor({ mood: 'idle', voice: 'waiting', heard: 'open firefox on two' })).toBe('OPEN FIREFOX ON TWO');
    expect(captionFor({ mood: 'idle', voice: 'waiting', heard: 'open firefox on two', streamMode: true })).toBe('READY — SAY JARVIS');
    expect(captionFor({ mood: 'fault', voice: 'unavailable', voiceError: 'whisper-server is not installed' })).toBe('WHISPER-SERVER IS NOT INSTALLED');
    expect(captionFor({ mood: 'acting', voice: 'waiting', desktop: { busy: true, index: 1, total: 3, message: 'placing Firefox' } })).toBe('STEP 2 OF 3 — PLACING FIREFOX');
    expect(captionFor({ mood: 'speaking', voice: 'off', speech: { speaking: true, text: 'Done, sir.' } })).toBe('DONE, SIR.');
    expect(captionFor({ mood: 'off', voice: 'off' })).toBe('MICROPHONE OFF — TYPE A COMMAND BELOW');
  });
});

describe('renderSphere', () => {
  it('uses only palette indices, and both palettes are the same length', () => {
    for (const mood of ['off', 'idle', 'listening', 'thinking', 'speaking', 'acting', 'fault'] as const) {
      const px = renderSphere(frame({ mood, level: 0.7 }));
      expect(px.length).toBe(SPHERE_SIZE * SPHERE_SIZE);
      for (const v of px) expect(v).toBeLessThan(HOLOGRAM_PALETTE.length);
    }
    expect(HOLOGRAM_FAULT_PALETTE.length).toBe(HOLOGRAM_PALETTE.length);
    expect(paletteFor('fault')).toBe(HOLOGRAM_FAULT_PALETTE);
    expect(paletteFor('idle')).toBe(HOLOGRAM_PALETTE);
  });

  it('lights the centre, leaves the corners empty, and is dimmer when off', () => {
    const idle = renderSphere(frame());
    const off = renderSphere(frame({ mood: 'off' }));
    const c = Math.floor(SPHERE_SIZE / 2);
    expect(idle[c * SPHERE_SIZE + c]).toBeGreaterThan(0);
    expect(idle[0]).toBe(0);
    expect(idle[SPHERE_SIZE - 1]).toBe(0);
    expect(sum(off)).toBeLessThan(sum(idle));
  });

  it('swells with the speech level and rings out while listening', () => {
    const quiet = renderSphere(frame({ mood: 'speaking', level: 0 }));
    const loud = renderSphere(frame({ mood: 'speaking', level: 1 }));
    expect(lit(loud)).toBeGreaterThan(lit(quiet));
    const listening = renderSphere(frame({ mood: 'listening', t: 400 }));
    expect(lit(listening)).toBeGreaterThan(lit(renderSphere(frame({ mood: 'idle', t: 400 }))));
  });

  it('holds still on a fault and under reduced motion, and breathes otherwise', () => {
    expect(renderSphere(frame({ mood: 'fault', t: 0 }))).toEqual(renderSphere(frame({ mood: 'fault', t: 5000 })));
    expect(renderSphere(frame({ mood: 'thinking', t: 0, reducedMotion: true }))).toEqual(renderSphere(frame({ mood: 'thinking', t: 777, reducedMotion: true })));
    expect(renderSphere(frame({ mood: 'idle', t: 0 }))).not.toEqual(renderSphere(frame({ mood: 'idle', t: 1000 })));
  });

  it('never flickers under reduced motion, and rarely otherwise', () => {
    let n = 0;
    for (let t = 0; t < 33 * 3000; t += 33) {
      expect(flickerAt(t, true)).toBe(false);
      if (flickerAt(t, false)) n++;
    }
    expect(n).toBeGreaterThan(5);
    expect(n).toBeLessThan(120);
  });
});

describe('applyScanlines', () => {
  it('darkens odd rows one step, never below 1, never touching empty pixels', () => {
    const size = 4;
    const px = new Uint8Array([3, 3, 3, 3, 3, 1, 0, 6, 3, 3, 3, 3, 2, 2, 2, 2]);
    const out = applyScanlines(px, size);
    expect(Array.from(out.slice(0, 4))).toEqual([3, 3, 3, 3]);
    expect(Array.from(out.slice(4, 8))).toEqual([2, 1, 0, 5]);
    expect(Array.from(out.slice(12, 16))).toEqual([1, 1, 1, 1]);
  });
});

describe('the window (2026-09-26): size, DESK layout, brightness, warming', () => {
  it('defaults to a 480 square and clamps what the file says, as { w, h } since 2026-09-27', async () => {
    const m = await import('../packages/shared/hologram.js');
    expect(m.DEFAULT_HOLOGRAM.size).toEqual({ w: 480, h: 480 });
    expect(m.clampHologramSize(undefined)).toEqual({ w: 480, h: 480 });
    expect(m.clampHologramSize(12)).toEqual({ w: m.HOLOGRAM_WINDOW_MIN, h: m.HOLOGRAM_WINDOW_MIN });
    expect(m.clampHologramSize(5000)).toEqual({ w: m.HOLOGRAM_WINDOW_MAX, h: m.HOLOGRAM_WINDOW_MAX });
    expect(m.clampHologramSize(500.4)).toEqual({ w: 500, h: 500 });
    expect(m.clampHologramSize({ w: 640.6, h: 400 })).toEqual({ w: 641, h: 400 });
  });

  it('DESK bounds: right edge of the work area, full height, width 0.6 per tall in eights', async () => {
    const m = await import('../packages/shared/hologram.js');
    const work = { x: 100, y: 40, width: 2560, height: 1400 };
    const b = m.deskBounds(work);
    expect(b.height).toBe(1400);
    expect(b.width % 8).toBe(0);
    expect(b.width).toBe(Math.round((1400 * 0.6) / 8) * 8);
    expect(b.x + b.width).toBe(work.x + work.width);
    expect(b.y).toBe(40);
    // A narrow screen never gets a window wider than itself.
    const narrow = m.deskBounds({ x: 0, y: 0, width: 400, height: 1200 });
    expect(narrow.width).toBeLessThanOrEqual(400);
  });

  it('LISTENING is the brightest state and OFF the dimmest', async () => {
    const m = await import('../packages/shared/hologram.js');
    const moods = ['fault', 'acting', 'speaking', 'listening', 'thinking', 'idle', 'off'] as const;
    const values = moods.map((mood) => m.brightnessFor(mood));
    expect(Math.max(...values)).toBe(m.brightnessFor('listening'));
    expect(Math.min(...values)).toBe(m.brightnessFor('off'));
    expect(m.BRIGHTEN_UP_MS).toBeLessThan(m.BRIGHTEN_DOWN_MS);
  });

  it('warming is read from the speech state alone', async () => {
    const m = await import('../packages/shared/hologram.js');
    expect(m.isWarming(null)).toBe(false);
    expect(m.isWarming({ speaking: false })).toBe(false);
    expect(m.isWarming({ speaking: false, warming: true, text: 'one moment' })).toBe(true);
  });
});
