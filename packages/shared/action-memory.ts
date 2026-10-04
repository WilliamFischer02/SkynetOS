/**
 * Action memory (docs/11 § Reaching into windows, the board, and a terminal): a planned desktop
 * sentence that RAN to completion is remembered, and the next time the same sentence arrives the
 * plan is reused without asking the model ("Same as last time."). A failure evicts it.
 *
 * PURE: the key, the list operations and the file's defensive read. The file, the run and the
 * speech are src/main/services/action-memory.ts. A remembered plan is still an ordinary plan: main
 * passes it through `normalisePlan` again before it runs, under the same switch, cap and halt.
 */

import type { DesktopStep } from './desktop.js';

export const ACTION_MEMORY_CAP = 200;

export interface ActionMemoryEntry {
  /** `memoryKey(sentence)`: what makes two sentences the same request. */
  key: string;
  /** The sentence as it was first said, for the log and for William reading the file. */
  sentence: string;
  steps: DesktopStep[];
  /** Process names of the windows that were open when it first ran: context, never a condition. */
  windows: string[];
  /** ISO time it last ran to completion. */
  at: string;
  /** How many times it has run to completion. */
  successes: number;
}

/** Said before a request: the wake word and courtesy (intent.ts's `stripPreamble`, and a few more). */
const LEADING = [
  'hey jarvis', 'ok jarvis', 'okay jarvis', 'jarvis', 'could you please', 'could you', 'can you please', 'can you',
  'would you please', 'would you', 'will you', 'i want you to', 'i need you to', 'id like you to', 'i d like you to',
  'go ahead and', 'please', 'kindly', 'just', 'um', 'uh', 'er', 'erm', 'so', 'now'
];
/** Said after it. Not "jarvis": "type hello from jarvis" means it. */
const TRAILING = ['please', 'thanks', 'thank you', 'for me', 'now', 'real quick', 'quickly'];
/** Said anywhere, and never content. */
const ANYWHERE = ['please', 'um', 'uh', 'erm'];

/**
 * The memory key: case, punctuation and filler insensitive. "Jarvis, could you please open my
 * notes in Word?" and "open my notes in word" are the same key; "type hello from jarvis" keeps its
 * "jarvis", because only a wake word in front or a courtesy at the end is dropped. Nothing is
 * stemmed or reordered: "open X on two" and "open X on one" stay different requests.
 */
export function memoryKey(sentence: string): string {
  let t = String(sentence ?? '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (const f of ANYWHERE) t = ` ${t} `.split(` ${f} `).join(' ').trim();
  let changed = true;
  while (changed && t) {
    changed = false;
    for (const f of LEADING) {
      if (t === f) { t = ''; changed = true; break; }
      if (t.startsWith(`${f} `)) { t = t.slice(f.length + 1).trim(); changed = true; }
    }
    for (const f of TRAILING) {
      if (t === f) { t = ''; changed = true; break; }
      if (t.endsWith(` ${f}`)) { t = t.slice(0, -(f.length + 1)).trim(); changed = true; }
    }
  }
  return t.replace(/\s+/g, ' ').trim();
}

/** The entry for a sentence, or null. */
export function recallFrom(entries: readonly ActionMemoryEntry[], sentence: string): ActionMemoryEntry | null {
  const key = memoryKey(sentence);
  if (!key) return null;
  return entries.find((e) => e.key === key) ?? null;
}

/**
 * Remember a completed run: a new entry, or the same key's entry with its plan replaced and its
 * count raised. Newest first; past ACTION_MEMORY_CAP the least recently run go.
 */
export function rememberIn(entries: readonly ActionMemoryEntry[], sentence: string, steps: readonly DesktopStep[], windows: readonly string[], at: string): ActionMemoryEntry[] {
  const key = memoryKey(sentence);
  if (!key || !steps.length) return [...entries];
  const old = entries.find((e) => e.key === key);
  const entry: ActionMemoryEntry = {
    key,
    sentence: old?.sentence ?? String(sentence).trim().slice(0, 400),
    steps: steps.map((s) => ({ ...s })),
    windows: [...new Set(windows.map((w) => w.toLowerCase()).filter(Boolean))].slice(0, 12),
    at,
    successes: (old?.successes ?? 0) + 1
  };
  const rest = entries.filter((e) => e.key !== key);
  return [entry, ...rest].sort((a, b) => b.at.localeCompare(a.at)).slice(0, ACTION_MEMORY_CAP);
}

/** Forget a sentence (its plan failed). */
export function forgetIn(entries: readonly ActionMemoryEntry[], sentence: string): ActionMemoryEntry[] {
  const key = memoryKey(sentence);
  return entries.filter((e) => e.key !== key);
}

/** The file, read defensively: anything that is not an entry is dropped, never thrown. */
export function parseMemoryFile(raw: unknown): ActionMemoryEntry[] {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { entries?: unknown }).entries) ? (raw as { entries: unknown[] }).entries : [];
  const out: ActionMemoryEntry[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o['key'] !== 'string' || !o['key'] || !Array.isArray(o['steps']) || !o['steps'].length) continue;
    out.push({
      key: o['key'],
      sentence: typeof o['sentence'] === 'string' ? o['sentence'] : o['key'],
      steps: o['steps'] as DesktopStep[],
      windows: Array.isArray(o['windows']) ? (o['windows'] as unknown[]).filter((w): w is string => typeof w === 'string') : [],
      at: typeof o['at'] === 'string' ? o['at'] : new Date(0).toISOString(),
      successes: typeof o['successes'] === 'number' && Number.isFinite(o['successes']) ? o['successes'] : 1
    });
  }
  return out.slice(0, ACTION_MEMORY_CAP);
}
