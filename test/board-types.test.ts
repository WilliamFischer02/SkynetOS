import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FOOTPRINT, NODE_KINDS, EDGE_KINDS, footprintOf, spriteKeyOf, type Board } from '../packages/shared/types.js';

const ROOT = process.cwd();

/**
 * packages/shared/types.ts and schema/board.schema.json describe the same thing in two languages.
 * These tests are what stops them drifting — CLAUDE.md's definition of done requires both to be
 * updated together, and this is the check that notices when they were not.
 */
const schema = JSON.parse(readFileSync(join(ROOT, 'schema', 'board.schema.json'), 'utf8')) as {
  $defs: {
    node: { properties: Record<string, unknown>; additionalProperties?: boolean };
    edge: { properties: { kind: { enum: string[] } } };
  };
};

function walkBoards(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '.snapshots') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walkBoards(p, out);
    else if (p.endsWith('.board.json')) out.push(p);
  }
  return out;
}

const boardFiles = walkBoards(join(ROOT, 'board'));
const boards = boardFiles.map((f) => JSON.parse(readFileSync(f, 'utf8')) as Board);

describe('types.ts matches board.schema.json', () => {
  it('declares the same node kinds', () => {
    const fromSchema = (schema.$defs.node.properties['kind'] as { enum: string[] }).enum;
    expect([...NODE_KINDS].sort()).toEqual([...fromSchema].sort());
  });

  it('declares the same edge kinds', () => {
    expect([...EDGE_KINDS].sort()).toEqual([...schema.$defs.edge.properties.kind.enum].sort());
  });

  it('keeps the node schema closed, so a typo cannot validate clean', () => {
    expect(schema.$defs.node.additionalProperties).toBe(false);
  });

  it('has a default footprint for every kind', () => {
    for (const kind of NODE_KINDS) expect(DEFAULT_FOOTPRINT[kind]).toBeDefined();
  });
});

describe('seeded board data', () => {
  it('found the six rooms', () => {
    expect(boardFiles.length).toBe(6);
    expect(boards.map((b) => b.id).sort()).toEqual(['deductionos', 'financeos', 'gameos', 'minecraftos', 'root', 'storyos']);
  });

  it('uses only declared node kinds', () => {
    for (const board of boards) {
      for (const node of board.nodes) expect(NODE_KINDS).toContain(node.kind);
    }
  });

  it('gives every node a footprint the renderer can size', () => {
    for (const board of boards) {
      for (const node of board.nodes) {
        const fp = footprintOf(node);
        expect(Number.isInteger(fp.w)).toBe(true);
        expect(Number.isInteger(fp.h)).toBe(true);
        expect(fp.w).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('keeps every node on the 16px grid, at integer tile positions', () => {
    for (const board of boards) {
      for (const node of board.nodes) {
        expect(Number.isInteger(node.pos.x)).toBe(true);
        expect(Number.isInteger(node.pos.y)).toBe(true);
      }
    }
  });

  it('points every edge at a node that exists', () => {
    for (const board of boards) {
      const ids = new Set(board.nodes.map((n) => n.id));
      for (const edge of board.edges) {
        expect(ids.has(edge.from)).toBe(true);
        expect(ids.has(edge.to)).toBe(true);
      }
    }
  });
});

describe('spriteKeyOf', () => {
  it('returns a key, never a file path', () => {
    for (const kind of NODE_KINDS) {
      const key = spriteKeyOf({ kind });
      expect(key).not.toMatch(/[\\/]/);
      expect(key).not.toMatch(/\.png$/);
    }
  });

  it('names a state suffix so the four agent states are separable', () => {
    expect(spriteKeyOf({ kind: 'agent.code' }, 'working')).toBe('component.chip_dip.working');
    expect(spriteKeyOf({ kind: 'agent.code' }, 'fault')).toBe('component.chip_dip.fault');
  });

  it('is stable for every kind in the seeded boards', () => {
    /*
     * Two shapes, and the difference is where the pixels come from.
     *
     *   component.<package>.<state>   a DRAWN silhouette from component-art.ts, which has states
     *   decor.<part>                  one baked atlas frame, cut from a real tilesheet cell
     *
     * A decor part has no states because it has no behaviour — it is furniture. Requiring one
     * would mean baking `decor.via.idle`, which is a suffix that means nothing.
     */
    for (const board of boards) {
      for (const node of board.nodes) {
        const key = spriteKeyOf(node);
        if (node.kind === 'decor.part') expect(key).toMatch(/^decor\.[a-z_]+$/);
        else expect(key, `${node.id} (${node.kind})`).toMatch(/^component\.[a-z_]+\.[a-z]+$/);
      }
    }
  });
});
