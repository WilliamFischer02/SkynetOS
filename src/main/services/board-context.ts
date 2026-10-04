import { sanitiseBoardContext, type BoardContext } from '@shared/board-context.js';

/**
 * The last `board:context` the board window sent (packages/shared/board-context.ts): what is on
 * screen, for the conversation's BOARD block. Held in memory, never written, never sent anywhere
 * but into that prompt. The board window pushes it on every room change and selection change.
 */
let last: BoardContext | null = null;

export function setBoardContext(raw: unknown): { ok: boolean } {
  const ctx = sanitiseBoardContext(raw);
  if (!ctx) return { ok: false };
  last = ctx;
  return { ok: true };
}

export function boardContext(): BoardContext | null {
  return last;
}
