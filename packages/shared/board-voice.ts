/**
 * The board by voice, across every room (docs/11 § Reaching into windows, the board, and a
 * terminal; rules in docs/07 § JARVIS Voice, the board-by-voice row).
 *
 * William: "go to the deduction room", "select TIMESERVED JAR", "open JARVIS-PRIME", "rename
 * TIMESERVED JAR to TimeServed 1.3". intent.ts already knew select, open, go and rename inside the
 * room on screen. This is the other half, PURE: finding a node or a room on ANY board (the room on
 * screen first, then every board), the words that answer a read-back, and the shape of a write.
 *
 * What it never does: destroy. A deletion by voice is refused in words ("I don't delete by
 * voice."), and `boardWrite` will not build a DESTRUCTIVE command at all, so the "go" that
 * confirms a read-back edit can only ever apply a rename or a note. That "go" is its own path
 * (actOnIntent's `board` case, src/renderer/ui/boardVoice.ts) and never reaches
 * `command:confirmDestructive`, which stays the deletion dialog and nothing else.
 */

import type { BoardNode } from './types.js';
import type { Command } from './commands.js';
import { isDestructive } from './commands.js';

/** One node on one board, and how to reach that board from the root. */
export interface BoardHit {
  boardId: string;
  /** The drive.room node ids to descend through from the root, in order ([] for the root). */
  path: string[];
  /** The board's engraving, upper case: "DEDUCTIONOS". */
  room: string;
  node: BoardNode;
}

/** A room to go to: the board, the path to it, and its engraving. */
export interface RoomTarget {
  boardId: string;
  path: string[];
  room: string;
}

/** What a spoken board sentence becomes, for actOnIntent's `board` case. */
export type BoardOp =
  | { type: 'goto'; target: RoomTarget }
  | { type: 'select' | 'open' | 'inspect' | 'zoomTo'; hit: BoardHit }
  | { type: 'write'; hit: BoardHit; command: Command; label: string; readBack: string }
  | { type: 'answer'; yes: boolean };

export type Scorer = (phrase: string, node: BoardNode) => number;

/** A node on another board must be named this well: whole words, not a prefix or a tag. */
export const ELSEWHERE_MIN_SCORE = 56;
/** Scores this close to the best are rivals: ask, do not guess (intent.ts's rule). */
const RIVAL_BAND = 6;

const norm = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

export interface AcrossMatch {
  hit?: BoardHit;
  candidates: BoardHit[];
}

/**
 * The node a phrase names, the room on screen first, then every board. On screen, any score
 * counts (as `matchNode`); elsewhere only a whole-word match (ELSEWHERE_MIN_SCORE), so a stray
 * prefix on a board nobody is looking at does not win. Close seconds come back as candidates.
 */
export function matchAcrossBoards(
  phrase: string,
  currentBoardId: string,
  hits: readonly BoardHit[],
  score: Scorer,
  accept: (node: BoardNode) => boolean = () => true
): AcrossMatch {
  const scored = hits
    .filter((h) => accept(h.node))
    .map((hit) => ({ hit, score: score(phrase, hit.node) }))
    .filter((s) => s.score > 0);
  const pick = (pool: { hit: BoardHit; score: number }[]): AcrossMatch => {
    if (!pool.length) return { candidates: [] };
    pool.sort((a, b) => b.score - a.score);
    const best = pool[0]!;
    const rivals = pool.filter((s) => s.score >= best.score - RIVAL_BAND);
    // The same node reached twice (a room indexed from two parents) is one node, not a rivalry.
    const distinct = rivals.filter((r, i) => rivals.findIndex((o) => o.hit.boardId === r.hit.boardId && o.hit.node.id === r.hit.node.id) === i);
    return distinct.length > 1 ? { candidates: distinct.map((r) => r.hit) } : { hit: best.hit, candidates: [] };
  };
  const here = pick(scored.filter((s) => s.hit.boardId === currentBoardId));
  if (here.hit || here.candidates.length) return here;
  return pick(scored.filter((s) => s.hit.boardId !== currentBoardId && s.score >= ELSEWHERE_MIN_SCORE));
}

/** The board a drive.room node leads to, from the index (its children's board id), or its folder. */
function roomBoardId(room: BoardHit, hits: readonly BoardHit[]): string {
  const path = [...room.path, room.node.id];
  const child = hits.find((h) => h.path.length === path.length && h.path.every((p, i) => p === path[i]));
  if (child) return child.boardId;
  return (room.node.boardFile ?? '').split(/[\\/]/)[0] || room.node.id;
}

const ROOT_WORDS = /^(?:root|the root|home|the mainboard|mainboard|the main board|main board|top|the top|the motherboard|motherboard)$/;

/**
 * A room by name: a drive.room node ("Deduction"), a board's engraving ("DEDUCTIONOS"), or the
 * root ("the mainboard", "home"). "room", "board" and "the" are ignored. Null when none fits, or
 * when two fit equally (the caller asks).
 */
export function matchRoom(phrase: string, hits: readonly BoardHit[], score: Scorer): RoomTarget | { candidates: RoomTarget[] } | null {
  const asked = norm(phrase).replace(/\b(?:room|board|os)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!asked) return null;
  if (ROOT_WORDS.test(asked)) return { boardId: 'root', path: [], room: (hits.find((h) => h.boardId === 'root')?.room ?? 'ROOT') };
  const rooms = hits.filter((h) => h.node.kind === 'drive.room' && h.node.boardFile);
  const targets = rooms.map((r) => {
    const boardId = roomBoardId(r, hits);
    const engraving = hits.find((h) => h.boardId === boardId)?.room ?? r.node.name.toUpperCase();
    const byNode = score(asked, r.node);
    const eng = norm(engraving).replace(/\bos\b/g, ' ').trim();
    const byEngraving = eng === asked || norm(engraving) === asked ? 100 : eng.startsWith(asked) || asked.startsWith(eng) ? 60 : 0;
    return { target: { boardId, path: [...r.path, r.node.id], room: engraving }, score: Math.max(byNode, byEngraving) };
  }).filter((t) => t.score > 0).sort((a, b) => b.score - a.score);
  if (!targets.length) return null;
  const best = targets[0]!;
  const rivals = targets.filter((t) => t.score >= best.score - RIVAL_BAND && t.target.boardId !== best.target.boardId);
  if (rivals.length) return { candidates: [best.target, ...rivals.map((r) => r.target)] };
  return best.target;
}

/* ────────────────────────── the words ────────────────────────── */

const YES = /^(?:go|go ahead|go on|yes|yeah|yep|yup|do it|do that|confirm|confirmed|proceed|make it so|affirmative|please do|yes please|go for it|ok|okay|sure|correct|that s right)$/;
const NO = /^(?:no|nope|nah|cancel|cancel that|cancel it|don t|do not|never mind|abort|leave it|no thanks|no thank you|scrap that|forget it|forget that|wait no)$/;

/** "go" / "yes" / "do it" is true, "no" / "cancel" false, anything else null. Normalised text. */
export function boardAnswer(text: string): boolean | null {
  const t = norm(text);
  if (YES.test(t)) return true;
  if (NO.test(t)) return false;
  return null;
}

/** A spoken deletion, in any of the words for one. Voice refuses these outright (docs/07). */
export const VOICE_DELETION = /^(?:delete|remove|destroy|get rid of|kill|erase|trash|bin|wipe|unapprove|un approve|disapprove) (.+)$/;
export const VOICE_DELETION_REFUSAL = "I don't delete by voice.";

export function isVoiceDeletion(text: string): boolean {
  return VOICE_DELETION.test(norm(text));
}

/** "set X's notes to …", "set the notes on X to …": the node words and the normalised value. */
export function parseNotes(text: string): { target: string; value: string } | null {
  const t = norm(text);
  const m = /^(?:set|change|update|make|write) (?:the )?notes? (?:of|for|on) (.+?) (?:to|as) (.+)$/.exec(t)
    ?? /^(?:set|change|update|make) (.+?)(?: s)? notes? (?:to|as|say|read|so they say) (.+)$/.exec(t);
  return m ? { target: m[1]!.trim(), value: m[2]!.trim() } : null;
}

/** "move X to the deduction room": node words and room words. The caller refuses it in words. */
export function parseMoveToRoom(text: string): { target: string; room: string } | null {
  const m = /^(?:move|send|put|take|shift) (.+?) (?:to|into|in|over to|across to) (?:the )?(.+?)(?: room| board)?$/.exec(norm(text));
  return m ? { target: m[1]!.trim(), room: m[2]!.trim() } : null;
}

/**
 * What was actually said after the value keyword, case and punctuation kept: the raw twin of a
 * normalised `(target) to (value)` match, with the same lazy first split. `verbs` is a regex
 * alternation for the sentence's verb, `joins` for the word before the value.
 */
export function rawValue(raw: string, verbs: string, joins: string, keepPeriod = false): string | null {
  const re = new RegExp(`\\b(?:${verbs})\\b[\\s\\S]*?\\s(?:${joins})\\s+([\\s\\S]+)$`, 'i');
  const m = re.exec(raw.trim());
  if (!m) return null;
  let v = m[1]!.trim().replace(/^["'“‘]+|["'”’]+$/g, '').trim();
  if (!keepPeriod) v = v.replace(/[.!?]+$/, '').trim();
  return v || null;
}

const MAX_NAME = 80;
const MAX_NOTES = 2000;

/**
 * A board write by voice: a rename or a note, as a `node.update` read back before it lands. Null
 * for anything else, and null for any DESTRUCTIVE command whatever built it: a spoken "go" can
 * never apply one (docs/07: a deletion needs a human's hand on the dialog).
 */
export function boardWrite(hit: BoardHit, field: 'name' | 'notes', value: string, spokenName: string): BoardOp | null {
  const clean = value.replace(/\s+/g, ' ').trim().slice(0, field === 'name' ? MAX_NAME : MAX_NOTES);
  if (!clean) return null;
  const command: Command = { type: 'node.update', boardId: hit.boardId, nodeId: hit.node.id, patch: field === 'name' ? { name: clean } : { notes: clean } };
  if (isDestructive(command)) return null;
  const where = hit.path.length ? ` in ${hit.room}` : '';
  const shown = clean.replace(/[.!?]+$/, '');
  const short = shown.length > 60 ? `${shown.slice(0, 57)}...` : shown;
  const readBack = field === 'name'
    ? `Renaming ${spokenName}${where} to ${shown}. Go?`
    : `Setting ${spokenName}'s notes${where} to "${short}". Go?`;
  return { type: 'write', hit, command, label: field === 'name' ? 'voice: rename' : 'voice: notes', readBack };
}

/** Which one: "TIMESERVED JAR in STORYOS, or TIMESERVED in GAMEOS?" */
export function whichOne(candidates: readonly BoardHit[]): string {
  return `Which one: ${candidates.slice(0, 4).map((c) => `${c.node.designator ? `${c.node.designator} ` : ''}${c.node.name} in ${c.room}`).join(', or ')}?`;
}

/** A refused cross-room move, in words: the bus has no command that moves a node between boards. */
export function moveBetweenRoomsRefusal(name: string, room: string): string {
  return `The board has no command that moves ${name} into ${room}, so I will not fake one by voice. Copy it, paste it there, and delete the original by hand.`;
}
