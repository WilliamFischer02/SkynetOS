import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  icsFetchUrl,
  normaliseScheduleSettings,
  parseIcs,
  parseIcsDuration,
  parseIcsTime,
  unescapeIcsText,
  unfoldIcs
} from '../packages/shared/ics.js';

/**
 * The iCal reader (packages/shared/ics.ts) against a fixture shaped like Google's export: a zoned
 * event with an alarm inside it, a UTC event with a folded title and an RRULE, a two-day all-day
 * event, a cancelled event and a floating one with a DURATION.
 */

const fixture = readFileSync(join(process.cwd(), 'test', 'fixtures', 'schedule-sample.ics'), 'utf8');

describe('parseIcs on the fixture', () => {
  const events = parseIcs(fixture, 'ICS 1');

  it('reads every VEVENT but the cancelled one, in file order, named by the feed', () => {
    expect(events.map((e) => e.title)).toEqual([
      '📺 PBS 5:30–10:30 , VB vs Idaho',
      '💵 EARN block with a folded title',
      '⛔ OFF DAY',
      'Floating time with a duration'
    ]);
    for (const e of events) expect(e.calendar).toBe('Fixture Calendar');
  });

  it('reads a TZID time on that zone\'s wall clock (Denver is UTC-6 on 1 October)', () => {
    expect(events[0]!.start).toBe('2026-10-01T23:30:00.000Z');
    expect(events[0]!.end).toBe('2026-10-02T04:30:00.000Z');
    expect(events[0]!.allDay).toBeUndefined();
  });

  it('reads a UTC time as UTC, and takes a recurring event as its own first instance only', () => {
    expect(events[1]!.start).toBe('2026-10-02T15:00:00.000Z');
    expect(events[1]!.end).toBe('2026-10-02T16:30:00.000Z');
    expect(events.filter((e) => e.title.startsWith('💵'))).toHaveLength(1);
  });

  it('keeps an all-day event as dates, DTEND exclusive', () => {
    expect(events[2]).toMatchObject({ start: '2026-10-03', end: '2026-10-05', allDay: true });
  });

  it('reads a floating time in the fallback zone and ends it after its DURATION', () => {
    expect(events[3]!.start).toBe('2026-10-06T01:00:00.000Z');
    expect(events[3]!.end).toBe('2026-10-06T01:45:00.000Z');
  });

  it('never reads a property from inside a VALARM as the event\'s own', () => {
    expect(events.some((e) => e.title.includes('should not be read'))).toBe(false);
  });
});

describe('the pieces', () => {
  it('unfolds continuation lines and accepts LF or CRLF', () => {
    expect(unfoldIcs('A:1\r\n  2\r\nB:3\n\tx\n')).toEqual(['A:1 2', 'B:3x']);
  });

  it('unescapes SUMMARY text to one line', () => {
    expect(unescapeIcsText('a\\, b\\; c\\nd \\\\ e')).toBe('a, b; c d \\ e');
  });

  it('falls back to the default zone for a TZID Intl does not know (a Windows name)', () => {
    const t = parseIcsTime({ params: { TZID: 'Mountain Standard Time' }, value: '20261001T120000' });
    expect(new Date(t!.ms).toISOString()).toBe('2026-10-01T18:00:00.000Z');
  });

  it('moves with DST: the same wall time is an hour later in UTC after 1 November', () => {
    const before = parseIcsTime({ params: { TZID: 'America/Denver' }, value: '20261031T090000' });
    const after = parseIcsTime({ params: { TZID: 'America/Denver' }, value: '20261102T090000' });
    expect(new Date(before!.ms).toISOString()).toBe('2026-10-31T15:00:00.000Z');
    expect(new Date(after!.ms).toISOString()).toBe('2026-11-02T16:00:00.000Z');
  });

  it('refuses what is not a time', () => {
    expect(parseIcsTime({ params: {}, value: 'tomorrow' })).toBeNull();
  });

  it('reads durations', () => {
    expect(parseIcsDuration('PT1H30M')).toBe(90 * 60_000);
    expect(parseIcsDuration('P1D')).toBe(86_400_000);
    expect(parseIcsDuration('P1W')).toBe(7 * 86_400_000);
    expect(parseIcsDuration('PT')).toBeNull();
    expect(parseIcsDuration('soon')).toBeNull();
  });

  it('drops an event with no start, and names an unnamed feed by the name given', () => {
    const text = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:no start\nEND:VEVENT\nBEGIN:VEVENT\nDTSTART:20261001T000000Z\nEND:VEVENT\nEND:VCALENDAR\n';
    const events = parseIcs(text, 'ICS 2');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ title: '(no title)', calendar: 'ICS 2' });
  });
});

describe('the feed setting (settings.json schedule.icsUrls)', () => {
  it('fetches https, reads webcal as https, and refuses anything else', () => {
    expect(icsFetchUrl('https://calendar.google.com/calendar/ical/x/private-y/basic.ics')).toMatch(/^https:\/\//);
    expect(icsFetchUrl('webcal://example.com/feed.ics')).toBe('https://example.com/feed.ics');
    expect(icsFetchUrl('http://example.com/feed.ics')).toBeNull();
    expect(icsFetchUrl('file:///C:/cal.ics')).toBeNull();
    expect(icsFetchUrl(42)).toBeNull();
  });

  it('defaults to none and drops every entry it would refuse', () => {
    expect(normaliseScheduleSettings(undefined)).toEqual({ icsUrls: [] });
    expect(normaliseScheduleSettings({ icsUrls: 'https://a.example/x.ics' })).toEqual({ icsUrls: [] });
    expect(normaliseScheduleSettings({ icsUrls: ['https://a.example/x.ics', 'ftp://b', 7] })).toEqual({ icsUrls: ['https://a.example/x.ics'] });
  });
});
