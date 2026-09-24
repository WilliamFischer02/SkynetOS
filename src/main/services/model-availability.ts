import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  decideFable,
  limitEventFrom,
  type FableStatus,
  type LaunchModel,
  type LimitEvent
} from '@shared/model-availability.js';
import { claudeProjectsDir } from './conversations.js';
import { getSettings } from './settings.js';

/**
 * Reading Fable's availability off this machine's transcripts. What is recorded and how it is read
 * is in packages/shared/model-availability.ts; this is only the scanning.
 *
 * ── Cost ──────────────────────────────────────────────────────────────────────────────────────
 *
 * A launch asks for this, and transcripts run to tens of megabytes, so:
 *
 *   - Only files touched in the last fortnight are read. An outage older than that is over.
 *   - Only lines that contain `"rate_limit"` or a Fable model name are parsed at all.
 *   - Each file's result is cached against its mtime and size, so a re-check after nothing changed
 *     costs one stat per recent file.
 *   - The whole answer is cached for 15 s.
 */

const LOOKBACK_MS = 14 * 24 * 3600_000;
const TTL_MS = 15_000;

interface FileScan {
  mtimeMs: number;
  size: number;
  limits: LimitEvent[];
  lastFableReply: number | null;
}

const scans = new Map<string, FileScan>();
let evidenceCache: { at: number; limit: LimitEvent | null; lastFableReply: number | null } | null = null;

/** The machine's own zone, for a refusal whose text gives a clock time without naming a zone. */
function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function scanFile(path: string, zone: string): Omit<FileScan, 'mtimeMs' | 'size'> {
  const limits: LimitEvent[] = [];
  let lastFableReply: number | null = null;
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { limits, lastFableReply };
  }
  for (const line of text.split('\n')) {
    if (line.includes('"rate_limit"')) {
      try {
        const event = limitEventFrom(JSON.parse(line), zone);
        if (event) limits.push(event);
      } catch { /* a torn line at the end of a file being written */ }
      continue;
    }
    // A real Fable reply: an assistant record, carrying usage, that is not an error.
    if (line.includes('"model":"claude-fable') && line.includes('"usage"') && !line.includes('"isApiErrorMessage":true')) {
      const at = Date.parse(/"timestamp":"([^"]+)"/.exec(line)?.[1] ?? '');
      if (Number.isFinite(at) && (lastFableReply === null || at > lastFableReply)) lastFableReply = at;
    }
  }
  return { limits, lastFableReply };
}

function gather(now: number): { limit: LimitEvent | null; lastFableReply: number | null } {
  if (evidenceCache && now - evidenceCache.at < TTL_MS) return evidenceCache;

  const zone = localZone();
  const seen = new Set<string>();
  let limit: LimitEvent | null = null;
  let lastFableReply: number | null = null;

  let projects: string[] = [];
  try { projects = readdirSync(claudeProjectsDir()); } catch { /* no Claude Code on this machine yet */ }

  for (const project of projects) {
    const dir = join(claudeProjectsDir(), project);
    let names: string[];
    try { names = readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const name of names) {
      const path = join(dir, name);
      let mtimeMs: number;
      let size: number;
      try { ({ mtimeMs, size } = statSync(path)); } catch { continue; }
      if (now - mtimeMs > LOOKBACK_MS) continue;
      seen.add(path);

      let scan = scans.get(path);
      if (!scan || scan.mtimeMs !== mtimeMs || scan.size !== size) {
        scan = { mtimeMs, size, ...scanFile(path, zone) };
        scans.set(path, scan);
      }
      for (const event of scan.limits) {
        if (event.fable && (!limit || event.at > limit.at)) limit = event;
      }
      if (scan.lastFableReply !== null && (lastFableReply === null || scan.lastFableReply > lastFableReply)) {
        lastFableReply = scan.lastFableReply;
      }
    }
  }
  for (const path of [...scans.keys()]) if (!seen.has(path)) scans.delete(path);

  evidenceCache = { at: now, limit, lastFableReply };
  return evidenceCache;
}

/** Is Fable available right now, and what should a new session ask for. */
export function fableStatus(now = Date.now()): FableStatus {
  const settings = getSettings();
  const typed = settings.fableResetsAt ? Date.parse(settings.fableResetsAt) : NaN;
  const { limit, lastFableReply } = gather(now);
  return decideFable(
    { limit, lastFableReply, overrideResetsAt: Number.isFinite(typed) ? typed : null },
    now,
    settings.autoModel !== false
  );
}

/**
 * What a launch asks for right now, or null to leave it to Claude Code's own default.
 *
 * Never throws and never blocks a launch: a failure to read the transcripts falls back to the
 * CLI's own default model rather than stopping the terminal from opening.
 */
export function launchModelNow(): LaunchModel | null {
  try {
    return fableStatus().launch;
  } catch (err) {
    console.warn(`[models] could not decide a launch model: ${(err as Error).message}`);
    return null;
  }
}

/** Drop every cached reading. After the restart time is typed, so the meter reflects it at once. */
export function clearModelCache(): void {
  evidenceCache = null;
}
