import { readFileSync } from 'node:fs';
import { app, Menu, nativeImage, screen, Tray, type BrowserWindow, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import { TRAY_ICONS, TRAY_TOOLTIP, trayIconFor, trayIconPath, trayMenuTemplate, type TrayAction, type TrayState } from '@shared/tray.js';
import { autostartState, setAutostart } from './autostart.js';
import { desktopHandlersInUse, desktopStatus, setDesktopEnabled } from './desktop.js';
import { openHologram } from './hologram-window.js';
import { programRoot } from './home.js';
import { boardWindow } from './main-window.js';
import { getSettings } from './settings.js';
import { setVoiceEnabled } from './voice.js';

/**
 * The tray icon (roadmap M13.5; docs/11 § The window): a second home for the board and the JARVIS
 * Voice window when both are minimised.
 *
 * MAIN-PROCESS ONLY. It opens no IPC channel: every item calls the main-side function that
 * William's own switches already reach through user-only channels (`voice:setEnabled`,
 * `desktop:setEnabled`, `app:setAutostart`, `hologram:open`), never `callAsAgent` or
 * `callAsRemote`. The tray is on William's taskbar; only his pointer can press it.
 *
 *   left click   the board, shown, restored and focused
 *   right click  the menu (packages/shared/tray.ts `trayMenuTemplate`), built fresh each time so
 *                the ticks are the state now rather than the state at start
 *   Quit         `app.quit()`: before-quit, every window closes, will-quit. The same path as
 *                closing the board window (index.ts quits when the board closes).
 *
 * `tray.minimizeToTray` (settings.json, default false): minimising the board hides it instead, and
 * the tray brings it back. Only while the tray actually exists, so a missing icon can never leave
 * the board hidden with no way back.
 */

let tray: Tray | null = null;
/** The Run value, read in the background: a reg.exe query is too slow to hold a click on. */
let autostart: { supported: boolean; enabled: boolean } | null = null;

function refreshAutostart(): Promise<void> {
  return autostartState()
    .then((s) => { autostart = { supported: s.supported, enabled: s.enabled }; })
    .catch((err: unknown) => { console.warn('[tray] could not read Start with Windows:', (err as Error).message); });
}

/**
 * Both sizes in one image: 16 px as the 1x representation and 32 px as the 2x, so Windows takes
 * the one that matches the display's scale. A file that will not load is logged and skipped; with
 * neither, the image is empty and the tray still works (an empty slot, but a clickable one).
 */
function loadIcon(): NativeImage {
  const root = programRoot();
  const image = nativeImage.createEmpty();
  for (const icon of TRAY_ICONS) {
    const path = trayIconPath(root, icon.file);
    try {
      const buffer = readFileSync(path);
      image.addRepresentation({ scaleFactor: icon.scale, width: icon.size, height: icon.size, buffer });
    } catch (err) {
      console.warn(`[tray] icon ${path} did not load: ${(err as Error).message}`);
    }
  }
  if (image.isEmpty()) console.warn(`[tray] no tray icon loaded from ${trayIconPath(root, '')} — run \`npm run icon:tray\``);
  else {
    let scale = 1;
    try { scale = screen.getPrimaryDisplay().scaleFactor || 1; } catch { /* no display yet */ }
    console.log(`[tray] display scale ${scale}: ${trayIconFor(scale).file}`);
  }
  return image;
}

/** The board: shown if hidden to the tray, restored if minimised, and given focus. */
export function showBoard(): void {
  const win = boardWindow();
  if (!win) { console.warn('[tray] there is no board window to show'); return; }
  // Shown first: a board hidden by minimise-to-tray is still minimised underneath, and restore()
  // is what brings it back to its place.
  if (!win.isVisible()) win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}

function state(): TrayState {
  const s = getSettings();
  return {
    voice: s.voice.enabled === true,
    desktop: s.desktop.enabled === true,
    autostart: autostart ? autostart.enabled : null,
    autostartSupported: autostart ? autostart.supported : process.platform === 'win32'
  };
}

function act(action: TrayAction, checked: boolean): void {
  try {
    switch (action) {
      case 'openBoard':
        showBoard();
        break;
      case 'openHologram':
        openHologram();
        break;
      case 'toggleVoice':
        // The service's switch: writes `voice.enabled` and starts or hard-mutes, and pushes
        // `voice:state` to the board and the hologram, exactly as the VOICE switch does.
        setVoiceEnabled(checked);
        break;
      case 'toggleDesktop': {
        setDesktopEnabled(checked);
        // The hologram's DESK switch reads `desktop:status` again when it sees a state that is not
        // busy; nothing else announces the switch.
        desktopHandlersInUse()?.onState({ busy: desktopStatus().busy });
        break;
      }
      case 'toggleAutostart':
        void setAutostart(checked).then((result) => {
          autostart = { supported: result.supported, enabled: result.enabled };
          if (!result.ok) console.warn(`[tray] Start with Windows: ${result.error ?? 'failed'}`);
        });
        break;
      case 'quit':
        app.quit();
        break;
    }
  } catch (err) {
    console.warn(`[tray] ${action} failed: ${(err as Error).message}`);
  }
}

function buildMenu(): Menu {
  const items: MenuItemConstructorOptions[] = trayMenuTemplate(state()).map((item) => {
    if (item.type === 'separator') return { type: 'separator' };
    const id = item.id;
    if (item.type === 'checkbox') {
      return { type: 'checkbox', label: item.label, checked: item.checked, enabled: item.enabled !== false, click: (menuItem) => act(id, menuItem.checked) };
    }
    return { type: 'normal', label: item.label, enabled: item.enabled !== false, click: () => act(id, false) };
  });
  return Menu.buildFromTemplate(items);
}

/** At app ready, after the board window exists. Never throws: a tray that fails is logged. */
export function initTray(): void {
  if (tray) return;
  void refreshAutostart();
  try {
    tray = new Tray(loadIcon());
  } catch (err) {
    console.warn(`[tray] could not create the tray icon: ${(err as Error).message}`);
    tray = null;
    return;
  }
  tray.setToolTip(TRAY_TOOLTIP);
  tray.on('click', () => showBoard());
  tray.on('right-click', () => {
    if (!tray) return;
    tray.popUpContextMenu(buildMenu());
    // The LOOK panel can change the Run value too; the next menu shows it.
    void refreshAutostart();
  });
}

/**
 * `tray.minimizeToTray`: the board's minimise hides it (off the taskbar) instead, while the tray is
 * up. Read at each minimise, so a hand-edited setting takes effect with the next settings read.
 */
export function attachMinimizeToTray(win: BrowserWindow): void {
  win.on('minimize', () => {
    if (!tray || tray.isDestroyed() || !getSettings().tray.minimizeToTray) return;
    win.hide();
  });
}

/** At will-quit: Windows leaves a dead icon in the tray until hovered unless it is destroyed. */
export function destroyTray(): void {
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
}
