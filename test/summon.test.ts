import { describe, expect, it } from 'vitest';
import type { BoardNode } from '../packages/shared/types.js';
import { summonPrompt } from '../packages/shared/summon.js';

const node = {
  id: 'f_new_document_2',
  kind: 'file.document',
  name: 'DIRTY PLUSH',
  designator: 'F3',
  pos: { x: 58, y: 81 },
  path: '%USERPROFILE%/OneDrive/Documents/Dirty Plush.docx',
  plateColor: 'mask-dark'
} as BoardNode;

const target = {
  node,
  boardId: 'root',
  boardName: 'SKYNETOS',
  resolved: 'C:/Users/x/OneDrive/Documents/Dirty Plush.docx',
  state: 'ok',
  neighbours: ['RESEARCH', 'DIRTY PLUSH (HUD)']
};

describe('summonPrompt', () => {
  it('names the target, where it resolves and what it is wired to', () => {
    const text = summonPrompt(target, 'tighten chapter three');
    expect(text).toContain('F3 DIRTY PLUSH (file.document), id f_new_document_2');
    expect(text).toContain('resolves: C:/Users/x/OneDrive/Documents/Dirty Plush.docx [ok]');
    expect(text).toContain('wired to: RESEARCH, DIRTY PLUSH (HUD)');
    expect(text).toContain('  tighten chapter three');
  });

  it('quotes binding fields and leaves presentation out', () => {
    const text = summonPrompt(target, 'x');
    expect(text).toContain('path:');
    expect(text).not.toContain('plateColor');
    expect(text).not.toContain('mask-dark');
  });

  it('asks one question when no directive was given', () => {
    const text = summonPrompt(target, '   ');
    expect(text).toContain('(none given)');
    expect(text).toContain('ask him, in one question');
  });

  it('keeps a multi-line directive intact and keeps the security boundary', () => {
    const text = summonPrompt(target, 'line one\nline "two" with C:\\paths');
    expect(text).toContain('  line one\n  line "two" with C:\\paths');
    expect(text).toContain('docs/07-SECURITY.md');
  });
});
