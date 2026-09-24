import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { recordVisit, visitCounts, visitKey, type VisitLog } from '@shared/matrix.js';

/**
 * How often each node has been opened, for the MATRIX: a file floats higher above the globe the more it is
 * visited (packages/shared/matrix.ts, `hoverHeight`).
 *
 * Kept in the user data folder beside skynet.db, not in the board JSON. A board describes the machine; how
 * often William opens a file is a fact about William, and it would churn the board file on every click.
 * Only an open made through SkynetOS is counted, and only a count and the time of the last one are kept.
 */

const file = (): string => join(app.getPath('userData'), 'visits.json');

let cached: VisitLog | null = null;
/** A visits file that could not be read is left exactly as it is: a fresh count must never overwrite it. */
let unreadable = false;

function load(): VisitLog {
  if (cached) return cached;
  try {
    const parsed: unknown = existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) : {};
    cached = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as VisitLog) : {};
  } catch (err) {
    console.error(`[visits] ${file()} could not be read (${(err as Error).message}) — counting in memory only until it is fixed`);
    unreadable = true;
    cached = {};
  }
  return cached;
}

export function noteVisit(boardId: string, nodeId: string): void {
  cached = recordVisit(load(), visitKey(boardId, nodeId), new Date());
  if (unreadable) return;
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(file(), JSON.stringify(cached, null, 2) + '\n', 'utf8');
  } catch (err) {
    console.error(`[visits] could not write ${file()}: ${(err as Error).message}`);
  }
}

export function readVisits(): Record<string, number> {
  return visitCounts(load());
}
