/**
 * Node geometry and hit-testing. Pure — no Pixi, no DOM — so test/layout.test.ts can prove the
 * click target matches what is drawn, which is the kind of bug that is miserable to chase by eye.
 */

import type { Board, BoardNode } from '@shared/types.js';
import { footprintOf } from '@shared/types.js';
import { TILE } from './camera.js';

export interface NodeRect {
  nodeId: string;
  kind: BoardNode['kind'];
  /** World pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Kinds that are printed on the board and are not click targets on the canvas. */
const PRINTED_ONLY = new Set<BoardNode['kind']>(['note.silk']);

export function nodeRect(node: BoardNode): NodeRect {
  const fp = footprintOf(node);
  return {
    nodeId: node.id,
    kind: node.kind,
    x: node.pos.x * TILE,
    y: node.pos.y * TILE,
    w: Math.max(TILE, fp.w * TILE),
    h: Math.max(TILE, fp.h * TILE)
  };
}

export function layoutRects(board: Board): NodeRect[] {
  return board.nodes.filter((n) => !PRINTED_ONLY.has(n.kind)).map(nodeRect);
}

function contains(rect: NodeRect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

function area(rect: NodeRect): number {
  return rect.w * rect.h;
}

/**
 * The node at a world point, or null.
 *
 * Zones overlap the components inside them by design, so a plain "first match" would make every
 * click inside THE STALKER select the zone and nothing else. Smallest-area-wins picks the
 * component and still lets you select the zone by clicking its empty margin.
 */
export function hitTest(rects: NodeRect[], x: number, y: number): NodeRect | null {
  let best: NodeRect | null = null;
  for (const rect of rects) {
    if (!contains(rect, x, y)) continue;
    if (!best || area(rect) < area(best)) best = rect;
  }
  return best;
}

/**
 * Reading order for Tab cycling: top to bottom, then left to right, banded into rows so that
 * two components at nearly the same height are visited left-to-right rather than by a
 * one-pixel y difference. Full keyboard operation is a requirement, not a nicety (docs/01).
 */
export function readingOrder(rects: NodeRect[], bandTiles = 4): NodeRect[] {
  const band = bandTiles * TILE;
  return [...rects].sort((a, b) => {
    const rowA = Math.floor(a.y / band);
    const rowB = Math.floor(b.y / band);
    if (rowA !== rowB) return rowA - rowB;
    if (a.x !== b.x) return a.x - b.x;
    return a.nodeId.localeCompare(b.nodeId);
  });
}

export function nextInOrder(rects: NodeRect[], currentId: string | null, direction: 1 | -1): string | null {
  const order = readingOrder(rects);
  if (!order.length) return null;
  if (!currentId) return (direction === 1 ? order[0] : order[order.length - 1])!.nodeId;
  const index = order.findIndex((r) => r.nodeId === currentId);
  if (index === -1) return order[0]!.nodeId;
  const next = (index + direction + order.length) % order.length;
  return order[next]!.nodeId;
}

/** Camera position that centres a rect in the viewport — used when Tab moves off screen. */
export function centreOn(rect: NodeRect, zoom: number, view: { width: number; height: number }): { x: number; y: number } {
  return {
    x: rect.x + rect.w / 2 - view.width / (2 * zoom),
    y: rect.y + rect.h / 2 - view.height / (2 * zoom)
  };
}

/** Is a rect fully inside the current viewport? If not, Tab should scroll to it. */
export function isVisible(
  rect: NodeRect,
  camera: { x: number; y: number; zoom: number },
  view: { width: number; height: number }
): boolean {
  const left = camera.x;
  const top = camera.y;
  const right = camera.x + view.width / camera.zoom;
  const bottom = camera.y + view.height / camera.zoom;
  return rect.x >= left && rect.y >= top && rect.x + rect.w <= right && rect.y + rect.h <= bottom;
}

/**
 * Free grid space for a new node of a given footprint, scanning in reading order. This is what
 * the palette uses when you add a node without dragging it somewhere — a node placed on top of
 * another one fails validation, so the placer has to find a real gap.
 */
export function findFreeSpace(
  board: Board,
  footprint: { w: number; h: number },
  startTile: { x: number; y: number } = { x: 1, y: 1 }
): { x: number; y: number } | null {
  const occupied = new Set<string>();
  for (const node of board.nodes) {
    if (node.kind === 'note.silk' || node.kind === 'group.zone') continue;
    const fp = footprintOf(node);
    for (let y = node.pos.y; y < node.pos.y + fp.h; y++) {
      for (let x = node.pos.x; x < node.pos.x + fp.w; x++) occupied.add(`${x},${y}`);
    }
  }

  const fits = (ox: number, oy: number): boolean => {
    if (ox + footprint.w > board.grid.width || oy + footprint.h > board.grid.height) return false;
    for (let y = oy; y < oy + footprint.h; y++) {
      for (let x = ox; x < ox + footprint.w; x++) if (occupied.has(`${x},${y}`)) return false;
    }
    return true;
  };

  for (let y = startTile.y; y <= board.grid.height - footprint.h; y++) {
    for (let x = startTile.x; x <= board.grid.width - footprint.w; x++) {
      if (fits(x, y)) return { x, y };
    }
  }
  return null;
}
