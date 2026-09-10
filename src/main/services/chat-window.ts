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

/** Whether a conversation window is currently open for this node. */
export function chatWindowOpen(nodeId: string): boolean {
  const win = windows.get(nodeId);
  return Boolean(win && !win.isDestroyed());
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

  win.on('closed', () => windows.delete(node.id));
  windows.set(node.id, win);

  void win.loadURL(url);
  return { ok: true, focused: false };
}

function safeProtocol(url: string): string {
  try { return new URL(url).protocol; } catch { return ''; }
}
