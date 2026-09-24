import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';
import { isPlanId, type PlanId } from '@shared/plans.js';
import { DEFAULT_AWAY_MINUTES, clampAwayMinutes, isAwayMode, type AwayMode } from '@shared/presence.js';
import { AWAY_DEFAULT_MODEL } from '@shared/away.js';
import { DEFAULT_VOICE, type VoiceSettings } from '@shared/voice.js';
import { DEFAULT_VISION, type VisionSettings } from '@shared/vision.js';
import { REMOTE_DEFAULT_PORT } from '@shared/remote.js';
import { homeRoot } from './home.js';

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

  /**
   * Whether SkynetOS picks the model for every session it launches: Fable 5.1 at high effort while
   * Fable is available, Opus 5 at xhigh while it is out of usage. See
   * services/model-availability.ts. Off means every session opens on Claude Code's own default.
   * A node's explicit `model` wins either way. SkynetOS never edits ~/.claude/settings.json: the
   * choice travels as `--model` and `--effort` on each launch.
   */
  autoModel: boolean;

  /**
   * When Fable comes back, as an ISO instant, typed in the usage meter. The CLI shows the restart
   * time ("resets 8pm Monday") but does not always write it to disk, and SkynetOS will not guess
   * it. Used only while it is later than the refusal it answers, so a time left over from an
   * earlier outage decides nothing.
   */
  fableResetsAt: string | null;

  /**
   * Away (sleep) mode: what happens after `awayAfterMinutes` with no input, no agent activity and
   * no board commands. `off`: nothing. `visual`: the sleep screen only. `plan` (default): a headless
   * JARVIS Prime roadmaps across the projects, writing only the codex and docs/06. `work`: plan, plus
   * up to two low-resource sessions on existing agent nodes. See packages/shared/away.ts.
   *
   * `work` is FILE-ONLY: the in-app control can set every level except the one that starts
   * sessions on its own, which is the kind of grant docs/07 keeps out of any write channel.
   */
  awayMode: AwayMode;
  awayAfterMinutes: number;
  /** The model the away run uses. Default Sonnet: cheap enough to spend while William is away. */
  awayModel: string;

  /**
   * JARVIS face windows beside the web Face and JARVIS Prime terminals (services/avatar-window.ts).
   * A view preference, but main is the one that opens the windows, so it lives here, written only
   * through the user-only `avatar:setEnabled`. It grants nothing and allows no path.
   */
  avatarWindows: boolean;

  /**
   * Remote devices (docs/08-REMOTE.md). OFF by default. Turned on only from the desktop's REMOTE
   * panel (a user-only channel): never by an agent, never by a paired device. The server binds
   * 127.0.0.1 whatever this says; `remoteAllowedHosts` adds Host names beyond localhost and
   * `*.ts.net` (a reverse proxy of your own, say), and is file-only.
   */
  remoteEnabled: boolean;
  remotePort: number;
  remoteAllowedHosts: string[];

  /**
   * Voice control and manual (gesture) control. BOTH OFF by default, and both switched on only
   * from the desktop by William — `gesture:setEnabled` and the voice switch are user-only channels,
   * in neither AGENT_METHODS nor REMOTE_METHODS. An agent that could turn either on would be
   * opening a microphone or a camera in his room.
   *
   * Their engine paths point outside the repo (whisper is ~700 MB, the hand model 7.8 MB, and the
   * repo is public), so they are per-machine like `boot.vbs` and are never committed.
   */
  voice: VoiceSettings;
  gesture: VisionSettings;

  /**
   * Where an INSTALLED SkynetOS keeps its boards and codex. Null means: the repo the build was
   * made from if it is on this machine, else `%USERPROFILE%/SkynetOS`. Ignored by a dev build,
   * whose home is the repo it runs from. File-only, like `devRoots`: the home is a trusted root,
   * so no channel may move it. See packages/shared/home.ts.
   */
  home: string | null;
}

/**
 * `%LOCALAPPDATA%`, where the voice and vision engines are installed by the tools in `tools/`.
 * Not `app.getPath`: this module is also loaded outside Electron (target-resolver.ts runs under
 * vite-node for `npm run face:bake`), where `app` is absent.
 */
function localAppData(): string {
  const fromEnv = process.env['LOCALAPPDATA'];
  if (fromEnv) return fromEnv;
  const home = homedir();
  return home ? join(home, 'AppData', 'Local') : '';
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
  tokenBudget: null,
  autoModel: true,
  fableResetsAt: null,
  awayMode: 'plan',
  awayAfterMinutes: DEFAULT_AWAY_MINUTES,
  awayModel: AWAY_DEFAULT_MODEL,
  avatarWindows: true,
  remoteEnabled: false,
  remotePort: REMOTE_DEFAULT_PORT,
  remoteAllowedHosts: [],
  home: null,
  // The install locations tools/ downloads into. Empty if LOCALAPPDATA is somehow unset, which the
  // readiness checks in @shared/voice.ts and @shared/vision.ts then report as "not installed".
  voice: {
    ...DEFAULT_VOICE,
    exe: localAppData() ? join(localAppData(), 'SkynetOS', 'voice', 'cuda', 'Release', 'whisper-stream.exe') : '',
    model: localAppData() ? join(localAppData(), 'SkynetOS', 'voice', 'models', 'ggml-base.en.bin') : '',
    server: localAppData() ? join(localAppData(), 'SkynetOS', 'voice', 'cuda', 'Release', 'whisper-server.exe') : '',
    serverModel: localAppData() ? join(localAppData(), 'SkynetOS', 'voice', 'models', 'ggml-large-v3-turbo-q5_0.bin') : ''
  },
  gesture: {
    ...DEFAULT_VISION,
    model: localAppData() ? join(localAppData(), 'SkynetOS', 'vision', 'hand_landmarker.task') : '',
    gestureModel: localAppData() ? join(localAppData(), 'SkynetOS', 'vision', 'gesture_recognizer.task') : ''
  }
};

let cached: Settings | null = null;

/**
 * Electron's userData inside the app, and the same folder by its Windows name outside it.
 *
 * `npm run face:bake` resolves every board target through target-resolver.ts, which asks
 * `trustedRoots()`, which asks this, with no Electron in the process. `%APPDATA%/SkynetOS` is
 * what userData is for a productName of SkynetOS, so it reads the real file rather than a guess.
 */
function userDataDir(): string {
  if (app) return app.getPath('userData');
  return join(process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'), 'SkynetOS');
}

function settingsFile(): string {
  return join(userDataDir(), 'settings.json');
}

export function getSettings(): Settings {
  if (cached) return cached;
  const file = settingsFile();
  if (!existsSync(file)) {
    // Outside the app this is read-only: a build tool has no business creating the user's
    // settings file, and the defaults are the same answer the app would write.
    if (!app) return { ...DEFAULTS };
    mkdirSync(userDataDir(), { recursive: true });
    writeFileSync(file, JSON.stringify(DEFAULTS, null, 2));
    console.log(`[settings] wrote defaults to ${file}`);
    cached = { ...DEFAULTS };
    return cached;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Settings>;
    // Merge over defaults so a hand-edited file missing a key still works. The two nested blocks
    // are merged a level deeper for the same reason: `"gesture": { "enabled": true }` in the file
    // must not wipe out the model path it says nothing about.
    cached = {
      ...DEFAULTS,
      ...parsed,
      voice: { ...DEFAULTS.voice, ...(parsed.voice ?? {}) },
      gesture: { ...DEFAULTS.gesture, ...(parsed.gesture ?? {}) }
    };
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
    mkdirSync(userDataDir(), { recursive: true });
    writeFileSync(settingsFile(), JSON.stringify(next, null, 2) + '\n', 'utf8');
    cached = next;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `COULD NOT WRITE ${settingsFile()} — ${(err as Error).message}` };
  }
}

/**
 * Write Fable's restart time, and ONLY that.
 *
 * The same reasoning as `setUsagePlan`: it grants no access, allows no path and elevates nothing.
 * It decides which of two models a launch asks for, and when the countdown ends. It is a
 * user-only channel, not in AGENT_METHODS, so no agent can move Fable's restart to keep itself on
 * a model. Null clears it.
 */
export function setFableResetsAt(iso: string | null): { ok: boolean; error?: string } {
  const at = iso === null ? null : Date.parse(iso);
  if (at !== null && !Number.isFinite(at)) return { ok: false, error: `NOT A TIME — ${iso}` };
  const next: Settings = { ...getSettings(), fableResetsAt: at === null ? null : new Date(at).toISOString() };
  try {
    mkdirSync(userDataDir(), { recursive: true });
    writeFileSync(settingsFile(), JSON.stringify(next, null, 2) + '\n', 'utf8');
    cached = next;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `COULD NOT WRITE ${settingsFile()} — ${(err as Error).message}` };
  }
}

/**
 * Write the away-mode settings: the mode, the minutes and the model. ONLY those.
 *
 * The same reasoning as `setUsagePlan`: the in-app control picks between bounds that are fixed in
 * code (packages/shared/away.ts). It cannot widen them, allows no path and elevates nothing. The
 * one level that grants something, `work` (the away run may start sessions), is refused here and
 * can only be set by editing settings.json, so no write channel can hand an autonomous run more
 * authority. A user-only channel, not in AGENT_METHODS.
 */
export function setAwaySettings(patch: { mode?: unknown; afterMinutes?: unknown; model?: unknown }): { ok: boolean; error?: string } {
  const current = getSettings();
  const next: Settings = { ...current };
  if (patch.mode !== undefined) {
    if (!isAwayMode(patch.mode)) return { ok: false, error: `NOT AN AWAY MODE — ${String(patch.mode)}` };
    if (patch.mode === 'work') {
      return { ok: false, error: 'WORK MODE STARTS SESSIONS ON ITS OWN, SO IT IS SET ONLY IN settings.json ("awayMode": "work")' };
    }
    next.awayMode = patch.mode;
  }
  if (patch.afterMinutes !== undefined) next.awayAfterMinutes = clampAwayMinutes(patch.afterMinutes);
  if (patch.model !== undefined) {
    const model = String(patch.model).trim();
    if (!/^[a-z0-9][a-z0-9.\-[\]]{1,59}$/i.test(model)) return { ok: false, error: `NOT A MODEL NAME — ${model}` };
    next.awayModel = model;
  }
  try {
    mkdirSync(userDataDir(), { recursive: true });
    writeFileSync(settingsFile(), JSON.stringify(next, null, 2) + '\n', 'utf8');
    cached = next;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `COULD NOT WRITE ${settingsFile()} — ${(err as Error).message}` };
  }
}

/** The JARVIS face windows' global switch. User-only; see `avatarWindows`. */
export function setAvatarWindowsEnabled(on: boolean): { ok: boolean; error?: string } {
  const next: Settings = { ...getSettings(), avatarWindows: on === true };
  try {
    mkdirSync(userDataDir(), { recursive: true });
    writeFileSync(settingsFile(), JSON.stringify(next, null, 2) + '\n', 'utf8');
    cached = next;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `COULD NOT WRITE ${settingsFile()} — ${(err as Error).message}` };
  }
}

/**
 * Remote on or off, and ONLY that (the port too, if given). The same reasoning as the others: the
 * server it starts binds 127.0.0.1, admits only paired devices, and can do only REMOTE_METHODS. A
 * user-only channel, in neither AGENT_METHODS nor REMOTE_METHODS, so nothing but William at the PC
 * can open the door. `remoteAllowedHosts` stays file-only.
 */
export function setRemoteSettings(patch: { enabled?: boolean; port?: number }): { ok: boolean; error?: string } {
  const next: Settings = { ...getSettings() };
  if (patch.enabled !== undefined) next.remoteEnabled = patch.enabled === true;
  if (patch.port !== undefined) {
    const port = Math.round(Number(patch.port));
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return { ok: false, error: `NOT A USABLE PORT — ${String(patch.port)}` };
    next.remotePort = port;
  }
  try {
    mkdirSync(userDataDir(), { recursive: true });
    writeFileSync(settingsFile(), JSON.stringify(next, null, 2) + '\n', 'utf8');
    cached = next;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `COULD NOT WRITE ${settingsFile()} — ${(err as Error).message}` };
  }
}

/**
 * Manual control on or off, and ONLY that. The same reasoning as `setRemoteSettings`: a user-only
 * channel, in neither AGENT_METHODS nor REMOTE_METHODS, because this one opens a camera. The engine
 * paths and the camera list stay file-only.
 */
export function setGestureEnabled(on: boolean): { ok: boolean; error?: string } {
  const next: Settings = { ...getSettings(), gesture: { ...getSettings().gesture, enabled: on === true } };
  try {
    mkdirSync(userDataDir(), { recursive: true });
    writeFileSync(settingsFile(), JSON.stringify(next, null, 2) + '\n', 'utf8');
    cached = next;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `COULD NOT WRITE ${settingsFile()} — ${(err as Error).message}` };
  }
}

/**
 * Voice on or off, and ONLY that. User-only like manual control, because it opens a microphone. The
 * engine paths, the port and the wake phrases stay file-only.
 */
export function setVoiceEnabled(on: boolean): { ok: boolean; error?: string } {
  const next: Settings = { ...getSettings(), voice: { ...getSettings().voice, enabled: on === true } };
  try {
    mkdirSync(userDataDir(), { recursive: true });
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
    app ? app.getPath('home') : homedir(),
    // The data home, so the board can always point at its own files. Outside the app that is the
    // working directory: see services/home.ts.
    homeRoot()
  ].map(normaliseRoot);
}

export function normaliseRoot(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
