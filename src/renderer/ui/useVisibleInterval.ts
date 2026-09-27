import { useEffect, useRef } from 'react';

/**
 * `setInterval` that sleeps while nobody can see the result (2026-09-26 audit).
 *
 * The board's panels poll: usage every 20 s, the schedule and finance blocks every 30 s, the
 * remote panel every 4 s, countdowns every second. Each of those keeps running in a minimised or
 * hidden window, where the answer is painted for nobody. This hook runs `fn` on the interval only
 * while the document is visible, runs it once immediately when the window becomes visible again
 * (so a stale panel catches up at once rather than at its next tick), and always clears on unmount.
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
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = (): void => {
      if (timer) return;
      timer = setInterval(() => { if (!document.hidden) fnRef.current(); }, ms);
    };
    const stop = (): void => {
      if (timer) { clearInterval(timer); timer = null; }
    };
    const onVisibility = (): void => {
      if (document.hidden) stop();
      else { start(); if (runOnVisible) fnRef.current(); }
    };
    document.addEventListener('visibilitychange', onVisibility);
    if (!document.hidden) start();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [ms, runOnVisible]);
}
