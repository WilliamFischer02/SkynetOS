/**
 * Boot timing: where the milliseconds go between the process starting and the first board painted.
 *
 * William, 2026-09-26: "really snappy, everything from boot up". Guessing at boot cost is how boot
 * cost grows, so main marks each step with `bootMark`, prints them once as `[boot]` lines when the
 * first board has been loaded, and writes them to `userData/boot-timing.json` so the next audit can
 * compare against this one. Pure bookkeeping: nothing here changes what boots or when.
 */
import { performance } from 'node:perf_hooks';

export interface BootMark { name: string; at: number; sinceStart: number }
export interface BootTiming {
  /** ms from the process starting to `app.whenReady`, from `process.uptime()`. */
  processToReady: number;
  marks: BootMark[];
  /** Deltas between consecutive marks, largest first, so the slow step is the first line. */
  slowest: { from: string; to: string; ms: number }[];
  writtenAt: string;
}

const marks: BootMark[] = [];
let readyAt: number | null = null;
let processToReady = 0;
let reported = false;
let reportTimer: NodeJS.Timeout | null = null;
let writer: ((timing: BootTiming) => void) | null = null;

/** Called once at `app.whenReady`; every later mark is measured from here. */
export function bootStart(): void {
  readyAt = performance.now();
  processToReady = Math.round(process.uptime() * 1000);
  marks.length = 0;
  bootMark('ready');
}

export function bootMark(name: string): void {
  if (readyAt === null) return;
  const at = performance.now();
  marks.push({ name, at, sinceStart: Math.round((at - readyAt) * 10) / 10 });
}

/** How the report leaves the process (a file under userData); set by index.ts once `app` exists. */
export function setBootWriter(fn: (timing: BootTiming) => void): void {
  writer = fn;
}

export function bootTiming(): BootTiming {
  const slowest = marks
    .slice(1)
    .map((m, i) => ({ from: marks[i]!.name, to: m.name, ms: Math.round((m.at - marks[i]!.at) * 10) / 10 }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 6);
  return { processToReady, marks: [...marks], slowest, writtenAt: new Date().toISOString() };
}

/**
 * Print and write once, a moment after the first board load so `ready-to-show` and the deferred
 * services have had their turn. Safe to call more than once; the second call is a no-op.
 */
export function scheduleBootReport(delayMs = 3000): void {
  if (reported || reportTimer) return;
  reportTimer = setTimeout(() => {
    reportTimer = null;
    if (reported) return;
    reported = true;
    const timing = bootTiming();
    console.log(`[boot] process → ready ${timing.processToReady} ms`);
    for (const m of timing.marks) console.log(`[boot] +${m.sinceStart.toFixed(1).padStart(8)} ms  ${m.name}`);
    for (const s of timing.slowest) console.log(`[boot] slowest: ${s.from} → ${s.to} ${s.ms} ms`);
    try { writer?.(timing); } catch (err) { console.warn('[boot] could not write boot-timing.json:', (err as Error).message); }
  }, delayMs);
  reportTimer.unref?.();
}

/** For tests. */
export function resetBootTiming(): void {
  marks.length = 0; readyAt = null; processToReady = 0; reported = false;
  if (reportTimer) { clearTimeout(reportTimer); reportTimer = null; }
}
