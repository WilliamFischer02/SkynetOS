import type { BoardNode } from './types.js';
import { formatTokens } from './usage.js';

/**
 * Obsidian, as SkynetOS understands it. Pure: no disk access. The disk half is
 * src/main/services/obsidian.ts and src/main/services/journal.ts.
 *
 * William: "Obsidian is a program I want to work with and develop plugins for in order to create
 * further representations of my notes projects and thoughts. any agentic or node otherwise
 * compatible with obsidian should have that knowledge profile built-in."
 *
 * Two jobs:
 *
 *   - AWARENESS: which nodes are Obsidian-compatible, so their sessions open holding
 *     codex/personas/obsidian.md. Tagged `obsidian`, or bound to a path inside a vault.
 *   - THE JOURNAL NOTE: what the nightly journal writes into a vault, with frontmatter the vault's
 *     Properties view reads as typed properties, and tags chosen from the vault's own vocabulary
 *     in the vault's own style before any new one is invented.
 */

export const OBSIDIAN_PROFILE_REL = 'codex/personas/obsidian.md';
export const OBSIDIAN_TAG = 'obsidian';

/* ────────────────────────── awareness ────────────────────────── */

/** Forward slashes, no trailing slash, except that a drive root stays `C:/`. */
function slash(path: string): string {
  const out = path.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[A-Za-z]:$/.test(out) ? `${out}/` : out;
}

function parentOf(dir: string): string | null {
  if (/^[A-Za-z]:\/$/.test(dir) || dir === '/') return null;
  const cut = dir.lastIndexOf('/');
  if (cut < 0) return null;
  if (cut === 2 && /^[A-Za-z]:/.test(dir)) return dir.slice(0, 3);
  if (cut === 0) return '/';
  return dir.slice(0, cut);
}

/**
 * The vault a path is in: the nearest folder at or above it that holds a `.obsidian` folder.
 * `hasObsidianDir` is the disk check, injected so this stays testable.
 */
export function vaultRootOf(path: string, hasObsidianDir: (dir: string) => boolean): string | null {
  if (!path.trim()) return null;
  let dir: string | null = slash(path);
  for (let depth = 0; dir && depth < 64; depth++) {
    if (hasObsidianDir(dir)) return dir;
    dir = parentOf(dir);
  }
  return null;
}

/** The paths on a node that could put it inside a vault. */
export function obsidianPaths(node: Pick<BoardNode, 'cwd' | 'path' | 'addDirs' | 'journalVault'>): string[] {
  return [node.cwd, node.path, node.journalVault, ...(node.addDirs ?? [])]
    .filter((p): p is string => typeof p === 'string' && p.trim() !== '');
}

/**
 * Does this node work with Obsidian? Tagged `obsidian` (any case), or bound to a path inside a
 * vault. `inVault` receives each raw path; the caller expands tokens and checks the disk.
 */
export function isObsidianAware(
  node: Pick<BoardNode, 'tags' | 'cwd' | 'path' | 'addDirs' | 'journalVault'>,
  inVault: (path: string) => boolean
): boolean {
  if (node.tags?.some((t) => t.toLowerCase() === OBSIDIAN_TAG)) return true;
  return obsidianPaths(node).some(inVault);
}

/* ────────────────────────── tags ────────────────────────── */

/**
 * Clean a tag to what Obsidian accepts: letters (any script), digits, `_`, `-`, and `/` for
 * nesting; no spaces; and at least one character that is not a digit (`#1984` is not a tag,
 * `#y1984` is). Returns null when nothing valid is left.
 */
export function normaliseTag(raw: string): string | null {
  const t = raw
    .trim()
    .replace(/^#+/, '')
    .replace(/^["']|["']$/g, '')
    .replace(/[^\p{L}\p{N}_\-/]/gu, '')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '');
  if (!t || !/[^\d/]/.test(t)) return null;
  return t;
}

/** Every tag in a note: frontmatter `tags` (list, inline array or scalar) and inline `#tags`. */
export function extractTags(markdown: string): string[] {
  const text = markdown.replace(/\r\n?/g, '\n');
  const found: string[] = [];
  let body = text;

  const fm = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (fm) {
    body = text.slice(fm[0].length);
    const yaml = fm[1] ?? '';
    const inline = /^tags:[ \t]*\[(.*?)\][ \t]*$/m.exec(yaml);
    const block = /^tags:[ \t]*\n((?:[ \t]*-[ \t]*.*(?:\n|$))+)/m.exec(yaml);
    const scalar = /^tags:[ \t]*(\S.*)$/m.exec(yaml);
    if (inline) found.push(...(inline[1] ?? '').split(','));
    else if (block) found.push(...(block[1] ?? '').split('\n').map((l) => l.replace(/^\s*-\s*/, '')));
    else if (scalar) found.push(...(scalar[1] ?? '').split(/[,\s]+/));
  }

  // Code is not prose: a `#include` in a fence is not a tag.
  body = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const m of body.matchAll(/(^|[\s(\[])#([\p{L}\p{N}_\-/]+)/gu)) found.push(m[2] ?? '');

  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of found) {
    const tag = normaliseTag(raw);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out;
}

export type TagCase = 'camel' | 'kebab' | 'snake' | 'lower';

export interface TagStyle {
  /** How words are joined inside one tag. */
  case: TagCase;
  /** Whether the vault nests tags (`project/skynetos`) often enough to follow suit. */
  nested: boolean;
}

/**
 * What one tag's last segment says about the vault's style. A single lowercase word (`mood`) is
 * `plain`: it fits kebab, snake and lower alike, so it only decides the style when nothing else in
 * the vault does.
 */
function caseOf(leaf: string): TagCase | 'plain' | null {
  if (/\p{Lu}/u.test(leaf) && !/[-_]/.test(leaf)) return 'camel';
  if (leaf.includes('-')) return 'kebab';
  if (leaf.includes('_')) return 'snake';
  if (/^[\p{Ll}\p{N}]+$/u.test(leaf)) return 'plain';
  return null;
}

/** The vault's own habit, by majority. A vault with no tags gets CamelCase and no nesting. */
export function tagStyleOf(vocabulary: readonly string[]): TagStyle {
  const counts: Record<TagCase, number> = { camel: 0, kebab: 0, snake: 0, lower: 0 };
  let plain = 0;
  let nested = 0;
  for (const tag of vocabulary) {
    if (tag.includes('/')) nested++;
    const kind = caseOf(tag.split('/').pop() ?? tag);
    if (kind === 'plain') plain++;
    else if (kind) counts[kind]++;
  }
  const order: TagCase[] = ['camel', 'kebab', 'snake'];
  const decided = counts.camel + counts.kebab + counts.snake > 0;
  const best: TagCase = decided
    ? order.reduce((a, b) => (counts[b] > counts[a] ? b : a), 'camel')
    : plain > 0 ? 'lower' : 'camel';
  return { case: best, nested: vocabulary.length > 0 && nested / vocabulary.length >= 0.2 };
}

/** Words in a name: `DirtyPlush` → Dirty Plush, `the-stalker` → the stalker, `SkynetOS` → Skynet OS. */
export function wordsOf(name: string): string[] {
  return name
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function styleTag(words: readonly string[], style: TagCase): string {
  switch (style) {
    case 'camel': return words.map((w) => (w[0] ?? '').toUpperCase() + w.slice(1)).join('');
    case 'kebab': return words.map((w) => w.toLowerCase()).join('-');
    case 'snake': return words.map((w) => w.toLowerCase()).join('_');
    case 'lower': return words.map((w) => w.toLowerCase()).join('');
  }
}

const tagKey = (t: string): string => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export interface TagCandidate {
  /** What the tag is about, as a name: `SkynetOS`, `Dirty Plush`, `journal`. */
  phrase: string;
  /** Where it nests when the vault nests tags. Undefined: top level. */
  group?: 'journal' | 'project';
}

/**
 * Tags for a note, preferring the vault's own.
 *
 * A candidate that matches an existing tag (ignoring case and separators, on the whole tag or its
 * last segment) takes the existing spelling, so the journal files itself under `Writing` rather
 * than minting `writing` beside it. Anything new is spelled in the vault's own style and, in a
 * vault that nests, nested under its group. `vocabulary` is most-used first, so the more common
 * spelling wins a tie.
 */
export function chooseTags(candidates: readonly TagCandidate[], vocabulary: readonly string[]): string[] {
  const style = tagStyleOf(vocabulary);
  const known = new Map<string, string>();
  for (const tag of vocabulary) {
    const full = tagKey(tag);
    const leaf = tagKey(tag.split('/').pop() ?? tag);
    if (full && !known.has(full)) known.set(full, tag);
    if (leaf && !known.has(leaf)) known.set(leaf, tag);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const existing = known.get(tagKey(candidate.phrase));
    let tag: string | null;
    if (existing) {
      tag = existing;
    } else {
      const leaf = styleTag(wordsOf(candidate.phrase), style.case);
      tag = normaliseTag(style.nested && candidate.group && tagKey(candidate.phrase) !== candidate.group
        ? `${candidate.group}/${leaf}`
        : leaf);
    }
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      out.push(tag);
    }
  }
  return out;
}

/* ────────────────────────── dates ────────────────────────── */

export interface LocalDate { y: number; m: number; d: number }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

export function localDateOf(date: Date): LocalDate {
  return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
}

/** `2026-09-11T22:04:00`: local wall time, no zone, which Obsidian's datetime property reads as-is. */
export function localDateTime(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function isoDate(date: LocalDate): string {
  return `${date.y}-${pad(date.m)}-${pad(date.d)}`;
}

/**
 * The moment.js subset daily-notes formats use: YYYY YY MMMM MMM MM M DD D Do dddd ddd, and
 * `[literal]` text. Obsidian's default is `YYYY-MM-DD`.
 */
export function formatObsidianDate(date: LocalDate, format = 'YYYY-MM-DD'): string {
  const weekday = new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay();
  const ordinal = (n: number): string => {
    const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
    return `${n}${n % 10 > 3 ? 'th' : s}`;
  };
  return format.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|Do|DD|D|dddd|ddd/g, (token, literal: string | undefined) => {
    if (literal !== undefined) return literal;
    switch (token) {
      case 'YYYY': return String(date.y);
      case 'YY': return pad(date.y % 100);
      case 'MMMM': return MONTHS[date.m - 1] ?? '';
      case 'MMM': return (MONTHS[date.m - 1] ?? '').slice(0, 3);
      case 'MM': return pad(date.m);
      case 'M': return String(date.m);
      case 'Do': return ordinal(date.d);
      case 'DD': return pad(date.d);
      case 'D': return String(date.d);
      case 'dddd': return DAYS[weekday] ?? '';
      case 'ddd': return (DAYS[weekday] ?? '').slice(0, 3);
      default: return token;
    }
  });
}

/* ────────────────────────── the journal note ────────────────────────── */

export interface JournalProject {
  name: string;
  /** Weighted tokens today, on this machine. */
  tokens: number;
  messages: number;
  /** An existing note in the vault with this project's name, to link to. Null: no link. */
  note?: string | null;
}

export interface JournalSession {
  /** Local time, `HH:mm`. */
  at: string;
  label: string;
  room: string;
}

export interface JournalInput {
  date: LocalDate;
  /** Local wall time the note was written, from `localDateTime`. */
  created: string;
  /** Vault-relative folder, forward slashes. Empty: the vault root. */
  folder: string;
  /** The vault's daily-notes format. Default `YYYY-MM-DD`. */
  format?: string | null;
  projects: JournalProject[];
  sessions: JournalSession[];
  rooms: string[];
  /** Titles of docs/DECISIONS.md entries dated today. */
  decisions: string[];
  /** Open items, from handoff.md's "What is next". */
  next: string[];
  /** The vault's tags, most-used first. */
  vocabulary: string[];
  /** Keys the vault's own note template carries (e.g. `URL`), written empty so notes match. */
  templateKeys?: string[];
  /** Whether a vault-relative path already exists. The note never overwrites one. */
  exists: (relPath: string) => boolean;
}

export interface JournalNote {
  relPath: string;
  fileName: string;
  content: string;
  tags: string[];
}

const RESERVED_KEYS = new Set(['aliases', 'tags', 'cssclasses', 'date', 'created', 'type', 'source', 'projects', 'sessions', 'tokens', 'rooms']);

/** A YAML scalar: bare when unambiguous, otherwise a double-quoted (JSON-compatible) string. */
function yamlString(value: string): string {
  const bare = /^[\p{L}\p{N}][\p{L}\p{N} _.\-/()]*$/u.test(value)
    && !/^(true|false|null|yes|no|on|off|~)$/i.test(value)
    && !/^[\d.\-+eE]+$/.test(value);
  return bare ? value : JSON.stringify(value);
}

function yamlList(key: string, values: readonly string[]): string[] {
  if (!values.length) return [`${key}: []`];
  return [`${key}:`, ...values.map((v) => `  - ${yamlString(v)}`)];
}

/** The file name the note takes: the day's own name, or a SkynetOS-marked sibling if that is taken. */
export function journalFileName(folder: string, base: string, exists: (relPath: string) => boolean): string {
  const join = (name: string): string => (folder ? `${folder}/${name}` : name);
  if (!exists(join(`${base}.md`))) return `${base}.md`;
  if (!exists(join(`${base} (SkynetOS).md`))) return `${base} (SkynetOS).md`;
  for (let i = 2; i < 1000; i++) {
    if (!exists(join(`${base} (SkynetOS ${i}).md`))) return `${base} (SkynetOS ${i}).md`;
  }
  return `${base} (SkynetOS ${Date.now()}).md`;
}

/**
 * Today's journal note: a path that never overwrites, frontmatter the Properties view types
 * correctly (dates bare, lists as lists), tags from the vault's own vocabulary, and a body of
 * what actually happened on this machine today.
 */
export function buildJournalNote(input: JournalInput): JournalNote {
  const folder = input.folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const base = formatObsidianDate(input.date, input.format?.trim() || 'YYYY-MM-DD');
  const fileName = journalFileName(folder, base, input.exists);
  const relPath = folder ? `${folder}/${fileName}` : fileName;
  const day = isoDate(input.date);

  const busiest = [...input.projects].sort((a, b) => b.tokens - a.tokens);
  const tags = chooseTags(
    [
      { phrase: 'SkynetOS', group: 'journal' },
      { phrase: 'Journal', group: 'journal' },
      // A project named by a path (`C:/dev`, the dev root itself) is not a topic; it would mint `CDev`.
      ...busiest.filter((p) => !/[:/\\]/.test(p.name)).map((p): TagCandidate => ({ phrase: p.name, group: 'project' }))
    ],
    input.vocabulary
  );
  const totalTokens = input.projects.reduce((sum, p) => sum + p.tokens, 0);

  const fm: string[] = ['---'];
  fm.push(...yamlList('aliases', [`SkynetOS journal ${day}`]));
  fm.push(...yamlList('tags', tags));
  for (const key of input.templateKeys ?? []) {
    if (!RESERVED_KEYS.has(key) && /^[\p{L}\p{N}_ \-]+$/u.test(key)) fm.push(`${key}:`);
  }
  fm.push(`date: ${day}`);
  fm.push(`created: ${input.created}`);
  fm.push('type: journal');
  fm.push('source: skynetos');
  fm.push(...yamlList('projects', busiest.map((p) => p.name)));
  fm.push(`sessions: ${input.sessions.length}`);
  fm.push(`tokens: ${Math.round(totalTokens)}`);
  fm.push(...yamlList('rooms', input.rooms));
  fm.push('---');

  const link = (p: JournalProject): string =>
    p.note ? (p.note === p.name ? `[[${p.note}]]` : `[[${p.note}|${p.name}]]`) : p.name;

  const body: string[] = [];
  body.push(`# SkynetOS journal · ${formatObsidianDate(input.date, 'dddd D MMMM YYYY')}`);
  body.push('');
  body.push('> [!summary] The day');
  if (busiest.length) {
    body.push(`> ${input.sessions.length} session${input.sessions.length === 1 ? '' : 's'} from the board, ${formatTokens(totalTokens)} weighted tokens across ${busiest.length} project${busiest.length === 1 ? '' : 's'}. Most of it went to ${link(busiest[0]!)}.`);
  } else {
    body.push(`> ${input.sessions.length} session${input.sessions.length === 1 ? '' : 's'} from the board, and no Claude work recorded on this machine today.`);
  }
  body.push('');
  body.push('## Projects');
  if (busiest.length) {
    for (const p of busiest) body.push(`- **${link(p)}** · ${formatTokens(p.tokens)} weighted tokens · ${p.messages} message${p.messages === 1 ? '' : 's'}`);
  } else {
    body.push('- Nothing recorded on this machine today.');
  }
  body.push('');
  body.push('## Sessions');
  if (input.sessions.length) {
    for (const s of input.sessions) body.push(`- ${s.at} · ${s.label} · ${s.room}`);
  } else {
    body.push('- None launched from the board today.');
  }
  body.push('');
  body.push('## Decisions');
  if (input.decisions.length) {
    for (const d of input.decisions) body.push(`- ${d}`);
  } else {
    body.push('- None recorded in docs/DECISIONS.md today.');
  }
  body.push('');
  body.push('## Next');
  if (input.next.length) {
    for (const n of input.next) body.push(`- [ ] ${n}`);
  } else {
    body.push('- [ ] ');
  }
  body.push('');
  body.push('---');
  body.push('*Written by SkynetOS from what this machine recorded. Usage is this machine\'s share only.*');
  body.push('');

  return { relPath, fileName, content: `${fm.join('\n')}\n\n${body.join('\n')}`, tags };
}

/* ────────────────────────── sources for the note ────────────────────────── */

/** Titles of docs/DECISIONS.md entries dated `day` (`## 2026-09-11 — Title`). */
export function decisionsOn(markdown: string, day: string): string[] {
  const out: string[] = [];
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^##\s+(\d{4}-\d{2}-\d{2})\s+[—–-]\s+(.+?)\s*$/.exec(line);
    if (m && m[1] === day && m[2]) out.push(m[2]);
  }
  return out;
}

/** The numbered bold titles under handoff.md's "What is next", which is the Hands' own to-do list. */
export function nextFromHandoff(markdown: string): string[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((l) => /^##\s+What is next/i.test(l));
  if (start < 0) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^##\s/.test(line)) break;
    const m = /^\d+\.\s+\*\*(.+?)\*\*/.exec(line);
    if (m && m[1]) out.push(m[1].replace(/[\s.:—–-]+$/, ''));
  }
  return out;
}

/** A project's display name from its working directory: `C:\dev\DirtyPlush` → `DirtyPlush`. */
export function projectNameOf(cwd: string): string {
  const parts = cwd.replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean);
  const last = parts[parts.length - 1] ?? cwd;
  // A drive or the dev root itself is not a project name; say what it is.
  if (parts.length <= 2 && /^(dev|[A-Za-z]:)$/i.test(last)) return cwd.replace(/\\/g, '/');
  return last;
}
