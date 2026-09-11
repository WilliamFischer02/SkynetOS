/**
 * Drag state. Pure — no Pixi, no DOM — so test/drag.test.ts can prove the two behaviours the
 * board needs and the rules that keep them from fighting each other.
 *
 * Three gestures, distinguished by what is under the cursor when the button goes down:
 *
 *   - **Pan** — left-drag on empty substrate, or middle-drag anywhere. docs/01 §Navigation.
 *   - **Move** — left-drag on a node, and only in Edit Board mode. Browsing a board involves a
 *     lot of clicking, and a click that drifts two pixels must not silently relocate a
 *     component, so moving is gated behind `E`.
 *   - **Resize** — left-drag on the corner handle of the SELECTED node, in Edit Board mode. The
 *     handle is small and only exists on one node at a time, which is what keeps it from
 *     stealing the move gesture; the keyboard path is Shift+arrows.
 *
 * A drag also has to not eat clicks: a press and release with no real movement is a selection,
 * not a zero-distance drag. DRAG_THRESHOLD_PX is what separates them.
 */

import { PRINTED_KINDS as SHARED_PRINTED_KINDS } from '@shared/types.js';
import type { NodeRect } from './layout.js';
import { TILE } from './camera.js';

/** Movement below this, in screen pixels, is a click. At 4px a deliberate drag still registers. */
export const DRAG_THRESHOLD_PX = 4;

export type DragKind = 'none' | 'pan' | 'move' | 'resize' | 'marquee' | 'group';

/** One node in a group selection, as it stood when a group drag started. */
export interface GroupMember {
  nodeId: string;
  kind: string;
  originTile: { x: number; y: number };
  footprint: { w: number; h: number };
}

export interface DragState {
  kind: DragKind;
  /** Screen position where the button went down. */
  originScreen: { x: number; y: number };
  /** Camera position when the drag started, for pan. */
  originCamera: { x: number; y: number };
  /** The node being moved or resized, and its tile position when the drag started. */
  nodeId: string | null;
  originTile: { x: number; y: number } | null;
  /** The node's footprint when a resize drag started. */
  originFootprint: { w: number; h: number } | null;
  /** Current footprint for a resize drag, in whole tiles. */
  currentFootprint: { w: number; h: number } | null;
  /** True once movement has exceeded the threshold. Until then this is still a click. */
  exceeded: boolean;
  /** Current snapped tile position for the moving node, or null. */
  currentTile: { x: number; y: number } | null;
  /** Whether currentTile is a legal place to drop. */
  valid: boolean;
  /** A group drag: every member, and where each started. Null for every other kind. */
  members: GroupMember[] | null;
  /** A group drag's offset from where it started, in whole tiles. */
  delta: { dx: number; dy: number } | null;
  /** A marquee's far corner, in screen pixels. The near corner is `originScreen`. */
  currentScreen: { x: number; y: number } | null;
}

export const NO_DRAG: DragState = {
  kind: 'none',
  originScreen: { x: 0, y: 0 },
  originCamera: { x: 0, y: 0 },
  nodeId: null,
  originTile: null,
  originFootprint: null,
  currentFootprint: null,
  exceeded: false,
  currentTile: null,
  valid: true,
  members: null,
  delta: null,
  currentScreen: null
};

export interface BeginDragInput {
  button: number;
  screen: { x: number; y: number };
  camera: { x: number; y: number; zoom: number };
  /** The node under the cursor, if any. */
  hit: NodeRect | null;
  /** Node dragging is only offered in Edit Board mode. */
  editMode: boolean;
  /** Printed-only kinds are not draggable — they have no footprint to move. */
  nodeTile?: { x: number; y: number } | null;
  /** The node's footprint, needed to start a resize. */
  nodeFootprint?: { w: number; h: number } | null;
  /**
   * True when the press landed on the selected node's corner resize handle. Decided by the
   * caller, which is the only place that knows where the handle was actually drawn.
   */
  onResizeHandle?: boolean;
  /** Shift was held. On empty substrate in Edit Board mode, that draws a selection box. */
  shiftKey?: boolean;
  /** The current group selection. Pressing on any member of a group of two or more moves all of it. */
  group?: GroupMember[];
}

export function beginDrag(input: BeginDragInput): DragState {
  const base: DragState = {
    ...NO_DRAG,
    originScreen: { ...input.screen },
    originCamera: { x: input.camera.x, y: input.camera.y }
  };

  // Middle button always pans, over a node or not — it is the gesture that never has to think
  // about what is underneath it.
  if (input.button === 1) return { ...base, kind: 'pan' };
  if (input.button !== 0) return NO_DRAG;

  /*
   * Shift-drag on empty substrate draws a selection box. Shift, rather than taking over the plain
   * drag, because a plain drag on the substrate pans in Edit Board mode and is in William's hands
   * already. Only in Edit Board mode, for the same reason moving is: selecting a group is the
   * first half of rearranging one.
   */
  if (input.editMode && input.shiftKey && !input.hit) {
    return { ...base, kind: 'marquee', currentScreen: { ...input.screen } };
  }

  if (input.editMode && input.hit && input.nodeTile) {
    // The handle wins over the body: it is drawn on top of the node's bottom-right corner, so a
    // press there is unambiguously a resize even though it is also inside the node.
    if (input.onResizeHandle && input.nodeFootprint) {
      return {
        ...base,
        kind: 'resize',
        nodeId: input.hit.nodeId,
        originTile: { ...input.nodeTile },
        originFootprint: { ...input.nodeFootprint },
        currentFootprint: { ...input.nodeFootprint }
      };
    }
    // A press on any member of a group moves the whole group, rigidly, by whole tiles.
    const group = input.group ?? [];
    const hitId = input.hit.nodeId;
    if (group.length > 1 && group.some((m) => m.nodeId === hitId)) {
      return {
        ...base,
        kind: 'group',
        nodeId: hitId,
        members: group.map((m) => ({ ...m, originTile: { ...m.originTile }, footprint: { ...m.footprint } })),
        delta: { dx: 0, dy: 0 }
      };
    }
    return {
      ...base,
      kind: 'move',
      nodeId: input.hit.nodeId,
      originTile: { ...input.nodeTile },
      currentTile: { ...input.nodeTile }
    };
  }

  // Left-drag on empty substrate pans. Left-drag on a node outside edit mode also pans, rather
  // than doing nothing — the alternative is a dead gesture over a third of the board.
  return { ...base, kind: 'pan' };
}

/** Has the pointer moved far enough for this to be a drag rather than a click? */
export function exceedsThreshold(state: DragState, screen: { x: number; y: number }): boolean {
  return Math.hypot(screen.x - state.originScreen.x, screen.y - state.originScreen.y) >= DRAG_THRESHOLD_PX;
}

/**
 * Camera position for a pan drag. Dragging right moves the board right, which means the camera
 * moves LEFT — grab-the-paper, not move-the-viewport. Getting this backwards is the single most
 * common pan bug.
 */
export function panTo(state: DragState, screen: { x: number; y: number }, zoom: number): { x: number; y: number } {
  return {
    x: state.originCamera.x - (screen.x - state.originScreen.x) / zoom,
    y: state.originCamera.y - (screen.y - state.originScreen.y) / zoom
  };
}

/**
 * Snapped tile position for a move drag. The delta is converted to tiles and rounded, so the
 * node steps a whole tile at a time — the grid is the point, and a node at a fractional tile
 * cannot be represented in the board JSON anyway.
 */
export function moveTo(
  state: DragState,
  screen: { x: number; y: number },
  zoom: number
): { x: number; y: number } {
  const origin = state.originTile ?? { x: 0, y: 0 };
  const dxTiles = Math.round((screen.x - state.originScreen.x) / zoom / TILE);
  const dyTiles = Math.round((screen.y - state.originScreen.y) / zoom / TILE);
  return { x: Math.max(0, origin.x + dxTiles), y: Math.max(0, origin.y + dyTiles) };
}

/**
 * Footprint for a resize drag, snapped to whole tiles.
 *
 * The node's top-left corner stays put and only the bottom-right follows the cursor, which is
 * what makes a resize feel like a resize rather than a move with extra steps. Never below 1x1:
 * a zero-tile component has no face to click and no way back.
 */
export function resizeTo(
  state: DragState,
  screen: { x: number; y: number },
  zoom: number,
  maxTiles: number
): { w: number; h: number } {
  const origin = state.originFootprint ?? { w: 1, h: 1 };
  const dwTiles = Math.round((screen.x - state.originScreen.x) / zoom / TILE);
  const dhTiles = Math.round((screen.y - state.originScreen.y) / zoom / TILE);
  return {
    w: Math.max(1, Math.min(maxTiles, origin.w + dwTiles)),
    h: Math.max(1, Math.min(maxTiles, origin.h + dhTiles))
  };
}

/** Did a resize drag actually change the footprint? */
export function shouldCommitResize(state: DragState): boolean {
  if (state.kind !== 'resize' || !state.exceeded || !state.valid) return false;
  if (!state.originFootprint || !state.currentFootprint) return false;
  return (
    state.originFootprint.w !== state.currentFootprint.w ||
    state.originFootprint.h !== state.currentFootprint.h
  );
}

/**
 * Is this tile position a legal home for the node? Off-board and overlapping are both illegal,
 * and both are exactly what `validate-board.mjs` and the command bus would reject — so checking
 * here means the ghost turns red before the drop rather than the drop failing with a toast.
 */
/**
 * Kinds that are PRINTED on the board rather than mounted to it.
 *
 * They occupy no grid, so they are neither obstacles to anything else nor obstructed by anything
 * else. That has to hold in BOTH directions, and getting only one of them right is a subtle bug:
 * a backdrop was correctly ignored when a chip was dropped on it, and then refused to be dragged
 * anywhere itself, because the check only skipped printed kinds in the "other" position.
 *
 * Kept in step with `PRINTED_ONLY` in layout.ts, `graphProblems` in board-store.ts, and the
 * overlap check in tools/validate-board.mjs. Four copies of one rule; see docs/DECISIONS.md.
 */
export const PRINTED_KINDS: readonly string[] = SHARED_PRINTED_KINDS;

export function canDrop(
  nodeId: string,
  tile: { x: number; y: number },
  footprint: { w: number; h: number },
  others: NodeRect[],
  grid: { width: number; height: number },
  /** The kind being moved. Printed kinds are bounded by the board and by nothing else. */
  movingKind?: string
): boolean {
  if (tile.x < 0 || tile.y < 0) return false;
  if (tile.x + footprint.w > grid.width || tile.y + footprint.h > grid.height) return false;

  /*
   * A backdrop is scenery and a zone is a bracket drawn AROUND things. Both are meant to sit over
   * or under components — that is the entire job — so the only rule either has to obey is staying
   * on the board.
   */
  if (movingKind && PRINTED_KINDS.includes(movingKind)) return true;

  const left = tile.x * TILE;
  const top = tile.y * TILE;
  const right = left + footprint.w * TILE;
  const bottom = top + footprint.h * TILE;

  for (const other of others) {
    if (other.nodeId === nodeId) continue;
    // The same rule from the other side: printed kinds are never obstacles, or a board with a
    // full-room backdrop would have nowhere legal to drop anything at all.
    if (PRINTED_KINDS.includes(other.kind)) continue;
    const overlaps = left < other.x + other.w && right > other.x && top < other.y + other.h && bottom > other.y;
    if (overlaps) return false;
  }
  return true;
}

/** Did a move drag actually change anything worth committing? */
export function shouldCommit(state: DragState): boolean {
  if (state.kind !== 'move' || !state.exceeded || !state.valid) return false;
  if (!state.originTile || !state.currentTile) return false;
  return state.originTile.x !== state.currentTile.x || state.originTile.y !== state.currentTile.y;
}

/* ────────────────────────── group selection ────────────────────────── */

/**
 * The offset of a group drag, in whole tiles.
 *
 * Clamped so no member is dragged past the top or left edge: the group moves as one rigid piece,
 * so the member nearest an edge decides how far the whole group may go. The right and bottom
 * edges are left to `canDropGroup`, which turns the ghosts red rather than stopping the drag,
 * the same as a single node does.
 */
export function groupDelta(state: DragState, screen: { x: number; y: number }, zoom: number): { dx: number; dy: number } {
  const members = state.members ?? [];
  if (!members.length) return { dx: 0, dy: 0 };
  let dx = Math.round((screen.x - state.originScreen.x) / zoom / TILE);
  let dy = Math.round((screen.y - state.originScreen.y) / zoom / TILE);
  const minX = Math.min(...members.map((m) => m.originTile.x));
  const minY = Math.min(...members.map((m) => m.originTile.y));
  dx = Math.max(dx, -minX);
  dy = Math.max(dy, -minY);
  return { dx: dx === 0 ? 0 : dx, dy: dy === 0 ? 0 : dy };
}

/** Where every member of a group lands for a given offset. */
export function groupTargets(members: readonly GroupMember[], delta: { dx: number; dy: number }): { nodeId: string; pos: { x: number; y: number } }[] {
  return members.map((m) => ({ nodeId: m.nodeId, pos: { x: m.originTile.x + delta.dx, y: m.originTile.y + delta.dy } }));
}

/**
 * Is this offset a legal home for the whole group?
 *
 * Each member obeys the same rule a single node does, against everything OUTSIDE the group. The
 * members themselves are not obstacles to each other: they move together, so two that did not
 * overlap before cannot overlap after, and a member sliding into the tile another member just
 * vacated is exactly what moving a cluster one tile to the right looks like.
 */
export function canDropGroup(
  members: readonly GroupMember[],
  delta: { dx: number; dy: number },
  others: NodeRect[],
  grid: { width: number; height: number }
): boolean {
  const inGroup = new Set(members.map((m) => m.nodeId));
  const outside = others.filter((o) => !inGroup.has(o.nodeId));
  return members.every((m) =>
    canDrop(m.nodeId, { x: m.originTile.x + delta.dx, y: m.originTile.y + delta.dy }, m.footprint, outside, grid, m.kind)
  );
}

/** Did a group drag actually move the group somewhere legal? */
export function shouldCommitGroup(state: DragState): boolean {
  if (state.kind !== 'group' || !state.exceeded || !state.valid || !state.delta) return false;
  return state.delta.dx !== 0 || state.delta.dy !== 0;
}

/** A selection box from two corners in any order, in world pixels. */
export function marqueeRect(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number; w: number; h: number } {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/**
 * The nodes a selection box catches.
 *
 * Components are caught by TOUCHING the box: a cluster of chips is selected by sweeping across
 * it, which is how every drawing program behaves. Printed things (backdrops, zones, parts, notes)
 * are caught only when the box holds them WHOLLY. A backdrop is usually as big as a room and
 * sits under everything, so if touching counted, every box drawn anywhere near it would pick it
 * up and the next drag would haul the scenery along with the chips.
 */
export function selectInRect(rects: readonly NodeRect[], box: { x: number; y: number; w: number; h: number }): string[] {
  const out: string[] = [];
  for (const r of rects) {
    const printed = PRINTED_KINDS.includes(r.kind);
    const hit = printed
      ? r.x >= box.x && r.y >= box.y && r.x + r.w <= box.x + box.w && r.y + r.h <= box.y + box.h
      : r.x < box.x + box.w && r.x + r.w > box.x && r.y < box.y + box.h && r.y + r.h > box.y;
    if (hit) out.push(r.nodeId);
  }
  return out;
}
