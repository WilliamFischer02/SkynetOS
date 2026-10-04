import { useEffect, useRef } from 'react';

/** The slice of `document` the interval needs, so a test can stand in for it. */
export interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

/**
 * The hook's whole behaviour, outside React (test/visible-interval.test.ts): run `fn` every `ms`
 * while `doc` is visible, stop the timer while it is hidden, and on becoming visible again start
 * it and, unless `runOnVisible` is false, run `fn` once at once. Returns the disposer.
 */
export function startVisibleInterval(doc: VisibilitySource, fn: () => void, ms: number, runOnVisible = true): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  const start = (): void => {
    if (timer) return;
    timer = setInterval(() => { if (!doc.hidden) fn(); }, ms);
  };
  const stop = (): void => {
    if (timer) { clearInterval(timer); timer = null; }
  };
  const onVisibility = (): void => {
    if (doc.hidden) stop();
    else { start(); if (runOnVisible) fn(); }
  };
  doc.addEventListener('visibilitychange', onVisibility);
  if (!doc.hidden) start();
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility);
    stop();
  };
}

/**
 * `setInterval` that sleeps while nobody can see the result (2026-09-26 audit).
 *
 * The board's panels poll: usage every 20 s, the schedule and finance blocks every 30 s, the
 * remote panel every 4 s. Each of those used to keep running in a minimised or hidden window,
 * where the answer is painted for nobody. This hook runs `fn` on the interval only while the
 * document is visible, runs it once immediately when the window becomes visible again (so a stale
 * panel catches up at once rather than at its next tick), and always clears on unmount.
 *
 * `fn` is read through a ref, so callers pass a fresh closure every render without restarting the
 * timer. Pass `ms = 0` to disable.
 */
export function useVisibleInterval(fn: () => void, ms: number, options: { runOnVisible?: boolean } = {}): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const runOnVisible = options.runOnVisible !== false;

  useEffect(() => {
    if (!ms) return;
    return startVisibleInterval(document, () => fnRef.current(), ms, runOnVisible);
  }, [ms, runOnVisible]);
}
