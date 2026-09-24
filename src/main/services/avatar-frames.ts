import { existsSync, mkdirSync, readdirSync, readFileSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import {
  AVATAR_ROOT_REL,
  DEFAULT_AVATAR,
  parseFrameNames,
  pngSize,
  readTiming,
  type AvatarFrameSet,
  type AvatarPayload
} from '@shared/avatar.js';

export type { AvatarPayload };
import { expandPath } from './target-resolver.js';

/**
 * The avatar's frames, read from disk. See packages/shared/avatar.ts for what the names mean.
 *
 * The frames are handed to the windows and the board as data URLs, which is how every other
 * image reaches the renderer here: the renderer has no filesystem and its CSP loads no file://.
 * They are small, pixel-art PNGs, so a whole set is a few hundred KB at most.
 *
 * Read on demand and cached until the folder changes. A watcher on the folder clears the cache
 * and tells listeners, so frames William drops in while SkynetOS is open show up without a
 * restart.
 */

const cache = new Map<string, AvatarPayload>();
const watchers = new Map<string, FSWatcher>();
const listeners = new Set<(name: string) => void>();

function safeName(name: string | undefined): string {
  const clean = (name ?? DEFAULT_AVATAR).replace(/[^a-zA-Z0-9_-]/g, '');
  return clean || DEFAULT_AVATAR;
}

export function avatarDir(name?: string): string {
  return expandPath(`%SKYNET%/${AVATAR_ROOT_REL}/${safeName(name)}`);
}

/** The frames as data URLs, validated. Never throws: a broken set is `ok: false` with warnings. */
export function loadAvatar(name?: string): AvatarPayload {
  const key = safeName(name);
  const hit = cache.get(key);
  if (hit) return hit;

  const dir = avatarDir(key);
  const empty: AvatarPayload = {
    name: key, dir, ok: false, width: 0, height: 0, idle: null, blink: [], talk: [],
    timing: readTiming(null), warnings: []
  };
  if (!existsSync(dir)) {
    const result = { ...empty, warnings: [`no frames folder at ${dir}`] };
    cache.set(key, result);
    return result;
  }

  let files: string[] = [];
  try { files = readdirSync(dir); } catch (err) { return { ...empty, warnings: [`cannot read ${dir}: ${(err as Error).message}`] }; }
  const set: AvatarFrameSet = parseFrameNames(files);
  let timing = readTiming(null);
  try {
    if (files.includes('avatar.json')) timing = readTiming(JSON.parse(readFileSync(join(dir, 'avatar.json'), 'utf8')));
  } catch (err) {
    set.warnings.push(`avatar.json: ${(err as Error).message}, using defaults`);
  }

  let size: { width: number; height: number } | null = null;
  const toUrl = (file: string): string | null => {
    try {
      const bytes = readFileSync(join(dir, file));
      const dims = pngSize(bytes);
      if (!dims) { set.warnings.push(`${file}: not a readable PNG`); return null; }
      if (!size) size = dims;
      else if (dims.width !== size.width || dims.height !== size.height) {
        set.warnings.push(`${file}: ${dims.width}x${dims.height}, but idle.png is ${size.width}x${size.height} — every frame must be the same size`);
        return null;
      }
      return `data:image/png;base64,${bytes.toString('base64')}`;
    } catch (err) {
      set.warnings.push(`${file}: ${(err as Error).message}`);
      return null;
    }
  };

  // The still face first: it sets the size every other frame is held to.
  const idle = set.idle ? toUrl(set.idle) : null;
  const blink = set.blink.map(toUrl).filter((u): u is string => u !== null);
  const talk = set.talk.map(toUrl).filter((u): u is string => u !== null);
  const dims = size as { width: number; height: number } | null;

  const result: AvatarPayload = {
    name: key,
    dir,
    ok: idle !== null,
    width: dims?.width ?? 0,
    height: dims?.height ?? 0,
    idle,
    blink,
    talk,
    timing,
    warnings: set.warnings
  };
  cache.set(key, result);
  ensureWatch(key, dir);
  return result;
}

function ensureWatch(key: string, dir: string): void {
  if (watchers.has(key)) return;
  try {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const w = watch(dir, () => {
      // Debounced: dropping ten frames in at once is one change, not ten reloads.
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        cache.delete(key);
        for (const listener of listeners) listener(key);
      }, 300);
    });
    w.on('error', () => { watchers.delete(key); });
    watchers.set(key, w);
  } catch { /* an unwatchable folder still loads; it just needs a reopen to refresh */ }
}

/** Called with the avatar's name whenever its folder changes. Returns an unsubscribe. */
export function onAvatarChanged(listener: (name: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Make the default folder exist, so there is always somewhere to drop frames. */
export function ensureAvatarFolder(name?: string): string {
  const dir = avatarDir(name);
  try { mkdirSync(dir, { recursive: true }); } catch { /* reported by loadAvatar */ }
  return dir;
}

export function stopAvatarWatchers(): void {
  for (const w of watchers.values()) w.close();
  watchers.clear();
}
