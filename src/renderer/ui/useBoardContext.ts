import { useEffect } from 'react';
import { boardContextFrom, type BoardContext } from '@shared/board-context.js';
import { useBoardStore } from '../store/useBoardStore.js';

/**
 * What JARVIS's conversation can see of the board (2026-09-27; packages/shared/board-context.ts).
 * William: the spoken reply said it "needs the board state streamed to it". On every room change,
 * selection change and edit of the board on screen, this sends main a read-only summary
 * (`board:context`, user-only, the board window alone): the room and its path, the selection,
 * the nodes, and the root board's rooms (remembered from the last time the root was on screen).
 * Coalesced to one message per 250 ms and not re-sent when nothing changed. Nothing is written.
 */
export function useBoardContext(): void {
  useEffect(() => {
    if (typeof (window.skynet as unknown as Record<string, unknown>)['board:context'] !== 'function') return;
    let rootRooms: { id: string; name: string }[] = [];
    let lastKey = '';
    let timer: number | null = null;
    const send = (): void => {
      timer = null;
      const s = useBoardStore.getState();
      if (s.board && s.board.id === 'root') {
        rootRooms = s.board.nodes.filter((n) => n.kind === 'drive.room').map((n) => ({ id: n.id, name: n.name }));
      }
      const ctx: BoardContext | null = boardContextFrom({ boardId: s.boardId, board: s.board, stack: s.stack, selectedId: s.selectedId, rootRooms });
      if (!ctx) return;
      const key = JSON.stringify(ctx);
      if (key === lastKey) return;
      lastKey = key;
      void window.skynet['board:context'](ctx).catch(() => undefined);
    };
    const schedule = (): void => { if (timer === null) timer = window.setTimeout(send, 250); };
    send();
    const unsubscribe = useBoardStore.subscribe((state, prev) => {
      if (state.boardId !== prev.boardId || state.selectedId !== prev.selectedId || state.board !== prev.board || state.stack !== prev.stack) schedule();
    });
    return () => { unsubscribe(); if (timer !== null) window.clearTimeout(timer); };
  }, []);
}
