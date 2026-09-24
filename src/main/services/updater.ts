import { app } from 'electron';
import { UPDATE_CHECK_MS, UPDATE_FIRST_CHECK_MS, UPDATE_IDLE, type UpdateStatus } from '@shared/update.js';
import { getBuildInfo, homeChoice } from './home.js';

/**
 * Program updates for an installed SkynetOS, from the GitHub releases of its own repo.
 *
 * ── What it does ──────────────────────────────────────────────────────────────────────────────
 * Checks shortly after start and every six hours. A newer release is downloaded in the background
 * and installed when SkynetOS next closes; ABOUT shows where it has got to and offers RESTART AND
 * UPDATE. The installer is per user, so none of this raises an administrator prompt.
 *
 * ── What it may never touch ───────────────────────────────────────────────────────────────────
 * An update replaces the PROGRAM: the install folder. The boards, the codex and everything under
 * %APPDATA%/SkynetOS are outside it (packages/shared/home.ts) and are not the installer's to
 * change.
 *
 * ── Who may ask ───────────────────────────────────────────────────────────────────────────────
 * `update:check` and `update:install` are user-only: neither is in AGENT_METHODS or
 * REMOTE_METHODS. Installing restarts the app, which would end every session an agent was not
 * asked about; and a phone must not be able to restart the desktop it is reaching (docs/07).
 *
 * A dev build does none of it. `electron-updater` is imported only when packaged, so running from
 * source never loads it and never asks GitHub anything.
 */

type Listener = (status: UpdateStatus) => void;

let status: UpdateStatus = { ...UPDATE_IDLE };
const listeners = new Set<Listener>();
let timer: ReturnType<typeof setInterval> | null = null;
let updater: import('electron-updater').AppUpdater | null = null;

function set(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch };
  for (const l of listeners) l(status);
}

export function onUpdateStatus(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateStatus(): UpdateStatus {
  const home = homeChoice();
  return { ...status, current: app.getVersion(), build: getBuildInfo(), home: { path: home.home, source: home.source } };
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  if (!updater) return updateStatus();
  if (status.state === 'checking' || status.state === 'downloading') return updateStatus();
  set({ state: 'checking', error: null });
  try {
    await updater.checkForUpdates();
  } catch (err) {
    set({ state: 'error', error: firstLine(err), checkedAt: new Date().toISOString() });
  }
  return updateStatus();
}

/** Close, install the downloaded update, and start again. Refused unless one is actually ready. */
export function installUpdate(): { ok: boolean; error?: string } {
  if (!updater || status.state !== 'ready') return { ok: false, error: 'NO UPDATE HAS BEEN DOWNLOADED YET' };
  // isSilent, then run the new version afterwards.
  setImmediate(() => updater?.quitAndInstall(true, true));
  return { ok: true };
}

const firstLine = (err: unknown): string => String((err as Error)?.message ?? err).split('\n')[0]!.slice(0, 200);

export async function startUpdater(): Promise<void> {
  if (!app.isPackaged) { set({ state: 'dev' }); return; }
  try {
    const mod = await import('electron-updater');
    // CJS under an ESM import: the named export may sit on `default`.
    updater = (mod.autoUpdater ?? (mod as unknown as { default: typeof mod }).default.autoUpdater);
  } catch (err) {
    set({ state: 'error', error: `THE UPDATER DID NOT LOAD — ${firstLine(err)}` });
    return;
  }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = false;
  updater.logger = { info: (m: unknown) => console.log(`[update] ${String(m)}`), warn: (m: unknown) => console.warn(`[update] ${String(m)}`), error: (m: unknown) => console.error(`[update] ${String(m)}`), debug: () => undefined };

  updater.on('update-available', (info) => set({ state: 'downloading', next: info.version, percent: 0 }));
  updater.on('update-not-available', () => set({ state: 'current', next: null, percent: null, checkedAt: new Date().toISOString() }));
  updater.on('download-progress', (p) => set({ state: 'downloading', percent: p.percent }));
  updater.on('update-downloaded', (info) => set({ state: 'ready', next: info.version, percent: 100, checkedAt: new Date().toISOString() }));
  updater.on('error', (err) => set({ state: 'error', error: firstLine(err), checkedAt: new Date().toISOString() }));

  setTimeout(() => void checkForUpdate(), UPDATE_FIRST_CHECK_MS);
  timer = setInterval(() => void checkForUpdate(), UPDATE_CHECK_MS);
}

export function stopUpdater(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
