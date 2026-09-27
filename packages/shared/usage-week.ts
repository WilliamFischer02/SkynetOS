/**
 * The weekly pools: Claude's own percentages, carried between readings by this machine's usage.
 *
 * ── What William asked for ────────────────────────────────────────────────────────────────────
 *
 * "The credit and usage tracking can be tuned to be more finite considering my plan never changes
 * from max 20x and it always resets credits on Mondays at 8pm."
 *
 * Max plans have, besides the rolling five-hour window, two WEEKLY caps: one for every model, and
 * a separate one for the top tier (Fable). claude.ai's /usage page shows both as percentages. Both
 * reset at the same fixed instant each week, Monday 20:00 America/Denver on his account.
 *
 * ── What is known, and what is not ────────────────────────────────────────────────────────────
 *
 * The percentage is the account's word and is not on this disk. So a pool starts from a READING
 * William typed from /usage, and nothing else. Between readings it moves by what this machine
 * actually spent, scaled by the ratio the reading itself implied:
 *
 *     k   = reading% ÷ B      B = weighted tokens this machine spent from the week's start to the reading
 *     now = reading% + k × S  S = weighted tokens this machine spent from the reading to now
 *
 * k absorbs everything this machine cannot see (other machines, claude.ai chats), on the
 * assumption that their share stays about the same between readings. That is an assumption, so
 * the figure says it is extrapolated and how old its reading is, and the meter dots the bar once
 * the reading is more than 12 hours behind.
 *
 * With no reading in the current week the pool says NO READING THIS WEEK. A reset zeroes the real
 * pool, but "0%" would be a guess about everything spent since the reset on other machines. A
 * reading from an earlier week is shown greyed, as that week's, and never carried forward.
 *
 * The week is computed in the anchor's own time zone with Intl, never with a hard-coded offset, so
 * the week that contains a DST change is 167 or 169 hours long, as it really is.
 *
 * Pure: no fs, no Electron. test/usage-week.test.ts holds it.
 */

export type PoolId = 'all' | 'top';
export const POOL_IDS: readonly PoolId[] = ['all', 'top'];

/** One percentage read off claude.ai's /usage page, and when it was read. */
export interface PoolReading {
  /** ISO instant. */
  at: string;
  /** 0..100, as the page shows it. */
  percent: number;
}

export interface WeeklyPool {
  id: PoolId;
  label: string;
  readings: PoolReading[];
}

export const POOL_LABELS: Record<PoolId, string> = { all: 'ALL', top: 'FABLE' };

/** When the weekly pools reset: a weekday and a wall-clock time in a named zone. */
export interface WeeklyAnchor {
  /** 0 = Sunday … 6 = Saturday, as `Date#getDay`. */
  weekday: number;
  hour: number;
  minute: number;
  /** IANA zone, e.g. `America/Denver`. */
  timeZone: string;
}

/** Monday 20:00 in Denver: William's account, as he reported it on 2026-09-27. */
export const DEFAULT_WEEKLY_ANCHOR: WeeklyAnchor = { weekday: 1, hour: 20, minute: 0, timeZone: 'America/Denver' };

/** Readings kept per pool. Enough history to see a trend, small enough to stay readable in the file. */
export const MAX_READINGS = 20;

/** Past this many hours since its reading, an extrapolated figure is drawn dotted. */
export const STALE_AFTER_HOURS = 12;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/* ────────────────────────── time zones, by Intl ────────────────────────── */

interface ZonedParts { year: number; month: number; day: number; hour: number; minute: number; second: number }

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric'
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The wall clock in `timeZone` at instant `ms`. */
function zonedParts(ms: number, timeZone: string): ZonedParts {
  const out: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(ms))) {
    if (part.type !== 'literal') out[part.type] = Number.parseInt(part.value, 10);
  }
  return {
    year: out['year'] ?? 1970,
    month: out['month'] ?? 1,
    day: out['day'] ?? 1,
    // Some engines still say 24 for midnight even with h23.
    hour: (out['hour'] ?? 0) % 24,
    minute: out['minute'] ?? 0,
    second: out['second'] ?? 0
  };
}

/** How far `timeZone` is ahead of UTC at instant `ms`, in ms. */
function zoneOffset(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `timeZone` reads the given date and time.
 *
 * Two passes, because the offset at the guess can differ from the offset at the answer across a
 * DST change. A wall time that does not exist (inside a spring-forward gap) lands just after it.
 */
export function zonedInstant(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let ms = wall - zoneOffset(wall, timeZone);
  ms = wall - zoneOffset(ms, timeZone);
  return ms;
}

/** Whether Intl knows this zone. */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/* ────────────────────────── the week ────────────────────────── */

export interface WeekWindow {
  /** The most recent reset at or before `now`, epoch ms. Inclusive. */
  start: number;
  /** The next reset, epoch ms. Exclusive. */
  end: number;
}

/**
 * The week `now` falls in: from the last reset to the next.
 *
 * Found by walking back to the anchor's weekday on the zone's own calendar, then asking Intl what
 * instant that wall-clock time is. The next reset is the same wall-clock time seven calendar days
 * on, so a week that spans a DST change is an hour longer or shorter, as the real one is.
 */
export function weekWindow(now: number, anchor: WeeklyAnchor = DEFAULT_WEEKLY_ANCHOR): WeekWindow {
  const p = zonedParts(now, anchor.timeZone);
  // The zone's calendar date, as a UTC midnight, so day arithmetic is plain and DST-free.
  const today = Date.UTC(p.year, p.month - 1, p.day);
  const weekday = new Date(today).getUTCDay();
  let back = (weekday - anchor.weekday + 7) % 7;

  const at = (dayMs: number): number => {
    const d = new Date(dayMs);
    return zonedInstant(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), anchor.hour, anchor.minute, anchor.timeZone);
  };

  let start = at(today - back * DAY_MS);
  // Today is the reset day but the reset has not happened yet: the week began a week ago.
  if (start > now) { back += 7; start = at(today - back * DAY_MS); }
  const end = at(today - back * DAY_MS + 7 * DAY_MS);
  return { start, end };
}

/* ────────────────────────── the reset caption ────────────────────────── */

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** `8:00 PM`, from the anchor itself, so it never depends on the machine's locale. */
function clockLabel(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** `1d 6h`, `6h 12m`, `12m`, `< 1m`. Whole units, rounded down: a countdown should not arrive early. */
export function formatCountdown(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return '< 1m';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

export interface ResetCountdown {
  /** The next reset, epoch ms. */
  resetsAt: number;
  /** Until then, ms. */
  ms: number;
  /** `RESETS MON 8:00 PM · 1d 6h`. The weekday and time are the anchor's, in the anchor's zone. */
  caption: string;
}

export function timeToReset(now: number, anchor: WeeklyAnchor = DEFAULT_WEEKLY_ANCHOR): ResetCountdown {
  const { end } = weekWindow(now, anchor);
  const ms = end - now;
  return {
    resetsAt: end,
    ms,
    caption: `RESETS ${WEEKDAYS[anchor.weekday] ?? '?'} ${clockLabel(anchor.hour, anchor.minute)} · ${formatCountdown(ms)}`
  };
}

/* ────────────────────────── a pool, now ────────────────────────── */

/** Weighted tokens this machine spent in [from, to), for the pool in question. */
export type TokensBetween = (from: number, to: number) => number;

export type PoolLevel = 'ok' | 'warn' | 'fault';

export interface PoolReadout {
  id: PoolId;
  label: string;
  /** `current`: a reading this week. `none`: no reading this week (there may be an older one). */
  state: 'current' | 'none';
  /** This week's figure, 0..100. Null when there is no reading this week — never a guess. */
  percent: number | null;
  /** The reading it rests on. */
  reading: PoolReading | null;
  /** Hours from that reading to now. */
  hoursSinceReading: number | null;
  /** True when the figure has been moved past the reading by local usage. */
  extrapolated: boolean;
  /** Extrapolated from a reading more than STALE_AFTER_HOURS old: drawn dotted. */
  stale: boolean;
  /** The ratio the reading implied, percent per weighted token. Null when it could not be formed. */
  percentPerToken: number | null;
  /** <90 ok, 90–99 warn, 100 fault. The same thresholds for both pools. */
  level: PoolLevel;
  /** The value text, e.g. `63%`, or `NO READING THIS WEEK`. */
  text: string;
  /** How it was arrived at, e.g. `extrapolated from a reading 5 h ago`. */
  note: string;
  /** The latest reading from an earlier week, shown greyed as that week's. */
  lastWeek: { percent: number; at: string; label: string } | null;
}

export function poolLevel(percent: number): PoolLevel {
  return percent >= 100 ? 'fault' : percent >= 90 ? 'warn' : 'ok';
}

/** `5 h`, `40 min`: how long ago a reading was, in the unit that reads naturally. */
export function formatAgo(hours: number): string {
  if (hours < 1 / 60) return '< 1 min';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${Math.round(hours)} h`;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * Where a pool stands now.
 *
 * `tokensBetween` is this machine's measured usage for the pool (every model for `all`, Fable only
 * for `top`). Without it, or with no local usage before the reading to scale by, the reading is
 * shown as read, and says so.
 */
export function percentNow(
  pool: WeeklyPool,
  now: number,
  anchor: WeeklyAnchor = DEFAULT_WEEKLY_ANCHOR,
  tokensBetween?: TokensBetween
): PoolReadout {
  const week = weekWindow(now, anchor);
  const valid = pool.readings
    .map((r) => ({ r, at: Date.parse(r.at) }))
    .filter((x) => Number.isFinite(x.at) && Number.isFinite(x.r.percent))
    .sort((a, b) => a.at - b.at);

  // Only readings up to now: a reading "from the future" is a clock error, not evidence.
  const current = valid.filter((x) => x.at >= week.start && x.at <= now).at(-1) ?? null;
  const past = valid.filter((x) => x.at < week.start).at(-1) ?? null;

  let lastWeek: PoolReadout['lastWeek'] = null;
  if (past) {
    const previous = weekWindow(week.start - 1, anchor);
    let label = 'LAST WEEK';
    if (past.at < previous.start) {
      const p = zonedParts(weekWindow(past.at, anchor).start, anchor.timeZone);
      label = `WEEK OF ${p.day} ${MONTHS[p.month - 1] ?? ''}`.trim();
    }
    lastWeek = { percent: clampPercent(past.r.percent), at: past.r.at, label };
  }

  const base = { id: pool.id, label: pool.label, lastWeek };

  if (!current) {
    return {
      ...base,
      state: 'none',
      percent: null,
      reading: null,
      hoursSinceReading: null,
      extrapolated: false,
      stale: false,
      percentPerToken: null,
      level: 'ok',
      text: 'NO READING THIS WEEK',
      note: lastWeek ? `${lastWeek.label} ${Math.round(lastWeek.percent)}%` : 'type one from claude.ai/usage in CALIBRATE'
    };
  }

  const read = clampPercent(current.r.percent);
  const hours = Math.max(0, (now - current.at) / HOUR_MS);
  const before = tokensBetween ? tokensBetween(week.start, current.at) : 0;
  const since = tokensBetween ? tokensBetween(current.at, now) : 0;
  const k = read > 0 && before > 0 ? read / before : null;

  const percent = k === null ? read : clampPercent(read + k * Math.max(0, since));
  const extrapolated = k !== null;
  const ago = formatAgo(hours);
  const note = extrapolated
    ? `extrapolated from a reading ${ago} ago`
    : tokensBetween
      ? `as read ${ago} ago — no local usage before it to scale by`
      : `as read ${ago} ago`;

  return {
    ...base,
    state: 'current',
    percent,
    reading: current.r,
    hoursSinceReading: hours,
    extrapolated,
    stale: extrapolated && hours > STALE_AFTER_HOURS,
    percentPerToken: k,
    level: poolLevel(percent),
    text: `${Math.round(percent)}%`,
    note
  };
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/* ────────────────────────── local telemetry ────────────────────────── */

/**
 * `tokensBetween` over a list of `[epochMs, weightedTokens]`, by prefix sums and binary search, so
 * the meter can ask it four times a poll without re-walking a week of messages each time.
 */
export function tokensBetweenFrom(events: readonly (readonly [number, number])[]): TokensBetween {
  const sorted = [...events].filter(([at, w]) => Number.isFinite(at) && Number.isFinite(w)).sort((a, b) => a[0] - b[0]);
  const times = sorted.map(([at]) => at);
  const prefix = [0];
  for (const [, w] of sorted) prefix.push(prefix[prefix.length - 1]! + w);
  // First index whose time is >= t.
  const lower = (t: number): number => {
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid]! < t) lo = mid + 1; else hi = mid;
    }
    return lo;
  };
  return (from, to) => (to <= from ? 0 : prefix[lower(to)]! - prefix[lower(from)]!);
}

/** Whether a model's tokens count against the top-tier (Fable) weekly pool. */
export function isTopTierModel(model: unknown): boolean {
  return typeof model === 'string' && /fable/i.test(model);
}

/* ────────────────────────── settings shape ────────────────────────── */

/** `usage` in settings.json. */
export interface WeeklyUsageSettings {
  weeklyAnchor: WeeklyAnchor;
  pools: Record<PoolId, PoolReading[]>;
}

export const DEFAULT_WEEKLY_USAGE: WeeklyUsageSettings = {
  weeklyAnchor: { ...DEFAULT_WEEKLY_ANCHOR },
  pools: { all: [], top: [] }
};

/** A hand-edited anchor, checked field by field. Anything unusable falls back to the default's field. */
export function sanitizeAnchor(value: unknown): WeeklyAnchor {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const int = (x: unknown, lo: number, hi: number, fallback: number): number =>
    typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi ? x : fallback;
  const d = DEFAULT_WEEKLY_ANCHOR;
  return {
    weekday: int(v['weekday'], 0, 6, d.weekday),
    hour: int(v['hour'], 0, 23, d.hour),
    minute: int(v['minute'], 0, 59, d.minute),
    timeZone: isTimeZone(v['timeZone']) ? v['timeZone'] : d.timeZone
  };
}

/** Readings that parse, 0..100, oldest first, the last MAX_READINGS. */
export function sanitizeReadings(value: unknown): PoolReading[] {
  if (!Array.isArray(value)) return [];
  const out: { at: number; percent: number }[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const at = typeof r['at'] === 'string' ? Date.parse(r['at']) : NaN;
    const percent = r['percent'];
    if (!Number.isFinite(at) || typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) continue;
    out.push({ at, percent });
  }
  out.sort((a, b) => a.at - b.at);
  return out.slice(-MAX_READINGS).map(({ at, percent }) => ({ at: new Date(at).toISOString(), percent }));
}

export function sanitizeWeeklyUsage(value: unknown): WeeklyUsageSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const pools = (v['pools'] && typeof v['pools'] === 'object' ? v['pools'] : {}) as Record<string, unknown>;
  return {
    weeklyAnchor: sanitizeAnchor(v['weeklyAnchor']),
    pools: { all: sanitizeReadings(pools['all']), top: sanitizeReadings(pools['top']) }
  };
}

/** Append one reading to a pool's list, keeping the last MAX_READINGS. */
export function appendReading(readings: readonly PoolReading[], reading: PoolReading): PoolReading[] {
  return sanitizeReadings([...readings, reading]);
}

export function poolsFrom(settings: WeeklyUsageSettings): WeeklyPool[] {
  return POOL_IDS.map((id) => ({ id, label: POOL_LABELS[id], readings: settings.pools[id] }));
}

/* ────────────────────────── what crosses IPC ────────────────────────── */

export interface WeeklyReadout {
  anchor: WeeklyAnchor;
  week: WeekWindow;
  reset: ResetCountdown;
  pools: PoolReadout[];
}
