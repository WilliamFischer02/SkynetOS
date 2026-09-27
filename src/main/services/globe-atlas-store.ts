import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { coordFor, type GlobeCoord } from '@shared/globe-atlas.js';
import { normalisePath } from '@shared/usage.js';

/**
 * The pins the hologram has already shown, remembered.
 *
 * `coordFor` is a pure function of the path, so this store is not needed for two runs to agree.
 * It exists so that a later change to that function can never move a pin William has learned:
 * the first answer for a path is the answer for good. Kept in userData beside visits.json, because
 * which files have been touched on this machine is a fact about this machine.
 */

interface Pin extends GlobeCoord { firstSeen: number }
type Atlas = Record<string, Pin>;

export const ATLAS_CAP = 20_000;
const WRITE_DELAY_MS = 2_000;

const file = (): string => join(app.getPath('userData'), 'globe-atlas.json');

let cached: Atlas | null = null;
let unreadable = false;
let dirty = false;
let timer: NodeJS.Timeout | null = null;

function load(): Atlas {
  if (cached) return cached;
  try {
    const parsed: unknown = existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) : {};
    cached = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Atlas) : {};
  } catch (err) {
    console.error(`[globe-atlas] ${file()} could not be read (${(err as Error).message}) — pins are computed only until it is fixed`);
    unreadable = true;
    cached = {};
  }
  return cached;
}

function flush(): void {
  timer = null;
  if (!dirty || unreadable || !cached) return;
  dirty = false;
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(file(), JSON.stringify(cached) + '\n', 'utf8');
  } catch (err) {
    console.error(`[globe-atlas] could not write ${file()}: ${(err as Error).message}`);
  }
}

function scheduleWrite(): void {
  dirty = true;
  if (timer) return;
  timer = setTimeout(flush, WRITE_DELAY_MS);
}

/** Only above the cap, and only the oldest. */
function evict(atlas: Atlas): void {
  const keys = Object.keys(atlas);
  if (keys.length <= ATLAS_CAP) return;
  keys.sort((a, b) => (atlas[a]?.firstSeen ?? 0) - (atlas[b]?.firstSeen ?? 0));
  for (const key of keys.slice(0, keys.length - ATLAS_CAP)) delete atlas[key];
}

/** The pin for a path: the remembered one, or a new one that is remembered from now on. */
export function pinFor(path: string, now = Date.now()): GlobeCoord {
  const key = normalisePath(path);
  const atlas = load();
  const known = atlas[key];
  if (known) return { lat: known.lat, lon: known.lon };
  const coord = coordFor(key);
  atlas[key] = { ...coord, firstSeen: now };
  evict(atlas);
  scheduleWrite();
  return coord;
}

export function atlasSize(): number {
  return Object.keys(load()).length;
}

/** will-quit: write what is pending. */
export function flushAtlas(): void {
  if (timer) clearTimeout(timer);
  flush();
}
