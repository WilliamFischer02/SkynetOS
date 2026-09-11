import type { BrowserWindow } from 'electron';

/**
 * The board window: the one SkynetOS window with a preload and a bridge.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────────────────
 *
 * Dialogs used to find it with `BrowserWindow.getAllWindows()[0]`. Electron lists windows NEWEST
 * first. Checked against the installed Electron 44: the main window alone gives [MAIN], and once a
 * second window opens it gives [CHAT, MAIN]. So as soon as the Face's conversation window had been
 * opened, every file picker, launch confirmation and delete confirmation was parented to the
 * claude.ai window. That put a modal on a window nobody was looking at, which reads as a Browse
 * button that does nothing. Reported: "the browse button is also not working … I can't select
 * images … perhaps even directories". Drag-out and `display:info` took the same wrong window.
 *
 * Only the board window can call into main at all, since the conversation windows have no
 * preload. So "the window that asked" and "the board window" are always the same window.
 * test/window-parent.test.ts keeps `getAllWindows()[0]` from coming back.
 */

let board: BrowserWindow | null = null;

export function setBoardWindow(win: BrowserWindow): void {
  board = win;
  win.on('closed', () => {
    if (board === win) board = null;
  });
}

/** The board window, or undefined while there is none (at startup, or after it closed). */
export function boardWindow(): BrowserWindow | undefined {
  return board && !board.isDestroyed() ? board : undefined;
}
