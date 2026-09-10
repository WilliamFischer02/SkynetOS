import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { app } from 'electron';

/**
 * Runtime state: %APPDATA%/SkynetOS/skynet.db.
 *
 * docs/01 §Data model separates the three stores by lifetime. This is the fast-changing,
 * machine-local one — sessions, telemetry, heat, artifacts, git state. It is worthless to diff,
 * so it is not git-tracked, and deleting it must lose nothing but history: the board and the
 * codex are unaffected, and a node whose session id is gone simply starts a fresh conversation.
 *
 * `node:sqlite`, not better-sqlite3. Electron 44 bundles Node 24 with SQLite 3.53 and FTS5
 * compiled in, so this is a built-in module with a synchronous API and no native build step —
 * which is what killed better-sqlite3 on this machine. See docs/DECISIONS.md 2026-09-09.
 */

let db: DatabaseSync | null = null;

export function databaseFile(): string {
  return join(app.getPath('userData'), 'skynet.db');
}

export function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(app.getPath('userData'), { recursive: true });
  db = new DatabaseSync(databaseFile());

  // WAL so a crash mid-write cannot corrupt the file, and so a read never blocks behind a write.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  console.log(`[db] ${databaseFile()}`);
  return db;
}

/**
 * Schema migrations, applied in order and recorded in `user_version`.
 *
 * Deliberately not an ORM and not a migration library: this is four tables on a single-user
 * desktop app, and a dependency that has to still work in a decade is a dependency that should
 * not exist. Each step is idempotent-by-position — never edit a shipped step, add a new one.
 */
const MIGRATIONS: readonly ((d: DatabaseSync) => void)[] = [
  (d) => {
    d.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id                TEXT PRIMARY KEY,
        node_id           TEXT NOT NULL,
        board_id          TEXT NOT NULL,
        kind              TEXT NOT NULL,
        cwd               TEXT NOT NULL,
        claude_session_id TEXT,
        pid               INTEGER,
        started_at        TEXT NOT NULL,
        ended_at          TEXT,
        exit_code         INTEGER,
        last_error        TEXT
      );
      CREATE INDEX IF NOT EXISTS sessions_by_node ON sessions (board_id, node_id, started_at DESC);

      CREATE TABLE IF NOT EXISTS events (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        ts        TEXT NOT NULL,
        board_id  TEXT NOT NULL,
        node_id   TEXT NOT NULL,
        kind      TEXT NOT NULL,
        magnitude REAL NOT NULL DEFAULT 1,
        meta_json TEXT
      );
      CREATE INDEX IF NOT EXISTS events_by_node ON events (board_id, node_id, ts DESC);
    `);
  }
];

function migrate(d: DatabaseSync): void {
  const row = d.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  const current = row?.user_version ?? 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    MIGRATIONS[i]!(d);
    // PRAGMA will not take a bound parameter, and i is a loop index, not user input.
    d.exec(`PRAGMA user_version = ${i + 1}`);
    console.log(`[db] applied migration ${i + 1}`);
  }
}

export interface SessionRow {
  id: string;
  node_id: string;
  board_id: string;
  kind: string;
  cwd: string;
  claude_session_id: string | null;
  pid: number | null;
  started_at: string;
  ended_at: string | null;
  exit_code: number | null;
  last_error: string | null;
}

export function insertSession(row: Omit<SessionRow, 'ended_at' | 'exit_code' | 'last_error'>): void {
  getDb().prepare(`
    INSERT INTO sessions (id, node_id, board_id, kind, cwd, claude_session_id, pid, started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, row.node_id, row.board_id, row.kind, row.cwd, row.claude_session_id, row.pid, row.started_at);
}

export function endSession(id: string, exitCode: number | null, error?: string): void {
  getDb().prepare(
    'UPDATE sessions SET ended_at = ?, exit_code = ?, last_error = ? WHERE id = ?'
  ).run(new Date().toISOString(), exitCode, error ?? null, id);
}

export function setSessionPid(id: string, pid: number | null): void {
  getDb().prepare('UPDATE sessions SET pid = ? WHERE id = ?').run(pid, id);
}

/**
 * The Claude Code conversation id this node last used, or null.
 *
 * This is what makes a chip reopen *its* conversation instead of a fresh one. It is stored per
 * node rather than per session row, so a node keeps its conversation across many launches.
 */
export function lastClaudeSessionId(boardId: string, nodeId: string): string | null {
  const row = getDb().prepare(`
    SELECT claude_session_id FROM sessions
    WHERE board_id = ? AND node_id = ? AND claude_session_id IS NOT NULL
    ORDER BY started_at DESC LIMIT 1
  `).get(boardId, nodeId) as { claude_session_id: string } | undefined;
  return row?.claude_session_id ?? null;
}

export function liveSessions(): SessionRow[] {
  return getDb().prepare(
    'SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC'
  ).all() as unknown as SessionRow[];
}

export function sessionsForNode(boardId: string, nodeId: string, limit = 10): SessionRow[] {
  return getDb().prepare(`
    SELECT * FROM sessions WHERE board_id = ? AND node_id = ?
    ORDER BY started_at DESC LIMIT ?
  `).all(boardId, nodeId, limit) as unknown as SessionRow[];
}

export function recordEvent(boardId: string, nodeId: string, kind: string, magnitude = 1, meta?: unknown): void {
  getDb().prepare(
    'INSERT INTO events (ts, board_id, node_id, kind, magnitude, meta_json) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(new Date().toISOString(), boardId, nodeId, kind, magnitude, meta === undefined ? null : JSON.stringify(meta));
}

/**
 * Mark every session that claims to be live but whose process is gone as ended.
 *
 * Called at launch. A crash, a reboot, or a Task Manager kill all leave rows saying "running"
 * that are not, and a session dock that lies about what is running is worse than no dock.
 */
export function reapDeadSessions(): number {
  let reaped = 0;
  for (const row of liveSessions()) {
    if (row.pid === null) { endSession(row.id, null, 'no pid recorded'); reaped++; continue; }
    if (!isProcessAlive(row.pid)) { endSession(row.id, null, 'process gone at startup'); reaped++; }
  }
  if (reaped) console.log(`[db] reaped ${reaped} stale session row(s)`);
  return reaped;
}

/** Signal 0 tests for existence without touching the process. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists and belongs to someone else — still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function closeDb(): void {
  db?.close();
  db = null;
}
