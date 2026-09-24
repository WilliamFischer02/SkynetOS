import type { Board, BoardEdge, BoardNode, GridPos } from './types.js';
import { footprintOf, isPrinted } from './types.js';

/**
 * Copy and paste for board nodes.
 *
 * William: "add the ability to duplicate decor nodes / aesthetic objects — Ctrl+C Ctrl+V, as well
 * as right click selected node or cluster and click copy, then right click somewhere else on the
 * board and click paste."
 *
 * A copy is the nodes themselves plus every trace that runs BETWEEN two of them, so a copied
 * cluster pastes wired the way it was. A trace to something outside the selection is left behind:
 * pasting it would mean wiring the duplicate to the original's neighbour, which nobody asked for.
 *
 * Pure. Ids and designators come from the caller (main's node factory owns those rules), and the
 * command bus validates the result like any other edit.
 */

export interface BoardClipboard {
  /** The board the nodes were copied from. A paste into a different room drops dangling references. */
  sourceBoardId: string;
  nodes: BoardNode[];
  edges: BoardEdge[];
}

export function copySelection(board: Board, ids: readonly string[]): BoardClipboard | null {
  const wanted = new Set(ids);
  const nodes = board.nodes.filter((n) => wanted.has(n.id));
  if (!nodes.length) return null;
  const kept = new Set(nodes.map((n) => n.id));
  const edges = board.edges.filter((e) => kept.has(e.from) && kept.has(e.to));
  return {
    sourceBoardId: board.id,
    nodes: JSON.parse(JSON.stringify(nodes)) as BoardNode[],
    edges: JSON.parse(JSON.stringify(edges)) as BoardEdge[]
  };
}

/** Top-left of a cluster, in tiles. The paste anchor lands here. */
export function clusterOrigin(nodes: readonly BoardNode[]): GridPos {
  return {
    x: Math.min(...nodes.map((n) => n.pos.x)),
    y: Math.min(...nodes.map((n) => n.pos.y))
  };
}

/**
 * The offset nearest `desired` at which every mounted node in the cluster fits: inside the board
 * and clear of every mounted node already there. Printed kinds never collide (PRINTED_KINDS), so a
 * cluster of decor always lands exactly where it was asked to.
 */
export function clusterOffset(board: Board, nodes: readonly BoardNode[], desired: GridPos): GridPos | null {
  const occupied = new Set<string>();
  for (const node of board.nodes) {
    if (isPrinted(node.kind)) continue;
    const fp = footprintOf(node);
    for (let y = node.pos.y; y < node.pos.y + fp.h; y++) {
      for (let x = node.pos.x; x < node.pos.x + fp.w; x++) occupied.add(`${x},${y}`);
    }
  }

  const fits = (dx: number, dy: number): boolean => {
    for (const node of nodes) {
      const x0 = node.pos.x + dx;
      const y0 = node.pos.y + dy;
      if (x0 < 0 || y0 < 0 || x0 >= board.grid.width || y0 >= board.grid.height) return false;
      if (isPrinted(node.kind)) continue;
      const fp = footprintOf(node);
      if (x0 + fp.w > board.grid.width || y0 + fp.h > board.grid.height) return false;
      for (let y = y0; y < y0 + fp.h; y++) {
        for (let x = x0; x < x0 + fp.w; x++) if (occupied.has(`${x},${y}`)) return false;
      }
    }
    return true;
  };

  if (fits(desired.x, desired.y)) return { ...desired };
  // Expanding square rings, like placement.ts: the first fit is the nearest one.
  const maxRadius = Math.max(board.grid.width, board.grid.height);
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (fits(desired.x + dx, desired.y + dy)) return { x: desired.x + dx, y: desired.y + dy };
      }
    }
  }
  return null;
}

export interface PasteNaming {
  /** A free node id on `board` for this node. The board passed already holds earlier pastes. */
  nodeId: (board: Board, node: BoardNode) => string;
  /** The next free designator for this node's kind, or undefined for kinds that carry none. */
  designator: (board: Board, node: BoardNode) => string | undefined;
}

function freeEdgeId(edges: readonly BoardEdge[]): string {
  const taken = new Set(edges.map((e) => e.id));
  for (let i = 1; i < 100_000; i++) {
    if (!taken.has(`e${i}`)) return `e${i}`;
  }
  return `e${Date.now()}`;
}

/**
 * The nodes and traces a paste creates: fresh ids and designators, positions moved so the
 * cluster's top-left lands on `anchor` (or the nearest place it fits), and every internal
 * reference (trace ends, a zone's members, a prompt box's target) pointed at the copies.
 */
export function planPaste(
  target: Board,
  clip: BoardClipboard,
  anchor: GridPos,
  naming: PasteNaming
): { nodes: BoardNode[]; edges: BoardEdge[] } | null {
  if (!clip.nodes.length) return null;
  const origin = clusterOrigin(clip.nodes);
  const offset = clusterOffset(target, clip.nodes, {
    x: Math.round(anchor.x) - origin.x,
    y: Math.round(anchor.y) - origin.y
  });
  if (!offset) return null;

  // A working copy that grows as nodes are named, so two pasted parts never get the same id.
  const working: Board = { ...target, nodes: [...target.nodes], edges: [...target.edges] };
  const idMap = new Map<string, string>();
  const nodes: BoardNode[] = [];

  for (const original of clip.nodes) {
    const node = JSON.parse(JSON.stringify(original)) as BoardNode;
    node.id = naming.nodeId(working, node);
    node.pos = { x: original.pos.x + offset.x, y: original.pos.y + offset.y };
    if (original.designator) {
      const designator = naming.designator(working, node);
      if (designator) node.designator = designator;
      else delete node.designator;
    }
    idMap.set(original.id, node.id);
    working.nodes.push(node);
    nodes.push(node);
  }

  const existing = new Set(target.nodes.map((n) => n.id));
  for (const node of nodes) {
    if (node.members) {
      node.members = node.members
        .map((id) => idMap.get(id) ?? (existing.has(id) ? id : null))
        .filter((id): id is string => id !== null);
    }
    if (node.promptTarget) {
      const mapped = idMap.get(node.promptTarget) ?? (existing.has(node.promptTarget) ? node.promptTarget : null);
      if (mapped) node.promptTarget = mapped;
      else delete node.promptTarget;
    }
  }

  const edges: BoardEdge[] = [];
  for (const original of clip.edges) {
    const from = idMap.get(original.from);
    const to = idMap.get(original.to);
    if (!from || !to) continue;
    const edge: BoardEdge = { ...JSON.parse(JSON.stringify(original)) as BoardEdge, id: freeEdgeId(working.edges), from, to };
    // Hand-placed waypoints belong to the original's route; the router draws the copy's own.
    delete edge.waypoints;
    working.edges.push(edge);
    edges.push(edge);
  }

  return { nodes, edges };
}
