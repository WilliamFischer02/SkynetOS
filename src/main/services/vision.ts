import { app, BrowserWindow, net, protocol, screen, session, type WebContents } from 'electron';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ControlEvent } from '@shared/gesture-control.js';
import { VISION_OFF, visionReadiness, type GestureStatus, type VisionReport } from '@shared/vision.js';
import { getSettings, setGestureEnabled } from './settings.js';
import { allowMediaOnly } from './permissions.js';

/**
 * Manual control: the cameras, and the window that watches them.
 *
 * ── Why a separate window, served from its own scheme ─────────────────────────────────────────
 *
 * MediaPipe cannot run on the board's page, and not for want of trying (docs/DECISIONS.md,
 * 2026-09-11, "Vision loads from its own origin"). It fetches its wasm, injects a script for the
 * glue and compiles a module at runtime, all of which a `file://` page under `script-src 'self'`
 * refuses — and Chromium blocks a `file://` page from reaching a custom scheme at the CORS layer
 * before CSP even gets a say. The only arrangement that works is for the page ITSELF to be served
 * from the custom scheme, so its bundle, its wasm and its model are same-origin.
 *
 * That constraint turns out to be a gift. This window gets:
 *   - its own CSP, with `'wasm-unsafe-eval'`, so the board window keeps `script-src 'self'`;
 *   - its own session partition, so `media` can be granted HERE and refused everywhere else;
 *   - its own thread, so 12.6 ms per frame of landmarking never competes with PixiJS;
 *   - `connect-src 'self'`, which is what stops MediaPipe POSTing to Google's logging endpoint —
 *     it tries, on every startup, and the CSP is the thing that refuses it.
 *
 * It holds the same preload as the board window, and main narrows it: `registerIpc` refuses every
 * channel but `vision:report` and `vision:events` when the sender is this window, and refuses those
 * two from anything else. A page that is allowed near a camera must not also be able to edit the
 * board, and that is enforced in main rather than inferred from a missing bridge.
 */

const SCHEME = 'skynet';
const HOST = 'vision';
const PARTITION = 'vision';

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.task': 'application/octet-stream'
};

let win: BrowserWindow | null = null;
let status: GestureStatus = { ...VISION_OFF };
let onEvent: ((event: ControlEvent) => void) | null = null;
let onStatus: ((status: GestureStatus) => void) | null = null;

/**
 * Must be called at module load, before `app.whenReady()`: Electron only accepts privileged scheme
 * registration before then. `bypassCSP` is deliberately absent — the page's CSP still governs it.
 */
export function registerVisionScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
  ]);
}

/**
 * Where MediaPipe's own files live. From source (`npm run dev`, `npm run boot`) that is
 * `node_modules`. In an install it is `resources/mediapipe`: `@mediapipe/tasks-vision` is a
 * devDependency, so electron-builder leaves it out of app.asar, and electron-builder.yml copies the
 * bundle and the wasm folder there as extraResources instead.
 */
const mediapipeDir = (): string => app.isPackaged
  ? join(process.resourcesPath, 'mediapipe')
  : join(app.getAppPath(), 'node_modules', '@mediapipe', 'tasks-vision');

const rendererDir = (): string => resolve(__dirname, '../renderer');

const serveFile = async (file: string, type?: string): Promise<Response> => {
  if (!file || !existsSync(file)) {
    console.log(`[vision] 404 ${file}`);
    return new Response('not found', { status: 404 });
  }
  const headers = { 'content-type': type ?? TYPES[extname(file)] ?? 'application/octet-stream' };
  /*
   * In an install the page itself is inside app.asar, and `net.fetch` on a file URL does not read
   * through an archive. Node's `fs` does (Electron patches it), so a packaged app reads the bytes
   * and answers with them. From source the streaming fetch stays: nothing is in an archive there.
   */
  if (app.isPackaged) return new Response(new Uint8Array(await readFile(file)), { headers });
  const res = await net.fetch(pathToFileURL(file).toString(), { bypassCustomProtocolHandlers: true });
  return new Response(res.body, { headers });
};

/**
 * The route table. Every path is matched explicitly; nothing is resolved out of a URL against a
 * directory, and the one place that takes a name from the URL takes it only from `[a-z0-9_.-]`.
 */
export function installVisionProtocol(): void {
  /*
   * On the PARTITION's session, not the default one — and this is not a detail.
   *
   * `protocol.handle` from the top-level module registers on `session.defaultSession` ALONE. The
   * vision window runs in its own partition (so that `media` can be granted to it and to nothing
   * else), and a partitioned session has its own protocol registry. Registered on the default
   * session, the window's request for its own page reached no handler at all: `loadURL` never
   * resolved, the page never ran, no report was ever sent, and manual control sat at "starting"
   * for ever with nothing in any log to say why. Found by tools/vision-page-probe.mjs.
   */
  session.fromPartition(PARTITION).protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== HOST) return new Response('no', { status: 404 });
    const path = url.pathname === '/' || url.pathname === '' ? '/vision.html' : url.pathname;

    if (path === '/model') return serveFile(getSettings().gesture.model, 'application/octet-stream');
    if (path === '/gesture-model') return serveFile(getSettings().gesture.gestureModel, 'application/octet-stream');
    if (path === '/vision_bundle.mjs') return serveFile(join(mediapipeDir(), 'vision_bundle.mjs'), 'text/javascript');
    if (path.startsWith('/wasm/')) {
      const name = path.slice('/wasm/'.length);
      if (!/^[a-z0-9_.-]+$/i.test(name)) return new Response('no', { status: 404 });
      return serveFile(join(mediapipeDir(), 'wasm', name));
    }

    // The page and whatever vite gave it. In dev it comes from the dev server, proxied so the
    // page's ORIGIN is still skynet://vision — which is the whole point. HMR does not survive that
    // (its websocket is cross-origin and `connect-src 'self'` refuses it), so reload to see edits.
    const dev = process.env['ELECTRON_RENDERER_URL'];
    if (dev) {
      const res = await net.fetch(`${dev}${path}`, { bypassCustomProtocolHandlers: true });
      return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'text/html' } });
    }
    const root = rendererDir();
    const file = resolve(root, `.${path}`);
    if (file !== root && !file.startsWith(root + sep)) return new Response('no', { status: 403 });
    return serveFile(file);
  });
  console.log(`[vision] ${SCHEME}://${HOST} ready`);
}

/**
 * Bottom right of the primary display's work area, clear of the taskbar. Small: it is a monitor
 * for aiming the cameras, not a second view of the room.
 */
function previewBounds(preview: boolean): { width: number; height: number; x?: number; y?: number } {
  // Sized to its contents: a title line, two 84 px previews side by side, and the gesture line.
  const size = { width: 336, height: 152 };
  if (!preview) return size;
  const area = screen.getPrimaryDisplay().workArea;
  return {
    ...size,
    x: Math.round(area.x + area.width - size.width - 16),
    y: Math.round(area.y + area.height - size.height - 16)
  };
}

const publish = (next: GestureStatus): void => {
  status = next;
  onStatus?.(status);
};

/** Somewhere for gestures and state to go: main wires these to the board window. */
export function setVisionHandlers(handlers: {
  onEvent: (event: ControlEvent) => void;
  onStatus: (status: GestureStatus) => void;
}): void {
  onEvent = handlers.onEvent;
  onStatus = handlers.onStatus;
}

export function visionStatus(): GestureStatus {
  return { ...status, enabled: getSettings().gesture.enabled };
}

/** Only this window may report gestures. Checked by `registerIpc` on every call. */
export function isVisionSender(sender: WebContents): boolean {
  return win !== null && !win.isDestroyed() && sender === win.webContents;
}

function create(): void {
  const all = getSettings();
  const settings = all.gesture;
  /*
   * Shown by default, and measured rather than chosen: hidden, this window landmarks at 11 and
   * 9 fps; visible, at 20 and 15. Chromium throttles a hidden window's video pipeline, and
   * `backgroundThrottling: false` does not reach that. So it is a small camera monitor in the
   * corner instead — click-through, unfocusable, and useful in its own right while a gesture rig is
   * being aimed. `streamMode` hides it whatever the setting says (docs/07): a stream must not
   * carry the room.
   */
  const preview = settings.preview !== false && !all.streamMode;
  const ses = session.fromPartition(PARTITION);
  // The one grant in the app. Everything else on this session, and every permission on every other
  // session, is refused (services/permissions.ts).
  allowMediaOnly(ses, 'vision');

  win = new BrowserWindow({
    /*
     * Hidden. Two consequences, both handled rather than hoped about:
     *   - a hidden window's presentation stops, so the page drives its loop on TIMERS and never on
     *     requestAnimationFrame. That is the false failure this project already paid for once
     *     (docs/DECISIONS.md, 2026-09-11: 0 fps for 48 s that was really 30 fps all along).
     *   - Chromium may also throttle or lose a hidden window's WebGL context, which is where the
     *     GPU delegate's 12.6 ms comes from. The page reports its own frame rate, so if that
     *     happens it shows up as a number instead of a mystery; the fallbacks are the CPU delegate
     *     (`gesture.delegate` in settings.json) or showing this window off to one side.
     */
    ...previewBounds(preview),
    show: preview,
    frame: false,
    skipTaskbar: true,
    resizable: false,
    // It must never take the keyboard from the board: a gesture rig that steals focus would stop
    // every shortcut working the moment the cameras came on.
    focusable: false,
    alwaysOnTop: preview,
    title: 'SkynetOS — vision',
    backgroundColor: '#0E1A14',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
      partition: PARTITION
    }
  });
  win.webContents.setBackgroundThrottling(false);
  // Clicks pass straight through to whatever is underneath. The monitor is something to glance at,
  // never something to hit by accident while reaching for the board.
  win.setIgnoreMouseEvents(true);

  win.webContents.on('render-process-gone', (_event, details) => {
    console.log(`[vision] render process gone: ${details.reason}`);
    publish({ ...status, phase: 'unavailable', error: `THE VISION WINDOW STOPPED — ${details.reason}` });
  });
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) console.log(`[vision] page: ${message.slice(0, 300)}`);
  });
  win.on('closed', () => { win = null; });

  const query = new URLSearchParams({
    hands: String(settings.hands),
    delegate: settings.delegate,
    cameras: settings.cameras.join(',')
  });
  void win.loadURL(`${SCHEME}://${HOST}/vision.html?${query.toString()}`);
  publish({ phase: 'starting', enabled: true, cameras: [] });
}

/** Start or stop manual control, and remember the choice. Desktop-only; see docs/07. */
export function setVisionEnabled(on: boolean): GestureStatus {
  const written = setGestureEnabled(on);
  if (!written.ok) {
    publish({ ...status, phase: 'unavailable', error: written.error ?? 'COULD NOT SAVE THE SETTING' });
    return visionStatus();
  }
  if (!on) {
    if (win && !win.isDestroyed()) win.destroy();
    win = null;
    publish({ ...VISION_OFF });
    return visionStatus();
  }

  const settings = getSettings().gesture;
  const ready = visionReadiness(settings, {
    model: Boolean(settings.model) && existsSync(settings.model),
    bundle: existsSync(join(mediapipeDir(), 'vision_bundle.mjs'))
  });
  if (!ready.ok) {
    publish({ phase: 'unavailable', enabled: true, cameras: [], error: ready.error });
    return visionStatus();
  }
  if (win && !win.isDestroyed()) {
    publish({ ...status, enabled: true });
    return visionStatus();
  }
  create();
  return visionStatus();
}

/** The page reporting its own state. */
export function reportVision(report: VisionReport): { ok: boolean } {
  publish({
    phase: report.phase,
    enabled: getSettings().gesture.enabled,
    cameras: report.cameras,
    ...(report.pose ? { pose: report.pose } : {}),
    ...(report.error ? { error: report.error } : {})
  });
  return { ok: true };
}

/**
 * A batch of gestures from the page, forwarded one at a time. Batched because at 26 fps per camera
 * a call per event would be thousands of IPC round trips a minute for events the board will coalesce
 * anyway.
 */
export function visionEvents(events: ControlEvent[]): { ok: boolean } {
  if (!onEvent) return { ok: false };
  for (const event of events) {
    /*
     * CLOSE THE BOOK: one hand shutting like a cover switches manual control off.
     *
     * Handled here rather than in the board, for two reasons. Switching the cameras off is main's
     * job — the board would only have to ask it — and the way OUT of gesture control must not
     * depend on the board being responsive, since a rig that has started misreading every pose is
     * exactly when he needs it. Deferred by a tick because this call arrives over IPC FROM the
     * window that `setVisionEnabled(false)` is about to destroy.
     */
    if (event.type === 'stopControl') {
      console.log('[vision] CLOSE THE BOOK — manual control off');
      setImmediate(() => setVisionEnabled(false));
      // Still forwarded: the board has a crosshair to put away, and leaving one on screen after
      // the hand that drove it has gone is a lie about what is still listening.
    }
    onEvent(event);
  }
  return { ok: true };
}

/**
 * Enter or leave the calibration and training wizard.
 *
 * The same page, told to be a wizard instead of a monitor, in a window big enough to be guided by:
 * the prompts have to be readable from where a hand can be held up, which a 336 px monitor is not.
 * Leaving puts the window back in its corner.
 *
 * It reloads rather than switching mode in place, which costs about two seconds of camera restart.
 * That is deliberate: a wizard that begins by tearing down and rebuilding the cameras starts from
 * a known state, and the alternative is two live modes sharing one set of landmarkers.
 */
export function setTrainMode(on: boolean): GestureStatus {
  if (!win || win.isDestroyed()) {
    // Training implies the cameras: switch manual control on first, then come back.
    const started = setVisionEnabled(true);
    if (started.phase === 'unavailable' || !win) return started;
  }
  const target = win;
  if (!target || target.isDestroyed()) return visionStatus();

  const settings = getSettings().gesture;
  const query = new URLSearchParams({
    hands: String(settings.hands),
    delegate: settings.delegate,
    cameras: settings.cameras.join(','),
    ...(on ? { mode: 'train' } : {})
  });

  if (on) {
    const area = screen.getPrimaryDisplay().workArea;
    const width = Math.min(820, area.width - 80);
    const height = Math.min(620, area.height - 80);
    target.setIgnoreMouseEvents(false);
    target.setBounds({
      width,
      height,
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + (area.height - height) / 2)
    });
    target.setFocusable(true);
    target.show();
    target.focus();
  } else {
    const preview = settings.preview !== false && !getSettings().streamMode;
    target.setIgnoreMouseEvents(true);
    target.setFocusable(false);
    const bounds = previewBounds(preview);
    target.setBounds({
      width: bounds.width,
      height: bounds.height,
      ...(bounds.x !== undefined && bounds.y !== undefined ? { x: bounds.x, y: bounds.y } : {})
    });
    if (!preview) target.hide();
  }
  void target.loadURL(`${SCHEME}://${HOST}/vision.html?${query.toString()}`);
  publish({ ...status, phase: 'starting' });
  return visionStatus();
}

/** On the way down, and when manual control is switched off by voice. */
export function stopVision(): void {
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
  status = { ...VISION_OFF };
}

/** Called once at startup: manual control comes back on if it was on when the app closed. */
export function restoreVision(): void {
  if (getSettings().gesture.enabled) setVisionEnabled(true);
}
