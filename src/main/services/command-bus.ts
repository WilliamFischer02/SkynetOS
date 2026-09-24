import type { Board, BoardEdge, BoardNode } from '@shared/types.js';
import {
  asWilliam,
  describeCommand,
  isDestructive,
  type ChangedField,
  type Command,
  type CommandRequest,
  type CommandResult,
  type HistoryEntry,
  type HistoryStatus
} from '@shared/commands.js';
import { cloneBoard, loadBoard, snapshot, validateBoard, writeBoard } from './board-store.js';
import { getSettings } from './settings.js';
import { markActivity } from './activity.js';
import { approvedBoard, phantomActorRefusal, unapprovedBoard, withPhantom, withoutPhantom } from '@shared/phantoms.js';
import { applyLookPatch } from '@shared/look.js';

/**
 * One bus, one history, for every board mutation from any source.
 *
 * The invariant: `apply` is the only function in the program that writes a board file. Everything
 * else — the inspector's save button, a drag in Edit Board mode, a JARVIS `node_update` over
 * MCP — builds a Command and hands it here. That is what makes Ctrl+Z work identically for a
 * user edit and an agent edit, and it is what guarantees every mutation was snapshotted first.
 *
 * `apply` returns the exact inverse alongside the result, and the inverse goes on the undo stack.
 * The inverse of an update needs the pre-patch values, which are gone the moment it is written,
 * so it is computed at apply time and never recomputed.
 */

interface HistoryItem {
  entry: HistoryEntry;
  /** The command that undoes what this item did. */
  inverse: Command;
  /** The command that was applied, so redo can replay it. */
  forward: Command;
}

const undoStack: HistoryItem[] = [];
const redoStack: HistoryItem[] = [];
let nextHistoryId = 1;

function loadOrThrow(boardId: string): Board {
  const load = loadBoard(boardId);
  if (!load.ok) throw new Error(load.error);
  return load.board;
}

/** Field-level diff of a patch against the node it will be applied to. */
function diffPatch(before: Record<string, unknown>, patch: Record<string, unknown>): ChangedField[] {
  const changed: ChangedField[] = [];
  for (const [key, after] of Object.entries(patch)) {
    const prev = before[key];
    if (JSON.stringify(prev) === JSON.stringify(after)) continue;
    changed.push({ path: key, before: prev, after });
  }
  return changed;
}

/**
 * Apply a command to a cloned board and return the new board, the inverse command, and what
 * changed. Pure with respect to disk — nothing is written here.
 */
function transform(board: Board, command: Command): { next: Board; inverse: Command; changed: ChangedField[] } {
  const next = cloneBoard(board);

  switch (command.type) {
    case 'node.create': {
      if (next.nodes.some((n) => n.id === command.node.id)) {
        throw new Error(`NODE ID ALREADY EXISTS — "${command.node.id}"`);
      }
      next.nodes.push(command.node);
      return {
        next,
        inverse: { type: 'node.delete', boardId: command.boardId, nodeId: command.node.id },
        changed: [{ path: command.node.id, before: undefined, after: command.node }]
      };
    }

    case 'node.update': {
      const index = next.nodes.findIndex((n) => n.id === command.nodeId);
      if (index === -1) throw new Error(`NO SUCH NODE — "${command.nodeId}"`);
      const current = next.nodes[index] as BoardNode;
      const changed = diffPatch(current as unknown as Record<string, unknown>, command.patch as Record<string, unknown>);

      // The inverse restores exactly the previous values, including restoring "absent" for a
      // field the patch added. undefined keys are stripped on write, which is what we want.
      const restore: Record<string, unknown> = {};
      for (const field of changed) restore[field.path] = field.before;

      const updated: Record<string, unknown> = { ...(current as unknown as Record<string, unknown>) };
      for (const [key, value] of Object.entries(command.patch)) {
        if (value === undefined) delete updated[key];
        else updated[key] = value;
      }
      next.nodes[index] = updated as unknown as BoardNode;

      return {
        next,
        inverse: { type: 'node.update', boardId: command.boardId, nodeId: command.nodeId, patch: restore as Partial<BoardNode> },
        changed
      };
    }

    case 'node.move': {
      const node = next.nodes.find((n) => n.id === command.nodeId);
      if (!node) throw new Error(`NO SUCH NODE — "${command.nodeId}"`);
      const before = { ...node.pos };
      node.pos = { x: command.pos.x, y: command.pos.y };
      return {
        next,
        inverse: { type: 'node.move', boardId: command.boardId, nodeId: command.nodeId, pos: before },
        changed: [{ path: 'pos', before, after: node.pos }]
      };
    }

    case 'node.moveMany': {
      /*
       * All or nothing. Every id is checked before anything moves, and the whole result is
       * validated once by `apply`, so a group that would land one member on top of a chip is
       * refused as a group rather than half-applied.
       */
      const seen = new Set<string>();
      for (const move of command.moves) {
        if (seen.has(move.nodeId)) throw new Error(`NODE LISTED TWICE IN ONE MOVE — "${move.nodeId}"`);
        seen.add(move.nodeId);
        if (!next.nodes.some((n) => n.id === move.nodeId)) throw new Error(`NO SUCH NODE — "${move.nodeId}"`);
      }
      const restore: { nodeId: string; pos: { x: number; y: number } }[] = [];
      const changed: ChangedField[] = [];
      for (const move of command.moves) {
        const node = next.nodes.find((n) => n.id === move.nodeId) as BoardNode;
        if (node.pos.x === move.pos.x && node.pos.y === move.pos.y) continue;
        const before = { ...node.pos };
        node.pos = { x: move.pos.x, y: move.pos.y };
        restore.push({ nodeId: move.nodeId, pos: before });
        changed.push({ path: `${move.nodeId}.pos`, before, after: node.pos });
      }
      return {
        next,
        inverse: { type: 'node.moveMany', boardId: command.boardId, moves: restore },
        changed
      };
    }

    case 'node.delete': {
      const index = next.nodes.findIndex((n) => n.id === command.nodeId);
      if (index === -1) throw new Error(`NO SUCH NODE — "${command.nodeId}"`);
      const [removed] = next.nodes.splice(index, 1);
      // Traces attached to a deleted node would dangle and fail validation, so they go too —
      // and the inverse has to put them back. This is why undo restores the whole cluster.
      const orphanedEdges = next.edges.filter((e) => e.from === command.nodeId || e.to === command.nodeId);
      next.edges = next.edges.filter((e) => e.from !== command.nodeId && e.to !== command.nodeId);

      return {
        next,
        inverse: {
          type: 'node.create',
          boardId: command.boardId,
          node: removed as BoardNode,
          // Edges are restored by the composite undo below; see applyInverseBundle.
          ...(orphanedEdges.length ? { restoreEdges: orphanedEdges } : {})
        } as Command,
        changed: [
          { path: command.nodeId, before: removed, after: undefined },
          ...orphanedEdges.map((e) => ({ path: `trace ${e.id}`, before: e, after: undefined }))
        ]
      };
    }

    case 'node.createMany': {
      /*
       * A paste. All or nothing: every id is checked before anything is added, and `apply`
       * validates the whole result once, so a paste that would not validate lands nowhere.
       */
      const nodeIds = new Set(next.nodes.map((n) => n.id));
      for (const node of command.nodes) {
        if (nodeIds.has(node.id)) throw new Error(`NODE ID ALREADY EXISTS — "${node.id}"`);
        nodeIds.add(node.id);
      }
      const edgeIds = new Set(next.edges.map((e) => e.id));
      for (const edge of command.edges) {
        if (edgeIds.has(edge.id)) throw new Error(`TRACE ID ALREADY EXISTS — "${edge.id}"`);
        if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) throw new Error(`TRACE ${edge.id} HAS AN END THAT DOES NOT EXIST`);
        edgeIds.add(edge.id);
      }
      next.nodes.push(...command.nodes);
      next.edges.push(...command.edges);
      return {
        next,
        inverse: {
          type: 'node.removeMany',
          boardId: command.boardId,
          nodeIds: command.nodes.map((n) => n.id),
          edgeIds: command.edges.map((e) => e.id)
        },
        changed: [
          ...command.nodes.map((n) => ({ path: n.id, before: undefined, after: n })),
          ...command.edges.map((e) => ({ path: `trace ${e.id}`, before: undefined, after: e }))
        ]
      };
    }

    case 'node.removeMany': {
      const gone = new Set(command.nodeIds);
      for (const id of gone) {
        if (!next.nodes.some((n) => n.id === id)) throw new Error(`NO SUCH NODE — "${id}"`);
      }
      const removedNodes = next.nodes.filter((n) => gone.has(n.id));
      // The named traces, and any trace left dangling by a removed node, so the result validates
      // and the inverse puts every one of them back.
      const edgeGone = new Set(command.edgeIds);
      const removedEdges = next.edges.filter((e) => edgeGone.has(e.id) || gone.has(e.from) || gone.has(e.to));
      const removedEdgeIds = new Set(removedEdges.map((e) => e.id));
      next.nodes = next.nodes.filter((n) => !gone.has(n.id));
      next.edges = next.edges.filter((e) => !removedEdgeIds.has(e.id));
      return {
        next,
        inverse: { type: 'node.createMany', boardId: command.boardId, nodes: removedNodes, edges: removedEdges },
        changed: [
          ...removedNodes.map((n) => ({ path: n.id, before: n, after: undefined })),
          ...removedEdges.map((e) => ({ path: `trace ${e.id}`, before: e, after: undefined }))
        ]
      };
    }

    case 'edge.create': {
      if (next.edges.some((e) => e.id === command.edge.id)) {
        throw new Error(`TRACE ID ALREADY EXISTS — "${command.edge.id}"`);
      }
      next.edges.push(command.edge);
      return {
        next,
        inverse: { type: 'edge.delete', boardId: command.boardId, edgeId: command.edge.id },
        changed: [{ path: `trace ${command.edge.id}`, before: undefined, after: command.edge }]
      };
    }

    case 'edge.update': {
      const index = next.edges.findIndex((e) => e.id === command.edgeId);
      if (index === -1) throw new Error(`NO SUCH TRACE — "${command.edgeId}"`);
      const current = next.edges[index] as BoardEdge;
      const changed = diffPatch(current as unknown as Record<string, unknown>, command.patch as Record<string, unknown>);
      const restore: Record<string, unknown> = {};
      for (const field of changed) restore[field.path] = field.before;

      const updated: Record<string, unknown> = { ...(current as unknown as Record<string, unknown>) };
      for (const [key, value] of Object.entries(command.patch)) {
        if (value === undefined) delete updated[key];
        else updated[key] = value;
      }
      next.edges[index] = updated as unknown as BoardEdge;

      return {
        next,
        inverse: { type: 'edge.update', boardId: command.boardId, edgeId: command.edgeId, patch: restore as Partial<BoardEdge> },
        changed
      };
    }

    case 'edge.delete': {
      const index = next.edges.findIndex((e) => e.id === command.edgeId);
      if (index === -1) throw new Error(`NO SUCH TRACE — "${command.edgeId}"`);
      const [removed] = next.edges.splice(index, 1);
      return {
        next,
        inverse: { type: 'edge.create', boardId: command.boardId, edge: removed as BoardEdge },
        changed: [{ path: `trace ${command.edgeId}`, before: removed, after: undefined }]
      };
    }

    case 'board.update': {
      // Only `look` is patchable. Stored clean: defaults dropped, and an empty look removed, so a
      // reset board file is byte-for-byte the board it was before a look was ever set.
      const { look, inverse, changed } = applyLookPatch(next.look, command.patch.look);
      if (look) next.look = look;
      else delete next.look;
      return {
        next,
        inverse: { type: 'board.update', boardId: command.boardId, patch: { look: inverse } },
        changed: changed ? [{ path: 'look', before: inverse ?? undefined, after: look ?? undefined }] : []
      };
    }

    /*
     * Recommended nodes. The rules live in packages/shared/phantoms.ts, which is pure and tested;
     * these cases only pair each change with its exact inverse.
     */
    case 'phantom.propose': {
      return {
        next: withPhantom(next, command.phantom),
        inverse: { type: 'phantom.dismiss', boardId: command.boardId, phantomId: command.phantom.id },
        changed: [{ path: `phantom ${command.phantom.id}`, before: undefined, after: command.phantom }]
      };
    }

    case 'phantom.dismiss': {
      const { next: without, removed } = withoutPhantom(next, command.phantomId);
      return {
        next: without,
        inverse: { type: 'phantom.propose', boardId: command.boardId, phantom: removed },
        changed: [{ path: `phantom ${removed.id}`, before: removed, after: undefined }]
      };
    }

    case 'phantom.approve': {
      const { next: approved, phantom } = approvedBoard(next, command.phantomId, command.node, command.edges);
      return {
        next: approved,
        inverse: { type: 'phantom.unapprove', boardId: command.boardId, phantom, nodeId: command.node.id },
        changed: [
          { path: `phantom ${phantom.id}`, before: phantom, after: undefined },
          { path: command.node.id, before: undefined, after: command.node },
          ...command.edges.map((e) => ({ path: `trace ${e.id}`, before: undefined, after: e }))
        ]
      };
    }

    case 'phantom.unapprove': {
      const node = next.nodes.find((n) => n.id === command.nodeId);
      const edges = next.edges.filter((e) => e.from === command.nodeId || e.to === command.nodeId);
      const restored = unapprovedBoard(next, command.phantom, command.nodeId);
      return {
        next: restored,
        inverse: {
          type: 'phantom.approve',
          boardId: command.boardId,
          phantomId: command.phantom.id,
          node: node as BoardNode,
          edges
        },
        changed: [
          { path: command.nodeId, before: node, after: undefined },
          ...edges.map((e) => ({ path: `trace ${e.id}`, before: e, after: undefined })),
          { path: `phantom ${command.phantom.id}`, before: undefined, after: command.phantom }
        ]
      };
    }
  }
}

/** A node.create inverse produced by a node.delete may carry the traces to restore. */
type NodeCreateWithEdges = Command & { type: 'node.create'; restoreEdges?: BoardEdge[] };

function reattachEdges(board: Board, command: Command): Board {
  const withEdges = command as NodeCreateWithEdges;
  if (command.type !== 'node.create' || !withEdges.restoreEdges?.length) return board;
  const next = cloneBoard(board);
  for (const edge of withEdges.restoreEdges) {
    if (!next.edges.some((e) => e.id === edge.id)) next.edges.push(edge);
  }
  return next;
}

function status(): HistoryStatus {
  const top = undoStack[undoStack.length - 1];
  const redoTop = redoStack[redoStack.length - 1];
  return {
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    undoLabel: top?.entry.label ?? null,
    redoLabel: redoTop?.entry.label ?? null,
    entries: undoStack.slice(-20).map((i) => i.entry).reverse()
  };
}

export function historyStatus(): HistoryStatus {
  return status();
}

/**
 * The whole mutation path. Validate, snapshot, write, record the inverse.
 *
 * Order matters: snapshot BEFORE the write, and validate BEFORE the snapshot so a rejected
 * command does not litter board/.snapshots/ with copies of an unchanged board.
 */
export function apply(request: CommandRequest): CommandResult {
  const { command, actor } = request;
  // A command from anyone is a sign someone is here: see packages/shared/presence.ts.
  markActivity();

  // docs/07: deleting a node or an edge always requires explicit approval, and no per-room
  // "auto" policy can override it. Checked here, at the only place that writes, so it holds
  // for every caller including MCP.
  if (isDestructive(command) && !request.approved) {
    return {
      ok: false,
      needsApproval: true,
      error: `${command.type} REQUIRES EXPLICIT APPROVAL — docs/07-SECURITY.md allows no auto policy for deletion`
    };
  }

  let board: Board;
  try {
    board = loadOrThrow(command.boardId);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  /*
   * Recommended nodes: approval is William's tick and nobody else's, and an agent may withdraw only
   * what an agent proposed. Here, at the only place that writes, so it holds for MCP as well.
   * Undo and redo skip it (runInternal), because the step on the stack was already allowed.
   */
  if (command.type.startsWith('phantom.')) {
    const target = command.type === 'phantom.dismiss'
      ? (board.phantoms ?? []).find((p) => p.id === command.phantomId)
      : undefined;
    // His phone, his voice and his hands all count as him here, and never as an agent.
    const refusal = phantomActorRefusal(command.type, asWilliam(actor), target);
    if (refusal) return { ok: false, error: refusal };
  }

  let transformed: { next: Board; inverse: Command; changed: ChangedField[] };
  try {
    transformed = transform(board, command);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const next = reattachEdges(transformed.next, command);

  if (!transformed.changed.length) {
    // Nothing to do. Do not snapshot, do not write, do not push history — an empty save from
    // the inspector should not consume an undo step.
    return { ok: true, changed: [], history: status(), snapshot: null };
  }

  const problems = validateBoard(next);
  if (problems.length) {
    return { ok: false, error: `EDIT REJECTED — the result would not validate:\n  ${problems.join('\n  ')}` };
  }

  const label = request.label ?? describeCommand(command);
  const snapshotDir = snapshot(`${actor}-${command.type}`);

  const written = writeBoard(next);
  if (!written.ok) {
    return { ok: false, error: `WRITE REJECTED — ${written.problems.join('; ')}` };
  }

  const entry: HistoryEntry = {
    id: nextHistoryId++,
    boardId: command.boardId,
    actor,
    label,
    type: command.type,
    at: new Date().toISOString(),
    changed: transformed.changed.map((c) => c.path)
  };

  undoStack.push({ entry, inverse: transformed.inverse, forward: command });
  redoStack.length = 0;

  const depth = getSettings().undoDepth;
  while (undoStack.length > depth) undoStack.shift();

  console.log(`[bus] ${actor} ${command.type} on ${command.boardId}: ${label} (${transformed.changed.length} field(s))`);
  return { ok: true, changed: transformed.changed, history: status(), snapshot: snapshotDir };
}

/**
 * Undo and redo run their commands through the same transform + validate + snapshot + write
 * path, but bypass the destructive-approval gate: undoing a create means deleting the node that
 * create made, and the human already approved the step that put it on the stack.
 */
function runInternal(command: Command, actor: CommandRequest['actor'], label: string): CommandResult {
  let board: Board;
  try {
    board = loadOrThrow(command.boardId);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  let transformed: { next: Board; inverse: Command; changed: ChangedField[] };
  try {
    transformed = transform(board, command);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  const next = reattachEdges(transformed.next, command);
  const problems = validateBoard(next);
  if (problems.length) {
    return { ok: false, error: `CANNOT ${label.toUpperCase()} — the result would not validate:\n  ${problems.join('\n  ')}` };
  }
  const snapshotDir = snapshot(`${actor}-${label}`);
  const written = writeBoard(next);
  if (!written.ok) return { ok: false, error: `WRITE REJECTED — ${written.problems.join('; ')}` };
  return { ok: true, changed: transformed.changed, history: status(), snapshot: snapshotDir };
}

export function undo(): CommandResult {
  const item = undoStack.pop();
  if (!item) return { ok: false, error: 'NOTHING TO UNDO' };
  const result = runInternal(item.inverse, item.entry.actor, `undo ${item.entry.label}`);
  if (!result.ok) { undoStack.push(item); return result; }
  redoStack.push(item);
  console.log(`[bus] undo: ${item.entry.label}`);
  return { ...result, history: status() };
}

export function redo(): CommandResult {
  const item = redoStack.pop();
  if (!item) return { ok: false, error: 'NOTHING TO REDO' };
  const result = runInternal(item.forward, item.entry.actor, `redo ${item.entry.label}`);
  if (!result.ok) { redoStack.push(item); return result; }
  undoStack.push(item);
  console.log(`[bus] redo: ${item.entry.label}`);
  return { ...result, history: status() };
}

/** Exposed for tests only — the stacks are process-global otherwise. */
export function resetHistory(): void {
  undoStack.length = 0;
  redoStack.length = 0;
  nextHistoryId = 1;
}
