import { describe, expect, it } from 'vitest';
import {
  SCHEDULE_TZ,
  blockFromEvent,
  blocksForWeek,
  categoryOf,
  clock,
  expandShift,
  hoursByCategory,
  offsetMinutes,
  readbackLine,
  renderTodayMd,
  renderWeekHtml,
  violations,
  weekOf,
  zonedToMs,
  type Block,
  type PbsShift
} from '../packages/shared/schedule-week.js';

const friday: PbsShift = { date: '2026-10-02', call: '17:30', sport: 'VB', opponent: 'Idaho', venue: 'Worthington Arena', role: 'GFX', source: 'text 2026-09-28', confidence: 'confirmed' };

describe('time in America/Denver', () => {
  it('knows the offset either side of the 2026-11-01 change without a hard-coded number', () => {
    expect(offsetMinutes(zonedToMs('2026-10-02', '12:00'), SCHEDULE_TZ)).toBe(-360);
    expect(offsetMinutes(zonedToMs('2026-11-15', '12:00'), SCHEDULE_TZ)).toBe(-420);
  });

  it('turns a local wall-clock time into the right instant', () => {
    expect(new Date(zonedToMs('2026-10-02', '17:30')).toISOString()).toBe('2026-10-02T23:30:00.000Z');
    expect(new Date(zonedToMs('2026-11-15', '17:30')).toISOString()).toBe('2026-11-16T00:30:00.000Z');
  });

  it('prints the clock as the titles read it', () => {
    expect(clock('17:30')).toBe('5:30');
    expect(clock('09:00')).toBe('9');
    expect(clock('12:00')).toBe('12');
    expect(clock('22:30')).toBe('10:30');
  });

  it('finds the Monday-to-Sunday week that holds an instant', () => {
    const w = weekOf(zonedToMs('2026-10-02', '10:00'));
    expect(w.start).toBe('2026-09-28');
    expect(w.end).toBe('2026-10-04');
    expect(w.days).toHaveLength(7);
    // Sunday belongs to the week that started the Monday before it, not the one after.
    expect(weekOf(zonedToMs('2026-10-04', '23:00')).start).toBe('2026-09-28');
  });
});

describe('expandShift', () => {
  it('produces the chain of specs/schedule-model.md §1 for a 17:30 call: seven events, the T−5 margin has none', () => {
    const blocks = expandShift(friday);
    expect(blocks.map((b) => [b.startMin, b.endMin, b.title])).toEqual([
      [16 * 60 + 35, 17 * 60, '🚿 T-55 SHOWER → PBS 5:30'],
      [17 * 60, 17 * 60 + 10, '🎒 T-30 GEAR + EAT → PBS 5:30'],
      [17 * 60 + 10, 17 * 60 + 15, '🚗 T-20 LEAVE NOW → PBS 5:30'],
      [17 * 60 + 15, 17 * 60 + 25, '🚶 T-15 WALK IN → PBS 5:30'],
      [17 * 60 + 30, 22 * 60 + 30, '📺 PBS 5:30–10:30 · VB vs Idaho · GFX'],
      [22 * 60 + 30, 22 * 60 + 45, '🚗 HOME · 15m'],
      [22 * 60 + 45, 23 * 60 + 15, '🛋 DECOMPRESS 30 · no screens']
    ]);
    expect(blocks.every((b) => b.day === '2026-10-02' && b.category === 'pbs')).toBe(true);
    expect(blocks.filter((b) => b.kind === 'shift')).toHaveLength(1);
    expect(blocks.filter((b) => b.kind === 'chain')).toHaveLength(6);
    expect(blocks.every((b) => !b.estimated)).toBe(true);
  });

  it('defaults the end to call + 5 h and, with nothing confirming it, marks the shift estimated', () => {
    const blocks = expandShift({ date: '2026-10-03', call: '13:00', sport: 'FB' });
    const shift = blocks.find((b) => b.kind === 'shift')!;
    expect(shift.title).toBe('📺 PBS 1–6 · FB');
    expect(shift.endMin).toBe(18 * 60);
    expect(shift.estimated).toBe(true);
  });

  it('honours an end the source gave', () => {
    const blocks = expandShift({ ...friday, end: '23:00' });
    const shift = blocks.find((b) => b.kind === 'shift')!;
    expect(shift.title).toBe('📺 PBS 5:30–11 · VB vs Idaho · GFX');
    expect(blocks.at(-1)!.endMin).toBe(23 * 60 + 45);
  });
});

describe('violations', () => {
  it('lets the decompress block after a shift run to 23:30, and no later', () => {
    const fine = expandShift({ date: '2026-10-02', call: '17:45', sport: 'VB' }); // decompress 23:00–23:30
    expect(fine.at(-1)!.endMin).toBe(23 * 60 + 30);
    expect(violations(fine)).toEqual([]);

    const late = expandShift({ date: '2026-10-02', call: '18:00', sport: 'VB' }); // decompress 23:15–23:45
    expect(violations(late).map((b) => b.title)).toEqual(['🛋 DECOMPRESS 30 · no screens']);
  });

  it('flags a real violation on either side of the quiet hours', () => {
    const early = blockFromEvent({ title: '📖 READ 30', start: '2026-10-01T05:30:00-06:00', end: '2026-10-01T06:00:00-06:00' })!;
    const late = blockFromEvent({ title: '💵 EARN 2h · Prolific', start: '2026-10-01T22:00:00-06:00', end: '2026-10-02T00:00:00-06:00' })!;
    const ok = blockFromEvent({ title: '🛌 WIND DOWN', start: '2026-10-01T22:30:00-06:00', end: '2026-10-01T23:00:00-06:00' })!;
    const allDay = blockFromEvent({ title: '⛔ OFF DAY · nothing owed', start: '2026-10-01', allDay: true })!;
    expect(violations([early, late, ok, allDay]).map((b) => b.title)).toEqual(['📖 READ 30', '💵 EARN 2h · Prolific']);
  });
});

describe('categories and hours', () => {
  it('reads the glyph, with or without the variation selector', () => {
    expect(categoryOf('💵 EARN 2h · DataAnnotation → ~$50')).toBe('income');
    expect(categoryOf('‼️ DATAANNOTATION TEST 90')).toBe('income');
    expect(categoryOf('☯️ MEDITATE 30')).toBe('upkeep');
    expect(categoryOf('☯ MEDITATE 30')).toBe('upkeep');
    expect(categoryOf('🔴 LIVE 7–9:30')).toBe('stream');
    expect(categoryOf('Dentist')).toBe('other');
  });

  it('sums hours per budget category and ignores all-day marks', () => {
    const blocks: Block[] = [
      ...expandShift(friday),
      blockFromEvent({ title: '💵 EARN 2h · Prolific', start: '2026-10-02T09:00:00-06:00', end: '2026-10-02T11:00:00-06:00' })!,
      blockFromEvent({ title: '⛔ OFF DAY · nothing owed', start: '2026-10-03' })!
    ];
    const hours = hoursByCategory(blocks);
    expect(hours.income).toBe(2);
    expect(hours.pbs).toBeCloseTo(395 / 60, 2); // 50 min of chain + 300 + 45; the T−5 margin is no event
    expect(hours.stream).toBe(0);
  });
});

describe('the week and the card', () => {
  it('renders a week with no inputs at all: seven day headers, no violations, no throw', () => {
    const week = weekOf(zonedToMs('2026-10-02', '10:00'));
    const byDay = blocksForWeek([], [], week);
    const html = renderWeekHtml({ week, byDay, today: '2026-10-02', tomorrowCard: renderTodayMd({ day: '2026-10-03', blocks: [] }), generatedAt: zonedToMs('2026-10-02', '06:45') });
    expect((html.match(/<section class="day/g) ?? []).length).toBe(7);
    for (const label of ['Mon Sep 28', 'Tue Sep 29', 'Wed Sep 30', 'Thu Oct 1', 'Fri Oct 2', 'Sat Oct 3', 'Sun Oct 4']) expect(html).toContain(label);
    expect(html).toContain('No block touches 23:00–07:30.');
    expect(html).not.toContain('<link');
    expect(html).not.toMatch(/src="http/);
  });

  it('draws the shift, its chain, the off day and a violation', () => {
    const week = weekOf(zonedToMs('2026-10-02', '10:00'));
    const byDay = blocksForWeek(
      [friday, { date: '2026-10-01', call: '18:00', sport: 'BB' }],
      [{ title: '⛔ OFF DAY · nothing owed', start: '2026-10-03', allDay: true }, { title: 'Dentist', start: '2026-10-01T06:00:00-06:00', end: '2026-10-01T07:00:00-06:00' }],
      week
    );
    const html = renderWeekHtml({ week, byDay, today: '2026-10-02', tomorrowCard: '', generatedAt: zonedToMs('2026-10-02', '06:45') });
    expect(html).toContain('📺 PBS 5:30–10:30 · VB vs Idaho · GFX');
    expect((html.match(/class="blk chain/g) ?? []).length).toBe(12);
    expect(html).toContain('class="day off"');
    expect(html).toContain('class="day today"');
    expect(html).toContain('23:00–07:30 violations (2)');
    expect(html).toContain('blk event other bad');
  });

  it('writes the four-line card, with the chain head beside the shift and a dash for an unknown streak', () => {
    const blocks = [
      blockFromEvent({ title: '💵 EARN 2h · DataAnnotation → ~$50', start: '2026-10-02T09:00:00-06:00', end: '2026-10-02T11:00:00-06:00' })!,
      ...expandShift(friday)
    ];
    expect(renderTodayMd({ day: '2026-10-02', blocks })).toBe(
      'TODAY Fri Oct 2\n' +
      'KEYSTONE  09:00 💵 EARN 2h · DataAnnotation → ~$50\n' +
      'ANCHOR    17:30 📺 PBS · VB vs Idaho · shower 16:35\n' +
      'STREAK    —\n'
    );
    expect(renderTodayMd({ day: '2026-10-05', blocks: [], streak: 'EARN 4 days' })).toBe('TODAY Mon Oct 5\nKEYSTONE  —\nANCHOR    —\nSTREAK    EARN 4 days\n');
  });

  it('reads a day back as its anchors only, naming an estimate', () => {
    const blocks = [
      ...expandShift({ date: '2026-10-03', call: '13:00', sport: 'FB' }),
      blockFromEvent({ title: '📖 READ 30', start: '2026-10-03T07:30:00-06:00', end: '2026-10-03T08:00:00-06:00' })!
    ];
    expect(readbackLine('2026-10-03', blocks)).toBe('Sat Oct 3   1 📺 PBS 1–6 · FB (estimated)');
    expect(readbackLine('2026-10-04', [])).toBe('Sun Oct 4   —');
  });
});
