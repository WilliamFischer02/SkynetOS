/**
 * The calendar pane's face: a `panel.calendar` node drawn as silkscreen on its own package.
 *
 * William: "I also want a live pane in the SkynetOS program that shows the calendar, both within the
 * room and on the main board." The spec's "Future" note (scheduleos-room.md) named the shape: seven
 * columns, blocks as copper pads. This module decides every pixel of it as a list of drawing ops;
 * src/renderer/board/calendar-widget.ts paints them onto a canvas the size of the footprint, and the
 * sprite pipeline scales that by whole numbers like any other face (the monitor widget's path).
 *
 * ── What it draws, top to bottom ──────────────────────────────────────────────────────────────
 *
 *   header      one 11 px line: each column's weekday, `WED 30`, else `W30`, else `W`, whichever
 *               fits; today's in the signal colour. A copper-dark rule under it.
 *   all-day     a 3 px strip per column holding an all-day event, in its category's fill.
 *   grid        the hours of `showHours`, `pxPerHour = floor(gridHeight / hours)` so every hour is
 *               the same whole number of pixels. A dotted copper-dark rule and a copper-dark hour
 *               label (24 h, `9`, `13`) every `ceil(12 / pxPerHour)` hours, labels only when the
 *               pane is not compact and the gutter fits.
 *   columns     today's column on mask-light. An OFF DAY (an all-day `⛔` event) hatched in
 *               copper-dark, an empty day (no timed block) a faint copper-dark dot grid, a day the
 *               file does not cover left bare (not dotted: nothing is known about it).
 *   pads        each timed block a pad from its start to its end, 1 px gutter below, clipped to the
 *               hour range. A PBS prep step is a narrower pad (2 px in from each side) so the chain
 *               reads as a stack of small pads above the shift. A pad at least 12 px tall and wide
 *               enough carries its category mark and the first word of its title (`P PBS`,
 *               `$ EARN`), else the mark alone, else nothing.
 *   NOW         a 1 px signal line across today's column at the current minute, and a 2×3 notch
 *               in the hour gutter when there is one.
 *
 * `compact: true` (the root board's small copy) is three days from the start, no hour labels.
 *
 * ── Six colours ──────────────────────────────────────────────────────────────────────────────
 *
 * The room's own six and nothing else: mask-dark (the screen), mask-light (today, outlined pads),
 * copper, copper-dark (rules, labels, hatching, dots), silk (text) and signal (NOW, today's
 * initial, PBS). The week view's Google colours are mapped onto them (CATEGORY_STYLE): income is a
 * copper pad (banana → gold), PBS a signal pad (the anchor, the thing that must not be missed),
 * stream a silk pad, hobbies a mask-light pad outlined in copper, upkeep a copper-dark pad, and
 * everything else a mask-light pad outlined in copper-dark. The emoji glyphs of the titles are not
 * drawn: an emoji through the binary silkscreen is a blob. Each category has a one-character mark
 * instead (CATEGORY_MARK).
 *
 * ── Integers ─────────────────────────────────────────────────────────────────────────────────
 *
 * Every coordinate and size is a whole number, by `Math.floor` of integer products, never a
 * fraction scaled afterwards: test/calendar-face.test.ts holds it for a real week at several sizes.
 *
 * Pure: the clock is the `now` passed in and text is measured by the function passed in.
 */
import type { CalendarBlock, CalendarDay, CalendarFile } from './schedule-calendar.js';
import { NO_CALENDAR, NO_CALENDAR_FIX } from './schedule-calendar.js';
import { SCHEDULE_TZ, addDays, dayKey, minutesInto, weekOf, zonedParts, zonedToMs, type Category } from './schedule-week.js';
import type { BoardNode } from './types.js';

export type FaceColor = 'screen' | 'panel' | 'copper' | 'dim' | 'silk' | 'signal';

export type FaceOp =
  | { t: 'rect'; x: number; y: number; w: number; h: number; color: FaceColor }
  | { t: 'text'; x: number; y: number; text: string; color: FaceColor }
  /** Every pixel of the rectangle where (x + y) is a multiple of `step`: a 45° hatch in single pixels. */
  | { t: 'hatch'; x: number; y: number; w: number; h: number; step: number; color: FaceColor }
  /** One pixel every `step` pixels across and down, starting at (x, y). */
  | { t: 'dots'; x: number; y: number; w: number; h: number; step: number; color: FaceColor }
  /** A one-pixel dotted rule: every other pixel from x. */
  | { t: 'dash'; x: number; y: number; w: number; color: FaceColor };

/** Inside the component's two-pixel bevel, plus one pixel of breathing room (the monitor's). */
export const FACE_PAD = 3;
/** Departure Mono's line at 11 px. */
export const TEXT_H = 11;
const HEADER_H = TEXT_H + 2;
const ALLDAY_H = 3;
const GAP = 1;
/** A pad this tall carries a label: the 11 px line and one pixel above it. */
export const LABEL_MIN_H = TEXT_H + 1;
const PATTERN_STEP = 4;

export const CALENDAR_DEFAULTS = { days: 7, start: 'today' as const, showHours: [7, 23] as [number, number], compact: false };
export const CALENDAR_START = ['today', 'monday'] as const;
export type CalendarStart = (typeof CALENDAR_START)[number];

export interface CalendarFaceOptions {
  days: number;
  start: CalendarStart;
  showHours: [number, number];
  compact: boolean;
}

/** A node's pane settings with the schema's defaults applied and every value clamped to range. */
export function calendarOptions(node: Pick<BoardNode, 'days' | 'start' | 'showHours' | 'compact'>): CalendarFaceOptions {
  const compact = node.compact === true;
  const rawDays = typeof node.days === 'number' && Number.isInteger(node.days) ? node.days : CALENDAR_DEFAULTS.days;
  const days = compact ? 3 : Math.min(14, Math.max(1, rawDays));
  const start: CalendarStart = node.start === 'monday' ? 'monday' : 'today';
  let [from, to] = Array.isArray(node.showHours) && node.showHours.length === 2 ? node.showHours : CALENDAR_DEFAULTS.showHours;
  from = Math.min(23, Math.max(0, Math.round(Number(from) || 0)));
  to = Math.min(24, Math.max(1, Math.round(Number(to) || 24)));
  if (to <= from) [from, to] = CALENDAR_DEFAULTS.showHours;
  return { days, start, showHours: [from, to], compact };
}

/**
 * The editor's `hours` control: `7-23` (or `7–23`, `7 23`) → [7, 23]. Empty is null, meaning the
 * default. Anything that is not two whole hours with 0 ≤ from < to ≤ 24 is 'invalid'.
 */
export function parseShowHours(text: string): [number, number] | null | 'invalid' {
  const t = text.trim();
  if (!t) return null;
  const m = /^(\d{1,2})\s*(?:-|–|—|to|\s)\s*(\d{1,2})$/.exec(t);
  if (!m) return 'invalid';
  const from = Number(m[1]);
  const to = Number(m[2]);
  return from >= 0 && to <= 24 && from < to ? [from, to] : 'invalid';
}

/** The editor's text for a stored `showHours`; empty for the default. */
export function formatShowHours(hours: unknown): string {
  return Array.isArray(hours) && hours.length === 2 ? `${Number(hours[0])}-${Number(hours[1])}` : '';
}

/** How each category's pad is drawn: its fill, its outline (or none), and the ink of its label. */
export const CATEGORY_STYLE: Record<Category, { fill: FaceColor; edge: FaceColor | null; ink: FaceColor }> = {
  income: { fill: 'copper', edge: null, ink: 'screen' },
  pbs: { fill: 'signal', edge: null, ink: 'screen' },
  stream: { fill: 'silk', edge: null, ink: 'screen' },
  hobbies: { fill: 'panel', edge: 'copper', ink: 'silk' },
  upkeep: { fill: 'dim', edge: null, ink: 'silk' },
  card: { fill: 'panel', edge: 'dim', ink: 'silk' },
  off: { fill: 'panel', edge: 'dim', ink: 'silk' },
  wind: { fill: 'panel', edge: 'dim', ink: 'silk' },
  other: { fill: 'panel', edge: 'dim', ink: 'silk' }
};

/** The one-character mark each category prints in place of its emoji glyph. */
export const CATEGORY_MARK: Record<Category, string> = {
  income: '$', pbs: 'P', stream: 'S', hobbies: 'H', upkeep: 'U', card: '*', off: 'X', wind: 'Z', other: ''
};

/** `📺 PBS 5:30–10:30 · VB` → `PBS`. ASCII only (the silkscreen font's own glyphs), at most 8 letters. */
export function firstWord(title: string): string {
  const ascii = title.replace(/[^\x20-\x7E]/g, ' ');
  const m = /[A-Za-z0-9][A-Za-z0-9'&+\-/.:]*/.exec(ascii);
  return m ? m[0].replace(/[.:]+$/, '').slice(0, 8).toUpperCase() : '';
}

const WEEKDAY3 = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** The dates of the pane's columns. */
export function columnDates(now: number, opts: CalendarFaceOptions, tz = SCHEDULE_TZ): string[] {
  const first = opts.start === 'monday' ? weekOf(now, tz).start : dayKey(now, tz);
  return Array.from({ length: opts.days }, (_, i) => addDays(first, i, tz));
}

/**
 * Where a block's pad sits vertically, or null when it falls outside the hours shown.
 *
 * `startMin`/`endMin` are minutes after the day's local midnight. Clipped to `[from, to)` hours,
 * then `y = gridTop + floor(minutes × pxPerHour / 60)` for both edges, and one pixel of gutter off
 * the bottom so two pads that meet stay two pads. Never less than one pixel tall.
 */
export function padSpan(
  startMin: number,
  endMin: number,
  hours: readonly [number, number],
  gridTop: number,
  pxPerHour: number
): { y: number; h: number } | null {
  const lo = hours[0] * 60;
  const hi = hours[1] * 60;
  const s = Math.max(lo, Math.round(startMin));
  const e = Math.min(hi, Math.round(endMin));
  if (e <= s) return null;
  const y1 = gridTop + Math.floor(((s - lo) * pxPerHour) / 60);
  const y2 = gridTop + Math.floor(((e - lo) * pxPerHour) / 60);
  return { y: y1, h: Math.max(1, y2 - y1 - 1) };
}

/** A column's timed blocks as pad rectangles: the pure core the face and the test share. */
export function dayPads(
  day: string,
  blocks: readonly CalendarBlock[],
  hours: readonly [number, number],
  column: { x: number; w: number },
  gridTop: number,
  pxPerHour: number,
  tz = SCHEDULE_TZ
): Array<{ block: CalendarBlock; x: number; y: number; w: number; h: number }> {
  const out: Array<{ block: CalendarBlock; x: number; y: number; w: number; h: number }> = [];
  for (const block of blocks) {
    if (block.allDay) continue;
    const start = Date.parse(block.start);
    const end = Date.parse(block.end);
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    const startMin = minutesInto(day, start, tz);
    const span = padSpan(startMin, startMin + Math.round((end - start) / 60000), hours, gridTop, pxPerHour);
    if (!span) continue;
    const inset = block.kind === 'chain' && column.w >= 9 ? 2 : 0;
    out.push({ block, x: column.x + inset, y: span.y, w: column.w - inset * 2, h: span.h });
  }
  return out;
}

export type CalendarFaceInput =
  | { state: 'ready'; calendar: CalendarFile }
  | { state: 'missing'; reason?: string }
  | { state: 'loading' };

/** Greedy word wrap into lines no wider than `width`. A word wider than the line is kept whole. */
function wrap(text: string, width: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > width) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Centred lines of text on a bare screen: the failure face and the first-read face. */
function messageFace(w: number, h: number, parts: Array<{ text: string; color: FaceColor }>, measure: (s: string) => number): FaceOp[] {
  const ops: FaceOp[] = [{ t: 'rect', x: 0, y: 0, w, h, color: 'screen' }];
  const innerW = w - FACE_PAD * 2;
  if (innerW < 8 || h - FACE_PAD * 2 < TEXT_H) return ops;
  const lines = parts.flatMap((p) => wrap(p.text, innerW, measure).map((text) => ({ text, color: p.color })));
  const lineH = TEXT_H + 2;
  const fit = Math.max(1, Math.floor((h - FACE_PAD * 2 + 2) / lineH));
  const shown = lines.slice(0, fit);
  let y = Math.floor((h - shown.length * lineH + 2) / 2);
  for (const line of shown) {
    const tw = measure(line.text);
    if (tw <= innerW) ops.push({ t: 'text', x: Math.floor((w - tw) / 2), y, text: line.text, color: line.color });
    y += lineH;
  }
  return ops;
}

/**
 * Lay the pane out for a face of `w` × `h` art pixels (the footprint × 16). Every op lies inside
 * the face and every number in it is an integer.
 */
export function layoutCalendarFace(
  w: number,
  h: number,
  input: CalendarFaceInput,
  opts: CalendarFaceOptions,
  now: number,
  measure: (text: string) => number,
  tz = SCHEDULE_TZ
): FaceOp[] {
  if (input.state === 'missing') {
    return messageFace(w, h, [{ text: NO_CALENDAR, color: 'silk' }, { text: NO_CALENDAR_FIX, color: 'copper' }], measure);
  }
  if (input.state === 'loading') return messageFace(w, h, [{ text: 'READING CALENDAR', color: 'dim' }], measure);

  const ops: FaceOp[] = [{ t: 'rect', x: 0, y: 0, w, h, color: 'screen' }];
  const innerW = w - FACE_PAD * 2;
  const top = FACE_PAD;
  const bottom = h - FACE_PAD;
  if (innerW < 12 || bottom - top < HEADER_H + ALLDAY_H + 8) return ops;

  const dates = columnDates(now, opts, tz);
  let n = dates.length;
  const minCol = 3;
  let labelW = opts.compact ? 0 : measure('23') + 2;
  if (labelW && labelW + n * (minCol + GAP) > innerW) labelW = 0;
  if (n * (minCol + GAP) - GAP > innerW - labelW) n = Math.max(1, Math.floor((innerW - labelW + GAP) / (minCol + GAP)));
  const colW = Math.floor((innerW - labelW - (n - 1) * GAP) / n);
  const used = labelW + n * colW + (n - 1) * GAP;
  const left = FACE_PAD + Math.floor((innerW - used) / 2);
  const colX = (i: number): number => left + labelW + i * (colW + GAP);
  const gridX = colX(0);
  const gridW = n * colW + (n - 1) * GAP;

  const byDate = new Map<string, CalendarDay>(input.calendar.days.map((d) => [d.date, d]));
  const today = dayKey(now, tz);

  const headerY = top;
  const allDayY = top + HEADER_H + 1;
  const gridTop = allDayY + ALLDAY_H + 2;
  const [from, to] = opts.showHours;
  const hours = to - from;
  const pxPerHour = Math.max(1, Math.floor((bottom - gridTop) / hours));
  const gridBottom = Math.min(bottom, gridTop + hours * pxPerHour);
  const gridH = gridBottom - gridTop;

  // Column grounds: today lit, an off day hatched, an empty day dotted, an unknown day bare.
  const columns = dates.slice(0, n).map((date, i) => {
    const day = byDate.get(date);
    const blocks = day?.blocks ?? [];
    const off = blocks.some((b) => b.allDay && b.category === 'off');
    const timed = blocks.filter((b) => !b.allDay);
    return { date, i, x: colX(i), known: Boolean(day), blocks, off, empty: Boolean(day) && !off && timed.length === 0 };
  });
  for (const c of columns) {
    if (c.date === today) ops.push({ t: 'rect', x: c.x, y: gridTop, w: colW, h: gridH, color: 'panel' });
    if (c.off) ops.push({ t: 'hatch', x: c.x, y: gridTop, w: colW, h: gridH, step: PATTERN_STEP, color: 'dim' });
    else if (c.empty) ops.push({ t: 'dots', x: c.x + 1, y: gridTop + 1, w: colW - 1, h: gridH - 1, step: PATTERN_STEP, color: 'dim' });
  }

  // Hour rules and labels: one every `every` hours, so two labels never touch.
  const every = Math.max(1, Math.ceil((TEXT_H + 1) / pxPerHour));
  for (let hr = from; hr < to; hr++) {
    if ((hr - from) % every !== 0) continue;
    const y = gridTop + (hr - from) * pxPerHour;
    if (hr > from) ops.push({ t: 'dash', x: gridX, y, w: gridW, color: 'dim' });
    if (labelW && y + 1 + TEXT_H <= bottom) {
      const text = String(hr % 24);
      ops.push({ t: 'text', x: left + labelW - 2 - measure(text), y: y + 1, text, color: 'dim' });
    }
  }

  // All-day strips (an off day's own mark is its hatching).
  for (const c of columns) {
    const allDay = c.blocks.find((b) => b.allDay && b.category !== 'off');
    if (allDay) ops.push({ t: 'rect', x: c.x, y: allDayY, w: colW, h: ALLDAY_H, color: CATEGORY_STYLE[allDay.category].fill });
  }

  // Pads, then their labels.
  for (const c of columns) {
    for (const pad of dayPads(c.date, c.blocks, opts.showHours, { x: c.x, w: colW }, gridTop, pxPerHour, tz)) {
      const style = CATEGORY_STYLE[pad.block.category];
      const outlined = style.edge !== null && pad.w >= 3 && pad.h >= 3;
      ops.push({ t: 'rect', x: pad.x, y: pad.y, w: pad.w, h: pad.h, color: outlined || style.edge === null ? style.fill : style.edge });
      if (outlined) {
        const e = style.edge as FaceColor;
        ops.push({ t: 'rect', x: pad.x, y: pad.y, w: pad.w, h: 1, color: e });
        ops.push({ t: 'rect', x: pad.x, y: pad.y + pad.h - 1, w: pad.w, h: 1, color: e });
        ops.push({ t: 'rect', x: pad.x, y: pad.y, w: 1, h: pad.h, color: e });
        ops.push({ t: 'rect', x: pad.x + pad.w - 1, y: pad.y, w: 1, h: pad.h, color: e });
      }
      if (pad.h < LABEL_MIN_H) continue;
      const mark = CATEGORY_MARK[pad.block.category];
      const word = firstWord(pad.block.title);
      const room = pad.w - 3;
      const text = [mark && word ? `${mark} ${word}` : mark || word, mark, word]
        .find((t) => t && measure(t) <= room);
      if (text) ops.push({ t: 'text', x: pad.x + 2, y: pad.y + 1, text, color: style.ink });
    }
  }

  // NOW, on today's column, while the minute is inside the hours shown.
  const todayCol = columns.find((c) => c.date === today);
  if (todayCol) {
    const p = zonedParts(now, tz);
    const nowMin = p.hour * 60 + p.minute;
    if (nowMin >= from * 60 && nowMin < to * 60) {
      const y = gridTop + Math.floor(((nowMin - from * 60) * pxPerHour) / 60);
      ops.push({ t: 'rect', x: todayCol.x, y, w: colW, h: 1, color: 'signal' });
      // The notch sits in the hour gutter, which only the first column has beside it.
      if (todayCol.i === 0 && labelW >= 3 && y >= 1) ops.push({ t: 'rect', x: todayCol.x - 3, y: y - 1, w: 2, h: 3, color: 'signal' });
    }
  }

  // Header last, so nothing above can cover a weekday.
  for (const c of columns) {
    const p = zonedParts(zonedToMs(c.date, '12:00', tz), tz);
    const name = WEEKDAY3[p.weekday] ?? '?';
    const text = [`${name} ${p.day}`, `${name[0]}${p.day}`, name[0] ?? '?'].find((t) => measure(t) <= colW - 1);
    if (text) ops.push({ t: 'text', x: c.x + Math.floor((colW - measure(text)) / 2), y: headerY, text, color: c.date === today ? 'signal' : 'silk' });
  }
  ops.push({ t: 'rect', x: gridX, y: top + HEADER_H - 1, w: gridW, h: 1, color: 'dim' });

  return ops;
}
