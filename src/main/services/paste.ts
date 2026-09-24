import type { GridPos } from '@shared/types.js';
import type { Actor } from '@shared/commands.js';
import { planPaste, type BoardClipboard } from '@shared/clipboard.js';
import { loadBoard } from './board-store.js';
import { apply } from './command-bus.js';
import { freeNodeId, nextDesignator } from './node-factory.js';

/**
 * Paste a copied cluster onto a board, as one `node.createMany`.
 *
 * Ids and designators come from the node factory, so a pasted via is `p_part_3` and a pasted chip
 * takes the room's next free U number, exactly as if it had been placed from the palette. The
 * command bus validates the result like every other edit, and one Ctrl+Z takes the paste back.
 */
export function pasteNodes(
  boardId: string,
  clip: BoardClipboard,
  anchor: GridPos,
  actor: Actor
): { ok: boolean; nodeIds?: string[]; error?: string } {
  const load = loadBoard(boardId);
  if (!load.ok) return { ok: false, error: load.error };
  if (!clip?.nodes?.length) return { ok: false, error: 'NOTHING TO PASTE' };

  const plan = planPaste(load.board, clip, anchor, {
    nodeId: (board, node) => freeNodeId(board, node.kind, node.name),
    designator: (board, node) => nextDesignator(board, node.kind)
  });
  if (!plan) return { ok: false, error: 'NO ROOM FOR THAT ON THIS BOARD' };

  const count = plan.nodes.length;
  const result = apply({
    command: { type: 'node.createMany', boardId, nodes: plan.nodes, edges: plan.edges },
    actor,
    label: count === 1 ? `paste ${plan.nodes[0]!.name}` : `paste ${count} nodes`
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, nodeIds: plan.nodes.map((n) => n.id) };
}
