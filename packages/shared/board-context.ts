/**
 * What JARVIS's conversation can SEE of the board (2026-09-27). William: the spoken reply said it
 * "needs the board state streamed to it". The board window pushes this read-only summary to main on
 * every room change and selection change (`board:context`, user-only, the board window alone), main
 * holds the last one, and services/converse.ts prints it into the prompt as a BOARD block of at most
 * 3,000 characters. Nothing here writes: the grammar still does every select, open and move.
 *
 * Pure: the renderer builds `BoardContext` from its store (`boardContextFrom`), main sanitises what
 * arrives (`sanitiseBoardContext`) and prints it (`boardBlock`). test/board-context.test.ts.
 */

import type { Board, BoardNode } from './types.js';

export interface BoardContextNode {
  id: string;
  designator?: string;
  name: string;
  kind: string;
  /** Where it points: a path or a URL. Only for the selected node. */
  target?: string;
}

export interface BoardContext {
  boardId: string;
  /** Room names from the root board to this one. */
  roomPath: string[];
  roomName: string;
  selected: BoardContextNode | null;
  /** Every node on the current board, at most BOARD_NODES_MAX. */
  nodes: BoardContextNode[];
  /** The rooms on the ROOT board (remembered from the last time the root was on screen). */
  rooms: { id: string; name: string }[];
}

export interface BoardContextSession {
  designator: string | null;
  name: string;
  state: string;
}

export const BOARD_NODES_MAX = 60;
export const BOARD_BLOCK_MAX = 3000;
const TEXT_MAX = 120;

const str = (v: unknown, max = TEXT_MAX): string =>
  // eslint-disable-next-line no-control-regex
  (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function node(n: unknown, withTarget: boolean): BoardContextNode | null {
  if (!n || typeof n !== 'object') return null;
  const o = n as Record<string, unknown>;
  const id = str(o['id'], 80);
  const name = str(o['name']);
  if (!id || !name) return null;
  const designator = str(o['designator'], 12);
  const target = withTarget ? str(o['target'], 260) : '';
  return { id, name, kind: str(o['kind'], 40) || 'node', ...(designator ? { designator } : {}), ...(target ? { target } : {}) };
}

/** What main accepts from the board window: typed, trimmed, capped. Anything else is null. */
export function sanitiseBoardContext(raw: unknown): BoardContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const boardId = str(o['boardId'], 80);
  if (!boardId) return null;
  const roomPath = Array.isArray(o['roomPath']) ? o['roomPath'].map((p) => str(p, 60)).filter(Boolean).slice(0, 12) : [];
  const nodes = Array.isArray(o['nodes']) ? o['nodes'].slice(0, BOARD_NODES_MAX).map((n) => node(n, false)).filter((n): n is BoardContextNode => n !== null) : [];
  const rooms = Array.isArray(o['rooms'])
    ? o['rooms'].slice(0, 40).map((r) => (r && typeof r === 'object' ? { id: str((r as Record<string, unknown>)['id'], 80), name: str((r as Record<string, unknown>)['name'], 60) } : null)).filter((r): r is { id: string; name: string } => !!r && !!r.id && !!r.name)
    : [];
  return { boardId, roomPath, roomName: str(o['roomName'], 60) || boardId, selected: node(o['selected'], true), nodes, rooms };
}

/** The board window's side: its store, as a summary. Paths only for the selected node. */
export function boardContextFrom(input: { boardId: string; board: Pick<Board, 'name' | 'nodes'> | null; stack: { engraving: string }[]; selectedId: string | null; rootRooms: { id: string; name: string }[] }): BoardContext | null {
  if (!input.board) return null;
  const nodes = input.board.nodes;
  const sel = input.selectedId ? nodes.find((n) => n.id === input.selectedId) ?? null : null;
  const summary = (n: BoardNode): BoardContextNode => ({ id: n.id, name: n.name, kind: n.kind, ...(n.designator ? { designator: n.designator } : {}) });
  return {
    boardId: input.boardId,
    roomPath: [...input.stack.map((c) => c.engraving), input.board.name].filter(Boolean),
    roomName: input.board.name,
    selected: sel ? { ...summary(sel), ...((sel.path ?? sel.url) ? { target: sel.path ?? sel.url } : {}) } : null,
    nodes: nodes.slice(0, BOARD_NODES_MAX).map(summary),
    rooms: input.rootRooms.slice(0, 40)
  };
}

const line = (n: BoardContextNode): string => `${n.designator ? `${n.designator} ` : ''}${n.name} (${n.kind})`;

/**
 * The BOARD block for the conversation prompt: the room and its path, the selection, every node
 * on this board (one per line, at most 60), the rooms on the root board, the sessions running, and
 * the turn's phase. At most BOARD_BLOCK_MAX characters; lines past the cap are dropped whole and
 * the block says how many.
 */
export function boardBlock(ctx: BoardContext | null, sessions: readonly BoardContextSession[], turnPhase: string): string {
  const out: string[] = ['BOARD (what is on William\'s SkynetOS board right now; read-only):'];
  if (!ctx) {
    out.push('The board window has not reported yet.');
  } else {
    out.push(`Room: ${ctx.roomName}${ctx.roomPath.length > 1 ? ` (path: ${ctx.roomPath.join(' > ')})` : ''}.`);
    out.push(ctx.selected ? `Selected: ${line(ctx.selected)}${ctx.selected.target ? ` -> ${ctx.selected.target}` : ''} [id ${ctx.selected.id}].` : 'Selected: nothing.');
    if (ctx.rooms.length) out.push(`Rooms on the root board: ${ctx.rooms.map((r) => r.name).join(', ')}.`);
  }
  const live = sessions.filter((s) => s.state === 'running' || s.state === 'starting');
  out.push(sessions.length
    ? `Sessions: ${sessions.slice(0, 12).map((s) => `${s.designator ? `${s.designator} ` : ''}${s.name} ${s.state === 'running' || s.state === 'starting' ? 'running' : 'not running'}`).join('; ')}.`
    : 'Sessions: none.');
  if (!live.length && sessions.length) out.push('No session is running.');
  out.push(`JARVIS is now: ${turnPhase}.`);
  if (ctx?.nodes.length) {
    out.push(`Nodes on this board (${ctx.nodes.length}):`);
    const head = out.join('\n').length;
    let used = head;
    let dropped = 0;
    for (const n of ctx.nodes) {
      const l = line(n);
      if (used + l.length + 1 > BOARD_BLOCK_MAX - 40) { dropped++; continue; }
      out.push(l);
      used += l.length + 1;
    }
    if (dropped) out.push(`(and ${dropped} more)`);
  }
  const text = out.join('\n');
  return text.length > BOARD_BLOCK_MAX ? text.slice(0, BOARD_BLOCK_MAX) : text;
}
