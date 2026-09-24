/**
 * Which model a new Claude Code session gets, and why.
 *
 * William: "if fable 5 is disabled as a default model (out of usage credits - develop a system to
 * check) all terminals should switch to opus 5 automatically … when deadline is reached all
 * terminals should now switch back to defaulting to claude fable 5.1, high effort -- as mentioned
 * otherwise opus 5 xhigh."
 *
 * ── What this machine actually records ────────────────────────────────────────────────────────
 *
 * Claude Code writes a refused request into the conversation transcript as an assistant record
 * with `isApiErrorMessage: true`, `error: "rate_limit"` and `apiErrorStatus: 429`. Two shapes were
 * found on William-Desktop:
 *
 *   - Fable out of usage credits (2026-09-11). The text is "You're out of usage credits. Run
 *     /usage-credits to keep using Fable 5.1 or /model to switch models." It records NO reset
 *     time and no `quotaLimits`.
 *   - A five-hour session limit (2026-09-08). The text is "You've hit your session limit · resets
 *     8:40pm (America/Denver)", with `quotaLimits.resetsAt` in epoch seconds (1788835200, which
 *     is 8:40pm MDT).
 *
 * So Fable being offline IS recorded, but the time it comes back often is not: the "8pm Monday"
 * the CLI shows is not written anywhere on disk. The reset time is therefore taken, in order:
 * `quotaLimits.resetsAt` when the record carries it, a "resets …" phrase in the record's own text,
 * or a time William typed into SkynetOS. A guess is never taken. With none of the three, the
 * countdown says UNKNOWN.
 *
 * Fable counts as back when the reset time passes, or as soon as any conversation on this machine
 * gets a real Fable reply after the refusal. Credits bought early are the second case.
 *
 * Pure: no fs, no Electron. test/model-availability.test.ts holds it.
 */

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface LaunchModel {
  /** Passed as `claude --model`. */
  model: string;
  /** Passed as `claude --effort`. The CLI accepts low, medium, high, xhigh, max. */
  effort: Effort;
  /** Passed as `claude --fallback-model`, so the CLI itself can step down mid-session if it can. */
  fallback?: string;
  /** How the meter names it. */
  label: string;
}

export const FABLE_MODEL = 'claude-fable-5-1';
export const OPUS_MODEL = 'claude-opus-5';

/** Fable 5.1 at high effort, with Opus named as the CLI's own fallback. */
export const PRIMARY: LaunchModel = { model: FABLE_MODEL, effort: 'high', fallback: OPUS_MODEL, label: 'FABLE 5.1 · HIGH' };
/** Opus 5 at xhigh, while Fable is out. */
export const FALLBACK: LaunchModel = { model: OPUS_MODEL, effort: 'xhigh', label: 'OPUS 5 · XHIGH' };

/** One refused request, as the transcript recorded it. */
export interface LimitEvent {
  /** When it was refused, epoch ms. */
  at: number;
  /** The refusal names Fable: it is Fable that is out, not everything. */
  fable: boolean;
  /** When the limit lifts, epoch ms, if the record says. */
  resetsAt: number | null;
  /** The CLI's own words. */
  text: string;
  /** `quotaLimits.rateLimitType` when present (`five_hour`, …). */
  rateLimitType: string | null;
}

export interface FableEvidence {
  /** The newest refusal that names Fable, from the last fortnight of transcripts. */
  limit: LimitEvent | null;
  /** The newest real Fable reply on this machine, epoch ms. */
  lastFableReply: number | null;
  /** A restart time William typed into SkynetOS, epoch ms. */
  overrideResetsAt: number | null;
}

export interface FableStatus {
  state: 'online' | 'offline';
  /** When Fable went out, epoch ms. Null while online. */
  since: number | null;
  /** When it comes back, epoch ms. Null while online, or when nothing says. */
  resetsAt: number | null;
  /** Where `resetsAt` came from. */
  resetSource: 'recorded' | 'setting' | null;
  /** The CLI's words for the refusal that decided this, if any. */
  evidence: string | null;
  /** What a launch asks for right now. Null when automatic model choice is switched off. */
  launch: LaunchModel | null;
  auto: boolean;
  checkedAt: number;
}

/* ────────────────────────── time zones, without a library ────────────────────────── */

interface ZonedParts { year: number; month: number; day: number; hour: number; minute: number; second: number }

function zonedParts(ms: number, zone: string): ZonedParts {
  const format = (tz: string) => new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'
  });
  let formatter: Intl.DateTimeFormat;
  try { formatter = format(zone); } catch { formatter = format('UTC'); }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return {
    year: Number(parts['year']), month: Number(parts['month']), day: Number(parts['day']),
    hour: Number(parts['hour']) % 24, minute: Number(parts['minute']), second: Number(parts['second'])
  };
}

/** The zone's offset from UTC at an instant, in ms. */
function offsetAt(ms: number, zone: string): number {
  const p = zonedParts(ms, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (ms - (((ms % 1000) + 1000) % 1000));
}

/** A wall-clock time in a zone, as an instant. Checked twice, so a DST change the same day lands right. */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, zone: string): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = offsetAt(guess, zone);
  let result = guess - first;
  const second = offsetAt(result, zone);
  if (second !== first) result = guess - second;
  return result;
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * The next instant after `after` that a phrase like the CLI's names.
 *
 * Understands `resets 8:40pm (America/Denver)`, `8pm Monday`, `Mon 8:00pm` and the like: a clock
 * time with am/pm, an optional weekday, and an optional IANA zone in brackets. Without a zone it
 * uses `defaultZone`, which is the machine's own. Null for anything it does not understand, never
 * a best guess.
 */
export function parseResetText(text: string, after: number, defaultZone: string): number | null {
  const zone = /\(([A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+|UTC)\)/.exec(text)?.[1] ?? defaultZone;
  const lower = text.toLowerCase();
  const clock = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(lower);
  if (!clock) return null;
  const hour12 = Number(clock[1]);
  const minute = clock[2] ? Number(clock[2]) : 0;
  if (hour12 < 1 || hour12 > 12 || minute > 59) return null;
  const hour = (hour12 % 12) + (clock[3] === 'pm' ? 12 : 0);

  const day = /\b(sun|mon|tue|wed|thu|fri|sat)(?:day|sday|nesday|urday|rsday|s)?\b/.exec(lower)?.[1];
  const targetDay = day ? DAYS.indexOf(day) : null;

  const today = zonedParts(after, zone);
  for (let add = 0; add < 8; add++) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + add));
    if (targetDay !== null && date.getUTCDay() !== targetDay) continue;
    const at = zonedTimeToUtc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), hour, minute, zone);
    if (at > after) return at;
  }
  return null;
}

/* ────────────────────────── reading the transcript ────────────────────────── */

/** Every text block of a transcript message, joined. */
function messageText(record: Record<string, unknown>): string {
  const message = record['message'] as { content?: unknown } | undefined;
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => (b && typeof b === 'object' && (b as { type?: unknown }).type === 'text' ? String((b as { text?: unknown }).text ?? '') : ''))
    .filter(Boolean)
    .join(' ');
}

/**
 * A refused request, from one parsed transcript line, or null for anything else.
 *
 * `zone` is used only when the text gives a clock time without naming its zone.
 */
export function limitEventFrom(record: unknown, zone: string): LimitEvent | null {
  if (!record || typeof record !== 'object') return null;
  const r = record as Record<string, unknown>;
  if (r['isApiErrorMessage'] !== true || r['error'] !== 'rate_limit') return null;
  const at = Date.parse(String(r['timestamp'] ?? ''));
  if (!Number.isFinite(at)) return null;

  const text = messageText(r).trim();
  const quota = r['quotaLimits'] as { resetsAt?: unknown; rateLimitType?: unknown } | undefined;
  const raw = typeof quota?.resetsAt === 'number' && Number.isFinite(quota.resetsAt) ? quota.resetsAt : null;
  // Epoch seconds as recorded; tolerate milliseconds rather than land in 1970.
  const recorded = raw === null ? null : raw < 1e12 ? raw * 1000 : raw;
  const resetsAt = recorded ?? (/\bresets?\b/i.test(text) ? parseResetText(text, at, zone) : null);

  return {
    at,
    fable: /\bfable\b/i.test(text),
    resetsAt,
    text,
    rateLimitType: typeof quota?.rateLimitType === 'string' ? quota.rateLimitType : null
  };
}

/* ────────────────────────── the decision ────────────────────────── */

/**
 * Is Fable out right now, until when, and what should a launch ask for?
 *
 * Out when the newest refusal naming Fable is newer than the newest real Fable reply AND its reset
 * time, if known, has not passed. A typed restart time counts only if it is later than that
 * refusal, so a time left over from an earlier outage can never decide this one.
 */
export function decideFable(evidence: FableEvidence, now: number, auto = true): FableStatus {
  const { limit, lastFableReply, overrideResetsAt } = evidence;
  const blocked = limit !== null && (lastFableReply === null || lastFableReply < limit.at);

  let resetsAt: number | null = null;
  let resetSource: FableStatus['resetSource'] = null;
  if (blocked && limit) {
    if (limit.resetsAt !== null) { resetsAt = limit.resetsAt; resetSource = 'recorded'; }
    else if (overrideResetsAt !== null && overrideResetsAt > limit.at) { resetsAt = overrideResetsAt; resetSource = 'setting'; }
  }

  const offline = blocked && (resetsAt === null || now < resetsAt);
  return {
    state: offline ? 'offline' : 'online',
    since: offline && limit ? limit.at : null,
    resetsAt: offline ? resetsAt : null,
    resetSource: offline ? resetSource : null,
    evidence: limit?.text || null,
    launch: auto ? (offline ? FALLBACK : PRIMARY) : null,
    auto,
    checkedAt: now
  };
}

/** A countdown as `HHH:MM:SS`. Hours are at least three digits, because an outage can last days. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(3, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
