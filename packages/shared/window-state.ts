/**
 * The main window's size and place, restored on launch.
 *
 * A desktop app that forgets where it was every time it opens is a small, constant irritation, and
 * one William would meet every morning now that SkynetOS starts with Windows. Pure: main reads and
 * writes the file (src/main/services/window-state.ts); this decides what is safe to restore.
 *
 * The rule that matters is "never restore off screen". A monitor unplugged since last time would
 * otherwise open SkynetOS somewhere nobody can see it. A saved place is used only if a real part of
 * the window's title bar lands inside some display's work area; otherwise only the size survives
 * and Windows centres it.
 */

export interface WindowRect { x: number; y: number; width: number; height: number }

export interface SavedWindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

/** How much of the title bar must be on some display, in px, for the saved place to be used. */
const VISIBLE_W = 120;
const VISIBLE_H = 32;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

export function restoreWindowState(
  raw: unknown,
  workAreas: readonly WindowRect[],
  defaults: { width: number; height: number },
  minimum: { width: number; height: number }
): SavedWindowState {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const biggest = workAreas.reduce(
    (best, a) => (a.width * a.height > best.width * best.height ? a : best),
    workAreas[0] ?? { x: 0, y: 0, width: defaults.width, height: defaults.height }
  );
  const clampW = (w: number): number => Math.min(Math.max(w, minimum.width), Math.max(minimum.width, biggest.width));
  const clampH = (h: number): number => Math.min(Math.max(h, minimum.height), Math.max(minimum.height, biggest.height));

  const width = clampW(num(o['width']) ?? defaults.width);
  const height = clampH(num(o['height']) ?? defaults.height);
  const maximized = o['maximized'] === true;
  const x = num(o['x']);
  const y = num(o['y']);

  if (x === null || y === null) return { width, height, maximized };

  // Some of the title bar (the top VISIBLE_H px) must overlap some work area by VISIBLE_W px.
  const onScreen = workAreas.some((a) => {
    const overlapW = Math.min(x + width, a.x + a.width) - Math.max(x, a.x);
    const overlapH = Math.min(y + VISIBLE_H, a.y + a.height) - Math.max(y, a.y);
    return overlapW >= VISIBLE_W && overlapH >= Math.min(VISIBLE_H, 16);
  });
  return onScreen ? { x, y, width, height, maximized } : { width, height, maximized };
}
