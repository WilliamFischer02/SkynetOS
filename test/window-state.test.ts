import { describe, expect, it } from 'vitest';
import { restoreWindowState } from '../packages/shared/window-state.js';

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
