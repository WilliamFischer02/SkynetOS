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

import type { BoardEdge, BoardNode, GridPos } from './types.js';

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
  | { type: 'edge.create'; boardId: string; edge: BoardEdge }
  | { type: 'edge.update'; boardId: string; edgeId: string; patch: Partial<BoardEdge> }
  | { type: 'edge.delete'; boardId: string; edgeId: string };

export type CommandType = Command['type'];

/**
 * Commands that destroy something. docs/07-SECURITY.md: "Delete a node, edge, or room — Always
 * requires explicit approval in the UI. No auto policy can override this." The bus enforces it
 * for agents; the UI confirms it for William.
 */
export const DESTRUCTIVE: readonly CommandType[] = ['node.delete', 'edge.delete'];

export function isDestructive(command: Command): boolean {
  return DESTRUCTIVE.includes(command.type);
}

/** Who asked. Every mutation is attributed so the activity feed can say who did what. */
export type Actor = 'user' | 'jarvis' | 'agent';

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
    case 'edge.create': return `wire ${command.edge.from} → ${command.edge.to}`;
    case 'edge.update': return `update trace ${command.edgeId}`;
    case 'edge.delete': return `delete trace ${command.edgeId}`;
  }
}
