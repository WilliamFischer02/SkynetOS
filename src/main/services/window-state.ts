import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app, screen, type BrowserWindow } from 'electron';
import { restoreWindowState, type SavedWindowState } from '@shared/window-state.js';

/**
 * The main window's bounds, kept in `%APPDATA%/SkynetOS/window-state.json` and restored on launch.
 * See packages/shared/window-state.ts for what is restored and why. It is window placement, not
 * policy, so it does not go anywhere near settings.json (docs/07).
 *
 * Not used during a smoke run: a smoke capture needs a known window size, and must not overwrite
 * the size William left his own window at.
 */

const FILE = 'window-state.json';

function file(): string {
  return join(app.getPath('userData'), FILE);
}

export function loadWindowState(
  defaults: { width: number; height: number },
  minimum: { width: number; height: number }
): SavedWindowState {
  let raw: unknown = null;
  try { raw = JSON.parse(readFileSync(file(), 'utf8')); } catch { /* first run, or unreadable: the defaults */ }
  const areas = screen.getAllDisplays().map((d) => d.workArea);
  return restoreWindowState(raw, areas, defaults, minimum);
}

/** Save the window's place whenever it settles, and on close. The un-maximised bounds are what is kept. */
export function trackWindowState(win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = (): void => {
    if (win.isDestroyed() || win.isMinimized()) return;
    const maximized = win.isMaximized();
    const b = maximized ? win.getNormalBounds() : win.getBounds();
    const state: SavedWindowState = { x: b.x, y: b.y, width: b.width, height: b.height, maximized };
    try {
      mkdirSync(app.getPath('userData'), { recursive: true });
      writeFileSync(file(), JSON.stringify(state, null, 2), 'utf8');
    } catch (err) {
      console.warn('[window] could not save window state:', (err as Error).message);
    }
  };
  const later = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 600);
  };
  win.on('resize', later);
  win.on('move', later);
  win.on('maximize', later);
  win.on('unmaximize', later);
  win.on('close', () => { if (timer) clearTimeout(timer); save(); });
}
