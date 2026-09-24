import { BrowserWindow, shell } from 'electron';
import type { BoardNode } from '@shared/types.js';

/**
 * The conversation window: a real, separate desktop window holding a claude.ai conversation.
 *
 * Why this exists instead of `shell.openExternal`: opening the JARVIS chip used to append a tab
 * to whatever browser happened to be default, in among thirty other tabs, with the browser's
 * title and the browser's chrome. It read as "a link SkynetOS knows about" rather than "the
 * agent that lives on this board". A window with its own title, its own taskbar entry and its own
 * cookie jar reads as its own thing, which is the entire point of the JARVIS chip.
 *
 * docs/07 is unambiguous about what this window is allowed to be: "runs in its own partition and
 * has no preload, no bridge, no access to SkynetOS APIs. It is a browser tab, nothing more."
 * So there is deliberately no `preload` key below, and there never should be. Whatever JARVIS
 * decides in here reaches this machine through the Hands — a Claude Code session that asks for
 * permission — and never through this window.
 *
 * The partition is per node (`persist:jarvis` by default), which is what keeps the login alive
 * between launches and keeps it out of the app's own session.
 */

const windows = new Map<string, BrowserWindow>();
/** The node each open window belongs to, so a face can be attached after the fact. */
const nodes = new Map<string, BoardNode>();
const openedListeners = new Set<(node: BoardNode, win: BrowserWindow) => void>();

/** Called for every conversation window as it opens. The JARVIS face window hangs off this. */
export function onChatWindowOpened(listener: (node: BoardNode, win: BrowserWindow) => void): () => void {
  openedListeners.add(listener);
  return () => openedListeners.delete(listener);
}

/** Every open conversation window, with its node. */
export function openChatWindows(): { node: BoardNode; win: BrowserWindow }[] {
  const out: { node: BoardNode; win: BrowserWindow }[] = [];
  for (const [id, win] of windows) {
    const node = nodes.get(id);
    if (node && !win.isDestroyed()) out.push({ node, win });
  }
  return out;
}

/** Whether a conversation window is currently open for this node. */
export function chatWindowOpen(nodeId: string): boolean {
  const win = windows.get(nodeId);
  return Boolean(win && !win.isDestroyed());
}

/**
 * The conversation window for a node, if one is open.
 *
 * For services/prompt-send.ts, which types a prompt node's message into it from MAIN. The page is
 * handed fixed scripts and gives back small JSON answers; it still gets no preload, no bridge and
 * no handle on anything in SkynetOS.
 */
export function chatWindowFor(nodeId: string): BrowserWindow | null {
  const win = windows.get(nodeId);
  return win && !win.isDestroyed() ? win : null;
}

/** Close a node's conversation window, if it has one. */
export function closeChatWindow(nodeId: string): void {
  const win = windows.get(nodeId);
  if (win && !win.isDestroyed()) win.close();
  windows.delete(nodeId);
}

/** Close every conversation window. Called on quit so none outlive the app. */
export function closeAllChatWindows(): void {
  for (const nodeId of [...windows.keys()]) closeChatWindow(nodeId);
}

/**
 * Open (or focus) the conversation window for a node.
 *
 * Focusing rather than opening a second one is the same rule the agent chips follow: one node,
 * one conversation. A second window on the same partition would be the same conversation twice.
 */
export function openChatWindow(node: BoardNode, url: string): { ok: boolean; focused: boolean } {
  const existing = windows.get(node.id);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return { ok: true, focused: true };
  }

  const title = node.designator ? `${node.designator} ${node.name}` : node.name;
  const win = new BrowserWindow({
    width: 520,
    height: 900,
    minWidth: 380,
    minHeight: 480,
    title,
    // The OS window title is ours, not the page's. A page that renames itself to "Claude" every
    // time you switch conversations defeats the reason this is a separate window at all.
    webPreferences: {
      partition: node.partition ?? 'persist:jarvis',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true
    }
  });

  // Electron lets the page overwrite the window title by default. It may not.
  win.on('page-title-updated', (event) => event.preventDefault());

  /*
   * Sign-in flows open popups — a Google or Apple OAuth window is a real `window.open`, and
   * denying it means never being able to log in. So a popup is allowed, but only as another
   * window of exactly this kind: same partition, same no-preload rules, https only. Anything
   * else is handed to the real browser, where it is somebody else's problem.
   */
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    let scheme = '';
    try { scheme = new URL(target).protocol; } catch { scheme = ''; }
    if (scheme !== 'https:') {
      if (scheme === 'http:') void shell.openExternal(target);
      return { action: 'deny' };
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 480,
        height: 720,
        webPreferences: {
          partition: node.partition ?? 'persist:jarvis',
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true
        }
      }
    };
  });

  // Nothing but http(s) may ever be navigated to. A `file://` navigation inside a window with a
  // live claude.ai session is the shape of a very bad day.
  win.webContents.on('will-navigate', (event, target) => {
    if (!/^https?:$/.test(safeProtocol(target))) event.preventDefault();
  });

  win.on('closed', () => { windows.delete(node.id); nodes.delete(node.id); });
  windows.set(node.id, win);
  nodes.set(node.id, node);
  watchLoading(node, win, title);

  /*
   * Listeners (the JARVIS face) attach AFTER the page's first full load, or 3 s in if it never
   * finishes, so nothing of SkynetOS's touches claude.ai while it boots. Changed 2026-09-11: the
   * Face window hung on claude.ai's spinner while its face rendered, and the face was the one new
   * thing reaching into the page mid-load. The fallback keeps the face appearing even if the page
   * itself is what hangs.
   */
  let notified = false;
  const notify = (): void => {
    if (notified || win.isDestroyed()) return;
    notified = true;
    for (const listener of openedListeners) {
      try { listener(node, win); } catch (err) { console.warn('[chat] window-opened listener failed:', err); }
    }
  };
  win.webContents.once('did-finish-load', notify);
  setTimeout(notify, 3000);

  void win.loadURL(url);
  return { ok: true, focused: false };
}

/**
 * Make a conversation window diagnosable and recoverable without SkynetOS's help.
 *
 * - Ctrl+R reloads; Ctrl+Shift+R clears THIS window's HTTP cache (the login cookies stay) and
 *   reloads; F12 opens DevTools in its own window. The window has no browser chrome, so without
 *   these a stuck page could only be fixed by closing it.
 * - Failed loads, a crashed or hung renderer and page errors are logged as `[chat]`.
 * - A watchdog: 45 s after a load starts, if the page still has no message box, the window title
 *   says so and names the key that fixes it. Read-only check, like the face's streaming probe.
 */
function watchLoading(node: BoardNode, win: BrowserWindow, title: string): void {
  const wc = win.webContents;
  let errors = 0;
  wc.on('did-fail-load', (_event, code, desc, failedUrl, isMainFrame) => {
    if (isMainFrame) console.warn(`[chat] ${node.id}: failed to load ${failedUrl} (${code} ${desc})`);
  });
  wc.on('render-process-gone', (_event, details) => console.warn(`[chat] ${node.id}: page process gone (${details.reason})`));
  win.on('unresponsive', () => console.warn(`[chat] ${node.id}: window unresponsive`));
  wc.on('console-message', (event) => {
    const e = event as unknown as { level?: string | number; message?: string };
    if ((e.level === 'error' || e.level === 3) && errors++ < 20) console.warn(`[chat] ${node.id} page error: ${String(e.message ?? '').slice(0, 240)}`);
  });

  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.control && input.key.toLowerCase() === 'r') {
      event.preventDefault();
      if (input.shift) void wc.session.clearCache().then(() => wc.reloadIgnoringCache());
      else wc.reload();
    } else if (input.key === 'F12') {
      event.preventDefault();
      wc.openDevTools({ mode: 'detach' });
    }
  });

  let watchdog: ReturnType<typeof setTimeout> | null = null;
  wc.on('did-start-loading', () => {
    if (watchdog) clearTimeout(watchdog);
    if (!win.isDestroyed()) win.setTitle(title);
    watchdog = setTimeout(() => {
      if (win.isDestroyed()) return;
      void wc.executeJavaScript(
        `Boolean(document.querySelector('[contenteditable="true"], textarea') || /\\/login/.test(location.pathname))`,
        false
      ).then((ready: unknown) => {
        if (ready === true || win.isDestroyed()) return;
        console.warn(`[chat] ${node.id}: no message box after 45 s (still loading: ${wc.isLoading()})`);
        win.setTitle(`${title} — STILL LOADING · Ctrl+Shift+R reloads without cache · F12 shows why`);
      }).catch(() => undefined);
    }, 45_000);
  });
  win.on('closed', () => { if (watchdog) clearTimeout(watchdog); });
}

function safeProtocol(url: string): string {
  try { return new URL(url).protocol; } catch { return ''; }
}
