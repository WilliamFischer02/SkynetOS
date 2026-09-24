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
import type { ControlEvent } from './gesture-control.js';
import type { Analysis } from './gesture-analysis.js';
import type {
  FrameCount,
  GestureLibrary,
  HandMode,
  LibraryHealth,
  SampleVariant,
  SampleVerdict,
  SaveGestureInput
} from './gesture-library.js';
import type { CalibrationProfile } from './calibration.js';
import type { GestureStatus, VisionReport } from './vision.js';
import type { VoiceCapture, VoiceHeard, VoiceListen, VoiceStatus, VoiceWake } from './voice.js';
import type { FieldControl } from './node-fields.js';
import type { TargetInfo } from './targets.js';
import type { Board, BoardNode, Footprint, LaunchMode, NodeKind, Phantom } from './types.js';
import type { PhantomProposal } from './phantoms.js';
import type { UsageRoute, UsageSummary } from './usage.js';
import type { MailSide, MailboxMessage } from './mailbox.js';
import type { PromptFileInfo, PromptSendRequest, PromptSendResult } from './prompt.js';
import type { HardwareSnapshot } from './hardware.js';
import type { FableStatus } from './model-availability.js';
import type { ExplorerListing } from './explorer.js';
import type { BoardClipboard } from './clipboard.js';
import type { RemoteStatusView } from './remote.js';
import type { TaskStatusView } from './schedule.js';
import type { FinanceStatus } from './finance.js';
import type { AutostartState } from './boot.js';
import type { UpdateStatus } from './update.js';
import type { AwayLogEvent, AwayStatus } from './away.js';
import type { AwayMode } from './presence.js';
import type { AvatarMood, AvatarPayload } from './avatar.js';

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
  | { ok: true; dataUrl: string; width: number; height: number; source: string; cached: boolean; animation?: MosaicAnimation }
  | { ok: false; error: string };

/**
 * An animated GIF, every kept frame already composited and dithered onto the room's palette at the
 * same size as `dataUrl` (which is frame 0). The board steps through them by their own delays.
 * Absent for every still image, and for a GIF with one frame or `imageAnimate: false`.
 */
export interface MosaicAnimation {
  frames: string[];
  /** Milliseconds per frame, already clamped (packages/shared/gif.ts). */
  delays: number[];
  /** Frames were dropped to stay inside the caps; `note` says how many and why. */
  truncated: boolean;
  note: string | null;
  /** RGBA bytes across the kept frames, for the inspector and the log. */
  decodedBytes: number;
}

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
  /**
   * Program updates (src/main/services/updater.ts, docs/09-RELEASE.md). `update:status` is read-only.
   * `update:check` and `update:install` are USER ONLY, in neither AGENT_METHODS nor REMOTE_METHODS:
   * installing restarts the app, which ends sessions nobody asked an agent about, and a phone must
   * not be able to restart the desktop it is reaching.
   */
  'update:status': () => UpdateStatus;
  'update:check': () => UpdateStatus;
  'update:install': () => { ok: boolean; error?: string };
  /**
   * "Start SkynetOS with Windows": a per-user Run value plus a generated login script. USER ONLY,
   * both. Neither is in AGENT_METHODS: an agent can never make SkynetOS start itself (docs/07).
   */
  'app:autostart': () => AutostartState;
  'app:setAutostart': (on: boolean) => AutostartState & { ok: boolean; error?: string };
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
  /** The room's tiled background (Board.look.tileImage), square-checked and dithered like a backdrop. */
  'mosaic:boardTile': (boardId: string) => MosaicResult;

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
  'hardware:snapshot': (options?: { light?: boolean }) => HardwareSnapshot;

  /**
   * Is Fable available, when does it come back, and which model does a new session get? Read from
   * the transcripts' own refusal records. See packages/shared/model-availability.ts.
   */
  'models:status': () => FableStatus;
  /**
   * Set (or clear, with null) when Fable comes back, for a refusal whose restart time the CLI did
   * not write down. User-only: an agent may not move the restart to keep itself on a model.
   */
  'models:setFableReset': (iso: string | null) => { ok: boolean; error?: string };

  /**
   * Away (sleep) mode. USER ONLY, all four, none in AGENT_METHODS: an agent must not be able to put
   * the app to sleep and so hand itself the autonomous loop, or change the level that loop runs at.
   * See src/main/services/presence.ts and packages/shared/away.ts.
   */
  'away:status': () => AwayStatus;
  'away:sleepNow': () => { ok: boolean; error?: string };
  'away:wake': () => AwayStatus;
  /** Mode (every level but `work`, which is settings.json only), minutes and model. */
  'away:setMode': (patch: { mode?: AwayMode; afterMinutes?: number; model?: string }) => { ok: boolean; error?: string };

  /**
   * The prompt node: a quick-chat box on the board that sends to the Face. See
   * packages/shared/prompt.ts and src/main/services/prompt-send.ts.
   *
   * USER ONLY, all three. None is in AGENT_METHODS: `prompt:send` types into William's own
   * claude.ai conversation, and `prompt:pickFiles` raises a native dialog. The renderer sends
   * PATHS; main reads the bytes itself.
   */
  'prompt:pickFiles': () => { paths: string[] };
  'prompt:describeFiles': (paths: string[]) => PromptFileInfo[];
  'prompt:send': (request: PromptSendRequest) => PromptSendResult;
  /**
   * A PROMPT → NODE box's send: open a FRESH JARVIS Prime terminal whose task is to build the node
   * William described. USER ONLY, like the rest of `prompt:*`: an agent must not be able to open a
   * Prime terminal on the desktop by typing into a box. See packages/shared/node-build.ts.
   */
  'prompt:build': (request: PromptSendRequest) => PromptSendResult;

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

  /**
   * The file explorer node: a retro browser over one real folder. See packages/shared/explorer.ts.
   *
   * `explorer:list` reads one folder under the node's root — `rel` is relative to it, null for the
   * resting folder — and refuses anything that resolves outside the root, junctions included. It
   * never writes. `explorer:open` opens (or reveals) an entry with its default app; a file that runs
   * code is confirmed every time. `explorer:drag` hands one file to the OS as a drag-out.
   */
  'explorer:list': (boardId: string, nodeId: string, rel: string | null) => ExplorerListing;
  'explorer:open': (boardId: string, nodeId: string, rel: string, mode?: 'open' | 'reveal' | 'notepadpp' | 'obsidian') =>
    { ok: boolean; action?: string; error?: string };
  'explorer:drag': (boardId: string, nodeId: string, rel: string) => { ok: boolean; file?: string; error?: string };

  // --- drop-in ingestion ---
  'ingest:classify': (paths: string[]) => IngestSuggestion[];
  'ingest:create': (boardId: string, suggestion: IngestSuggestion, pos: { x: number; y: number }) => { ok: boolean; nodeId?: string; error?: string };

  // --- watchers ---
  'watch:board': (boardId: string) => { watched: number; polled: number; waiting: number };

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

  /**
   * Paste copied nodes (and the traces between them) with the cluster's top-left at `anchor`, as
   * one `node.createMany`. USER ONLY: agents have node_create, and a paste is William's gesture.
   */
  'node:paste': (
    boardId: string,
    clip: BoardClipboard,
    anchor: { x: number; y: number }
  ) => { ok: boolean; nodeIds?: string[]; error?: string };

  /**
   * "Summon JARVIS" on a node: a fresh JARVIS Prime session whose task is that node and William's
   * directive. USER ONLY: an agent must not be able to open terminals on the desktop by summoning.
   */
  'jarvis:summon': (boardId: string, nodeId: string, directive: string) => SessionStartResult;

  /**
   * The JARVIS avatar's frames (assets/avatar/<name>, default jarvis), as data URLs, validated.
   * Read-only. The face windows and the board both draw from it.
   */
  'avatar:frames': (name?: string) => AvatarPayload;
  /** Whether face windows are on, how many are open, and where the frames go. */
  'avatar:status': () => { enabled: boolean; faces: number; folder: string };
  /**
   * The face windows' global switch. USER ONLY, not in AGENT_METHODS: it opens windows on William's
   * desktop, and only he decides whether JARVIS has a face there.
   */
  'avatar:setEnabled': (on: boolean) => { ok: boolean; enabled: boolean; error?: string };
  /**
   * PREVIEW FACE: a free-standing face window alternating talking and idle, to see the frames
   * without a session. A second call closes it. USER ONLY: an agent has no reason to pop windows.
   */
  'avatar:preview': () => { ok: boolean; open: boolean };
  /**
   * The nodes on the room in view that show the ANIMATED face as their logo. Main watches exactly
   * those (services/avatar-mood.ts) and pushes `avatar:nodeMood` when one starts or stops talking.
   * An empty list stops the watching. Answers with the moods known now.
   */
  'avatar:watchNodes': (boardId: string, nodeIds: string[]) => { ok: boolean; moods: Record<string, AvatarMood> };

  /** A scheduled task's next run, last result and what it does. See services/scheduler.ts. */
  'task:status': (boardId: string, nodeId: string) => TaskStatusView;
  /**
   * Run a scheduled task now, exactly as its schedule would. USER ONLY: a scheduled `agent.run`
   * opens a Prime terminal on the desktop, and only William's click may do that on demand.
   */
  'task:runNow': (boardId: string, nodeId: string) => { ok: boolean; message: string };
  /**
   * The finance report (private/finance/report.json, written by `npm run finance:report`), or why
   * there is none. Board window only: not in AGENT_METHODS or REMOTE_METHODS. It carries balances.
   */
  'finance:status': () => FinanceStatus;

  // --- act ---
  'node:open': (boardId: string, nodeId: string) => OpenTargetResult;
  /**
   * How many times each node has been opened by William through SkynetOS, keyed `boardId/nodeId`. Read by the
   * MATRIX, where a file floats higher the more it is visited. Board and desktop only: in neither allowlist.
   */
  'node:visits': () => Record<string, number>;

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

  /**
   * Recommended nodes — phantoms. See packages/shared/phantoms.ts.
   *
   * `phantom:list` and `phantom:propose` are open to agents: sketching a suggestion is the whole
   * point, and the cap of four per board is enforced by the bus, not by the agent's manners.
   * `phantom:approve` and `phantom:dismiss` are the tick and the cross on the board and are
   * USER ONLY. An agent withdraws its own suggestion through `command:apply` (`phantom.dismiss`),
   * where the bus checks that it is its own.
   */
  'phantom:list': (boardId: string) => Phantom[];
  'phantom:propose': (boardId: string, proposal: PhantomProposal) => { ok: boolean; phantomId?: string; error?: string };
  'phantom:approve': (boardId: string, phantomId: string) => { ok: boolean; nodeId?: string; error?: string };
  'phantom:dismiss': (boardId: string, phantomId: string) => { ok: boolean; error?: string };

  // --- mutate: one bus, one history, user and agent alike ---
  'command:apply': (request: CommandRequest) => CommandResult;
  'command:undo': () => CommandResult;
  'command:redo': () => CommandResult;
  'command:history': () => HistoryStatus;
  /** Ask the user to approve a destructive command. Returns true only if they said yes. */
  'command:confirmDestructive': (summary: string, detail: string) => boolean;

  /*
   * --- remote: SkynetOS from another device (docs/08). ALL DESKTOP-ONLY. None of these is in
   * AGENT_METHODS or REMOTE_METHODS: an agent cannot open the door, and a paired phone cannot pair
   * another device, widen the rules or turn remote off.
   */
  /** The REMOTE panel in one read: listening, devices, pairing code, Tailscale. */
  'remote:status': () => RemoteStatusView;
  /** Start or stop the remote server. Persisted (`remoteEnabled`); off by default. */
  'remote:setEnabled': (on: boolean) => RemoteStatusView & { ok: boolean };
  /** A fresh one-time pairing code (5 minutes), and the URLs a device can open. */
  'remote:pairCode': () => { ok: boolean; code?: string; expiresAt?: number; urls?: string[]; error?: string };
  /** Forget a paired device: its token stops working at once. */
  'remote:revoke': (deviceId: string) => { ok: boolean; error?: string };
  /**
   * Run `tailscale serve --bg --https=443 http://127.0.0.1:<port>`, after a native confirmation that
   * says what it changes. It edits William's tailnet configuration, so it never runs unasked.
   */
  'remote:tailscaleServe': () => { ok: boolean; output?: string; error?: string };

  /*
   * --- vision: the cameras, for manual (gesture) control. ALL DESKTOP-ONLY.
   *
   * None of these is in AGENT_METHODS or REMOTE_METHODS, and the reasoning is stronger than for
   * most: an agent that could call `gesture:setEnabled` could switch on the cameras in William's
   * room, and a paired phone could do it while he is not in it. The cameras are opened by his own
   * switch or his own voice, on this machine, and by nothing else.
   */
  /** Manual control's whole state in one read: phase, cameras, why it cannot start. */
  'gesture:status': () => GestureStatus;
  /** Switch manual control on or off. Persisted (`gesture.enabled`); off by default. */
  'gesture:setEnabled': (on: boolean) => GestureStatus;
  /**
   * The vision page reporting in. Main accepts these from the vision window ONLY — it checks the
   * sender — so the board page cannot forge a gesture, and neither can anything else.
   */
  'vision:report': (report: VisionReport) => { ok: boolean };
  'vision:events': (events: ControlEvent[]) => { ok: boolean };

  /*
   * The gesture catalogue and the camera calibration (`userData/gestures.json`,
   * `userData/gesture-calibration.json`). Desktop-only, like everything above: an agent that could
   * write the catalogue could give itself a gesture that says anything the grammar accepts.
   */
  /** Every trained gesture. Read by the board's catalogue and by the wizard. */
  'gesture:library': () => GestureLibrary;
  /** Create or rename a gesture, and set the words it stands for. Never touches its samples. */
  'gesture:saveGesture': (input: SaveGestureInput) => { ok: boolean; library: GestureLibrary; id?: string; error?: string };
  /** Remove a gesture. William's own catalogue, so his click in the UI is the approval. */
  'gesture:deleteGesture': (id: string) => { ok: boolean; library: GestureLibrary; error?: string };
  /**
   * One training example: 42 normalised numbers, never an image. Called by the VISION PAGE only,
   * and only after the START button — the capture and the consent are the same click.
   */
  'gesture:addSample': (input: {
    gestureId: string;
    keyframes: number[][];
    /** The second hand, for a two-handed gesture. Refused if it is missing or the wrong length. */
    offhand?: number[][];
    /** Where the hand was at each keyframe, for a travel gesture. One point per keyframe. */
    path?: { x: number; y: number }[];
    /** Pose features per keyframe: seven numbers each, which sharpen the geometric pose model. */
    pose?: number[][];
    camera?: string;
    /** Which alternative take this is — the sloppy one, the angled one, the left hand. */
    variant?: SampleVariant;
  }) => {
    ok: boolean;
    verdict: SampleVerdict;
    library: GestureLibrary;
    count: number;
    needed: number;
    /** The example just stored, so a RETAKE can drop exactly the one it replaces. */
    sampleId?: string;
  };
  /**
   * Throw away every example of one gesture, so it can be trained again from nothing.
   *
   * Destructive, and deliberately so: a retry exists because the last set was wrong, and adding
   * good examples on top of bad ones leaves a class straddling both. The wizard's own button, on
   * the gesture named on screen, is the approval docs/07 requires.
   */
  'gesture:resetSamples': (gestureId: string) => { ok: boolean; library: GestureLibrary; error?: string };
  /** Remove one example: the one whose thumbnail is on screen, or one the audit condemned. */
  'gesture:dropSample': (input: { gestureId: string; sampleId: string }) => {
    ok: boolean;
    library: GestureLibrary;
    error?: string;
  };
  /**
   * Add or remove a keyframe before recording starts. Discards the gesture's examples, because a
   * two-keyframe recording cannot answer what a third keyframe looked like.
   */
  'gesture:setFrames': (input: { gestureId: string; frames: FrameCount }) => {
    ok: boolean;
    library: GestureLibrary;
    dropped: number;
    error?: string;
  };
  /**
   * One hand or two. Like the keyframe count, it discards the gesture's examples: a one-handed
   * recording cannot answer what the second hand was doing.
   */
  'gesture:setMode': (input: { gestureId: string; mode: HandMode }) => {
    ok: boolean;
    library: GestureLibrary;
    dropped: number;
    error?: string;
  };
  /** Whether this gesture is defined by where it goes as well as by its shape. Keeps its examples. */
  'gesture:setTravel': (input: { gestureId: string; travel: boolean }) => {
    ok: boolean;
    library: GestureLibrary;
    error?: string;
  };
  /**
   * Leave-one-out accuracy over the recorded examples, per-gesture separation, measured travel
   * axes, and the threshold each gesture's own data asks for. Read-only.
   */
  'gesture:analysis': () => Analysis;
  /** Write those fitted thresholds in: the training data changing the recogniser. */
  'gesture:tune': () => {
    ok: boolean;
    library: GestureLibrary;
    changed: { name: string; from: number; to: number }[];
    before: number;
    after: number;
    note: string;
  };
  /**
   * Audit the catalogue: which examples would be misread as a different gesture, and which
   * gestures are therefore not usable. Read-only, and safe to call at any time.
   */
  'gesture:health': () => LibraryHealth;
  /** Drop every example the audit condemned, and nothing else. */
  'gesture:repair': () => { ok: boolean; library: GestureLibrary; dropped: number; note: string };
  /** How the cameras are aimed and how far William reaches. Null before the first calibration. */
  'gesture:calibration': () => CalibrationProfile | null;
  /** Written by the wizard when a calibration pass finishes. Vision page only. */
  'gesture:saveCalibration': (profile: CalibrationProfile) => { ok: boolean; error?: string };
  /**
   * Enter or leave the calibration and training wizard: the camera window grows, centres and shows
   * the guided flow, then goes back to being a monitor.
   */
  'gesture:train': (on: boolean) => GestureStatus;

  /**
   * What voice control would do if it were running: which engine files exist, which wake phrase,
   * and why it is not listening yet. Read-only — there is no switch until there is a listener.
   */
  'voice:status': () => VoiceStatus;
  /**
   * Voice on or off, remembered. USER ONLY: in neither AGENT_METHODS nor REMOTE_METHODS, because it opens
   * a microphone. Off is the hard mute — the wake sidecar, the speech engine and the capture window all
   * stop. See docs/07-SECURITY.md, Voice.
   */
  'voice:setEnabled': (on: boolean) => VoiceStatus;
  /** One sentence from the capture window: a WAV, or why there is none. CAPTURE WINDOW ONLY. */
  'voice:captured': (capture: VoiceCapture) => { ok: boolean };
}

export type Channel = keyof SkynetApi;

export const CHANNELS = [
  'board:load',
  'board:loadRoom',
  'board:list',
  'display:info',
  'app:version',
  'update:status',
  'update:check',
  'update:install',
  'app:autostart',
  'app:setAutostart',
  'settings:read',
  'settings:setPlan',
  'target:resolveNode',
  'target:resolveBoard',
  'target:verify',
  'pick:target',
  'mosaic:forNode',
  'mosaic:boardTile',
  'usage:summary',
  'usage:routes',
  'hardware:snapshot',
  'models:status',
  'models:setFableReset',
  'away:status',
  'away:sleepNow',
  'away:wake',
  'away:setMode',
  'prompt:pickFiles',
  'prompt:describeFiles',
  'prompt:send',
  'prompt:build',
  'mailbox:list',
  'mailbox:send',
  'mailbox:archive',
  'artifact:resolve',
  'artifact:resolveBoard',
  'drag:startFile',
  'explorer:list',
  'explorer:open',
  'explorer:drag',
  'ingest:classify',
  'ingest:create',
  'watch:board',
  'node:add',
  'node:paste',
  'jarvis:summon',
  'avatar:frames',
  'avatar:status',
  'avatar:setEnabled',
  'avatar:preview',
  'avatar:watchNodes',
  'task:status',
  'task:runNow',
  'finance:status',
  'node:open',
  'node:visits',
  'session:start',
  'session:stop',
  'session:list',
  'session:resumeCommand',
  'terminal:open',
  'service:start',
  'service:stop',
  'service:list',
  'service:tail',
  'phantom:list',
  'phantom:propose',
  'phantom:approve',
  'phantom:dismiss',
  'command:apply',
  'command:undo',
  'command:redo',
  'command:history',
  'command:confirmDestructive',
  'remote:status',
  'remote:setEnabled',
  'remote:pairCode',
  'remote:revoke',
  'remote:tailscaleServe',
  'gesture:status',
  'gesture:setEnabled',
  'vision:report',
  'vision:events',
  'gesture:library',
  'gesture:saveGesture',
  'gesture:deleteGesture',
  'gesture:addSample',
  'gesture:resetSamples',
  'gesture:dropSample',
  'gesture:setFrames',
  'gesture:setMode',
  'gesture:setTravel',
  'gesture:analysis',
  'gesture:tune',
  'gesture:health',
  'gesture:repair',
  'gesture:calibration',
  'gesture:saveCalibration',
  'gesture:train',
  'voice:status',
  'voice:setEnabled',
  'voice:captured'
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
 * - `prompt:send`, `prompt:pickFiles`, `prompt:describeFiles`. The prompt node types into William's
 *   own logged-in claude.ai conversation and reads files off his disk to attach to it. An agent
 *   that could call these could speak in his voice to the Face and ship any file it named.
 * - `phantom:approve`, `phantom:dismiss`. The tick and the cross on a recommended node. An agent
 *   that could approve its own suggestion would be adding nodes with a fake audit trail; it may
 *   withdraw its OWN suggestion through `command:apply`, where the bus checks whose it is.
 * - `gesture:setEnabled`, `gesture:status`, `vision:report`, `vision:events`. The cameras. An agent
 *   that could switch on manual control could switch on the webcams in William's room, and could
 *   then forge gestures through `vision:events` to move the board without anyone typing anything.
 *   Main additionally accepts `vision:*` from the vision window alone, by checking the sender.
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
  /*
   * A file explorer node's folder listing. Read-only, scoped to a folder the board already declares,
   * and a Claude Code agent can read that folder directly anyway, so refusing it here would only make
   * JARVIS ask William what is in a folder it can already see. `explorer:open` and `explorer:drag`
   * are NOT here: one opens files with their default app, the other hands a file to whatever the OS
   * drops it on.
   */
  'explorer:list',
  // Which model a launch will get, and why. Telemetry, read-only. `models:setFableReset` is NOT here.
  'models:status',
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
  // Sketch recommended nodes. Approving or dismissing one is William's tick and cross, not here.
  'phantom:list',
  'phantom:propose',
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

/**
 * ── What a remote device may reach ────────────────────────────────────────────────────────────
 *
 * A remote device is William on his phone, tablet or laptop, through the remote bridge
 * (docs/08-REMOTE.md). It runs the same renderer the desktop does, so this list is the renderer's
 * surface minus everything that only makes sense at the PC or asks for a decision the PC must make.
 * Granted, never denied: a channel added to CHANNELS later is unreachable remotely until it is
 * deliberately added here, and a test holds it to CHANNELS (test/remote-protocol.test.ts).
 *
 * The omissions, read as carefully as the entries:
 * - `display:info` is answered on the device itself (its screen, not the PC's).
 * - Native dialogs on the PC's screen: `pick:target`, `prompt:pickFiles`, `command:confirmDestructive`.
 *   Nobody at the PC is there to answer them. Anything else that would raise one refuses with
 *   "confirm on the desktop" (services/remote-context.ts).
 * - The PC's own files and programs: `node:open`, `terminal:open`, `explorer:open`, `explorer:drag`,
 *   `drag:startFile`, `ingest:*`, `prompt:describeFiles`. Opening a document on a desktop you are
 *   not sitting at does nothing useful, and runs code in the worst case.
 * - Settings and grants: `settings:setPlan`, `models:setFableReset`, `away:setMode`,
 *   `app:autostart`/`app:setAutostart`, `avatar:setEnabled`, `avatar:preview`, and every `remote:*`
 *   channel. A paired phone cannot pair another device, change the rules, or turn remote off.
 * - `command:apply` IS here, rewritten on the way in (prepareRemoteCall): attributed to `remote`,
 *   `approved` stripped, destructive commands refused.
 */
export const REMOTE_METHODS = [
  'board:load',
  'board:loadRoom',
  'board:list',
  'app:version',
  'settings:read',
  'target:resolveNode',
  'target:resolveBoard',
  'target:verify',
  'mosaic:forNode',
  'mosaic:boardTile',
  'usage:summary',
  'usage:routes',
  'hardware:snapshot',
  'models:status',
  'away:status',
  'away:sleepNow',
  'away:wake',
  'prompt:send',
  'prompt:build',
  'mailbox:list',
  'mailbox:send',
  'mailbox:archive',
  'artifact:resolve',
  'artifact:resolveBoard',
  'explorer:list',
  'watch:board',
  'node:add',
  'node:paste',
  'jarvis:summon',
  'avatar:frames',
  'avatar:status',
  'task:status',
  'task:runNow',
  'session:start',
  'session:stop',
  'session:list',
  'session:resumeCommand',
  'service:start',
  'service:stop',
  'service:list',
  'service:tail',
  'phantom:list',
  'phantom:propose',
  'phantom:approve',
  'phantom:dismiss',
  'command:apply',
  'command:undo',
  'command:redo',
  'command:history'
] as const satisfies readonly Channel[];

export type RemoteMethod = (typeof REMOTE_METHODS)[number];

const REMOTE_METHOD_SET: ReadonlySet<string> = new Set(REMOTE_METHODS);

export function isRemoteMethod(value: string): value is RemoteMethod {
  return REMOTE_METHOD_SET.has(value);
}

export function isChannel(value: string): value is Channel {
  return (CHANNELS as readonly string[]).includes(value);
}

/**
 * ── What the vision page may reach ────────────────────────────────────────────────────────────
 *
 * The third door, and the narrowest. The vision window (services/vision.ts) carries the same
 * preload as the board window because it is the same bundle, so main is what narrows it: these two
 * channels from that window, nothing else from that window, and these two from nothing else.
 *
 * Both halves matter. Without the first, a page that is allowed to open a camera could also edit
 * the board, start a terminal, or type into William's claude.ai conversation. Without the second,
 * any page with the bridge could forge `vision:events` and drive the board by hand-written gesture.
 */
export const VISION_METHODS = [
  'vision:report',
  'vision:events',
  // Written only by the page that did the measuring, and only after a click on its own START.
  'gesture:addSample',
  // Training writes: retry, prune, reshape and repair. All of them touch only the gesture the
  // wizard is showing, all of them are behind a button in it, and none can reach the board.
  'gesture:resetSamples',
  'gesture:dropSample',
  'gesture:setFrames',
  'gesture:setMode',
  'gesture:setTravel',
  'gesture:tune',
  'gesture:repair',
  'gesture:saveCalibration'
] as const satisfies readonly Channel[];

export type VisionMethod = (typeof VISION_METHODS)[number];

const VISION_METHOD_SET: ReadonlySet<string> = new Set(VISION_METHODS);

export function isVisionMethod(value: string): value is VisionMethod {
  return VISION_METHOD_SET.has(value);
}

/**
 * Channels ONLY the voice capture window may call — and that window may call nothing else.
 *
 * The same double rule as the vision page, for the same reason: the page that can hear the room must not
 * be able to edit the board, and nothing else may slip a sentence into the speech engine as though it had
 * been spoken.
 */
export const VOICE_METHODS = ['voice:captured'] as const satisfies readonly Channel[];

const VOICE_METHOD_SET: ReadonlySet<string> = new Set(VOICE_METHODS);

export function isVoiceMethod(value: string): boolean {
  return VOICE_METHOD_SET.has(value);
}

/**
 * Channels BOTH the board and the vision page may call.
 *
 * The distinction matters and is easy to get backwards: VISION_METHODS is a grant AND a denial —
 * only the vision page may call those. These are a grant only. The wizard has to know which
 * gestures to ask for and how the cameras were last aimed, the board's catalogue reads the same two
 * things, and both need to be able to enter and leave the wizard — the board to start it, the
 * wizard to hand the window back when it is finished.
 *
 * `gesture:train` is the one write here, and it writes nothing but window layout and a page mode.
 */
export const VISION_SHARED = [
  'gesture:library',
  'gesture:health',
  'gesture:analysis',
  'gesture:calibration',
  'gesture:status',
  'gesture:train',
  'voice:status'
] as const satisfies readonly Channel[];

const VISION_SHARED_SET: ReadonlySet<string> = new Set(VISION_SHARED);

export function isVisionShared(value: string): boolean {
  return VISION_SHARED_SET.has(value);
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
  /** The avatar's frames folder changed: any logo showing the avatar's face is redrawn. */
  'avatar:changed': { name: string };
  /** Sent to ONE face window: JARVIS started or stopped speaking in the window it belongs to. */
  'avatar:mood': { mood: AvatarMood };
  /** Sent to the BOARD window: a node with an animated-face logo started or stopped talking. */
  'avatar:nodeMood': { boardId: string; nodeId: string; mood: AvatarMood };
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
  /** Away mode changed phase or settings, or its run ended. The whole status. */
  'away:state': AwayStatus;
  /** The updater moved on: checking, downloading, ready. For the ABOUT box and one toast. */
  'update:state': UpdateStatus;
  /** One new transcript line or "while you were away" item from the away run. */
  'away:log': AwayLogEvent;
  /**
   * One recognised gesture, forwarded from the vision window to the board.
   *
   * Events, not landmarks: 21 points per hand per frame at 26 fps would be 40 kB a second of IPC
   * for the board to re-derive what the vision page already knows, and it would put raw camera
   * geometry into the window that holds the board. The board is told "a pinch closed here", which
   * is all it can act on anyway.
   */
  'gesture:event': ControlEvent;
  /** Manual control changed state: on, off, or unavailable with a reason. */
  'gesture:state': GestureStatus;
  /** Voice changed phase: off, starting, waiting for the wake phrase, hearing, transcribing. */
  'voice:state': VoiceStatus;
  /** The wake phrase was heard. The board summons the prompt to the middle of the screen. */
  'voice:wake': VoiceWake;
  /** A sentence, transcribed on this machine — or nothing, if nobody spoke. */
  'voice:heard': VoiceHeard;
  /** Sent to the CAPTURE WINDOW only: open the microphone for one sentence. */
  'voice:listen': VoiceListen;
}

export type EventName = keyof SkynetEvents;

export const EVENTS = ['sessions:changed', 'services:changed', 'files:changed', 'mail:dispatched', 'monitor:open', 'away:state', 'away:log', 'avatar:changed', 'avatar:mood', 'avatar:nodeMood', 'gesture:event', 'gesture:state', 'voice:state', 'voice:wake', 'voice:heard', 'voice:listen', 'update:state'] as const satisfies readonly EventName[];

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
