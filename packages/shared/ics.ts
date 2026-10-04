/**
 * A small iCalendar reader: the VEVENTs of one `.ics` feed as calendar events.
 *
 * William's calendars reach the board three ways (packages/shared/schedule-calendar.ts); this is the
 * third, a private iCal URL he pastes into settings.json by hand (`schedule.icsUrls`). Main fetches
 * the text (src/main/services/schedule-feed.ts); this module only reads it. Pure: no clock, no
 * network, no disk.
 *
 * What it understands, and nothing more (RFC 5545, the parts a Google or Outlook export uses):
 *
 *   - line unfolding (a line starting with a space or a tab continues the one before);
 *   - VEVENT blocks, and within them DTSTART, DTEND, DURATION, SUMMARY and STATUS;
 *   - three time forms: UTC (`20261001T230000Z`), zoned (`DTSTART;TZID=America/Denver:20261001T170000`)
 *     and floating (`20261001T170000`, read in the fallback zone), plus all-day dates
 *     (`DTSTART;VALUE=DATE:20261001`, DTEND exclusive);
 *   - text escapes in SUMMARY (`\,` `\;` `\n` `\\`).
 *
 * What it ignores, on purpose: RRULE, RDATE and EXDATE. A recurring event is taken as its own
 * first instance only; Google's feed carries each moved instance as its own VEVENT (RECURRENCE-ID),
 * which is read like any other. Expanding recurrence would be a second calendar engine inside the
 * board; the secretary's export (`private/schedule/events.json`) is where the expanded week comes
 * from. VTIMEZONE blocks are skipped: a TZID is resolved by `Intl`, and one `Intl` does not know (a
 * Windows zone name such as `Mountain Standard Time`) falls back to the fallback zone, William's own.
 *
 * A cancelled event (STATUS:CANCELLED) is dropped. An event with no parsable start is dropped.
 */
import { SCHEDULE_TZ, zonedToMs, type CalendarEvent } from './schedule-week.js';

/** One property line: `NAME;PARAM=V;PARAM2=V:value`, name and parameter names upper-cased. */
interface IcsProp {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** RFC 5545 §3.1: a line break followed by one space or tab is a fold, and both are removed. */
export function unfoldIcs(text: string): string[] {
  return text.replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n').filter((l) => l.length > 0);
}

function parseProp(line: string): IcsProp | null {
  // The first colon outside a quoted parameter value ends the name and parameters.
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) { colon = i; break; }
  }
  if (colon < 1) return null;
  const head = line.slice(0, colon).split(';');
  const name = (head[0] ?? '').trim().toUpperCase();
  if (!name) return null;
  const params: Record<string, string> = {};
  for (const part of head.slice(1)) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    params[part.slice(0, eq).trim().toUpperCase()] = part.slice(eq + 1).trim().replace(/^"|"$/g, '');
  }
  return { name, params, value: line.slice(colon + 1) };
}

/** SUMMARY's escapes. A `\n` becomes a space: a board title is one line. */
export function unescapeIcsText(value: string): string {
  return value
    .replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? ' ' : c))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether `Intl` knows a zone name. Windows names (`Mountain Standard Time`) it does not. */
function knownZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface IcsTime {
  /** Epoch ms of the instant; for a date, local midnight in the fallback zone. */
  ms: number;
  /** `YYYY-MM-DD` when the value is a date (an all-day event). */
  date?: string;
}

/** One DTSTART/DTEND value, in any of its three time forms or as a date. Null when it does not parse. */
export function parseIcsTime(prop: { params: Record<string, string>; value: string }, fallbackTz = SCHEDULE_TZ): IcsTime | null {
  const value = prop.value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly || prop.params['VALUE'] === 'DATE') {
    const m = dateOnly ?? /^(\d{4})(\d{2})(\d{2})/.exec(value);
    if (!m) return null;
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    try { return { ms: zonedToMs(date, '00:00', fallbackTz), date }; } catch { return null; }
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const seconds = Number(s ?? '0') * 1000;
  if (z) {
    const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)) + seconds;
    return Number.isFinite(ms) ? { ms } : null;
  }
  const tzid = prop.params['TZID'];
  const zone = tzid && knownZone(tzid) ? tzid : fallbackTz;
  try {
    return { ms: zonedToMs(`${y}-${mo}-${d}`, `${h}:${mi}`, zone) + seconds };
  } catch {
    return null;
  }
}

/** `P1D`, `PT1H30M`, `P1W`: milliseconds, or null. */
export function parseIcsDuration(value: string): number | null {
  const text = value.trim();
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(text);
  if (!m || text === 'P' || text.endsWith('T')) return null;
  const [, sign, w, d, h, mi, s] = m;
  const ms = ((Number(w ?? 0) * 7 + Number(d ?? 0)) * 86_400 + Number(h ?? 0) * 3600 + Number(mi ?? 0) * 60 + Number(s ?? 0)) * 1000;
  return sign === '-' ? -ms : ms;
}

/** The date `n` days after `YYYY-MM-DD`, by the calendar rather than by 24-hour steps. */
function plusDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10);
}

/**
 * Every VEVENT in `text` as a calendar event, in file order.
 *
 * Timed events carry ISO instants in UTC (`2026-10-01T23:00:00.000Z`); all-day events carry the
 * start date, the exclusive end date and `allDay: true`, which is how the secretary's export writes
 * them too. `calendar` is the feed's own `X-WR-CALNAME` when it names itself, else `name`.
 */
export function parseIcs(text: string, name = 'ICS', fallbackTz = SCHEDULE_TZ): CalendarEvent[] {
  let calendar = name;
  const out: CalendarEvent[] = [];
  let current: IcsProp[] | null = null;
  let depth = 0; // components nested inside a VEVENT (VALARM) are skipped whole

  for (const line of unfoldIcs(text)) {
    const prop = parseProp(line);
    if (!prop) continue;
    if (prop.name === 'BEGIN') {
      if (current) { depth++; continue; }
      if (prop.value.trim().toUpperCase() === 'VEVENT') { current = []; depth = 0; }
      continue;
    }
    if (prop.name === 'END') {
      if (current && depth > 0) { depth--; continue; }
      if (current && prop.value.trim().toUpperCase() === 'VEVENT') {
        const event = eventFrom(current, fallbackTz);
        if (event) out.push(event);
        current = null;
      }
      continue;
    }
    if (current) {
      if (depth === 0) current.push(prop);
    } else if (prop.name === 'X-WR-CALNAME' && prop.value.trim()) {
      calendar = unescapeIcsText(prop.value);
    }
  }
  // Named at the end, so a feed whose X-WR-CALNAME comes after its first event is still named.
  return out.map((e) => ({ ...e, calendar }));
}

function eventFrom(props: IcsProp[], fallbackTz: string): CalendarEvent | null {
  const get = (n: string): IcsProp | undefined => props.find((p) => p.name === n);
  if ((get('STATUS')?.value ?? '').trim().toUpperCase() === 'CANCELLED') return null;
  const dtstart = get('DTSTART');
  if (!dtstart) return null;
  const start = parseIcsTime(dtstart, fallbackTz);
  if (!start) return null;
  const title = unescapeIcsText(get('SUMMARY')?.value ?? '') || '(no title)';
  const dtend = get('DTEND');
  const end = dtend ? parseIcsTime(dtend, fallbackTz) : null;
  const durationProp = get('DURATION');
  const duration = durationProp ? parseIcsDuration(durationProp.value) : null;

  if (start.date) {
    // All day. DTEND is exclusive; absent, the event is that one day (RFC 5545 §3.6.1).
    let endDate = end?.date ?? null;
    if (!endDate && duration !== null) endDate = plusDays(start.date, Math.max(1, Math.round(duration / 86_400_000)));
    if (!endDate || endDate <= start.date) endDate = plusDays(start.date, 1);
    return { title, start: start.date, end: endDate, allDay: true };
  }
  let endMs = end?.ms ?? (duration !== null ? start.ms + duration : start.ms);
  if (endMs < start.ms) endMs = start.ms;
  return { title, start: new Date(start.ms).toISOString(), end: new Date(endMs).toISOString() };
}

/* ────────────────────────── the feeds, as settings.json names them ────────────────────────── */

/**
 * `settings.json` → `schedule`. USER ONLY and FILE ONLY: no channel writes it. A private iCal URL
 * (Google's "Secret address in iCal format") is a credential: anyone holding it reads the whole
 * calendar. So it lives in `%APPDATA%/SkynetOS/settings.json` and nowhere else: never in board
 * JSON, never in the repo, never in a log line, never in `calendar.json` (docs/07 § ScheduleOS).
 */
export interface ScheduleSettings {
  /** Private iCal feeds, `https://` or `webcal://`. Default none. */
  icsUrls: string[];
}

export const DEFAULT_SCHEDULE: ScheduleSettings = { icsUrls: [] };

/** One URL as fetched: `webcal://` is `https://` by another name; anything else is refused. */
export function icsFetchUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  const url = /^webcals?:\/\//i.test(text) ? text.replace(/^webcals?:\/\//i, 'https://') : text;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** A hand-edited `schedule` block, checked: a non-array, a non-string or a non-https entry is dropped. */
export function normaliseScheduleSettings(raw: unknown): ScheduleSettings {
  const urls = raw && typeof raw === 'object' ? (raw as { icsUrls?: unknown }).icsUrls : undefined;
  if (!Array.isArray(urls)) return { icsUrls: [] };
  return { icsUrls: urls.filter((u): u is string => icsFetchUrl(u) !== null).slice(0, 8) };
}
