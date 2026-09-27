import type { BrowserWindow } from 'electron';
import type { WindowSnapshot } from '@shared/ipc.js';
import { coalesceWindowChanges, snapshotWindow } from '@shared/window-state.js';
import { boardWindow } from './main-window.js';

/**
 * The board window's frame, from the chrome (2026-09-27). William: "add a maximize button / window
 * scalability to the program".
 *
 * `window:maximize`, `window:minimize` and `window:state` act on the BOARD window and nothing else,
 * whoever asks; `registerIpc` also refuses them from any other sender (WINDOW_METHODS). None is in
 * AGENT_METHODS or REMOTE_METHODS (test/window-controls-contract.test.ts).
 *
 * The native frame stays: its own maximise button, Win+Up, a snap to an edge and a double-click on
 * the title bar all still work, and every one of them reaches the renderer through the same
 * `window:changed` push, so the chrome's button always shows the state the window is really in.
 */

function board(): BrowserWindow {
  const win = boardWindow();
  if (!win) throw new Error('NO BOARD WINDOW');
  return win;
}

export function windowState(): WindowSnapshot {
  return snapshotWindow(board());
}

/** Maximised → restored, anything else → maximised. A minimised window is restored first. */
export function toggleMaximize(): { maximized: boolean } {
  const win = board();
  if (win.isMinimized()) win.restore();
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  return { maximized: win.isMaximized() };
}

export function minimizeWindow(): { ok: boolean } {
  board().minimize();
  return { ok: true };
}

/**
 * Push `window:changed` to the board window on maximize, unmaximize and resize: one push per 100 ms
 * of quiet, and none when nothing changed (packages/shared/window-state.ts). Called once, from
 * createWindow in src/main/index.ts.
 */
export function watchWindowChanges(win: BrowserWindow): void {
  const changes = coalesceWindowChanges(
    () => (win.isDestroyed() ? null : snapshotWindow(win)),
    (snapshot) => { if (!win.isDestroyed()) win.webContents.send('window:changed', snapshot); }
  );
  win.on('maximize', changes.poke);
  win.on('unmaximize', changes.poke);
  win.on('resize', changes.poke);
  // Leaving full screen and restoring from the taskbar can change the frame without a resize event.
  win.on('restore', changes.poke);
  win.on('leave-full-screen', changes.poke);
  win.on('closed', changes.dispose);
}
