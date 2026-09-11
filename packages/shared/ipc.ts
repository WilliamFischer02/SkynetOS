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
import type { Board, BoardNode, Footprint, LaunchMode, NodeKind } from './types.js';
import type { UsageRoute, UsageSummary } from './usage.js';
import type { MailSide, MailboxMessage } from './mailbox.js';
import type { HardwareSnapshot } from './hardware.js';

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
  /**
   * `starting` is the window between asking for a terminal and that terminal proving it exists.
   * It is a real state, not a nicety: an elevated launch sits here on a UAC prompt, and the old
   * code's habit of jumping straight to `running` is how a launch that never happened got
   * reported as one. See src/main/services/terminal.ts.
   */
  state: 'starting' | 'running' | 'exited' | 'error';
  /** True when this launch continued an existing conversation rather than starting one. */
  resumed: boolean;
  exitCode?: number | null;
  error?: string;
}

/** A plain terminal opened on a node's directory — no agent, no conversation, no session row. */
export interface TerminalOpenResult {
  ok: boolean;
  /** The shell's pid, proved by the staged script reporting in. Null when the launch failed. */
  pid: number | null;
  /** Always returned. When a launch fails, this is the file to run by hand to find out why. */
  scriptFile: string;
  elevated: boolean;
  cwd: string;
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

/** A resolved build output, and whether it is behind the source that produces it. */
export interface ArtifactInfo {
  nodeId: string;
  target: TargetInfo;
  /** Just the filename, e.g. `thestalker-0.1.0.jar`. */
  fileName: string | null;
  /** Captured by the node's versionPattern, e.g. `0.1.0`. */
  version: string | null;
  /**
   * 'stale' when the producing repo has committed since this file was built, 'fresh' when it has
   * not, 'unknown' when there is no producer edge or no repo to ask. Never guessed.
   */
  stale: 'fresh' | 'stale' | 'unknown';
  producerId: string | null;
  lastCommit: string | null;
}

/** What a dropped file or folder should become. A suggestion — the wizard still shows it. */
export interface IngestSuggestion {
  path: string;
  kind: NodeKind;
  name: string;
  suggestedId: string;
  fields: Partial<BoardNode>;
  footprint: Footprint;
  /** Why this kind was chosen, in one sentence, shown in the wizard. */
  reason: string;
}

export interface AppSettingsView {
  devRoots: string[];
  reducedMotion: boolean;
  streamMode: boolean;
  confirmAllLaunches: boolean;
  plan: string | null;
  tokenBudget: number | null;
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
  /**
   * Set the plan and/or an exact token budget. The ONLY settings write there is.
   *
   * docs/07 keeps settings user-only so the rules deciding what an agent may touch are not
   * agent-writable. These two grant no access, allow no path and elevate nothing — they scale a
   * meter — so they are the one thing worth a control instead of a JSON edit. Everything that
   * does grant something is still file-only. See setUsagePlan in services/settings.ts.
   */
  'settings:setPlan': (plan: string | null, tokenBudget: number | null) =>
    { ok: boolean; error?: string };

  // --- target resolution: "does this point at something real?" ---
  'target:resolveNode': (boardId: string, nodeId: string) => NodeStatus;
  'target:resolveBoard': (boardId: string) => NodeStatus[];
  /** Verify a value the user is typing, before it is committed. The node wizard's gate. */
  'target:verify': (control: FieldControl, value: string, context?: Partial<BoardNode>) => TargetInfo;

  // --- the picker interface ---
  'pick:target': (request: PickRequest) => PickResult;

  // --- node images: the wallpaper that fills the footprint, and the logo centred on it ---
  'mosaic:forNode': (boardId: string, nodeId: string, slot?: 'face' | 'logo') => MosaicResult;

  /**
   * Real Claude usage, read off this machine's own conversation files.
   *
   * Drives the meter in the top-left corner and the couriers that carry packets across the board.
   * See packages/shared/usage.ts for what is measured and what is deliberately left null.
   */
  'usage:summary': () => UsageSummary;
  /**
   * The same usage, attributed to the nodes of one board.
   *
   * A room drive stands in for everything inside it, so the root board shows where the week
   * actually went without descending. Drives the couriers.
   */
  'usage:routes': (boardId: string) => UsageRoute[];

  /**
   * The machine itself, read live: CPU, GPU, memory, drives, whatever temperatures are readable,
   * and a list of what could not be read and why. Drives the system monitor that a `monitor.system`
   * node opens. Cached and rate-limited in main, and nothing is read unless someone asks. See
   * packages/shared/hardware.ts.
   */
  'hardware:snapshot': () => HardwareSnapshot;

  /**
   * The JARVIS mailbox — how the Face and the Hands talk to each other.
   *
   * The Face cannot see this disk, so SkynetOS is the wire: it writes what the Face said into
   * `codex/mailbox/to-hands/`, and hands back what the Hands wrote for the clipboard. Unread
   * to-hands mail is folded into the next session briefing, so nobody has to remember to look.
   * See src/main/services/mailbox.ts.
   */
  'mailbox:list': (side: MailSide) => MailboxMessage[];
  'mailbox:send': (side: MailSide, message: { from: string; subject: string; body: string }) =>
    { ok: boolean; file?: string; error?: string };
  'mailbox:archive': (side: MailSide, file: string) => { ok: boolean; error?: string };

  // --- artifacts ---
  'artifact:resolve': (boardId: string, nodeId: string) => ArtifactInfo;
  'artifact:resolveBoard': (boardId: string) => ArtifactInfo[];

  /**
   * Hand a real file drag to the OS. Called from the artifact badge's `dragstart`, and ONLY from
   * there — once this returns Windows owns the gesture. See services/drag-out.ts.
   */
  'drag:startFile': (boardId: string, nodeId: string) => { ok: boolean; file?: string; error?: string };

  // --- drop-in ingestion ---
  'ingest:classify': (paths: string[]) => IngestSuggestion[];
  'ingest:create': (boardId: string, suggestion: IngestSuggestion, pos: { x: number; y: number }) => { ok: boolean; nodeId?: string; error?: string };

  // --- watchers ---
  'watch:board': (boardId: string) => { watched: number; polled: number };

  /**
   * Put a new node of `kind` on the board, near `pos`.
   *
   * The other half of drop-in ingestion: a `group.zone` bracket or a `note.silk` heading has no
   * file to drag, so without this the sorting furniture on a board could only be added by
   * hand-editing JSON. Created unbound and provisional — see services/node-factory.ts.
   */
  'node:add': (
    boardId: string,
    kind: NodeKind,
    pos: { x: number; y: number },
    /**
     * Fields to set on the new node. Only a small allowlist is honoured — see the handler — so
     * this cannot become a way to write arbitrary board JSON from the renderer.
     */
    fields?: Partial<BoardNode>
  ) => { ok: boolean; nodeId?: string; error?: string };

  // --- act ---
  'node:open': (boardId: string, nodeId: string) => OpenTargetResult;

  // --- real sessions: the point of the whole board ---
  /** Launch or focus the Claude Code session for an agent.code node. */
  /**
   * Launch (or focus) an agent.code session.
   *
   * `fresh` is what separates the chip's two buttons: without it a click resumes the node's own
   * conversation, or focuses the session already running for it. With it, the stored conversation
   * id is ignored, a new one is minted, and the node's initial prompt is sent again.
   */
  /**
   * Start a Claude Code session on an agent node.
   *
   * `prompt` is a task the session opens already holding — it is appended to the briefing and
   * staged to a file, never put on a command line. It is how JARVIS Prime opens a terminal in the
   * right repo with the right job already in front of it.
   */
  'session:start': (
    boardId: string,
    nodeId: string,
    options?: { fresh?: boolean; prompt?: string }
  ) => SessionStartResult;
  'session:stop': (sessionId: string) => { ok: boolean; error?: string };
  'session:list': () => SessionInfo[];
  /** The resume command for this node, so it can be copied and run by hand. */
  'session:resumeCommand': (boardId: string, nodeId: string) => string | null;

  /**
   * Open a plain terminal on this node's directory — no agent, no conversation.
   *
   * The thing every repo node was missing: `openWith: 'terminal'` used to answer "TERMINAL LAUNCH
   * ARRIVES AT M3" and nothing else on the board could put you in a shell. `elevated` is the
   * admin variant and raises a UAC prompt, which is confirmed in main like every other elevation.
   */
  'terminal:open': (boardId: string, nodeId: string, options?: { elevated?: boolean }) => TerminalOpenResult;

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
  'settings:setPlan',
  'target:resolveNode',
  'target:resolveBoard',
  'target:verify',
  'pick:target',
  'mosaic:forNode',
  'usage:summary',
  'usage:routes',
  'hardware:snapshot',
  'mailbox:list',
  'mailbox:send',
  'mailbox:archive',
  'artifact:resolve',
  'artifact:resolveBoard',
  'drag:startFile',
  'ingest:classify',
  'ingest:create',
  'watch:board',
  'node:add',
  'node:open',
  'session:start',
  'session:stop',
  'session:list',
  'session:resumeCommand',
  'terminal:open',
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

/**
 * ── What an agent may reach ───────────────────────────────────────────────────────────────────
 *
 * This is the entire authority of JARVIS Prime, and of anything else that arrives over the
 * control channel. It is a subset of what the renderer can do, chosen against the authority table
 * in docs/07-SECURITY.md, and it is written as a list of things granted rather than a list of
 * things denied — a channel added to CHANNELS later is unreachable by an agent until someone
 * deliberately adds it here.
 *
 * Read the omissions as carefully as the entries:
 *
 * - `settings:setPlan` and anything else that writes settings. docs/07: "settings, allowlists and
 *   elevation are user-only". An agent that can edit the allowlist has no allowlist.
 * - `command:confirmDestructive`. This is the approval dialog itself. An agent calling it would be
 *   asking the user a question in its own voice and then reading the answer as consent —
 *   docs/07's "agents may never approve permission prompts" is exactly this.
 * - `pick:target`. Summons a native file dialog. An agent must not be able to put a modal in front
 *   of William that he might dismiss by reflex.
 * - `command:undo` / `command:redo`. The undo stack is shared with the user and is not per-actor.
 *   An agent reaching for undo does not revert its own work, it reverts whatever happened last,
 *   which may well be William's. Prime directive 5 gives HIM the undo, not the agent.
 * - `drag:startFile`. A drag-out hands a real file to whatever the OS drops it on.
 *
 * `command:apply` IS here, because it is the one door every board mutation goes through — schema
 * validation, snapshot, inverse, history. Letting an agent edit the board means letting it use
 * that door. What it does not mean is letting it walk through the lock: see `callAsAgent`.
 */
export const AGENT_METHODS = [
  // Read the board and what it points at.
  'board:load',
  'board:loadRoom',
  'board:list',
  'settings:read',
  'target:resolveNode',
  'target:resolveBoard',
  'target:verify',
  'artifact:resolve',
  'artifact:resolveBoard',
  'ingest:classify',
  'usage:summary',
  'usage:routes',
  /*
   * The machine's hardware readings. docs/07: "Read board, telemetry, sessions, codex — Allowed,
   * always." It is read-only and names nothing on disk, and it lets JARVIS answer "why is the build
   * slow" or "is the GPU hot" from measurement instead of asking William to look. The cost is
   * bounded in main: readings are cached for seconds, so an agent asking in a loop spawns nothing.
   */
  'hardware:snapshot',
  // Sessions and terminals on nodes the board already declares.
  'session:start',
  'session:stop',
  'session:list',
  'session:resumeCommand',
  'terminal:open',
  'service:list',
  'service:tail',
  // Open a node's real target — the same thing a double click does.
  'node:open',
  // Change the board.
  'node:add',
  'command:apply',
  'command:history',
  // Talk to the other half of JARVIS.
  'mailbox:list',
  'mailbox:send',
  'mailbox:archive'
] as const satisfies readonly Channel[];

export type AgentMethod = (typeof AGENT_METHODS)[number];

const AGENT_METHOD_SET: ReadonlySet<string> = new Set(AGENT_METHODS);

export function isAgentMethod(value: string): value is AgentMethod {
  return AGENT_METHOD_SET.has(value);
}

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
  /** A watched file changed. Carries the nodes that care, so the renderer can refresh just those. */
  'files:changed': { boardId: string; nodeIds: string[]; path: string; reason: string };
  /**
   * A mailbox message started a session on its own, or tried to.
   *
   * This reaches the UI because an autonomous launch that leaves no trace is worse than no
   * autonomous launch: William has to be able to see that something started, what asked for it,
   * and on which chip — without reading a log file.
   */
  'mail:dispatched': { file: string; subject: string; ok: boolean; nodeId?: string; error?: string };
  /**
   * A `monitor.system` node was activated. The node has no target on disk — it IS the reading — so
   * activating it opens the system monitor panel instead of opening a file. Sent by `openNode` in
   * src/main/ipc.ts, for the user only.
   */
  'monitor:open': { boardId: string; nodeId: string; name: string };
}

export type EventName = keyof SkynetEvents;

export const EVENTS = ['sessions:changed', 'services:changed', 'files:changed', 'mail:dispatched', 'monitor:open'] as const satisfies readonly EventName[];

/** The shape contextBridge exposes on window.skynet. */
export type SkynetBridge = {
  [K in Channel]: (...args: Parameters<SkynetApi[K]>) => Promise<ReturnType<SkynetApi[K]>>;
} & {
  /** Subscribe to a pushed event. Returns an unsubscribe function. */
  on: <K extends EventName>(event: K, handler: (payload: SkynetEvents[K]) => void) => () => void;
  /**
   * Real filesystem paths for dropped File objects. `File.path` was removed in Electron 32+;
   * this wraps `webUtils.getPathForFile`, which only reads paths the user chose by dropping them.
   */
  pathsForFiles: (files: File[]) => string[];
};
