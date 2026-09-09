import { create } from 'zustand';
import type { Board, BoardNode } from '@shared/types.js';
import type { Command, CommandResult, HistoryStatus } from '@shared/commands.js';
import type { BoardLoad, NodeStatus } from '@shared/ipc.js';
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

export interface Toast {
  id: number;
  level: 'ok' | 'warn' | 'fault';
  text: string;
}

interface BoardState {
  boardId: string;
  load: BoardLoad | null;
  board: Board | null;

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

  loadBoard: (boardId: string) => Promise<void>;
  refreshTargets: () => Promise<void>;
  select: (nodeId: string | null) => void;
  setMode: (mode: EditMode) => void;
  beginEdit: (nodeId: string) => void;
  cancelEdit: () => void;
  toggleFocus: () => void;

  runCommand: (command: Command, label?: string) => Promise<CommandResult>;
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
  selectedId: null,
  editingId: null,
  mode: 'view',
  targets: {},
  history: EMPTY_HISTORY,
  toasts: [],
  busy: false,
  focus: false,

  loadBoard: async (boardId) => {
    set({ busy: true });
    const load = await window.skynet['board:load'](boardId);
    set({
      boardId,
      load,
      board: load.ok ? load.board : null,
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

  setMode: (mode) => set({ mode, editingId: mode === 'view' ? null : get().editingId }),

  beginEdit: (nodeId) => set({ mode: 'edit', selectedId: nodeId, editingId: nodeId }),

  cancelEdit: () => set({ editingId: null }),

  toggleFocus: () => set((state) => ({ focus: !state.focus })),

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
