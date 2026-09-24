/**
 * The monitor widget: a `monitor.system` node's face, drawn from live hardware readings.
 *
 * William: "when double clicked the data appears to populate, however I want the actual node to be
 * a monitor / show live update data like a widget." The double-click panel stays as the full
 * readout (SystemMonitor.tsx). This is the glanceable version, painted into the node's own sprite
 * and refreshed every couple of seconds by BoardCanvas.
 *
 * ── What it shows, by size ────────────────────────────────────────────────────────────────────
 *
 * The layout fills the footprint in priority order and stops when it runs out of room:
 *
 *   1. bar rows: CPU load, GPU temperature, RAM, GPU load (GFX), VRAM
 *   2. per-thread micro-bars, one column per logical processor
 *   3. text lines: effective CPU clock, CPU die temperature, board temperature, GPU clock, GPU power
 *
 * A 4x4 node (M1, 64 art px square) gets the first three rows. A 6x10 node (M2) gets every row,
 * the threads, and most of the lines. Nothing is scaled to fit: a row either fits whole or is left
 * out.
 *
 * ── The rules it keeps ────────────────────────────────────────────────────────────────────────
 *
 * - A reading that could not be read is a dash, never a stand-in number (prime directive 1). The
 *   CPU die temperature in particular is a dash unless LibreHardwareMonitor is running, because
 *   the ACPI zone Windows does expose is a motherboard sensor; see packages/shared/hardware.ts.
 * - Levels come from packages/shared/hardware.ts (`BANDS`, `gpuTempBand`, `rampCells`), the same
 *   thresholds the panel uses. They are not restated here.
 * - Six colours: the room's mask-dark screen, silk, copper-dark, and ok/warn/fault. Exactly
 *   docs/02's budget for a frame, and the component bevel drawn over it uses two of the same six.
 * - Text is the board's silkscreen: Departure Mono at 11px, alpha thresholded to binary.
 * - Every coordinate is an integer. Bars are whole cells: a lit cell is its level's colour, and an
 *   unlit cell keeps a one-pixel tick in its level's colour. So an empty bar still shows where ok
 *   ends and warn begins, which is the panel's "expected vs actual" in two pixels of height.
 *
 * The layout is pure (`layoutMonitorWidget` takes a text-measuring function) so
 * test/monitor-widget.test.ts can hold it without a canvas.
 */

import {
  BANDS,
  gpuTempBand,
  levelFor,
  rampCells,
  type Band,
  type HardwareSnapshot,
  type Level
} from '@shared/hardware.js';
import { COPPER_DARK, FAULT, OK, SILK, WARN } from '@shared/palette.js';
import { measureSilkText, renderSilkText } from './silkscreen.js';

export type WidgetColor = 'screen' | 'silk' | 'dim' | Level;

export type WidgetOp =
  | { t: 'rect'; x: number; y: number; w: number; h: number; color: WidgetColor }
  | { t: 'text'; x: number; y: number; text: string; color: WidgetColor };

/** A labelled bar: the value, the scale it is read against, and what to print. */
export interface WidgetRow {
  label: string;
  value: number | null;
  max: number;
  band: Pick<Band, 'warn' | 'fault'>;
  text: string;
}

/** A labelled number with no bar. Level null prints it in silk. */
export interface WidgetLine {
  label: string;
  text: string;
  level: Level | null;
}

export interface WidgetData {
  rows: WidgetRow[];
  /** Per-thread load in percent, null where the first sample has not been differenced yet. */
  threads: (number | null)[];
  lines: WidgetLine[];
}

const DASH = '-';

/** Inside the component's two-pixel bevel, plus one pixel of breathing room. */
export const WIDGET_PAD = 3;
/** Departure Mono's line at 11px. */
const TEXT_H = 11;
const BAR_H = 2;
/** Label line, one pixel, the bar, two pixels of gap. */
const ROW_H = TEXT_H + 1 + BAR_H + 2;
const LINE_H = TEXT_H + 2;
const THREAD_H = 12;
const MAX_CELLS = 16;

const pct = (value: number | null): string => (value === null ? DASH : `${Math.round(value)}%`);
const deg = (value: number | null): string => (value === null ? DASH : `${Math.round(value)}°`);

/** A clock in five characters or fewer: `4.59G`, `800M`. */
export function shortMHz(mhz: number | null): string {
  if (mhz === null || !Number.isFinite(mhz)) return DASH;
  return mhz >= 1000 ? `${(mhz / 1000).toFixed(2)}G` : `${Math.round(mhz)}M`;
}

/** What the widget draws, from a snapshot. Null (nothing read yet) is all dashes. */
export function widgetData(snapshot: HardwareSnapshot | null): WidgetData {
  const s = snapshot;
  const gpu = s ? (s.gpus.find((g) => g.source === 'nvidia-smi') ?? s.gpus[0] ?? null) : null;
  const tempBand = gpu?.tempC !== null && gpu?.tempC !== undefined
    ? gpuTempBand(gpu.tempC, gpu.slowdownMarginC)
    : { ...BANDS.gpuTempFallback, max: 100 };
  const ramPct = s && s.memory.totalBytes > 0 ? (s.memory.usedBytes / s.memory.totalBytes) * 100 : null;
  const vramPct = gpu?.vramUsedMiB !== null && gpu?.vramUsedMiB !== undefined && gpu.vramTotalMiB
    ? (gpu.vramUsedMiB / gpu.vramTotalMiB) * 100
    : null;

  const rows: WidgetRow[] = [
    { label: 'CPU', value: s?.cpu.usage ?? null, max: 100, band: BANDS.load, text: pct(s?.cpu.usage ?? null) },
    { label: 'GPU', value: gpu?.tempC ?? null, max: tempBand.max, band: tempBand, text: deg(gpu?.tempC ?? null) },
    { label: 'RAM', value: ramPct, max: 100, band: BANDS.memory, text: pct(ramPct) },
    { label: 'GFX', value: gpu?.usage ?? null, max: 100, band: BANDS.load, text: pct(gpu?.usage ?? null) },
    { label: 'VRAM', value: vramPct, max: 100, band: BANDS.vram, text: pct(vramPct) }
  ];

  // The die, only ever from a real CPU sensor. The hottest core is the one that matters.
  const cpuTemps = (s?.temperatures ?? []).filter((t) => t.part === 'cpu').map((t) => t.celsius);
  const die = cpuTemps.length ? Math.max(...cpuTemps) : null;
  const boardTemp = (s?.temperatures ?? []).find((t) => t.part === 'board')?.celsius ?? null;
  const powerW = gpu?.powerW ?? null;

  const lines: WidgetLine[] = [
    { label: 'CLK', text: shortMHz(s?.cpu.effectiveMHz ?? null), level: null },
    { label: 'DIE', text: deg(die), level: die === null ? null : levelFor(die, BANDS.cpuTemp) },
    { label: 'BRD', text: deg(boardTemp), level: boardTemp === null ? null : levelFor(boardTemp, BANDS.boardTemp) },
    { label: 'GCK', text: shortMHz(gpu?.clockMHz ?? null), level: null },
    {
      label: 'PWR',
      text: powerW === null ? DASH : `${Math.round(powerW)}W`,
      level: powerW !== null && gpu?.powerLimitW ? levelFor((powerW / gpu.powerLimitW) * 100, BANDS.power) : null
    }
  ];

  return { rows, threads: s ? s.cpu.threads.map((t) => t.usage) : [], lines };
}

/**
 * Lay the widget out for a face of `w` x `h` art pixels. Every op lies inside the face.
 *
 * `measure` is the width of a string in the board's 11px silkscreen: `measureWidgetText` in the
 * renderer, a stand-in in tests.
 */
export function layoutMonitorWidget(w: number, h: number, data: WidgetData, measure: (text: string) => number): WidgetOp[] {
  const ops: WidgetOp[] = [{ t: 'rect', x: 0, y: 0, w, h, color: 'screen' }];
  const x0 = WIDGET_PAD;
  const innerW = w - WIDGET_PAD * 2;
  const bottom = h - WIDGET_PAD;
  let y = WIDGET_PAD;
  if (innerW < 12 || bottom - y < TEXT_H) return ops;

  /** Label left, value right. The label goes first if the two would collide. */
  const labelled = (label: string, text: string, color: WidgetColor): void => {
    const valueW = measure(text);
    if (valueW > innerW) return;
    ops.push({ t: 'text', x: x0 + innerW - valueW, y, text, color });
    if (measure(label) + 2 + valueW <= innerW) ops.push({ t: 'text', x: x0, y, text: label, color: 'silk' });
  };

  // 1. Bar rows. A row needs its label line and its bar; the trailing gap may fall off the end.
  const cells = Math.max(1, Math.min(MAX_CELLS, Math.floor((innerW + 1) / 3)));
  const cellW = Math.max(1, Math.floor((innerW + 1) / cells) - 1);
  for (const row of data.rows) {
    if (y + TEXT_H + 1 + BAR_H > bottom) break;
    const level = row.value === null ? null : levelFor(row.value, row.band);
    labelled(row.label, row.text, level ?? 'dim');
    const barY = y + TEXT_H + 1;
    rampCells(row.value ?? 0, row.max, row.band, cells).forEach((cell, i) => {
      const x = x0 + i * (cellW + 1);
      if (row.value !== null && cell.lit) ops.push({ t: 'rect', x, y: barY, w: cellW, h: BAR_H, color: cell.level });
      else ops.push({ t: 'rect', x, y: barY + BAR_H - 1, w: cellW, h: 1, color: cell.level });
    });
    y += ROW_H;
  }

  // 2. Threads: one column each, filled from the bottom, wrapped into as many rows as it takes.
  const n = data.threads.length;
  if (n && y + THREAD_H <= bottom) {
    const cols = Math.min(n, Math.max(1, Math.floor((innerW + 1) / 2)));
    const bands = Math.ceil(n / cols);
    const barH = bands === 1 ? THREAD_H : Math.floor((THREAD_H - (bands - 1)) / bands);
    const barW = Math.max(1, Math.floor((innerW + 1) / cols) - 1);
    if (barH >= 3) {
      data.threads.forEach((usage, i) => {
        const x = x0 + (i % cols) * (barW + 1);
        const base = y + Math.floor(i / cols) * (barH + 1) + barH; // one past the column's bottom
        if (usage === null) {
          ops.push({ t: 'rect', x, y: base - 1, w: barW, h: 1, color: 'dim' });
          return;
        }
        const lit = Math.max(1, Math.round((Math.min(100, Math.max(0, usage)) / 100) * barH));
        ops.push({ t: 'rect', x, y: base - lit, w: barW, h: lit, color: levelFor(usage, BANDS.load) });
      });
      y += THREAD_H + 3;
    }
  }

  // 3. Text lines.
  for (const line of data.lines) {
    if (y + TEXT_H > bottom) break;
    labelled(line.label, line.text, line.text === DASH ? 'dim' : (line.level ?? 'silk'));
    y += LINE_H;
  }

  return ops;
}

/** The width of a string in the board's 11px silkscreen. */
export function measureWidgetText(text: string): number {
  return measureSilkText(text, 11);
}

function colorOf(color: WidgetColor, screen: string): string {
  switch (color) {
    case 'screen': return screen;
    case 'silk': return SILK;
    case 'dim': return COPPER_DARK;
    case 'ok': return OK;
    case 'warn': return WARN;
    case 'fault': return FAULT;
  }
}

/** Every revision of every widget gets a key the sprite store has never seen. */
let revision = 0;

/**
 * Bring a node's widget face up to date. Returns the canvas to use and whether it changed.
 *
 * Nothing is repainted, and no new texture is asked for, when the layout came out identical to the
 * last one: the readings round to the same cells and the same text more often than not, and every
 * repaint is a texture upload. The canvas carries two stamps for the sprite store: `glowKey`, the
 * cache key for these exact pixels, and `liveFace`, the slot whose previous texture this one
 * replaces (see live-slots.ts).
 */
export function updateMonitorFace(
  previous: HTMLCanvasElement | undefined,
  slot: string,
  snapshot: HardwareSnapshot | null,
  w: number,
  h: number,
  theme: { maskDark: string }
): { canvas: HTMLCanvasElement; changed: boolean } {
  const ops = layoutMonitorWidget(w, h, widgetData(snapshot), measureWidgetText);
  const signature = `${w}x${h}|${theme.maskDark}|${JSON.stringify(ops)}`;
  if (previous && previous.dataset['widgetSig'] === signature) return { canvas: previous, changed: false };

  const canvas = previous ?? document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas, changed: false };
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w, h);
  for (const op of ops) {
    if (op.t === 'rect') {
      ctx.fillStyle = colorOf(op.color, theme.maskDark);
      ctx.fillRect(op.x, op.y, op.w, op.h);
    } else {
      ctx.drawImage(renderSilkText(op.text, 11, colorOf(op.color, theme.maskDark)).canvas, op.x, op.y);
    }
  }
  canvas.dataset['widgetSig'] = signature;
  canvas.dataset['liveFace'] = slot;
  canvas.dataset['glowKey'] = `monitor:${slot}:${++revision}`;
  return { canvas, changed: true };
}
