import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { BoardNode } from '@shared/types.js';
import { weightedTokens } from '@shared/usage.js';
import {
  buildJournalNote,
  decisionsOn,
  isoDate,
  localDateOf,
  localDateTime,
  nextFromHandoff,
  projectNameOf,
  type JournalProject,
  type JournalSession
} from '@shared/obsidian.js';
import { expandPath, skynetRoot } from './target-resolver.js';
import { findVaultRoot, readDailyNotesConfig, scanVault, templateKeysOf } from './obsidian.js';
import { readUsage } from './usage.js';
import { sessionsSince } from './db.js';
import { loadBoard } from './board-store.js';

/**
 * The nightly journal, written as an Obsidian note.
 *
 * William: "Update the nightly journal node to create a new obsidian note in the correct area /
 * vault and give it all of the metadata to prepare it to be saved into my vault with metadata
 * built-in and tag awareness / dynamic tagging."
 *
 * Everything in the note is what this machine actually recorded today:
 *   - Claude usage per project (usage.ts, the same attribution the couriers use);
 *   - the sessions launched from the board (skynet.db);
 *   - today's entries in docs/DECISIONS.md, and handoff.md's "What is next".
 * The folder and name follow the vault's own daily-notes settings, and the tags come from the
 * vault's own vocabulary before any new one is invented. See packages/shared/obsidian.ts.
 *
 * It CREATES a file and nothing else: `wx`, so an existing note is never overwritten, and a
 * folder that would climb out of the vault is refused. docs/07.
 */

export interface JournalWriteResult {
  ok: boolean;
  action: string;
  file?: string;
  error?: string;
}

const noteKey = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const pad = (n: number): string => String(n).padStart(2, '0');

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

export function writeJournalNote(node: BoardNode, now: Date = new Date()): JournalWriteResult {
  const fail = (error: string): JournalWriteResult => ({ ok: false, action: 'journal', error });

  if (!node.journalVault?.trim()) return fail('NO JOURNAL VAULT SET ON THIS NODE');
  const vault = findVaultRoot(node.journalVault);
  if (!vault) return fail(`NOT AN OBSIDIAN VAULT — ${expandPath(node.journalVault)} HAS NO .obsidian FOLDER`);

  const config = readDailyNotesConfig(vault);
  /*
   * The vault's own daily-notes folder, in a SkynetOS subfolder. The daily-notes folder is where
   * this vault keeps its journal, so that is "the correct area". The subfolder keeps a machine's
   * log out from among the entries a person wrote by hand.
   */
  const folder = (node.journalFolder?.trim() || `${config.folder ? `${config.folder}/` : 'Journal/'}SkynetOS`)
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  if (folder.split('/').some((part) => part === '..') || /^[A-Za-z]:/.test(folder)) {
    return fail('THE JOURNAL FOLDER MUST BE INSIDE THE VAULT');
  }

  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const hours = Math.max(1, Math.ceil((now.getTime() - midnight.getTime()) / 3_600_000));

  const scan = scanVault(vault, now.getTime());
  const notes = new Map<string, string>();
  for (const name of scan.notes) {
    const k = noteKey(name);
    if (k && !notes.has(k)) notes.set(k, name);
  }

  const usage = readUsage(hours);
  const projects: JournalProject[] = usage.projects
    .map((p) => ({ p, tokens: weightedTokens(p.window) }))
    .filter(({ tokens }) => tokens > 0)
    .map(({ p, tokens }) => {
      const name = projectNameOf(p.cwd || p.projectDir);
      return { name, tokens, messages: p.messagesInWindow, note: notes.get(noteKey(name)) ?? null };
    });

  const boards = new Map<string, { name: string; nodes: Map<string, BoardNode> } | null>();
  const boardOf = (id: string): { name: string; nodes: Map<string, BoardNode> } | null => {
    if (!boards.has(id)) {
      const load = loadBoard(id);
      boards.set(id, load.ok ? { name: load.board.name, nodes: new Map(load.board.nodes.map((n) => [n.id, n])) } : null);
    }
    return boards.get(id) ?? null;
  };
  let rows: ReturnType<typeof sessionsSince> = [];
  try {
    rows = sessionsSince(midnight.toISOString());
  } catch {
    rows = [];
  }
  const sessions: JournalSession[] = rows.map((row) => {
    const board = boardOf(row.board_id);
    const n = board?.nodes.get(row.node_id);
    const at = new Date(row.started_at);
    return {
      at: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
      label: n ? `${n.designator ? `${n.designator} ` : ''}${n.name}` : row.node_id,
      room: board?.name ?? row.board_id
    };
  });

  const today = localDateOf(now);
  const note = buildJournalNote({
    date: today,
    created: localDateTime(now),
    folder,
    format: config.format,
    projects,
    sessions,
    rooms: [...new Set(sessions.map((s) => s.room))],
    decisions: decisionsOn(readText(join(skynetRoot(), 'docs', 'DECISIONS.md')), isoDate(today)),
    next: nextFromHandoff(readText(join(skynetRoot(), 'handoff.md'))),
    vocabulary: scan.tags,
    templateKeys: templateKeysOf(vault, config.template),
    exists: (rel) => existsSync(join(vault, rel))
  });

  const file = join(vault, note.relPath);
  try {
    mkdirSync(join(vault, folder), { recursive: true });
    // `wx`: create, or fail if something appeared at that name since it was chosen. Never overwrite.
    writeFileSync(file, note.content, { encoding: 'utf8', flag: 'wx' });
  } catch (err) {
    return fail(`COULD NOT WRITE ${note.relPath} — ${(err as Error).message.split('\n')[0]}`);
  }
  return {
    ok: true,
    file,
    action: `wrote ${note.relPath} in the ${basename(vault)} vault · ${note.tags.length} tag${note.tags.length === 1 ? '' : 's'}`
  };
}
