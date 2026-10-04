/**
 * The hologram's scene producer: what Claude is doing on this machine, as a picture.
 *
 * William, 2026-09-26: "every action Claude takes is aesthetically, visually represented in the
 * JARVIS Voice window … all files, folders and actions are assigned a permanent position on the
 * globe … when Claude accesses one, it is drawn into the centre from its pinned state, its
 * contents maximised, then minimised back when the next one comes."
 *
 * Source: EVERY Claude Code session on this machine, by tailing the transcripts Claude Code
 * itself writes under ~/.claude/projects/<slug>/<uuid>.jsonl (the same files services/usage.ts
 * reads for the meters). Only bytes appended after this feed started are read: history is never
 * replayed, so the globe shows now, not the archive.
 *
 * What it does with a file's CONTENTS: reads it, once, to draw it, and only when it lies under a
 * trusted root (devRoots, the user profile, the data home). A path outside those still gets its
 * pin and its icon, never its text: the globe shows that a system file exists, not what it says.
 * Nothing here writes anywhere but userData/globe-atlas.json (the pins).
 *
 * The rules that pick the centre are pure and tested: packages/shared/activity-events.ts.
 * The renderers are pure and tested: packages/shared/holo-content.ts.
 */
import { app } from 'electron';
import chokidar, { type FSWatcher } from 'chokidar';
import { closeSync, existsSync, openSync, readSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import {
  emptySchedulerState,
  eventsFromMessage,
  schedulePriority,
  tickScheduler,
  type ActivityAccess,
  type SchedulerState,
  type TranscriptLine
} from '@shared/activity-events.js';
import { extensionOf, isSecretPath, kindOf } from '@shared/globe-atlas.js';
import { folderFrom, paperFrom, terminalFrom, wireFrom } from '@shared/holo-content.js';
import { EMPTY_SCENE, accessPriority, type HoloContent, type HoloItem, type HoloScene } from '@shared/holo-scene.js';
import { filterAccesses, filterOrbit, filterScheduler, recentSessions, validSessionFilter, type SeenSession } from '@shared/holo-sessions.js';
import { normalisePath } from '@shared/usage.js';
import { flushAtlas, pinFor } from './globe-atlas-store.js';
import { trustedRoots } from './settings.js';

type SceneListener = (scene: HoloScene) => void;

const TICK_MS = 250;
const ORBIT_CAP = 24;
const CONTENT_CAP_BYTES = 512 * 1024;
const PREVIOUS_TEXT_LRU = 32;
/** How long after an edit is announced before the file is read again for the "after" text. */
const AFTER_EDIT_MS = 1_500;
const FOLDER_TOP = 60;

const listeners = new Set<SceneListener>();
let current: HoloScene = EMPTY_SCENE;

let watcher: FSWatcher | null = null;
let tick: NodeJS.Timeout | null = null;
let afterEdit: NodeJS.Timeout | null = null;
let scheduler: SchedulerState = emptySchedulerState();
let focusedPath: string | null = null;
let focusSince = 0;

/** Bytes already consumed per transcript, and the partial trailing line. */
const offsets = new Map<string, number>();
const partial = new Map<string, string>();
let ready = false;

/** Most recent first. */
const recent = new Map<string, HoloItem>();
const iconCache = new Map<string, string | null>();
const previousText = new Map<string, string>();

export function onScene(cb: SceneListener): () => void {
  listeners.add(cb);
  cb(current);
  return () => { listeners.delete(cb); };
}

export function currentScene(): HoloScene {
  return current;
}

function emit(scene: HoloScene): void {
  current = scene;
  for (const cb of listeners) {
    try { cb(scene); } catch (err) { console.error('[activity] scene listener threw:', (err as Error).message); }
  }
}

/* ────────────────────────── trust ────────────────────────── */

function underTrustedRoot(path: string): boolean {
  const p = normalisePath(path);
  return trustedRoots().some((root) => p === root || p.startsWith(`${root}/`));
}

/* ────────────────────────── icons ────────────────────────── */

async function iconFor(path: string, kind: HoloItem['kind']): Promise<string | undefined> {
  const key = kind === 'exe' || kind === 'folder' ? normalisePath(path) : `.${extensionOf(path)}`;
  if (iconCache.has(key)) return iconCache.get(key) ?? undefined;
  let url: string | null = null;
  try {
    if (existsSync(path)) {
      const image = await app.getFileIcon(path, { size: 'small' });
      if (!image.isEmpty()) url = image.toDataURL();
    }
  } catch { url = null; }
  iconCache.set(key, url);
  return url ?? undefined;
}

/* ────────────────────────── items and contents ────────────────────────── */

function isDirectory(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

function readText(path: string): string | null {
  try {
    const size = statSync(path).size;
    if (size > CONTENT_CAP_BYTES) {
      const fd = openSync(path, 'r');
      try {
        const buf = Buffer.alloc(CONTENT_CAP_BYTES);
        const n = readSync(fd, buf, 0, CONTENT_CAP_BYTES, 0);
        return buf.subarray(0, n).toString('utf8');
      } finally { closeSync(fd); }
    }
    return readFileSync(path, 'utf8');
  } catch { return null; }
}

function rememberText(path: string, text: string): void {
  previousText.delete(path);
  previousText.set(path, text);
  while (previousText.size > PREVIOUS_TEXT_LRU) {
    const oldest = previousText.keys().next().value;
    if (oldest === undefined) break;
    previousText.delete(oldest);
  }
}

async function itemFor(access: ActivityAccess): Promise<HoloItem> {
  const directory = access.directory || isDirectory(access.path);
  const kind = kindOf(access.path, { directory });
  const pin = pinFor(access.path, access.at);
  const name = basename(access.path) || access.path;
  const item: HoloItem = {
    id: access.path,
    path: access.path,
    name,
    kind,
    lat: pin.lat,
    lon: pin.lon,
    priority: accessPriority(kind, access.action),
    lastSeen: access.at
  };
  const icon = await iconFor(access.path, kind);
  if (icon) item.icon = icon;
  return item;
}

/** Models can be large; more than this is drawn as a pin and a name, never read into main. */
const MODEL_CAP_BYTES = 8 * 1024 * 1024;

function contentFor(item: HoloItem, access: ActivityAccess): HoloContent {
  const title = item.name;
  if (!underTrustedRoot(item.path)) return { type: 'none', title };
  // A secret is a secret on a trusted root too: the globe never draws a key or an .env, and in
  // stream mode it would be on camera (docs/07 § Secrets, § Streaming safety).
  if (isSecretPath(item.path)) return { type: 'none', title };
  const ext = extensionOf(item.path);
  switch (item.kind) {
    case 'folder': {
      try {
        const entries = readdirSync(item.path, { withFileTypes: true }).slice(0, FOLDER_TOP * 2)
          .map((e) => ({ name: e.name, kind: kindOf(e.name, { directory: e.isDirectory() }) }));
        return folderFrom(entries, title);
      } catch { return { type: 'none', title }; }
    }
    case 'doc': {
      if (ext === 'pdf' || ext === 'docx' || ext === 'doc') {
        let size = 0;
        try { size = statSync(item.path).size; } catch { /* absent */ }
        return { type: 'paper', title, scrollFrom: 0, lines: [title, '', `[${ext.toUpperCase()}, ${Math.max(1, Math.round(size / 1024))} KB]`] };
      }
      const text = readText(item.path);
      if (text === null) return { type: 'none', title };
      rememberText(item.path, text);
      return paperFrom(text, title);
    }
    case 'code': {
      const text = readText(item.path);
      if (text === null) return { type: 'none', title };
      const before = access.action === 'edit' || access.action === 'write' ? (previousText.get(item.path) ?? text) : text;
      rememberText(item.path, text);
      return terminalFrom(before, text, title, ext);
    }
    case 'model': {
      try {
        if (statSync(item.path).size > MODEL_CAP_BYTES) return { type: 'none', title };
        const bytes = new Uint8Array(readFileSync(item.path));
        return wireFrom(bytes, ext, title);
      } catch { return { type: 'none', title }; }
    }
    default:
      return { type: 'none', title };
  }
}

function sessionCaption(access: ActivityAccess, cwd: string | undefined): string | undefined {
  const dir = cwd ? basename(cwd.replace(/[\\/]+$/, '')) : '';
  const id = access.session ? access.session.slice(0, 8) : '';
  return [dir, id].filter(Boolean).join(' · ') || undefined;
}

/* ────────────────────────── the scene ────────────────────────── */

const cwdBySession = new Map<string, string>();

/*
 * The session picker (2026-09-27, packages/shared/holo-sessions.ts). Every session that writes an
 * assistant line is remembered with its cwd and when; every item that reaches the centre remembers
 * which sessions put it there. A filter narrows what the scheduler is offered and what the orbit
 * keeps; it never changes what is tailed.
 */
const seenSessions = new Map<string, SeenSession>();
const touchedBy = new Map<string, Set<string>>();
let sessionFilter: string | null = null;
let sessionsKey = '';

function sessionsNow(): HoloScene['sessions'] {
  const list = recentSessions(seenSessions, Date.now(), sessionFilter);
  sessionsKey = list.map((x) => x.id).join('|');
  return list;
}

function orbitOf(items: HoloItem[]): HoloItem[] {
  return filterOrbit(items, touchedBy, sessionFilter).slice(0, ORBIT_CAP);
}

/**
 * Rebuilds overlap: the icon lookup awaits, and a tick or a new access can start another rebuild
 * before the first has emitted. Only the newest may emit, or an older focus lands on screen after
 * the newer one and the globe shows the wrong file until the next change.
 */
let rebuildGeneration = 0;

async function rebuildScene(): Promise<void> {
  const generation = ++rebuildGeneration;
  const focus = scheduler.focus;
  if (!focus) {
    emit({ orbit: orbitOf([...recent.values()].reverse()), focus: null, queue: scheduler.queue.length, sessions: sessionsNow(), filter: sessionFilter });
    return;
  }
  const item = await itemFor(focus.access);
  if (generation !== rebuildGeneration) return;
  recent.delete(item.id);
  recent.set(item.id, item);
  const by = touchedBy.get(item.id) ?? new Set<string>();
  if (focus.access.session) by.add(focus.access.session);
  touchedBy.set(item.id, by);
  const orbitNow = orbitOf([...recent.values()].reverse());
  while (recent.size > ORBIT_CAP * 2) {
    const oldest = recent.keys().next().value;
    if (oldest === undefined) break;
    recent.delete(oldest);
    touchedBy.delete(oldest);
  }
  const content = contentFor(item, focus.access);
  const scene: HoloScene = {
    orbit: orbitNow,
    focus: { item, content, since: focusSince, action: focus.access.action },
    queue: scheduler.queue.length,
    session: sessionCaption(focus.access, cwdBySession.get(focus.access.session)),
    sessions: sessionsNow(),
    filter: sessionFilter
  };
  emit(scene);

  // An edit is announced before it lands: read the file again shortly after, and if it changed,
  // show the typing from what it was to what it is.
  if ((focus.access.action === 'edit' || focus.access.action === 'write') && item.kind === 'code' && underTrustedRoot(item.path)) {
    if (afterEdit) clearTimeout(afterEdit);
    const before = previousText.get(item.path) ?? '';
    const path = item.path;
    afterEdit = setTimeout(() => {
      afterEdit = null;
      if (focusedPath !== path) return;
      const after = readText(path);
      if (after === null || after === before) return;
      rememberText(path, after);
      emit({ ...current, focus: current.focus ? { ...current.focus, content: terminalFrom(before, after, item.name, extensionOf(path)) } : null });
    }, AFTER_EDIT_MS);
  }
}

function applyFocus(now: number): void {
  const path = scheduler.focus?.access.path ?? null;
  if (path !== focusedPath) {
    focusedPath = path;
    focusSince = now;
  }
  void rebuildScene();
}

function onTick(): void {
  const now = Date.now();
  const { state, changed } = tickScheduler(scheduler, now);
  scheduler = state;
  if (changed) { applyFocus(now); return; }
  // A session went quiet past the window, or a new one spoke: the picker's list changed.
  const key = recentSessions(seenSessions, now, sessionFilter).map((x) => x.id).join('|');
  if (key !== sessionsKey) void rebuildScene();
}

function offer(accesses: ActivityAccess[]): void {
  const shown = filterAccesses(accesses, sessionFilter);
  if (!shown.length) return;
  const now = Date.now();
  const result = schedulePriority(scheduler, shown, now);
  scheduler = result.state;
  if (result.changed) applyFocus(now);
}

/**
 * The session picker's choice (`hologram:setSessionFilter`, user-only): one session's accesses
 * alone, or all of them (null). The focus and queue from other sessions go at once, the orbit keeps
 * only what that session touched, and the scene is pushed again.
 */
export function setSessionFilter(id: unknown): { ok: boolean; filter: string | null; error?: string } {
  const next = validSessionFilter(id, seenSessions);
  if (next === undefined) return { ok: false, filter: sessionFilter, error: 'NO SUCH SESSION ON THIS MACHINE' };
  sessionFilter = next;
  const narrowed = filterScheduler(scheduler, sessionFilter);
  scheduler = narrowed.state;
  if (narrowed.changed) applyFocus(Date.now());
  else void rebuildScene();
  return { ok: true, filter: sessionFilter };
}

/* ────────────────────────── tailing the transcripts ────────────────────────── */

function projectsDir(): string {
  return join(homedir(), '.claude', 'projects');
}

function consume(file: string): void {
  let size: number;
  try { size = statSync(file).size; } catch { return; }
  const from = offsets.get(file) ?? 0;
  if (size < from) { offsets.set(file, 0); partial.set(file, ''); return; }
  if (size === from) return;
  let chunk: string;
  try {
    const fd = openSync(file, 'r');
    try {
      const buf = Buffer.alloc(size - from);
      const n = readSync(fd, buf, 0, buf.length, from);
      chunk = buf.subarray(0, n).toString('utf8');
    } finally { closeSync(fd); }
  } catch { return; }
  offsets.set(file, size);
  const text = (partial.get(file) ?? '') + chunk;
  const lines = text.split('\n');
  partial.set(file, lines.pop() ?? '');
  const accesses: ActivityAccess[] = [];
  for (const raw of lines) {
    if (!raw.trim()) continue;
    let line: TranscriptLine;
    try { line = JSON.parse(raw) as TranscriptLine; } catch { continue; }
    if (line.type !== 'assistant') continue;
    if (typeof line.sessionId === 'string' && typeof line.cwd === 'string') cwdBySession.set(line.sessionId, line.cwd);
    if (typeof line.sessionId === 'string' && line.sessionId) {
      seenSessions.set(line.sessionId, { cwd: typeof line.cwd === 'string' ? line.cwd : seenSessions.get(line.sessionId)?.cwd, lastSeen: Date.now() });
    }
    accesses.push(...eventsFromMessage(line));
  }
  offer(accesses);
}

export function startActivityFeed(): void {
  if (watcher) return;
  const dir = projectsDir();
  if (!existsSync(dir)) {
    console.log(`[activity] no transcripts at ${dir}; the globe stays idle`);
    return;
  }
  ready = false;
  watcher = chokidar.watch(dir, {
    depth: 2,
    ignoreInitial: false,
    ignored: (path: string, stats?: { isFile(): boolean }) => Boolean(stats?.isFile() && !path.endsWith('.jsonl')),
    awaitWriteFinish: false,
    usePolling: false
  });
  watcher.on('add', (file: string) => {
    if (!file.endsWith('.jsonl')) return;
    if (!ready) {
      // Present at start: remember where it ends and read only what comes after.
      try { offsets.set(file, statSync(file).size); } catch { offsets.set(file, 0); }
      partial.set(file, '');
      return;
    }
    offsets.set(file, 0);
    partial.set(file, '');
    consume(file);
  });
  watcher.on('change', (file: string) => { if (file.endsWith('.jsonl')) consume(file); });
  watcher.on('unlink', (file: string) => { offsets.delete(file); partial.delete(file); });
  watcher.on('ready', () => { ready = true; });
  watcher.on('error', (err: unknown) => console.error('[activity] watcher error:', (err as Error).message));
  tick = setInterval(onTick, TICK_MS);
}

export function stopActivityFeed(): void {
  if (tick) { clearInterval(tick); tick = null; }
  if (afterEdit) { clearTimeout(afterEdit); afterEdit = null; }
  const w = watcher;
  watcher = null;
  if (w) void w.close().catch(() => undefined);
  offsets.clear();
  partial.clear();
  flushAtlas();
}
