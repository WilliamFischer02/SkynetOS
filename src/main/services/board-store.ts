import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { app } from 'electron';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { footprintOf, type Board, type BoardNode } from '@shared/types.js';
import type { BoardLoad } from '@shared/ipc.js';

/**
 * Reads, validates and writes board/*.board.json.
 *
 * The same JSON Schema that `npm run validate:board` uses runs here, in-process, on every load
 * AND on every write. That matters more on write: a command that would produce an invalid board
 * is rejected before anything touches the disk, so the board file on disk is never in a state
 * the app cannot load. "Data before pixels" only holds if the data is guaranteed good.
 */

let validator: ValidateFunction<Board> | null = null;

function schemaPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'schema', 'board.schema.json')
    : join(app.getAppPath(), 'schema', 'board.schema.json');
}

function getValidator(): ValidateFunction<Board> {
  if (validator) return validator;
  const schema = JSON.parse(readFileSync(schemaPath(), 'utf8')) as object;
  const ajv = addFormats(new Ajv2020({ allErrors: true, strict: false }));
  validator = ajv.compile<Board>(schema);
  return validator;
}

export function boardRoot(): string {
  // Packaged: extraResources puts board/ next to the executable, outside app.asar, so it stays
  // hand-editable and git-diffable. Dev: the repo copy.
  return app.isPackaged ? join(process.resourcesPath, 'board') : join(app.getAppPath(), 'board');
}

function snapshotRoot(): string {
  return join(boardRoot(), '.snapshots');
}

/** boardId -> file path, rejecting anything that would escape board/. */
export function resolveBoardFile(boardId: string): string | null {
  if (!/^[a-z0-9_-]+$/.test(boardId)) return null;
  const root = boardRoot();
  const candidate = boardId === 'root'
    ? join(root, 'root.board.json')
    : join(root, boardId, 'room.board.json');

  const rel = relative(root, resolve(candidate));
  if (rel.startsWith('..') || isAbsolute(rel)) {
    console.warn(`[board] rejected traversing board id "${boardId}"`);
    return null;
  }
  return candidate;
}

/** Schema errors as a list of readable lines, in the board's voice. */
export function schemaProblems(board: unknown): string[] {
  const validate = getValidator();
  if (validate(board)) return [];
  return (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`);
}

/**
 * Graph-level checks the schema cannot express: duplicate ids, footprint overlap, off-board
 * nodes, dangling edges. Mirrors tools/validate-board.mjs so the CLI and the app agree.
 */
export function graphProblems(board: Board): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const occupied = new Map<string, string>();

  for (const node of board.nodes) {
    if (ids.has(node.id)) problems.push(`duplicate node id "${node.id}"`);
    ids.add(node.id);

    if (node.kind === 'note.silk' || node.kind === 'group.zone') continue;
    const { w, h } = footprintOf(node);
    if (node.pos.x + w > board.grid.width || node.pos.y + h > board.grid.height) {
      problems.push(`node "${node.id}" extends past the board edge`);
    }
    for (let y = node.pos.y; y < node.pos.y + h; y++) {
      for (let x = node.pos.x; x < node.pos.x + w; x++) {
        const key = `${x},${y}`;
        const other = occupied.get(key);
        if (other) problems.push(`node "${node.id}" overlaps "${other}" at ${key}`);
        else occupied.set(key, node.id);
      }
    }
  }

  for (const edge of board.edges) {
    if (!ids.has(edge.from)) problems.push(`trace "${edge.id}" starts at unknown node "${edge.from}"`);
    if (!ids.has(edge.to)) problems.push(`trace "${edge.id}" ends at unknown node "${edge.to}"`);
  }

  for (const node of board.nodes) {
    for (const field of ['path', 'cwd', 'localPath', 'boardFile'] as const) {
      const value = node[field];
      if (typeof value === 'string' && value.includes('..')) {
        problems.push(`node "${node.id}" ${field} contains ".." — path traversal is not allowed`);
      }
    }
  }

  return [...new Set(problems)];
}

export function validateBoard(board: unknown): string[] {
  const schema = schemaProblems(board);
  if (schema.length) return schema;
  return graphProblems(board as Board);
}

export function loadBoard(boardId: string): BoardLoad {
  const file = resolveBoardFile(boardId);
  if (!file) return { ok: false, file: boardId, error: `ILLEGAL BOARD ID — "${boardId}"` };
  if (!existsSync(file)) return { ok: false, file, error: `BOARD FILE NOT FOUND — ${file}` };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    return { ok: false, file, error: `MALFORMED BOARD JSON — ${(err as Error).message}` };
  }

  const problems = validateBoard(parsed);
  if (problems.length) {
    return {
      ok: false,
      file,
      error: `BOARD FAILS SCHEMA (${problems.length} problem${problems.length === 1 ? '' : 's'})`,
      problems
    };
  }
  return { ok: true, board: parsed as Board, file };
}

/**
 * Load a board by its FILE path, as a `drive.room` node names it.
 *
 * The board's own `id` field is the authority for what room you have arrived in — deriving it
 * from the path would break the moment a room file is named anything but `<id>/room.board.json`,
 * and the schema does not require that.
 */
export function loadBoardByFile(boardFile: string): BoardLoad {
  const root = boardRoot();
  const candidate = resolve(root, boardFile);
  const rel = relative(root, candidate);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return { ok: false, file: boardFile, error: `BOARD FILE ESCAPES board/ — ${boardFile}` };
  }
  if (!existsSync(candidate)) {
    return { ok: false, file: candidate, error: `BOARD FILE NOT FOUND — ${candidate}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(candidate, 'utf8'));
  } catch (err) {
    return { ok: false, file: candidate, error: `MALFORMED BOARD JSON — ${(err as Error).message}` };
  }
  const problems = validateBoard(parsed);
  if (problems.length) {
    return {
      ok: false,
      file: candidate,
      error: `BOARD FAILS SCHEMA (${problems.length} problem${problems.length === 1 ? '' : 's'})`,
      problems
    };
  }
  return { ok: true, board: parsed as Board, file: candidate };
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

/**
 * Copy every board file into board/.snapshots/<timestamp>-<label>/ before a mutation.
 *
 * docs/07 §Recovery: auto-snapshot before every agent mutation, retained 30 days. Doing it for
 * user mutations too costs a few kilobytes and means Ctrl+Z is not the only way back.
 */
export function snapshot(label: string): string | null {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeLabel = label.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'edit';
    const dir = join(snapshotRoot(), `${stamp}-${safeLabel}`);
    mkdirSync(dir, { recursive: true });
    for (const id of listBoards()) {
      const src = resolveBoardFile(id);
      if (!src || !existsSync(src)) continue;
      const dest = join(dir, id === 'root' ? 'root.board.json' : join(id, 'room.board.json'));
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(src, dest);
    }
    return dir;
  } catch (err) {
    console.error(`[board] snapshot failed: ${(err as Error).message}`);
    return null;
  }
}

export function pruneSnapshots(retentionDays: number): number {
  const root = snapshotRoot();
  if (!existsSync(root)) return 0;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry);
    try {
      if (statSync(dir).mtimeMs < cutoff) { rmSync(dir, { recursive: true, force: true }); removed++; }
    } catch { /* a snapshot we cannot stat is left alone rather than guessed about */ }
  }
  if (removed) console.log(`[board] pruned ${removed} snapshot(s) older than ${retentionDays} days`);
  return removed;
}

/**
 * THE canonical serialisation of a board file. One definition, used by the writer and enforced
 * by `npm run validate:board`, which fails if a file on disk is not already in this form.
 *
 * Why it is *enforced* rather than merely produced: board files are git-tracked and every change,
 * mine or an agent's, is meant to be reviewed as a diff. If the form on disk differs from what
 * the writer emits, the FIRST edit to a file reformats all 150 lines of it and buries the one
 * line that actually changed. Making the repo's form and the writer's form identical means a
 * one-field edit stays a one-line diff, forever. This was caught by the smoke harness reporting
 * that an edit followed by an undo did not restore the file byte-for-byte.
 *
 * 2-space indent, LF, trailing newline. LF explicitly: .gitattributes normalises to LF, and
 * emitting CRLF here would leave every board file dirty after the next checkout.
 */
export function canonicalBoardJson(board: Board): string {
  return JSON.stringify(board, null, 2).replace(/\r\n/g, '\n') + '\n';
}

/**
 * Write a board, but only if it validates. Returns the problems instead of writing when it does
 * not, so a bad command cannot leave an unloadable file behind.
 */
export function writeBoard(board: Board): { ok: true; file: string } | { ok: false; problems: string[] } {
  const problems = validateBoard(board);
  if (problems.length) return { ok: false, problems };
  const file = resolveBoardFile(board.id);
  if (!file) return { ok: false, problems: [`ILLEGAL BOARD ID — "${board.id}"`] };
  writeFileSync(file, canonicalBoardJson(board), 'utf8');
  return { ok: true, file };
}

/** Deep clone via JSON — board data is plain JSON by definition, so this is exact. */
export function cloneBoard(board: Board): Board {
  return JSON.parse(JSON.stringify(board)) as Board;
}

export function findNode(board: Board, nodeId: string): BoardNode | undefined {
  return board.nodes.find((n) => n.id === nodeId);
}
