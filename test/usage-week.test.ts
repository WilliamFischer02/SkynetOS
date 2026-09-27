import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEEKLY_ANCHOR,
  MAX_READINGS,
  appendReading,
  formatCountdown,
  isTopTierModel,
  percentNow,
  poolLevel,
  sanitizeAnchor,
  sanitizeWeeklyUsage,
  timeToReset,
  tokensBetweenFrom,
  weekWindow,
  zonedInstant,
  type WeeklyPool
} from '../packages/shared/usage-week.js';

/**
 * The weekly pools: Monday 20:00 America/Denver, William's account.
 *
 * The load-bearing rules: the week is the zone's own (a DST week is 167 or 169 hours, never a
 * fixed offset), a reading belongs to the week it was taken in, and with no reading this week the
 * pool says so instead of guessing.
 */

const H = 3_600_000;
const t = (iso: string): number => Date.parse(iso);

// Sunday 2026-09-27, 14:00 MDT: the day William gave his readings.
const SUNDAY_2PM = t('2026-09-27T20:00:00Z');
// Monday 2026-09-21 20:00 MDT and Monday 2026-09-28 20:00 MDT.
const WEEK_START = t('2026-09-22T02:00:00Z');
const WEEK_END = t('2026-09-29T02:00:00Z');

const pool = (readings: { at: string; percent: number }[], id: 'all' | 'top' = 'all'): WeeklyPool =>
  ({ id, label: id === 'all' ? 'ALL' : 'FABLE', readings });

describe('weekWindow', () => {
  it('is Monday 20:00 Denver to Monday 20:00 Denver', () => {
    expect(weekWindow(SUNDAY_2PM, DEFAULT_WEEKLY_ANCHOR)).toEqual({ start: WEEK_START, end: WEEK_END });
  });

  it('turns over exactly at the anchor, not a minute before', () => {
    expect(weekWindow(WEEK_END - 60_000).start).toBe(WEEK_START);
    expect(weekWindow(WEEK_END).start).toBe(WEEK_END);
    expect(weekWindow(WEEK_END + 60_000).start).toBe(WEEK_END);
  });

  it('on the reset day before 8 pm, the week began the Monday before', () => {
    // Monday 2026-09-28 09:00 MDT.
    expect(weekWindow(t('2026-09-28T15:00:00Z')).start).toBe(WEEK_START);
  });

  it('is 169 hours long across the fall-back change on 2026-11-01', () => {
    const w = weekWindow(t('2026-11-01T19:00:00Z'));
    // Mon 26 Oct 20:00 MDT (UTC-6) to Mon 2 Nov 20:00 MST (UTC-7).
    expect(w.start).toBe(t('2026-10-27T02:00:00Z'));
    expect(w.end).toBe(t('2026-11-03T03:00:00Z'));
    expect((w.end - w.start) / H).toBe(169);
  });

  it('is 167 hours long across the spring-forward change on 2027-03-14', () => {
    const w = weekWindow(t('2027-03-14T18:00:00Z'));
    expect(w.start).toBe(t('2027-03-09T03:00:00Z'));
    expect(w.end).toBe(t('2027-03-16T02:00:00Z'));
    expect((w.end - w.start) / H).toBe(167);
  });

  it('the week after the change is back to 168 hours, anchored at 20:00 MST', () => {
    const w = weekWindow(t('2026-11-05T12:00:00Z'));
    expect(w.start).toBe(t('2026-11-03T03:00:00Z'));
    expect((w.end - w.start) / H).toBe(168);
  });

  it('honours another anchor and zone', () => {
    const w = weekWindow(t('2026-09-27T20:00:00Z'), { weekday: 5, hour: 9, minute: 30, timeZone: 'Europe/London' });
    // Friday 2026-09-25 09:30 BST.
    expect(w.start).toBe(t('2026-09-25T08:30:00Z'));
  });

  it('zonedInstant reads a wall clock in the zone, on either side of DST', () => {
    expect(zonedInstant(2026, 9, 28, 20, 0, 'America/Denver')).toBe(WEEK_END);
    expect(zonedInstant(2026, 11, 2, 20, 0, 'America/Denver')).toBe(t('2026-11-03T03:00:00Z'));
  });
});

describe('timeToReset', () => {
  it('says RESETS MON 8:00 PM and the time left, at several times', () => {
    expect(timeToReset(SUNDAY_2PM).caption).toBe('RESETS MON 8:00 PM · 1d 6h');
    expect(timeToReset(t('2026-09-29T01:30:00Z')).caption).toBe('RESETS MON 8:00 PM · 30m');
    expect(timeToReset(t('2026-09-29T01:59:40Z')).caption).toBe('RESETS MON 8:00 PM · < 1m');
    // At the reset itself the next one is a whole week away.
    expect(timeToReset(WEEK_END).caption).toBe('RESETS MON 8:00 PM · 7d');
    expect(timeToReset(WEEK_END + 30_000).caption).toBe('RESETS MON 8:00 PM · 6d 23h');
    expect(timeToReset(t('2026-09-28T10:15:00Z')).caption).toBe('RESETS MON 8:00 PM · 15h 45m');
  });

  it('counts the real hours in a DST week', () => {
    // Sunday 2026-11-01 12:00 MST, after fall-back: 32 hours to Monday 20:00 MST.
    const r = timeToReset(t('2026-11-01T19:00:00Z'));
    expect(r.resetsAt).toBe(t('2026-11-03T03:00:00Z'));
    expect(r.caption).toBe('RESETS MON 8:00 PM · 1d 8h');
  });

  it('formats countdowns in whole units, rounded down', () => {
    expect(formatCountdown(0)).toBe('< 1m');
    expect(formatCountdown(59_999)).toBe('< 1m');
    expect(formatCountdown(2 * H)).toBe('2h');
    expect(formatCountdown(24 * H + 59 * 60_000)).toBe('1d');
  });
});

describe('percentNow', () => {
  it('says NO READING THIS WEEK with no readings, never a number', () => {
    const r = percentNow(pool([]), SUNDAY_2PM);
    expect(r.state).toBe('none');
    expect(r.percent).toBeNull();
    expect(r.text).toBe('NO READING THIS WEEK');
    expect(r.lastWeek).toBeNull();
  });

  it('puts a reading at 19:59 Monday in the old week and one at 20:00 in the new', () => {
    const now = t('2026-09-29T03:00:00Z'); // Monday 21:00 MDT
    const before = percentNow(pool([{ at: '2026-09-29T01:59:00Z', percent: 97 }]), now);
    expect(before.state).toBe('none');
    expect(before.text).toBe('NO READING THIS WEEK');
    expect(before.lastWeek).toMatchObject({ percent: 97, label: 'LAST WEEK' });

    const after = percentNow(pool([{ at: '2026-09-29T02:00:00Z', percent: 1 }]), now);
    expect(after.state).toBe('current');
    expect(after.percent).toBe(1);
    expect(after.lastWeek).toBeNull();
  });

  it('greys an older week by the week it was in', () => {
    // Wednesday 2026-09-09: the week that began Monday 7 September, two weeks back.
    const r = percentNow(pool([{ at: '2026-09-09T18:00:00Z', percent: 55 }]), SUNDAY_2PM);
    expect(r.percent).toBeNull();
    expect(r.lastWeek).toMatchObject({ percent: 55, label: 'WEEK OF 7 SEP' });
    expect(r.note).toBe('WEEK OF 7 SEP 55%');
    // Wednesday 2026-09-16 is the week just gone.
    expect(percentNow(pool([{ at: '2026-09-16T18:00:00Z', percent: 55 }]), SUNDAY_2PM).lastWeek?.label).toBe('LAST WEEK');
  });

  it('extrapolates by the ratio the reading implied: reading% ÷ tokens before it, times tokens since', () => {
    const readAt = SUNDAY_2PM - 5 * H;
    const events: [number, number][] = [
      [WEEK_START - H, 99_000_000], // last week: must not count
      [WEEK_START + H, 6_000_000],
      [readAt - H, 4_000_000], // 10M before the reading
      [readAt + H, 1_500_000],
      [SUNDAY_2PM - H, 1_000_000] // 2.5M since
    ];
    const r = percentNow(pool([{ at: new Date(readAt).toISOString(), percent: 48 }]), SUNDAY_2PM, DEFAULT_WEEKLY_ANCHOR, tokensBetweenFrom(events));
    expect(r.percentPerToken).toBeCloseTo(48 / 10_000_000, 15);
    expect(r.percent).toBeCloseTo(48 + (48 / 10_000_000) * 2_500_000, 9); // 60
    expect(r.text).toBe('60%');
    expect(r.extrapolated).toBe(true);
    expect(r.note).toBe('extrapolated from a reading 5 h ago');
    expect(r.stale).toBe(false);
  });

  it('uses the latest reading of the week, not the first', () => {
    const r = percentNow(pool([
      { at: '2026-09-23T12:00:00Z', percent: 10 },
      { at: '2026-09-27T19:00:00Z', percent: 48 },
      { at: '2026-09-25T12:00:00Z', percent: 30 }
    ]), SUNDAY_2PM);
    expect(r.reading?.percent).toBe(48);
    expect(r.note).toBe('as read 1 h ago');
  });

  it('shows the reading as read when there was no local usage before it to scale by', () => {
    const readAt = SUNDAY_2PM - 2 * H;
    const r = percentNow(pool([{ at: new Date(readAt).toISOString(), percent: 78 }], 'top'), SUNDAY_2PM,
      DEFAULT_WEEKLY_ANCHOR, tokensBetweenFrom([[readAt + H, 5_000_000]]));
    expect(r.percent).toBe(78);
    expect(r.extrapolated).toBe(false);
    expect(r.note).toBe('as read 2 h ago — no local usage before it to scale by');
  });

  it('is dotted once extrapolated more than 12 h from its reading', () => {
    const events: [number, number][] = [[WEEK_START + H, 1_000_000]];
    const at = (h: number) => percentNow(pool([{ at: new Date(SUNDAY_2PM - h * H).toISOString(), percent: 20 }]), SUNDAY_2PM,
      DEFAULT_WEEKLY_ANCHOR, tokensBetweenFrom(events));
    expect(at(11).stale).toBe(false);
    expect(at(13).stale).toBe(true);
    expect(at(13).note).toBe('extrapolated from a reading 13 h ago');
  });

  it('never extrapolates past 100%, and grades 90 warn, 100 fault', () => {
    const readAt = SUNDAY_2PM - 3 * H;
    const events: [number, number][] = [[readAt - H, 1_000_000], [readAt + H, 1_000_000]];
    const r = percentNow(pool([{ at: new Date(readAt).toISOString(), percent: 80 }]), SUNDAY_2PM, DEFAULT_WEEKLY_ANCHOR, tokensBetweenFrom(events));
    expect(r.percent).toBe(100);
    expect(r.level).toBe('fault');
    expect(poolLevel(89.9)).toBe('ok');
    expect(poolLevel(90)).toBe('warn');
    expect(poolLevel(99.9)).toBe('warn');
    expect(poolLevel(100)).toBe('fault');
  });

  it('ignores a reading stamped in the future', () => {
    const r = percentNow(pool([{ at: '2026-09-28T00:00:00Z', percent: 50 }]), SUNDAY_2PM);
    expect(r.percent).toBeNull();
  });
});

describe('telemetry and settings', () => {
  it('sums tokens in [from, to)', () => {
    const between = tokensBetweenFrom([[30, 3], [10, 1], [20, 2]]);
    expect(between(10, 30)).toBe(3);
    expect(between(0, 100)).toBe(6);
    expect(between(30, 30)).toBe(0);
    expect(between(31, 10)).toBe(0);
  });

  it('counts Fable, and only Fable, toward the top pool', () => {
    expect(isTopTierModel('claude-fable-5-1')).toBe(true);
    expect(isTopTierModel('claude-opus-5')).toBe(false);
    expect(isTopTierModel(undefined)).toBe(false);
  });

  it('keeps the last 20 readings per pool, oldest first', () => {
    let readings: { at: string; percent: number }[] = [];
    for (let i = 0; i < 25; i++) readings = appendReading(readings, { at: new Date(WEEK_START + i * H).toISOString(), percent: i });
    expect(readings).toHaveLength(MAX_READINGS);
    expect(readings[0]?.percent).toBe(5);
    expect(readings.at(-1)?.percent).toBe(24);
  });

  it('drops hand-edited nonsense and falls back to Monday 20:00 Denver', () => {
    const s = sanitizeWeeklyUsage({
      weeklyAnchor: { weekday: 9, hour: 20, minute: 0, timeZone: 'Mars/Olympus' },
      pools: { all: [{ at: 'yesterday', percent: 5 }, { at: '2026-09-27T20:00:00Z', percent: 48 }, { at: '2026-09-27T20:00:00Z', percent: 140 }] }
    });
    expect(s.weeklyAnchor).toEqual(DEFAULT_WEEKLY_ANCHOR);
    expect(s.pools.all).toEqual([{ at: '2026-09-27T20:00:00.000Z', percent: 48 }]);
    expect(s.pools.top).toEqual([]);
    expect(sanitizeAnchor(undefined)).toEqual(DEFAULT_WEEKLY_ANCHOR);
  });
});
