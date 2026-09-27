import { afterEach, describe, expect, it, vi } from 'vitest';
import { coalesceWindowChanges, restoreWindowState, sameSnapshot, snapshotWindow, type WindowSnapshotLike } from '../packages/shared/window-state.js';

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const second = { x: 1920, y: 0, width: 2560, height: 1400 };
const defaults = { width: 1600, height: 1000 };
const minimum = { width: 960, height: 640 };

describe('restoreWindowState', () => {
  it('uses the defaults when nothing was saved', () => {
    expect(restoreWindowState(null, [primary], defaults, minimum)).toEqual({ width: 1600, height: 1000, maximized: false });
  });

  it('restores a place that is on screen', () => {
    const saved = { x: 100, y: 50, width: 1400, height: 900, maximized: false };
    expect(restoreWindowState(saved, [primary], defaults, minimum)).toEqual(saved);
  });

  it('drops a place on a monitor that is no longer there, keeping the size', () => {
    const saved = { x: 2200, y: 100, width: 1400, height: 900, maximized: true };
    expect(restoreWindowState(saved, [primary], defaults, minimum)).toEqual({ width: 1400, height: 900, maximized: true });
    expect(restoreWindowState(saved, [primary, second], defaults, minimum).x).toBe(2200);
  });

  it('refuses a title bar parked above the top of the screen', () => {
    const saved = { x: 100, y: -500, width: 1400, height: 900, maximized: false };
    expect(restoreWindowState(saved, [primary], defaults, minimum).y).toBeUndefined();
  });

  it('clamps a size to the minimum and to the biggest display', () => {
    expect(restoreWindowState({ width: 200, height: 100 }, [primary], defaults, minimum)).toMatchObject({ width: 960, height: 640 });
    expect(restoreWindowState({ width: 9000, height: 9000 }, [primary], defaults, minimum)).toMatchObject({ width: 1920, height: 1040 });
  });

  it('ignores garbage', () => {
    expect(restoreWindowState({ width: 'wide', x: 'left' }, [primary], defaults, minimum)).toEqual({ width: 1600, height: 1000, maximized: false });
  });
});

/** A stand-in BrowserWindow: maximise, restore and resize, as the chrome's button and a drag do. */
function fakeWindow(): { isMaximized: () => boolean; getBounds: () => { x: number; y: number; width: number; height: number }; maximize: () => void; unmaximize: () => void; resize: (w: number, h: number) => void } {
  let max = false;
  let normal = { x: 100, y: 50, width: 1400, height: 900 };
  const screen = { x: 0, y: 0, width: 1920, height: 1040 };
  return {
    isMaximized: () => max,
    getBounds: () => (max ? { ...screen } : { ...normal }),
    maximize: () => { max = true; },
    unmaximize: () => { max = false; },
    resize: (width, height) => { normal = { ...normal, width, height }; }
  };
}

describe('window controls: the state the chrome is told about', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('snapshots maximised and restored, in whole pixels', () => {
    const win = fakeWindow();
    expect(snapshotWindow(win)).toEqual({ maximized: false, bounds: { x: 100, y: 50, width: 1400, height: 900 } });
    win.maximize();
    expect(snapshotWindow(win)).toEqual({ maximized: true, bounds: { x: 0, y: 0, width: 1920, height: 1040 } });
    expect(snapshotWindow({ isMaximized: () => false, getBounds: () => ({ x: 0.4, y: 9.6, width: 800.5, height: 600.2 }) }).bounds)
      .toEqual({ x: 0, y: 10, width: 801, height: 600 });
  });

  it('compares snapshots field by field', () => {
    const a: WindowSnapshotLike = { maximized: false, bounds: { x: 0, y: 0, width: 10, height: 10 } };
    expect(sameSnapshot(a, { maximized: false, bounds: { ...a.bounds } })).toBe(true);
    expect(sameSnapshot(a, { maximized: true, bounds: { ...a.bounds } })).toBe(false);
    expect(sameSnapshot(a, { maximized: false, bounds: { ...a.bounds, width: 11 } })).toBe(false);
    expect(sameSnapshot(null, null)).toBe(true);
    expect(sameSnapshot(a, null)).toBe(false);
  });

  it('pushes once per 100 ms of quiet, however many resize events a drag fires', () => {
    vi.useFakeTimers();
    const win = fakeWindow();
    const seen: WindowSnapshotLike[] = [];
    const changes = coalesceWindowChanges(() => snapshotWindow(win), (s) => seen.push(s));
    for (let i = 0; i < 30; i++) { win.resize(1400 + i, 900); changes.poke(); vi.advanceTimersByTime(10); }
    expect(seen).toHaveLength(0);
    vi.advanceTimersByTime(100);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.bounds.width).toBe(1429);
  });

  it('pushes maximise and restore, and nothing when nothing changed', () => {
    vi.useFakeTimers();
    const win = fakeWindow();
    const seen: boolean[] = [];
    const changes = coalesceWindowChanges(() => snapshotWindow(win), (s) => seen.push(s.maximized));
    win.maximize(); changes.poke(); vi.advanceTimersByTime(100);
    changes.poke(); vi.advanceTimersByTime(100); // a resize event with no change: no push
    win.unmaximize(); changes.poke(); vi.advanceTimersByTime(100);
    expect(seen).toEqual([true, false]);
  });

  it('pushes nothing for a destroyed window, and nothing after dispose', () => {
    vi.useFakeTimers();
    const seen: unknown[] = [];
    const gone = coalesceWindowChanges(() => null, (s) => seen.push(s));
    gone.poke(); vi.advanceTimersByTime(200);
    const win = fakeWindow();
    const changes = coalesceWindowChanges(() => snapshotWindow(win), (s) => seen.push(s));
    changes.poke(); changes.dispose(); vi.advanceTimersByTime(200);
    expect(seen).toEqual([]);
  });
});
