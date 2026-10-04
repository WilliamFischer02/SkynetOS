import { describe, expect, it } from 'vitest';
import {
  CATEGORY_STYLE,
  calendarOptions,
  columnDates,
  dayPads,
  firstWord,
  formatShowHours,
  layoutCalendarFace,
  padSpan,
  parseShowHours,
  type FaceColor,
  type FaceOp
} from '../packages/shared/calendar-face.js';
import { mergeCalendar, type CalendarFile } from '../packages/shared/schedule-calendar.js';
import type { PbsShift } from '../packages/shared/schedule-week.js';

/**
 * The calendar pane's face (packages/shared/calendar-face.ts). What is pinned: pads land where their
 * minutes say, every number is an integer, nothing leaves the face, only the six colours are used,
 * and the failure face says what to run.
 */

/** Departure Mono at 11 px advances six pixels a character (as test/monitor-widget.test.ts). */
const measure = (text: string): number => text.length * 6;

// Wednesday 30 September 2026, 12:00 in Denver.
const NOW = Date.parse('2026-09-30T18:00:00Z');
const shift: PbsShift = { date: '2026-10-01', call: '17:30', end: '22:30', sport: 'VB', opponent: 'Idaho' };

function week(): CalendarFile {
  return mergeCalendar({
    shifts: [shift],
    events: [
      { title: '💵 EARN · invoice', start: '2026-09-30T09:00:00-06:00', end: '2026-09-30T11:00:00-06:00' },
      { title: '🔴 LIVE stream', start: '2026-10-02T19:00:00-06:00', end: '2026-10-02T21:00:00-06:00' },
      { title: '⛔ OFF DAY', start: '2026-10-03', end: '2026-10-05', allDay: true },
      { title: '📖 READ', start: '2026-09-30T06:00:00-06:00', end: '2026-09-30T08:00:00-06:00' }
    ]
  }, NOW);
}

const ready = (calendar: CalendarFile) => ({ state: 'ready' as const, calendar });
const texts = (ops: FaceOp[]): string[] => ops.flatMap((op) => (op.t === 'text' ? [op.text] : []));

function extent(op: FaceOp): { w: number; h: number } {
  switch (op.t) {
    case 'text': return { w: measure(op.text), h: 11 };
    case 'dash': return { w: op.w, h: 1 };
    default: return { w: op.w, h: op.h };
  }
}

function pure(ops: FaceOp[], w: number, h: number): void {
  for (const op of ops) {
    const e = extent(op);
    const numbers = [op.x, op.y, e.w, e.h, ...('step' in op ? [op.step] : [])];
    expect(numbers.every(Number.isInteger), JSON.stringify(op)).toBe(true);
    expect(op.x >= 0 && op.y >= 0 && op.x + e.w <= w && op.y + e.h <= h, JSON.stringify(op)).toBe(true);
  }
}

describe('padSpan: where a block sits', () => {
  it('puts a block at whole pixels from its minutes, with a one-pixel gutter below', () => {
    // 07:00–23:00 at 10 px an hour: 17:30 is 105 px down, 22:30 is 155 px down.
    expect(padSpan(17 * 60 + 30, 22 * 60 + 30, [7, 23], 22, 10)).toEqual({ y: 127, h: 49 });
  });

  it('clips to the hours shown, and drops a block wholly outside them', () => {
    expect(padSpan(6 * 60, 8 * 60, [7, 23], 0, 10)).toEqual({ y: 0, h: 9 });
    expect(padSpan(5 * 60, 6 * 60, [7, 23], 0, 10)).toBeNull();
    expect(padSpan(23 * 60, 24 * 60, [7, 23], 0, 10)).toBeNull();
  });

  it('never draws a pad less than one pixel tall', () => {
    expect(padSpan(9 * 60, 9 * 60 + 5, [7, 23], 0, 10)).toEqual({ y: 20, h: 1 });
  });

  it('keeps every edge an integer whatever the scale', () => {
    for (const pxPerHour of [1, 3, 7, 10, 13]) {
      for (let m = 7 * 60; m < 23 * 60; m += 7) {
        const span = padSpan(m, m + 25, [7, 23], 5, pxPerHour)!;
        expect(Number.isInteger(span.y) && Number.isInteger(span.h)).toBe(true);
      }
    }
  });
});

describe('dayPads: one day as rectangles', () => {
  it('stacks the prep chain above the shift, narrower, all inside the column', () => {
    const cal = week();
    const day = cal.days.find((d) => d.date === '2026-10-01')!;
    const pads = dayPads(day.date, day.blocks, [7, 23], { x: 40, w: 50 }, 22, 10);
    expect(pads).toHaveLength(7);
    const shiftPad = pads.find((p) => p.block.kind === 'shift')!;
    expect(shiftPad).toMatchObject({ x: 40, w: 50, y: 127, h: 49 });
    for (const p of pads.filter((q) => q.block.kind === 'chain')) {
      expect(p.x).toBe(42);
      expect(p.w).toBe(46);
    }
    const before = pads.filter((p) => p.block.kind === 'chain' && Date.parse(p.block.start) < Date.parse(shiftPad.block.start));
    expect(before.every((p) => p.y + p.h <= shiftPad.y)).toBe(true);
  });

  it('leaves all-day events to the strip and the hatching', () => {
    const cal = week();
    const day = cal.days.find((d) => d.date === '2026-10-03')!;
    expect(dayPads(day.date, day.blocks, [7, 23], { x: 0, w: 20 }, 0, 10)).toEqual([]);
  });
});

describe('the face', () => {
  const sizes: Array<[number, number, string]> = [[24, 12, 'room'], [12, 8, 'root'], [18, 10, 'odd'], [6, 4, 'tiny']];

  it.each(sizes)('is pixel-pure at %i x %i tiles (%s)', (tw, th) => {
    const w = tw * 16;
    const h = th * 16;
    for (const compact of [false, true]) {
      pure(layoutCalendarFace(w, h, ready(week()), calendarOptions({ compact }), NOW, measure), w, h);
    }
  });

  it('draws only the room\'s six colours', () => {
    const allowed: FaceColor[] = ['screen', 'panel', 'copper', 'dim', 'silk', 'signal'];
    const ops = layoutCalendarFace(384, 192, ready(week()), calendarOptions({}), NOW, measure);
    expect(new Set(ops.map((o) => o.color)).size).toBeLessThanOrEqual(6);
    for (const op of ops) expect(allowed).toContain(op.color);
  });

  it('heads seven columns from today by default, today in signal', () => {
    const ops = layoutCalendarFace(384, 192, ready(week()), calendarOptions({}), NOW, measure);
    const heads = ops.filter((o): o is Extract<FaceOp, { t: 'text' }> => o.t === 'text' && /^[A-Z]{3} \d+$|^[A-Z]\d+$|^[A-Z]$/.test(o.text) && o.y === 3);
    expect(heads.map((h) => h.text)).toEqual(['WED 30', 'THU 1', 'FRI 2', 'SAT 3', 'SUN 4', 'MON 5', 'TUE 6']);
    expect(heads[0]!.color).toBe('signal');
    expect(heads.slice(1).every((h) => h.color === 'silk')).toBe(true);
  });

  it('starts on Monday when told to', () => {
    expect(columnDates(NOW, calendarOptions({ start: 'monday' }))[0]).toBe('2026-09-28');
    expect(columnDates(NOW, calendarOptions({}))[0]).toBe('2026-09-30');
  });

  it('labels the hours on the full pane and not on the compact one', () => {
    const full = texts(layoutCalendarFace(384, 192, ready(week()), calendarOptions({}), NOW, measure));
    const compact = texts(layoutCalendarFace(192, 128, ready(week()), calendarOptions({ compact: true }), NOW, measure));
    expect(full).toContain('7');
    expect(full).toContain('13');
    expect(compact.some((t) => /^\d+$/.test(t))).toBe(false);
  });

  it('draws three days, compact, whatever `days` says', () => {
    expect(calendarOptions({ compact: true, days: 7 }).days).toBe(3);
    const ops = layoutCalendarFace(192, 128, ready(week()), calendarOptions({ compact: true, days: 7 }), NOW, measure);
    expect(texts(ops).filter((t) => /^(WED|THU|FRI|W|T|F)/.test(t) && !/\s[A-Z]/.test(t)).length).toBeGreaterThanOrEqual(3);
    expect(texts(ops)).not.toContain('SAT 3');
  });

  it('draws a NOW line in the signal colour across today\'s column only', () => {
    const ops = layoutCalendarFace(384, 192, ready(week()), calendarOptions({}), NOW, measure);
    // 12:00 is five hours into 07:00–23:00: 50 px under the grid's top at 22.
    const lit = ops.find((o): o is Extract<FaceOp, { t: 'rect' }> => o.t === 'rect' && o.color === 'panel' && o.y > 15)!;
    const now = ops.filter((o): o is Extract<FaceOp, { t: 'rect' }> => o.t === 'rect' && o.color === 'signal' && o.h === 1 && o.y === 72);
    expect(now).toHaveLength(1);
    expect(now[0]).toMatchObject({ x: lit.x, w: lit.w });
    // And a notch in the hour gutter beside it.
    expect(ops.some((o) => o.t === 'rect' && o.color === 'signal' && o.w === 2 && o.h === 3 && o.y === 71)).toBe(true);
  });

  it('hatches an off day and dots an empty one', () => {
    const ops = layoutCalendarFace(384, 192, ready(week()), calendarOptions({}), NOW, measure);
    expect(ops.filter((o) => o.t === 'hatch')).toHaveLength(2); // Saturday and Sunday
    expect(ops.filter((o) => o.t === 'dots')).toHaveLength(2); // Monday and Tuesday have nothing
  });

  it('labels a pad tall enough with its mark and first word, in its category\'s ink', () => {
    const ops = layoutCalendarFace(384, 192, ready(week()), calendarOptions({}), NOW, measure);
    const pbs = ops.find((o) => o.t === 'text' && o.text === 'P PBS');
    expect(pbs).toBeDefined();
    expect(pbs!.color).toBe(CATEGORY_STYLE.pbs.ink);
    expect(texts(ops)).toContain('$ EARN');
    expect(texts(ops)).toContain('S LIVE');
  });

  it('says NO CALENDAR and what to run when the file is missing', () => {
    const ops = layoutCalendarFace(384, 192, { state: 'missing' }, calendarOptions({}), NOW, measure);
    expect(texts(ops)).toEqual(['NO CALENDAR', 'RUN npm run schedule:week']);
    pure(ops, 384, 192);
    // The compact copy wraps the command rather than cutting it.
    const small = layoutCalendarFace(192, 128, { state: 'missing' }, calendarOptions({ compact: true }), NOW, measure);
    expect(texts(small).join(' ')).toBe('NO CALENDAR RUN npm run schedule:week');
    pure(small, 192, 128);
  });
});

describe('the editor and the defaults', () => {
  it('applies the schema defaults and clamps', () => {
    expect(calendarOptions({})).toEqual({ days: 7, start: 'today', showHours: [7, 23], compact: false });
    expect(calendarOptions({ days: 40, showHours: [20, 5] })).toMatchObject({ days: 14, showHours: [7, 23] });
    expect(calendarOptions({ days: 0 }).days).toBe(1);
  });

  it('reads and writes the hours as from-to', () => {
    expect(parseShowHours('7-23')).toEqual([7, 23]);
    expect(parseShowHours(' 0 – 24 ')).toEqual([0, 24]);
    expect(parseShowHours('')).toBeNull();
    expect(parseShowHours('23-7')).toBe('invalid');
    expect(parseShowHours('7-25')).toBe('invalid');
    expect(parseShowHours('morning')).toBe('invalid');
    expect(formatShowHours([9, 17])).toBe('9-17');
    expect(formatShowHours(undefined)).toBe('');
  });

  it('prints the first word of a title in ASCII capitals, glyphs dropped', () => {
    expect(firstWord('📺 PBS 5:30–10:30 · VB')).toBe('PBS');
    expect(firstWord('🚿 T-55 SHOWER → PBS 5:30')).toBe('T-55');
    expect(firstWord('💵 earn: invoices')).toBe('EARN');
    expect(firstWord('📖')).toBe('');
  });
});
