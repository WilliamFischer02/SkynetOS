import { describe, expect, it } from 'vitest';
import { cronMatches, latestSlot, nextRun, parseCron, type CronSpec } from '../packages/shared/cron.js';

/** All dates are LOCAL, built with the Date(y, m, d, h, min) constructor, so the tests hold in any timezone. */
const at = (y: number, m: number, d: number, h = 0, min = 0): Date => new Date(y, m - 1, d, h, min);

function spec(expr: string): CronSpec {
  const parsed = parseCron(expr);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.spec;
}

describe('parseCron', () => {
  it('reads the five fields', () => {
    const s = spec('0 8 * * *');
    expect([...s.minutes]).toEqual([0]);
    expect([...s.hours]).toEqual([8]);
    expect(s.days.size).toBe(31);
  });

  it('refuses the wrong number of fields, out-of-range values, backwards ranges and zero steps', () => {
    expect(parseCron('0 8 * *').ok).toBe(false);
    expect(parseCron('60 * * * *').ok).toBe(false);
    expect(parseCron('0 24 * * *').ok).toBe(false);
    expect(parseCron('0 0 0 * *').ok).toBe(false);
    expect(parseCron('5-1 * * * *').ok).toBe(false);
    expect(parseCron('*/0 * * * *').ok).toBe(false);
    expect(parseCron('a * * * *').ok).toBe(false);
  });

  it('treats 7 and 0 as Sunday', () => {
    expect([...spec('0 0 * * 7').weekdays]).toEqual([0]);
    expect([...spec('0 0 * * 0').weekdays]).toEqual([0]);
  });

  it('expands lists, ranges and steps', () => {
    expect([...spec('*/15 * * * *').minutes]).toEqual([0, 15, 30, 45]);
    expect([...spec('0 8-18/5 * * *').hours]).toEqual([8, 13, 18]);
    expect([...spec('5/20 * * * *').minutes]).toEqual([5, 25, 45]);
    expect([...spec('0 1,13 * * *').hours]).toEqual([1, 13]);
  });

  it('accepts the @ shorthands', () => {
    expect([...spec('@daily').hours]).toEqual([0]);
    expect([...spec('@hourly').minutes]).toEqual([0]);
  });
});

describe('nextRun', () => {
  it('finds this morning at 8, then tomorrow once it has passed', () => {
    expect(nextRun(spec('0 8 * * *'), at(2026, 9, 11, 7, 59))).toEqual(at(2026, 9, 11, 8, 0));
    expect(nextRun(spec('0 8 * * *'), at(2026, 9, 11, 8, 0))).toEqual(at(2026, 9, 12, 8, 0));
  });

  it('crosses month boundaries, including a month too short for the day', () => {
    expect(nextRun(spec('0 0 1 * *'), at(2026, 1, 31, 12))).toEqual(at(2026, 2, 1, 0, 0));
    // April has 30 days: the next 31st is in May.
    expect(nextRun(spec('30 23 31 * *'), at(2026, 4, 1))).toEqual(at(2026, 5, 31, 23, 30));
  });

  it('honours the day of week (2026-09-10 is a Thursday)', () => {
    expect(at(2026, 9, 10).getDay()).toBe(4);
    expect(nextRun(spec('0 9 * * 1'), at(2026, 9, 10, 12))).toEqual(at(2026, 9, 14, 9, 0));
  });

  it('matches EITHER day field when both are restricted, as Vixie cron does', () => {
    // Monday 2026-09-28, then the 1st (a Thursday) comes before the next Monday.
    expect(at(2026, 9, 28).getDay()).toBe(1);
    expect(nextRun(spec('0 8 1 * 1'), at(2026, 9, 28, 9))).toEqual(at(2026, 10, 1, 8, 0));
  });

  it('steps inside an hour', () => {
    expect(nextRun(spec('*/15 * * * *'), at(2026, 9, 11, 10, 7))).toEqual(at(2026, 9, 11, 10, 15));
  });

  it('gives up on a date that never exists', () => {
    expect(nextRun(spec('0 0 31 2 *'), at(2026, 1, 1))).toBeNull();
  });
});

describe('latestSlot and cronMatches', () => {
  it('finds the slot that just passed, within the window', () => {
    expect(latestSlot(spec('0 8 * * *'), at(2026, 9, 11, 9, 30), 4 * 3_600_000)).toEqual(at(2026, 9, 11, 8, 0));
    expect(latestSlot(spec('0 8 * * *'), at(2026, 9, 11, 9, 30), 3_600_000)).toBeNull();
  });

  it('counts the current minute as a slot', () => {
    const now = new Date(2026, 8, 11, 8, 0, 40);
    expect(latestSlot(spec('0 8 * * *'), now, 60_000)).toEqual(at(2026, 9, 11, 8, 0));
    expect(cronMatches(spec('0 8 * * *'), now)).toBe(true);
  });
});
