import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startVisibleInterval, type VisibilitySource } from '../src/renderer/ui/useVisibleInterval.js';

/**
 * The panels' polls (usage, finance, schedule, remote) run through `useVisibleInterval`, whose
 * behaviour is `startVisibleInterval`. A hidden window must cost nothing, a window that comes
 * back must catch up at once, and nothing may tick after the panel has gone.
 */

function fakeDocument(hidden = false): VisibilitySource & { show(): void; hide(): void; listeners: number } {
  const listeners = new Set<() => void>();
  const doc = {
    hidden,
    addEventListener: (_type: 'visibilitychange', listener: () => void) => { listeners.add(listener); },
    removeEventListener: (_type: 'visibilitychange', listener: () => void) => { listeners.delete(listener); },
    show: () => { doc.hidden = false; for (const l of [...listeners]) l(); },
    hide: () => { doc.hidden = true; for (const l of [...listeners]) l(); },
    get listeners() { return listeners.size; }
  };
  return doc;
}

describe('startVisibleInterval', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('runs on the interval while visible, and not before the first interval', () => {
    const fn = vi.fn();
    const stop = startVisibleInterval(fakeDocument(), fn, 1000);
    expect(fn).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(3);
    stop();
  });

  it('holds no timer at all while hidden', () => {
    const fn = vi.fn();
    const doc = fakeDocument();
    const stop = startVisibleInterval(doc, fn, 1000);
    doc.hide();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(fn).toHaveBeenCalledTimes(0);
    stop();
  });

  it('catches up once at the moment it becomes visible, then resumes the interval', () => {
    const fn = vi.fn();
    const doc = fakeDocument(true);
    const stop = startVisibleInterval(doc, fn, 1000);
    expect(vi.getTimerCount()).toBe(0);
    doc.show();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(3);
    stop();
  });

  it('does not catch up when asked not to', () => {
    const fn = vi.fn();
    const doc = fakeDocument(true);
    const stop = startVisibleInterval(doc, fn, 1000, false);
    doc.show();
    expect(fn).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
    stop();
  });

  it('never stacks a second timer when shown twice', () => {
    const fn = vi.fn();
    const doc = fakeDocument();
    const stop = startVisibleInterval(doc, fn, 1000, false);
    doc.show();
    doc.show();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
    stop();
  });

  it('leaves no timer and no listener behind once disposed', () => {
    const fn = vi.fn();
    const doc = fakeDocument();
    const stop = startVisibleInterval(doc, fn, 1000);
    stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(doc.listeners).toBe(0);
    doc.show();
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(0);
  });
});
