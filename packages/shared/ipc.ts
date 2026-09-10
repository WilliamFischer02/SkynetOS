/**
 * The IPC contract. One file, both sides.
 *
 * docs/07-SECURITY.md: "All IPC channels explicitly allowlisted and typed; no
 * ipcRenderer.invoke(arbitraryChannel) pass-through." CHANNELS below is that allowlist. The
 * preload iterates it to build window.skynet, and main refuses to register a handler for
 * anything not in it, so adding a channel is a deliberate edit to this file and nothing else.
 *
 * Note what is NOT here and never will be: a settings writer. docs/07 says settings, allowlists
 * and elevation policy are user-only. If there were a `settings:write` channel, the rules that
 * decide what an agent may touch would themselves be agent-writable.
 */

import type { CommandRequest, CommandResult, HistoryStatus } from './commands.js';
import type { FieldControl } from './node-fields.js';
import type { TargetInfo } from './targets.js';
import type { Board, BoardNode, LaunchMode } from './types.js';

/** What a board file's load attempt produced. A failure is data, not an exception. */
export type BoardLoad =
  | { ok: true; board: Board; file: string }
  | { ok: false; file: string; error: string; problems?: string[] };

export interface DisplayInfo {
  /** The OS scale factor, e.g. 1, 1.25, 1.5. */
  scaleFactor: number;
  /** The zoom factor applied to cancel it, so 1 CSS px == 1 device px. */
  appliedZoomFactor: number;
  workArea: { width: number; height: number };
}

/** A request for a native file/folder picker. */
export interface PickRequest {
  control: FieldControl;
  /** The field's current value, so the dialog can open somewhere useful. */
  current?: string;
  title?: string;
  filters?: readonly { name: string; extensions: string[] }[];
}

export interface PickResult {
  cancelled: boolean;
  /** The chosen value, already normalised for board JSON (forward slashes). */
  value: string | null;
  /** Set when the picker adjusted what was chosen, e.g. generalising a file to a glob. */
  note?: string;
  error?: string;
}

/** What the renderer needs to draw a node's live state and its inspector. */
export interface NodeStatus {
  nodeId: string;
  target: TargetInfo;
}

export interface OpenTargetResult {
  ok: boolean;
  action: string;
  target: TargetInfo;
  error?: string;
}

/**
 * A node's face image, downsampled and dithered onto the room's six palette colours.
 * See src/main/services/mosaic.ts.
 */
export type MosaicResult =
  | { ok: true; dataUrl: string; width: number; height: number; source: string; cached: boolean }
  | { ok: false; error: string };

/** A live (or just-ended) Claude Code session. */
export interface SessionInfo {
  id: string;
  boardId: string;
  nodeId: string;
  nodeName: string;
  designator: string | null;
  mode: LaunchMode;
  cwd: string;
  /** The Claude Code conversation id. This is what makes a chip reopen ITS conversation. */
  claudeSessionId: string | null;
  pid: number | null;
  startedAt: string;
  state: 'running' | 'exited' | 'error';
  /** True when this launch continued an existing conversation rather than starting one. */
  resumed: boolean;
  exitCode?: number | null;
  error?: string;
}

export type SessionStartResult =
  | { ok: true; session: SessionInfo; focused: boolean; note?: string }
  | { ok: false; error: string };

/** A long-running local service started from a `service.process` node. */
export interface ServiceInfo {
  id: string;
  boardId: string;
  nodeId: string;
  nodeName: string;
  command: string;
  cwd: string;
  port: number | null;
  pid: number | null;
  startedAt: string;
  state: 'running' | 'exited' | 'failed';
  exitCode?: number | null;
  error?: string;
}

export interface AppSettingsView {
  devRoots: string[];
  reducedMotion: boolean;
  streamMode: boolean;
  confirmAllLaunches: boolean;
}

/**
 * Every channel, its argument, and its result. Adding an entry here is the only way to add IPC.
 */
export interface SkynetApi {
  // --- read ---
  'board:load': (boardId: string) => BoardLoad;
  /** Descend into a room: resolve a drive.room's `boardFile` and load what it points at. */
  'board:loadRoom': (boardFile: string) => BoardLoad;
  'board:list': () => string[];
  'display:info': () => DisplayInfo;
  'app:version': () => { app: string; electron: string; chrome: string; node: string };
  'settings:read': () => AppSettingsView;

  // --- target resolution: "does this point at something real?" ---
  'target:resolveNode': (boardId: string, nodeId: string) => NodeStatus;
  'target:resolveBoard': (boardId: string) => NodeStatus[];
  /** Verify a value the user is typing, before it is committed. The node wizard's gate. */
  'target:verify': (control: FieldControl, value: string, context?: Partial<BoardNode>) => TargetInfo;

  // --- the picker interface ---
  'pick:target': (request: PickRequest) => PickResult;

  // --- node face images ---
  'mosaic:forNode': (boardId: string, nodeId: string) => MosaicResult;

  // --- act ---
  'node:open': (boardId: string, nodeId: string) => OpenTargetResult;

  // --- real sessions: the point of the whole board ---
  /** Launch or focus the Claude Code session for an agent.code node. */
  'session:start': (boardId: string, nodeId: string, force?: boolean) => SessionStartResult;
  'session:stop': (sessionId: string) => { ok: boolean; error?: string };
  'session:list': () => SessionInfo[];
  /** The resume command for this node, so it can be copied and run by hand. */
  'session:resumeCommand': (boardId: string, nodeId: string) => string | null;

  // --- service.process ---
  'service:start': (boardId: string, nodeId: string) => { ok: boolean; error?: string; info?: ServiceInfo };
  'service:stop': (boardId: string, nodeId: string) => { ok: boolean; error?: string };
  'service:list': () => ServiceInfo[];
  'service:tail': (boardId: string, nodeId: string) => string[];

  // --- mutate: one bus, one history, user and agent alike ---
  'command:apply': (request: CommandRequest) => CommandResult;
  'command:undo': () => CommandResult;
  'command:redo': () => CommandResult;
  'command:history': () => HistoryStatus;
  /** Ask the user to approve a destructive command. Returns true only if they said yes. */
  'command:confirmDestructive': (summary: string, detail: string) => boolean;
}

export type Channel = keyof SkynetApi;

export const CHANNELS = [
  'board:load',
  'board:loadRoom',
  'board:list',
  'display:info',
  'app:version',
  'settings:read',
  'target:resolveNode',
  'target:resolveBoard',
  'target:verify',
  'pick:target',
  'mosaic:forNode',
  'node:open',
  'session:start',
  'session:stop',
  'session:list',
  'session:resumeCommand',
  'service:start',
  'service:stop',
  'service:list',
  'service:tail',
  'command:apply',
  'command:undo',
  'command:redo',
  'command:history',
  'command:confirmDestructive'
] as const satisfies readonly Channel[];

export function isChannel(value: string): value is Channel {
  return (CHANNELS as readonly string[]).includes(value);
}

/**
 * Events pushed from main to the renderer. Separate from the request/response channels above and
 * equally allowlisted — a session that starts, exits or dies has to reach the dock without the
 * renderer polling for it.
 */
export interface SkynetEvents {
  'sessions:changed': SessionInfo[];
  'services:changed': ServiceInfo[];
}

export type EventName = keyof SkynetEvents;

export const EVENTS = ['sessions:changed', 'services:changed'] as const satisfies readonly EventName[];

/** The shape contextBridge exposes on window.skynet. */
export type SkynetBridge = {
  [K in Channel]: (...args: Parameters<SkynetApi[K]>) => Promise<ReturnType<SkynetApi[K]>>;
} & {
  /** Subscribe to a pushed event. Returns an unsubscribe function. */
  on: <K extends EventName>(event: K, handler: (payload: SkynetEvents[K]) => void) => () => void;
};
