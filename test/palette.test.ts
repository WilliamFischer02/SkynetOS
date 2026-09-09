import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COPPER,
  COPPER_DARK,
  FAULT,
  MAX_COLORS_PER_FRAME,
  OK,
  ROOM_THEMES,
  SILK,
  THEME_KEYS,
  WARN,
  hexToRgb
} from '../packages/shared/palette.js';

const ROOT = process.cwd();

/** assets/palettes/skynet.gpl is the authority. Parse it and hold the TypeScript to it. */
function loadGpl(): Map<string, string> {
  const text = readFileSync(join(ROOT, 'assets', 'palettes', 'skynet.gpl'), 'utf8');
  const byName = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s+(\S+)/);
    if (!m) continue;
    const hex = '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('').toUpperCase();
    byName.set(m[4]!, hex);
  }
  return byName;
}

const gpl = loadGpl();

describe('palette.ts agrees with skynet.gpl', () => {
  it('parsed the palette file at all', () => {
    expect(gpl.size).toBeGreaterThan(10);
  });

  it.each([
    ['copper', COPPER],
    ['copper-dark', COPPER_DARK],
    ['silk', SILK],
    ['ok', OK],
    ['warn', WARN],
    ['fault', FAULT]
  ])('%s matches', (token, value) => {
    expect(gpl.get(token)).toBe(value.toUpperCase());
  });

  it.each([
    ['skynet', ROOM_THEMES.root],
    ['mc', ROOM_THEMES.minecraftos],
    ['ded', ROOM_THEMES.deductionos],
    ['story', ROOM_THEMES.storyos],
    ['game', ROOM_THEMES.gameos]
  ])('room %s matches', (prefix, theme) => {
    expect(gpl.get(`${prefix}-mask-dark`)).toBe(theme.maskDark.toUpperCase());
    expect(gpl.get(`${prefix}-mask-light`)).toBe(theme.maskLight.toUpperCase());
    expect(gpl.get(`${prefix}-signal`)).toBe(theme.signal.toUpperCase());
  });
});

describe('board files agree with the palette', () => {
  it.each([
    ['root.board.json', ROOM_THEMES.root],
    ['minecraftos/room.board.json', ROOM_THEMES.minecraftos],
    ['deductionos/room.board.json', ROOM_THEMES.deductionos],
    ['storyos/room.board.json', ROOM_THEMES.storyos],
    ['gameos/room.board.json', ROOM_THEMES.gameos]
  ])('%s carries its documented theme', (file, theme) => {
    const board = JSON.parse(readFileSync(join(ROOT, 'board', file), 'utf8')) as {
      theme: { maskDark: string; maskLight: string; signal: string };
    };
    expect(board.theme.maskDark.toUpperCase()).toBe(theme.maskDark.toUpperCase());
    expect(board.theme.maskLight.toUpperCase()).toBe(theme.maskLight.toUpperCase());
    expect(board.theme.signal.toUpperCase()).toBe(theme.signal.toUpperCase());
  });
});

describe('theme keys', () => {
  it('are the three reserved magentas and nothing else', () => {
    expect(THEME_KEYS).toEqual(['#FF00CC', '#FF0099', '#FF00FF']);
  });

  it('are absent from the shipped palette — they are bake-time only', () => {
    const shipped = new Set([...gpl.values()]);
    for (const key of THEME_KEYS) expect(shipped.has(key)).toBe(false);
  });

  it('are far enough from every real palette colour to be unmistakable', () => {
    // If a theme key were ever near a real colour, an off-by-one in the exact-match shader would
    // be invisible in review and glaring on screen. Assert the separation instead of trusting it.
    for (const key of THEME_KEYS) {
      const [kr, kg, kb] = hexToRgb(key);
      for (const value of gpl.values()) {
        const [r, g, b] = hexToRgb(value);
        expect(Math.abs(kr - r) + Math.abs(kg - g) + Math.abs(kb - b)).toBeGreaterThan(100);
      }
    }
  });
});

describe('colour budget', () => {
  it('is six', () => {
    expect(MAX_COLORS_PER_FRAME).toBe(6);
  });

  it('documents the collision between two room signals and two status colours', () => {
    // MinecraftOS signal == ok, DeductionOS signal == warn. This is a real legibility problem
    // recorded in docs/DECISIONS.md, not an accident — the test pins it so that if someone
    // "fixes" one of the five room palettes, they are made to read the decision first.
    expect(ROOM_THEMES.minecraftos.signal).toBe(OK);
    expect(ROOM_THEMES.deductionos.signal).toBe(WARN);
    expect(ROOM_THEMES.root.signal).not.toBe(OK);
    expect(ROOM_THEMES.storyos.signal).not.toBe(OK);
    expect(ROOM_THEMES.gameos.signal).not.toBe(OK);
  });
});
