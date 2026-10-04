import type { BoardLoad } from '@shared/ipc.js';
import type { BoardNode } from '@shared/types.js';
import { footprintOf } from '@shared/types.js';
import { isDestructive, type Command } from '@shared/commands.js';
import type { BoardHit, BoardOp } from '@shared/board-voice.js';
import { useBoardStore } from '../store/useBoardStore.js';

/**
 * The board by voice, in the renderer (docs/11 § Reaching into windows, the board, and a
 * terminal). packages/shared/board-voice.ts decides what a sentence means; this carries it out
 * with the store functions a click already uses: the index of every board (read-only, the same
 * loads a descent makes, as the command palette does), the walk up to the root and down the room
 * path, select, open, and the ONE write path: a rename or a note, read back, held here, and
 * applied through `runCommand` (`command:apply`, actor `user`) only after a spoken "go".
 *
 * That "go" is not the deletion confirmation and cannot become it: a pending edit is only ever a
 * `node.update` built by `boardWrite`, it is checked against DESTRUCTIVE again before it is held
 * and again before it is sent, and nothing here calls `command:confirmDestructive`.
 */

const MAX_DEPTH = 4;
const INDEX_TTL_MS = 15_000;
/** A read-back waits this long for "go"; after that, a "yes" is conversation again. */
export const PENDING_TTL_MS = 45_000;

let index: BoardHit[] = [];
let indexedAt = 0;
let indexing: Promise<BoardHit[]> | null = null;

async function indexBoards(): Promise<BoardHit[]> {
  const hits: BoardHit[] = [];
  const seen = new Set<string>();
  const walk = async (load: BoardLoad, boardId: string, path: string[], depth: number): Promise<void> => {
    if (!load.ok || seen.has(boardId)) return;
    seen.add(boardId);
    const room = (load.board.engraving ?? load.board.name).toUpperCase();
    for (const node of load.board.nodes) hits.push({ boardId, path, room, node });
    if (depth >= MAX_DEPTH) return;
    for (const node of load.board.nodes) {
      if (node.kind !== 'drive.room' || !node.boardFile) continue;
      const next = await window.skynet['board:loadRoom'](node.boardFile).catch(() => null);
      if (next?.ok) await walk(next, next.board.id, [...path, node.id], depth + 1);
    }
  };
  // The root is held in the store by the id it was loaded with, 'root', whatever its file says.
  await walk(await window.skynet['board:load']('root'), 'root', [], 0);
  return hits;
}

/** Re-read every board now. Concurrent calls share one walk. */
export function refreshBoardIndex(): Promise<BoardHit[]> {
  if (indexing) return indexing;
  indexing = indexBoards()
    .then((hits) => { index = hits; indexedAt = Date.now(); return hits; })
    .catch(() => index)
    .finally(() => { indexing = null; });
  return indexing;
}

/** The index as it is, for the pure grammar; a stale one is refreshed behind it for the next sentence. */
export function boardHits(): BoardHit[] {
  if (typeof window === 'undefined' || !window.skynet || typeof window.skynet['board:load'] !== 'function') return index;
  if (Date.now() - indexedAt > INDEX_TTL_MS) void refreshBoardIndex();
  return index;
}

/* ────────────────────────── the one pending write ────────────────────────── */

interface Pending { command: Command; label: string; readBack: string; at: number }
let pending: Pending | null = null;

export function hasPendingEdit(now: number = Date.now()): boolean {
  if (pending && now - pending.at > PENDING_TTL_MS) pending = null;
  return pending !== null;
}

/** "stop" and Esc drop it too. True when there was one. */
export function clearPendingEdit(): boolean {
  const had = pending !== null;
  pending = null;
  return had;
}

/* ────────────────────────── getting there ────────────────────────── */

/** Wait for a room change's iris to finish, since a descent is refused while one is running. */
async function settle(): Promise<void> {
  const until = Date.now() + 4000;
  while (useBoardStore.getState().transition && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Up to the root, then down the room path: each step the ordinary ascend or descend. */
export async function goToBoard(boardId: string, path: readonly string[]): Promise<boolean> {
  const get = useBoardStore.getState;
  if (get().boardId === boardId) return true;
  await settle();
  while (get().stack.length > 1) {
    const depth = get().stack.length;
    await get().ascend();
    await settle();
    if (get().stack.length >= depth) break;
  }
  for (const roomNodeId of path) {
    const depth = get().stack.length;
    await get().descend(roomNodeId);
    await settle();
    if (get().stack.length <= depth) break;
  }
  return get().boardId === boardId;
}

/** Go to the hit's board and find its node there, fresh from the store. */
async function reach(hit: BoardHit): Promise<BoardNode | null> {
  if (!(await goToBoard(hit.boardId, hit.path))) return null;
  return useBoardStore.getState().board?.nodes.find((n) => n.id === hit.node.id) ?? null;
}

function bringIntoView(node: BoardNode): void {
  const s = useBoardStore.getState();
  if (!s.board) return;
  const fp = footprintOf(node);
  const tile = s.board.grid.tile;
  s.select(node.id);
  s.requestJump({ x: (node.pos.x + fp.w / 2) * tile, y: (node.pos.y + fp.h / 2) * tile });
}

/* ────────────────────────── doing it ────────────────────────── */

/**
 * Carry out one board op. `say` replaces the intent's own line when set (a read-back, a failure,
 * a refusal); `ok: false` is also toasted by the caller.
 */
export async function runBoardOp(op: BoardOp): Promise<{ ok: boolean; say?: string }> {
  const store = useBoardStore.getState();
  switch (op.type) {
    case 'goto':
      return (await goToBoard(op.target.boardId, op.target.path)) ? { ok: true } : { ok: false, say: `I could not reach ${op.target.room}.` };
    case 'select':
    case 'inspect':
    case 'zoomTo': {
      const node = await reach(op.hit);
      if (!node) return { ok: false, say: `${op.hit.node.name} is no longer in ${op.hit.room}.` };
      bringIntoView(node);
      return { ok: true };
    }
    case 'open': {
      const node = await reach(op.hit);
      if (!node) return { ok: false, say: `${op.hit.node.name} is no longer in ${op.hit.room}.` };
      bringIntoView(node);
      // The same open a click makes: a launch outside the rules still raises its dialog on screen,
      // and voice never answers it (docs/07).
      await useBoardStore.getState().openNode(node.id);
      return { ok: true };
    }
    case 'write': {
      if (isDestructive(op.command)) return { ok: false, say: "I don't delete by voice." };
      pending = { command: op.command, label: op.label, readBack: op.readBack, at: Date.now() };
      return { ok: true, say: op.readBack };
    }
    case 'answer': {
      if (!hasPendingEdit()) return { ok: false, say: op.yes ? 'Nothing is waiting for a yes.' : 'Nothing was waiting.' };
      const held = pending!;
      pending = null;
      if (!op.yes) return { ok: true, say: 'Cancelled.' };
      if (isDestructive(held.command)) return { ok: false, say: "I don't delete by voice." };
      store.setInputSource('user');
      const result = await useBoardStore.getState().runCommand(held.command, held.label);
      if (!result.ok) return { ok: false, say: result.error };
      void refreshBoardIndex();
      return { ok: true, say: 'Done.' };
    }
  }
}

// Warm the index a few seconds after the board window starts, so the first spoken "go to the
// deduction room" does not find an empty one. Read-only, and refreshed every 15 s of use after.
if (typeof window !== 'undefined') {
  setTimeout(() => {
    if (window.skynet && typeof window.skynet['board:load'] === 'function') void refreshBoardIndex();
  }, 3000);
}
