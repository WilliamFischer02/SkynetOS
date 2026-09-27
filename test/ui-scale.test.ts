import { describe, expect, it } from 'vitest';
import { clampUiScale, nextUiScale, resolveUiScale, uiScaleFor, uiScaleLabel } from '../packages/shared/ui-scale.js';

describe('clampUiScale (settings.json uiScale)', () => {
  it('keeps the four choices', () => {
    expect(clampUiScale('auto')).toBe('auto');
    expect(clampUiScale(1)).toBe(1);
    expect(clampUiScale(2)).toBe(2);
    expect(clampUiScale(3)).toBe(3);
  });

  it('reads a hand-typed number in quotes', () => {
    expect(clampUiScale('2')).toBe(2);
    expect(clampUiScale(' 3 ')).toBe(3);
  });

  it('turns anything else into auto, never a fraction or a size off the list', () => {
    for (const bad of [0, 4, 10, -1, 1.5, 2.0001, NaN, Infinity, 'big', '', '  ', null, undefined, true, {}, [2]]) {
      expect(clampUiScale(bad)).toBe('auto');
    }
  });
});

describe('resolveUiScale', () => {
  it('auto follows the OS scale factor, rounded, 1 to 3', () => {
    expect(uiScaleFor(1)).toBe(1);
    expect(uiScaleFor(1.25)).toBe(1);
    expect(uiScaleFor(1.5)).toBe(2);
    expect(uiScaleFor(2)).toBe(2);
    expect(uiScaleFor(3.5)).toBe(3);
    expect(uiScaleFor(0.5)).toBe(1);
    expect(uiScaleFor(NaN)).toBe(1);
    expect(resolveUiScale('auto', 2)).toBe(2);
  });

  it('a number overrides the OS', () => {
    expect(resolveUiScale(1, 2)).toBe(1);
    expect(resolveUiScale(3, 1)).toBe(3);
  });
});

describe('the palette and the buttons', () => {
  it('steps AUTO, 1, 2, 3 and wraps', () => {
    expect(nextUiScale('auto')).toBe(1);
    expect(nextUiScale(1)).toBe(2);
    expect(nextUiScale(2)).toBe(3);
    expect(nextUiScale(3)).toBe('auto');
  });

  it('labels them', () => {
    expect(['auto', 1, 2, 3].map((s) => uiScaleLabel(s as 'auto' | 1 | 2 | 3))).toEqual(['AUTO', '1×', '2×', '3×']);
  });
});
