/**
 * The locked palette, as TypeScript.
 *
 * assets/palettes/skynet.gpl is the authority — it is what tools/validate-assets.mjs checks the
 * baked atlas against. This file must agree with it. test/palette.test.ts parses the .gpl and
 * fails if these two ever drift, so this is not a copy that can rot quietly.
 */

import type { Hex } from './types.js';

/** Shared tri-tone. Identical in every room — that is what makes the app read as one board. */
export const COPPER = '#C08A3E' as const;
export const COPPER_DARK = '#7A5423' as const;
export const SILK = '#E9E4D6' as const;

/** Status. LEDs only, never large areas. */
export const OK = '#57C25A' as const;
export const WARN = '#E0A22E' as const;
export const FAULT = '#D2453B' as const;

/**
 * Reserved theme keys. Baked into sprites as these exact magenta values and swapped for the
 * current room's colors at draw time by a 3-entry exact-match palette shader. One atlas serves
 * every room. Exact match only — no blending, no tint math, no interpolation.
 *
 * These are legal in assets/atlas/ and illegal everywhere else.
 */
export const THEME_KEY_MASK_DARK = '#FF00CC' as const;
export const THEME_KEY_MASK_LIGHT = '#FF0099' as const;
export const THEME_KEY_SIGNAL = '#FF00FF' as const;

export const THEME_KEYS = [THEME_KEY_MASK_DARK, THEME_KEY_MASK_LIGHT, THEME_KEY_SIGNAL] as const;

/** Per-room mask + signal, matching docs/02-VISUAL-LANGUAGE.md and every board/*.json theme. */
export const ROOM_THEMES = {
  root: { maskDark: '#0E1A14', maskLight: '#16261D', signal: '#7FE0B0' },
  minecraftos: { maskDark: '#14261A', maskLight: '#1D3524', signal: '#57C25A' },
  deductionos: { maskDark: '#201A12', maskLight: '#2E2619', signal: '#E0A22E' },
  storyos: { maskDark: '#1B1420', maskLight: '#271C2E', signal: '#A87BD6' },
  gameos: { maskDark: '#101C26', maskLight: '#182734', signal: '#4FA8D8' }
} as const satisfies Record<string, { maskDark: Hex; maskLight: Hex; signal: Hex }>;

/**
 * Colour budget: 2 mask + 2 copper + 1 silk + 1 signal. tools/validate-assets.mjs enforces it
 * per baked atlas frame and fails the build above it.
 *
 * The consequence, which is not obvious and which will bite at M5: a sprite that already spends
 * all six may not ALSO carry a status LED. Signal or LED, not both, unless the sprite gives up
 * one of its two mask tones or its copper shadow. See docs/DECISIONS.md 2026-09-09.
 */
export const MAX_COLORS_PER_FRAME = 6;

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function hexToNumber(hex: string): number {
  return parseInt(hex.slice(1), 16);
}
