import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NODE_KINDS, footprintOf, type Board, type NodeKind } from '../packages/shared/types.js';
import { COMPONENT_STYLE } from '../src/renderer/board/component-art.js';
import { NAMEPLATE_HEIGHT, nameplateOffset } from '../src/renderer/board/sprites.js';

/**
 * Two complaints from looking at the real board, pinned so they cannot come back:
 *   1. every node was the same rectangle, so you had to read each one to know what it was;
 *   2. long names wrapped across three lines of 6px type and stopped being readable.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '.snapshots') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.board.json')) out.push(p);
  }
  return out;
}

const boards = walk(join(process.cwd(), 'board')).map((f) => JSON.parse(readFileSync(f, 'utf8')) as Board);

describe('every node kind has a package silhouette', () => {
  it.each(NODE_KINDS)('%s', (kind) => {
    expect(COMPONENT_STYLE[kind]).toBeDefined();
    expect(COMPONENT_STYLE[kind].inset).toBeGreaterThanOrEqual(0);
  });
});

describe('the kinds you actually look at are visually distinct', () => {
  it('gives the mounted component kinds different silhouettes', () => {
    // The complaint was that a board is a wall of identical boxes. These are the kinds that get
    // drawn as packages, and no two that sit next to each other may share a shape.
    const mounted: NodeKind[] = [
      'agent.code', 'agent.chat', 'agent.jarvis', 'drive.room',
      'store.repo', 'file.document', 'file.exe', 'file.artifact',
      'link.url', 'service.process', 'task.scheduled', 'monitor.system'
    ];
    const shapes = mounted.map((k) => COMPONENT_STYLE[k].silhouette);
    // store.repo and store.folder deliberately share 'drive'; link.url and store.cloud share
    // 'jack'. Beyond those two pairs everything is its own shape.
    expect(new Set(shapes).size).toBeGreaterThanOrEqual(11);
  });

  /**
   * Printed on the board rather than mounted to it. These have no package, so they have no
   * silhouette — a bracket, a heading and a backdrop are not components.
   */
  const PRINTED = ['note.silk', 'group.zone', 'decor.image', 'decor.part'] as const;

  it('never leaves a mounted kind on the fallback shape', () => {
    for (const kind of NODE_KINDS) {
      if ((PRINTED as readonly string[]).includes(kind)) continue;
      expect(COMPONENT_STYLE[kind].silhouette, `${kind} is still a plain box`).not.toBe('plain');
    }
  });

  it('leaves the printed-only kinds plain — they are not packages', () => {
    for (const kind of PRINTED) expect(COMPONENT_STYLE[kind].silhouette).toBe('plain');
  });

  it('gives a package enough inset for its legs without leaving the footprint', () => {
    for (const kind of NODE_KINDS) {
      // A 1x1 passive is 16px; an inset of 8 a side would leave nothing to draw.
      expect(COMPONENT_STYLE[kind].inset).toBeLessThanOrEqual(4);
    }
  });
});

describe('nameplate', () => {
  it('reserves space above a node that has a name', () => {
    expect(nameplateOffset('CC-STALKER')).toBe(NAMEPLATE_HEIGHT);
  });

  it('reserves nothing for a node with no name', () => {
    expect(nameplateOffset(undefined)).toBe(0);
    expect(nameplateOffset('')).toBe(0);
    expect(nameplateOffset('   ')).toBe(0);
  });

  it('is one line high — the whole point is that names never wrap', () => {
    // 11px silkscreen plus a 1px edge top and bottom plus the stem. If this ever grows to fit a
    // second line, the wrapping bug is back.
    expect(NAMEPLATE_HEIGHT).toBeLessThan(11 * 2);
  });

  it('is the same height for every name, however long', () => {
    const names = ['A', 'CC-STALKER', 'THERE COULD BE GIANTS', 'TruthQuestRetro', 'x'.repeat(40)];
    const heights = new Set(names.map((n) => nameplateOffset(n)));
    expect(heights.size).toBe(1);
  });
});

describe('the nameplate does not disturb the grid', () => {
  it('leaves every footprint in the seeded boards exactly as the board data says', () => {
    // The plate extends the TEXTURE, not the footprint — collision, routing and hit-testing all
    // still work on the grid the board file describes. If this ever changes, the validator's
    // overlap rule and the A* obstacle map would silently disagree with what is drawn.
    for (const board of boards) {
      for (const node of board.nodes) {
        const fp = footprintOf(node);
        expect(Number.isInteger(fp.w)).toBe(true);
        expect(Number.isInteger(fp.h)).toBe(true);
        expect(node.pos.x + fp.w).toBeLessThanOrEqual(board.grid.width);
        expect(node.pos.y + fp.h).toBeLessThanOrEqual(board.grid.height);
      }
    }
  });

  it('never pushes a nameplate off the top of the board', () => {
    // A node at y=0 with a name would draw its plate at negative y and be clipped. The seeded
    // boards keep a margin; this catches a future node placed hard against the top edge.
    const offenders: string[] = [];
    for (const board of boards) {
      for (const node of board.nodes) {
        if (node.kind === 'note.silk' || node.kind === 'group.zone') continue;
        if (!node.name?.trim()) continue;
        if (node.pos.y * 16 - NAMEPLATE_HEIGHT < 0) offenders.push(`${board.id}/${node.id}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
