/**
 * npm run schedule:week — renders schedule/week.html and schedule/today.md, and (re)writes
 * schedule/calendar.json, the merged calendar every `panel.calendar` pane on the board draws.
 *
 * Inputs, every one optional (a missing file is an empty list and is said so):
 *   schedule/pbs-shifts.json          the PBS shifts the secretary was told about
 *   private/schedule/events.json      the calendar export the secretary writes through the MCP
 *   schedule/calendar.json            when it exists: its iCal blocks (source "ics"), which only the
 *                                     running app fetches, are carried into the new merge, so the
 *                                     week view shows what the board shows and the rebuild does
 *                                     not drop them
 *   private/schedule/reclaim/habits.json   only for the legend
 *   schedule/changes.log.jsonl        the last five lines, for the footer
 *
 * The week view is drawn FROM the merged calendar (packages/shared/schedule-calendar.ts), not from
 * the two files directly, so the HTML and the board agree block for block. Everything it decides is
 * packages/shared/; this file is the disk and the console. The outputs are gitignored (docs/07: the
 * repo is public and a calendar is personal). Nothing here reads the network or writes outside
 * schedule/.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  SCHEDULE_TZ,
  addDays,
  dayKey,
  readbackLine,
  renderTodayMd,
  renderWeekHtml,
  violations,
  weekOf,
  hhmm,
  type CalendarEvent,
  type PbsShift
} from '../packages/shared/schedule-week.js';
import { blocksByDay, eventsOfSource, mergeCalendar, parseCalendarFile, type CalendarFile } from '../packages/shared/schedule-calendar.js';

const ROOT = resolve(process.cwd());
const SCHEDULE = join(ROOT, 'schedule');
const SHIFTS = join(SCHEDULE, 'pbs-shifts.json');
const CHANGES = join(SCHEDULE, 'changes.log.jsonl');
const EVENTS = join(ROOT, 'private', 'schedule', 'events.json');
const HABITS = join(ROOT, 'private', 'schedule', 'reclaim', 'habits.json');
const WEEK_HTML = join(SCHEDULE, 'week.html');
const TODAY_MD = join(SCHEDULE, 'today.md');
const CALENDAR_JSON = join(SCHEDULE, 'calendar.json');

/** The last merged calendar, or null (none yet, or unreadable, said so). */
function readCalendar(): CalendarFile | null {
  if (!existsSync(CALENDAR_JSON)) {
    console.log(`calendar.json: none yet (${CALENDAR_JSON} is written below)`);
    return null;
  }
  try {
    const parsed = parseCalendarFile(JSON.parse(readFileSync(CALENDAR_JSON, 'utf8')));
    if (!parsed) console.log(`calendar.json: not a calendar — rebuilt below`);
    return parsed;
  } catch (err) {
    console.log(`calendar.json: COULD NOT READ (${(err as Error).message}) — rebuilt below`);
    return null;
  }
}

function readArray<T>(file: string, label: string, pick?: (raw: unknown) => unknown): T[] {
  if (!existsSync(file)) {
    console.log(`${label}: none (${file} does not exist)`);
    return [];
  }
  try {
    let raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (pick) raw = pick(raw);
    if (!Array.isArray(raw)) {
      console.log(`${label}: none (${file} does not hold an array)`);
      return [];
    }
    console.log(`${label}: ${raw.length}`);
    return raw as T[];
  } catch (err) {
    console.log(`${label}: none (COULD NOT READ ${file}: ${(err as Error).message})`);
    return [];
  }
}

function main(): void {
  const now = Date.now();
  const today = dayKey(now, SCHEDULE_TZ);
  const week = weekOf(now, SCHEDULE_TZ);

  const shifts = readArray<PbsShift>(SHIFTS, 'PBS shifts');
  const events = readArray<CalendarEvent>(EVENTS, 'calendar events');
  const habits = readArray<{ title?: string }>(HABITS, 'habits', (raw) => (raw && typeof raw === 'object' ? (raw as { habits?: unknown }).habits : raw));
  const habitTitles = habits.map((h) => (typeof h.title === 'string' ? h.title : '')).filter(Boolean);
  let changes: string[] = [];
  if (existsSync(CHANGES)) {
    try { changes = readFileSync(CHANGES, 'utf8').split(/\r?\n/).filter(Boolean).slice(-5); } catch { changes = []; }
  }

  // One merge for the board and the page: the shifts and the export as they are now, plus the
  // iCal blocks the app last fetched (only the app fetches; this tool reads no network).
  const previous = readCalendar();
  const ics = previous ? eventsOfSource(previous, 'ics') : [];
  if (ics.length) console.log(`iCal blocks carried from calendar.json: ${ics.length}`);
  const calendar = mergeCalendar({ shifts, events, ics, notes: previous?.notes?.filter((n) => n.startsWith('ICS FEED')) }, now, SCHEDULE_TZ);
  const all = blocksByDay(calendar, SCHEDULE_TZ);
  // The calendar starts on this week's Monday and runs 14 days past today, so it holds the whole
  // week and tomorrow, whichever week tomorrow falls in.
  const byDay = new Map(week.days.map((d) => [d, all.get(d) ?? []]));
  const tomorrow = addDays(today, 1, SCHEDULE_TZ);
  const tomorrowBlocks = all.get(tomorrow) ?? [];
  const tomorrowCard = renderTodayMd({ day: tomorrow, blocks: tomorrowBlocks }, SCHEDULE_TZ);
  const todayCard = renderTodayMd({ day: today, blocks: byDay.get(today) ?? [] }, SCHEDULE_TZ);

  const html = renderWeekHtml({ week, byDay, today, tomorrowCard, habitTitles, changes, generatedAt: now }, SCHEDULE_TZ);

  if (!existsSync(SCHEDULE)) mkdirSync(SCHEDULE, { recursive: true });
  writeFileSync(WEEK_HTML, html, 'utf8');
  writeFileSync(TODAY_MD, todayCard, 'utf8');
  // Written whole and renamed into place: the running app watches this file and must never read
  // half of it.
  writeFileSync(`${CALENDAR_JSON}.tmp`, JSON.stringify(calendar, null, 2) + '\n', 'utf8');
  renameSync(`${CALENDAR_JSON}.tmp`, CALENDAR_JSON);

  console.log('');
  console.log(`WEEK ${week.start} → ${week.end} (${SCHEDULE_TZ}), today ${today}`);
  for (const day of week.days) console.log(readbackLine(day, byDay.get(day) ?? [], SCHEDULE_TZ));
  const bad = violations([...byDay.values()].flat());
  console.log('');
  if (bad.length) {
    console.log(`23:00–07:30 VIOLATIONS: ${bad.length}`);
    for (const b of bad) console.log(`  ${b.day} ${hhmm(b.startMin)}–${hhmm(b.endMin)} ${b.title}`);
  } else {
    console.log('No block touches 23:00–07:30.');
  }
  console.log('');
  console.log(`wrote ${WEEK_HTML}`);
  console.log(`wrote ${TODAY_MD}`);
  console.log(`wrote ${CALENDAR_JSON} (${calendar.days.length} days, ${calendar.counts.pbs + calendar.counts.events + calendar.counts.ics} blocks)`);
}

main();
