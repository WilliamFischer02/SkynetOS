import { describe, expect, it } from 'vitest';
import type { Board } from '../packages/shared/types.js';
import { idSlug } from '../packages/shared/id-slug.js';
import { freePhantomId } from '../packages/shared/phantoms.js';
import { freeNodeId } from '../src/main/services/node-factory.js';

const empty = (): Board => ({
  id: 'root',
  name: 'Root',
  grid: { width: 100, height: 100 },
  nodes: [],
  edges: []
} as unknown as Board);

describe('idSlug', () => {
  it('lower-cases, and folds every run of space or punctuation into one underscore', () => {
    expect(idSlug('The Stalker')).toBe('the_stalker');
    expect(idSlug('TimeServed-1.2.0.jar')).toBe('timeserved_1_2_0_jar');
    expect(idSlug('C:/dev/SkynetOS')).toBe('c_dev_skynetos');
  });

  it('trims the ends and never returns an empty slug', () => {
    expect(idSlug('  --Docs-- ')).toBe('docs');
    expect(idSlug('')).toBe('node');
    expect(idSlug('***')).toBe('node');
  });

  it('cuts to 24 characters', () => {
    expect(idSlug('a'.repeat(40))).toHaveLength(24);
  });

  it('is the slug a phantom id and a node id are both built from', () => {
    const board = empty();
    expect(freePhantomId(board, 'Crash Reports')).toBe(`ph_${idSlug('Crash Reports')}`);
    expect(freeNodeId(board, 'store.folder', 'Crash Reports')).toBe(`s_${idSlug('Crash Reports')}`);
  });
});
