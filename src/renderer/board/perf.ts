/**
 * Render-loop counters for the board, on only when asked.
 *
 * `localStorage.skynetPerf = '1'` or `?perf=1` on the window URL (a smoke run sets the latter when
 * SKYNET_PERF is in its environment) turns on a `[ui] perf …` line every five seconds: ticks and
 * real renders per second, how many nodes were redrawn and overlays rebuilt, and the JS cost of a
 * tick. It is how the 2026-09-26 audit measured the loop instead of describing it; the line is
 * cheap enough to leave in, and silent by default.
 */

export interface PerfCounters {
  ticks: number;
  renders: number;
  drawNode: number;
  rebuildOverlay: number;
  buildNotes: number;
  effects: number;
  tickMs: number;
  maxTickMs: number;
  boardBuildMs: number;
}

const counters: PerfCounters = { ticks: 0, renders: 0, drawNode: 0, rebuildOverlay: 0, buildNotes: 0, effects: 0, tickMs: 0, maxTickMs: 0, boardBuildMs: 0 };
let enabled: boolean | null = null;
let lastLog = 0;
const LOG_EVERY_MS = 5000;

export function perfEnabled(): boolean {
  if (enabled !== null) return enabled;
  try {
    enabled = window.localStorage.getItem('skynetPerf') === '1' || /[?&]perf=1/.test(window.location.search);
  } catch {
    enabled = /[?&]perf=1/.test(window.location.search);
  }
  return enabled;
}

export function perfCount(key: keyof PerfCounters, by = 1): void {
  counters[key] += by;
}

export function perfTick(ms: number): void {
  counters.ticks++;
  counters.tickMs += ms;
  if (ms > counters.maxTickMs) counters.maxTickMs = ms;
}

/** Print the window's counters and start a new window. Called from the ticker; throttled here. */
export function perfMaybeLog(now: number, extra: string): void {
  if (!perfEnabled()) return;
  if (!lastLog) { lastLog = now; return; }
  if (now - lastLog < LOG_EVERY_MS) return;
  const seconds = (now - lastLog) / 1000;
  const avg = counters.ticks ? counters.tickMs / counters.ticks : 0;
  console.log(
    `[ui] perf ${(counters.ticks / seconds).toFixed(1)} ticks/s ${(counters.renders / seconds).toFixed(1)} renders/s ` +
    `drawNode ${counters.drawNode} overlay ${counters.rebuildOverlay} notes ${counters.buildNotes} effects ${counters.effects} ` +
    `tick ${avg.toFixed(2)} ms avg ${counters.maxTickMs.toFixed(2)} max${counters.boardBuildMs ? ` build ${counters.boardBuildMs.toFixed(1)} ms` : ''} ${extra}`
  );
  counters.ticks = 0; counters.renders = 0; counters.drawNode = 0; counters.rebuildOverlay = 0;
  counters.buildNotes = 0; counters.effects = 0; counters.tickMs = 0; counters.maxTickMs = 0; counters.boardBuildMs = 0;
  lastLog = now;
}

export function perfSnapshot(): PerfCounters {
  return { ...counters };
}
