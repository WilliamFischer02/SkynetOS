import { describe, expect, it } from 'vitest';
import { SECTION_LABELS, SECTION_ORDER, fieldsFor, sectionOf } from '../packages/shared/node-fields.js';
import { NODE_KINDS } from '../packages/shared/types.js';

/**
 * The node editor's sections. William: "more elements need to be nested in dropdowns that have
 * section headers." What must hold: every field lands in a section that exists, the effect
 * modifiers sit with their effects, and a kind's binding is never filed away as appearance.
 */

describe('editor sections', () => {
  it('file every field of every kind under a section that exists and has a label', () => {
    for (const kind of NODE_KINDS) {
      for (const field of fieldsFor(kind)) {
        const section = sectionOf(field.key);
        expect(SECTION_ORDER, `${kind}.${String(field.key)}`).toContain(section);
        expect(SECTION_LABELS[section]).toBeTruthy();
      }
    }
  });

  it('keep every effect and its modifiers together', () => {
    for (const key of ['pulseGlow', 'pulseSpeed', 'pulseColor', 'chase', 'chaseColor', 'chaseSpeed', 'scan', 'scanSpeed', 'textGlow', 'textGlowColor'] as const) {
      expect(sectionOf(key)).toBe('effects');
    }
  });

  it('put what a node points at under the binding, not under appearance', () => {
    expect(sectionOf('cwd')).toBe('binding');
    expect(sectionOf('path')).toBe('binding');
    expect(sectionOf('url')).toBe('binding');
    expect(sectionOf('boardFile')).toBe('binding');
  });

  it('open with Identity first and the binding second', () => {
    expect(SECTION_ORDER.slice(0, 2)).toEqual(['identity', 'binding']);
  });
});
