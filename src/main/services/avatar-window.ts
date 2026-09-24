import { join } from 'node:path';
import { statSync, watch, type FSWatcher } from 'node:fs';
import { app, BrowserWindow, screen } from 'electron';
import type { BoardNode } from '@shared/types.js';
import type { SessionInfo } from '@shared/ipc.js';
import type { AvatarMood } from '@shared/avatar.js';
import { pickHandsNode } from '@shared/face-brief.js';
import {
  AVATAR_WINDOW_SIZE,
  isJarvisIteration,
  isSpeaking,
  offsetFrom,
  placeFace,
  streamingProbeScript,
  terminalTitleFragment,
  type Offset,
  type Rect
} from '@shared/avatar-window.js';
import { getSettings } from './settings.js';
import { loadBoard } from './board-store.js';
import { listSessions, onSessionsChanged } from './session-manager.js';
import { onChatWindowOpened, openChatWindows } from './chat-window.js';
import { onAvatarChanged } from './avatar-frames.js';
import { boardWindow } from './main-window.js';
import { claudeProjectsDir, projectDirName } from './conversations.js';
import { trackWindow } from './window-tracker.js';

/**
 * JARVIS's face, beside every JARVIS window. See packages/shared/avatar-window.ts for the rules.
 *
 * WEB (the Face in a SkynetOS window): the face is an OWNED window, with the chat window as its
 * `parent`. On Windows that is the whole of "equal priority / comes to front / hides alongside /
 * closes with": an owned window stays above its owner, minimises and restores with it and is
 * destroyed with it. Show and hide are mirrored as well, because hiding an owner does not hide
 * what it owns. It talks while claude.ai is streaming a response, read-only (streamingProbeScript).
 *
 * TERMINAL (JARVIS Prime in Windows Terminal): another program's window, so no ownership. The
 * window tracker reports its rectangle and state, and the face follows: docked beside it, hidden
 * while it is minimised or gone, raised above it (never focused) when it comes to the front, and
 * closed when the session ends. It talks while the session's transcript is being written.
 *
 * A face the user drags keeps its new place relative to its window from then on.
 */

interface Face {
  key: string;
  win: BrowserWindow;
  mood: AvatarMood;
  lastSet: Rect | null;
  lastTarget: Rect | null;
  offset: Offset | null;
  dispose: () => void;
}

const faces = new Map<string, Face>();
let initialised = false;

export function avatarsEnabled(): boolean {
  return getSettings().avatarWindows !== false;
}

export function faceCount(): number {
  return faces.size;
}

/** Cancel the OS display scale, as the board window does, so frame pixels are device pixels. */
function neutralize(win: BrowserWindow): number {
  const scale = screen.getDisplayNearestPoint(win.getBounds()).scaleFactor || 1;
  win.webContents.setZoomFactor(1 / scale);
  return scale;
}

function createFaceWindow(label: string, parent?: BrowserWindow): BrowserWindow {
  const display = parent ? screen.getDisplayMatching(parent.getBounds()) : screen.getPrimaryDisplay();
  const ui = Math.min(3, Math.max(1, Math.round(display.scaleFactor || 1)));
  const win = new BrowserWindow({
    width: AVATAR_WINDOW_SIZE.width,
    height: AVATAR_WINDOW_SIZE.height,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    title: `JARVIS FACE - ${label}`,
    backgroundColor: '#0E1A14',
    ...(parent ? { parent } : {}),
    webPreferences: {
      // docs/07, exactly as the board window: this page gets the same bridge and no more.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: join(__dirname, '../preload/index.cjs')
    }
  });
  win.on('page-title-updated', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    const dev = process.env['ELECTRON_RENDERER_URL'];
    if (!(dev && url.startsWith(dev))) event.preventDefault();
  });
  win.webContents.on('did-finish-load', () => neutralize(win));

  const hash = `avatar?label=${encodeURIComponent(label)}&ui=${ui}`;
  const dev = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && dev) void win.loadURL(`${dev}#${hash}`);
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash });
  return win;
}

function setMood(face: Face, mood: AvatarMood): void {
  if (face.mood === mood || face.win.isDestroyed()) return;
  face.mood = mood;
  face.win.webContents.send('avatar:mood', { mood });
}

/** Put a face beside its window, unless it is already exactly there. */
function place(face: Face, target: Rect, workArea: Rect): void {
  if (face.win.isDestroyed()) return;
  const rect = placeFace(target, AVATAR_WINDOW_SIZE, workArea, face.offset);
  face.lastTarget = target;
  const last = face.lastSet;
  if (last && last.x === rect.x && last.y === rect.y && last.width === rect.width && last.height === rect.height) return;
  face.lastSet = rect;
  face.win.setBounds(rect);
}

function trackUserMoves(face: Face): void {
  // 'moved' fires when a drag ENDS. A face the user put somewhere keeps that place relative to its window.
  face.win.on('moved', () => {
    if (face.win.isDestroyed() || !face.lastTarget) return;
    const now = face.win.getBounds();
    const last = face.lastSet;
    if (last && Math.abs(now.x - last.x) <= 2 && Math.abs(now.y - last.y) <= 2) return;
    face.offset = offsetFrom(face.lastTarget, now);
    face.lastSet = { x: now.x, y: now.y, width: now.width, height: now.height };
  });
  face.win.webContents.on('did-finish-load', () => {
    if (!face.win.isDestroyed()) face.win.webContents.send('avatar:mood', { mood: face.mood });
  });
}

function closeFace(key: string): void {
  const face = faces.get(key);
  if (!face) return;
  faces.delete(key);
  face.dispose();
  if (!face.win.isDestroyed()) face.win.close();
}

/* ────────────────────────── the web Face ────────────────────────── */

export function attachWebFace(node: BoardNode, chat: BrowserWindow): void {
  if (!avatarsEnabled() || !isJarvisIteration(node, null)) return;
  if (node.kind !== 'agent.jarvis' && node.kind !== 'agent.chat') return;
  const key = `web:${node.id}`;
  if (faces.has(key) || chat.isDestroyed()) return;

  const label = node.designator ? `${node.designator} ${node.name}` : node.name;
  const win = createFaceWindow(label, chat);
  const face: Face = { key, win, mood: 'idle', lastSet: null, lastTarget: null, offset: null, dispose: () => undefined };

  const dock = (): void => {
    if (chat.isDestroyed()) return;
    const bounds = chat.getBounds();
    place(face, bounds, screen.getDisplayMatching(bounds).workArea);
  };
  const reveal = (): void => {
    if (win.isDestroyed() || chat.isDestroyed()) return;
    dock();
    if (chat.isVisible() && !chat.isMinimized()) win.showInactive();
  };
  const conceal = (): void => { if (!win.isDestroyed()) win.hide(); };
  const onClosed = (): void => closeFace(key);

  chat.on('move', dock);
  chat.on('resize', dock);
  chat.on('show', reveal);
  chat.on('restore', reveal);
  chat.on('hide', conceal);
  chat.on('minimize', conceal);
  chat.once('closed', onClosed);
  win.once('ready-to-show', reveal);

  /*
   * Talking while claude.ai streams. Read-only, only while the Face is on screen, and never while
   * the page is loading: nothing of SkynetOS's runs in the page until it has finished booting.
   * Changed 2026-09-11 after William's Face window hung on claude.ai's spinner; see DECISIONS.
   */
  let inFlight = false;
  const poll = setInterval(() => {
    if (inFlight || chat.isDestroyed() || !chat.isVisible() || chat.isMinimized() || chat.webContents.isLoading()) return;
    inFlight = true;
    chat.webContents.executeJavaScript(streamingProbeScript(), false)
      .then((streaming: unknown) => setMood(face, streaming === true ? 'speaking' : 'idle'))
      .catch(() => setMood(face, 'idle'))
      .finally(() => { inFlight = false; });
  }, 700);

  face.dispose = () => {
    clearInterval(poll);
    if (!chat.isDestroyed()) {
      chat.removeListener('move', dock);
      chat.removeListener('resize', dock);
      chat.removeListener('show', reveal);
      chat.removeListener('restore', reveal);
      chat.removeListener('hide', conceal);
      chat.removeListener('minimize', conceal);
      chat.removeListener('closed', onClosed);
    }
  };
  trackUserMoves(face);
  faces.set(key, face);
}

/* ────────────────────────── JARVIS Prime terminals ────────────────────────── */

function sessionWantsFace(s: SessionInfo): boolean {
  const load = loadBoard(s.boardId);
  if (!load.ok) return false;
  const node = load.board.nodes.find((n) => n.id === s.nodeId);
  if (!node || node.kind !== 'agent.code') return false;
  const root = s.boardId === 'root' ? load : loadBoard('root');
  const hands = s.boardId === 'root' && root.ok ? pickHandsNode(root.board.nodes)?.id ?? null : null;
  return isJarvisIteration(node, hands);
}

/** Physical pixels from the tracker to Electron's DIPs. */
function toDip(rect: Rect): Rect {
  const conv = (screen as unknown as { screenToDipRect?: (w: null, r: Rect) => Rect }).screenToDipRect;
  if (typeof conv === 'function') return conv.call(screen, null, rect);
  const f = screen.getPrimaryDisplay().scaleFactor || 1;
  return { x: Math.round(rect.x / f), y: Math.round(rect.y / f), width: Math.round(rect.width / f), height: Math.round(rect.height / f) };
}

/** When the session's transcript was last written, watched cheaply: a folder watch plus a slow stat. */
function watchTranscript(s: SessionInfo, onWrite: () => void): () => void {
  if (!s.claudeSessionId) return () => undefined;
  const dir = join(claudeProjectsDir(), projectDirName(s.cwd));
  const file = `${s.claudeSessionId}.jsonl`;
  let lastMtime = -1;
  const check = (): void => {
    try {
      const m = statSync(join(dir, file)).mtimeMs;
      // The first reading is a baseline: an old transcript of a resumed session is not speech.
      if (lastMtime >= 0 && m > lastMtime) onWrite();
      lastMtime = m;
    } catch {
      if (lastMtime < 0) lastMtime = 0;
    }
  };
  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(dir, (_event, name) => { if (!name || String(name) === file) check(); });
    watcher.on('error', () => { watcher = null; });
  } catch { /* the folder appears with the first turn; the stat poll covers it until then */ }
  const poll = setInterval(check, 1000);
  check();
  return () => { clearInterval(poll); watcher?.close(); };
}

function openTerminalFace(s: SessionInfo): void {
  const key = `term:${s.id}`;
  const label = `${s.designator ? s.designator + ' ' : ''}${s.nodeName}`;
  const win = createFaceWindow(label);
  const face: Face = { key, win, mood: 'idle', lastSet: null, lastTarget: null, offset: null, dispose: () => undefined };

  let wasForeground = false;
  const stopTracking = trackWindow(terminalTitleFragment(s.designator, s.nodeName), (state) => {
    if (win.isDestroyed()) return;
    if (!state.found || state.minimized || !state.visible) {
      if (win.isVisible()) win.hide();
      wasForeground = false;
      return;
    }
    const target = toDip({ x: state.x, y: state.y, width: state.width, height: state.height });
    place(face, target, screen.getDisplayMatching(target).workArea);
    if (!win.isVisible()) win.showInactive();
    // Brought just above the terminal as it comes to the front. Never focused: the terminal keeps the keyboard.
    if (state.foreground && !wasForeground) win.moveTop();
    wasForeground = state.foreground;
  });

  let lastWrite: number | null = null;
  const stopWatching = watchTranscript(s, () => { lastWrite = Date.now(); });
  const talk = setInterval(() => setMood(face, isSpeaking(lastWrite, Date.now()) ? 'speaking' : 'idle'), 300);

  face.dispose = () => { stopTracking(); stopWatching(); clearInterval(talk); };
  trackUserMoves(face);
  faces.set(key, face);
}

export function syncTerminalFaces(sessions: SessionInfo[]): void {
  const wanted = new Set<string>();
  if (avatarsEnabled()) {
    for (const s of sessions) {
      if (s.state !== 'starting' && s.state !== 'running') continue;
      if (!sessionWantsFace(s)) continue;
      const key = `term:${s.id}`;
      wanted.add(key);
      if (!faces.has(key)) openTerminalFace(s);
    }
  }
  for (const key of [...faces.keys()]) {
    if (key.startsWith('term:') && !wanted.has(key)) closeFace(key);
  }
}

/* ────────────────────────── lifecycle ────────────────────────── */

/** Close every face and open the ones that should exist now. After the global switch changes. */
export function refreshFaces(): void {
  for (const key of [...faces.keys()]) closeFace(key);
  if (!avatarsEnabled()) return;
  for (const { node, win } of openChatWindows()) attachWebFace(node, win);
  syncTerminalFaces(listSessions());
}

export function initAvatarWindows(): void {
  if (initialised) return;
  initialised = true;
  onChatWindowOpened((node, win) => attachWebFace(node, win));
  onSessionsChanged((sessions) => syncTerminalFaces(sessions));
  onAvatarChanged((name) => {
    for (const face of faces.values()) if (!face.win.isDestroyed()) face.win.webContents.send('avatar:changed', { name });
    const board = boardWindow();
    if (board && !board.isDestroyed()) board.webContents.send('avatar:changed', { name });
  });
  syncTerminalFaces(listSessions());
}

export function closeAllFaces(): void {
  for (const key of [...faces.keys()]) closeFace(key);
}

/* ────────────────────────── the preview ────────────────────────── */

let preview: BrowserWindow | null = null;

/**
 * A free-standing face: the frames on screen with no session and no claude.ai page behind them.
 * Centred on the primary display, closed by Esc. `setMood` drives it the way a real tether would.
 * Used by PREVIEW FACE in LOOK → SYSTEM, and by the smoke capture, which photographs it.
 */
export function createPreviewFace(): { win: BrowserWindow; setMood: (mood: AvatarMood) => void } {
  const win = createFaceWindow('PREVIEW');
  const area = screen.getPrimaryDisplay().workArea;
  win.setBounds({
    x: Math.round(area.x + (area.width - AVATAR_WINDOW_SIZE.width) / 2),
    y: Math.round(area.y + (area.height - AVATAR_WINDOW_SIZE.height) / 2),
    width: AVATAR_WINDOW_SIZE.width,
    height: AVATAR_WINDOW_SIZE.height
  });
  let mood: AvatarMood = 'idle';
  const setMood = (next: AvatarMood): void => {
    mood = next;
    if (!win.isDestroyed()) win.webContents.send('avatar:mood', { mood });
  };
  // A reload (hot reload, or new frames) forgets the mood; say it again.
  win.webContents.on('did-finish-load', () => setMood(mood));
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); win.close(); }
  });
  return { win, setMood };
}

/**
 * PREVIEW FACE: William drops frames in assets/avatar/jarvis and sees them at once. It alternates
 * talking and idle every 3 s, so both the mouth cycle and the blinks show. A second press closes
 * it, as do Esc and a minute's time.
 */
export function openPreviewFace(): { ok: boolean; open: boolean } {
  if (preview && !preview.isDestroyed()) {
    preview.close();
    return { ok: true, open: false };
  }
  const { win, setMood } = createPreviewFace();
  let speaking = false;
  const timer = setInterval(() => { speaking = !speaking; setMood(speaking ? 'speaking' : 'idle'); }, 3000);
  const autoClose = setTimeout(() => { if (!win.isDestroyed()) win.close(); }, 60_000);
  preview = win;
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    clearInterval(timer);
    clearTimeout(autoClose);
    if (preview === win) preview = null;
  });
  return { ok: true, open: true };
}
