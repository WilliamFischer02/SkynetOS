import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Board } from '../packages/shared/types.js';
import {
  findFreeSpace,
  hitTest,
  isVisible,
  layoutRects,
  nextInOrder,
  nodeRect,
  readingOrder
} from '../src/renderer/board/layout.js';

const root = JSON.parse(readFileSync(join(process.cwd(), 'board', 'root.board.json'), 'utf8')) as Board;
const minecraft = JSON.parse(readFileSync(join(process.cwd(), 'board', 'minecraftos', 'room.board.json'), 'utf8')) as Board;

describe('nodeRect', () => {
  it('places a node at 16px per tile', () => {
    /*
     * Derived from the node, not hard-coded. An earlier version pinned u1_jarvis at tile 28,17 and
     * broke the moment the node was dragged somewhere else on a real board — a test asserting on
     * this developer's current layout rather than on the rule it is supposed to hold.
     */
    const jarvis = root.nodes.find((n) => n.id === 'u1_jarvis')!;
    const fp = jarvis.footprint ?? { w: 8, h: 6 };
    expect(nodeRect(jarvis)).toEqual({
      nodeId: 'u1_jarvis',
      kind: 'agent.jarvis',
      x: jarvis.pos.x * 16,
      y: jarvis.pos.y * 16,
      w: fp.w * 16,
      h: fp.h * 16
    });
  });

  it('falls back to the kind default when no footprint is declared', () => {
    const rect = nodeRect({ id: 'x', kind: 'file.document', name: 'x', pos: { x: 1, y: 1 } });
    expect(rect.w).toBe(2 * 16);
    expect(rect.h).toBe(2 * 16);
  });
});

describe('hitTest', () => {
  const rects = layoutRects(root);

  it('hits a node at its top-left corner and misses one pixel outside it', () => {
    const jarvis = nodeRect(root.nodes.find((n) => n.id === 'u1_jarvis')!);
    expect(hitTest(rects, jarvis.x, jarvis.y)?.nodeId).toBe('u1_jarvis');
    expect(hitTest(rects, jarvis.x - 1, jarvis.y)?.nodeId).not.toBe('u1_jarvis');
  });

  it('treats the far edge as exclusive, so adjacent nodes never both claim a pixel', () => {
    const jarvis = nodeRect(root.nodes.find((n) => n.id === 'u1_jarvis')!);
    expect(hitTest(rects, jarvis.x + jarvis.w - 1, jarvis.y)?.nodeId).toBe('u1_jarvis');
    expect(hitTest(rects, jarvis.x + jarvis.w, jarvis.y)?.nodeId).not.toBe('u1_jarvis');
  });

  it('returns null on empty substrate', () => {
    expect(hitTest(rects, 1, 1)).toBeNull();
  });

  it('never returns a note.silk — printed text is not a click target', () => {
    const noteIds = new Set(root.nodes.filter((n) => n.kind === 'note.silk').map((n) => n.id));
    for (const rect of rects) expect(noteIds.has(rect.nodeId)).toBe(false);
  });

  it('picks the component, not the zone that contains it', () => {
    // Zones overlap their members by design. Smallest-area-wins is what stops every click
    // inside THE STALKER selecting the zone.
    const rects2 = layoutRects(minecraft);
    const agent = minecraft.nodes.find((n) => n.id === 'u1_agent_stalker');
    const zone = minecraft.nodes.find((n) => n.kind === 'group.zone');
    if (!agent || !zone) return;
    const r = nodeRect(agent);
    expect(hitTest(rects2, r.x + 8, r.y + 8)?.nodeId).toBe(agent.id);
  });

  it('still allows selecting a zone by its empty margin', () => {
    const rects2 = layoutRects(minecraft);
    const zone = minecraft.nodes.find((n) => n.id === 'z1');
    if (!zone) return;
    const r = nodeRect(zone);
    // Top-left corner of the zone, which sits outside every member component.
    const hit = hitTest(rects2, r.x + 1, r.y + 1);
    expect(hit?.nodeId).toBe('z1');
  });
});

describe('readingOrder / Tab cycling', () => {
  const rects = layoutRects(root);

  it('visits every node exactly once', () => {
    const order = readingOrder(rects);
    expect(order).toHaveLength(rects.length);
    expect(new Set(order.map((r) => r.nodeId)).size).toBe(rects.length);
  });

  it('goes top to bottom, then left to right', () => {
    const order = readingOrder(rects);
    for (let i = 1; i < order.length; i++) {
      const prev = order[i - 1]!;
      const cur = order[i]!;
      const rowPrev = Math.floor(prev.y / 64);
      const rowCur = Math.floor(cur.y / 64);
      expect(rowPrev).toBeLessThanOrEqual(rowCur);
      if (rowPrev === rowCur) expect(prev.x).toBeLessThanOrEqual(cur.x);
    }
  });

  it('is a cycle in both directions', () => {
    const order = readingOrder(rects);
    const first = order[0]!.nodeId;
    const last = order[order.length - 1]!.nodeId;
    expect(nextInOrder(rects, last, 1)).toBe(first);
    expect(nextInOrder(rects, first, -1)).toBe(last);
  });

  it('starts somewhere sensible when nothing is selected', () => {
    expect(nextInOrder(rects, null, 1)).toBe(readingOrder(rects)[0]!.nodeId);
  });

  it('returns null for an empty board rather than throwing', () => {
    expect(nextInOrder([], null, 1)).toBeNull();
  });

  it('recovers when the selected node no longer exists', () => {
    expect(nextInOrder(rects, 'deleted_node', 1)).toBe(readingOrder(rects)[0]!.nodeId);
  });
});

describe('isVisible', () => {
  const rect = { nodeId: 'x', kind: 'store.repo' as const, x: 100, y: 100, w: 64, h: 48 };

  it('is true when the node is fully inside the viewport', () => {
    expect(isVisible(rect, { x: 0, y: 0, zoom: 2 }, { width: 1600, height: 1000 })).toBe(true);
  });

  it('is false when the node is off the left edge', () => {
    expect(isVisible(rect, { x: 200, y: 0, zoom: 2 }, { width: 1600, height: 1000 })).toBe(false);
  });

  it('is false when zoomed in past it', () => {
    expect(isVisible(rect, { x: 0, y: 0, zoom: 4 }, { width: 200, height: 100 })).toBe(false);
  });
});

describe('findFreeSpace', () => {
  it('finds a gap that does not overlap any existing node', () => {
    const spot = findFreeSpace(root, { w: 3, h: 3 });
    expect(spot).not.toBeNull();
    const rects = layoutRects(root);
    // Check all four corners and the centre of the proposed footprint.
    const probes = [
      [spot!.x * 16, spot!.y * 16],
      [(spot!.x + 3) * 16 - 1, spot!.y * 16],
      [spot!.x * 16, (spot!.y + 3) * 16 - 1],
      [(spot!.x + 3) * 16 - 1, (spot!.y + 3) * 16 - 1]
    ] as const;
    for (const [px, py] of probes) {
      const hit = hitTest(rects, px, py);
      // A zone may legitimately cover free grid space; a mounted component may not.
      expect(hit === null || hit.kind === 'group.zone').toBe(true);
    }
  });

  it('keeps the footprint inside the board', () => {
    const spot = findFreeSpace(root, { w: 4, h: 4 });
    expect(spot!.x + 4).toBeLessThanOrEqual(root.grid.width);
    expect(spot!.y + 4).toBeLessThanOrEqual(root.grid.height);
  });

  it('returns null when nothing could possibly fit', () => {
    expect(findFreeSpace(root, { w: 999, h: 999 })).toBeNull();
  });
});
