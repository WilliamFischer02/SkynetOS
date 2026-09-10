import { describe, expect, it } from 'vitest';
import {
  DRAG_THRESHOLD_PX,
  NO_DRAG,
  beginDrag,
  canDrop,
  exceedsThreshold,
  moveTo,
  panTo,
  resizeTo,
  shouldCommit,
  shouldCommitResize,
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

/*
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 * Scaling a node.
 *
 * William: "I want to be able to scale nodes". Three paths, because CLAUDE.md's definition of
 * done requires a keyboard route and a corner handle is mouse-only: the handle, Shift+arrows,
 * and the W x H field in the node editor. This covers the gesture; the other two are direct.
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 */
describe('resize', () => {
  const startResize = (footprint: { w: number; h: number }): DragState =>
    beginDrag({
      button: 0,
      screen: { x: 100, y: 100 },
      camera: { x: 0, y: 0, zoom: 2 },
      hit: { nodeId: 'u1', kind: 'agent.code', x: 64, y: 64, w: 48, h: 48 },
      editMode: true,
      nodeTile: { x: 4, y: 4 },
      nodeFootprint: footprint,
      onResizeHandle: true
    });

  it('starts a resize when the press lands on the handle', () => {
    const state = startResize({ w: 3, h: 3 });
    expect(state.kind).toBe('resize');
    expect(state.originFootprint).toEqual({ w: 3, h: 3 });
  });

  it('still moves when the press lands on the node body', () => {
    // The handle is drawn on top of the node's own corner, so "inside the node" is true for both
    // gestures. Only the handle flag separates them.
    const state = beginDrag({
      button: 0,
      screen: { x: 100, y: 100 },
      camera: { x: 0, y: 0, zoom: 2 },
      hit: { nodeId: 'u1', kind: 'agent.code', x: 64, y: 64, w: 48, h: 48 },
      editMode: true,
      nodeTile: { x: 4, y: 4 },
      nodeFootprint: { w: 3, h: 3 },
      onResizeHandle: false
    });
    expect(state.kind).toBe('move');
  });

  it('never resizes outside Edit Board mode, handle or not', () => {
    const state = beginDrag({
      button: 0,
      screen: { x: 100, y: 100 },
      camera: { x: 0, y: 0, zoom: 2 },
      hit: { nodeId: 'u1', kind: 'agent.code', x: 64, y: 64, w: 48, h: 48 },
      editMode: false,
      nodeTile: { x: 4, y: 4 },
      nodeFootprint: { w: 3, h: 3 },
      onResizeHandle: true
    });
    expect(state.kind).toBe('pan');
  });

  it('grows a whole tile at a time, in world units not screen units', () => {
    // At zoom 2, one tile is 32 screen px. Dragging 64 to the right is +2 tiles, not +64.
    const state = startResize({ w: 3, h: 3 });
    expect(resizeTo(state, { x: 164, y: 132 }, 2, 24)).toEqual({ w: 5, h: 4 });
  });

  it('shrinks when dragged back toward the origin', () => {
    const state = startResize({ w: 6, h: 4 });
    expect(resizeTo(state, { x: 36, y: 68 }, 2, 24)).toEqual({ w: 4, h: 3 });
  });

  it('never goes below 1x1 — a zero-tile component has no face to click', () => {
    const state = startResize({ w: 2, h: 2 });
    expect(resizeTo(state, { x: -900, y: -900 }, 2, 24)).toEqual({ w: 1, h: 1 });
  });

  it('never exceeds the maximum', () => {
    const state = startResize({ w: 2, h: 2 });
    expect(resizeTo(state, { x: 9000, y: 9000 }, 2, 24)).toEqual({ w: 24, h: 24 });
  });

  it('leaves the top-left corner alone, which is what makes it a resize', () => {
    const state = startResize({ w: 3, h: 3 });
    expect(state.originTile).toEqual({ x: 4, y: 4 });
    expect(state.currentTile).toBeNull();
  });

  it('commits only a resize that changed something and is legal', () => {
    const base = { ...startResize({ w: 3, h: 3 }), exceeded: true };
    expect(shouldCommitResize({ ...base, currentFootprint: { w: 3, h: 3 } })).toBe(false);
    expect(shouldCommitResize({ ...base, currentFootprint: { w: 4, h: 3 } })).toBe(true);
    expect(shouldCommitResize({ ...base, currentFootprint: { w: 4, h: 3 }, valid: false })).toBe(false);
    expect(shouldCommitResize({ ...base, exceeded: false, currentFootprint: { w: 4, h: 3 } })).toBe(false);
  });

  it('refuses a size that would swallow a neighbour', () => {
    // canDrop is the same gate a move goes through, so an illegal grow turns the ghost red
    // before the drop rather than failing with a toast after it.
    const others: NodeRect[] = [
      { nodeId: 'u1', kind: 'agent.code', x: 64, y: 64, w: 48, h: 48 },
      { nodeId: 'u2', kind: 'agent.code', x: 128, y: 64, w: 48, h: 48 }
    ];
    const grid = { width: 40, height: 40 };
    expect(canDrop('u1', { x: 4, y: 4 }, { w: 3, h: 3 }, others, grid)).toBe(true);
    expect(canDrop('u1', { x: 4, y: 4 }, { w: 5, h: 3 }, others, grid)).toBe(false);
  });
});

/*
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 * Printed kinds are not obstacles, in BOTH directions.
 *
 * William: "uploaded image nodes should be able to go behind the other nodes and intercept with
 * them; they're meant to be background elements."
 *
 * The first version of this only skipped printed kinds in the OTHER position — so a chip dropped
 * on a backdrop was correctly allowed, and the backdrop itself then refused to be dragged
 * anywhere, because every component on the board counted against it. Half a rule reads as a
 * capricious one.
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 */
describe('printed kinds and collision', () => {
  const grid = { width: 64, height: 40 };
  const chip: NodeRect = { nodeId: 'u1', kind: 'agent.code', x: 160, y: 160, w: 48, h: 48 };
  const backdrop: NodeRect = { nodeId: 'bg1', kind: 'decor.image', x: 0, y: 0, w: 320, h: 240 };
  const zone: NodeRect = { nodeId: 'g1', kind: 'group.zone', x: 0, y: 0, w: 320, h: 240 };
  const others = [chip, backdrop, zone];

  it('lets a component land on top of a backdrop', () => {
    expect(canDrop('u2', { x: 2, y: 2 }, { w: 3, h: 3 }, others, grid, 'agent.code')).toBe(true);
  });

  it('lets a backdrop be dragged across components', () => {
    // The half that was broken. A backdrop covering the whole board must still be movable.
    expect(canDrop('bg1', { x: 8, y: 8 }, { w: 20, h: 14 }, others, grid, 'decor.image')).toBe(true);
  });

  it('lets a zone be dragged across the components it brackets', () => {
    expect(canDrop('g1', { x: 9, y: 9 }, { w: 20, h: 14 }, others, grid, 'group.zone')).toBe(true);
  });

  it('still keeps a printed kind on the board', () => {
    // The one rule they do obey. Off-board cannot be represented in the board JSON.
    expect(canDrop('bg1', { x: 60, y: 8 }, { w: 20, h: 14 }, others, grid, 'decor.image')).toBe(false);
    expect(canDrop('bg1', { x: -1, y: 8 }, { w: 20, h: 14 }, others, grid, 'decor.image')).toBe(false);
  });

  it('still refuses to stack two components', () => {
    // The rule that has to survive all of this.
    expect(canDrop('u2', { x: 10, y: 10 }, { w: 3, h: 3 }, others, grid, 'agent.code')).toBe(false);
  });

  it('behaves as before when no kind is given', () => {
    // The parameter is optional, so an older call site keeps its old meaning rather than
    // silently gaining permission to overlap.
    expect(canDrop('u2', { x: 10, y: 10 }, { w: 3, h: 3 }, others, grid)).toBe(false);
  });
});
