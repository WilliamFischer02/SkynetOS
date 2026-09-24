/**
 * What to watch when some of what a board cares about is not there yet.
 *
 * ── The fault this exists for ─────────────────────────────────────────────────────────────────
 * William, 2026-09-21: "my TimeServed mod was just rebuilt and the board still shows no build for
 * it." The watcher only ever watched directories that existed when the room was opened. A mod that
 * had never been built has no `build/libs`, so nothing watched it, and the first build, which is
 * the one that matters most, was the one the board could not see. `gradlew clean` did the same to a
 * mod that HAD been built: the watched directory was deleted and the watch died with it.
 *
 * A directory that does not exist cannot be watched, but its nearest existing ancestor can. When
 * something appears there that lies on the way to the wanted directory, the watcher re-plans: the
 * wanted directory, or a deeper ancestor of it, now exists. Pure, so the rule is tested without a
 * filesystem.
 */

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '');

export function parentDir(path: string): string | null {
  const p = norm(path);
  const cut = p.lastIndexOf('/');
  if (cut <= 0) return null;
  const parent = p.slice(0, cut);
  // `C:` is a drive, not a directory name: its root is `C:/`.
  if (/^[a-z]:$/i.test(parent)) return p.length > 3 ? `${parent}/` : null;
  if (parent === '/' || parent === '') return null;
  return parent;
}

/**
 * How far up a missing directory is waited for. `build/libs` missing is one or two steps below the
 * repo; a missing repo is three below the dev root. Further than that the watch would sit on a
 * folder that has nothing to do with the file, such as a whole profile or `Program Files`.
 */
export const MAX_WAIT_STEPS = 3;

const isDriveRoot = (path: string): boolean => /^[a-z]:\/?$/i.test(path);

/**
 * Windows' own top-level folders. Waiting there means watching every program or every profile on
 * the machine for one file, and `Program Files` holds `WindowsApps`, which cannot even be read: the
 * packed exe's smoke run logged EPERM from it on every visit to a room with an uninstalled program.
 */
const isSystemFolder = (path: string): boolean =>
  /^[a-z]:\/(program files( \(x86\))?|programdata|windows|users)$/i.test(path);

/**
 * The deepest ancestor of `dir` that exists and is worth watching, or null. Never a drive root:
 * everything on the disk is "on the way" from there, and Windows keeps folders in it that cannot be
 * read. A target that far gone is left to the relink poll and the refresh on focus.
 */
export function nearestExistingAncestor(dir: string, exists: (path: string) => boolean, maxSteps = MAX_WAIT_STEPS): string | null {
  let at = parentDir(dir);
  for (let step = 1; at && step <= maxSteps; step += 1) {
    if (isDriveRoot(at) || isSystemFolder(at)) return null;
    if (exists(at)) return at;
    at = parentDir(at);
  }
  return null;
}

export interface WatchPlan {
  /** Wanted directories that exist: watched themselves. */
  direct: string[];
  /** An existing ancestor -> the wanted directories it is standing in for. */
  waiting: Map<string, string[]>;
  /** Wanted directories with nothing near enough above them to watch (a drive that is not plugged in). */
  unreachable: string[];
}

export function planWatch(wanted: Iterable<string>, exists: (path: string) => boolean): WatchPlan {
  const plan: WatchPlan = { direct: [], waiting: new Map(), unreachable: [] };
  for (const raw of wanted) {
    const dir = norm(raw);
    if (exists(dir)) { plan.direct.push(dir); continue; }
    const ancestor = nearestExistingAncestor(dir, exists);
    if (!ancestor) { plan.unreachable.push(dir); continue; }
    plan.waiting.set(ancestor, [...(plan.waiting.get(ancestor) ?? []), dir]);
  }
  return plan;
}

/** Is `path` the wanted directory, or a step on the way down to it? */
export function leadsTo(path: string, wantedDir: string): boolean {
  const p = norm(path).toLowerCase();
  const w = norm(wantedDir).toLowerCase();
  return w === p || w.startsWith(`${p}/`);
}
