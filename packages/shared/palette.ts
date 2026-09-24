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

/**
 * Per-room mask + signal, matching docs/02-VISUAL-LANGUAGE.md and every board/*.json theme.
 *
 * 2026-09-09: minecraftos was '#57C25A' (identical to OK) and deductionos was '#E0A22E'
 * (identical to WARN). In those rooms a live-activity pixel and a status pixel were the same
 * colour. Both moved clear; MIN_SIGNAL_STATUS_DISTANCE below is now enforced by a test.
 */
export const ROOM_THEMES = {
  root: { maskDark: '#0E1A14', maskLight: '#16261D', signal: '#7FE0B0' },
  minecraftos: { maskDark: '#14261A', maskLight: '#1D3524', signal: '#A8E85C' },
  deductionos: { maskDark: '#201A12', maskLight: '#2E2619', signal: '#FFD866' },
  storyos: { maskDark: '#1B1420', maskLight: '#271C2E', signal: '#A87BD6' },
  gameos: { maskDark: '#101C26', maskLight: '#182734', signal: '#4FA8D8' },
  financeos: { maskDark: '#1A1B22', maskLight: '#26272F', signal: '#5CDCD0' }
} as const satisfies Record<string, { maskDark: Hex; maskLight: Hex; signal: Hex }>;

export type RoomId = keyof typeof ROOM_THEMES;

/**
 * Minimum Manhattan RGB distance between any room signal and any status colour. A signal that
 * sits close to ok/warn/fault makes "this is busy" and "this is broken" the same pixel.
 */
export const MIN_SIGNAL_STATUS_DISTANCE = 100;

export function manhattan(a: string, b: string): number {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb);
}

/**
 * Relation colour — the mechanism behind "connected rooms share colour and wire elements".
 *
 * An edge or a group.zone may name another board in its `relation` field. The trace's inner
 * strand, or the zone's outline, is then drawn in THAT room's signal colour, so a wire leading
 * to another room visibly carries the colour you will be looking at when you arrive there.
 *
 * This costs the sprite colour budget nothing: traces and zone outlines are drawn as geometry,
 * not as atlas sprites, so the six-colour-per-frame cap is untouched. Colour only — a relation
 * changes no routing and no behaviour. See docs/DECISIONS.md 2026-09-09.
 */
export function signalOf(boardId: string | undefined, fallback: string): string {
  if (!boardId) return fallback;
  const theme = (ROOM_THEMES as Record<string, { signal: string } | undefined>)[boardId];
  return theme?.signal ?? fallback;
}

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

/* ────────────────────────── naming a colour from board JSON ────────────────────────── */

/**
 * The colours a board file is allowed to name.
 *
 * Board JSON says `"textColor": "signal"`, never `"#7FE0B0"`. Two reasons, and the second is the
 * one that matters:
 *
 *   1. A hex string in a board file is a colour that can be off-palette, and docs/02 treats an
 *      off-palette pixel as a crash-severity bug. A token cannot be.
 *   2. `signal`, `mask-dark` and `mask-light` MEAN something different in every room. A note that
 *      says "signal" stays the room's own accent when its board is opened in MinecraftOS; a note
 *      that said `#7FE0B0` would carry SkynetOS's green into a room that is not green.
 */
export const PALETTE_TOKENS = [
  'silk', 'copper', 'copper-dark', 'signal', 'mask-light', 'mask-dark', 'ok', 'warn', 'fault'
] as const;
export type PaletteToken = (typeof PALETTE_TOKENS)[number];

export function isPaletteToken(value: string): value is PaletteToken {
  return (PALETTE_TOKENS as readonly string[]).includes(value);
}

/**
 * The black edge every wire carries. William: "all wires, even drawn ones should have a black
 * stroke for visual clarity."
 *
 * Geometry only, like the courier outlines: it is never baked into a sprite, so it is not in
 * skynet.gpl, the atlas check never sees it, and the bake's recolouring cannot start snapping dark
 * art pixels to it. Pure black, because the darkest palette entry is each room's mask-dark, which
 * IS the substrate. An outline in it would vanish exactly where it is needed.
 */
export const INK = '#000000' as const;

/** The colours a wire's run and outline may be given in board JSON: the palette tokens, plus ink. */
export const WIRE_TOKENS = [...PALETTE_TOKENS, 'ink'] as const;
export type WireToken = (typeof WIRE_TOKENS)[number];

export function isWireToken(value: string): value is WireToken {
  return (WIRE_TOKENS as readonly string[]).includes(value);
}

/** Resolve a wire token. `ink` is black; everything else resolves as an ordinary palette token. */
export function resolveWireToken(
  token: string | undefined,
  theme: { maskDark: string; maskLight: string; signal: string },
  fallback: string
): string {
  if (token === 'ink') return INK;
  return token ? resolveToken(token, theme, fallback) : fallback;
}

/** Resolve a token against a room's theme. Anything unrecognised falls back to silk. */
export function resolveToken(
  token: string | undefined,
  theme: { maskDark: string; maskLight: string; signal: string },
  fallback: string = SILK
): string {
  switch (token) {
    case 'silk': return SILK;
    case 'copper': return COPPER;
    case 'copper-dark': return COPPER_DARK;
    case 'signal': return theme.signal;
    case 'mask-light': return theme.maskLight;
    case 'mask-dark': return theme.maskDark;
    case 'ok': return OK;
    case 'warn': return WARN;
    case 'fault': return FAULT;
    default: return fallback;
  }
}

/**
 * The room's six colours ordered dark to light — the ramp everything else brightens along.
 *
 * One definition, used by the mosaic dither in main, the pulse glow in the renderer, and the text
 * glow. They have to agree exactly: a shift computed against a different ordering maps a pixel to
 * a colour the dither never intended, and the image changes hue instead of brightening.
 */
export function themeRampHex(theme: { maskDark: string; maskLight: string; signal: string }): string[] {
  const luma = (hex: string): number => {
    const [r, g, b] = hexToRgb(hex);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  };
  return [theme.maskDark, theme.maskLight, COPPER_DARK, COPPER, theme.signal, SILK]
    .sort((a, b) => luma(a) - luma(b));
}

/** One rung brighter along the room's ramp. Saturates at silk. */
export function brighten(hex: string, steps: number, theme: { maskDark: string; maskLight: string; signal: string }): string {
  const ramp = themeRampHex(theme);
  const i = ramp.indexOf(hex);
  if (i === -1) return hex;
  return ramp[Math.min(ramp.length - 1, Math.max(0, i + steps))] ?? hex;
}
