import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, screen, type WebContents } from 'electron';
import {
  CONFIRM_WIDTH,
  answerIndex,
  confirmHash,
  confirmHeightFor,
  normaliseConfirm,
  type ConfirmOptions,
  type ConfirmPayload
} from '@shared/confirm.js';

/**
 * The themed confirmation window: SkynetOS's own yes/no, in place of `dialog.showMessageBox`.
 *
 * Same question, same default, same one answer. What this module adds is only the look: a small
 * frameless window drawn by ui/ConfirmApp.tsx in the program's chrome, in the theme of the room
 * the question came from. What it must NOT change is written in docs/07 and held here:
 *
 *   - the refusal is the default: the window opens with focus on `cancelId`, and Esc, the close
 *     box, the parent closing, or the app quitting all answer `cancelId`;
 *   - the page may call exactly one channel, `confirm:answer`, and only for its own id
 *     (`isConfirmSender`); anything outside the button list resolves to the refusal;
 *   - `refuseDialogWhenRemote` is the caller's, before this is reached, exactly as before: a remote
 *     device never gets a question it cannot see;
 *   - if the window cannot be made, the native dialog asks instead, with the same options, and the
 *     fallback is logged. A question that fails open would be worse than an ugly one.
 *
 * Modal to its parent when there is one, as the native box was, so the board cannot be clicked
 * behind it. Always on top otherwise, so a launch confirmation raised while another program has
 * focus is not lost behind it.
 */

interface Pending {
  payload: ConfirmPayload;
  win: BrowserWindow;
  resolve: (response: number) => void;
  settled: boolean;
}

const pending = new Map<string, Pending>();
let quitting = false;

// `app` is absent under vitest, where the pure importers of this module (explorer.ts) are tested.
if (app && typeof app.once === 'function') {
  app.once('before-quit', () => {
    quitting = true;
    for (const p of [...pending.values()]) settle(p, p.payload.cancelId);
  });
}

function settle(p: Pending, response: number): void {
  if (p.settled) return;
  p.settled = true;
  pending.delete(p.payload.id);
  p.resolve(response);
  if (!p.win.isDestroyed()) {
    p.win.removeAllListeners('close');
    p.win.close();
  }
}

/** Cancel the OS display scale, as every SkynetOS window does, so the chrome's pixels are device pixels. */
function neutralize(target: BrowserWindow): void {
  const scale = screen.getDisplayNearestPoint(target.getBounds()).scaleFactor || 1;
  target.webContents.setZoomFactor(1 / scale);
}

function placeOver(parent: BrowserWindow | null, width: number, height: number): { x: number; y: number } {
  const area = parent && !parent.isDestroyed()
    ? parent.getBounds()
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2)
  };
}

function createWindow(parent: BrowserWindow | null, payload: ConfirmPayload): BrowserWindow {
  const anchor = parent && !parent.isDestroyed() ? parent.getBounds() : { x: screen.getCursorScreenPoint().x, y: screen.getCursorScreenPoint().y, width: 1, height: 1 };
  const display = screen.getDisplayMatching(anchor);
  const ui = Math.min(3, Math.max(1, Math.round(display.scaleFactor || 1)));
  const width = CONFIRM_WIDTH * ui;
  const height = confirmHeightFor(payload) * ui;
  const win = new BrowserWindow({
    ...placeOver(parent, width, height),
    width,
    height,
    useContentSize: true,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: !parent,
    modal: !!parent && !parent.isDestroyed(),
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    title: payload.title,
    backgroundColor: payload.theme?.maskDark ?? '#0E1A14',
    webPreferences: {
      // docs/07, exactly as the board, face and hologram windows: the same bridge and no more.
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
  win.once('ready-to-show', () => { if (!win.isDestroyed()) { win.show(); win.focus(); } });

  const hash = confirmHash(ui, payload);
  const dev = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && dev) void win.loadURL(`${dev}#${hash}`);
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash });
  return win;
}

/**
 * Ask, in the program's own chrome. Resolves with `{ response }`, an index into `buttons`, exactly
 * as `dialog.showMessageBox` does, so a call site swaps one identifier.
 */
export async function confirmThemed(parent: BrowserWindow | null, options: ConfirmOptions): Promise<{ response: number }> {
  const id = randomBytes(12).toString('hex');
  const payload = normaliseConfirm(id, options);
  if (quitting) return { response: payload.cancelId };

  let win: BrowserWindow;
  try {
    win = createWindow(parent, payload);
  } catch (err) {
    console.warn('[confirm] could not open the themed window; asking natively:', (err as Error).message);
    return nativeFallback(parent, payload);
  }

  return new Promise<{ response: number }>((resolve) => {
    const entry: Pending = { payload, win, resolve: (response) => resolve({ response }), settled: false };
    pending.set(id, entry);
    // Closing by any road that is not a button press is the refusal.
    win.on('close', () => settle(entry, payload.cancelId));
    win.on('closed', () => settle(entry, payload.cancelId));
    win.webContents.on('render-process-gone', () => settle(entry, payload.cancelId));
    win.webContents.on('did-fail-load', () => {
      console.warn('[confirm] the themed window failed to load; asking natively');
      pending.delete(id);
      entry.settled = true;
      if (!win.isDestroyed()) { win.removeAllListeners('close'); win.close(); }
      void nativeFallback(parent, payload).then(resolve);
    });
    if (parent && !parent.isDestroyed()) parent.once('closed', () => settle(entry, payload.cancelId));
  });
}

async function nativeFallback(parent: BrowserWindow | null, payload: ConfirmPayload): Promise<{ response: number }> {
  const options = {
    type: (payload.kind === 'info' ? 'question' : 'warning') as 'question' | 'warning',
    buttons: payload.buttons,
    defaultId: payload.defaultId,
    cancelId: payload.cancelId,
    title: payload.title,
    message: payload.message,
    detail: payload.detail,
    noLink: true
  };
  const { response } = parent && !parent.isDestroyed()
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  return { response };
}

/* ────────────────────────── the one channel ────────────────────────── */

/** True when `sender` is a live confirm window, and, when an id is given, THE window for that id. */
export function isConfirmSender(sender: WebContents, id?: string): boolean {
  if (id !== undefined) {
    const p = pending.get(id);
    return !!p && !p.win.isDestroyed() && p.win.webContents === sender;
  }
  for (const p of pending.values()) if (!p.win.isDestroyed() && p.win.webContents === sender) return true;
  return false;
}

/** `confirm:answer`: the page pressed a button. Out-of-range presses are the refusal. */
export function answerConfirm(id: string, index: number): { ok: boolean } {
  const p = pending.get(String(id));
  if (!p) return { ok: false };
  settle(p, answerIndex(p.payload, index));
  return { ok: true };
}

/** For tests and the smoke run: how many questions are on screen. */
export function pendingConfirmCount(): number {
  return pending.size;
}
