import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Board, BoardNode, Phantom } from '../packages/shared/types.js';
import { DESTRUCTIVE } from '../packages/shared/commands.js';
import {
  MAX_PHANTOMS_PER_BOARD,
  approvedBoard,
  edgesFromPhantom,
  findPhantomSpot,
  freePhantomId,
  nodeFromPhantom,
  phantomActorRefusal,
  phantomFieldKeys,
  phantomFromProposal,
  phantomProblems,
  unapprovedBoard,
  withPhantom,
  withoutPhantom
} from '../packages/shared/phantoms.js';

/*
 * Recommended nodes. William: "You may recommend up to 4 new nodes at a time per room / board …
 * a check or x I can select to approve or delete a phantom." These pin the cap, the placement, what
 * a phantom may carry, the exact round trip of approve and its undo, and who may press what.
 */

function board(): Board {
  return {
    schemaVersion: 1,
    id: 'test',
    name: 'TEST',
    theme: { maskDark: '#0e1a14', maskLight: '#16261d', signal: '#7fe0b0' },
    grid: { tile: 16, width: 32, height: 20 },
    nodes: [
      { id: 's_repo', kind: 'store.repo', name: 'REPO', pos: { x: 2, y: 2 }, path: 'C:/dev/Thing' },
      // A backdrop is printed: it sits under components and must not block a phantom.
      { id: 'bg_back', kind: 'decor.image', name: 'BACK', pos: { x: 10, y: 10 }, footprint: { w: 12, h: 8 }, image: 'x.png' }
    ],
    edges: []
  };
}

function phantom(over: Partial<Phantom> = {}): Phantom {
  return {
    id: 'ph_docs',
    kind: 'store.repo',
    name: 'DOCS',
    description: 'The docs repo, which the chip beside it reads.',
    pos: { x: 20, y: 2 },
    proposedBy: 'jarvis',
    proposedAt: '2026-09-11T00:00:00.000Z',
    ...over
  };
}

describe('what a phantom may be', () => {
  it('accepts a clean one in free space', () => {
    expect(phantomProblems(board(), phantom())).toEqual([]);
    expect(withPhantom(board(), phantom()).phantoms).toHaveLength(1);
  });

  it('refuses one drawn on top of a component, but not on top of a backdrop', () => {
    expect(phantomProblems(board(), phantom({ pos: { x: 3, y: 3 } })).join(' ')).toContain('s_repo');
    expect(phantomProblems(board(), phantom({ pos: { x: 12, y: 12 } }))).toEqual([]);
  });

  it('refuses one past the board edge', () => {
    expect(phantomProblems(board(), phantom({ pos: { x: 30, y: 2 } })).join(' ')).toContain('edge');
  });

  it('carries only fields the node editor offers for that kind', () => {
    expect(phantomFieldKeys('store.repo')).toContain('path');
    expect(phantomFieldKeys('store.repo')).not.toContain('id');
    const typo = phantom({ fields: { cdw: 'C:/dev' } as unknown as Partial<BoardNode> });
    expect(phantomProblems(board(), typo).join(' ')).toContain('"cdw"');
    expect(phantomProblems(board(), phantom({ fields: { path: 'C:/dev/Docs' } }))).toEqual([]);
  });

  it('refuses a trace to a node that is not there, or of a kind that does not exist', () => {
    const bad = phantom({ connect: [{ to: 'nope', kind: 'reads' }, { to: 's_repo', kind: 'teleports' as never }] });
    const text = phantomProblems(board(), bad).join(' ');
    expect(text).toContain('"nope"');
    expect(text).toContain('"teleports"');
  });
});

describe('the cap', () => {
  it(`holds at ${MAX_PHANTOMS_PER_BOARD} per board`, () => {
    let b = board();
    [8, 14, 20, 26].forEach((x, i) => { b = withPhantom(b, phantom({ id: `ph_${i}`, pos: { x, y: 2 } })); });
    expect(b.phantoms).toHaveLength(MAX_PHANTOMS_PER_BOARD);
    expect(() => withPhantom(b, phantom({ id: 'ph_fifth', pos: { x: 8, y: 7 } }))).toThrow(/THE MOST IS 4/);
  });

  it('is the same number the schema enforces', () => {
    const schema = JSON.parse(readFileSync(join(__dirname, '..', 'schema', 'board.schema.json'), 'utf8'));
    expect(schema.properties.phantoms.maxItems).toBe(MAX_PHANTOMS_PER_BOARD);
  });
});

describe('placement and identity', () => {
  it('nudges a proposal off a component to the nearest free spot', () => {
    const b = board();
    const spot = findPhantomSpot(b, 'store.repo', { w: 4, h: 3 }, { x: 3, y: 3 });
    expect(spot).not.toBeNull();
    expect(phantomProblems(b, phantom({ pos: spot! }))).toEqual([]);
  });

  it('keeps phantoms off each other too', () => {
    const b = withPhantom(board(), phantom());
    const spot = findPhantomSpot(b, 'store.repo', { w: 4, h: 3 }, { x: 20, y: 2 });
    expect(spot).not.toEqual({ x: 20, y: 2 });
  });

  it('never lets an agent sign as William', () => {
    const proposal = { kind: 'store.repo' as const, name: 'Docs', description: 'why', pos: { x: 20, y: 2 } };
    expect(phantomFromProposal(board(), { ...proposal, proposedBy: 'user' }, 'agent', 'now').proposedBy).toBe('jarvis');
    expect(phantomFromProposal(board(), { ...proposal, proposedBy: 'U3 JARVIS-PRIME' }, 'agent', 'now').proposedBy).toBe('U3 JARVIS-PRIME');
    expect(phantomFromProposal(board(), { ...proposal, proposedBy: 'someone' }, 'user', 'now').proposedBy).toBe('user');
  });

  it('mints ids that collide with neither phantoms nor nodes', () => {
    const b = withPhantom(board(), phantom({ id: 'ph_docs' }));
    expect(freePhantomId(b, 'Docs')).toBe('ph_docs_2');
  });
});

describe('approve, and its undo', () => {
  const base = (): BoardNode => ({ id: 's_docs', kind: 'store.repo', name: 'NEW REPO', pos: { x: 0, y: 0 }, designator: 'S2', provisional: true });

  it('binds the node as sketched, and is provisional only while something required is missing', () => {
    const bound = nodeFromPhantom(phantom({ fields: { path: 'C:/dev/Docs', id: 'hijack' } as Partial<BoardNode> }), base());
    expect(bound.path).toBe('C:/dev/Docs');
    expect(bound.id).toBe('s_docs');
    expect(bound.name).toBe('DOCS');
    expect(bound.designator).toBe('S2');
    expect(bound.provisional).toBeUndefined();
    expect(nodeFromPhantom(phantom(), base()).provisional).toBe(true);
  });

  it('wires only to targets that still exist, with free trace ids', () => {
    const b = { ...board(), edges: [{ id: 'e1', from: 's_repo', to: 'bg_back', kind: 'reads' as const }] };
    const edges = edgesFromPhantom(b, phantom({ connect: [{ to: 's_repo', kind: 'reads' }, { to: 'gone', kind: 'reads' }] }), 's_docs');
    expect(edges).toEqual([{ id: 'e2', from: 's_docs', to: 's_repo', kind: 'reads' }]);
  });

  it('round-trips exactly: approve then un-approve is the board it started as', () => {
    const start = withPhantom(board(), phantom({ connect: [{ to: 's_repo', kind: 'reads' }] }));
    const node = nodeFromPhantom(start.phantoms![0]!, { ...base(), pos: { x: 20, y: 2 } });
    const edges = edgesFromPhantom(start, start.phantoms![0]!, node.id);
    const { next, phantom: removed } = approvedBoard(start, 'ph_docs', node, edges);
    expect(next.phantoms).toBeUndefined();
    expect(next.nodes.map((n) => n.id)).toContain('s_docs');
    expect(next.edges).toHaveLength(1);
    expect(unapprovedBoard(next, removed, node.id)).toEqual(start);
  });

  it('dismiss removes only the suggestion', () => {
    const start = withPhantom(board(), phantom());
    const { next, removed } = withoutPhantom(start, 'ph_docs');
    expect(next).toEqual(board());
    expect(removed.id).toBe('ph_docs');
  });
});

describe('who may press what', () => {
  it('lets only William approve', () => {
    expect(phantomActorRefusal('phantom.approve', 'user')).toBeNull();
    expect(phantomActorRefusal('phantom.approve', 'agent')).toMatch(/ONLY WILLIAM/);
    expect(phantomActorRefusal('phantom.approve', 'jarvis')).toMatch(/ONLY WILLIAM/);
  });

  it("lets an agent withdraw its own suggestion, never William's", () => {
    expect(phantomActorRefusal('phantom.dismiss', 'agent', phantom({ proposedBy: 'jarvis' }))).toBeNull();
    expect(phantomActorRefusal('phantom.dismiss', 'agent', phantom({ proposedBy: 'user' }))).toMatch(/OWN/);
    expect(phantomActorRefusal('phantom.propose', 'agent')).toBeNull();
  });

  it('treats the inverse of an approval as destructive: it removes a real node', () => {
    expect(DESTRUCTIVE).toContain('phantom.unapprove');
    expect(DESTRUCTIVE).not.toContain('phantom.dismiss');
  });
});
