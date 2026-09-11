import { describe, expect, it } from 'vitest';
import {
  beginDrag,
  canDropGroup,
  groupDelta,
  groupTargets,
  marqueeRect,
  selectInRect,
  shouldCommitGroup,
  type DragState,
  type GroupMember
} from '../src/renderer/board/drag.js';
import type { NodeRect } from '../src/renderer/board/layout.js';

/**
 * Group selection. William: "add the ability to drag-window / group select nodes collectively
 * within an area and move them together / simultaneously."
 *
 * What is worth pinning is the part that is easy to get subtly wrong: which gesture a press
 * starts, that a group moves as one rigid piece, and that the members are never obstacles to
 * each other while everything outside the group still is.
 */

const T = 16;
const rect = (nodeId: string, kind: string, x: number, y: number, w: number, h: number): NodeRect =>
  ({ nodeId, kind: kind as NodeRect['kind'], x: x * T, y: y * T, w: w * T, h: h * T });
const member = (nodeId: string, x: number, y: number, w = 2, h = 2, kind = 'agent.code'): GroupMember =>
  ({ nodeId, kind, originTile: { x, y }, footprint: { w, h } });

const camera = { x: 0, y: 0, zoom: 2 };
const grid = { width: 40, height: 30 };

const start = (over: Partial<Parameters<typeof beginDrag>[0]> = {}): DragState =>
  beginDrag({ button: 0, screen: { x: 100, y: 100 }, camera, hit: null, editMode: true, ...over });

describe('which gesture a press starts', () => {
  it('draws a selection box on Shift+drag over empty substrate in Edit Board mode', () => {
    const drag = start({ shiftKey: true });
    expect(drag.kind).toBe('marquee');
    expect(drag.currentScreen).toEqual({ x: 100, y: 100 });
  });

  it('still pans without Shift, and outside Edit Board mode', () => {
    expect(start().kind).toBe('pan');
    expect(start({ shiftKey: true, editMode: false }).kind).toBe('pan');
  });

  it('moves the whole group when the press lands on a member', () => {
    const group = [member('a', 2, 2), member('b', 6, 2)];
    const drag = start({ hit: rect('b', 'agent.code', 6, 2, 2, 2), nodeTile: { x: 6, y: 2 }, group });
    expect(drag.kind).toBe('group');
    expect(drag.members?.map((m) => m.nodeId)).toEqual(['a', 'b']);
    // A copy: the drag must not share state with the caller's list.
    expect(drag.members?.[0]).not.toBe(group[0]);
  });

  it('moves only the one node when it is not in the group', () => {
    const group = [member('a', 2, 2), member('b', 6, 2)];
    const drag = start({ hit: rect('c', 'agent.code', 12, 2, 2, 2), nodeTile: { x: 12, y: 2 }, group });
    expect(drag.kind).toBe('move');
  });

  it('treats a group of one as an ordinary move', () => {
    const drag = start({ hit: rect('a', 'agent.code', 2, 2, 2, 2), nodeTile: { x: 2, y: 2 }, group: [member('a', 2, 2)] });
    expect(drag.kind).toBe('move');
  });

  it('still resizes from the handle, even on a member of a group', () => {
    const group = [member('a', 2, 2), member('b', 6, 2)];
    const drag = start({
      hit: rect('a', 'agent.code', 2, 2, 2, 2), nodeTile: { x: 2, y: 2 }, nodeFootprint: { w: 2, h: 2 },
      onResizeHandle: true, group
    });
    expect(drag.kind).toBe('resize');
  });
});

describe('a group drag', () => {
  const group = [member('a', 1, 4), member('b', 5, 4)];
  const dragOf = (): DragState => start({ hit: rect('a', 'agent.code', 1, 4, 2, 2), nodeTile: { x: 1, y: 4 }, group });

  it('steps whole tiles and keeps every member at the same offset', () => {
    // 64 screen px at zoom 2 is 32 world px: two tiles.
    const delta = groupDelta(dragOf(), { x: 164, y: 100 }, 2);
    expect(delta).toEqual({ dx: 2, dy: 0 });
    expect(groupTargets(group, delta)).toEqual([
      { nodeId: 'a', pos: { x: 3, y: 4 } },
      { nodeId: 'b', pos: { x: 7, y: 4 } }
    ]);
  });

  it('stops at the top and left edges as one piece', () => {
    // Ten tiles left and up: member a is one tile from the left edge, so the group moves one.
    expect(groupDelta(dragOf(), { x: 100 - 320, y: 100 - 320 }, 2)).toEqual({ dx: -1, dy: -4 });
  });

  it('does not treat the members as obstacles to each other', () => {
    // Four tiles right puts a exactly where b was. b has moved on, so that is legal.
    const pair = [member('a', 1, 4), member('b', 5, 4)];
    const others = [rect('a', 'agent.code', 1, 4, 2, 2), rect('b', 'agent.code', 5, 4, 2, 2)];
    expect(canDropGroup(pair, { dx: 4, dy: 0 }, others, grid)).toBe(true);
  });

  it('refuses a landing on a component outside the group', () => {
    const others = [rect('a', 'agent.code', 1, 4, 2, 2), rect('b', 'agent.code', 5, 4, 2, 2), rect('c', 'store.repo', 10, 4, 2, 2)];
    expect(canDropGroup(group, { dx: 5, dy: 0 }, others, grid)).toBe(false);
  });

  it('refuses a landing that puts any member off the board', () => {
    expect(canDropGroup(group, { dx: 34, dy: 0 }, [], grid)).toBe(false);
    expect(canDropGroup(group, { dx: 33, dy: 0 }, [], grid)).toBe(true);
  });

  it('lets a group land over a backdrop, which is scenery', () => {
    const others = [rect('bg', 'decor.image', 0, 0, 40, 30)];
    expect(canDropGroup(group, { dx: 3, dy: 3 }, others, grid)).toBe(true);
  });

  it('commits only a real, legal move', () => {
    const moved = { ...dragOf(), exceeded: true, delta: { dx: 2, dy: 0 }, valid: true };
    expect(shouldCommitGroup(moved)).toBe(true);
    expect(shouldCommitGroup({ ...moved, valid: false })).toBe(false);
    expect(shouldCommitGroup({ ...moved, delta: { dx: 0, dy: 0 } })).toBe(false);
    expect(shouldCommitGroup({ ...moved, exceeded: false })).toBe(false);
  });
});

describe('the selection box', () => {
  it('is the same box whichever way it was dragged', () => {
    expect(marqueeRect({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, w: 40, h: 60 });
  });

  it('catches every component it touches', () => {
    const rects = [rect('in', 'agent.code', 2, 2, 2, 2), rect('edge', 'agent.code', 5, 2, 4, 2), rect('out', 'agent.code', 20, 20, 2, 2)];
    // A box from tile 1 to tile 6 clips the second component's left end.
    expect(selectInRect(rects, { x: T, y: T, w: 5 * T, h: 4 * T })).toEqual(['in', 'edge']);
  });

  it('catches a backdrop only when it holds all of it', () => {
    const rects = [rect('chip', 'agent.code', 4, 4, 2, 2), rect('bg', 'decor.image', 0, 0, 30, 20)];
    expect(selectInRect(rects, { x: 3 * T, y: 3 * T, w: 5 * T, h: 5 * T })).toEqual(['chip']);
    expect(selectInRect(rects, { x: 0, y: 0, w: 30 * T, h: 20 * T })).toEqual(['chip', 'bg']);
  });
});
