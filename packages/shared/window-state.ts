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

/* ── The window controls in the chrome (2026-09-27) ─────────────────────────────────────────────
 *
 * William: "add a maximize button / window scalability to the program". The MAXIMIZE / RESTORE
 * button in the breadcrumb row and F11 call `window:maximize`; main pushes `window:changed` so the
 * button's glyph follows the window however it was maximised (the title bar, Win+Up, a snap). A
 * drag-resize fires `resize` dozens of times a second, so the pushes are coalesced: one per 100 ms
 * of quiet, and none at all when nothing the renderer shows has changed.
 */

export interface WindowSnapshotLike { maximized: boolean; bounds: WindowRect }

/** Anything with Electron's BrowserWindow shape, so the snapshot is testable without Electron. */
export interface SnapshotSource {
  isMaximized(): boolean;
  getBounds(): WindowRect;
}

export function snapshotWindow(win: SnapshotSource): WindowSnapshotLike {
  const b = win.getBounds();
  return {
    maximized: win.isMaximized(),
    bounds: { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }
  };
}

export function sameSnapshot(a: WindowSnapshotLike | null, b: WindowSnapshotLike | null): boolean {
  if (!a || !b) return a === b;
  return a.maximized === b.maximized
    && a.bounds.x === b.bounds.x && a.bounds.y === b.bounds.y
    && a.bounds.width === b.bounds.width && a.bounds.height === b.bounds.height;
}

export const WINDOW_CHANGE_DEBOUNCE_MS = 100;

/**
 * A trailing debounce for `window:changed`. `poke()` on every maximize, unmaximize and resize; the
 * snapshot is read once the window has been still for `delayMs`, and emitted only if it differs
 * from the last one emitted. `read` returning null (a destroyed window) emits nothing.
 */
export function coalesceWindowChanges(
  read: () => WindowSnapshotLike | null,
  emit: (snapshot: WindowSnapshotLike) => void,
  delayMs: number = WINDOW_CHANGE_DEBOUNCE_MS,
  timers: { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void } = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>)
  }
): { poke: () => void; dispose: () => void } {
  let handle: unknown = null;
  let last: WindowSnapshotLike | null = null;
  const fire = (): void => {
    handle = null;
    const next = read();
    if (!next || sameSnapshot(last, next)) return;
    last = next;
    emit(next);
  };
  return {
    poke: () => {
      if (handle !== null) timers.clear(handle);
      handle = timers.set(fire, delayMs);
    },
    dispose: () => {
      if (handle !== null) timers.clear(handle);
      handle = null;
    }
  };
}
