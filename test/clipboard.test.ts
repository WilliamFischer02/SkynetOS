import { describe, expect, it } from 'vitest';
import type { Board, BoardNode } from '../packages/shared/types.js';
import { clusterOffset, clusterOrigin, copySelection, planPaste, type PasteNaming } from '../packages/shared/clipboard.js';

function board(nodes: BoardNode[], edges: Board['edges'] = []): Board {
  return {
    schemaVersion: 1,
    id: 'test',
    name: 'TEST',
    theme: { maskDark: '#0E1A14', maskLight: '#16261D', signal: '#7FE0B0' },
    grid: { tile: 16, width: 40, height: 30 },
    nodes,
    edges
  };
}

const naming: PasteNaming = {
  nodeId: (b, n) => {
    const taken = new Set(b.nodes.map((x) => x.id));
    for (let i = 2; ; i++) if (!taken.has(`${n.id}_${i}`)) return `${n.id}_${i}`;
  },
  designator: (b, n) => (n.kind.startsWith('agent') ? `U${b.nodes.length + 1}` : undefined)
};

const part = (id: string, x: number, y: number): BoardNode =>
  ({ id, kind: 'decor.part', name: 'PART', pos: { x, y }, part: 'via' }) as BoardNode;
const chip = (id: string, x: number, y: number): BoardNode =>
  ({ id, kind: 'agent.code', name: 'CHIP', pos: { x, y }, designator: 'U1', cwd: 'C:/dev' }) as BoardNode;

describe('copySelection', () => {
  it('takes the nodes and only the traces between them', () => {
    const b = board(
      [chip('a', 0, 0), chip('b', 5, 0), chip('c', 10, 0)],
      [
        { id: 'e1', from: 'a', to: 'b', kind: 'depends' },
        { id: 'e2', from: 'b', to: 'c', kind: 'depends' }
      ] as Board['edges']
    );
    const clip = copySelection(b, ['a', 'b']);
    expect(clip?.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(clip?.edges.map((e) => e.id)).toEqual(['e1']);
  });

  it('returns null for an empty selection', () => {
    expect(copySelection(board([part('p', 1, 1)]), ['nope'])).toBeNull();
  });

  it('is a deep copy', () => {
    const b = board([part('p', 1, 1)]);
    const clip = copySelection(b, ['p'])!;
    clip.nodes[0]!.pos.x = 9;
    expect(b.nodes[0]!.pos.x).toBe(1);
  });
});

describe('clusterOffset', () => {
  it('lands decor exactly where asked, even on top of a chip', () => {
    const b = board([chip('a', 4, 4)]);
    expect(clusterOffset(b, [part('p', 0, 0)], { x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
  });

  it('moves a mounted cluster to the nearest clear offset', () => {
    const b = board([chip('a', 4, 4)]);
    const off = clusterOffset(b, [chip('x', 0, 0)], { x: 4, y: 4 });
    expect(off).not.toBeNull();
    expect(off).not.toEqual({ x: 4, y: 4 });
  });

  it('keeps the cluster inside the board', () => {
    const b = board([]);
    const off = clusterOffset(b, [chip('x', 0, 0)], { x: 39, y: 29 })!;
    expect(off.x + 3).toBeLessThanOrEqual(40);
    expect(off.y + 3).toBeLessThanOrEqual(30);
  });
});

describe('planPaste', () => {
  it('gives fresh ids, rewires internal traces and moves the cluster to the anchor', () => {
    const b = board(
      [part('p', 2, 2), part('q', 4, 3)],
      [{ id: 'e1', from: 'p', to: 'q', kind: 'depends', waypoints: [[1, 1]] }] as Board['edges']
    );
    const clip = copySelection(b, ['p', 'q'])!;
    const plan = planPaste(b, clip, { x: 20, y: 10 }, naming)!;
    expect(plan.nodes.map((n) => n.id)).toEqual(['p_2', 'q_2']);
    expect(clusterOrigin(plan.nodes)).toEqual({ x: 20, y: 10 });
    expect(plan.nodes[1]!.pos).toEqual({ x: 22, y: 11 });
    expect(plan.edges).toHaveLength(1);
    expect(plan.edges[0]).toMatchObject({ from: 'p_2', to: 'q_2' });
    expect(plan.edges[0]!.id).not.toBe('e1');
    expect(plan.edges[0]!.waypoints).toBeUndefined();
  });

  it('remaps zone members to the copies and drops members that do not exist in the target', () => {
    const zone = { id: 'z', kind: 'group.zone', name: 'Z', pos: { x: 0, y: 0 }, footprint: { w: 8, h: 8 }, members: ['p', 'gone'] } as BoardNode;
    const source = board([zone, part('p', 1, 1)]);
    const clip = copySelection(source, ['z', 'p'])!;
    const target = { ...board([]), id: 'other' };
    const plan = planPaste(target, clip, { x: 10, y: 10 }, naming)!;
    const pastedZone = plan.nodes.find((n) => n.kind === 'group.zone')!;
    expect(pastedZone.members).toEqual(['p_2']);
  });

  it('reassigns designators only on kinds that had one', () => {
    const b = board([chip('a', 0, 0), part('p', 10, 10)]);
    const plan = planPaste(b, copySelection(b, ['a', 'p'])!, { x: 20, y: 20 }, naming)!;
    expect(plan.nodes[0]!.designator).toMatch(/^U\d+$/);
    expect(plan.nodes[1]!.designator).toBeUndefined();
  });
});
