import { join } from 'node:path';
import { app, BrowserWindow, screen, shell } from 'electron';
import { registerIpc } from './ipc.js';

const isDev = !app.isPackaged;

/**
 * Anti-mush rule 9: the window must not be fractionally scaled.
 *
 * Electron reports devicePixelRatio = osScaleFactor * zoomFactor in the renderer. At Windows'
 * 125% the OS factor is 1.25, so one CSS pixel covers 1.25 device pixels and every art pixel
 * lands on a fractional boundary — the exact shimmer this project treats as a crash-severity bug.
 *
 * docs/02 said to "snap to the nearest workable integer" zoom, but at 125% there is no workable
 * integer among the documented zooms: 1.25 * N is a whole number only for N in {4, 8, 12}, which
 * excludes zoom 2 and zoom 3 entirely. So instead of constraining the zoom, cancel the OS scale:
 * setZoomFactor(1 / scaleFactor) drives devicePixelRatio to exactly 1, and then 1 CSS px == 1
 * device px and every integer camera zoom is exact at any OS scaling. Logged either way.
 */
function neutralizeDisplayScaling(win: BrowserWindow): { scaleFactor: number; appliedZoomFactor: number } {
  const display = screen.getDisplayNearestPoint(win.getBounds());
  const scaleFactor = display.scaleFactor || 1;
  const appliedZoomFactor = 1 / scaleFactor;
  win.webContents.setZoomFactor(appliedZoomFactor);
  console.log(
    `[display] OS scaleFactor ${scaleFactor} -> zoomFactor ${appliedZoomFactor.toFixed(4)} ` +
    `(devicePixelRatio should now be 1; 1 art px = ${scaleFactor === 1 ? 1 : scaleFactor} device px at zoom 1)`
  );
  return { scaleFactor, appliedZoomFactor };
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0E1A14', // SKYNET mask-dark, so the first paint is already the board
    title: 'SkynetOS',
    autoHideMenuBar: true,
    webPreferences: {
      // docs/07-SECURITY.md. All four are hard requirements, not defaults to be relaxed later.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: join(__dirname, '../preload/index.cjs'),
      // Pixel art: never let Chromium apply its own smoothing to a canvas readback.
      backgroundThrottling: false
    }
  });

  win.once('ready-to-show', () => {
    neutralizeDisplayScaling(win);
    win.show();
  });

  // Re-apply when the window is dragged to a monitor with a different scale factor.
  win.on('moved', () => neutralizeDisplayScaling(win));

  /**
   * docs/07: deny every navigation and every new window. The only sanctioned way out of the app
   * is shell.openExternal for https:, which link.url nodes will use from the main process.
   */
  win.webContents.on('will-navigate', (event, url) => {
    const devServer = process.env['ELECTRON_RENDERER_URL'];
    if (isDev && devServer && url.startsWith(devServer)) return;
    event.preventDefault();
    console.warn(`[security] blocked in-window navigation to ${url}`);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    else console.warn(`[security] blocked window.open for non-https url ${url}`);
    return { action: 'deny' };
  });

  const devServer = process.env['ELECTRON_RENDERER_URL'];
  if (isDev && devServer) void win.loadURL(devServer);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));

  return win;
}

/**
 * Headless smoke capture. `node tools/smoke-shot.mjs` sets SKYNET_SMOKE_DIR and this drives the
 * window: let it settle, screenshot it, hold D to pan, screenshot again, report devicePixelRatio,
 * quit. It is how M0's exit criterion ("a window opens showing a tiled substrate at 3x, WASD pans
 * it") gets demonstrated instead of claimed, and it is the seed of the M5 golden-image diff.
 */
async function runSmokeCapture(win: BrowserWindow, outDir: string): Promise<void> {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  mkdirSync(outDir, { recursive: true });

  const shoot = async (name: string) => {
    const image = await win.webContents.capturePage();
    const file = join(outDir, name);
    writeFileSync(file, image.toPNG());
    const size = image.getSize();
    console.log(`[smoke] ${name}  ${size.width}x${size.height}`);
    return file;
  };

  try {
    await wait(2500); // font load + Pixi init + first frames
    const dpr = await win.webContents.executeJavaScript('window.devicePixelRatio');
    console.log(`[smoke] devicePixelRatio = ${String(dpr)} (must be 1 for pixel purity)`);

    await shoot('01-initial-3x.png');

    // Hold D. sendInputEvent goes through the same path as a real key, so this exercises the
    // actual listener rather than poking the camera directly.
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'd' });
    await wait(1200);
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'd' });
    await wait(200);
    await shoot('02-after-pan-right.png');

    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: '4' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: '4' });
    await wait(400);
    await shoot('03-zoom-4x.png');

    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: '2' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: '2' });
    await wait(400);
    await shoot('04-zoom-2x.png');

    console.log('[smoke] done');
  } catch (err) {
    console.error('[smoke] FAILED', err);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
}

app.whenReady().then(() => {
  // Chromium's own scaling must not compound with ours.
  registerIpc();
  const win = createWindow();

  const smokeDir = process.env['SKYNET_SMOKE_DIR'];
  if (smokeDir) win.once('ready-to-show', () => void runSmokeCapture(win, smokeDir));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Nothing in this app has any business loading remote code into the main window.
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, cb) => {
    const devServer = process.env['ELECTRON_RENDERER_URL'];
    if (isDev && devServer && details.url.startsWith(devServer)) return cb({});
    console.warn(`[security] blocked remote request from the main window: ${details.url}`);
    cb({ cancel: true });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
