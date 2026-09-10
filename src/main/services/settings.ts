import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

/**
 * Settings live in %APPDATA%/SkynetOS/settings.json.
 *
 * docs/07-SECURITY.md: "Modify settings, allowlists, or elevation policy — Never. Settings are
 * user-only." So this module is deliberately not reachable from the MCP surface, and there is no
 * `settings:write` IPC channel. Editing settings means editing the file. That is the point: the
 * thing that decides what an agent is allowed to touch is not itself agent-writable.
 */

export interface Settings {
  /** Paths under which a target activates without confirmation. docs/07 §Path policy. */
  devRoots: string[];
  /** Ask before launching any file.exe, regardless of its own confirmBeforeLaunch. */
  confirmAllLaunches: boolean;
  /** Drop idle animation, packets and shimmer. State is then conveyed by LED colour alone. */
  reducedMotion: boolean;
  /** Hide full paths, suppress toast contents, blank the claude.ai webview. docs/07 §Streaming. */
  streamMode: boolean;
  /** How many board mutations to keep undoable. */
  undoDepth: number;
  /** Days to keep board/.snapshots/. */
  snapshotRetentionDays: number;

  /**
   * The rolling window the usage meter reports over, in hours. 5 matches the shape of Claude's
   * own rate-limit window and is short enough that "tokens per hour" describes what you are
   * doing now rather than what you did on Tuesday.
   */
  usageWindowHours: number;

  /**
   * Weighted tokens you consider one window's worth. Null until you set one.
   *
   * There is no file on this disk and no local API that says how much of a subscription is left,
   * so SkynetOS cannot know it. Prime directive 1 forbids inventing it: with this unset the meter
   * shows the real rate and says SET A BUDGET where the allowance would go, rather than printing
   * a confident fiction. Weighted means cache reads count at a tenth — see packages/shared/usage.ts.
   */
  tokenBudget: number | null;
}

const DEFAULTS: Settings = {
  devRoots: ['C:/dev'],
  confirmAllLaunches: false,
  reducedMotion: false,
  streamMode: false,
  undoDepth: 200,
  snapshotRetentionDays: 30,
  usageWindowHours: 5,
  tokenBudget: null
};

let cached: Settings | null = null;

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json');
}

export function getSettings(): Settings {
  if (cached) return cached;
  const file = settingsFile();
  if (!existsSync(file)) {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(file, JSON.stringify(DEFAULTS, null, 2));
    console.log(`[settings] wrote defaults to ${file}`);
    cached = { ...DEFAULTS };
    return cached;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Settings>;
    // Merge over defaults so a hand-edited file missing a key still works.
    cached = { ...DEFAULTS, ...parsed };
  } catch (err) {
    console.error(`[settings] ${file} is malformed (${(err as Error).message}) — using defaults`);
    cached = { ...DEFAULTS };
  }
  return cached;
}

/** Forget the cache so the next read picks up a hand-edited file. */
export function reloadSettings(): Settings {
  cached = null;
  return getSettings();
}

/**
 * Roots inside which activation needs no confirmation: the configured dev roots plus the user
 * profile, plus the repo itself so the board can always point at its own files.
 */
export function trustedRoots(): string[] {
  const settings = getSettings();
  return [
    ...settings.devRoots,
    app.getPath('home'),
    app.isPackaged ? process.resourcesPath : app.getAppPath()
  ].map(normaliseRoot);
}

export function normaliseRoot(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
