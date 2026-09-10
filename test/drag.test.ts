import { describe, expect, it } from 'vitest';
import {
  DRAG_THRESHOLD_PX,
  NO_DRAG,
  beginDrag,
  canDrop,
  exceedsThreshold,
  moveTo,
  panTo,
  shouldCommit,
  type DragState
} from '../src/renderer/board/drag.js';
import type { NodeRect } from '../src/renderer/board/layout.js';
import { TILE } from '../src/renderer/board/camera.js';

const camera = { x: 100, y: 50, zoom: 3 };
const nodeHit: NodeRect = { nodeId: 'u1', kind: 'agent.code', x: 64, y: 64, w: 48, h: 48 };
const zoneHit: NodeRect = { nodeId: 'z1', kind: 'group.zone', x: 0, y: 0, w: 400, h: 200 };

const down = (over: Partial<Parameters<typeof beginDrag>[0]> = {}) =>
  beginDrag({
    button: 0,
    screen: { x: 200, y: 200 },
    camera,
    hit: null,
    editMode: false,
    nodeTile: null,
    ...over
  });

describe('which gesture a press starts', () => {
  it('pans on empty substrate', () => {
    expect(down().kind).toBe('pan');
  });

  it('pans on a node when NOT in edit mode', () => {
    // Browsing involves a lot of clicking. A click that drifts two pixels must never relocate a
    // component, so moving is gated behind Edit Board mode.
    expect(down({ hit: nodeHit, nodeTile: { x: 4, y: 4 } }).kind).toBe('pan');
  });

  it('moves a node in edit mode', () => {
    const state = down({ hit: nodeHit, editMode: true, nodeTile: { x: 4, y: 4 } });
    expect(state.kind).toBe('move');
    expect(state.nodeId).toBe('u1');
    expect(state.originTile).toEqual({ x: 4, y: 4 });
  });

  it('pans on middle-drag even over a node in edit mode', () => {
    expect(down({ button: 1, hit: nodeHit, editMode: true, nodeTile: { x: 4, y: 4 } }).kind).toBe('pan');
  });

  it('ignores the right button entirely — that is for a context menu', () => {
    expect(down({ button: 2 }).kind).toBe('none');
  });

  it('records the camera so a pan is relative to where it started', () => {
    expect(down().originCamera).toEqual({ x: 100, y: 50 });
  });
});

describe('click versus drag', () => {
  const state = down();

  it('does not treat a press with no movement as a drag', () => {
    expect(exceedsThreshold(state, { x: 200, y: 200 })).toBe(false);
  });

  it('does not treat a 3px wobble as a drag', () => {
    expect(exceedsThreshold(state, { x: 202, y: 202 })).toBe(false);
  });

  it('treats a deliberate move as a drag', () => {
    expect(exceedsThreshold(state, { x: 200 + DRAG_THRESHOLD_PX, y: 200 })).toBe(true);
    expect(exceedsThreshold(state, { x: 240, y: 260 })).toBe(true);
  });
});

describe('panTo', () => {
  it('moves the board with the cursor, not against it', () => {
    // Grab-the-paper: drag right and the board follows, which means the camera goes LEFT.
    // Getting this backwards is the single most common pan bug and is invisible in code review.
    const state = down();
    const after = panTo(state, { x: 260, y: 200 }, 3);
    expect(after.x).toBeLessThan(camera.x);
  });

  it('scales the delta by zoom so a drag tracks the cursor 1:1 on screen', () => {
    const state = down();
    const at2 = panTo(state, { x: 260, y: 200 }, 2);
    const at4 = panTo(state, { x: 260, y: 200 }, 4);
    // 60 screen px is 30 world px at 2x and 15 at 4x — the same distance under the cursor.
    expect(camera.x - at2.x).toBeCloseTo(30, 10);
    expect(camera.x - at4.x).toBeCloseTo(15, 10);
  });

  it('is a no-op at the origin', () => {
    const state = down();
    expect(panTo(state, state.originScreen, 3)).toEqual({ x: 100, y: 50 });
  });
});

describe('moveTo', () => {
  const state = down({ hit: nodeHit, editMode: true, nodeTile: { x: 4, y: 4 } });

  it('snaps to whole tiles', () => {
    const tile = moveTo(state, { x: 200 + TILE * 3 * 2, y: 200 }, 3);
    expect(Number.isInteger(tile.x)).toBe(true);
    expect(Number.isInteger(tile.y)).toBe(true);
    expect(tile).toEqual({ x: 6, y: 4 });
  });

  it('does not move for a sub-tile drag', () => {
    expect(moveTo(state, { x: 205, y: 203 }, 3)).toEqual({ x: 4, y: 4 });
  });

  it('never produces a negative tile', () => {
    const tile = moveTo(state, { x: -5000, y: -5000 }, 3);
    expect(tile.x).toBeGreaterThanOrEqual(0);
    expect(tile.y).toBeGreaterThanOrEqual(0);
  });
});

describe('canDrop', () => {
  const grid = { width: 64, height: 40 };
  const others: NodeRect[] = [
    { nodeId: 'other', kind: 'store.repo', x: 10 * TILE, y: 10 * TILE, w: 4 * TILE, h: 3 * TILE },
    zoneHit
  ];

  it('allows an empty tile', () => {
    expect(canDrop('u1', { x: 30, y: 30 }, { w: 3, h: 3 }, others, grid)).toBe(true);
  });

  it('refuses an overlap', () => {
    expect(canDrop('u1', { x: 11, y: 11 }, { w: 3, h: 3 }, others, grid)).toBe(false);
  });

  it('refuses a footprint that runs off the board', () => {
    expect(canDrop('u1', { x: 63, y: 5 }, { w: 3, h: 3 }, others, grid)).toBe(false);
    expect(canDrop('u1', { x: 5, y: 39 }, { w: 3, h: 3 }, others, grid)).toBe(false);
  });

  it('allows the exact right edge', () => {
    expect(canDrop('u1', { x: 61, y: 5 }, { w: 3, h: 3 }, others, grid)).toBe(true);
  });

  it('does not treat a zone as an obstacle', () => {
    // Zones deliberately overlap the components inside them.
    expect(canDrop('u1', { x: 1, y: 1 }, { w: 3, h: 3 }, [zoneHit], grid)).toBe(true);
  });

  it('does not treat the node being moved as its own obstacle', () => {
    const self: NodeRect = { nodeId: 'u1', kind: 'agent.code', x: 20 * TILE, y: 20 * TILE, w: 3 * TILE, h: 3 * TILE };
    expect(canDrop('u1', { x: 20, y: 20 }, { w: 3, h: 3 }, [self, ...others], grid)).toBe(true);
  });

  it('allows two footprints that touch but do not overlap', () => {
    expect(canDrop('u1', { x: 14, y: 10 }, { w: 3, h: 3 }, others, grid)).toBe(true);
  });
});

describe('shouldCommit', () => {
  const base: DragState = {
    ...NO_DRAG,
    kind: 'move',
    nodeId: 'u1',
    originTile: { x: 4, y: 4 },
    currentTile: { x: 6, y: 4 },
    exceeded: true,
    valid: true
  };

  it('commits a real, legal move', () => {
    expect(shouldCommit(base)).toBe(true);
  });

  it('does not commit a move that landed back where it started', () => {
    expect(shouldCommit({ ...base, currentTile: { x: 4, y: 4 } })).toBe(false);
  });

  it('does not commit an illegal drop', () => {
    expect(shouldCommit({ ...base, valid: false })).toBe(false);
  });

  it('does not commit a click', () => {
    expect(shouldCommit({ ...base, exceeded: false })).toBe(false);
  });

  it('does not commit a pan', () => {
    expect(shouldCommit({ ...base, kind: 'pan' })).toBe(false);
  });
});
