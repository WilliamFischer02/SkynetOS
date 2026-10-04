import chokidar, { type FSWatcher } from 'chokidar';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { dayKey, type CalendarEvent, type PbsShift } from '@shared/schedule-week.js';
import {
  NO_CALENDAR,
  NO_CALENDAR_FIX,
  eventsOfSource,
  mergeCalendar,
  parseCalendarFile,
  type CalendarFile,
  type CalendarStatus
} from '@shared/schedule-calendar.js';
import { icsFetchUrl, parseIcs } from '@shared/ics.js';
import { boardWindow } from './main-window.js';
import { getSettings } from './settings.js';
import { skynetRoot } from './target-resolver.js';

/**
 * The calendar feed: keeps `schedule/calendar.json` current and tells the board when it changes.
 *
 * William: "I also want a live pane in the SkynetOS program that shows the calendar, both within the
 * room and on the main board." Every `panel.calendar` node draws this one file. It is rebuilt here,
 * by the same pure merge `npm run schedule:week` uses (packages/shared/schedule-calendar.ts), from:
 *
 *   - `schedule/pbs-shifts.json` and `private/schedule/events.json`, watched with chokidar and
 *     rebuilt 300 ms after either changes (both are on this machine's own disk);
 *   - the private iCal feeds in settings.json `schedule.icsUrls`, fetched every 10 minutes while the
 *     app runs, when there are any. Until the first fetch of a run lands, the `ics` blocks of the
 *     last file are carried forward so a restart does not blank them.
 *
 * `calendar.json` is watched too, so a rewrite by `npm run schedule:week` reaches the board without
 * a restart. Every change is pushed to the BOARD window as `schedule:calendar` (never to a remote
 * device), and nothing is pushed when the answer is the one the window already has.
 *
 * The rules of docs/07 § ScheduleOS: the file is gitignored; an iCal URL is a credential, so it is
 * never logged, never written to calendar.json, and a feed's failure is reported by its number
 * ("ICS FEED 2: HTTP 404"), never its address; only https (or webcal, read as https) is fetched.
 */

const REBUILD_DEBOUNCE_MS = 300;
const FEED_INTERVAL_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_FEED_BYTES = 5_000_000;

export function calendarFile(): string {
  return join(skynetRoot(), 'schedule', 'calendar.json');
}
function shiftsFile(): string {
  return join(skynetRoot(), 'schedule', 'pbs-shifts.json');
}
function eventsFile(): string {
  return join(skynetRoot(), 'private', 'schedule', 'events.json');
}

let watcher: FSWatcher | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
/** Per feed URL (memory only), its last good events. A feed that fails keeps its last good week. */
const feedCache = new Map<string, CalendarEvent[]>();
let feedNotes: string[] = [];
let fetchedThisRun = false;
let fetching = false;
let builtFor = '';
let lastPushed = '';

/** An array from a JSON file, or none and a note saying why. A missing file is no note. */
function readArray<T>(file: string, label: string, notes: string[]): T[] {
  if (!existsSync(file)) return [];
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (Array.isArray(raw)) return raw as T[];
    notes.push(`${label} IS NOT A LIST`);
  } catch (err) {
    notes.push(`COULD NOT READ ${label} — ${(err as Error).message}`);
  }
  return [];
}

function readCalendar(): CalendarFile | null {
  const file = calendarFile();
  if (!existsSync(file)) return null;
  try {
    return parseCalendarFile(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
}

/** What `schedule:calendar` answers: the file on disk, or why there is none. */
export function calendarStatus(): CalendarStatus {
  const file = calendarFile();
  if (!existsSync(file)) return { ready: false, reason: `${NO_CALENDAR} — ${NO_CALENDAR_FIX}` };
  try {
    const parsed = parseCalendarFile(JSON.parse(readFileSync(file, 'utf8')));
    return parsed
      ? { ready: true, calendar: parsed }
      : { ready: false, reason: `calendar.json IS NOT A CALENDAR — ${NO_CALENDAR_FIX} AGAIN` };
  } catch (err) {
    return { ready: false, reason: `COULD NOT READ calendar.json — ${(err as Error).message}` };
  }
}

/** Send the board window the current answer, unless it already has exactly this one. */
function push(): void {
  const status = calendarStatus();
  const signature = JSON.stringify(status);
  if (signature === lastPushed) return;
  lastPushed = signature;
  const win = boardWindow();
  if (win && !win.isDestroyed()) win.webContents.send('schedule:calendar', status);
}

/** The iCal events to merge now: this run's fetches, else the last file's, else none. */
function icsEvents(previous: CalendarFile | null): CalendarEvent[] {
  const urls = getSettings().schedule.icsUrls;
  if (!urls.length) return [];
  if (!fetchedThisRun) return previous ? eventsOfSource(previous, 'ics') : [];
  return urls.flatMap((u) => feedCache.get(u) ?? []);
}

/**
 * Merge the inputs and write calendar.json when what it says has changed (the time stamp aside),
 * then push. Returns what the board now reads.
 */
export function rebuildCalendar(reason: string): CalendarStatus {
  const notes: string[] = [];
  const shifts = readArray<PbsShift>(shiftsFile(), 'pbs-shifts.json', notes);
  const events = readArray<CalendarEvent>(eventsFile(), 'events.json', notes);
  const previous = readCalendar();
  const now = Date.now();
  const merged = mergeCalendar({ shifts, events, ics: icsEvents(previous), notes: [...notes, ...feedNotes] }, now);
  builtFor = dayKey(now);

  const body = (c: CalendarFile | null): string => (c ? JSON.stringify({ ...c, generatedAt: '' }) : '');
  if (body(merged) !== body(previous)) {
    const file = calendarFile();
    try {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(merged, null, 2) + '\n', 'utf8');
      renameSync(tmp, file);
      const total = merged.counts.pbs + merged.counts.events + merged.counts.ics;
      console.log(`[schedule] calendar.json rebuilt (${reason}): ${total} blocks — pbs ${merged.counts.pbs}, events ${merged.counts.events}, ics ${merged.counts.ics}`);
    } catch (err) {
      console.error(`[schedule] could not write calendar.json: ${(err as Error).message}`);
    }
  }
  push();
  return calendarStatus();
}

function scheduleRebuild(reason: string): void {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => { rebuildTimer = null; rebuildCalendar(reason); }, REBUILD_DEBOUNCE_MS);
}

function schedulePush(): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushTimer = null; push(); }, REBUILD_DEBOUNCE_MS);
}

/** A fetch error, in words, with any address in it removed: the address is the secret. */
function describeFailure(err: unknown): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string } };
  if (e?.name === 'AbortError') return 'TIMED OUT';
  const code = e?.cause?.code;
  return code ? `COULD NOT FETCH (${code})` : 'COULD NOT FETCH';
}

/** Fetch every configured feed once. Never logs a URL; a failed feed keeps its last good events. */
async function fetchFeeds(): Promise<void> {
  if (fetching) return;
  fetching = true;
  const urls = getSettings().schedule.icsUrls;
  const notes: string[] = [];
  try {
    for (const [i, raw] of urls.entries()) {
      const label = `ICS FEED ${i + 1}`;
      const url = icsFetchUrl(raw);
      if (!url) { notes.push(`${label}: NOT AN https OR webcal ADDRESS — FIX IT IN settings.json`); continue; }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { accept: 'text/calendar, text/plain;q=0.5' } });
        if (!res.ok) { notes.push(`${label}: HTTP ${res.status}`); continue; }
        const text = await res.text();
        if (text.length > MAX_FEED_BYTES) { notes.push(`${label}: LARGER THAN 5 MB — NOT READ`); continue; }
        if (!/BEGIN:VCALENDAR/i.test(text)) { notes.push(`${label}: NOT AN iCal FEED`); continue; }
        const events = parseIcs(text, `ICS ${i + 1}`);
        feedCache.set(raw, events);
        console.log(`[schedule] ${label} of ${urls.length}: ${events.length} events`);
      } catch (err) {
        const why = describeFailure(err);
        notes.push(`${label}: ${why}${feedCache.has(raw) ? ' — SHOWING ITS LAST GOOD COPY' : ''}`);
        console.warn(`[schedule] ${label} failed: ${why}`);
      } finally {
        clearTimeout(timeout);
      }
    }
    // Forget feeds that are no longer configured, so a removed URL's events leave the pane.
    for (const key of [...feedCache.keys()]) if (!urls.includes(key)) feedCache.delete(key);
    feedNotes = notes;
    fetchedThisRun = true;
  } finally {
    fetching = false;
  }
}

async function tick(): Promise<void> {
  if (getSettings().schedule.icsUrls.length && !process.env['SKYNET_SMOKE_DIR']) {
    await fetchFeeds();
    rebuildCalendar('ics');
  } else if (dayKey(Date.now()) !== builtFor) {
    // A new day moves the window: today + 13 now reaches a day the file did not have.
    rebuildCalendar('new day');
  }
}

/**
 * Start the feed: one rebuild now, the watcher, and the 10-minute tick. Safe to call twice. During a
 * smoke capture the files are still read (the pane is drawn), but no feed is fetched.
 */
export function startScheduleFeed(): void {
  if (watcher) return;
  rebuildCalendar('start');

  const scheduleDir = dirname(shiftsFile());
  const privateDir = dirname(eventsFile());
  const dirs = [scheduleDir, privateDir].filter((d) => existsSync(d));
  if (dirs.length) {
    watcher = chokidar.watch(dirs, {
      depth: 0,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
    });
    const onEvent = (path: string): void => {
      const name = basename(path).toLowerCase();
      const dir = dirname(path).replace(/\\/g, '/').toLowerCase();
      const inSchedule = dir === scheduleDir.replace(/\\/g, '/').toLowerCase();
      if (inSchedule && name === 'pbs-shifts.json') scheduleRebuild('pbs-shifts.json changed');
      else if (!inSchedule && name === 'events.json') scheduleRebuild('events.json changed');
      else if (inSchedule && name === 'calendar.json') schedulePush();
    };
    watcher.on('add', onEvent);
    watcher.on('change', onEvent);
    watcher.on('unlink', onEvent);
    watcher.on('error', (err: unknown) => console.error('[schedule] watcher error:', (err as Error).message));
  }

  timer = setInterval(() => { void tick(); }, FEED_INTERVAL_MS);
  if (getSettings().schedule.icsUrls.length && !process.env['SKYNET_SMOKE_DIR']) {
    void fetchFeeds().then(() => rebuildCalendar('ics'));
  }
}

export function stopScheduleFeed(): void {
  if (timer) { clearInterval(timer); timer = null; }
  if (rebuildTimer) { clearTimeout(rebuildTimer); rebuildTimer = null; }
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  if (watcher) { void watcher.close(); watcher = null; }
}
