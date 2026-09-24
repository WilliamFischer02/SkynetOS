/**
 * The retro pointer bitmaps: well-formed, outlined everywhere, and pointing where they say they point.
 */

import { describe, expect, it } from 'vitest';
import { CURSOR_ARROW, CURSOR_GRAB, runsOf, type CursorSprite } from '../src/renderer/ui/cursor-sprites.js';

const SPRITES: [string, CursorSprite][] = [
  ['arrow', CURSOR_ARROW],
  ['closed hand', CURSOR_GRAB]
];

describe.each(SPRITES)('the %s', (_name, sprite) => {
  it('is a rectangle of outline, fill and nothing else', () => {
    const width = sprite.rows[0]!.length;
    for (const row of sprite.rows) {
      expect(row).toHaveLength(width);
      expect(row).toMatch(/^[.#o]+$/);
    }
  });

  it('has its hotspot on a drawn pixel', () => {
    expect(sprite.rows[sprite.hotspot.y]?.[sprite.hotspot.x]).toMatch(/[#o]/);
  });

  it('never lets its fill touch the background, so it reads on a light panel as well as a dark board', () => {
    const at = (x: number, y: number): string => sprite.rows[y]?.[x] ?? '.';
    sprite.rows.forEach((row, y) => {
      [...row].forEach((pixel, x) => {
        if (pixel !== 'o') return;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) expect(at(x + dx, y + dy)).not.toBe('.');
      });
    });
  });

  it('is drawn by runs that cover exactly its pixels', () => {
    for (const lit of ['#', 'o']) {
      const covered = new Set<string>();
      for (const run of runsOf(sprite.rows, lit)) for (let i = 0; i < run.w; i++) covered.add(`${run.x + i},${run.y}`);
      const expected = new Set<string>();
      sprite.rows.forEach((row, y) => [...row].forEach((pixel, x) => { if (pixel === lit) expected.add(`${x},${y}`); }));
      expect(covered).toEqual(expected);
    }
  });
});
