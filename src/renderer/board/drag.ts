/**
 * Drag state. Pure — no Pixi, no DOM — so test/drag.test.ts can prove the two behaviours the
 * board needs and the rules that keep them from fighting each other.
 *
 * Two gestures, distinguished by what is under the cursor when the button goes down:
 *
 *   - **Pan** — left-drag on empty substrate, or middle-drag anywhere. docs/01 §Navigation.
 *   - **Move** — left-drag on a node, and only in Edit Board mode. Browsing a board involves a
 *     lot of clicking, and a click that drifts two pixels must not silently relocate a
 *     component, so moving is gated behind `E`.
 *
 * A drag also has to not eat clicks: a press and release with no real movement is a selection,
 * not a zero-distance drag. DRAG_THRESHOLD_PX is what separates them.
 */

import type { NodeRect } from './layout.js';
import { TILE } from './camera.js';

/** Movement below this, in screen pixels, is a click. At 4px a deliberate drag still registers. */
export const DRAG_THRESHOLD_PX = 4;

export type DragKind = 'none' | 'pan' | 'move';

export interface DragState {
  kind: DragKind;
  /** Screen position where the button went down. */
  originScreen: { x: number; y: number };
  /** Camera position when the drag started, for pan. */
  originCamera: { x: number; y: number };
  /** The node being moved, and its tile position when the drag started. */
  nodeId: string | null;
  originTile: { x: number; y: number } | null;
  /** True once movement has exceeded the threshold. Until then this is still a click. */
  exceeded: boolean;
  /** Current snapped tile position for the moving node, or null. */
  currentTile: { x: number; y: number } | null;
  /** Whether currentTile is a legal place to drop. */
  valid: boolean;
}

export const NO_DRAG: DragState = {
  kind: 'none',
  originScreen: { x: 0, y: 0 },
  originCamera: { x: 0, y: 0 },
  nodeId: null,
  originTile: null,
  exceeded: false,
  currentTile: null,
  valid: true
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

  if (input.editMode && input.hit && input.nodeTile) {
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
 * Is this tile position a legal home for the node? Off-board and overlapping are both illegal,
 * and both are exactly what `validate-board.mjs` and the command bus would reject — so checking
 * here means the ghost turns red before the drop rather than the drop failing with a toast.
 */
export function canDrop(
  nodeId: string,
  tile: { x: number; y: number },
  footprint: { w: number; h: number },
  others: NodeRect[],
  grid: { width: number; height: number }
): boolean {
  if (tile.x < 0 || tile.y < 0) return false;
  if (tile.x + footprint.w > grid.width || tile.y + footprint.h > grid.height) return false;

  const left = tile.x * TILE;
  const top = tile.y * TILE;
  const right = left + footprint.w * TILE;
  const bottom = top + footprint.h * TILE;

  for (const other of others) {
    if (other.nodeId === nodeId) continue;
    // Zones deliberately overlap their members, so they are not obstacles.
    if (other.kind === 'group.zone') continue;
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
