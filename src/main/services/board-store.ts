import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { app } from 'electron';
import type { Board } from '@shared/types.js';
import type { BoardLoad } from '@shared/ipc.js';

/**
 * Reads board/*.board.json off disk.
 *
 * M0 does structure and containment only. M1 adds full JSON Schema validation in-process (the
 * same schema tools/validate-board.mjs uses) so a malformed board shows a legible error on the
 * canvas instead of a blank screen. Until then a parse failure is still returned as data, never
 * thrown, because "if it can't resolve, show it broken" applies to the board file itself first.
 */

function boardRoot(): string {
  // Packaged: extraResources puts board/ next to the executable, outside app.asar, so it stays
  // hand-editable. Dev: the repo copy.
  return app.isPackaged ? join(process.resourcesPath, 'board') : join(app.getAppPath(), 'board');
}

/** boardId -> file path, rejecting anything that would escape board/. */
function resolveBoardFile(boardId: string): string | null {
  const root = boardRoot();
  const candidate = boardId === 'root'
    ? join(root, 'root.board.json')
    : join(root, boardId, 'room.board.json');

  const rel = relative(root, resolve(candidate));
  if (rel.startsWith('..') || isAbsolute(rel)) {
    // docs/07: path traversal is rejected. A board id is not a path.
    console.warn(`[board] rejected traversing board id "${boardId}"`);
    return null;
  }
  return candidate;
}

export function loadBoard(boardId: string): BoardLoad {
  const file = resolveBoardFile(boardId);
  if (!file) return { ok: false, file: boardId, error: `Illegal board id "${boardId}"` };
  if (!existsSync(file)) {
    return { ok: false, file, error: `BOARD FILE NOT FOUND — ${file}` };
  }
  try {
    const board = JSON.parse(readFileSync(file, 'utf8')) as Board;
    if (board.schemaVersion !== 1) {
      return { ok: false, file, error: `UNSUPPORTED SCHEMA VERSION ${String(board.schemaVersion)} — expected 1` };
    }
    return { ok: true, board, file };
  } catch (err) {
    return { ok: false, file, error: `MALFORMED BOARD JSON — ${(err as Error).message}` };
  }
}

export function listBoards(): string[] {
  const root = boardRoot();
  if (!existsSync(root)) return [];
  const ids: string[] = [];
  if (existsSync(join(root, 'root.board.json'))) ids.push('root');
  for (const entry of readdirSync(root)) {
    if (entry === '.snapshots') continue;
    const dir = join(root, entry);
    if (statSync(dir).isDirectory() && existsSync(join(dir, 'room.board.json'))) ids.push(entry);
  }
  return ids;
}
