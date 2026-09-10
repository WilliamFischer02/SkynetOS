import { app, BrowserWindow, dialog, ipcMain, screen } from 'electron';
import { CHANNELS, type Channel, type SkynetApi } from '@shared/ipc.js';
import type { BoardNode } from '@shared/types.js';
import { findNode, listBoards, loadBoard } from './services/board-store.js';
import { apply, historyStatus, redo, undo } from './services/command-bus.js';
import { pick } from './services/pickers.js';
import { getSettings } from './services/settings.js';
import { mosaicForNode } from './services/mosaic.js';
import { openTarget } from './services/shell-opener.js';
import { resolveNodeTarget, resolveValue } from './services/target-resolver.js';

/**
 * Handlers, one per allowlisted channel. The type says every channel in CHANNELS must have one
 * and that its argument and return types match packages/shared/ipc.ts — so a channel added to
 * the allowlist without a handler is a typecheck failure, not a runtime "no handler registered".
 */
type Handlers = {
  [K in Channel]: (...args: Parameters<SkynetApi[K]>) => ReturnType<SkynetApi[K]> | Promise<ReturnType<SkynetApi[K]>>;
};

function nodeOrThrow(boardId: string, nodeId: string): BoardNode {
  const load = loadBoard(boardId);
  if (!load.ok) throw new Error(load.error);
  const node = findNode(load.board, nodeId);
  if (!node) throw new Error(`NO SUCH NODE — "${nodeId}" on board "${boardId}"`);
  return node;
}

const handlers: Handlers = {
  'board:load': (boardId) => loadBoard(boardId),

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
      confirmAllLaunches: s.confirmAllLaunches
    };
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

  'mosaic:forNode': (boardId, nodeId) => {
    const load = loadBoard(boardId);
    if (!load.ok) return { ok: false, error: load.error };
    const node = findNode(load.board, nodeId);
    if (!node) return { ok: false, error: `NO SUCH NODE — "${nodeId}"` };
    return mosaicForNode(load.board, node);
  },

  'node:open': async (boardId, nodeId) => {
    const result = await openTarget(nodeOrThrow(boardId, nodeId));
    return {
      ok: result.ok,
      action: result.action,
      target: result.target,
      ...(result.error ? { error: result.error } : {})
    };
  },

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
