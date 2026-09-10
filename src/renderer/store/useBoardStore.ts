import { create } from 'zustand';
import type { Board, BoardNode } from '@shared/types.js';
import type { Command, CommandResult, HistoryStatus } from '@shared/commands.js';
import type { BoardLoad, NodeStatus, ServiceInfo, SessionInfo } from '@shared/ipc.js';
import type { TargetInfo } from '@shared/targets.js';

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
   * Live sessions and services, pushed from main. Every room's, not just this one's — an agent
   * running in a room you are not looking at is exactly the thing the dock exists to surface.
   */
  sessions: SessionInfo[];
  services: ServiceInfo[];
  subscribeToProcesses: () => () => void;
  startSession: (nodeId: string, force?: boolean) => Promise<void>;
  stopSession: (sessionId: string) => Promise<void>;
  startService: (nodeId: string) => Promise<void>;
  stopService: (boardId: string, nodeId: string) => Promise<void>;
  copyResumeCommand: (nodeId: string) => Promise<void>;
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
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  openNode: (nodeId: string) => Promise<void>;

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
  jumpTo: null,
  sessions: [],
  services: [],

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
    return () => { offSessions(); offServices(); };
  },

  startSession: async (nodeId, force) => {
    const { boardId, board } = get();
    const node = board?.nodes.find((n) => n.id === nodeId);
    const result = await window.skynet['session:start'](boardId, nodeId, force ?? false);
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
