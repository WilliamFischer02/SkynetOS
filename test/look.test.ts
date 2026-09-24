import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BAYER8,
  LOOK_LIMITS,
  TILE_MAX_PX,
  applyLookPatch,
  cleanLook,
  lookFilter,
  resolveLook,
  squareCheck,
  tileSourcePx,
  vignetteCellPx,
  vignetteDensity,
  vignetteMask
} from '@shared/look.js';

describe('resolveLook', () => {
  it('is today\'s board when nothing is set', () => {
    const r = resolveLook(undefined);
    expect(r).toEqual({
      hue: 0, saturation: 100, brightness: 100, contrast: 100,
      vignette: false, vignetteStrength: LOOK_LIMITS.vignetteStrength.neutral, vignetteColor: 'ink',
      tileImage: null, tileEnabled: false, tileScale: 1
    });
    expect(lookFilter(undefined)).toBe('');
  });

  it('clamps and rounds every number, and refuses an unknown colour', () => {
    const r = resolveLook({ hue: 500, saturation: -5, tileScale: 2.6, contrast: Number.NaN, vignetteColor: '#ff00ff' });
    expect(r.hue).toBe(180);
    expect(r.saturation).toBe(0);
    expect(r.tileScale).toBe(3);
    expect(r.contrast).toBe(100);
    expect(r.vignetteColor).toBe('ink');
  });
});

describe('cleanLook', () => {
  it('drops every field at its default and returns null when nothing is left', () => {
    expect(cleanLook({ hue: 0, saturation: 100, vignette: false, tileScale: 1 })).toBeNull();
    expect(cleanLook(null)).toBeNull();
  });

  it('keeps the tile picture with the toggle off, so switching back does not mean browsing again', () => {
    expect(cleanLook({ tileImage: '%USERPROFILE%/floor.png', tileEnabled: false })).toEqual({ tileImage: '%USERPROFILE%/floor.png' });
  });
});

describe('applyLookPatch (the board.update inverse)', () => {
  it('round-trips: applying the inverse gives back exactly what was there', () => {
    const before = { hue: 30 };
    const forward = applyLookPatch(before, { hue: 30, vignette: true });
    expect(forward.look).toEqual({ hue: 30, vignette: true });
    expect(forward.changed).toBe(true);
    const back = applyLookPatch(forward.look, forward.inverse);
    expect(back.look).toEqual(cleanLook(before));
  });

  it('restores "absent" for a board that had no look', () => {
    const forward = applyLookPatch(undefined, { vignette: true });
    expect(forward.inverse).toBeNull();
    expect(applyLookPatch(forward.look, forward.inverse).look).toBeNull();
  });

  it('is a no-op when nothing actually changes', () => {
    expect(applyLookPatch({ hue: 10 }, { hue: 10, saturation: 100 }).changed).toBe(false);
  });
});

describe('lookFilter', () => {
  it('names only what differs from neutral', () => {
    expect(lookFilter({ hue: 90, saturation: 150 })).toBe('hue-rotate(90deg) saturate(150%)');
    expect(lookFilter({ brightness: 80, contrast: 120 })).toBe('brightness(80%) contrast(120%)');
  });
});

describe('the tiled background', () => {
  it('takes only a perfect square', () => {
    expect(squareCheck(64, 64)).toEqual({ ok: true, size: 64 });
    expect(squareCheck(640, 480)).toEqual({ ok: false, reason: 'NOT SQUARE — 640x480' });
    expect(squareCheck(0, 0).ok).toBe(false);
  });

  it('holds the tile between the smallest and largest sizes', () => {
    expect(tileSourcePx(4)).toBe(8);
    expect(tileSourcePx(100)).toBe(100);
    expect(tileSourcePx(1024)).toBe(TILE_MAX_PX);
  });
});

describe('the dithered vignette', () => {
  it('uses a true 8x8 Bayer matrix: every threshold 0..63 exactly once', () => {
    expect([...BAYER8].sort((a, b) => a - b)).toEqual(Array.from({ length: 64 }, (_, i) => i));
  });

  it('is 1-bit and leaves the middle of the screen alone', () => {
    const mask = vignetteMask(64, 40, 4);
    expect(mask.every((v) => v === 0 || v === 1)).toBe(true);
    expect(mask[20 * 64 + 32]).toBe(0);
    expect(vignetteDensity(0, 0, 4)).toBe(0);
  });

  it('never paints inside its inner radius', () => {
    const cols = 80;
    const rows = 50;
    const mask = vignetteMask(cols, rows, 2);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const nx = (x + 0.5 - cols / 2) / (cols / 2);
        const ny = (y + 0.5 - rows / 2) / (rows / 2);
        if (Math.hypot(nx, ny) <= 0.85) expect(mask[y * cols + x]).toBe(0);
      }
    }
  });

  it('covers more of the screen at every step up in strength', () => {
    const coverage = [1, 2, 3, 4].map((s) => vignetteMask(96, 60, s).reduce((sum, v) => sum + v, 0));
    for (let i = 1; i < coverage.length; i++) expect(coverage[i]!).toBeGreaterThan(coverage[i - 1]!);
  });

  it('draws in whole-number cells', () => {
    expect(vignetteCellPx(1)).toBe(3);
    expect(vignetteCellPx(2)).toBe(6);
    expect(vignetteMask(0, 10, 2)).toHaveLength(0);
  });
});

describe('schema', () => {
  it('declares exactly the fields the look resolves, and nothing else', () => {
    const schema = JSON.parse(readFileSync(join(process.cwd(), 'schema', 'board.schema.json'), 'utf8')) as {
      properties: { look: { additionalProperties: boolean; properties: Record<string, unknown> } };
    };
    expect(schema.properties.look.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties.look.properties).sort()).toEqual(Object.keys(resolveLook({})).sort());
  });
});
