import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { isPlanId, type PlanId } from '@shared/plans.js';

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
   * Whether a mailbox message carrying `run:` may start a session on its own.
   *
   * On by default, because it is the feature — the Face asking the Hands to do something and the
   * Hands doing it is the whole point of there being two halves. Off is here because "an agent
   * started a terminal while I was away" is a thing a person is entitled to switch off without
   * arguing with anyone, and because it must be switchable from a text file rather than from
   * inside the app: there is no settings:write channel, by design. See docs/07 and
   * services/mail-dispatch.ts.
   */
  autoRunMail: boolean;

  /**
   * The rolling window the usage meter reports over, in hours. 5 matches the shape of Claude's
   * own rate-limit window and is short enough that "tokens per hour" describes what you are
   * doing now rather than what you did on Tuesday.
   */
  usageWindowHours: number;

  /**
   * Which Claude plan this account is on: `free`, `pro`, `max-5x`, `max-20x`, `custom`.
   *
   * SkynetOS cannot ask — nothing local reports it. Naming the plan here supplies the published
   * multiplier (Max 20x is twenty times Pro), which is applied to a baseline calibrated from this
   * machine's own history. See packages/shared/plans.ts for exactly what that calibration was.
   *
   * The resulting budget is an ESTIMATE and is labelled as one everywhere it is shown.
   */
  plan: PlanId | null;

  /**
   * Weighted tokens you consider one window's worth. Overrides `plan` completely.
   *
   * There is no file on this disk and no local API that says how much of a subscription is left,
   * so SkynetOS cannot know it. Prime directive 1 forbids inventing it: with both this and `plan`
   * unset, the meter shows the real rate and says SET A BUDGET where the allowance would go,
   * rather than printing a confident fiction. A number here always wins over a plan estimate — a
   * measurement should never argue with an instruction. Weighted means cache reads count at a
   * tenth; see packages/shared/usage.ts.
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
  autoRunMail: true,
  usageWindowHours: 5,
  plan: null,
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
    // A hand-edited plan is free text until it is checked. An unrecognised one becomes null,
    // which means "no budget" — better than silently metering against the wrong ceiling.
    if (cached.plan !== null && !(typeof cached.plan === 'string' && isPlanId(cached.plan))) {
      console.warn(`[settings] unknown plan "${String(cached.plan)}" — ignoring it. Use one of: free, pro, max-5x, max-20x, custom`);
      cached.plan = null;
    }
  } catch (err) {
    console.error(`[settings] ${file} is malformed (${(err as Error).message}) — using defaults`);
    cached = { ...DEFAULTS };
  }
  return cached;
}

/**
 * Write the two usage-metering settings, and ONLY those two.
 *
 * docs/07: "Modify settings, allowlists, or elevation policy — Never. Settings are user-only." That
 * rule exists so the thing deciding what an agent may touch is not itself agent-writable, and it
 * is why there has never been a `settings:write` channel.
 *
 * This does not weaken it. `plan` and `tokenBudget` decide how a meter is SCALED. They grant no
 * access, allow no path, and elevate nothing — every field that does (devRoots,
 * confirmAllLaunches) is untouched here and remains editable only by opening the file. A general
 * settings writer would have been the wrong shape; this is a control for one display preference
 * that a user should not have to edit JSON to set.
 */
export function setUsagePlan(plan: PlanId | null, tokenBudget: number | null): { ok: boolean; error?: string } {
  const current = getSettings();
  const next: Settings = {
    ...current,
    plan: plan !== null && isPlanId(plan) ? plan : null,
    tokenBudget: tokenBudget !== null && Number.isFinite(tokenBudget) && tokenBudget > 0
      ? Math.round(tokenBudget)
      : null
  };
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(settingsFile(), JSON.stringify(next, null, 2) + '\n', 'utf8');
    cached = next;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `COULD NOT WRITE ${settingsFile()} — ${(err as Error).message}` };
  }
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
