import type { TargetInfo } from './targets.js';

/**
 * What a board refresh found, in one line for the toast.
 *
 * A refresh that says only "REFRESHED" leaves the question it was pressed to answer unanswered: did
 * the new jar turn up or not? So the line names what changed, and says so plainly when nothing did.
 * Pure: it compares the targets before and after, by node id.
 */

export interface RefreshChange {
  nodeId: string;
  name: string;
  what: 'appeared' | 'gone' | 'updated';
}

const fileOf = (info: TargetInfo | undefined): string | null => {
  const resolved = info?.resolved;
  if (!resolved) return null;
  return resolved.replace(/\\/g, '/').split('/').pop() ?? null;
};

/** On disk and readable. `outside-dev-root` is a policy note about a file that is there. */
const present = (info: TargetInfo | undefined): boolean =>
  !!info?.resolved && (info.state === 'ok' || info.state === 'outside-dev-root');

export function refreshChanges(
  before: Readonly<Record<string, TargetInfo>>,
  after: Readonly<Record<string, TargetInfo>>,
  names: Readonly<Record<string, string>>
): RefreshChange[] {
  const changes: RefreshChange[] = [];
  for (const [nodeId, now] of Object.entries(after)) {
    const was = before[nodeId];
    // Only things that are files on disk. A URL or a node with no target has nothing to re-read.
    if (now.kind === 'url' || (now.state === 'none' && (!was || was.state === 'none'))) continue;
    const name = names[nodeId] ?? nodeId;
    const had = present(was);
    const has = present(now);
    if (!had && has) changes.push({ nodeId, name, what: 'appeared' });
    else if (had && !has) changes.push({ nodeId, name, what: 'gone' });
    else if (had && has && (was?.resolved !== now.resolved || was?.mtimeMs !== now.mtimeMs)) changes.push({ nodeId, name, what: 'updated' });
  }
  return changes;
}

const VERB: Record<RefreshChange['what'], string> = { appeared: 'FOUND', gone: 'GONE', updated: 'UPDATED' };

/** The toast. `checked` is how many nodes were re-read. */
export function refreshSummary(changes: readonly RefreshChange[], checked: number, after: Readonly<Record<string, TargetInfo>> = {}): string {
  if (!changes.length) return `REFRESHED · ${checked} NODE${checked === 1 ? '' : 'S'} RE-READ, NOTHING NEW`;
  const parts = changes.slice(0, 3).map((c) => {
    const file = c.what === 'gone' ? null : fileOf(after[c.nodeId]);
    return `${c.name.toUpperCase()} ${VERB[c.what]}${file ? ` (${file})` : ''}`;
  });
  const more = changes.length - parts.length;
  return `REFRESHED · ${parts.join(' · ')}${more > 0 ? ` · AND ${more} MORE` : ''}`;
}
