/**
 * Where SkynetOS keeps its DATA, as opposed to where the program is installed.
 *
 * ── Why an install may never own the boards ───────────────────────────────────────────────────
 * Until 2026-09-21 a packaged SkynetOS read `resources/board` and `resources/codex`: copies made
 * at build time, sitting inside the install folder. Three things follow, all bad:
 *
 *   1. An installer UPDATE replaces `resources/`, so every board edit made in the installed app
 *      since the last build is overwritten without a word.
 *   2. The installed app and the repo disagree from the first edit. The Hands edit the repo, the
 *      Face reads the repo through GitHub, and the window William is looking at shows neither.
 *   3. Git, the documented escape hatch (docs/07 Recovery), does not reach an install folder.
 *
 * So the program and the data are separate things. The program is whatever the installer put
 * down, replaced freely by updates. The data is a HOME folder that no installer touches: on
 * William's machines, the SkynetOS repo itself, which "is the save file" (commit e5b70ce).
 *
 * Pure: the caller supplies the facts, this picks.
 */

export type HomeSource =
  /** Not packaged: the repo the dev build runs from. */
  | 'dev'
  /** `home` in settings.json, chosen by William. */
  | 'settings'
  /** The home this install used last time, written down by the app itself. */
  | 'remembered'
  /** The repo this build was made from, still on this machine. */
  | 'built-from'
  /** `%USERPROFILE%/SkynetOS`, already holding a board. */
  | 'profile'
  /** `%USERPROFILE%/SkynetOS`, which does not hold a board yet and must be seeded from the install. */
  | 'seed';

export interface HomeFacts {
  packaged: boolean;
  /** `app.getAppPath()`: the repo in dev. */
  appPath: string;
  /** `home` from settings.json, if any. */
  settingsHome?: string | null;
  /**
   * The home this install chose on an earlier run (`userData/home.json`). A PUBLISHED build carries
   * no `builtFrom`, so without this an update fetched from GitHub would lose the repo the first,
   * local install had found, and open a different set of boards. Once found, a home is kept.
   */
  remembered?: string | null;
  /** The repo path recorded in build-info.json when the installer was made. */
  builtFrom?: string | null;
  /** The user's profile folder. */
  profile: string;
  /** Does this folder hold `board/root.board.json`? */
  hasBoard: (dir: string) => boolean;
}

export interface HomeChoice {
  home: string;
  source: HomeSource;
  /** Set when a configured home was passed over, so the app can say so rather than fail quietly. */
  note?: string;
}

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '');

/** The folder name under the profile for a machine that has no repo. */
export const PROFILE_HOME_DIRNAME = 'SkynetOS';

export function chooseHome(facts: HomeFacts): HomeChoice {
  if (!facts.packaged) return { home: norm(facts.appPath), source: 'dev' };

  let note: string | undefined;
  const configured = facts.settingsHome?.trim();
  if (configured) {
    if (facts.hasBoard(configured)) return { home: norm(configured), source: 'settings' };
    note = `THE HOME IN SETTINGS HAS NO board/root.board.json — ${norm(configured)}`;
  }

  const remembered = facts.remembered?.trim();
  if (remembered && facts.hasBoard(remembered)) return { home: norm(remembered), source: 'remembered', ...(note ? { note } : {}) };

  const builtFrom = facts.builtFrom?.trim();
  if (builtFrom && facts.hasBoard(builtFrom)) return { home: norm(builtFrom), source: 'built-from', ...(note ? { note } : {}) };

  const profileHome = `${norm(facts.profile)}/${PROFILE_HOME_DIRNAME}`;
  if (facts.hasBoard(profileHome)) return { home: profileHome, source: 'profile', ...(note ? { note } : {}) };
  return { home: profileHome, source: 'seed', ...(note ? { note } : {}) };
}

/** What the installer records about itself, read back by the running app. `build-info.json`. */
export interface BuildInfo {
  version: string;
  /** Short git commit the build was made from, or null outside a repo. */
  commit: string | null;
  /** True when the working tree had uncommitted changes at build time. */
  dirty: boolean;
  builtAt: string;
  /** The repo folder the build was made in, forward slashes. */
  builtFrom: string;
}

export function parseBuildInfo(raw: string): BuildInfo | null {
  try {
    const v = JSON.parse(raw) as Partial<BuildInfo>;
    if (typeof v.version !== 'string' || typeof v.builtFrom !== 'string' || typeof v.builtAt !== 'string') return null;
    return { version: v.version, commit: typeof v.commit === 'string' ? v.commit : null, dirty: v.dirty === true, builtAt: v.builtAt, builtFrom: norm(v.builtFrom) };
  } catch {
    return null;
  }
}

/**
 * The folders an install seeds a new home with, on a machine that has no repo. Copied once, never
 * over an existing file: a seed fills gaps, it does not restore defaults.
 */
export const SEED_DIRS: readonly string[] = ['board', 'codex', 'assets/sprites', 'assets/avatar'];
