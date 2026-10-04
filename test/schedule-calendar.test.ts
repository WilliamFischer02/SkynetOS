import { describe, expect, it } from 'vitest';
import {
  CALENDAR_DAYS,
  blocksByDay,
  calendarWindow,
  eventsOfSource,
  isoLocal,
  mergeCalendar,
  parseCalendarFile,
  upcomingBlocks
} from '../packages/shared/schedule-calendar.js';
import { parseIcs } from '../packages/shared/ics.js';
import type { CalendarEvent, PbsShift } from '../packages/shared/schedule-week.js';

/**
 * The merged calendar (schedule/calendar.json): three sources in, one sorted, de-duplicated list per
 * day out, over this week's Monday to thirteen days after today, in America/Denver.
 */

// Wednesday 30 September 2026, 12:00 in Denver (UTC-6).
const NOW = Date.parse('2026-09-30T18:00:00Z');

const shift: PbsShift = { date: '2026-10-01', call: '17:30', end: '22:30', sport: 'VB', opponent: 'Idaho', role: 'GFX' };

describe('the window', () => {
  it('runs from this week\'s Monday to today + 13, one entry per day', () => {
    const days = calendarWindow(NOW);
    expect(days[0]).toBe('2026-09-28');
    expect(days[days.length - 1]).toBe('2026-10-13');
    expect(days).toHaveLength(16);
    expect(days).toContain('2026-09-30');
    expect(CALENDAR_DAYS).toBe(14);
  });

  it('crosses the DST change without losing or doubling a day', () => {
    const days = calendarWindow(Date.parse('2026-10-28T18:00:00Z'));
    expect(days.filter((d) => d === '2026-11-01')).toHaveLength(1);
    expect(days).toContain('2026-11-02');
  });

  it('leaves out what is outside it', () => {
    const cal = mergeCalendar({
      events: [
        { title: 'too early', start: '2026-09-20T10:00:00-06:00', end: '2026-09-20T11:00:00-06:00' },
        { title: 'too late', start: '2026-10-20T10:00:00-06:00', end: '2026-10-20T11:00:00-06:00' },
        { title: 'inside', start: '2026-10-13T10:00:00-06:00', end: '2026-10-13T11:00:00-06:00' }
      ]
    }, NOW);
    const titles = cal.days.flatMap((d) => d.blocks.map((b) => b.title));
    expect(titles).toEqual(['inside']);
    expect(cal.counts).toEqual({ pbs: 0, events: 1, ics: 0 });
  });
});

describe('mergeCalendar', () => {
  it('expands a PBS shift into its prep chain, the shift, and the way home', () => {
    const cal = mergeCalendar({ shifts: [shift] }, NOW);
    const day = cal.days.find((d) => d.date === '2026-10-01')!;
    expect(day.blocks.map((b) => b.kind)).toEqual(['chain', 'chain', 'chain', 'chain', 'shift', 'chain', 'chain']);
    expect(day.blocks.every((b) => b.source === 'pbs' && b.category === 'pbs')).toBe(true);
    const pbs = day.blocks.find((b) => b.kind === 'shift')!;
    expect(pbs).toMatchObject({ start: '2026-10-01T17:30:00-06:00', end: '2026-10-01T22:30:00-06:00', calendar: 'Work – Shifts' });
    expect(pbs.title).toMatch(/^📺 PBS 5:30–10:30 · VB vs Idaho/);
    expect(day.blocks[0]!.title).toMatch(/^🚿 T-55 SHOWER/);
    expect(day.blocks[0]!.start).toBe('2026-10-01T16:35:00-06:00');
    expect(cal.counts.pbs).toBe(7);
  });

  it('drops a duplicate (same start, same title) and keeps the first source: pbs, then events, then ics', () => {
    const pbsTitle = mergeCalendar({ shifts: [shift] }, NOW).days.find((d) => d.date === '2026-10-01')!.blocks.find((b) => b.kind === 'shift')!.title;
    const exported: CalendarEvent = { title: `  ${pbsTitle.toUpperCase()} `, start: '2026-10-01T17:30:00-06:00', end: '2026-10-01T22:30:00-06:00', calendar: 'Work – Shifts' };
    const ics: CalendarEvent = { title: '💵 EARN', start: '2026-10-02T15:00:00.000Z', end: '2026-10-02T16:30:00.000Z', calendar: 'Feed' };
    const exportedEarn: CalendarEvent = { title: '💵 earn', start: '2026-10-02T09:00:00-06:00', end: '2026-10-02T10:30:00-06:00', calendar: 'MAIN' };
    const cal = mergeCalendar({ shifts: [shift], events: [exported, exportedEarn], ics: [ics] }, NOW);
    const oct1 = cal.days.find((d) => d.date === '2026-10-01')!.blocks;
    expect(oct1.filter((b) => b.kind === 'shift' || b.title.toUpperCase().includes('VB VS IDAHO'))).toHaveLength(1);
    expect(oct1.find((b) => b.title.includes('Idaho'))!.source).toBe('pbs');
    const oct2 = cal.days.find((d) => d.date === '2026-10-02')!.blocks;
    expect(oct2).toHaveLength(1);
    expect(oct2[0]).toMatchObject({ source: 'events', calendar: 'MAIN', category: 'income' });
    expect(cal.counts).toEqual({ pbs: 7, events: 1, ics: 0 });
  });

  it('sorts each day: all-day first, then by start, then by end', () => {
    const cal = mergeCalendar({
      events: [
        { title: 'b late', start: '2026-10-05T15:00:00-06:00', end: '2026-10-05T16:00:00-06:00' },
        { title: 'a early long', start: '2026-10-05T09:00:00-06:00', end: '2026-10-05T12:00:00-06:00' },
        { title: 'a early short', start: '2026-10-05T09:00:00-06:00', end: '2026-10-05T09:30:00-06:00' },
        { title: '⛔ OFF DAY', start: '2026-10-05', allDay: true }
      ]
    }, NOW);
    expect(cal.days.find((d) => d.date === '2026-10-05')!.blocks.map((b) => b.title))
      .toEqual(['⛔ OFF DAY', 'a early short', 'a early long', 'b late']);
  });

  it('spreads a multi-day all-day event over each of its days, end exclusive', () => {
    const cal = mergeCalendar({ ics: [{ title: '⛔ OFF DAY', start: '2026-10-03', end: '2026-10-05', allDay: true, calendar: 'Feed' }] }, NOW);
    const off = cal.days.filter((d) => d.blocks.some((b) => b.category === 'off')).map((d) => d.date);
    expect(off).toEqual(['2026-10-03', '2026-10-04']);
    expect(cal.days.find((d) => d.date === '2026-10-03')!.blocks[0]).toMatchObject({ start: '2026-10-03', end: '2026-10-04', allDay: true, source: 'ics' });
  });

  it('reads a parsed iCal feed like any other source', () => {
    const text = 'BEGIN:VCALENDAR\r\nX-WR-CALNAME:Main\r\nBEGIN:VEVENT\r\nDTSTART;TZID=America/Denver:20261006T080000\r\nDTEND;TZID=America/Denver:20261006T090000\r\nSUMMARY:🏃 RUN\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const cal = mergeCalendar({ ics: parseIcs(text, 'ICS 1') }, NOW);
    expect(cal.days.find((d) => d.date === '2026-10-06')!.blocks[0]).toMatchObject({
      title: '🏃 RUN', start: '2026-10-06T08:00:00-06:00', category: 'upkeep', calendar: 'Main', source: 'ics', kind: 'event'
    });
  });

  it('stamps the time zone and the merge time, and keeps notes', () => {
    const cal = mergeCalendar({ notes: ['ICS FEED 1: HTTP 404'] }, NOW);
    expect(cal.timeZone).toBe('America/Denver');
    expect(cal.generatedAt).toBe('2026-09-30T12:00:00-06:00');
    expect(cal.notes).toEqual(['ICS FEED 1: HTTP 404']);
    expect(cal.days.every((d) => d.blocks.length === 0)).toBe(true);
  });

  it('skips a shift it cannot read rather than failing the merge', () => {
    const cal = mergeCalendar({ shifts: [{ date: '2026-10-01', call: 'soon', sport: 'VB' }, shift] }, NOW);
    expect(cal.counts.pbs).toBe(7);
  });
});

describe('the file round trip', () => {
  it('parses what it wrote, and carries the ics blocks into the next merge', () => {
    const ics: CalendarEvent[] = [{ title: '🎧 LISTEN', start: '2026-10-07T19:00:00.000Z', end: '2026-10-07T20:00:00.000Z', calendar: 'Feed' }];
    const first = mergeCalendar({ shifts: [shift], ics }, NOW);
    const read = parseCalendarFile(JSON.parse(JSON.stringify(first)));
    expect(read).toEqual(first);
    const carried = eventsOfSource(read!, 'ics');
    expect(carried).toHaveLength(1);
    const second = mergeCalendar({ shifts: [shift], ics: carried }, NOW);
    expect(second.days).toEqual(first.days);
  });

  it('refuses what is not a calendar, and drops a bad row without dropping the file', () => {
    expect(parseCalendarFile(null)).toBeNull();
    expect(parseCalendarFile({ days: 'no' })).toBeNull();
    const read = parseCalendarFile({ days: [{ date: '2026-10-01', blocks: [{ title: 'x' }, { title: 'ok', start: '2026-10-01T09:00:00-06:00', end: '2026-10-01T10:00:00-06:00' }] }] });
    expect(read!.days[0]!.blocks).toHaveLength(1);
    expect(read!.days[0]!.blocks[0]).toMatchObject({ title: 'ok', source: 'events', kind: 'event', category: 'other' });
  });

  it('gives the week view the same blocks, on the same days, at the same minutes', () => {
    const byDay = blocksByDay(mergeCalendar({ shifts: [shift] }, NOW));
    const pbs = byDay.get('2026-10-01')!.find((b) => b.kind === 'shift')!;
    expect(pbs.startMin).toBe(17 * 60 + 30);
    expect(pbs.endMin).toBe(22 * 60 + 30);
  });

  it('lists the next three timed blocks that have not ended, soonest first', () => {
    const cal = mergeCalendar({
      shifts: [shift],
      events: [
        { title: 'already over', start: '2026-09-30T08:00:00-06:00', end: '2026-09-30T09:00:00-06:00' },
        { title: 'running now', start: '2026-09-30T11:30:00-06:00', end: '2026-09-30T12:30:00-06:00' },
        { title: '⛔ OFF DAY', start: '2026-10-02', allDay: true }
      ]
    }, NOW);
    expect(upcomingBlocks(cal, NOW).map((b) => b.title.slice(0, 12))).toEqual(['running now', '🚿 T-55 SHOW', '🎒 T-30 GEAR']);
  });

  it('writes local times with their offset, both sides of DST', () => {
    expect(isoLocal(Date.parse('2026-10-01T23:30:00Z'))).toBe('2026-10-01T17:30:00-06:00');
    expect(isoLocal(Date.parse('2026-11-02T16:00:00Z'))).toBe('2026-11-02T09:00:00-07:00');
  });
});
