/**
 * The IPC contract. One file, both sides.
 *
 * docs/07-SECURITY.md: "All IPC channels explicitly allowlisted and typed; no
 * ipcRenderer.invoke(arbitraryChannel) pass-through." CHANNELS below is that allowlist. The
 * preload iterates it to build window.skynet, and main refuses to register a handler for
 * anything not in it, so adding a channel is a deliberate edit to this file and nothing else.
 */

import type { Board } from './types.js';

/** What a board file's load attempt produced. A failure is data, not an exception. */
export type BoardLoad =
  | { ok: true; board: Board; file: string }
  | { ok: false; file: string; error: string };

export interface DisplayInfo {
  /** The OS scale factor, e.g. 1, 1.25, 1.5. */
  scaleFactor: number;
  /** The zoom factor applied to cancel it, so 1 CSS px == 1 device px. */
  appliedZoomFactor: number;
  workArea: { width: number; height: number };
}

/**
 * Every channel, its argument, and its result. Adding an entry here is the only way to add IPC.
 */
export interface SkynetApi {
  'board:load': (boardId: string) => BoardLoad;
  'board:list': () => string[];
  'display:info': () => DisplayInfo;
  'app:version': () => { app: string; electron: string; chrome: string; node: string };
}

export type Channel = keyof SkynetApi;

export const CHANNELS = [
  'board:load',
  'board:list',
  'display:info',
  'app:version'
] as const satisfies readonly Channel[];

export function isChannel(value: string): value is Channel {
  return (CHANNELS as readonly string[]).includes(value);
}

/** The shape contextBridge exposes on window.skynet. */
export type SkynetBridge = {
  [K in Channel]: (...args: Parameters<SkynetApi[K]>) => Promise<ReturnType<SkynetApi[K]>>;
};
