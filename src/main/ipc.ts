import { app, BrowserWindow, dialog, ipcMain, screen } from 'electron';
import { CHANNELS, isAgentMethod, type Channel, type SkynetApi } from '@shared/ipc.js';
import type { BoardNode } from '@shared/types.js';
import type { Actor, CommandRequest } from '@shared/commands.js';
import { DEFAULT_FOOTPRINT, isDecorPart } from '@shared/types.js';
import { findNode, listBoards, loadBoard, loadBoardByFile } from './services/board-store.js';
import { apply, historyStatus, redo, undo } from './services/command-bus.js';
import { pick } from './services/pickers.js';
import { getSettings, setUsagePlan } from './services/settings.js';
import { lastClaudeSessionId } from './services/db.js';
import { resumeCommandLine } from './services/launch-args.js';
import { mosaicForNode } from './services/mosaic.js';
import { clearUsageCache, readUsage, usageRoutes } from './services/usage.js';
import { isPlanId } from '@shared/plans.js';
import { archiveMail, listMail, sendMail } from './services/mailbox.js';
import {
  listSessions,
  startSession,
  stopSession
} from './services/session-manager.js';
import {
  listServices,
  serviceTail,
  startService,
  stopService
} from './services/service-runner.js';
import { openNodeTerminal, openTarget } from './services/shell-opener.js';
import { resolveArtifact, resolveBoardArtifacts } from './services/artifacts.js';
import { startDragOut } from './services/drag-out.js';
import { classify, suggestionToNode } from './services/ingest.js';
import { watchBoard } from './services/watchers.js';
import { apply as applyCommand } from './services/command-bus.js';
import { findFreeSpaceOnBoard } from './services/placement.js';
import { makeNode } from './services/node-factory.js';
import { resolveNodeTarget, resolveValue } from './services/target-resolver.js';

/**
 * Handlers, one per allowlisted channel. The type says every channel in CHANNELS must have one
 * and that its argument and return types match packages/shared/ipc.ts — so a channel added to
 * the allowlist without a handler is a typecheck failure, not a runtime "no handler registered".
 */
type Handlers = {
  [K in Channel]: (...args: Parameters<SkynetApi[K]>) => ReturnType<SkynetApi[K]> | Promise<ReturnType<SkynetApi[K]>>;
};

/**
 * Put a new node on a board.
 *
 * A function rather than an inline handler because the agent path needs it too, and it needs it
 * attributed differently. The history says who did what — the activity feed, the undo tooltip and
 * `docs/07`'s audit story all rest on that — so "the renderer called it, therefore William did it"
 * stops being true the moment JARVIS Prime can call it as well. The actor is a parameter, and the
 * two callers each pass the truth.
 */
function addNode(
  boardId: string,
  kind: Parameters<SkynetApi['node:add']>[1],
  pos: { x: number; y: number },
  fields: Partial<BoardNode> | undefined,
  actor: Actor
): ReturnType<SkynetApi['node:add']> {
  const load = loadBoard(boardId);
  if (!load.ok) return { ok: false, error: load.error };
  const node = makeNode(load.board, kind, pos);

  /*
   * A deliberately tiny allowlist. The palette needs to say WHICH decor part it is placing and
   * nothing else; everything else about a new node is decided by the factory or by the editor
   * afterwards. Accepting an arbitrary patch here would make `node:add` a second, unvalidated
   * way to write board JSON straight out of the renderer — or out of an agent.
   */
  if (fields?.part && isDecorPart(fields.part)) node.part = fields.part;

  /*
   * A printed kind (note.silk, group.zone) is placed exactly where it was asked for. It has no
   * footprint on the grid and never collides, so looking for "free space" would move a bracket
   * away from the cluster it was drawn around — which is the one thing it must not do.
   */
  const printed = kind === 'note.silk' || kind === 'group.zone';
  if (!printed) {
    const fp = node.footprint ?? DEFAULT_FOOTPRINT[kind];
    const free = findFreeSpaceOnBoard(load.board, fp, node.pos);
    if (!free) return { ok: false, error: 'NO FREE GRID SPACE ON THIS BOARD' };
    node.pos = free;
  }

  const result = applyCommand({
    command: { type: 'node.create', boardId, node },
    actor,
    label: `add ${kind}`
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, nodeId: node.id };
}

/**
 * Activate a node's target.
 *
 * Shared, and taking an ACTOR, for the same reason `addNode` does: what a click may do without
 * asking is not the same as what an agent may do without asking. `confirmBeforeLaunch: false` is
 * the user saying "stop asking me about this one", and board JSON is agent-writable — so the flag
 * is honoured for 'user' and ignored for 'agent'. See `trustedByUser` in services/shell-opener.ts.
 */
async function openNode(
  boardId: string,
  nodeId: string,
  by: Actor
): Promise<Awaited<ReturnType<SkynetApi['node:open']>>> {
  const result = await openTarget(nodeOrThrow(boardId, nodeId), by);
  return {
    ok: result.ok,
    action: result.action,
    target: result.target,
    ...(result.error ? { error: result.error } : {})
  };
}

function nodeOrThrow(boardId: string, nodeId: string): BoardNode {
  const load = loadBoard(boardId);
  if (!load.ok) throw new Error(load.error);
  const node = findNode(load.board, nodeId);
  if (!node) throw new Error(`NO SUCH NODE — "${nodeId}" on board "${boardId}"`);
  return node;
}

const handlers: Handlers = {
  'board:load': (boardId) => loadBoard(boardId),

  'board:loadRoom': (boardFile) => loadBoardByFile(boardFile),

  'board:list': () => listBoards(),

  'display:info': () => {
    const win = BrowserWindow.getAllWindows()[0];
    const display = win ? screen.getDisplayNearestPoint(win.getBounds()) : screen.getPrimaryDisplay();
    const scaleFactor = display.scaleFactor || 1;
    return {
      scaleFactor,
      appliedZoomFactor: win ? win.webContents.getZoomFactor() : 1,
      workArea: { width: display.workArea.width, height: display.workArea.height }
    };
  },

  'app:version': () => ({
    app: app.getVersion(),
    electron: process.versions['electron'] ?? 'unknown',
    chrome: process.versions['chrome'] ?? 'unknown',
    node: process.versions['node'] ?? 'unknown'
  }),

  'settings:read': () => {
    const s = getSettings();
    return {
      devRoots: s.devRoots,
      reducedMotion: s.reducedMotion,
      streamMode: s.streamMode,
      confirmAllLaunches: s.confirmAllLaunches,
      plan: s.plan,
      tokenBudget: s.tokenBudget
    };
  },

  'settings:setPlan': (plan, tokenBudget) => {
    const result = setUsagePlan(
      plan !== null && isPlanId(plan) ? plan : null,
      tokenBudget
    );
    // The usage cache holds per-window scans; the budget does not affect them, but the window
    // length can change with a settings reload, so it is cleared rather than left to go subtly
    // stale.
    if (result.ok) clearUsageCache();
    return result;
  },

  'target:resolveNode': (boardId, nodeId) => ({
    nodeId,
    target: resolveNodeTarget(nodeOrThrow(boardId, nodeId))
  }),

  'target:resolveBoard': (boardId) => {
    const load = loadBoard(boardId);
    if (!load.ok) return [];
    return load.board.nodes.map((node) => ({ nodeId: node.id, target: resolveNodeTarget(node) }));
  },

  'target:verify': (control, value, context) => resolveValue(control, value, context as BoardNode | undefined),

  'pick:target': (request) => pick(request),

  'mosaic:forNode': (boardId, nodeId, slot) => {
    const load = loadBoard(boardId);
    if (!load.ok) return { ok: false, error: load.error };
    const node = findNode(load.board, nodeId);
    if (!node) return { ok: false, error: `NO SUCH NODE — "${nodeId}"` };
    return mosaicForNode(load.board, node, slot ?? 'face');
  },

  'usage:summary': () => readUsage(),

  'usage:routes': (boardId) => usageRoutes(boardId),

  'mailbox:list': (side) => listMail(side),
  'mailbox:send': (side, message) => sendMail(side, message),
  'mailbox:archive': (side, file) => archiveMail(side, file),

  'session:start': (boardId, nodeId, options) =>
    startSession(boardId, nodeOrThrow(boardId, nodeId), {
      fresh: options?.fresh ?? false,
      ...(options?.prompt ? { prompt: options.prompt } : {})
    }),

  'session:stop': (sessionId) => stopSession(sessionId),

  'session:list': () => listSessions(),

  /**
   * The command to reattach to this node's conversation by hand. docs/03 lists "Copy resume
   * command" in the right-click menu, and it is the escape hatch when the launcher itself is
   * the thing that is broken.
   */
  'session:resumeCommand': (boardId, nodeId) => {
    const node = nodeOrThrow(boardId, nodeId);
    const id = lastClaudeSessionId(boardId, nodeId);
    if (!id || !node.cwd) return null;
    return resumeCommandLine(node.cwd, id);
  },

  /**
   * A plain shell in a node's directory. The board's missing verb: until now the only thing that
   * could open a console was an agent chip, and `openWith: 'terminal'` answered "arrives at M3".
   */
  'terminal:open': (boardId, nodeId, options) =>
    openNodeTerminal(nodeOrThrow(boardId, nodeId), { elevated: options?.elevated === true }),

  'service:start': (boardId, nodeId) => startService(boardId, nodeOrThrow(boardId, nodeId)),
  'service:stop': (boardId, nodeId) => stopService(boardId, nodeId),
  'service:list': () => listServices(),
  'service:tail': (boardId, nodeId) => serviceTail(boardId, nodeId),

  'artifact:resolve': async (boardId, nodeId) => {
    const load = loadBoard(boardId);
    if (!load.ok) throw new Error(load.error);
    return resolveArtifact(load.board, nodeOrThrow(boardId, nodeId));
  },

  'artifact:resolveBoard': async (boardId) => {
    const load = loadBoard(boardId);
    if (!load.ok) return [];
    return resolveBoardArtifacts(load.board);
  },

  'drag:startFile': async (boardId, nodeId, ..._rest) => {
    void _rest;
    const load = loadBoard(boardId);
    if (!load.ok) return { ok: false, error: load.error };
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return { ok: false, error: 'NO WINDOW' };
    return startDragOut(win.webContents, load.board, nodeId);
  },

  'ingest:classify': (paths) => paths.map((p) => classify(p)).filter((s): s is NonNullable<typeof s> => s !== null),

  'ingest:create': (boardId, suggestion, pos) => {
    const load = loadBoard(boardId);
    if (!load.ok) return { ok: false, error: load.error };
    const existing = new Set(load.board.nodes.map((n) => n.id));
    const free = findFreeSpaceOnBoard(load.board, suggestion.footprint, pos);
    if (!free) return { ok: false, error: 'NO FREE GRID SPACE ON THIS BOARD' };
    const node = suggestionToNode(suggestion, free, existing);
    const result = applyCommand({
      command: { type: 'node.create', boardId, node },
      actor: 'user',
      label: `drop in ${node.name}`
    });
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, nodeId: node.id };
  },

  'watch:board': async (boardId) => {
    const load = loadBoard(boardId);
    if (!load.ok) return { watched: 0, polled: 0 };
    return watchBoard(load.board);
  },

  'node:add': (boardId, kind, pos, fields) => addNode(boardId, kind, pos, fields, 'user'),

  'node:open': async (boardId, nodeId) => openNode(boardId, nodeId, 'user'),

  'command:apply': (request) => apply(request),

  'command:undo': () => undo(),
  'command:redo': () => redo(),
  'command:history': () => historyStatus(),

  /**
   * docs/07: deleting a node, edge or room "always requires explicit approval in the UI. No auto
   * policy can override this." The approval is a native modal, deliberately — an in-page
   * confirm could be dismissed by a stray keypress, and this is the one gate that must not be.
   */
  'command:confirmDestructive': async (summary, detail) => {
    const win = BrowserWindow.getAllWindows()[0];
    const options = {
      type: 'warning' as const,
      buttons: ['Delete', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Confirm deletion',
      message: summary,
      detail: `${detail}\n\nA snapshot of every board file is written to board/.snapshots/ first, and Ctrl+Z undoes this.`,
      noLink: true
    };
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    return response === 0;
  }
};

/**
 * Call a handler on behalf of an agent.
 *
 * Everything that arrives over the control channel comes through here, and it does two things the
 * renderer's path does not:
 *
 *   1. Refuses any method not in AGENT_METHODS.
 *   2. Rewrites a `command:apply` request so it cannot lie about itself. `actor` becomes 'agent'
 *      regardless of what was asked for — attribution is not the caller's to choose — and
 *      `approved` is stripped. That flag means "a human approved THIS command in THIS exchange",
 *      and an agent setting it for itself would turn the delete guard in command-bus.ts into a
 *      comment. Deletion still works; it comes back `needsApproval: true` and the user confirms it
 *      in the UI, which is what docs/07 asks for.
 */
export async function callAsAgent(method: string, params: unknown[]): Promise<unknown> {
  if (!isAgentMethod(method)) {
    throw new Error(`"${method}" IS NOT AVAILABLE TO AGENTS — see AGENT_METHODS in src/main/ipc.ts`);
  }

  if (method === 'command:apply') {
    const request = (params[0] ?? {}) as CommandRequest;
    const { approved: _discarded, ...rest } = request;
    return handlers['command:apply']({ ...rest, actor: 'agent' });
  }

  /*
   * `node:add` goes through the shared function rather than the handler, so the history records
   * that an AGENT added this node. The handler's job is to answer the renderer, and the renderer
   * is always William.
   */
  if (method === 'node:add') {
    const [boardId, kind, pos, fields] = params as Parameters<SkynetApi['node:add']>;
    return addNode(boardId, kind, pos, fields, 'agent');
  }

  /*
   * Same reason as `node:add`: activating a node runs something on this machine, and an agent must
   * not be able to skip the confirmation by clearing a flag in board JSON it can also write.
   */
  if (method === 'node:open') {
    const [boardId, nodeId] = params as Parameters<SkynetApi['node:open']>;
    return openNode(boardId, nodeId, 'agent');
  }

  const handler = handlers[method as Channel] as (...a: unknown[]) => unknown;
  return await handler(...params);
}

export function registerIpc(): void {
  for (const channel of CHANNELS) {
    ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
      const handler = handlers[channel] as (...a: unknown[]) => unknown;
      try {
        return await handler(...args);
      } catch (err) {
        // An exception crossing the bridge arrives in the renderer as a rejected promise with a
        // mangled message. Log the real one here where the stack is intact.
        console.error(`[ipc] ${channel} failed:`, err);
        throw err;
      }
    });
  }
  console.log(`[ipc] registered ${CHANNELS.length} allowlisted channels`);
}
