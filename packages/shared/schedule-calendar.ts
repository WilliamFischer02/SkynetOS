/**
 * The merged calendar: `schedule/calendar.json`, the one file the board's calendar pane reads.
 *
 * William: "I also want a live pane in the SkynetOS program that shows the calendar, both within the
 * room and on the main board." The pane (`panel.calendar`) needs one normalised list of blocks, and
 * the blocks come from three places that know nothing of each other:
 *
 *   - `pbs`     `schedule/pbs-shifts.json`, each shift expanded into its prep chain (`expandShift`);
 *   - `events`  `private/schedule/events.json`, the calendar export the secretary writes;
 *   - `ics`     the private iCal feeds in settings.json `schedule.icsUrls`, fetched by main
 *               (src/main/services/schedule-feed.ts) and read by packages/shared/ics.ts.
 *
 * `mergeCalendar` puts them in one shape, drops duplicates (the same start and the same title: the
 * secretary's export carries the chain the shifts file also produces), sorts, and keeps the window
 * the pane can show: every day from this week's Monday to thirteen days after today. The Monday
 * start is so a pane set to `start: "monday"` shows the earlier days of the week as they were
 * rather than as empty.
 *
 * Pure. The clock is the `now` passed in, every local time is America/Denver through `Intl`
 * (schedule-week.ts), and nothing here touches the disk or the network. The main-side feed and
 * `npm run schedule:week` both write the file through this, so the board and the HTML week view
 * cannot disagree about what the week holds.
 */
import {
  SCHEDULE_TZ,
  addDays,
  blockFromEvent,
  categoryOf,
  dayKey,
  expandShift,
  minutesInto,
  offsetMinutes,
  weekOf,
  zonedToMs,
  type Block,
  type CalendarEvent,
  type Category,
  type PbsShift
} from './schedule-week.js';

/** Days after today the file reaches: today and the thirteen after it. */
export const CALENDAR_DAYS = 14;

export type CalendarSource = 'pbs' | 'events' | 'ics';
export const CALENDAR_SOURCES: readonly CalendarSource[] = ['pbs', 'events', 'ics'];

/** One block as the file stores it. Local ISO times with their offset, or dates for all day. */
export interface CalendarBlock {
  /** `2026-10-01T17:30:00-06:00`, or `2026-10-01` when `allDay`. */
  start: string;
  /** Exclusive. `2026-10-01T22:30:00-06:00`, or the next day's date when `allDay`. */
  end: string;
  title: string;
  category: Category;
  /** The calendar it belongs to: `Work – Shifts`, the feed's own name, the export's field. */
  calendar: string;
  allDay?: boolean;
  source: CalendarSource;
  /** shift, chain (a PBS prep step), event, or allDay. The week view draws a chain as a stripe. */
  kind: Block['kind'];
  /** A PBS shift whose end was inferred rather than told. */
  estimated?: boolean;
}

export interface CalendarDay {
  /** `YYYY-MM-DD`, in America/Denver. */
  date: string;
  blocks: CalendarBlock[];
}

export interface CalendarFile {
  /** When it was merged, as a local ISO time. */
  generatedAt: string;
  timeZone: typeof SCHEDULE_TZ;
  days: CalendarDay[];
  /** How many blocks in the window came from each source, after duplicates were dropped. */
  counts: Record<CalendarSource, number>;
  /** What could not be read, in words, with no URL in them (an iCal URL is a credential). */
  notes?: string[];
}

export interface CalendarInputs {
  shifts?: readonly PbsShift[];
  events?: readonly CalendarEvent[];
  /** Already parsed and named: packages/shared/ics.ts, or the `ics` blocks of the last file. */
  ics?: readonly CalendarEvent[];
  notes?: readonly string[];
}

/** `2026-10-01T17:30:00-06:00`: an instant on `tz`'s wall clock with its offset. */
export function isoLocal(ms: number, tz = SCHEDULE_TZ): string {
  const off = offsetMinutes(ms, tz);
  const local = new Date(Math.floor(ms / 1000) * 1000 + off * 60000).toISOString().slice(0, 19);
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** The days the file covers: this week's Monday through today + 13. */
export function calendarWindow(now: number, tz = SCHEDULE_TZ): string[] {
  const today = dayKey(now, tz);
  const last = addDays(today, CALENDAR_DAYS - 1, tz);
  const days: string[] = [];
  for (let day = weekOf(now, tz).start; day <= last && days.length < CALENDAR_DAYS + 7; day = addDays(day, 1, tz)) days.push(day);
  return days;
}

/**
 * One event → its blocks. An all-day event that spans several days is one block per day, so an
 * `⛔ OFF DAY` on Saturday and Sunday hatches both columns. A timed event stays on its start day,
 * as the week view has always drawn it.
 */
export function blocksOfEvent(event: CalendarEvent, tz = SCHEDULE_TZ): Block[] {
  const first = blockFromEvent(event, tz);
  if (!first) return [];
  if (first.kind !== 'allDay') return [first];
  const endDate = typeof event.end === 'string' && /^\d{4}-\d{2}-\d{2}/.test(event.end) ? event.end.slice(0, 10) : null;
  if (!endDate || endDate <= addDays(first.day, 1, tz)) return [first];
  const out: Block[] = [first];
  // At most 31 days: a year-long all-day event in a feed is a note, not 365 hatched columns.
  for (let day = addDays(first.day, 1, tz); day < endDate && out.length < 31; day = addDays(day, 1, tz)) {
    const start = zonedToMs(day, '00:00', tz);
    out.push({ ...first, day, start, end: zonedToMs(addDays(day, 1, tz), '00:00', tz) });
  }
  return out;
}

const titleKey = (title: string): string => title.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The three sources, merged: one list per day, duplicates dropped, sorted by start.
 *
 * A duplicate is the same start instant and the same title (case and spacing aside). The first
 * one seen wins, in the order pbs → events → ics: the shifts file is what William told the
 * secretary, so its block (with `estimated` and the chain's kind) is the one kept.
 */
export function mergeCalendar(inputs: CalendarInputs, now: number, tz = SCHEDULE_TZ): CalendarFile {
  const window = calendarWindow(now, tz);
  const inWindow = new Set(window);
  const byDay = new Map<string, CalendarBlock[]>(window.map((d) => [d, []]));
  const seen = new Set<string>();
  const counts: Record<CalendarSource, number> = { pbs: 0, events: 0, ics: 0 };

  const put = (b: Block, source: CalendarSource, calendar: string | undefined): void => {
    if (!inWindow.has(b.day)) return;
    const key = `${b.kind === 'allDay' ? b.day : b.start}|${titleKey(b.title)}`;
    if (seen.has(key)) return;
    seen.add(key);
    counts[source]++;
    const allDay = b.kind === 'allDay';
    byDay.get(b.day)!.push({
      start: allDay ? b.day : isoLocal(b.start, tz),
      end: allDay ? addDays(b.day, 1, tz) : isoLocal(b.end, tz),
      title: b.title,
      category: b.category ?? categoryOf(b.title),
      calendar: calendar ?? b.calendar ?? (source === 'pbs' ? 'Work – Shifts' : source === 'ics' ? 'ICS' : 'Calendar'),
      ...(allDay ? { allDay: true } : {}),
      source,
      kind: b.kind,
      ...(b.estimated ? { estimated: true } : {})
    });
  };

  for (const shift of inputs.shifts ?? []) {
    let blocks: Block[];
    try { blocks = expandShift(shift, tz); } catch { continue; }
    for (const b of blocks) put(b, 'pbs', b.calendar);
  }
  for (const event of inputs.events ?? []) for (const b of blocksOfEvent(event, tz)) put(b, 'events', event.calendar);
  for (const event of inputs.ics ?? []) for (const b of blocksOfEvent(event, tz)) put(b, 'ics', event.calendar);

  const sortKey = (b: CalendarBlock): number => (b.allDay ? -1 : Date.parse(b.start));
  const days: CalendarDay[] = window.map((date) => ({
    date,
    blocks: (byDay.get(date) ?? []).sort((a, b) =>
      sortKey(a) - sortKey(b) || Date.parse(a.end) - Date.parse(b.end) || a.title.localeCompare(b.title))
  }));
  return {
    generatedAt: isoLocal(now, tz),
    timeZone: SCHEDULE_TZ,
    days,
    counts,
    ...(inputs.notes && inputs.notes.length ? { notes: [...inputs.notes] } : {})
  };
}

/**
 * The blocks of one source as calendar events again. How the `ics` blocks of the last file are
 * carried into the next merge by a writer that did not fetch the feeds itself (`npm run
 * schedule:week`, or the app before its first fetch), so they are not dropped by the rebuild.
 */
export function eventsOfSource(file: CalendarFile, source: CalendarSource): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const day of file.days) {
    for (const b of day.blocks) {
      if (b.source !== source) continue;
      out.push({ title: b.title, start: b.start, end: b.end, calendar: b.calendar, ...(b.allDay ? { allDay: true } : {}) });
    }
  }
  return out;
}

const CATEGORIES: readonly Category[] = ['income', 'pbs', 'stream', 'hobbies', 'upkeep', 'card', 'off', 'wind', 'other'];
const KINDS: readonly Block['kind'][] = ['shift', 'chain', 'event', 'allDay'];

/**
 * A parsed `calendar.json`, checked, or null when it is not one. Blocks that do not parse are
 * dropped one by one rather than failing the file: one bad row must not blank the whole pane.
 */
export function parseCalendarFile(raw: unknown): CalendarFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o['days'])) return null;
  const days: CalendarDay[] = [];
  for (const d of o['days'] as unknown[]) {
    if (!d || typeof d !== 'object') continue;
    const date = (d as Record<string, unknown>)['date'];
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const rows = (d as Record<string, unknown>)['blocks'];
    const blocks: CalendarBlock[] = [];
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r || typeof r !== 'object') continue;
      const b = r as Record<string, unknown>;
      if (typeof b['start'] !== 'string' || typeof b['end'] !== 'string' || typeof b['title'] !== 'string') continue;
      if (Number.isNaN(Date.parse(b['start'])) || Number.isNaN(Date.parse(b['end']))) continue;
      const source = CALENDAR_SOURCES.includes(b['source'] as CalendarSource) ? b['source'] as CalendarSource : 'events';
      const allDay = b['allDay'] === true;
      blocks.push({
        start: b['start'],
        end: b['end'],
        title: b['title'],
        category: CATEGORIES.includes(b['category'] as Category) ? b['category'] as Category : categoryOf(b['title']),
        calendar: typeof b['calendar'] === 'string' ? b['calendar'] : '',
        ...(allDay ? { allDay: true } : {}),
        source,
        kind: KINDS.includes(b['kind'] as Block['kind']) ? b['kind'] as Block['kind'] : allDay ? 'allDay' : 'event',
        ...(b['estimated'] === true ? { estimated: true } : {})
      });
    }
    days.push({ date, blocks });
  }
  const c = (o['counts'] ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const notes = Array.isArray(o['notes']) ? (o['notes'] as unknown[]).filter((n): n is string => typeof n === 'string') : [];
  return {
    generatedAt: typeof o['generatedAt'] === 'string' ? o['generatedAt'] : '',
    timeZone: SCHEDULE_TZ,
    days,
    counts: { pbs: num(c['pbs']), events: num(c['events']), ics: num(c['ics']) },
    ...(notes.length ? { notes } : {})
  };
}

/** A file block as the week model's `Block`, placed on `day`. */
export function blockOf(b: CalendarBlock, day: string, tz = SCHEDULE_TZ): Block {
  const start = b.allDay ? zonedToMs(day, '00:00', tz) : Date.parse(b.start);
  const end = b.allDay ? start + 86_400_000 : Date.parse(b.end);
  const startMin = b.allDay ? 0 : minutesInto(day, start, tz);
  return {
    title: b.title,
    start,
    end,
    day,
    startMin,
    endMin: b.allDay ? 1440 : startMin + Math.round((end - start) / 60000),
    category: b.category,
    kind: b.kind,
    ...(b.estimated ? { estimated: true } : {}),
    calendar: b.calendar
  };
}

/** Every day of the file as week-model blocks, so the HTML week view draws what the board draws. */
export function blocksByDay(file: CalendarFile, tz = SCHEDULE_TZ): Map<string, Block[]> {
  return new Map(file.days.map((d) => [d.date, d.blocks.map((b) => blockOf(b, d.date, tz))]));
}

/**
 * The next `n` timed blocks that have not ended by `now`, soonest first: the inspector's three
 * lines. All-day events are left out; an off day shows on the pane itself, hatched.
 */
export function upcomingBlocks(file: CalendarFile, now: number, n = 3): CalendarBlock[] {
  return file.days
    .flatMap((d) => d.blocks)
    .filter((b) => !b.allDay && Date.parse(b.end) > now)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .slice(0, n);
}

/** What main answers on `schedule:calendar`: the file, or why there is none. */
export type CalendarStatus =
  | { ready: true; calendar: CalendarFile }
  | { ready: false; reason: string };

/** The failure face's words, and the inspector's. */
export const NO_CALENDAR = 'NO CALENDAR';
export const NO_CALENDAR_FIX = 'RUN npm run schedule:week';
