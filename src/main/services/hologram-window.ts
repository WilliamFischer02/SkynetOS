import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, screen, type WebContents } from 'electron';
import { HOLOGRAM_DEFAULT_SIZE, clampHologramSize, deskBounds, type HologramStatus } from '@shared/hologram.js';
import type { HologramControl } from '@shared/hologram-control.js';
import type { HoloScene } from '@shared/holo-scene.js';
import { restoreWindowState } from '@shared/window-state.js';
import { getSettings, setHologramEnabled as writeHologramEnabled } from './settings.js';
import { desktopStatus, haltPlan } from './desktop.js';
import { stopSpeaking } from './speech.js';
import { setVoiceEnabled } from './voice.js';

/**
 * JARVIS Voice: the hologram window (docs/11-JARVIS-VOICE.md).
 *
 * A frameless window that shows the globe and takes a typed command. It is a VIEW: main pushes it
 * the voice, speech and desktop events it already pushes the board (index.ts fans them out), plus
 * the levels (`speech:levels`, `voice:levels`), the scene (`hologram:scene`) and voice-driven
 * controls (`hologram:control`). It may call only HOLOGRAM_ALLOWED (packages/shared/ipc.ts). It
 * has no partition and asks for no media permission: the microphone stays with the capture window
 * (services/voice.ts), so docs/07 "Voice" is unchanged by this window being on screen.
 *
 * Two ways out, since 2026-09-26 (William: "a close button that fully closes the window"):
 *   - CLOSE (`hologram:close`) destroys the window. Voice and speech keep running; the VOICE button
 *     or the next start brings it back, because `hologram.enabled` is untouched.
 *   - SHUT DOWN (`hologram:shutdown`, "Jarvis, shut yourself down") closes it, switches the
 *     microphone off (the hard mute), stops speaking, halts any desktop plan, and writes
 *     `hologram.enabled: false`. Never the computer, never SkynetOS.
 * The OS-level close (Alt+F4) still minimises, as before.
 *
 * DESK layout (`hologram:setDesk`): the window moves to monitor one, full work-area height at the
 * right edge, 0.6 wide per tall; off, it goes back to the square bottom-right of the primary
 * display. Monitor numbering is `packages/shared/desktop.ts`'s, read through `desktopStatus()`.
 */

const MARGIN = 16;
const SAVE_DEBOUNCE_MS = 600;

let win: BrowserWindow | null = null;
let quitting = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let desk = false;
let sceneOff: (() => void) | null = null;
/** The last scene pushed, replayed to a window that was still loading when it arrived. */
let lastScene: HoloScene | null = null;

function stateFile(): string {
  return join(app.getPath('userData'), 'hologram-window.json');
}

function squareSize(): number {
  return clampHologramSize(getSettings().hologram.size ?? HOLOGRAM_DEFAULT_SIZE);
}

/** Bottom-right of the primary display's work area, or where William last put it if still on screen. */
function initialBounds(size: number): { x: number; y: number; width: number; height: number } {
  const work = screen.getPrimaryDisplay().workArea;
  const fallback = { x: work.x + work.width - size - MARGIN, y: work.y + work.height - size - MARGIN, width: size, height: size };
  let raw: unknown = null;
  try { raw = JSON.parse(readFileSync(stateFile(), 'utf8')); } catch { /* first run */ }
  const areas = screen.getAllDisplays().map((d) => d.workArea);
  const saved = restoreWindowState(raw, areas, { width: size, height: size }, { width: size, height: size });
  return saved.x !== undefined && saved.y !== undefined ? { x: saved.x, y: saved.y, width: size, height: size } : fallback;
}

function savePlace(): void {
  if (!win || win.isDestroyed() || win.isMinimized() || desk) return;
  const b = win.getBounds();
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(stateFile(), JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: false }, null, 2), 'utf8');
  } catch (err) {
    console.warn('[hologram] could not save the window place:', (err as Error).message);
  }
}

/** Cancel the OS display scale, as the board and face windows do, so frame pixels are device pixels. */
function neutralize(target: BrowserWindow): void {
  const scale = screen.getDisplayNearestPoint(target.getBounds()).scaleFactor || 1;
  target.webContents.setZoomFactor(1 / scale);
}

function create(): BrowserWindow {
  const settings = getSettings();
  const size = squareSize();
  const bounds = initialBounds(size);
  const display = screen.getDisplayMatching(bounds);
  const ui = Math.min(3, Math.max(1, Math.round(display.scaleFactor || 1)));
  const created = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: true,
    fullscreenable: false,
    skipTaskbar: false,
    alwaysOnTop: settings.hologram.alwaysOnTop !== false,
    title: 'JARVIS',
    backgroundColor: '#04090F',
    webPreferences: {
      // docs/07, exactly as the board and face windows: the same bridge and no more. No partition:
      // this page gets no microphone and no camera, ever.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: join(__dirname, '../preload/index.cjs')
    }
  });
  created.on('page-title-updated', (event) => event.preventDefault());
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  created.webContents.on('will-navigate', (event, url) => {
    const dev = process.env['ELECTRON_RENDERER_URL'];
    if (!(dev && url.startsWith(dev))) event.preventDefault();
  });
  created.webContents.on('did-finish-load', () => {
    neutralize(created);
    // A scene that arrived while the page was loading was dropped by `sendToHologram`; the globe
    // would otherwise stay empty until the next change, which may be minutes away.
    if (lastScene && !created.isDestroyed()) created.webContents.send('hologram:scene', lastScene);
  });
  created.once('ready-to-show', () => { if (!created.isDestroyed()) created.showInactive(); });

  // The OS close (Alt+F4, the taskbar) is minimise, unless the app itself is going. The window's
  // own CLOSE button goes through `closeHologram`, which really closes.
  created.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    created.minimize();
  });
  created.on('moved', () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(savePlace, SAVE_DEBOUNCE_MS);
  });
  created.on('closed', () => { if (win === created) win = null; });

  const hash = `hologram?ui=${ui}&size=${size}${settings.streamMode ? '&stream=1' : ''}`;
  const dev = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && dev) void created.loadURL(`${dev}#${hash}`);
  else void created.loadFile(join(__dirname, '../renderer/index.html'), { hash });
  return created;
}

function open(): void {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.showInactive();
    return;
  }
  win = create();
  if (desk) applyDesk(true);
}

function close(): void {
  if (!win || win.isDestroyed()) { win = null; return; }
  const target = win;
  win = null;
  target.removeAllListeners('close');
  target.close();
}

/* ────────────────────────── DESK layout ────────────────────────── */

/** Monitor one's work area per desktop.ts's numbering, or the primary display's. */
function monitorOneWork(): { x: number; y: number; width: number; height: number } {
  try {
    const one = desktopStatus().monitors.find((m) => m.index === 1);
    if (one) return one.work;
  } catch { /* the desktop service may not be up */ }
  return screen.getPrimaryDisplay().workArea;
}

function applyDesk(on: boolean): void {
  if (!win || win.isDestroyed()) return;
  if (on) {
    win.setBounds(deskBounds(monitorOneWork()), false);
  } else {
    const size = squareSize();
    const work = screen.getPrimaryDisplay().workArea;
    win.setBounds({ x: work.x + work.width - size - MARGIN, y: work.y + work.height - size - MARGIN, width: size, height: size }, false);
  }
  neutralize(win);
}

/* ────────────────────────── the public surface ────────────────────────── */

export function isHologramSender(sender: WebContents): boolean {
  return win !== null && !win.isDestroyed() && sender === win.webContents;
}

/** For index.ts: where voice, speech and desktop events are fanned out to. */
export function hologramWindow(): BrowserWindow | undefined {
  return win && !win.isDestroyed() ? win : undefined;
}

/** Push one event to the hologram window, if it is up. Levels, scene and controls come through here. */
export function sendToHologram<T>(event: 'speech:levels' | 'voice:levels' | 'hologram:scene' | 'hologram:control', payload: T): boolean {
  const target = hologramWindow();
  if (!target || target.webContents.isLoading()) return false;
  target.webContents.send(event, payload);
  return true;
}

/** A spoken command for a control in the window (packages/shared/hologram-control.ts). */
export function controlHologram(control: HologramControl): { ok: boolean; error?: string } {
  if (control.op === 'close') return closeHologram();
  if (control.op === 'shutdown') return shutdownHologram();
  if (control.op === 'minimise') return minimizeHologram();
  if (!hologramWindow()) open();
  return sendToHologram('hologram:control', control) ? { ok: true } : { ok: false, error: 'THE JARVIS WINDOW IS STILL LOADING' };
}

/** The scene producer (services/activity-feed.ts) calls this with every change. */
export function pushHologramScene(scene: HoloScene): void {
  lastScene = scene;
  sendToHologram('hologram:scene', scene);
}

export function hologramStatus(): HologramStatus {
  const s = getSettings().hologram;
  const live = win !== null && !win.isDestroyed();
  return {
    enabled: s.enabled,
    open: live,
    minimized: live ? win!.isMinimized() : false,
    alwaysOnTop: live ? win!.isAlwaysOnTop() : s.alwaysOnTop !== false,
    desk
  };
}

/** Writes the setting AND acts on it now: opens the window, or closes it for good. */
export function setHologramEnabled(on: boolean): HologramStatus {
  const written = writeHologramEnabled(on);
  if (!written.ok) throw new Error(written.error ?? 'COULD NOT SAVE THE HOLOGRAM SETTING');
  if (on) open();
  else close();
  return hologramStatus();
}

/**
 * The VOICE button on the board: William asked for it to "directly open the Jarvis program". It
 * switches the window on if it is off (so it comes back at the next start too), opens or restores
 * it, and gives it focus, which `open()` deliberately does not do on its own.
 */
export function openHologram(): HologramStatus {
  if (!getSettings().hologram.enabled) {
    const written = writeHologramEnabled(true);
    if (!written.ok) throw new Error(written.error ?? 'COULD NOT SAVE THE HOLOGRAM SETTING');
  }
  open();
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
  return hologramStatus();
}

export function minimizeHologram(): { ok: boolean } {
  if (!win || win.isDestroyed()) return { ok: false };
  win.minimize();
  return { ok: true };
}

/** The window's CLOSE button: the window goes, everything behind it keeps running. */
export function closeHologram(): { ok: boolean } {
  if (!win || win.isDestroyed()) { win = null; return { ok: false }; }
  savePlace();
  close();
  return { ok: true };
}

/**
 * "Jarvis, shut yourself down": the JARVIS Voice program, never the machine. Microphone off (the
 * hard mute), nothing more said, any desktop plan halted, the window closed and not reopened at the
 * next start. SkynetOS itself is untouched.
 */
export function shutdownHologram(): { ok: boolean } {
  try { haltPlan(); } catch { /* no plan */ }
  try { stopSpeaking(); } catch { /* no sidecar */ }
  try { setVoiceEnabled(false); } catch (err) { console.warn('[hologram] shutdown: voice off failed:', (err as Error).message); }
  const written = writeHologramEnabled(false);
  if (!written.ok) console.warn('[hologram] shutdown: could not write hologram.enabled:', written.error);
  desk = false;
  close();
  return { ok: true };
}

/** DESK layout on or off. The choice lives for the app run; the square is what comes back at start. */
export function setHologramDesk(on: boolean): HologramStatus {
  desk = on;
  applyDesk(on);
  return hologramStatus();
}

/** Wire the scene producer once it exists; idempotent. Called from index.ts after the feed starts. */
export function attachHologramScene(subscribe: (cb: (scene: HoloScene) => void) => () => void): void {
  if (sceneOff) sceneOff();
  sceneOff = subscribe((scene) => pushHologramScene(scene));
}

/** At app.whenReady: the window comes up with the app when William has switched it on. */
export function initHologramWindow(): void {
  app.once('before-quit', () => { quitting = true; });
  if (getSettings().hologram.enabled) open();
}

/** At will-quit: the window is ours and goes with the app. */
export function closeHologramWindow(): void {
  quitting = true;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (sceneOff) { sceneOff(); sceneOff = null; }
  close();
}
