import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOLOGRAM,
  HOLOGRAM_DEFAULT_SIZE,
  HOLOGRAM_SIZE_STEP,
  HOLOGRAM_WINDOW_MAX,
  HOLOGRAM_WINDOW_MIN,
  clampHologramSize,
  holoNavLayout,
  holoScaleFor,
  readHologramSize,
  sizeStepForKey,
  stageSquare,
  stepHologramSize
} from '../packages/shared/hologram.js';

/**
 * The JARVIS Voice window became resizable on 2026-09-27 (docs/11 § The window). William's
 * settings.json held `hologram.size: 240` from before the 480 default, so the default never
 * applied and eight buttons shared 240 px. These are the pure halves of the fix.
 */

describe('the saved size: legacy bump, once', () => {
  it('bumps a bare number under 400 (the old 240 square) to the 480 default and says it is legacy', () => {
    expect(readHologramSize(240)).toEqual({ size: { w: 480, h: 480 }, legacy: true, bumped: true });
    expect(readHologramSize(399)).toEqual({ size: { w: 480, h: 480 }, legacy: true, bumped: true });
    expect(readHologramSize(160)).toEqual({ size: { w: 480, h: 480 }, legacy: true, bumped: true });
  });

  it('reads a bare number at 400 and up as both sides, migrated but not bumped', () => {
    expect(readHologramSize(400)).toEqual({ size: { w: 400, h: 400 }, legacy: true, bumped: false });
    expect(readHologramSize(480)).toEqual({ size: { w: 480, h: 480 }, legacy: true, bumped: false });
    expect(readHologramSize(4000)).toEqual({ size: { w: HOLOGRAM_WINDOW_MAX, h: HOLOGRAM_WINDOW_MAX }, legacy: true, bumped: false });
  });

  it('never bumps the new { w, h } shape, even when small: that is what makes the bump happen once', () => {
    expect(readHologramSize({ w: 320, h: 360 })).toEqual({ size: { w: 320, h: 360 }, legacy: false, bumped: false });
    // What main writes back after the bump reads the same the second time.
    const first = readHologramSize(240);
    expect(readHologramSize(first.size)).toEqual({ size: { w: 480, h: 480 }, legacy: false, bumped: false });
  });

  it('treats an absent or broken value as the default, with nothing to migrate', () => {
    expect(readHologramSize(undefined)).toEqual({ size: { w: 480, h: 480 }, legacy: false, bumped: false });
    expect(readHologramSize('big')).toEqual({ size: { w: 480, h: 480 }, legacy: false, bumped: false });
    expect(readHologramSize(Number.NaN).size).toEqual({ w: 480, h: 480 });
    expect(DEFAULT_HOLOGRAM.size).toEqual({ w: HOLOGRAM_DEFAULT_SIZE, h: HOLOGRAM_DEFAULT_SIZE });
  });
});

describe('clampHologramSize for { w, h }', () => {
  it('keeps each side inside 320-1600, in whole DIPs', () => {
    expect(HOLOGRAM_WINDOW_MIN).toBe(320);
    expect(HOLOGRAM_WINDOW_MAX).toBe(1600);
    expect(clampHologramSize({ w: 100, h: 2000 })).toEqual({ w: 320, h: 1600 });
    expect(clampHologramSize({ w: 777.5, h: 612.2 })).toEqual({ w: 778, h: 612 });
  });

  it('defaults a missing or non-numeric side on its own', () => {
    expect(clampHologramSize({ w: 700 })).toEqual({ w: 700, h: 480 });
    expect(clampHologramSize({ w: 'x', h: Infinity })).toEqual({ w: 480, h: 480 });
    expect(clampHologramSize(null)).toEqual({ w: 480, h: 480 });
  });
});

describe('the chrome scale steps', () => {
  it('is 1 below a 640 px shorter side, 2 at 640-1279, 3 at 1280 and up', () => {
    expect(holoScaleFor(480, 480)).toBe(1);
    expect(holoScaleFor(639, 2000)).toBe(1);
    expect(holoScaleFor(640, 640)).toBe(2);
    expect(holoScaleFor(1600, 1279)).toBe(2);
    expect(holoScaleFor(1280, 1280)).toBe(3);
    expect(holoScaleFor(1600, 1600)).toBe(3);
  });

  it('is 1 for a nonsense size', () => {
    expect(holoScaleFor(Number.NaN, 900)).toBe(1);
    expect(holoScaleFor(0, 0)).toBe(1);
  });
});

describe('the nav wrap decision', () => {
  it('one row at 480 chrome px and up, two rows of four below, icons below 400', () => {
    expect(holoNavLayout(480, 1)).toEqual({ rows: 1, icons: false });
    expect(holoNavLayout(479, 1)).toEqual({ rows: 2, icons: false });
    expect(holoNavLayout(400, 1)).toEqual({ rows: 2, icons: false });
    expect(holoNavLayout(399, 1)).toEqual({ rows: 2, icons: true });
    expect(holoNavLayout(320, 1)).toEqual({ rows: 2, icons: true });
  });

  it('judges the width in chrome px, so scale 2 lays out as half the width at scale 1', () => {
    expect(holoNavLayout(960, 2)).toEqual({ rows: 1, icons: false });
    expect(holoNavLayout(900, 2)).toEqual({ rows: 2, icons: false });
    expect(holoNavLayout(640, 2)).toEqual({ rows: 2, icons: true });
    expect(holoNavLayout(1440, 3)).toEqual({ rows: 1, icons: false });
  });

  it('William\'s window after the bump: 480 at scale 1 is one row of words', () => {
    const scale = holoScaleFor(480, 480);
    expect(holoNavLayout(480, scale)).toEqual({ rows: 1, icons: false });
  });
});

describe('the size-step arithmetic (Ctrl+= / Ctrl+- / Ctrl+0)', () => {
  it('steps both sides by 80 and clamps', () => {
    expect(HOLOGRAM_SIZE_STEP).toBe(80);
    expect(stepHologramSize({ w: 480, h: 480 }, 1)).toEqual({ w: 560, h: 560 });
    expect(stepHologramSize({ w: 480, h: 600 }, -1)).toEqual({ w: 400, h: 520 });
    expect(stepHologramSize({ w: 360, h: 360 }, -1)).toEqual({ w: 320, h: 320 });
    expect(stepHologramSize({ w: 1560, h: 1000 }, 1)).toEqual({ w: 1600, h: 1080 });
  });

  it('Ctrl+0 returns to the 480 square from anywhere', () => {
    expect(stepHologramSize({ w: 1200, h: 700 }, 0)).toEqual({ w: 480, h: 480 });
  });

  it('maps the keys: Ctrl with = or +, - or _, 0; nothing without Ctrl or with Alt', () => {
    expect(sizeStepForKey({ control: true, key: '=' })).toBe(1);
    expect(sizeStepForKey({ control: true, key: '+' })).toBe(1);
    expect(sizeStepForKey({ control: true, key: '-' })).toBe(-1);
    expect(sizeStepForKey({ control: true, key: '_' })).toBe(-1);
    expect(sizeStepForKey({ control: true, key: '0' })).toBe(0);
    expect(sizeStepForKey({ control: false, key: '=' })).toBeNull();
    expect(sizeStepForKey({ control: true, alt: true, key: '=' })).toBeNull();
    expect(sizeStepForKey({ control: true, key: 'p' })).toBeNull();
  });
});

describe('the globe square in the stage', () => {
  it('is the largest whole-pixel square that fits, centred on whole pixels', () => {
    expect(stageSquare(456, 300)).toEqual({ side: 300, left: 78, top: 0 });
    expect(stageSquare(301, 500.7)).toEqual({ side: 301, left: 0, top: 99 });
    expect(stageSquare(0, 200)).toEqual({ side: 0, left: 0, top: 100 });
  });
});
