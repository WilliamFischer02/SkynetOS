/**
 * npm run schedule:week — renders schedule/week.html and schedule/today.md.
 *
 * Inputs, every one optional (a missing file is an empty list and is said so):
 *   schedule/pbs-shifts.json          the PBS shifts the secretary was told about
 *   private/schedule/events.json      the calendar export the secretary writes through the MCP
 *   private/schedule/reclaim/habits.json   only for the legend
 *   schedule/changes.log.jsonl        the last five lines, for the footer
 *
 * Everything it decides is packages/shared/schedule-week.ts; this file is the disk and the console.
 * The outputs are gitignored (docs/07: the repo is public and a calendar is personal). Nothing here
 * reads the network or writes outside schedule/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  SCHEDULE_TZ,
  addDays,
  blocksForWeek,
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

const ROOT = resolve(process.cwd());
const SCHEDULE = join(ROOT, 'schedule');
const SHIFTS = join(SCHEDULE, 'pbs-shifts.json');
const CHANGES = join(SCHEDULE, 'changes.log.jsonl');
const EVENTS = join(ROOT, 'private', 'schedule', 'events.json');
const HABITS = join(ROOT, 'private', 'schedule', 'reclaim', 'habits.json');
const WEEK_HTML = join(SCHEDULE, 'week.html');
const TODAY_MD = join(SCHEDULE, 'today.md');

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

  const byDay = blocksForWeek(shifts, events, week, SCHEDULE_TZ);
  const tomorrow = addDays(today, 1, SCHEDULE_TZ);
  // Tomorrow may fall in next week; render its card from its own blocks either way.
  const tomorrowBlocks = byDay.get(tomorrow) ?? blocksForWeek(shifts, events, weekOf(now + 86_400_000, SCHEDULE_TZ), SCHEDULE_TZ).get(tomorrow) ?? [];
  const tomorrowCard = renderTodayMd({ day: tomorrow, blocks: tomorrowBlocks }, SCHEDULE_TZ);
  const todayCard = renderTodayMd({ day: today, blocks: byDay.get(today) ?? [] }, SCHEDULE_TZ);

  const html = renderWeekHtml({ week, byDay, today, tomorrowCard, habitTitles, changes, generatedAt: now }, SCHEDULE_TZ);

  if (!existsSync(SCHEDULE)) mkdirSync(SCHEDULE, { recursive: true });
  writeFileSync(WEEK_HTML, html, 'utf8');
  writeFileSync(TODAY_MD, todayCard, 'utf8');

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
}

main();
