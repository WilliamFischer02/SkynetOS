import { describe, expect, it } from 'vitest';
import { ICON_NAMES, iconRows } from '../src/renderer/ui/Icon.js';

describe('the pixel icon set', () => {
  it('draws every icon on a 9x9 grid of # and .', () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(40);
    for (const name of ICON_NAMES) {
      const rows = iconRows(name);
      expect(rows, name).toHaveLength(9);
      for (const row of rows) expect(row, `${name}: ${row}`).toMatch(/^[#.]{9}$/);
    }
  });

  it('lights at least a few pixels in every icon, and no two icons are identical', () => {
    const seen = new Map<string, string>();
    for (const name of ICON_NAMES) {
      const joined = iconRows(name).join('');
      expect((joined.match(/#/g) ?? []).length, name).toBeGreaterThanOrEqual(5);
      expect(seen.get(joined), `${name} duplicates ${seen.get(joined)}`).toBeUndefined();
      seen.set(joined, name);
    }
  });
});
