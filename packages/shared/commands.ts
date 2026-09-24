/**
 * The command bus contract.
 *
 * CLAUDE.md prime directive 5: "Every board mutation goes through the same command bus with an
 * inverse. Ctrl+Z works in Edit Board mode, for user edits and for agent edits alike."
 *
 * That last clause is why the bus and its history live in the MAIN process, not the renderer.
 * A JARVIS edit arrives over MCP into main; a William edit arrives over IPC into main. Both hit
 * the same `apply`, both get snapshotted, both land on the same undo stack. If the stack lived
 * in the renderer, agent edits would be invisible to Ctrl+Z and the directive would be a lie.
 *
 * Every command carries enough information to be inverted exactly. `apply` returns the inverse
 * rather than computing it later, because the inverse of `node.update` needs the values that
 * were there BEFORE the patch, and those are gone once it is written.
 */

import type { BoardEdge, BoardLook, BoardNode, GridPos, Phantom } from './types.js';

export type Command =
  | { type: 'node.create'; boardId: string; node: BoardNode }
  | { type: 'node.update'; boardId: string; nodeId: string; patch: Partial<BoardNode> }
  | { type: 'node.move'; boardId: string; nodeId: string; pos: GridPos }
  /**
   * Several nodes moved together, as ONE command, so one Ctrl+Z puts the whole group back. A
   * group drag sent as N separate moves would take N undos, and every intermediate state would
   * be a half-moved cluster nobody ever asked for.
   */
  | { type: 'node.moveMany'; boardId: string; moves: { nodeId: string; pos: GridPos }[] }
  | { type: 'node.delete'; boardId: string; nodeId: string }
  /**
   * A paste: several nodes and the traces between them, as ONE command, so one Ctrl+Z takes the
   * whole pasted cluster back. See packages/shared/clipboard.ts.
   */
  | { type: 'node.createMany'; boardId: string; nodes: BoardNode[]; edges: BoardEdge[] }
  /**
   * The inverse of a paste. Destructive, like node.delete: reached through undo (which the human
   * already approved by making the paste), never as a way for an agent to clear a board.
   */
  | { type: 'node.removeMany'; boardId: string; nodeIds: string[]; edgeIds: string[] }
  | { type: 'edge.create'; boardId: string; edge: BoardEdge }
  | { type: 'edge.update'; boardId: string; edgeId: string; patch: Partial<BoardEdge> }
  | { type: 'edge.delete'; boardId: string; edgeId: string }
  /**
   * A board-level field. Only `look` for now, deliberately: the theme, the grid and the room's
   * identity have other consequences (substrate, bounds, descent) and get commands of their own
   * when something needs to change them. `look: null` removes it, which is the default look.
   */
  | { type: 'board.update'; boardId: string; patch: { look: BoardLook | null } }
  /**
   * Recommended nodes. See packages/shared/phantoms.ts for who may do what: anyone may propose
   * (at most MAX_PHANTOMS_PER_BOARD), William or its own proposer may dismiss, and only William may
   * approve. Approve carries the finished node and traces, built in main by the same factory as
   * `node:add`, so it creates, wires and clears the phantom as one undo step.
   */
  | { type: 'phantom.propose'; boardId: string; phantom: Phantom }
  | { type: 'phantom.dismiss'; boardId: string; phantomId: string }
  | { type: 'phantom.approve'; boardId: string; phantomId: string; node: BoardNode; edges: BoardEdge[] }
  /** The inverse of an approval. Removes a real node, so it is DESTRUCTIVE; undo is its only door. */
  | { type: 'phantom.unapprove'; boardId: string; phantom: Phantom; nodeId: string };

export type CommandType = Command['type'];

/**
 * Commands that destroy something. docs/07-SECURITY.md: "Delete a node, edge, or room — Always
 * requires explicit approval in the UI. No auto policy can override this." The bus enforces it
 * for agents; the UI confirms it for William.
 */
export const DESTRUCTIVE: readonly CommandType[] = ['node.delete', 'edge.delete', 'node.removeMany', 'phantom.unapprove'];

export function isDestructive(command: Command): boolean {
  return DESTRUCTIVE.includes(command.type);
}

/** Who asked. Every mutation is attributed so the activity feed can say who did what. */
/**
 * `remote` is William on another device (the remote bridge, docs/08): his own hand, so it may do
 * most of what `user` may, but it is attributed separately so the history says the phone did it.
 */
/**
 * `voice` is William speaking at the desk (packages/shared/voice.ts). Like `remote`, it is his own
 * hand and may do most of what `user` may — but it is attributed separately, because a command
 * nobody typed should be identifiable in the history afterwards, and because a microphone cannot
 * approve a deletion: a destructive command from `voice` carries no approval and stops at the
 * dialog, exactly as one from an agent does.
 */
export type Actor = 'user' | 'jarvis' | 'agent' | 'remote' | 'voice' | 'gesture';

/**
 * The actors that ARE William, folded to `user` for rules written about him.
 *
 * `remote` is his phone, `voice` is him speaking at the desk, `gesture` is his hand in front of the
 * cameras. Each is attributed separately in the history — a change nobody typed should be
 * identifiable afterwards — but a rule like "only William may approve a recommendation" means all
 * four. Two places needed this and both were growing a ternary; `phantomActorRefusal` and
 * `phantomFromProposal` now take the result of this instead.
 *
 * What this does NOT do is grant approval: `approved` on a CommandRequest still means "a human
 * confirmed THIS command in THIS exchange", and neither a microphone nor a camera can do that. A
 * destructive command from any of these three arrives unapproved and stops at the dialog.
 */
export function asWilliam(actor: Actor): 'user' | 'jarvis' | 'agent' {
  return actor === 'remote' || actor === 'voice' || actor === 'gesture' ? 'user' : actor;
}

export interface CommandRequest {
  command: Command;
  actor: Actor;
  /** Free text for the history entry, e.g. "set cwd". Shown in the undo tooltip. */
  label?: string;
  /**
   * Required for destructive commands. The caller asserts a human approved THIS command in THIS
   * exchange. It is not a flag an agent may set for itself — main only honours it from the
   * renderer's own confirmed-dialog path.
   */
  approved?: boolean;
}

/** One line of history, as the undo stack sees it. */
export interface HistoryEntry {
  id: number;
  boardId: string;
  actor: Actor;
  label: string;
  type: CommandType;
  at: string;
  /** Field names this entry touched, for a one-line "what changed" without a full diff. */
  changed: string[];
}

export type CommandResult =
  | {
      ok: true;
      /** Field-level summary of what actually changed. Empty means the command was a no-op. */
      changed: ChangedField[];
      history: HistoryStatus;
      /** Absolute path of the pre-mutation snapshot, so recovery is never a guess. */
      snapshot: string | null;
    }
  | { ok: false; error: string; needsApproval?: boolean };

export interface ChangedField {
  path: string;
  before: unknown;
  after: unknown;
}

export interface HistoryStatus {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  entries: HistoryEntry[];
}

/** A short human sentence for a command, used as the default history label. */
export function describeCommand(command: Command): string {
  switch (command.type) {
    case 'node.create': return `create ${command.node.kind} ${command.node.name}`;
    case 'node.update': return `update ${command.nodeId} (${Object.keys(command.patch).join(', ')})`;
    case 'node.move': return `move ${command.nodeId} to ${command.pos.x},${command.pos.y}`;
    case 'node.moveMany': return `move ${command.moves.length} nodes`;
    case 'node.delete': return `delete node ${command.nodeId}`;
    case 'node.createMany': return `paste ${command.nodes.length} node(s)`;
    case 'node.removeMany': return `remove ${command.nodeIds.length} node(s)`;
    case 'edge.create': return `wire ${command.edge.from} → ${command.edge.to}`;
    case 'edge.update': return `update trace ${command.edgeId}`;
    case 'edge.delete': return `delete trace ${command.edgeId}`;
    case 'board.update': return command.patch.look ? 'change board look' : 'reset board look';
    case 'phantom.propose': return `recommend ${command.phantom.kind} ${command.phantom.name}`;
    case 'phantom.dismiss': return `dismiss recommendation ${command.phantomId}`;
    case 'phantom.approve': return `approve ${command.node.kind} ${command.node.name}`;
    case 'phantom.unapprove': return `un-approve ${command.nodeId}`;
  }
}
