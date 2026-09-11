import { create } from 'zustand';
import type { Board, BoardNode, NodeKind } from '@shared/types.js';
import type { Command, CommandResult, HistoryStatus } from '@shared/commands.js';
import type { ArtifactInfo, BoardLoad, IngestSuggestion, NodeStatus, ServiceInfo, SessionInfo } from '@shared/ipc.js';
import type { UsageRoute } from '@shared/usage.js';
import type { TargetInfo } from '@shared/targets.js';
import { freeEdgeId, guessEdgeKind } from '../board/ports.js';

/**
 * Small, boring UI preferences that outlive a reload.
 *
 * localStorage and not settings.json: these are how the window is arranged, not what the app is
 * allowed to do. docs/07 keeps settings.json user-only and gives it no write channel on purpose,
 * and "how big is the minimap" has no business anywhere near that file. Every read is guarded
 * because storage throws outright in some contexts, and a thrown preference read must not cost the
 * whole board.
 */
function loadNumber(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const value = Number.parseInt(raw, 10);
    return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
  } catch {
    return fallback;
  }
}

function loadBoolean(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}

function save(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* a preference that cannot persist still applies */ }
}

/**
 * Renderer state.
 *
 * Note what is NOT here: the undo stack. It lives in the main process, because a JARVIS edit
 * arriving over MCP has to land on the same stack as a William edit for Ctrl+Z to mean anything
 * (CLAUDE.md prime directive 5). The renderer holds a *view* of that history and asks main to
 * undo. Everything the board looks like is derived from `board`, which is only ever replaced by
 * re-reading the file main just wrote — so what is on screen is what is on disk, always.
 */

export type EditMode = 'view' | 'edit';

/** One level of the room stack: how you got here and what to print in the breadcrumb. */
export interface Crumb {
  boardId: string;
  engraving: string;
}

export interface Toast {
  id: number;
  level: 'ok' | 'warn' | 'fault';
  text: string;
}

interface BoardState {
  boardId: string;
  load: BoardLoad | null;
  board: Board | null;

  /**
   * The room stack, root first. Descending pushes, going back pops.
   *
   * A stack rather than following `board.parent` because rooms nest arbitrarily and a room could
   * one day be reachable from more than one place — the way you got in is what "back" means.
   */
  stack: Crumb[];
  /** Non-null while an iris wipe is running. The canvas keeps rendering underneath it. */
  transition: 'closing' | 'opening' | null;

  selectedId: string | null;
  /** Node id whose form is open. Null means the inspector is read-only. */
  editingId: string | null;
  mode: EditMode;

  /** Target resolution per node id, refreshed on load and after every edit. */
  targets: Record<string, TargetInfo>;
  history: HistoryStatus;
  toasts: Toast[];
  busy: boolean;

  /** Focus mode (F): dim everything except the selection and its direct traces. */
  focus: boolean;
  /** Integer chrome scale, derived from the OS scale factor. See App.uiScaleFor. */
  uiScale: number;
  setUiScale: (scale: number) => void;

  /**
   * Minimap pixels per tile, 1-4, and whether the panel is open at all.
   *
   * A user preference rather than a constant, because the right size depends on the board AND on
   * what the user is doing — and because the constant was wrong. It was 3 px per tile, chosen when
   * a board was 64x40; tripling every board made the minimap 576x360 art pixels, which at chrome
   * scale 2 is over a thousand pixels of screen. William: "the minimap is way too big of a window
   * make it a smaller window / and resizable."
   *
   * Integer only, like the board's own zoom. A fractionally scaled minimap is a blurry minimap,
   * and docs/02 §Anti-mush does not make an exception for chrome.
   */
  minimapScale: number;
  minimapOpen: boolean;
  setMinimapScale: (scale: number) => void;
  toggleMinimap: () => void;

  /**
   * Live sessions and services, pushed from main. Every room's, not just this one's — an agent
   * running in a room you are not looking at is exactly the thing the dock exists to surface.
   */
  sessions: SessionInfo[];
  services: ServiceInfo[];
  /** Resolved build outputs by node id: filename, version, and whether it is behind its source. */
  artifacts: Record<string, ArtifactInfo>;
  refreshArtifacts: () => Promise<void>;
  /**
   * Per-node share of real Claude usage on the board you are looking at. Drives the couriers.
   * Refreshed on a slow timer — usage moves on the scale of minutes and a scan reads every
   * conversation file on disk.
   */
  usageRoutes: UsageRoute[];
  refreshUsageRoutes: () => Promise<void>;
  /** Pending drop-in suggestions awaiting confirmation in the wizard. */
  pendingIngest: { suggestions: IngestSuggestion[]; pos: { x: number; y: number } } | null;
  offerIngest: (paths: string[], pos: { x: number; y: number }) => Promise<void>;
  acceptIngest: (suggestion: IngestSuggestion) => Promise<void>;
  cancelIngest: () => void;
  subscribeToProcesses: () => () => void;
  startSession: (nodeId: string, fresh?: boolean) => Promise<void>;
  stopSession: (sessionId: string) => Promise<void>;
  startService: (nodeId: string) => Promise<void>;
  stopService: (boardId: string, nodeId: string) => Promise<void>;
  copyResumeCommand: (nodeId: string) => Promise<void>;
  /**
   * Open a plain shell on a node's directory. `elevated` raises a UAC prompt, which main
   * confirms first — the renderer can ask for elevation but can never grant it.
   */
  openTerminal: (nodeId: string, elevated: boolean) => Promise<void>;
  /** Camera jump requested by the minimap, consumed by the canvas. */
  jumpTo: { x: number; y: number; seq: number } | null;
  requestJump: (world: { x: number; y: number }) => void;

  loadBoard: (boardId: string) => Promise<void>;
  /** Descend into a drive.room node. No-op if the node is not a room or its file is missing. */
  descend: (nodeId: string) => Promise<void>;
  /** Back up one level. No-op at the root. */
  ascend: () => Promise<void>;
  setTransition: (phase: 'closing' | 'opening' | null) => void;
  refreshTargets: () => Promise<void>;
  select: (nodeId: string | null) => void;
  setMode: (mode: EditMode) => void;
  beginEdit: (nodeId: string) => void;
  cancelEdit: () => void;
  toggleFocus: () => void;

  runCommand: (command: Command, label?: string) => Promise<CommandResult>;
  moveNode: (nodeId: string, pos: { x: number; y: number }) => Promise<void>;
  /** Move a group selection as one command, so one Ctrl+Z puts all of it back. */
  moveNodes: (moves: { nodeId: string; pos: { x: number; y: number } }[]) => Promise<void>;
  /**
   * Change a node's footprint. A `node.update` like any other, so it snapshots, it lands in the
   * same history, and Ctrl+Z takes it back — scaling is an edit, not a view setting.
   */
  resizeNode: (nodeId: string, footprint: { w: number; h: number }) => Promise<void>;
  /**
   * Draw a trace between two nodes.
   *
   * The edge stores two node IDS and no coordinates: the router works out the copper every time
   * the board is built, so a trace follows its endpoints when they move, resize or change shape.
   * That is what "these wires stay dynamically attached" means, and it is why nothing here has to
   * remember where the wire was drawn.
   */
  connectNodes: (from: string, to: string) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  openNode: (nodeId: string) => Promise<void>;
  /** Put a new node on the board and select it, ready to be bound to something. */
  addNode: (kind: NodeKind, pos: { x: number; y: number }, fields?: Partial<BoardNode>) => Promise<void>;
  /** The add-component palette, open only in Edit Board mode. */
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  /** The JARVIS mailbox panel — SkynetOS as the wire between the Face and the Hands. */
  mailboxOpen: boolean;
  setMailboxOpen: (open: boolean) => void;

  toast: (level: Toast['level'], text: string) => void;
  dismissToast: (id: number) => void;
}

const EMPTY_HISTORY: HistoryStatus = {
  canUndo: false, canRedo: false, undoLabel: null, redoLabel: null, entries: []
};

let toastSeq = 1;

export const useBoardStore = create<BoardState>((set, get) => ({
  boardId: 'root',
  load: null,
  board: null,
  stack: [],
  transition: null,
  selectedId: null,
  editingId: null,
  mode: 'view',
  targets: {},
  history: EMPTY_HISTORY,
  toasts: [],
  busy: false,
  focus: false,
  uiScale: 1,
  minimapScale: loadNumber('skynet.minimapScale', 1, 1, 4),
  minimapOpen: loadBoolean('skynet.minimapOpen', true),
  jumpTo: null,
  sessions: [],
  services: [],
  artifacts: {},
  usageRoutes: [],
  pendingIngest: null,
  paletteOpen: false,
  mailboxOpen: false,

  loadBoard: async (boardId) => {
    set({ busy: true });
    const load = await window.skynet['board:load'](boardId);
    const stack = get().stack.length
      ? get().stack
      : load.ok
        ? [{ boardId: load.board.id, engraving: (load.board.engraving ?? load.board.name).toUpperCase() }]
        : [];
    set({
      boardId,
      load,
      board: load.ok ? load.board : null,
      stack,
      selectedId: null,
      editingId: null,
      busy: false
    });
    if (load.ok) {
      const [statuses, history] = await Promise.all([
        window.skynet['target:resolveBoard'](boardId),
        window.skynet['command:history']()
      ]);
      set({ targets: byNodeId(statuses), history });
      // Artifacts and watchers follow the board you are actually looking at.
      void get().refreshArtifacts();
      void get().refreshUsageRoutes();
      void window.skynet['watch:board'](boardId);
    }
  },

  descend: async (nodeId) => {
    const { board, stack, transition } = get();
    if (!board || transition) return;
    const node = board.nodes.find((n) => n.id === nodeId);
    if (!node || node.kind !== 'drive.room' || !node.boardFile) return;

    // Close the iris BEFORE loading, so a slow read never shows a half-swapped board.
    set({ transition: 'closing' });
    await new Promise((r) => setTimeout(r, 200));

    const load = await window.skynet['board:loadRoom'](node.boardFile);
    if (!load.ok) {
      set({ transition: null });
      get().toast('fault', load.error);
      return;
    }

    const [statuses, history] = await Promise.all([
      window.skynet['target:resolveBoard'](load.board.id),
      window.skynet['command:history']()
    ]);

    set({
      boardId: load.board.id,
      load,
      board: load.board,
      stack: [...stack, { boardId: load.board.id, engraving: (load.board.engraving ?? load.board.name).toUpperCase() }],
      targets: byNodeId(statuses),
      history,
      selectedId: null,
      editingId: null,
      transition: 'opening'
    });
    void get().refreshArtifacts();
    void get().refreshUsageRoutes();
    void window.skynet['watch:board'](load.board.id);
  },

  ascend: async () => {
    const { stack, transition } = get();
    if (transition || stack.length < 2) return;
    const parent = stack[stack.length - 2]!;

    set({ transition: 'closing' });
    await new Promise((r) => setTimeout(r, 200));

    const load = await window.skynet['board:load'](parent.boardId);
    if (!load.ok) {
      set({ transition: null });
      get().toast('fault', load.error);
      return;
    }
    const [statuses, history] = await Promise.all([
      window.skynet['target:resolveBoard'](parent.boardId),
      window.skynet['command:history']()
    ]);
    set({
      boardId: parent.boardId,
      load,
      board: load.board,
      stack: stack.slice(0, -1),
      targets: byNodeId(statuses),
      history,
      selectedId: null,
      editingId: null,
      transition: 'opening'
    });
    void get().refreshArtifacts();
    void get().refreshUsageRoutes();
    void window.skynet['watch:board'](parent.boardId);
  },

  setTransition: (phase) => set({ transition: phase }),

  refreshTargets: async () => {
    const { boardId, board } = get();
    if (!board) return;
    const statuses = await window.skynet['target:resolveBoard'](boardId);
    set({ targets: byNodeId(statuses) });
  },

  select: (nodeId) => set((state) => ({
    selectedId: nodeId,
    // Changing selection abandons an open form rather than silently carrying edits to another
    // node. Losing two keystrokes is better than writing them to the wrong component.
    editingId: state.editingId && state.editingId !== nodeId ? null : state.editingId
  })),

  /**
   * Edit Board mode (E): the grid overlay and draggable components. Independent of whether a
   * node's field form is open — leaving it does NOT close the form, because the two are
   * different operations on different things.
   */
  setMode: (mode) => set({ mode }),

  /**
   * Open the field form for a node (F2). Deliberately does NOT touch `mode`.
   *
   * It used to set mode:'edit', which meant opening a form silently made every component on the
   * board draggable — so a click that drifted a few pixels could relocate a component you were
   * only trying to read. Two different meanings of "edit" sharing one flag.
   */
  beginEdit: (nodeId) => set({ selectedId: nodeId, editingId: nodeId }),

  cancelEdit: () => set({ editingId: null }),

  toggleFocus: () => set((state) => ({ focus: !state.focus })),

  setUiScale: (scale) => set({ uiScale: scale }),

  setMinimapScale: (scale) => {
    const clamped = Math.min(4, Math.max(1, Math.round(scale)));
    save('skynet.minimapScale', String(clamped));
    set({ minimapScale: clamped });
  },

  toggleMinimap: () => set((state) => {
    const next = !state.minimapOpen;
    save('skynet.minimapOpen', next ? '1' : '0');
    return { minimapOpen: next };
  }),

  /**
   * Subscribe to pushed session/service state, and take one snapshot immediately — the push only
   * carries CHANGES, so a renderer that reloaded mid-session would otherwise show an empty dock
   * until something happened to change.
   */
  subscribeToProcesses: () => {
    void window.skynet['session:list']().then((sessions) => set({ sessions }));
    void window.skynet['service:list']().then((services) => set({ services }));
    const offSessions = window.skynet.on('sessions:changed', (sessions) => set({ sessions }));
    const offServices = window.skynet.on('services:changed', (services) => set({ services }));

    /*
     * A watched file changed. Re-resolve only the nodes that care about it, not the whole board:
     * a rebuild in a repo with twenty file nodes should not re-run twenty git calls.
     */
    const offFiles = window.skynet.on('files:changed', (event) => {
      if (event.boardId !== get().boardId) return;
      void get().refreshArtifacts();
      void get().refreshTargets();
    });

    return () => { offSessions(); offServices(); offFiles(); };
  },

  refreshUsageRoutes: async () => {
    const { boardId, board } = get();
    if (!board) return;
    const routes = await window.skynet['usage:routes'](boardId);
    // Guard against a room change that landed while the scan was running: routes for the board
    // you just left would send couriers to node ids that are not here.
    if (get().boardId !== boardId) return;
    set({ usageRoutes: routes });
  },

  refreshArtifacts: async () => {
    const { boardId, board } = get();
    if (!board) return;
    const list = await window.skynet['artifact:resolveBoard'](boardId);
    const byId: Record<string, ArtifactInfo> = {};
    for (const a of list) byId[a.nodeId] = a;
    set({ artifacts: byId });
  },

  offerIngest: async (paths, pos) => {
    const suggestions = await window.skynet['ingest:classify'](paths);
    if (!suggestions.length) {
      get().toast('warn', 'NOTHING USABLE IN THAT DROP');
      return;
    }
    set({ pendingIngest: { suggestions, pos } });
  },

  acceptIngest: async (suggestion) => {
    const { boardId, pendingIngest } = get();
    const pos = pendingIngest?.pos ?? { x: 1, y: 1 };
    const result = await window.skynet['ingest:create'](boardId, suggestion, pos);
    if (!result.ok) { get().toast('fault', result.error ?? 'could not place the node'); return; }

    const remaining = (pendingIngest?.suggestions ?? []).filter((s) => s.path !== suggestion.path);
    set({ pendingIngest: remaining.length ? { suggestions: remaining, pos } : null });

    await get().loadBoard(boardId);
    set({ selectedId: result.nodeId ?? null });
    get().toast('ok', `placed ${suggestion.name} as ${suggestion.kind}`);
  },

  cancelIngest: () => set({ pendingIngest: null }),

  startSession: async (nodeId, fresh) => {
    const { boardId, board } = get();
    const node = board?.nodes.find((n) => n.id === nodeId);
    const result = await window.skynet['session:start'](boardId, nodeId, { fresh: fresh ?? false });
    if (!result.ok) { get().toast('fault', result.error); return; }
    const label = node?.designator ? `${node.designator} ${node.name}` : (node?.name ?? nodeId);
    get().toast('ok', result.focused
      ? `${label} — ${result.note ?? 'already running'}`
      : `${label} — ${result.note ?? 'launched'}`);
  },

  stopSession: async (sessionId) => {
    const result = await window.skynet['session:stop'](sessionId);
    if (!result.ok) get().toast('warn', result.error ?? 'could not stop');
    else get().toast('ok', 'session stopped');
  },

  startService: async (nodeId) => {
    const { boardId } = get();
    const result = await window.skynet['service:start'](boardId, nodeId);
    if (!result.ok) { get().toast('fault', result.error ?? 'could not start'); return; }
    get().toast('ok', `started ${result.info?.command ?? 'service'}`);
  },

  stopService: async (boardId, nodeId) => {
    const result = await window.skynet['service:stop'](boardId, nodeId);
    if (!result.ok) get().toast('warn', result.error ?? 'could not stop');
    else get().toast('ok', 'service stopped');
  },

  openTerminal: async (nodeId, elevated) => {
    const { boardId, board } = get();
    const node = board?.nodes.find((n) => n.id === nodeId);
    const label = node?.designator ? `${node.designator} ${node.name}` : (node?.name ?? nodeId);
    const result = await window.skynet['terminal:open'](boardId, nodeId, { elevated });
    if (!result.ok) {
      /*
       * A failed launch used to be reported as a success. The script path is in the message on
       * purpose: it is the exact file to run by hand, and it is the difference between "nothing
       * happened" and a bug you can see.
       */
      get().toast('fault', result.error ?? 'COULD NOT OPEN A TERMINAL');
      return;
    }
    get().toast('ok', `${label} — ${elevated ? 'ADMIN ' : ''}terminal open in ${result.cwd} (pid ${result.pid ?? '?'})`);
  },

  copyResumeCommand: async (nodeId) => {
    const command = await window.skynet['session:resumeCommand'](get().boardId, nodeId);
    if (!command) { get().toast('warn', 'NO CONVERSATION YET — LAUNCH THE CHIP ONCE FIRST'); return; }
    await navigator.clipboard.writeText(command);
    get().toast('ok', `copied: ${command}`);
  },

  // seq makes every jump distinct, so clicking the same minimap spot twice still moves the
  // camera back after you have panned away from it.
  requestJump: (world) => set((state) => ({
    jumpTo: { x: world.x, y: world.y, seq: (state.jumpTo?.seq ?? 0) + 1 }
  })),

  runCommand: async (command, label) => {
    set({ busy: true });
    const result = await window.skynet['command:apply']({
      command,
      actor: 'user',
      ...(label ? { label } : {})
    });
    if (!result.ok) {
      set({ busy: false });
      get().toast('fault', result.error);
      return result;
    }
    // Re-read from disk rather than patching local state. The file main just wrote IS the
    // board; anything else is a second source of truth waiting to disagree.
    const load = await window.skynet['board:load'](get().boardId);
    const statuses = await window.skynet['target:resolveBoard'](get().boardId);
    set({
      load,
      board: load.ok ? load.board : get().board,
      targets: byNodeId(statuses),
      history: result.history,
      busy: false
    });
    if (result.changed.length) {
      get().toast('ok', `${label ?? command.type} — ${result.changed.map((c) => c.path).join(', ')}`);
    }
    return result;
  },

  moveNode: async (nodeId, pos) => {
    const node = get().board?.nodes.find((n) => n.id === nodeId);
    const label = `move ${node?.designator ?? nodeId} to ${pos.x},${pos.y}`;
    await get().runCommand({ type: 'node.move', boardId: get().boardId, nodeId, pos }, label);
  },

  moveNodes: async (moves) => {
    if (!moves.length) return;
    if (moves.length === 1 && moves[0]) { await get().moveNode(moves[0].nodeId, moves[0].pos); return; }
    await get().runCommand({ type: 'node.moveMany', boardId: get().boardId, moves }, `move ${moves.length} nodes`);
  },

  resizeNode: async (nodeId, footprint) => {
    const node = get().board?.nodes.find((n) => n.id === nodeId);
    const label = `resize ${node?.designator ?? nodeId} to ${footprint.w}x${footprint.h}`;
    await get().runCommand(
      { type: 'node.update', boardId: get().boardId, nodeId, patch: { footprint } },
      label
    );
  },

  connectNodes: async (from, to) => {
    const board = get().board;
    if (!board) return;

    const fromNode = board.nodes.find((n) => n.id === from);
    const toNode = board.nodes.find((n) => n.id === to);
    if (!fromNode || !toNode) { get().toast('fault', 'ONE END OF THAT TRACE IS NOT ON THIS BOARD'); return; }

    const kind = guessEdgeKind(fromNode.kind, toNode.kind);
    await get().runCommand(
      {
        type: 'edge.create',
        boardId: get().boardId,
        edge: { id: freeEdgeId(board.edges), from, to, kind }
      },
      `trace ${fromNode.designator ?? from} -> ${toNode.designator ?? to} (${kind})`
    );
  },

  undo: async () => {
    const result = await window.skynet['command:undo']();
    if (!result.ok) { get().toast('warn', result.error); return; }
    const load = await window.skynet['board:load'](get().boardId);
    const statuses = await window.skynet['target:resolveBoard'](get().boardId);
    set({ load, board: load.ok ? load.board : get().board, targets: byNodeId(statuses), history: result.history });
    get().toast('ok', 'undone');
  },

  redo: async () => {
    const result = await window.skynet['command:redo']();
    if (!result.ok) { get().toast('warn', result.error); return; }
    const load = await window.skynet['board:load'](get().boardId);
    const statuses = await window.skynet['target:resolveBoard'](get().boardId);
    set({ load, board: load.ok ? load.board : get().board, targets: byNodeId(statuses), history: result.history });
    get().toast('ok', 'redone');
  },

  openNode: async (nodeId) => {
    const node = get().board?.nodes.find((n) => n.id === nodeId);

    // A room drive is navigation, not an OS action — clicking it descends.
    if (node?.kind === 'drive.room') { await get().descend(nodeId); return; }

    // An agent chip launches or focuses its own Claude Code conversation. This is the click the
    // whole board exists for.
    if (node?.kind === 'agent.code') { await get().startSession(nodeId); return; }

    // A service toggles: running -> stop, otherwise start.
    if (node?.kind === 'service.process') {
      const live = get().services.find(
        (s) => s.nodeId === nodeId && s.boardId === get().boardId && s.state === 'running'
      );
      if (live) await get().stopService(get().boardId, nodeId);
      else await get().startService(nodeId);
      return;
    }

    const result = await window.skynet['node:open'](get().boardId, nodeId);
    if (result.ok) get().toast('ok', result.action);
    else get().toast(result.target.state === 'missing' ? 'fault' : 'warn', result.error ?? result.action);
  },

  setPaletteOpen: (open) => set({ paletteOpen: open }),

  setMailboxOpen: (open) => set({ mailboxOpen: open }),

  addNode: async (kind, pos, fields) => {
    const { boardId } = get();
    const result = await window.skynet['node:add'](boardId, kind, pos, fields);
    if (!result.ok) { get().toast('fault', result.error ?? 'COULD NOT ADD THAT'); return; }
    await get().loadBoard(boardId);
    // Select AND open the editor: a node created unbound is useless until it is pointed at
    // something, so the form it needs is the next thing you want.
    /*
     * Decoration is finished the moment it is placed — there is nothing to bind it to — so the
     * palette stays open and the editor does not. Everything else arrives unbound and useless
     * until it is pointed at something, so the form it needs is the next thing you want.
     */
    const decorative = kind === 'decor.part';
    set({
      selectedId: result.nodeId ?? null,
      editingId: decorative ? null : result.nodeId ?? null,
      paletteOpen: decorative
    });
    get().toast('ok', decorative ? `placed ${fields?.part ?? kind}` : `added ${kind} — bind it to something`);
  },

  toast: (level, text) => {
    const id = toastSeq++;
    set((state) => ({ toasts: [...state.toasts.slice(-4), { id, level, text }] }));
    setTimeout(() => get().dismissToast(id), level === 'fault' ? 9000 : 4500);
  },

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
}));

function byNodeId(statuses: NodeStatus[]): Record<string, TargetInfo> {
  const out: Record<string, TargetInfo> = {};
  for (const s of statuses) out[s.nodeId] = s.target;
  return out;
}

/** The currently selected node object, or undefined. */
export function useSelectedNode(): BoardNode | undefined {
  return useBoardStore((s) => (s.selectedId ? s.board?.nodes.find((n) => n.id === s.selectedId) : undefined));
}
