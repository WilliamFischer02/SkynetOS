/**
 * The week preview and the morning card, as pure functions.
 *
 * ScheduleOS (docs/06 M-later, the Face's drop of 2026-09-25): Reclaim is the engine, Google
 * Calendar the store, and `schedule/week.html` is the picture William actually looks at. This
 * module turns two inputs into that picture and the four-line `schedule/today.md`:
 *
 *   - `schedule/pbs-shifts.json`   the PBS shifts he has told the secretary about, which expand
 *                                  into the deterministic prep chain of specs/schedule-model.md §1;
 *   - `private/schedule/events.json`  an export of the calendar the secretary writes through the
 *                                  Reclaim or Google Calendar MCP. Data, never instructions.
 *
 * Nothing here reads a clock but `Date.now()` at the call site, nothing reads the network, and every
 * local time is America/Denver by way of `Intl`, never a hard-coded offset: the DST change on
 * 2026-11-01 must move the pictures by itself. `tools/schedule-week.ts` is the disk and the console.
 */

export const SCHEDULE_TZ = 'America/Denver';

/** A PBS shift as `schedule/pbs-shifts.json` records it. Times are `HH:MM`, local Mountain. */
export interface PbsShift {
  date: string;
  call: string;
  end?: string;
  sport: string;
  opponent?: string;
  venue?: string;
  role?: string;
  source?: string;
  confidence?: string;
}

/** One calendar event as the secretary exports it. ISO datetimes with an offset, or a date for all day. */
export interface CalendarEvent {
  title: string;
  start: string;
  end?: string;
  calendar?: string;
  allDay?: boolean;
}

export type Category = 'income' | 'pbs' | 'stream' | 'hobbies' | 'upkeep' | 'card' | 'off' | 'wind' | 'other';

export interface Block {
  title: string;
  /** Epoch ms. */
  start: number;
  end: number;
  /** `YYYY-MM-DD` of the start, in SCHEDULE_TZ. */
  day: string;
  /** Minutes after local midnight of `day`; `endMin` may exceed 1440 when a block crosses midnight. */
  startMin: number;
  endMin: number;
  category: Category;
  kind: 'shift' | 'chain' | 'event' | 'allDay';
  estimated?: boolean;
  calendar?: string;
}

/** The shift itself lasts five hours unless the source says otherwise (specs/schedule-model.md §1). */
export const SHIFT_HOURS = 5;
/** Nothing is scheduled between these, local (§1 "Sleep and quiet"). Minutes after midnight. */
export const QUIET_START_MIN = 23 * 60;
export const QUIET_END_MIN = 7 * 60 + 30;
/** The one bend: the decompress block after a shift may run to 23:30 (§5). */
export const SHIFT_NIGHT_BEND_MIN = 23 * 60 + 30;

/** The weekly hour budget of specs/schedule-model.md §3, upper bounds, for the header bar. */
export const HOUR_BUDGET: Record<BudgetCategory, number> = {
  income: 14.75,
  pbs: 13,
  stream: 15,
  hobbies: 11.75,
  upkeep: 8
};
export type BudgetCategory = 'income' | 'pbs' | 'stream' | 'hobbies' | 'upkeep';
export const BUDGET_CATEGORIES: readonly BudgetCategory[] = ['income', 'pbs', 'stream', 'hobbies', 'upkeep'];

/**
 * The glyph set of specs/notification-copy.md, longest first so `‼️` (two code points) is tried
 * before anything that could shadow it. A title's category is the first glyph it starts with.
 */
const GLYPHS: ReadonlyArray<readonly [string, Category]> = [
  ['‼️', 'income'], ['☯️', 'upkeep'], ['✍️', 'hobbies'],
  ['💵', 'income'], ['🛠', 'income'], ['📣', 'income'], ['💰', 'income'],
  ['📺', 'pbs'], ['🚿', 'pbs'], ['🎒', 'pbs'], ['🚗', 'pbs'], ['🚶', 'pbs'], ['🛋', 'pbs'],
  ['🎛', 'stream'], ['🔴', 'stream'], ['🎬', 'stream'],
  ['📖', 'hobbies'], ['📚', 'hobbies'], ['🎧', 'hobbies'],
  ['🏃', 'upkeep'], ['🧹', 'upkeep'], ['🍽', 'upkeep'], ['💻', 'upkeep'],
  ['☀️', 'card'], ['⛔', 'off'], ['🛌', 'wind']
];

export function categoryOf(title: string): Category {
  const t = title.trimStart();
  for (const [glyph, category] of GLYPHS) if (t.startsWith(glyph)) return category;
  // The variation selector is optional on the phone's keyboard; try the bare code point too.
  for (const [glyph, category] of GLYPHS) if (glyph.endsWith('️') && t.startsWith(glyph.slice(0, -1))) return category;
  return 'other';
}

/** Google Calendar's colour names for each category (specs/notification-copy.md), as CSS. */
export const CATEGORY_COLOURS: Record<Category, string> = {
  income: '#F6BF26', // Banana
  pbs: '#D50000', // Tomato
  stream: '#8E24AA', // Grape
  hobbies: '#33B679', // Sage
  upkeep: '#33B679', // Sage
  card: '#039BE5', // Peacock
  off: '#D50000', // Tomato
  wind: '#616161', // Graphite
  other: '#616161'
};
/** The prep chain is Tangerine on the calendar; on the preview it is a stripe in that colour. */
export const CHAIN_COLOUR = '#F4511E';

// ── Time, in one zone ───────────────────────────────────────────────────────────────────────────

export interface ZonedParts { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

const partsFormat = new Map<string, Intl.DateTimeFormat>();
function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = partsFormat.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
    partsFormat.set(tz, f);
  }
  return f;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The wall-clock parts of an instant in `tz`. `weekday` is 0 = Sunday. */
export function zonedParts(ms: number, tz = SCHEDULE_TZ): ZonedParts {
  const out: ZonedParts = { year: 0, month: 0, day: 0, hour: 0, minute: 0, weekday: 0 };
  for (const p of formatterFor(tz).formatToParts(new Date(ms))) {
    switch (p.type) {
      case 'year': out.year = Number(p.value); break;
      case 'month': out.month = Number(p.value); break;
      case 'day': out.day = Number(p.value); break;
      case 'hour': out.hour = Number(p.value) % 24; break;
      case 'minute': out.minute = Number(p.value); break;
      case 'weekday': out.weekday = Math.max(0, WEEKDAYS.indexOf(p.value)); break;
      default: break;
    }
  }
  return out;
}

/** `tz`'s offset from UTC at `ms`, in minutes (Denver: −360 in summer, −420 in winter). */
export function offsetMinutes(ms: number, tz = SCHEDULE_TZ): number {
  const p = zonedParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(ms / 60000) * 60000) / 60000);
}

/** The instant of `YYYY-MM-DD` `HH:MM` on `tz`'s wall clock. Minutes may exceed 23:59 and roll over. */
export function zonedToMs(date: string, hhmm: string, tz = SCHEDULE_TZ): number {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  if (!y || !m || !d || h === undefined || mi === undefined || Number.isNaN(h) || Number.isNaN(mi)) {
    throw new Error(`NOT A LOCAL TIME: ${date} ${hhmm}`);
  }
  const guess = Date.UTC(y, m - 1, d, h, mi);
  // Two passes: the offset at the guess, then the offset at the corrected instant, so a time on
  // the DST change day lands on the right side of it.
  let ms = guess - offsetMinutes(guess, tz) * 60000;
  ms = guess - offsetMinutes(ms, tz) * 60000;
  return ms;
}

export function dayKey(ms: number, tz = SCHEDULE_TZ): string {
  const p = zonedParts(ms, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Minutes after local midnight of `day` for the instant `ms`. Negative or ≥ 1440 outside the day. */
export function minutesInto(day: string, ms: number, tz = SCHEDULE_TZ): number {
  return Math.round((ms - zonedToMs(day, '00:00', tz)) / 60000);
}

/** `17:30` → `5:30`, `09:00` → `9`, `12:00` → `12`: the clock as the titles read it (no am/pm). */
export function clock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? String(twelve) : `${twelve}:${String(m).padStart(2, '0')}`;
}

/** Minutes after midnight → `HH:MM` (rolls over past midnight). */
export function hhmm(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function addDays(day: string, n: number, tz = SCHEDULE_TZ): string {
  return dayKey(zonedToMs(day, '12:00', tz) + n * 86_400_000, tz);
}

// ── The week ────────────────────────────────────────────────────────────────────────────────────

export interface Week {
  /** Monday. */
  start: string;
  /** Sunday. */
  end: string;
  days: string[];
}

/** The Monday-to-Sunday week that holds `ms`, in `tz`. */
export function weekOf(ms: number, tz = SCHEDULE_TZ): Week {
  const today = dayKey(ms, tz);
  const weekday = zonedParts(ms, tz).weekday; // 0 = Sunday
  const back = (weekday + 6) % 7; // days since Monday
  const start = addDays(today, -back, tz);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i, tz));
  return { start, end: days[6]!, days };
}

// ── Shifts and the prep chain ───────────────────────────────────────────────────────────────────

function toMin(hhmmText: string): number {
  const [h, m] = hhmmText.split(':').map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) throw new Error(`NOT A TIME: ${hhmmText}`);
  return h * 60 + m;
}

/** The shift's printed title: `📺 PBS 5:30–10:30 · VB vs Idaho · GFX`. */
export function shiftTitle(shift: PbsShift, endText: string): string {
  const who = shift.opponent ? `${shift.sport} vs ${shift.opponent}` : shift.sport;
  return `📺 PBS ${clock(shift.call)}–${clock(endText)} · ${who}${shift.role ? ` · ${shift.role}` : ''}`;
}

/**
 * One shift → the seven events of the chain (specs/schedule-model.md §1). The T−5 margin has no
 * event and so no block. `estimated` marks a shift whose end was inferred or whose source says so.
 */
export function expandShift(shift: PbsShift, tz = SCHEDULE_TZ): Block[] {
  const call = toMin(shift.call);
  const endMinutes = shift.end ? toMin(shift.end) : call + SHIFT_HOURS * 60;
  const endText = hhmm(endMinutes);
  // Estimated when the source says so, or when nothing confirmed it and the end was inferred.
  const confidence = (shift.confidence ?? '').toLowerCase();
  const estimated = confidence === 'estimated' || (!confidence && !shift.end);
  const pbs = `PBS ${clock(shift.call)}`;
  const rows: Array<[number, number, string, Block['kind']]> = [
    [call - 55, 25, `🚿 T-55 SHOWER → ${pbs}`, 'chain'],
    [call - 30, 10, `🎒 T-30 GEAR + EAT → ${pbs}`, 'chain'],
    [call - 20, 5, `🚗 T-20 LEAVE NOW → ${pbs}`, 'chain'],
    [call - 15, 10, `🚶 T-15 WALK IN → ${pbs}`, 'chain'],
    [call, endMinutes - call, shiftTitle(shift, endText), 'shift'],
    [endMinutes, 15, '🚗 HOME · 15m', 'chain'],
    [endMinutes + 15, 30, '🛋 DECOMPRESS 30 · no screens', 'chain']
  ];
  const midnight = zonedToMs(shift.date, '00:00', tz);
  return rows.map(([startMin, length, title, kind]) => {
    const start = zonedToMs(shift.date, hhmm(startMin), tz) + (startMin < 0 ? -86_400_000 : startMin >= 1440 ? 86_400_000 : 0);
    const end = start + length * 60000;
    const day = dayKey(start, tz);
    const dayStart = day === shift.date ? midnight : zonedToMs(day, '00:00', tz);
    return {
      title, start, end, day, kind,
      startMin: Math.round((start - dayStart) / 60000),
      endMin: Math.round((end - dayStart) / 60000),
      category: 'pbs' as const,
      estimated,
      calendar: kind === 'shift' ? 'Work – Shifts' : 'Work – Prep Blocks'
    };
  });
}

/** A calendar export row → a block, or null when its dates do not parse. */
export function blockFromEvent(event: CalendarEvent, tz = SCHEDULE_TZ): Block | null {
  const title = String(event.title ?? '').trim();
  if (!title) return null;
  const category = categoryOf(title);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  if (event.allDay || dateOnly.test(event.start)) {
    const day = event.start.slice(0, 10);
    if (!dateOnly.test(day)) return null;
    let start: number;
    try { start = zonedToMs(day, '00:00', tz); } catch { return null; }
    return { title, start, end: start + 86_400_000, day, startMin: 0, endMin: 1440, category, kind: 'allDay', calendar: event.calendar };
  }
  const start = Date.parse(event.start);
  const end = event.end ? Date.parse(event.end) : start + 30 * 60000;
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const day = dayKey(start, tz);
  const startMin = minutesInto(day, start, tz);
  return { title, start, end, day, startMin, endMin: startMin + Math.round((end - start) / 60000), category, kind: 'event', calendar: event.calendar };
}

/** Every block of the week, by day, each day sorted by start. Days with nothing are present and empty. */
export function blocksForWeek(shifts: PbsShift[], events: CalendarEvent[], week: Week, tz = SCHEDULE_TZ): Map<string, Block[]> {
  const byDay = new Map<string, Block[]>(week.days.map((d) => [d, []]));
  const put = (b: Block | null) => { if (b) byDay.get(b.day)?.push(b); };
  for (const shift of shifts) {
    let blocks: Block[];
    try { blocks = expandShift(shift, tz); } catch { continue; }
    for (const b of blocks) put(b);
  }
  for (const event of events) put(blockFromEvent(event, tz));
  for (const list of byDay.values()) list.sort((a, b) => a.start - b.start || a.end - b.end);
  return byDay;
}

// ── Rules ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Blocks that touch 23:00–07:30 local. An all-day event never does. The tail of a shift's chain
 * (the drive home, the decompress) may run to 23:30 and is the one bend (§5); anything later, or
 * anything else, is flagged.
 */
export function violations(blocks: Iterable<Block>): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.kind === 'allDay') continue;
    const tail = b.kind === 'chain' && (b.title.startsWith('🛋') || b.title.startsWith('🚗 HOME'));
    const bend = tail && b.endMin <= SHIFT_NIGHT_BEND_MIN;
    const late = b.endMin > QUIET_START_MIN && !bend;
    const early = b.startMin < QUIET_END_MIN;
    if (late || early) out.push(b);
  }
  return out;
}

/** Scheduled hours per budget category (all-day events count for nothing). */
export function hoursByCategory(blocks: Iterable<Block>): Record<BudgetCategory, number> {
  const out: Record<BudgetCategory, number> = { income: 0, pbs: 0, stream: 0, hobbies: 0, upkeep: 0 };
  for (const b of blocks) {
    if (b.kind === 'allDay') continue;
    if (b.category in out) out[b.category as BudgetCategory] += (b.end - b.start) / 3_600_000;
  }
  for (const k of BUDGET_CATEGORIES) out[k] = Math.round(out[k] * 100) / 100;
  return out;
}

/** True when the day carries an `⛔ OFF DAY` all-day event. */
export function isOffDay(blocks: readonly Block[]): boolean {
  return blocks.some((b) => b.kind === 'allDay' && b.category === 'off');
}

/** The day's anchors: shifts, the stream's LIVE block, the off-day mark, one-shots. Not habits. */
export function anchorsOf(blocks: readonly Block[]): Block[] {
  return blocks.filter((b) =>
    b.kind === 'shift' ||
    (b.kind === 'allDay' && b.category === 'off') ||
    (b.category === 'stream' && b.title.startsWith('🔴')) ||
    b.title.startsWith('‼️') || b.title.startsWith('‼'));
}

/** `Thu Oct 1` for a day key. */
export function dayLabel(day: string, tz = SCHEDULE_TZ): string {
  const p = zonedParts(zonedToMs(day, '12:00', tz), tz);
  return `${WEEKDAYS[p.weekday]} ${MONTHS[p.month - 1]} ${p.day}`;
}

/** One console line per day, anchors only, as the secretary reads a week back. */
export function readbackLine(day: string, blocks: readonly Block[], tz = SCHEDULE_TZ): string {
  const anchors = anchorsOf(blocks);
  const text = anchors.length
    ? anchors.map((b) => (b.kind === 'allDay' ? b.title : `${clock(hhmm(b.startMin))} ${b.title}${b.estimated ? ' (estimated)' : ''}`)).join('  |  ')
    : '—';
  return `${dayLabel(day, tz).padEnd(10)}  ${text}`;
}

// ── The morning card ────────────────────────────────────────────────────────────────────────────

export interface TodayCard {
  day: string;
  blocks: readonly Block[];
  /** `EARN 4 days · Reading 12 days`, or absent when nobody has counted. */
  streak?: string;
}

/**
 * The four lines of specs/notification-copy.md: TODAY, KEYSTONE (the first income block),
 * ANCHOR (the first shift or live stream, with the chain head for a shift), STREAK.
 */
export function renderTodayMd(card: TodayCard, tz = SCHEDULE_TZ): string {
  const timed = card.blocks.filter((b) => b.kind !== 'allDay');
  const keystone = timed.find((b) => b.category === 'income');
  const anchor = timed.find((b) => b.kind === 'shift') ?? timed.find((b) => b.category === 'stream' && b.title.startsWith('🔴'));
  const off = isOffDay(card.blocks);
  const keystoneLine = off ? '⛔ OFF DAY · nothing owed' : keystone ? `${hhmm(keystone.startMin)} ${keystone.title}` : '—';
  let anchorLine = '—';
  if (anchor && anchor.kind === 'shift') {
    const head = timed.find((b) => b.kind === 'chain' && b.title.startsWith('🚿'));
    const body = anchor.title.replace(/^📺 PBS [^·]*·\s*/, '📺 PBS · ').replace(/ · [A-Z]{2,5}$/, '');
    anchorLine = `${hhmm(anchor.startMin)} ${body}${head ? ` · shower ${hhmm(head.startMin)}` : ''}`;
  } else if (anchor) {
    anchorLine = `${hhmm(anchor.startMin)} ${anchor.title}`;
  }
  return [
    `TODAY ${dayLabel(card.day, tz)}`,
    `KEYSTONE  ${keystoneLine}`,
    `ANCHOR    ${anchorLine}`,
    `STREAK    ${card.streak ?? '—'}`
  ].join('\n') + '\n';
}

// ── The week preview ────────────────────────────────────────────────────────────────────────────

export interface WeekHtmlInput {
  week: Week;
  byDay: Map<string, Block[]>;
  /** Today's key, so the column is highlighted and the NOW line has a home. */
  today: string;
  /** The four-line card for tomorrow, rendered already. */
  tomorrowCard: string;
  /** Habit titles from habits.json, for the legend. */
  habitTitles?: readonly string[];
  /** The last few lines of changes.log.jsonl, newest last. */
  changes?: readonly string[];
  generatedAt?: number;
}

const DAY_START_MIN = 7 * 60;
const DAY_END_MIN = 24 * 60;
const DAY_SPAN = DAY_END_MIN - DAY_START_MIN;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

function pct(min: number): string {
  const clamped = Math.min(DAY_END_MIN, Math.max(DAY_START_MIN, min));
  return `${(((clamped - DAY_START_MIN) / DAY_SPAN) * 100).toFixed(3)}%`;
}

/** The whole page. Static, dark, no network, no external asset; the two scripts are inline. */
export function renderWeekHtml(input: WeekHtmlInput, tz = SCHEDULE_TZ): string {
  const { week, byDay, today } = input;
  const all = [...byDay.values()].flat();
  const bad = new Set(violations(all));
  const hours = hoursByCategory(all);
  const generated = input.generatedAt ?? Date.now();
  const gp = zonedParts(generated, tz);

  const hourRows: string[] = [];
  for (let m = DAY_START_MIN; m < DAY_END_MIN; m += 30) {
    hourRows.push(`<div class="hr${m % 60 ? ' half' : ''}" style="top:${pct(m)}"><span>${m % 60 ? '' : hhmm(m)}</span></div>`);
  }

  const columns = week.days.map((day, i) => {
    const blocks = byDay.get(day) ?? [];
    const off = isOffDay(blocks);
    const allDay = blocks.filter((b) => b.kind === 'allDay');
    const timed = blocks.filter((b) => b.kind !== 'allDay');
    const items = timed.map((b) => {
      const top = pct(b.startMin);
      const bottom = pct(Math.max(b.endMin, b.startMin + 5));
      const classes = ['blk', b.kind, b.category, bad.has(b) ? 'bad' : '', b.estimated ? 'est' : ''].filter(Boolean).join(' ');
      const colour = b.kind === 'chain' ? CHAIN_COLOUR : CATEGORY_COLOURS[b.category];
      const label = `${hhmm(b.startMin)}–${hhmm(b.endMin)} ${b.title}${b.calendar ? ` (${b.calendar})` : ''}`;
      return `<div class="${classes}" style="top:${top};bottom:calc(100% - ${bottom});--c:${colour}" title="${escapeHtml(label)}"><span>${escapeHtml(b.title)}</span></div>`;
    }).join('');
    const marks = allDay.map((b) => `<div class="allday ${b.category}">${escapeHtml(b.title)}</div>`).join('');
    return `<section class="day${day === today ? ' today' : ''}${off ? ' off' : ''}" data-day="${day}" data-i="${i}">` +
      `<header><b>${escapeHtml(dayLabel(day, tz))}</b>${marks}</header>` +
      `<div class="grid">${hourRows.join('')}${items}${day === today ? '<div class="now" id="now"></div>' : ''}</div>` +
      `</section>`;
  }).join('');

  const totalPlanned = BUDGET_CATEGORIES.reduce((s, k) => s + hours[k], 0);
  const bar = BUDGET_CATEGORIES.map((k) => {
    const w = totalPlanned ? (hours[k] / totalPlanned) * 100 : 0;
    return `<i class="${k}" style="width:${w.toFixed(2)}%;--c:${CATEGORY_COLOURS[k]}" title="${k} ${hours[k]} h of ${HOUR_BUDGET[k]}"></i>`;
  }).join('');
  const budgetText = BUDGET_CATEGORIES.map((k) => `${k} ${hours[k]}/${HOUR_BUDGET[k]}`).join(' · ');
  const violationList = [...bad].map((b) => `<li>${escapeHtml(dayLabel(b.day, tz))} ${hhmm(b.startMin)}–${hhmm(b.endMin)} ${escapeHtml(b.title)}</li>`).join('');
  const legend = (input.habitTitles ?? []).map((t) => `<span class="lg ${categoryOf(t)}" style="--c:${CATEGORY_COLOURS[categoryOf(t)]}">${escapeHtml(t)}</span>`).join('');
  const changes = (input.changes ?? []).slice(-5).map((c) => `<li>${escapeHtml(c)}</li>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Week ${escapeHtml(week.start)} → ${escapeHtml(week.end)}</title>
<style>
:root{--bg:#0f1214;--ink:#e6e6e6;--dim:#8a9096;--line:#22282c;--today:#16282c;--bad:#ff3b3b;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.3 system-ui,Segoe UI,Roboto,sans-serif}
header.top{padding:12px 16px;border-bottom:1px solid var(--line);display:flex;flex-wrap:wrap;gap:8px 24px;align-items:center}
header.top h1{font-size:16px;margin:0;font-weight:600}
.bar{display:flex;height:10px;width:min(480px,100%);background:#1b2024;border-radius:2px;overflow:hidden}
.bar i{display:block;height:100%;background:var(--c)}
.budget{color:var(--dim);font-size:12px}
.week{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--line);margin:0}
.day{background:var(--bg);min-width:0}
.day header{padding:6px 6px 4px;border-bottom:1px solid var(--line);font-size:12px;min-height:44px}
.day header b{display:block}
.day.today{background:var(--today)}
.day.off .grid{background:repeating-linear-gradient(135deg,transparent 0 8px,#2a1a1a 8px 10px)}
.allday{display:inline-block;margin-top:3px;padding:1px 4px;border-radius:2px;background:#26282c;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.allday.off{background:#3a1212;color:#ff8a80;font-weight:600}
.grid{position:relative;height:1020px}
.hr{position:absolute;left:0;right:0;border-top:1px solid var(--line);font-size:10px;color:var(--dim)}
.hr.half{border-top-color:#191d20}
.hr span{position:absolute;left:2px;top:-7px;background:inherit;padding-right:2px}
.blk{position:absolute;left:14px;right:3px;background:color-mix(in srgb,var(--c) 22%,#0f1214);border-left:3px solid var(--c);border-radius:2px;padding:1px 4px;font-size:11px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.blk.chain{left:14px;right:18px;font-size:9px;padding:0 3px;line-height:1.1;background:color-mix(in srgb,var(--c) 45%,#0f1214);border-left-width:6px}
.blk.shift{font-weight:600}
.blk.est{border-left-style:dashed}
.blk.bad{outline:2px solid var(--bad);outline-offset:-1px}
.now{position:absolute;left:0;right:0;border-top:2px solid #ff5252;display:none}
.now::before{content:"NOW";position:absolute;right:2px;top:-14px;font-size:9px;color:#ff5252}
footer{padding:12px 16px;border-top:1px solid var(--line);color:var(--dim);font-size:12px;display:grid;gap:12px;grid-template-columns:1fr 1fr}
footer pre{margin:0;color:var(--ink);font:12px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap}
footer ul{margin:4px 0 0;padding-left:18px}
.violations{color:#ff8a80}
.legend{display:flex;flex-wrap:wrap;gap:4px 8px}
.lg{border-left:3px solid var(--c);padding-left:4px;font-size:11px}
.switch{display:none;gap:8px;align-items:center;padding:8px 16px;border-bottom:1px solid var(--line)}
.switch button{background:#1b2024;color:var(--ink);border:1px solid var(--line);padding:6px 12px;border-radius:3px;font-size:14px}
@media (max-width:400px){
  .week{display:block}
  .day{display:none}
  .day.shown{display:block}
  .switch{display:flex}
  footer{grid-template-columns:1fr}
}
</style>
</head>
<body>
<header class="top">
  <h1>${escapeHtml(dayLabel(week.start, tz))} → ${escapeHtml(dayLabel(week.end, tz))}</h1>
  <div class="bar" title="${escapeHtml(budgetText)}">${bar}</div>
  <div class="budget">hours: ${escapeHtml(budgetText)} · planned ${totalPlanned.toFixed(2)} h</div>
  <div class="budget">generated ${gp.year}-${String(gp.month).padStart(2, '0')}-${String(gp.day).padStart(2, '0')} ${hhmm(gp.hour * 60 + gp.minute)} ${escapeHtml(tz)}</div>
</header>
<nav class="switch"><button type="button" id="prev">‹</button><b id="dayname"></b><button type="button" id="next">›</button></nav>
<main class="week">${columns}</main>
<footer>
  <div><b>Tomorrow</b><pre>${escapeHtml(input.tomorrowCard)}</pre></div>
  <div>
    ${bad.size ? `<div class="violations"><b>23:00–07:30 violations (${bad.size})</b><ul>${violationList}</ul></div>` : '<div>No block touches 23:00–07:30.</div>'}
    ${changes ? `<div><b>Last changes</b><ul>${changes}</ul></div>` : ''}
    ${legend ? `<div class="legend">${legend}</div>` : ''}
  </div>
</footer>
<script>
(function(){
  var tz=${JSON.stringify(tz)}, start=${DAY_START_MIN}, span=${DAY_SPAN};
  function place(){
    var now=document.getElementById('now'); if(!now) return;
    try{
      var p=new Intl.DateTimeFormat('en-US',{timeZone:tz,hourCycle:'h23',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date());
      var h=0,m=0; p.forEach(function(x){ if(x.type==='hour') h=Number(x.value)%24; if(x.type==='minute') m=Number(x.value); });
      var min=h*60+m; if(min<start||min>=start+span){ now.style.display='none'; return; }
      now.style.display='block'; now.style.top=((min-start)/span*100)+'%';
    }catch(e){ now.style.display='none'; }
  }
  place(); setInterval(place,60000);
  var days=[].slice.call(document.querySelectorAll('.day')), i=days.findIndex(function(d){return d.classList.contains('today')}); if(i<0) i=0;
  var name=document.getElementById('dayname');
  function show(){ days.forEach(function(d,k){ d.classList.toggle('shown',k===i); }); var b=days[i]&&days[i].querySelector('header b'); if(name&&b) name.textContent=b.textContent; }
  var prev=document.getElementById('prev'), next=document.getElementById('next');
  if(prev) prev.addEventListener('click',function(){ i=(i+6)%7; show(); });
  if(next) next.addEventListener('click',function(){ i=(i+1)%7; show(); });
  show();
})();
</script>
</body>
</html>
`;
}
