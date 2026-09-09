import { app, ipcMain, screen, BrowserWindow } from 'electron';
import { CHANNELS, type Channel, type SkynetApi } from '@shared/ipc.js';
import { listBoards, loadBoard } from './services/board-store.js';

/**
 * Handlers, one per allowlisted channel. The type says every channel in CHANNELS must have one
 * and that its argument and return types match packages/shared/ipc.ts — so a channel added to
 * the allowlist without a handler is a typecheck failure, not a runtime "no handler registered".
 */
const handlers: { [K in Channel]: (...args: Parameters<SkynetApi[K]>) => ReturnType<SkynetApi[K]> } = {
  'board:load': (boardId) => loadBoard(boardId),

  'board:list': () => listBoards(),

  'display:info': () => {
    const win = BrowserWindow.getAllWindows()[0];
    const display = win
      ? screen.getDisplayNearestPoint(win.getBounds())
      : screen.getPrimaryDisplay();
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
  })
};

export function registerIpc(): void {
  for (const channel of CHANNELS) {
    ipcMain.handle(channel, (_event, ...args: unknown[]) => {
      const handler = handlers[channel] as (...a: unknown[]) => unknown;
      return handler(...args);
    });
  }
  console.log(`[ipc] registered ${CHANNELS.length} allowlisted channels: ${CHANNELS.join(', ')}`);
}
