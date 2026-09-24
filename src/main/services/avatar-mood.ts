import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { AvatarMood } from '@shared/avatar.js';
import type { NodeKind } from '@shared/types.js';
import { isSpeaking, streamingProbeScript } from '@shared/avatar-window.js';
import { loadBoard } from './board-store.js';
import { chatWindowFor } from './chat-window.js';
import { listSessions } from './session-manager.js';
import { claudeProjectsDir, projectDirName } from './conversations.js';
import { boardWindow } from './main-window.js';

/**
 * Who is speaking, per node, for the board's animated JARVIS-face logos (`logoSource: avatar-live`).
 *
 * William: the logo is "the box it generates for the typical window but as a logo graphic", so it
 * should talk when that node's JARVIS talks. The face WINDOWS have their own detectors
 * (avatar-window.ts), but those live and die with the windows: switch face windows off and they are
 * gone. A logo needs the same answer regardless. So the board says which nodes on the room it is
 * showing carry a live face (`avatar:watchNodes`), and this watches exactly those and nothing else:
 *
 *   agent.jarvis / agent.chat   its claude.ai window, if open, visible and FINISHED LOADING, gets the
 *                               same read-only streaming probe the web face uses (it only looks: no
 *                               click, no typing, no events). A window still loading is never probed.
 *   agent.code / agent.audit    its live session's transcript: written in the last 2.5 s means
 *                               JARVIS is working or talking. A stat, never a read.
 *   anything else               no detector; the face idles and blinks.
 *
 * A mood is pushed to the board only when it changes. Nothing runs while nothing is watched.
 */

const POLL_MS = 500;
/** A room with more live faces than this is a room that does not need them all talking. */
const MAX_WATCHED = 32;

interface Watched {
  kind: NodeKind;
  /** Transcript bookkeeping, for session-backed nodes. */
  file: string | null;
  lastMtime: number;
  lastWrite: number | null;
}

let boardId = '';
const watched = new Map<string, Watched>();
const moods = new Map<string, AvatarMood>();
const probing = new Set<string>();
let timer: ReturnType<typeof setInterval> | null = null;

function emit(nodeId: string, mood: AvatarMood): void {
  if (moods.get(nodeId) === mood) return;
  moods.set(nodeId, mood);
  const win = boardWindow();
  if (win && !win.isDestroyed()) win.webContents.send('avatar:nodeMood', { boardId, nodeId, mood });
}

function probeChat(nodeId: string): void {
  const win = chatWindowFor(nodeId);
  if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized() || win.webContents.isLoading()) {
    emit(nodeId, 'idle');
    return;
  }
  if (probing.has(nodeId)) return;
  probing.add(nodeId);
  win.webContents.executeJavaScript(streamingProbeScript(), false)
    .then((streaming: unknown) => emit(nodeId, streaming === true ? 'speaking' : 'idle'))
    .catch(() => emit(nodeId, 'idle'))
    .finally(() => probing.delete(nodeId));
}

function checkTranscript(nodeId: string, entry: Watched, now: number): void {
  const session = listSessions().find((s) =>
    s.boardId === boardId && s.nodeId === nodeId && (s.state === 'running' || s.state === 'starting') && s.claudeSessionId);
  if (!session?.claudeSessionId) {
    entry.file = null;
    entry.lastMtime = -1;
    entry.lastWrite = null;
    emit(nodeId, 'idle');
    return;
  }
  const file = join(claudeProjectsDir(), projectDirName(session.cwd), `${session.claudeSessionId}.jsonl`);
  if (entry.file !== file) { entry.file = file; entry.lastMtime = -1; entry.lastWrite = null; }
  try {
    const m = statSync(file).mtimeMs;
    // The first reading is a baseline: an old transcript of a resumed session is not speech.
    if (entry.lastMtime >= 0 && m > entry.lastMtime) entry.lastWrite = now;
    entry.lastMtime = m;
  } catch {
    if (entry.lastMtime < 0) entry.lastMtime = 0;
  }
  emit(nodeId, isSpeaking(entry.lastWrite, now) ? 'speaking' : 'idle');
}

function tick(): void {
  const now = Date.now();
  for (const [nodeId, entry] of watched) {
    if (entry.kind === 'agent.jarvis' || entry.kind === 'agent.chat') probeChat(nodeId);
    else if (entry.kind === 'agent.code' || entry.kind === 'agent.audit') checkTranscript(nodeId, entry, now);
    else emit(nodeId, 'idle');
  }
}

/**
 * The board's list of nodes showing a live face on the room it is looking at. Replaces the last
 * list; an empty one stops everything. Answers with the moods known right now, so a face that
 * appears mid-sentence opens talking rather than waiting half a second.
 */
export function watchNodeMoods(nextBoardId: string, nodeIds: string[]): { ok: boolean; moods: Record<string, AvatarMood> } {
  const ids = [...new Set(nodeIds.filter((id) => typeof id === 'string'))].slice(0, MAX_WATCHED);
  const load = ids.length ? loadBoard(nextBoardId) : null;
  const kinds = new Map((load && load.ok ? load.board.nodes : []).map((n) => [n.id, n.kind] as const));

  if (nextBoardId !== boardId) { watched.clear(); moods.clear(); }
  boardId = nextBoardId;
  for (const id of [...watched.keys()]) if (!ids.includes(id)) { watched.delete(id); moods.delete(id); }
  for (const id of ids) {
    const kind = kinds.get(id);
    if (!kind) continue;
    const existing = watched.get(id);
    if (existing) existing.kind = kind;
    else watched.set(id, { kind, file: null, lastMtime: -1, lastWrite: null });
  }

  if (watched.size && !timer) timer = setInterval(tick, POLL_MS);
  if (!watched.size && timer) { clearInterval(timer); timer = null; }
  if (watched.size) tick();
  return { ok: true, moods: Object.fromEntries([...watched.keys()].map((id) => [id, moods.get(id) ?? 'idle'])) };
}

export function stopNodeMoods(): void {
  if (timer) clearInterval(timer);
  timer = null;
  watched.clear();
  moods.clear();
}
