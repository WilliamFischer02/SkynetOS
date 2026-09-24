/**
 * Five-field cron, in local time. Pure: no timers, no Electron. test/cron.test.ts holds it.
 *
 *   minute  hour  day-of-month  month  day-of-week
 *   0-59    0-23  1-31          1-12   0-7 (0 and 7 are both Sunday)
 *
 * Each field takes `*`, a number, a list (`1,15`), a range (`1-5`) and a step (`*\/15`, `8-18/2`,
 * `5/10`, meaning from 5 to the field's end in steps of 10). `@hourly`, `@daily`/`@midnight`,
 * `@weekly`, `@monthly` and `@yearly`/`@annually` are accepted as shorthands. Names (`MON`, `JAN`)
 * are not: every board file so far uses numbers, and one spelling is easier to validate than two.
 *
 * Day-of-month and day-of-week follow classic Vixie cron: when BOTH are restricted, a day matches
 * if EITHER does. `0 8 1 * 1` is "8 am on the 1st, and on every Monday", not "on Mondays that are
 * the 1st".
 */

export interface CronSpec {
  source: string;
  minutes: ReadonlySet<number>;
  hours: ReadonlySet<number>;
  days: ReadonlySet<number>;
  months: ReadonlySet<number>;
  /** 0-6, Sunday = 0. A 7 in the source is folded onto 0. */
  weekdays: ReadonlySet<number>;
  /** The day-of-month field was `*`-based, so it does not restrict on its own. */
  anyDay: boolean;
  /** The day-of-week field was `*`-based. */
  anyWeekday: boolean;
}

export type CronParse = { ok: true; spec: CronSpec } | { ok: false; error: string };

const SHORTHANDS: Record<string, string> = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *'
};

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 7 }
] as const;

function toInt(text: string): number | null {
  return /^\d+$/.test(text) ? Number.parseInt(text, 10) : null;
}

function parseField(text: string, min: number, max: number, name: string): Set<number> | string {
  const out = new Set<number>();
  for (const part of text.split(',')) {
    if (!part) return `EMPTY ITEM IN THE ${name.toUpperCase()} FIELD`;
    const [range = '', stepText, extra] = part.split('/');
    if (extra !== undefined) return `"${part}" HAS TWO STEPS`;
    let step = 1;
    if (stepText !== undefined) {
      const s = toInt(stepText);
      if (s === null || s < 1) return `"${part}": THE STEP MUST BE A WHOLE NUMBER OF AT LEAST 1`;
      step = s;
    }
    let lo: number;
    let hi: number;
    if (range === '*') {
      lo = min;
      hi = max;
    } else if (range.includes('-')) {
      const [a = '', b = ''] = range.split('-');
      const la = toInt(a);
      const lb = toInt(b);
      if (la === null || lb === null) return `"${part}" IS NOT A RANGE`;
      lo = la;
      hi = lb;
    } else {
      const v = toInt(range);
      if (v === null) return `"${part}" IS NOT A NUMBER`;
      lo = v;
      // `5/10` is "from 5, every 10", to the end of the field.
      hi = stepText !== undefined ? max : v;
    }
    if (lo < min || hi > max) return `"${part}" IS OUTSIDE ${min}-${max} FOR THE ${name.toUpperCase()}`;
    if (lo > hi) return `"${part}" RUNS BACKWARDS`;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): CronParse {
  const raw = String(expr ?? '').trim();
  const text = SHORTHANDS[raw.toLowerCase()] ?? raw;
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length !== 5) {
    return { ok: false, error: `A SCHEDULE NEEDS FIVE FIELDS (minute hour day month weekday), NOT ${parts.length}` };
  }
  const sets: Set<number>[] = [];
  for (let i = 0; i < 5; i++) {
    const field = FIELDS[i]!;
    const parsed = parseField(parts[i]!, field.min, field.max, field.name);
    if (typeof parsed === 'string') return { ok: false, error: parsed };
    sets.push(parsed);
  }
  const weekdays = new Set([...sets[4]!].map((d) => (d === 7 ? 0 : d)));
  return {
    ok: true,
    spec: {
      source: raw,
      minutes: sets[0]!,
      hours: sets[1]!,
      days: sets[2]!,
      months: sets[3]!,
      weekdays,
      anyDay: parts[2]!.startsWith('*'),
      anyWeekday: parts[4]!.startsWith('*')
    }
  };
}

function dayMatches(spec: CronSpec, d: Date): boolean {
  const dom = spec.days.has(d.getDate());
  const dow = spec.weekdays.has(d.getDay());
  if (spec.anyDay && spec.anyWeekday) return dom && dow;
  if (spec.anyDay) return dow;
  if (spec.anyWeekday) return dom;
  return dom || dow;
}

/** Does this minute (local time, seconds ignored) match the schedule? */
export function cronMatches(spec: CronSpec, d: Date): boolean {
  return (
    spec.minutes.has(d.getMinutes()) &&
    spec.hours.has(d.getHours()) &&
    spec.months.has(d.getMonth() + 1) &&
    dayMatches(spec, d)
  );
}

/**
 * The first matching minute strictly after `after`. Skips whole months, days and hours that cannot
 * match, so even a schedule that fires once a year is found in a few hundred steps. Null when
 * nothing matches within `limitYears` (e.g. `0 0 31 2 *`, the 31st of February).
 */
export function nextRun(spec: CronSpec, after: Date, limitYears = 5): Date | null {
  const t = new Date(after.getTime());
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + 1);
  const end = after.getTime() + limitYears * 366 * 86_400_000;
  while (t.getTime() <= end) {
    if (!spec.months.has(t.getMonth() + 1)) {
      t.setMonth(t.getMonth() + 1, 1);
      t.setHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(spec, t)) {
      t.setDate(t.getDate() + 1);
      t.setHours(0, 0, 0, 0);
      continue;
    }
    if (!spec.hours.has(t.getHours())) {
      t.setHours(t.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!spec.minutes.has(t.getMinutes())) {
      t.setMinutes(t.getMinutes() + 1, 0, 0);
      continue;
    }
    return new Date(t.getTime());
  }
  return null;
}

/** Longest look-back the scheduler will ever do, so a bad setting cannot become a long scan. */
export const MAX_LOOKBACK_MS = 48 * 3_600_000;

/**
 * The most recent matching minute at or before `now`, no further back than `windowMs`. Null when
 * the schedule had no slot in that window. Minute by minute, bounded by MAX_LOOKBACK_MS: at most
 * 2,880 checks.
 */
export function latestSlot(spec: CronSpec, now: Date, windowMs: number): Date | null {
  const t = new Date(now.getTime());
  t.setSeconds(0, 0);
  const stop = now.getTime() - Math.min(Math.max(0, windowMs), MAX_LOOKBACK_MS);
  while (t.getTime() >= stop) {
    if (cronMatches(spec, t)) return new Date(t.getTime());
    t.setMinutes(t.getMinutes() - 1);
  }
  return null;
}
