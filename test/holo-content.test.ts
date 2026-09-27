import { describe, expect, it } from 'vitest';
import {
  DIFF_MAX_LINES,
  MERGE_MS,
  WIRE_MAX_EDGES,
  diffLines,
  folderFrom,
  isBinaryStl,
  paperFrom,
  terminalFrom,
  wireFrom,
  wireFromObj,
  wireFromStl,
  wrapLine
} from '../packages/shared/holo-content.js';

describe('paper', () => {
  it('wraps to the column and never past it', () => {
    const text = 'The quick brown fox jumps over the lazy dog and keeps on running until the column ends.';
    const paper = paperFrom(text, 't', { columns: 20 });
    for (const line of paper.lines) expect(line.length).toBeLessThanOrEqual(20);
    expect(paper.lines.join(' ').replace(/\s+/g, ' ')).toBe(text);
  });

  it('cuts a word longer than the column and expands tabs', () => {
    expect(wrapLine('a'.repeat(45), 20)).toEqual(['a'.repeat(20), 'a'.repeat(20), 'a'.repeat(5)]);
    expect(wrapLine('\tx', 20)).toEqual(['  x']);
  });

  it('keeps at most maxLines, around the focus line', () => {
    const text = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join('\n');
    const paper = paperFrom(text, 't', { maxLines: 100, focusLine: 500 });
    expect(paper.lines).toHaveLength(100);
    expect(paper.lines[paper.scrollFrom]).toBe('line 500');
  });
});

describe('terminal', () => {
  it('diffs an insert, a delete and a replace', () => {
    const before = 'a\nb\nc\nd';
    const after = 'a\nB\nd\ne';
    const steps = diffLines(before.split('\n'), after.split('\n')).map((s) => s.kind);
    // Two lines kept, two removed, two added; the order inside a hunk is the walk's to choose.
    expect(steps.filter((k) => k === 'equal')).toHaveLength(2);
    expect(steps.filter((k) => k === 'delete')).toHaveLength(2);
    expect(steps.filter((k) => k === 'insert')).toHaveLength(2);
    const t = terminalFrom(before, after, 'x.ts', 'ts');
    expect(t.lines).toEqual(['a', 'b', 'c', 'd']);
    expect(t.ops.map((o) => [o.kind, o.line, o.text])).toEqual([
      ['replace', 1, 'B'],
      ['delete', 2, 'c'],
      ['insert', 3, 'e']
    ]);
    // Replaying the ops on `lines` yields `after`.
    const buf = [...t.lines];
    for (const op of t.ops) {
      if (op.kind === 'insert') buf.splice(op.line, 0, op.text);
      else if (op.kind === 'delete') buf.splice(op.line, 1);
      else buf[op.line] = op.text;
    }
    expect(buf.join('\n')).toBe(after);
  });

  it('spaces ops as typing with a rove delay, merging ops that would land too close', () => {
    const t = terminalFrom('', 'x\ny\nz', 'n', 'ts');
    expect(t.ops.map((o) => o.at)).toEqual([0, 0, 0]);
    const long = terminalFrom('', `${'a'.repeat(60)}\n${'b'.repeat(60)}`, 'n', 'ts');
    expect(long.ops[1]!.at - long.ops[0]!.at).toBeGreaterThanOrEqual(MERGE_MS);
  });

  it('rewrites rather than diffing a very large file', () => {
    const big = Array.from({ length: DIFF_MAX_LINES + 1 }, (_, i) => String(i)).join('\n');
    const t = terminalFrom('', big, 'big.ts', 'ts');
    expect(t.ops).toEqual([]);
    expect(t.title).toMatch(/rewritten/);
  });
});

describe('wireframe', () => {
  const cubeObj = [
    'v -1 -1 -1', 'v 1 -1 -1', 'v 1 1 -1', 'v -1 1 -1', 'v -1 -1 1', 'v 1 -1 1', 'v 1 1 1', 'v -1 1 1',
    'f 1 2 3 4', 'f 5 6 7 8', 'f 1 2 6 5', 'f 2 3 7 6', 'f 3 4 8 7', 'f 4 1 5 8'
  ].join('\n');

  it('turns an OBJ cube into twelve edges inside the unit cube', () => {
    const w = wireFromObj(cubeObj, 'cube');
    expect(w.verts).toHaveLength(8);
    expect(w.edges).toHaveLength(12);
    for (const v of w.verts) for (const c of v) expect(Math.abs(c)).toBeLessThanOrEqual(0.5);
  });

  it('reads a binary STL by its header and count, and an ASCII one by its text', () => {
    const tri = new Uint8Array(84 + 50);
    const view = new DataView(tri.buffer);
    view.setUint32(80, 1, true);
    const coords = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    coords.forEach((c, i) => view.setFloat32(84 + 12 + i * 4, c, true));
    expect(isBinaryStl(tri)).toBe(true);
    const w = wireFromStl(tri, 'tri');
    expect(w.verts).toHaveLength(3);
    expect(w.edges).toHaveLength(3);
    const ascii = 'solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n';
    expect(isBinaryStl(new TextEncoder().encode(ascii))).toBe(false);
    expect(wireFromStl(ascii, 't').edges).toHaveLength(3);
  });

  it('decimates to the edge cap and knows unknown formats', () => {
    const verts: string[] = [];
    const faces: string[] = [];
    for (let i = 0; i < 3000; i++) { verts.push(`v ${i} 0 0`, `v ${i} 1 0`, `v ${i} 0 1`); faces.push(`f ${i * 3 + 1} ${i * 3 + 2} ${i * 3 + 3}`); }
    const w = wireFrom([...verts, ...faces].join('\n'), 'obj', 'many');
    expect(w.edges.length).toBeLessThanOrEqual(WIRE_MAX_EDGES);
    expect(wireFrom('', 'fbx', 'x').edges).toEqual([]);
  });
});

describe('folder', () => {
  it('lists folders first, alphabetically, capped', () => {
    const entries = Array.from({ length: 80 }, (_, i) => ({ name: `f${String(i).padStart(2, '0')}`, kind: 'other' as const }));
    const f = folderFrom([...entries, { name: 'zdir', kind: 'folder' }], 'root');
    expect(f.entries[0]).toEqual({ name: 'zdir', kind: 'folder' });
    expect(f.entries).toHaveLength(60);
  });
});
