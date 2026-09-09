import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type SkynetBridge } from '@shared/ipc.js';

/**
 * The only bridge. Built by iterating the allowlist, so there is no way to invoke a channel that
 * is not in packages/shared/ipc.ts — no generic `invoke(channel, ...)` escape hatch, which is
 * what docs/07-SECURITY.md forbids.
 *
 * This preload runs with sandbox: true, so it may only import 'electron'. It must stay that way:
 * pulling in `node:fs` here would hand the renderer a filesystem, which is the whole thing the
 * process boundary exists to prevent.
 */
const bridge = Object.fromEntries(
  CHANNELS.map((channel) => [channel, (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)])
) as SkynetBridge;

contextBridge.exposeInMainWorld('skynet', bridge);
