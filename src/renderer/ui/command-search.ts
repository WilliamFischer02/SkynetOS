/**
 * The command palette's search: rank nodes and actions against what was typed.
 *
 * Pure, so the ranking is tested rather than tuned by eye. Every query word must match somewhere;
 * a match on the label beats one on the detail, a prefix beats a word start, a word start beats a
 * substring, and a substring beats letters found in order ("ctms" for CC-THE-STALKER). Things used
 * recently float up, gently: a strong match still beats a recent weak one.
 */

export type CommandGroup = 'recent' | 'action' | 'node';

export interface CommandItem {
  id: string;
  label: string;
  /** A second line: a node's kind and room, an action's key. */
  detail?: string;
  group: Exclude<CommandGroup, 'recent'>;
  keywords?: readonly string[];
}

const norm = (s: string): string => s.toLowerCase().replace(/[_\-./\\]+/g, ' ').replace(/\s+/g, ' ').trim();

/** One word of the query against one field. Higher is better; null means no match. */
function scoreWord(word: string, field: string): number | null {
  if (!field) return null;
  if (field === word) return 1000;
  if (field.startsWith(word)) return 800 - Math.min(100, field.length - word.length);
  const words = field.split(' ');
  if (words.some((w) => w.startsWith(word))) return 600;
  const at = field.indexOf(word);
  if (at >= 0) return 400 - Math.min(100, at);
  // Letters in order, however spread out. Tighter is better.
  let pos = -1;
  let spread = 0;
  for (const ch of word) {
    const next = field.indexOf(ch, pos + 1);
    if (next < 0) return null;
    if (pos >= 0) spread += next - pos - 1;
    pos = next;
  }
  return Math.max(1, 200 - spread * 4);
}

/** How well an item matches a query, or null. An empty query matches everything at 0. */
export function scoreCommand(query: string, item: CommandItem): number | null {
  const q = norm(query);
  if (!q) return 0;
  const label = norm(item.label);
  const detail = norm(item.detail ?? '');
  const keywords = (item.keywords ?? []).map(norm).join(' ');
  let total = 0;
  for (const word of q.split(' ')) {
    const best = Math.max(
      scoreWord(word, label) ?? -1,
      (scoreWord(word, keywords) ?? -1) * 0.7,
      (scoreWord(word, detail) ?? -1) * 0.5
    );
    if (best < 0) return null;
    total += best;
  }
  return total;
}

/**
 * The list the palette shows. With no query: recent things first, then actions, then nodes. With
 * a query: best match first, recent items nudged up, actions before nodes on a tie.
 */
export function rankCommands(
  query: string,
  items: readonly CommandItem[],
  recentIds: readonly string[] = [],
  limit = 60
): (CommandItem & { recent: boolean })[] {
  const recentRank = new Map(recentIds.map((id, i) => [id, i]));
  const scored: { item: CommandItem; score: number; recent: boolean }[] = [];
  for (const item of items) {
    const score = scoreCommand(query, item);
    if (score === null) continue;
    const r = recentRank.get(item.id);
    const recent = r !== undefined;
    const boost = recent ? 60 - (r as number) * 5 : 0;
    scored.push({ item, score: score + boost, recent });
  }
  const empty = !norm(query);
  scored.sort((a, b) => {
    if (empty) {
      if (a.recent !== b.recent) return a.recent ? -1 : 1;
      if (a.recent && b.recent) return (recentRank.get(a.item.id) ?? 0) - (recentRank.get(b.item.id) ?? 0);
      if (a.item.group !== b.item.group) return a.item.group === 'action' ? -1 : 1;
      return a.item.label.localeCompare(b.item.label);
    }
    if (b.score !== a.score) return b.score - a.score;
    if (a.item.group !== b.item.group) return a.item.group === 'action' ? -1 : 1;
    return a.item.label.localeCompare(b.item.label);
  });
  return scored.slice(0, limit).map(({ item, recent }) => ({ ...item, recent }));
}

/** Remember an item as recently used: most recent first, no duplicates, capped. */
export function pushRecent(recent: readonly string[], id: string, cap = 8): string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, cap);
}
