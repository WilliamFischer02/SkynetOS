import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { CHANNELS, EVENTS, type EventName, type SkynetBridge, type SkynetEvents } from '@shared/ipc.js';

/**
 * The only bridge. Built by iterating the allowlists, so there is no way to invoke a channel or
 * subscribe to an event that is not in packages/shared/ipc.ts — no generic `invoke(channel, ...)`
 * and no generic `on(anyChannel)` escape hatch, which is what docs/07-SECURITY.md forbids.
 *
 * This preload runs with sandbox: true, so it may only import 'electron'. It must stay that way:
 * pulling in `node:fs` here would hand the renderer a filesystem, which is the whole thing the
 * process boundary exists to prevent.
 */
// Built dynamically from the allowlist, so the compiler cannot see the individual keys. The
// double assertion is the honest way to say "this shape is checked by CHANNELS, not by
// inference" — and CHANNELS is itself checked against SkynetApi with `satisfies`, so a channel
// that exists here but not in the contract is still a compile error, just one file over.
const bridge = Object.fromEntries(
  CHANNELS.map((channel) => [channel, (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)])
) as unknown as SkynetBridge;

/**
 * Event subscription, allowlisted the same way. The listener is wrapped so the renderer never
 * receives the IpcRendererEvent itself — that object carries a `sender` handle, and handing it
 * across the bridge would leak a way to reach back into main.
 */
bridge.on = <K extends EventName>(event: K, handler: (payload: SkynetEvents[K]) => void): (() => void) => {
  if (!(EVENTS as readonly string[]).includes(event)) {
    console.warn(`[preload] refused subscription to unlisted event "${event}"`);
    return () => undefined;
  }
  const wrapped = (_e: unknown, payload: SkynetEvents[K]): void => handler(payload);
  ipcRenderer.on(event, wrapped);
  return () => ipcRenderer.removeListener(event, wrapped);
};

/**
 * Turn dropped File objects back into real paths.
 *
 * `File.path` was removed in Electron 32+; `webUtils.getPathForFile` is the replacement and it
 * only exists in the preload. It reads a path the USER chose by dropping it — it cannot enumerate
 * anything, so it hands the renderer no capability it did not already have by dropping the file.
 */
bridge.pathsForFiles = (files: File[]): string[] =>
  files.map((f) => {
    try {
      return webUtils.getPathForFile(f);
    } catch {
      return '';
    }
  }).filter(Boolean);

contextBridge.exposeInMainWorld('skynet', bridge);
