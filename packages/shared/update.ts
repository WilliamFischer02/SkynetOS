import type { BuildInfo } from './home.js';

/**
 * Program updates: what the installed app knows about the next version, and how it says so.
 *
 * Only an INSTALLED SkynetOS updates itself. A dev build (`npm run dev`, `npm run boot`) runs from
 * source, and its update is `git pull`; it reports `dev` and does nothing. The flow, the consent it
 * rests on and what it may never do are in docs/09-RELEASE.md and docs/07-SECURITY.md.
 */

export type UpdateState =
  /** Running from source. There is nothing to update. */
  | 'dev'
  /** Installed, not checked yet. */
  | 'idle'
  | 'checking'
  /** A newer version exists and is being fetched. */
  | 'downloading'
  /** Downloaded. It installs when SkynetOS next closes, or now if William presses the button. */
  | 'ready'
  /** Checked, and this is the newest. */
  | 'current'
  | 'error';

export interface UpdateStatus {
  state: UpdateState;
  /** The running version. */
  current: string;
  /** The newer version, once one is known. */
  next: string | null;
  /** 0 to 100 while downloading. */
  percent: number | null;
  error: string | null;
  checkedAt: string | null;
  build: BuildInfo | null;
  /** Where the boards and codex live, and why there. Shown in ABOUT so it is never a mystery. */
  home: { path: string; source: string } | null;
}

export const UPDATE_IDLE: UpdateStatus = { state: 'idle', current: '0.0.0', next: null, percent: null, error: null, checkedAt: null, build: null, home: null };

/** Six hours between checks. An update a few hours late costs nothing; a check a minute would. */
export const UPDATE_CHECK_MS = 6 * 3_600_000;
/** The first check waits for the board to be up. */
export const UPDATE_FIRST_CHECK_MS = 15_000;

/** One line for the ABOUT box. */
export function updateLine(status: UpdateStatus): string {
  switch (status.state) {
    case 'dev': return 'RUNNING FROM SOURCE. UPDATE WITH GIT PULL, THEN NPM RUN BOOT';
    case 'idle': return 'NOT CHECKED YET';
    case 'checking': return 'CHECKING FOR AN UPDATE…';
    case 'downloading': return `DOWNLOADING ${status.next ?? 'AN UPDATE'}${status.percent !== null ? ` · ${Math.round(status.percent)}%` : ''}`;
    case 'ready': return `${status.next ?? 'AN UPDATE'} IS READY. IT INSTALLS WHEN SKYNETOS CLOSES, OR PRESS RESTART AND UPDATE`;
    case 'current': return `UP TO DATE${status.checkedAt ? ` · CHECKED ${status.checkedAt.slice(11, 16)} UTC` : ''}`;
    case 'error': return `COULD NOT CHECK — ${status.error ?? 'NO REASON GIVEN'}. IS THIS PC ONLINE, AND IS THERE A RELEASE ON GITHUB?`;
  }
}

/** `0.3.0` from `0.2.7` and `minor`. Pre-release and build suffixes are dropped: a release is plain. */
export function bumpVersion(version: string, part: 'major' | 'minor' | 'patch'): string {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) throw new Error(`NOT A VERSION — ${version}`);
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (part === 'major') return `${major + 1}.0.0`;
  if (part === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}
