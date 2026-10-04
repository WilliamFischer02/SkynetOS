/**
 * Desktop control: opening programs on a chosen monitor, placing their windows, moving the mouse
 * and pressing keys, on William's own desktop, at his spoken or typed request
 * (docs/11-JARVIS-VOICE.md § Desktop control; rules in docs/07 § Desktop control).
 *
 * Types, then the PURE rules: how monitors are numbered, where a window goes, which program a
 * spoken name means, how a sentence becomes steps, what JARVIS says about the result, and the
 * text of the helper process. Nothing in this file moves anything; services/desktop.ts does, and
 * only through the steps a plan carries.
 */

import { DEFAULT_CONVERSE } from './converse.js';
import { normaliseChord, isRefusedChord, isSensitiveTitle } from './actions.js';

export interface DesktopSettings {
  /** The one switch. Written only by the user-only `desktop:setEnabled`. OFF by default. */
  enabled: boolean;
  /**
   * Spoken monitor numbers, in order: the display id or label that "one", "two", "three" mean.
   * Empty means: the primary display is one, then the others left to right.
   */
  monitors: string[];
  /**
   * Programs by the name William says for them, to an executable or a .lnk. These are added to
   * the Start Menu catalogue and win over it. File-only: an entry here is his standing consent to
   * launch that program by voice without a dialog.
   */
  apps: Record<string, string>;
  /** Pause between steps, so the desktop can be watched doing it. */
  stepDelayMs: number;
  /** How long the mouse takes to travel to a point. The point is to see it go. */
  mouseTravelMs: number;
  /**
   * M13.3, the planner (docs/11 § Slice 2): a desktop request the rule grammar does not match is
   * handed to a headless `claude -p` for a plan, which is read back and then run. TRUE by default,
   * but it only ever acts while `enabled` is also true, so a new install (enabled false) never
   * plans. False: the old behaviour (the sentence is answered by conversation, or refused).
   */
  planner: boolean;
  /** The model the planner asks. The same default as conversation (`converse.model`). */
  plannerModel: string;
}

export const DEFAULT_DESKTOP: DesktopSettings = {
  enabled: false,
  monitors: [],
  apps: {},
  stepDelayMs: 250,
  mouseTravelMs: 450,
  planner: true,
  plannerModel: DEFAULT_CONVERSE.model
};

/** The planner is live only when both switches say so: desktop control on, and the planner not off. */
export function plannerActive(s: Pick<DesktopSettings, 'enabled' | 'planner'> | null | undefined): boolean {
  return s?.enabled === true && s.planner !== false;
}

export interface AppEntry {
  /** The name it is matched against when spoken: the shortcut's name, lower-cased. */
  name: string;
  /** The .lnk or executable that launches it. */
  path: string;
  source: 'startmenu' | 'settings';
}

export interface MonitorInfo {
  /** The spoken number, from 1. */
  index: number;
  /** Electron's display id. */
  id: number;
  label: string;
  primary: boolean;
  /** DIP bounds and work area (the taskbar excluded). */
  x: number;
  y: number;
  width: number;
  height: number;
  work: { x: number; y: number; width: number; height: number };
  scale: number;
}

export interface DesktopWindow {
  /** The HWND, as a number. */
  handle: number;
  title: string;
  process: string;
  /** DIP rectangle. */
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  foreground: boolean;
  /** Spoken monitor number the window's centre is on, or 0 if off every monitor. */
  monitor: number;
}

export type WindowLayout = 'fill' | 'left' | 'right' | 'top' | 'bottom' | 'centre';

/**
 * One thing the desktop does. A plan is a list of these, run in order, each reported as it runs.
 * `launch` only ever names a catalogue entry (a Start Menu shortcut or an `apps` entry): there is
 * no step that runs an arbitrary path or command.
 */
export type DesktopStep =
  | { kind: 'launch'; app: string; monitor?: number; layout?: WindowLayout }
  | { kind: 'place'; window: string; monitor: number; layout?: WindowLayout }
  /**
   * `focusByPointer` (2026-09-27, "use my mouse to select the firefox window"): the window is
   * found by process name or title token (`pickWindow`), the pointer travels VISIBLY to its centre,
   * and it is brought forward; when Windows refuses the foreground, the pointer clicks its title
   * bar (`titleBarPoint`). Without the flag, the old title-only SetForegroundWindow.
   */
  | { kind: 'focus'; window: string; focusByPointer?: boolean }
  | { kind: 'url'; url: string; browser?: string; monitor?: number; site?: string }
  /** 2026-09-27: the mouse wheel where the pointer is (after a `focusByPointer`, the window's centre). */
  | { kind: 'scroll'; direction: 'up' | 'down'; notches: number }
  | { kind: 'mouse'; x: number; y: number; monitor?: number; click?: 'left' | 'right' | 'double' }
  | { kind: 'keys'; text?: string; combo?: string }
  | { kind: 'wait'; ms: number }
  | { kind: 'say'; text: string }
  /**
   * M13.3: click a control found BY NAME through UI Automation inside the window whose title
   * holds `window` (the helper's `uiafind`, the replay's `element` tier). Never a coordinate: when
   * the control is not found, the step fails and says so.
   */
  | { kind: 'uiaClick'; window: string; control: string; type?: string };

export interface DesktopPlan {
  /** Where the plan came from: a rule in intent.ts, a typed line, or the planner (slice 2). */
  source: 'voice' | 'typed' | 'planner';
  /** The sentence it answers, for the log and the hologram. */
  heard: string;
  steps: DesktopStep[];
  /** The line said when every step ran (a rule plan that knows what it did: "Space, in Firefox."). */
  reply?: string;
}

export interface DesktopStepResult {
  step: DesktopStep;
  ok: boolean;
  message: string;
  ms: number;
}

export interface DesktopResult {
  ok: boolean;
  /** One line, in the register: what happened, or what failed and what to do. */
  message: string;
  steps: DesktopStepResult[];
  /** Esc, "stop", or the switch: the plan was cut short on purpose. */
  halted: boolean;
}

export type DesktopHelperPhase = 'off' | 'starting' | 'ready' | 'unavailable';

export interface DesktopStatus {
  enabled: boolean;
  helper: DesktopHelperPhase;
  busy: boolean;
  monitors: MonitorInfo[];
  /** How many programs the catalogue knows. */
  apps: number;
  error?: string;
}

/** Pushed while a plan runs, one per step and one at the end, so the hologram can show it acting. */
export interface DesktopState {
  busy: boolean;
  index?: number;
  total?: number;
  step?: DesktopStep;
  message?: string;
}

/** The most steps one sentence may turn into. A longer plan is a script, and scripts are not spoken. */
export const MAX_PLAN_STEPS = 12;
/** How long a launched program has to show a window before the step gives up on it. */
export const LAUNCH_WAIT_MS = 20_000;
/** The special window name a plan uses for "this" or "that": whatever is in front right now. */
export const FOREGROUND = '*foreground*';

/* ────────────────────────── monitors ────────────────────────── */

export interface DisplayLike {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  primary?: boolean;
}

/**
 * "One" is the primary display, then the rest left to right, unless `order` names ids or labels,
 * in which case those come first in that order. A display that is neither primary nor named still
 * gets a number, because a window must be placeable on every screen.
 */
export function numberMonitors(displays: readonly DisplayLike[], order: readonly string[] = []): MonitorInfo[] {
  const isPrimary = (d: DisplayLike): boolean => d.primary === true || (d.bounds.x === 0 && d.bounds.y === 0 && !displays.some((o) => o.primary === true));
  const named: DisplayLike[] = [];
  for (const key of order) {
    const want = key.trim().toLowerCase();
    if (!want) continue;
    const hit = displays.find((d) => String(d.id) === want || d.label.trim().toLowerCase() === want);
    if (hit && !named.includes(hit)) named.push(hit);
  }
  const rest = displays
    .filter((d) => !named.includes(d))
    .sort((a, b) => (isPrimary(b) ? 1 : 0) - (isPrimary(a) ? 1 : 0) || a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
  return [...named, ...rest].map((d, i) => ({
    index: i + 1,
    id: d.id,
    label: d.label,
    primary: isPrimary(d),
    x: d.bounds.x,
    y: d.bounds.y,
    width: d.bounds.width,
    height: d.bounds.height,
    work: { ...d.workArea },
    scale: d.scaleFactor || 1
  }));
}

export interface Rect { x: number; y: number; width: number; height: number }

/** Where a window goes inside a monitor's work area. `centre` is 70% of it, centred. */
export function placeIn(work: Rect, layout: WindowLayout = 'fill'): Rect {
  const r = (n: number): number => Math.round(n);
  switch (layout) {
    case 'left': return { x: work.x, y: work.y, width: r(work.width / 2), height: work.height };
    case 'right': return { x: work.x + r(work.width / 2), y: work.y, width: work.width - r(work.width / 2), height: work.height };
    case 'top': return { x: work.x, y: work.y, width: work.width, height: r(work.height / 2) };
    case 'bottom': return { x: work.x, y: work.y + r(work.height / 2), width: work.width, height: work.height - r(work.height / 2) };
    case 'centre': {
      const width = r(work.width * 0.7);
      const height = r(work.height * 0.7);
      return { x: work.x + r((work.width - width) / 2), y: work.y + r((work.height - height) / 2), width, height };
    }
    case 'fill':
    default:
      return { x: work.x, y: work.y, width: work.width, height: work.height };
  }
}

/** The spoken number of the monitor a rectangle's centre is on, or 0. */
export function monitorOf(rect: Rect, monitors: readonly MonitorInfo[]): number {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const hit = monitors.find((m) => cx >= m.x && cx < m.x + m.width && cy >= m.y && cy < m.y + m.height);
  return hit?.index ?? 0;
}

/* ────────────────────────── programs ────────────────────────── */

/** Words that are in a shortcut's name but never in what anyone says. */
const NOISE_WORDS = new Set(['adobe', 'google', 'microsoft', 'the', 'app', 'application', 'launcher', 'desktop', 'x64', 'x86', '64-bit', '32-bit']);

/** What William says, to what the shortcut is called. Applied to the spoken side only. */
export const APP_ALIASES: Record<string, string> = {
  'vs code': 'visual studio code',
  vscode: 'visual studio code',
  code: 'visual studio code',
  ae: 'after effects',
  'after fx': 'after effects',
  premiere: 'premiere pro',
  ps: 'photoshop',
  terminal: 'windows terminal',
  explorer: 'file explorer',
  chrome: 'chrome',
  edge: 'edge'
};

/** Lower-case, no punctuation, no noise words, no year suffixes; one space between words. */
export function appKey(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9+#. ]+/g, ' ')
    .replace(/\.(lnk|exe|url)$/g, '')
    .split(/\s+/)
    .filter((w) => w && !NOISE_WORDS.has(w) && !/^(19|20)\d\d$/.test(w) && !/^v?\d+(\.\d+)*$/.test(w));
  return words.join(' ');
}

/**
 * The catalogue entry a spoken name means, or null. Exact key first, then a name that starts with
 * the spoken words, then one containing all of them as whole words. Among equals: a settings
 * entry wins over the Start Menu, and the shortest name wins over the longer ("firefox" is
 * Firefox, not Firefox Private Browsing).
 */
export function matchApp(spoken: string, catalogue: readonly AppEntry[]): AppEntry | null {
  let key = appKey(spoken.replace(/^my /, ''));
  if (!key) return null;
  key = APP_ALIASES[key] ?? key;
  const ranked = catalogue
    .map((entry) => ({ entry, k: appKey(entry.name) }))
    .filter((c) => c.k)
    .map((c) => {
      let score = 0;
      if (c.k === key) score = 3;
      else if (c.k.startsWith(key + ' ')) score = 2;
      else {
        const words = key.split(' ');
        const have = new Set(c.k.split(' '));
        if (words.every((w) => have.has(w))) score = 1;
      }
      return { ...c, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || (a.entry.source === 'settings' ? -1 : 0) - (b.entry.source === 'settings' ? -1 : 0) || a.k.length - b.k.length || a.entry.name.localeCompare(b.entry.name));
  return ranked[0]?.entry ?? null;
}

/* ────────────────────────── sites ────────────────────────── */

export interface Site { name: string; url: string }

/** Spoken names for the sites William reaches by voice. A name is one or two words he would say. */
export const SITES: Record<string, Site> = {
  hotmail: { name: 'Hotmail', url: 'https://outlook.live.com/mail/' },
  outlook: { name: 'Outlook', url: 'https://outlook.live.com/mail/' },
  'my email': { name: 'Hotmail', url: 'https://outlook.live.com/mail/' },
  gmail: { name: 'Gmail', url: 'https://mail.google.com/' },
  youtube: { name: 'YouTube', url: 'https://www.youtube.com/' },
  github: { name: 'GitHub', url: 'https://github.com/' },
  claude: { name: 'Claude', url: 'https://claude.ai/' },
  reddit: { name: 'Reddit', url: 'https://www.reddit.com/' },
  twitter: { name: 'X', url: 'https://x.com/' },
  x: { name: 'X', url: 'https://x.com/' },
  chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  'chat gpt': { name: 'ChatGPT', url: 'https://chatgpt.com/' }
};

export function matchSite(spoken: string): Site | null {
  const key = spoken.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^my /, '');
  return SITES[key] ?? SITES[`my ${key}`] ?? null;
}

/* ────────────────────────── the sentence ────────────────────────── */

const MONITOR_WORDS: Record<string, number> = { one: 1, '1': 1, two: 2, '2': 2, to: 2, too: 2, three: 3, '3': 3, four: 4, '4': 4, five: 5, '5': 5, six: 6, '6': 6 };

export interface ParseContext {
  apps: readonly AppEntry[];
  /** How many monitors are attached; the parser passes the number through, the service checks it. */
  monitors: number;
}

const BROWSERS = ['firefox', 'chrome', 'edge', 'brave', 'opera', 'vivaldi'];

/** The browser a site opens in when none is named: the first of these that is installed. */
export function defaultBrowser(apps: readonly AppEntry[]): AppEntry | null {
  for (const name of BROWSERS) {
    const hit = matchApp(name, apps);
    if (hit) return hit;
  }
  return null;
}

function monitorNumber(word: string | undefined): number | undefined {
  if (!word) return undefined;
  return MONITOR_WORDS[word.toLowerCase()];
}

/**
 * A spoken sentence to steps, or null when it is not about the desktop at all.
 *
 *   open after effects on one and firefox on two
 *   launch photoshop on monitor 2
 *   open my hotmail in firefox
 *   open youtube
 *   move firefox to two · put this on one
 *
 * Only a name that matches the catalogue or the site table makes a plan, so "open the stalker"
 * stays the board's own command. A later clause without a verb keeps the verb; a clause without a
 * monitor keeps the previous clause's monitor.
 */
export function parseDesktopCommand(text: string, ctx: ParseContext): DesktopPlan | null {
  const sentence = text.toLowerCase().replace(/[.!?]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!sentence) return null;
  const clauses = sentence.split(/\s*(?:,\s*and\s+|,\s+|\s+and\s+|\s+then\s+)\s*/).filter(Boolean);
  const steps: DesktopStep[] = [];
  let verb: 'open' | 'move' | null = null;
  let monitor: number | undefined;

  for (const clause of clauses) {
    let rest = clause;
    const opened = /^(?:open|launch|start|bring up|run)\s+(.+)$/.exec(rest);
    const moved = /^(?:move|put|send)\s+(.+)$/.exec(rest);
    if (opened) { verb = 'open'; rest = opened[1]!; }
    else if (moved) { verb = 'move'; rest = moved[1]!; }
    else if (!verb) return null;

    if (verb === 'move') {
      const m = /^(.+?)\s+(?:to|onto|on|over to)\s+(?:monitor\s+|screen\s+|display\s+)?(\S+)$/.exec(rest);
      if (!m) return null;
      const n = monitorNumber(m[2]);
      if (!n) return null;
      const who = m[1]!.trim();
      let window: string;
      if (/^(this|that|it|this one|that one|this window|that window)$/.test(who)) window = FOREGROUND;
      else {
        const app = matchApp(who, ctx.apps);
        if (!app) return null;
        window = app.name;
      }
      monitor = n;
      steps.push({ kind: 'place', window, monitor: n });
      continue;
    }

    // open <thing> [in <browser>] [on [monitor] <n>]
    const m = /^(.+?)(?:\s+in\s+(\S+(?:\s+\S+)?))?(?:\s+on\s+(?:monitor\s+|screen\s+|display\s+)?(\S+))?$/.exec(rest);
    if (!m) return null;
    const thing = m[1]!.trim();
    const n = monitorNumber(m[3]);
    if (m[3] && !n) return null;
    if (n) monitor = n;
    const site = matchSite(thing);
    const app = site ? null : matchApp(thing, ctx.apps);
    if (site) {
      const browser = m[2] ? matchApp(m[2], ctx.apps) : defaultBrowser(ctx.apps);
      steps.push({ kind: 'url', url: site.url, site: site.name, ...(browser ? { browser: browser.name } : {}), ...(monitor ? { monitor } : {}) });
    } else if (app) {
      // "open X in firefox" with X not a site: the "in" was part of the name; try the whole thing.
      const whole = m[2] ? matchApp(rest.replace(/\s+on\s+.*$/, ''), ctx.apps) : null;
      steps.push({ kind: 'launch', app: (whole ?? app).name, ...(monitor ? { monitor } : {}) });
    } else {
      return null;
    }
  }
  if (!steps.length) return null;
  return { source: 'voice', heard: text, steps };
}

/* ────────────────────────── the reply ────────────────────────── */

const ORDINAL: Record<number, string> = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six' };

export function monitorWord(n: number | undefined): string {
  return n ? ORDINAL[n] ?? String(n) : '';
}

function displayName(app: string): string {
  // "Adobe After Effects 2026" is said as "After Effects".
  return app
    .split(/\s+/)
    .filter((w) => !NOISE_WORDS.has(w.toLowerCase()) && !/^(19|20)\d\d$/.test(w))
    .join(' ') || app;
}

/**
 * After a step fails, does the rest of the plan stop? Yes when anything left types, clicks, scrolls
 * or moves the pointer: those act on "the window in front", which after a failed focus or launch is
 * not the window the plan meant (bug sweep 2026-09-27: a remembered plan whose Word window had closed
 * would have typed its text into whatever was in front). Launches, moves and focuses stand alone, so
 * "open Firefox on one and Notepad on two" still opens Notepad when Firefox fails.
 */
export function stopsAfterFailure(rest: readonly DesktopStep[]): boolean {
  return rest.some((s) => s.kind === 'keys' || s.kind === 'mouse' || s.kind === 'scroll' || s.kind === 'uiaClick');
}

/**
 * What JARVIS says when the plan has run. Answer first, in the register: what is open and where,
 * then what did not happen and why, one clause each, no exclamation marks. A refused plan is its
 * own message, unchanged.
 */
export function replyFor(plan: DesktopPlan, result: DesktopResult): string {
  if (!result.steps.length) return result.message;
  if (plan.reply) {
    // A reaching plan (press, scroll, click, type in a window): its own line, or what failed.
    if (result.ok) return plan.reply;
    const failed = result.steps.filter((r) => !r.ok).map((r) => r.message.trim()).map((m) => (/[.?!]$/.test(m) ? m : `${m}.`));
    const parts = failed.length ? [failed.join(' ')] : [];
    if (result.halted) parts.push('Stopped there, as asked.');
    return (parts.join(' ') || result.message).replace(/\.\./g, '.');
  }
  const good: string[] = [];
  const bad: string[] = [];
  for (const r of result.steps) {
    const s = r.step;
    if (!r.ok) { bad.push(r.message.replace(/[.\s]+$/, '')); continue; }
    switch (s.kind) {
      case 'launch': good.push(`${displayName(s.app)}${s.monitor ? ` on ${monitorWord(s.monitor)}` : ''}`); break;
      case 'url': good.push(`${s.site ?? s.url}${s.browser ? ` in ${displayName(s.browser)}` : ''}${s.monitor ? ` on ${monitorWord(s.monitor)}` : ''}`); break;
      case 'place': good.push(`${s.window === FOREGROUND ? 'That' : displayName(s.window)} on ${monitorWord(s.monitor)}`); break;
      case 'focus': good.push(`${displayName(s.window)} in front`); break;
      case 'uiaClick': good.push(`${s.control} pressed`); break;
      default: break;
    }
  }
  const parts: string[] = [];
  if (good.length === 1) parts.push(`${good[0]} is open.`);
  else if (good.length > 1) parts.push(`${good.slice(0, -1).join(', ')} and ${good[good.length - 1]} are open.`);
  if (bad.length) parts.push(`${bad.join('. ')}.`);
  if (result.halted) parts.push('Stopped there, as asked.');
  if (!parts.length) parts.push(result.ok ? 'Done.' : result.message);
  return parts.join(' ').replace(/\.\./g, '.');
}

/* ────────────────────────── the helper ────────────────────────── */

/** A line the helper printed, parsed; null for anything that is not a JSON object. */
export function parseDesktopLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const value = JSON.parse(trimmed) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Key combinations the helper refuses whatever it is told. Closing or locking his machine is his. */
export const REFUSED_COMBOS = ['alt+f4', 'ctrl+alt+delete', 'ctrl+alt+del', 'win+l', 'ctrl+shift+esc', 'ctrl+shift+escape', 'alt+ctrl+delete',
  // 2026-09-26 audit: the same list a replayed action obeys (packages/shared/actions.ts). Start,
  // Run and the power-user menu each open a shell that takes a typed command, which docs/07 forbids
  // a step to run; a spoken plan and a replay must refuse the same keys.
  'win', 'win+r', 'win+x'];

export function isRefusedCombo(combo: string): boolean {
  const key = combo.toLowerCase().replace(/\s+/g, '').split('+').sort().join('+');
  return REFUSED_COMBOS.some((r) => r.split('+').sort().join('+') === key);
}

/* ────────────────────────── the planner's steps (M13.3) ────────────────────────── */

/** The only step kinds a model-written plan may use (docs/07 § JARVIS Voice, the planner row). */
export const PLANNER_STEP_KINDS = ['launch', 'focus', 'place', 'uiaClick', 'keys', 'wait'] as const;
/** The longest a planned `wait` may be. Anything longer is clamped, not refused. */
export const PLANNER_MAX_WAIT_MS = 3000;
/** The most text one planned `keys` step may type. */
export const PLANNER_MAX_TEXT = 500;

/**
 * Programs a planned step may not launch, focus, place or click into: every one of them takes a
 * typed line and runs it, and docs/07 says no step runs a shell string. A rule-based plan can
 * still open Windows Terminal by name; a model cannot, because it could then type into it. A
 * path (a slash, a colon, a backslash) or an executable's extension is refused the same way.
 */
const SHELL_WORDS = /\b(?:cmd|command prompt|powershell|pwsh|windows terminal|terminal|bash|git bash|wsl|ubuntu|debian|kali|conhost|openconsole|mintty|run dialog|registry editor|regedit|task manager|taskmgr)\b/i;
/** A path or an executable's name: what a `launch` never is (a catalogue entry is a name). */
const PATHLIKE = /[\\/:]|\.(?:exe|bat|cmd|com|ps1|psm1|vbs|js|msi|lnk|scr)$/i;

/** Process names the helper reports for a shell window. Typing into one is refused at run time too. */
export const SHELL_PROCESSES = /^(?:cmd|powershell|pwsh|powershell_ise|windowsterminal|wt|bash|sh|wsl|wslhost|conhost|openconsole|mintty|git-bash|python\d*|pythonw\d*|py|pyw|node|irb|regedit|taskmgr|mmc)$/i;

/**
 * Catalogue entries a planned `launch` never opens, on top of SHELL_WORDS: an interpreter or REPL
 * (Python, IDLE, Node, Git for Windows' bash), the Run dialog, and the machine's administration
 * (Control Panel, Administrative Tools, Computer Management, Services, Event Viewer). Each takes
 * typed input that runs or changes the system. Found on this PC's Start Menu, 2026-09-27.
 */
const PLANNER_NEVER_LAUNCH = /^(?:run|run dialog)$|\b(?:python|idle|pydoc|node\.?js|node|git for windows|git cmd|control panel|administrative tools|computer management|services|event viewer|group policy|system configuration|recovery drive|disk management|windows tools)\b/i;

/**
 * Control names that answer a dialog or close something. docs/07: no dialog is answered and no
 * program is closed by a spoken plan; a plan that needs one stops and asks.
 */
const DIALOG_ANSWERS = /^(?:ok|okay|yes|no|y|n|allow|deny|block|accept|agree|i agree|decline|confirm|continue|continue anyway|run|run anyway|install|uninstall|remove|delete|delete all|discard|don'?t save|do not save|replace|overwrite|keep both|retry|abort|ignore|close|close all|close tab|close window|exit|quit|end task|sign in|sign out|log in|log out|login|logout|shut down|restart|sleep|lock|send|pay|buy|purchase|submit|update|update now|restart now)$/i;

/** Chords a planned step may not press on top of REFUSED_COMBOS: each closes a tab, a window or a program. */
const PLANNER_REFUSED_CHORDS = new Set(['ctrl+w', 'ctrl+shift+w', 'ctrl+q', 'ctrl+f4', 'alt+space', 'ctrl+shift+q', 'alt+f4']);

/** Named keys the helper's `combo` op knows (its `$vk` table), less F4. Single characters are also allowed. */
const PLANNER_KEYS = new Set(['ctrl', 'alt', 'shift', 'enter', 'tab', 'escape', 'space', 'backspace', 'delete', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown',
  'f1', 'f2', 'f3', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12']);

const LAYOUTS: readonly WindowLayout[] = ['fill', 'left', 'right', 'top', 'bottom', 'centre'];

export interface NormaliseContext {
  apps: readonly AppEntry[];
  /** How many monitors are attached. */
  monitors: number;
}

export interface NormalisedPlan {
  steps: DesktopStep[];
  /** One plain clause per step that was removed, and why. Non-empty means the plan does not run. */
  dropped: string[];
}

// eslint-disable-next-line no-control-regex
const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

function layoutOf(v: unknown): WindowLayout | undefined {
  const l = typeof v === 'string' ? v.toLowerCase().replace('center', 'centre') : '';
  return (LAYOUTS as readonly string[]).includes(l) ? (l as WindowLayout) : undefined;
}

function monitorIn(v: unknown, count: number): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= Math.max(1, count) ? n : undefined;
}

/** "Button" or "ControlType.Button" to the helper's programmatic name; anything else is left out. */
function controlTypeOf(v: unknown): string | undefined {
  const t = typeof v === 'string' ? v.trim() : '';
  const m = /^(?:ControlType\.)?([A-Za-z]{2,30})$/.exec(t);
  if (!m) return undefined;
  const name = m[1]!;
  return `ControlType.${name[0]!.toUpperCase()}${name.slice(1)}`;
}

/** A chord the planner may press, in canonical form, or why not. */
export function plannerChord(combo: string): { ok: true; chord: string } | { ok: false; why: string } {
  const chord = normaliseChord(combo);
  if (!chord) return { ok: false, why: 'an empty key combination' };
  if (isRefusedCombo(chord) || isRefusedChord(chord) || PLANNER_REFUSED_CHORDS.has(chord)) return { ok: false, why: `${chord} closes, locks or opens a shell, which is yours to do` };
  const parts = chord.split('+');
  if (parts.includes('win')) return { ok: false, why: `${chord} uses the Windows key, which a planned step never presses` };
  if (parts.length > 4) return { ok: false, why: `${chord} is more keys than a chord` };
  for (const p of parts) {
    if (PLANNER_KEYS.has(p)) continue;
    if (p.length === 1 && /^[a-z0-9`\-=[\];',./\\]$/.test(p)) continue;
    return { ok: false, why: `${chord} has a key the helper does not know (${p})` };
  }
  return { ok: true, chord };
}

/**
 * A model-written plan, made safe to run or refused: every step outside the rules is dropped with
 * its reason, and a plan with anything dropped does not run at all (a half plan would type into
 * whatever window its missing first step should have opened). The rules, from docs/07:
 *   - only PLANNER_STEP_KINDS: no `mouse` coordinate, no `url`, no `say`, nothing that runs a path;
 *   - `launch` names a catalogue entry and is rewritten to that entry's exact name; never a shell;
 *   - `focus`, `place`, `uiaClick` name a window by title words, never a shell's or a sign-in's;
 *   - `uiaClick` never presses a control that answers a dialog or closes something;
 *   - `keys` is text (at most PLANNER_MAX_TEXT) or a chord that `plannerChord` accepts;
 *   - `wait` is clamped to PLANNER_MAX_WAIT_MS;
 *   - at most MAX_PLAN_STEPS: a longer plan is refused whole, never cut short.
 */
export function normalisePlan(raw: unknown, ctx: NormaliseContext): NormalisedPlan {
  const steps: DesktopStep[] = [];
  const dropped: string[] = [];
  if (raw === undefined || raw === null) return { steps, dropped };
  if (!Array.isArray(raw)) return { steps, dropped: ['the steps were not a list'] };
  raw.forEach((item, i) => {
    const drop = (why: string): void => { dropped.push(`step ${i + 1}: ${why}`); };
    if (!item || typeof item !== 'object' || Array.isArray(item)) { drop('not a step'); return; }
    const o = item as Record<string, unknown>;
    const kind = typeof o['kind'] === 'string' ? o['kind'] : '';
    if (!(PLANNER_STEP_KINDS as readonly string[]).includes(kind)) { drop(`"${clip(kind, 30) || 'no kind'}" is not a step the planner may use`); return; }
    switch (kind) {
      case 'launch': {
        const name = clip(o['app'], 120);
        if (!name) { drop('a launch with no program'); return; }
        if (SHELL_WORDS.test(name) || PATHLIKE.test(name)) { drop(`${name} is a shell or a path, which a planned step never opens`); return; }
        const app = matchApp(name, ctx.apps);
        if (!app) { drop(`${name} is not in the Start Menu catalogue`); return; }
        if (SHELL_WORDS.test(app.name) || PLANNER_NEVER_LAUNCH.test(app.name)) { drop(`${app.name} takes typed commands or changes the system, which a planned step never opens`); return; }
        const monitor = monitorIn(o['monitor'], ctx.monitors);
        const layout = layoutOf(o['layout']);
        steps.push({ kind: 'launch', app: app.name, ...(monitor ? { monitor } : {}), ...(layout ? { layout } : {}) });
        return;
      }
      case 'focus':
      case 'place':
      case 'uiaClick': {
        const window = clip(o['window'], 120);
        if (!window) { drop(`a ${kind} with no window`); return; }
        if (SHELL_WORDS.test(window)) { drop(`${window} is a shell window, which a planned step never touches`); return; }
        if (isSensitiveTitle(window)) { drop(`${window} looks like a sign-in window`); return; }
        if (kind === 'focus') { steps.push({ kind: 'focus', window }); return; }
        if (kind === 'place') {
          const monitor = monitorIn(o['monitor'], ctx.monitors);
          if (!monitor) { drop(`moving ${window} needs a monitor from one to ${monitorWord(Math.max(1, ctx.monitors))}`); return; }
          const layout = layoutOf(o['layout']);
          steps.push({ kind: 'place', window, monitor, ...(layout ? { layout } : {}) });
          return;
        }
        const control = clip(o['control'], 80);
        if (!control) { drop(`a click in ${window} with no control name`); return; }
        if (DIALOG_ANSWERS.test(control.replace(/[.…!]+$/, '').trim())) { drop(`"${control}" answers a dialog or closes something, which is yours to press`); return; }
        const type = controlTypeOf(o['type']);
        steps.push({ kind: 'uiaClick', window, control, ...(type ? { type } : {}) });
        return;
      }
      case 'keys': {
        const combo = typeof o['combo'] === 'string' ? o['combo'].trim() : '';
        const typed = typeof o['text'] === 'string' ? o['text'] : '';
        if (combo && typed) { drop('a keys step with both text and a combination'); return; }
        if (combo) {
          const ok = plannerChord(combo);
          if (!ok.ok) { drop(ok.why); return; }
          steps.push({ kind: 'keys', combo: ok.chord });
          return;
        }
        // eslint-disable-next-line no-control-regex
        const clean = typed.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '');
        if (!clean) { drop('a keys step with nothing to type'); return; }
        if (clean.length > PLANNER_MAX_TEXT) { drop(`${clean.length} characters to type; a planned step types at most ${PLANNER_MAX_TEXT}`); return; }
        steps.push({ kind: 'keys', text: clean });
        return;
      }
      case 'wait': {
        const ms = typeof o['ms'] === 'number' && Number.isFinite(o['ms']) ? o['ms'] : NaN;
        if (Number.isNaN(ms)) { drop('a wait with no length'); return; }
        steps.push({ kind: 'wait', ms: Math.round(Math.max(0, Math.min(PLANNER_MAX_WAIT_MS, ms))) });
        return;
      }
    }
  });
  if (steps.length > MAX_PLAN_STEPS) {
    return { steps: [], dropped: [...dropped, `the plan is ${steps.length} steps; a spoken plan stops at ${MAX_PLAN_STEPS}, so none of it runs`] };
  }
  return { steps, dropped };
}

/**
 * The desktop helper: one hidden PowerShell process that reads JSON lines on stdin and answers one
 * JSON line each on stdout. Every string it receives is DATA: paths go to Start-Process as a
 * parameter, text goes to SendInput one UTF-16 unit at a time, and nothing is ever evaluated.
 * It is a separate process from the read-only window tracker (services/window-tracker.ts), whose
 * test forbids it every verb below. Exported so its tests can hold it to that.
 */
export function desktopScript(): string {
  return `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class SkyDeskWin { public long H; public string Title; public int Pid; public int L, T, R, B; public bool Min; public bool Fg; }
public static class SkyDesk {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION u; }
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  public static void Aware() {
    try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch { }
    try { SetProcessDPIAware(); } catch { }
  }
  public static List<SkyDeskWin> List() {
    var list = new List<SkyDeskWin>();
    IntPtr fg = GetForegroundWindow();
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      int n = GetWindowTextLength(h);
      if (n == 0) return true;
      var sb = new StringBuilder(n + 1);
      GetWindowTextW(h, sb, sb.Capacity);
      RECT r; GetWindowRect(h, out r);
      uint pid; GetWindowThreadProcessId(h, out pid);
      list.Add(new SkyDeskWin { H = h.ToInt64(), Title = sb.ToString(), Pid = (int)pid, L = r.L, T = r.T, R = r.R, B = r.B, Min = IsIconic(h), Fg = (h == fg) });
      return true;
    }, IntPtr.Zero);
    return list;
  }
  public static bool Place(long h, int x, int y, int w, int hh) {
    IntPtr p = new IntPtr(h);
    ShowWindow(p, 9);
    return SetWindowPos(p, IntPtr.Zero, x, y, w, hh, 0x0040);
  }
  public static bool Focus(long h) {
    IntPtr p = new IntPtr(h);
    ShowWindow(p, 9);
    return SetForegroundWindow(p);
  }
  public static POINT Cursor() { POINT p; GetCursorPos(out p); return p; }
  public static void MoveTo(int x, int y) { SetCursorPos(x, y); }
  static void Mouse(uint flags) {
    var inp = new INPUT[1];
    inp[0].type = 0; inp[0].u.mi.dwFlags = flags;
    SendInput(1, inp, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void Click(string button) {
    if (button == "right") { Mouse(0x0008); Mouse(0x0010); return; }
    Mouse(0x0002); Mouse(0x0004);
    if (button == "double") { System.Threading.Thread.Sleep(80); Mouse(0x0002); Mouse(0x0004); }
  }
  public static void Wheel(int delta) {
    var inp = new INPUT[1];
    inp[0].type = 0; inp[0].u.mi.dwFlags = 0x0800; inp[0].u.mi.mouseData = unchecked((uint)delta);
    SendInput(1, inp, Marshal.SizeOf(typeof(INPUT)));
  }
  static void Key(ushort vk, ushort scan, uint flags) {
    var inp = new INPUT[1];
    inp[0].type = 1; inp[0].u.ki.wVk = vk; inp[0].u.ki.wScan = scan; inp[0].u.ki.dwFlags = flags;
    SendInput(1, inp, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void Type(string text) {
    foreach (char c in text) {
      Key(0, c, 0x0004);
      Key(0, c, 0x0004 | 0x0002);
      System.Threading.Thread.Sleep(12);
    }
  }
  public static void Combo(ushort[] vks) {
    foreach (ushort vk in vks) Key(vk, 0, 0);
    System.Threading.Thread.Sleep(30);
    for (int i = vks.Length - 1; i >= 0; i--) Key(vks[i], 0, 0x0002);
  }
}
'@
[SkyDesk]::Aware()
# ── TRAIN ACTION: the recorder (docs/07 § JARVIS Voice) ─────────────────────────────────────────
# UI Automation is a .NET Framework assembly, which is why this helper stays on powershell.exe.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
$recRefs = @([System.Windows.Automation.AutomationElement].Assembly.Location, [System.Windows.Automation.ControlType].Assembly.Location, [System.Windows.Point].Assembly.Location)
Add-Type -ReferencedAssemblies $recRefs -TypeDefinition @'
using System;
using System.Text;
using System.Threading;
using System.Diagnostics;
using System.Globalization;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Windows.Automation;
// Records the mouse and keyboard while TRAIN ACTION is lit, and nothing while it is not.
// A low-level mouse hook thread takes clicks, wheel and (decimated) moves; a polling thread
// takes key-down edges; a worker thread does the UI Automation lookups so the hook callback
// always returns at once. Every event is one JSON line on stdout, prefixed {"rec": ...}.
// Over a window whose title looks like a sign-in, nothing is captured but a "paused" marker.
public static class SkyRec {
  delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct MSLL { public POINT pt; public uint mouseData, flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public POINT pt; }
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int id, HookProc cb, IntPtr mod, uint tid);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint min, uint max);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG m);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG m);
  [DllImport("user32.dll")] static extern bool PostThreadMessage(uint tid, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] static extern short GetKeyState(int vk);
  [DllImport("user32.dll")] static extern int ToUnicode(uint vk, uint scan, byte[] state, StringBuilder sb, int n, uint flags);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  static readonly string DQ = ((char)34).ToString();
  static readonly object gate = new object();
  static readonly Regex sensitive = new Regex("password|passcode|sign[ -]?in|log[ -]?in|login|2fa|verification code", RegexOptions.IgnoreCase);
  static volatile bool running;
  static Thread hookThread, keyThread, workThread;
  static HookProc keep;
  static IntPtr hook;
  static uint hookTid;
  static Stopwatch clock;
  static long lastPausedAt = -10000;
  static int lastMx = int.MinValue, lastMy = int.MinValue;
  static long lastMt = -1000;
  class Pending { public string kind; public int x, y, delta; public long t; }
  static readonly ConcurrentQueue<Pending> pending = new ConcurrentQueue<Pending>();
  static readonly AutoResetEvent wake = new AutoResetEvent(false);
  static readonly Dictionary<int, string> names = new Dictionary<int, string> {
    {0x08,"backspace"},{0x09,"tab"},{0x0D,"enter"},{0x13,"pause"},{0x1B,"escape"},{0x20,"space"},{0x21,"pageup"},{0x22,"pagedown"},
    {0x23,"end"},{0x24,"home"},{0x25,"left"},{0x26,"up"},{0x27,"right"},{0x28,"down"},{0x2C,"printscreen"},{0x2D,"insert"},{0x2E,"delete"}
  };
  static long T() { return clock == null ? 0 : clock.ElapsedMilliseconds; }
  public static bool Running() { return running; }
  public static string J(string s) {
    var sb = new StringBuilder(); sb.Append(DQ);
    if (s != null) foreach (char c in s) {
      if (c == (char)34 || c == (char)92) { sb.Append((char)92); sb.Append(c); }
      else if (c < (char)32) { sb.Append((char)92); sb.Append('u'); sb.Append(((int)c).ToString("x4")); }
      else sb.Append(c);
    }
    sb.Append(DQ); return sb.ToString();
  }
  static string K(string k) { return J(k) + ":"; }
  static string N(double v) { if (double.IsNaN(v) || double.IsInfinity(v)) v = 0; return Math.Round(v, 4).ToString(CultureInfo.InvariantCulture); }
  static void Emit(string body) { lock (gate) { Console.Out.WriteLine("{" + K("rec") + body + "}"); Console.Out.Flush(); } }
  public static string FgTitle() { var sb = new StringBuilder(512); GetWindowTextW(GetForegroundWindow(), sb, 512); return sb.ToString(); }
  public static string FgProcess() { uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); try { return Process.GetProcessById((int)pid).ProcessName; } catch { return ""; } }
  static bool Paused() {
    string title = FgTitle();
    if (!sensitive.IsMatch(title)) return false;
    long now = T();
    if (now - lastPausedAt > 1000) { lastPausedAt = now; Emit("{" + K("t") + now + "," + K("kind") + J("paused") + "," + K("reason") + J("a window that looks like a sign-in: " + title) + "}"); }
    return true;
  }
  public static bool Start() {
    if (running) return false;
    running = true; clock = Stopwatch.StartNew(); lastPausedAt = -10000; lastMx = int.MinValue; lastMy = int.MinValue; lastMt = -1000;
    hookThread = new Thread(HookLoop); hookThread.IsBackground = true; hookThread.Start();
    workThread = new Thread(WorkLoop); workThread.IsBackground = true; workThread.Start();
    keyThread = new Thread(KeyLoop); keyThread.IsBackground = true; keyThread.Start();
    return true;
  }
  public static bool Stop() {
    if (!running) return false;
    running = false;
    if (hookTid != 0) PostThreadMessage(hookTid, 0x0012, IntPtr.Zero, IntPtr.Zero);
    try { if (hookThread != null) hookThread.Join(1500); if (keyThread != null) keyThread.Join(500); wake.Set(); if (workThread != null) workThread.Join(3000); } catch { }
    hookTid = 0;
    return true;
  }
  static void HookLoop() {
    hookTid = GetCurrentThreadId();
    keep = new HookProc(MouseProc);
    hook = SetWindowsHookEx(14, keep, GetModuleHandle(null), 0);
    MSG m;
    while (running && GetMessage(out m, IntPtr.Zero, 0, 0) > 0) { TranslateMessage(ref m); DispatchMessage(ref m); }
    if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
    hook = IntPtr.Zero;
  }
  static IntPtr MouseProc(int code, IntPtr w, IntPtr l) {
    if (code >= 0 && running) {
      try {
        MSLL s = (MSLL)Marshal.PtrToStructure(l, typeof(MSLL));
        int msg = w.ToInt32(); long t = T();
        if (msg == 0x0200) {
          if (Math.Abs(s.pt.X - lastMx) + Math.Abs(s.pt.Y - lastMy) >= 8 || t - lastMt >= 50) {
            lastMx = s.pt.X; lastMy = s.pt.Y; lastMt = t;
            pending.Enqueue(new Pending { kind = "move", x = s.pt.X, y = s.pt.Y, t = t }); wake.Set();
          }
        }
        else if (msg == 0x0201) { pending.Enqueue(new Pending { kind = "click", x = s.pt.X, y = s.pt.Y, t = t }); wake.Set(); }
        else if (msg == 0x0204) { pending.Enqueue(new Pending { kind = "rightclick", x = s.pt.X, y = s.pt.Y, t = t }); wake.Set(); }
        else if (msg == 0x020A) { int delta = (short)((s.mouseData >> 16) & 0xffff); pending.Enqueue(new Pending { kind = "wheel", x = s.pt.X, y = s.pt.Y, t = t, delta = delta }); wake.Set(); }
      } catch { }
    }
    return CallNextHookEx(hook, code, w, l);
  }
  static void WorkLoop() {
    while (running || !pending.IsEmpty) {
      Pending p;
      while (pending.TryDequeue(out p)) {
        if (p.kind == "move") { Emit("{" + K("t") + p.t + "," + K("kind") + J("move") + "," + K("x") + p.x + "," + K("y") + p.y + "}"); continue; }
        if (p.kind == "wheel") { Emit("{" + K("t") + p.t + "," + K("kind") + J("wheel") + "," + K("x") + p.x + "," + K("y") + p.y + "," + K("delta") + p.delta + "}"); continue; }
        if (Paused()) continue;
        Emit(ClickJson(p));
      }
      wake.WaitOne(100);
    }
  }
  static string ClickJson(Pending p) {
    string name = "", type = "", cls = ""; double l = 0, tp = 0, wd = 0, ht = 0;
    try {
      var el = AutomationElement.FromPoint(new System.Windows.Point(p.x, p.y));
      if (el != null) {
        name = el.Current.Name ?? ""; type = el.Current.ControlType.ProgrammaticName ?? ""; cls = el.Current.ClassName ?? "";
        var r = el.Current.BoundingRectangle;
        if (!r.IsEmpty) { l = r.Left; tp = r.Top; wd = r.Width; ht = r.Height; }
      }
    } catch { }
    RECT wr; GetWindowRect(GetForegroundWindow(), out wr);
    double relX = wd > 0 ? (p.x - l) / wd : 0.5, relY = ht > 0 ? (p.y - tp) / ht : 0.5;
    relX = Math.Max(0, Math.Min(1, relX)); relY = Math.Max(0, Math.Min(1, relY));
    return "{" + K("t") + p.t + "," + K("kind") + J(p.kind) + "," + K("x") + p.x + "," + K("y") + p.y + "," + K("target") + "{"
      + K("process") + J(FgProcess()) + "," + K("windowTitle") + J(FgTitle()) + "," + K("controlName") + J(name) + "," + K("controlType") + J(type) + "," + K("className") + J(cls)
      + "," + K("rect") + "[" + (int)l + "," + (int)tp + "," + (int)wd + "," + (int)ht + "]," + K("relX") + N(relX) + "," + K("relY") + N(relY)
      + "," + K("windowRect") + "[" + wr.L + "," + wr.T + "," + (wr.R - wr.L) + "," + (wr.B - wr.T) + "]," + K("monitor") + "0}}";
  }
  static bool IsModifier(int vk) { return vk == 0x10 || vk == 0x11 || vk == 0x12 || (vk >= 0xA0 && vk <= 0xA5) || vk == 0x5B || vk == 0x5C || vk == 0x14 || vk == 0x90 || vk == 0x91; }
  static void KeyLoop() {
    var prev = new bool[256];
    for (int vk = 0; vk < 256; vk++) prev[vk] = (GetAsyncKeyState(vk) & 0x8000) != 0;
    var state = new byte[256]; var sb = new StringBuilder(8);
    while (running) {
      for (int vk = 8; vk < 255; vk++) {
        bool down = (GetAsyncKeyState(vk) & 0x8000) != 0;
        bool was = prev[vk]; prev[vk] = down;
        if (!down || was || IsModifier(vk) || vk == 1 || vk == 2 || vk == 4 || vk == 5 || vk == 6) continue;
        if (Paused()) continue;
        bool ctrl = (GetAsyncKeyState(0x11) & 0x8000) != 0, alt = (GetAsyncKeyState(0x12) & 0x8000) != 0, shift = (GetAsyncKeyState(0x10) & 0x8000) != 0;
        bool win = ((GetAsyncKeyState(0x5B) | GetAsyncKeyState(0x5C)) & 0x8000) != 0;
        long t = T();
        string nm; names.TryGetValue(vk, out nm);
        if (nm == null && vk >= 0x70 && vk <= 0x87) nm = "f" + (vk - 0x6F);
        uint scan = MapVirtualKey((uint)vk, 0);
        if (ctrl || alt || win || (nm != null && nm != "space")) {
          string key = nm;
          if (key == null) { Array.Clear(state, 0, 256); sb.Length = 0; int n = ToUnicode((uint)vk, scan, state, sb, 8, 4); key = n > 0 ? sb.ToString(0, 1).ToLowerInvariant() : "vk" + vk; }
          string chord = (ctrl ? "ctrl+" : "") + (alt ? "alt+" : "") + (shift ? "shift+" : "") + (win ? "win+" : "") + key;
          Emit("{" + K("t") + t + "," + K("kind") + J("key") + "," + K("keys") + J(chord) + "}");
          continue;
        }
        Array.Clear(state, 0, 256);
        if (shift) state[0x10] = 0x80;
        if ((GetKeyState(0x14) & 1) != 0) state[0x14] = 1;
        sb.Length = 0;
        int got = ToUnicode((uint)vk, scan, state, sb, 8, 4);
        if (got > 0) { string s = sb.ToString(0, got); foreach (char c in s) Emit("{" + K("t") + t + "," + K("kind") + J("char") + "," + K("ch") + J(c.ToString()) + "}"); }
      }
      Thread.Sleep(8);
    }
  }
  static ControlType TypeByName(string prog) {
    if (string.IsNullOrEmpty(prog)) return null;
    foreach (var f in typeof(ControlType).GetFields(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static)) {
      var ct = f.GetValue(null) as ControlType;
      if (ct != null && ct.ProgrammaticName == prog) return ct;
    }
    return null;
  }
  // The element called name (and of type, when known) inside window h, now: "l,t,w,h" or "".
  // The lookup runs on its own thread so a slow tree costs at most budgetMs.
  public static string Find(long h, string name, string type, int budgetMs) {
    string result = "";
    var th = new Thread(delegate () {
      try {
        var root = AutomationElement.FromHandle(new IntPtr(h));
        Condition byName = new PropertyCondition(AutomationElement.NameProperty, name, PropertyConditionFlags.IgnoreCase);
        ControlType ct = TypeByName(type);
        AutomationElement el = null;
        if (ct != null) el = root.FindFirst(TreeScope.Descendants, new AndCondition(byName, new PropertyCondition(AutomationElement.ControlTypeProperty, ct)));
        if (el == null) el = root.FindFirst(TreeScope.Descendants, byName);
        if (el != null) { var r = el.Current.BoundingRectangle; if (!r.IsEmpty) result = ((int)r.Left) + "," + ((int)r.Top) + "," + ((int)r.Width) + "," + ((int)r.Height); }
      } catch { }
    });
    th.IsBackground = true; th.Start();
    if (!th.Join(Math.Max(200, budgetMs))) return "";
    return result;
  }
}
'@
$vk = @{ ctrl = 0x11; control = 0x11; alt = 0x12; shift = 0x10; win = 0x5B; enter = 0x0D; return = 0x0D; tab = 0x09; esc = 0x1B; escape = 0x1B; space = 0x20; backspace = 0x08; delete = 0x2E; del = 0x2E; up = 0x26; down = 0x28; left = 0x25; right = 0x27; home = 0x24; end = 0x23; pageup = 0x21; pagedown = 0x22 }
for ($i = 1; $i -le 12; $i++) { $vk["f$i"] = 0x6F + $i }
$refused = @('alt+f4', 'ctrl+alt+delete', 'ctrl+alt+del', 'win+l', 'ctrl+shift+esc', 'ctrl+shift+escape', 'win', 'win+r', 'win+x')
function Out-Line($obj) { [Console]::Out.WriteLine((ConvertTo-Json -InputObject $obj -Compress -Depth 4)); [Console]::Out.Flush() }
Out-Line @{ ready = $true }
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.Trim()) { continue }
  try {
    $req = ConvertFrom-Json -InputObject $line
    $id = $req.id
    switch ($req.op) {
      'ping' { Out-Line @{ id = $id; ok = $true; pong = $true } }
      'windows' {
        $wins = [SkyDesk]::List()
        $procs = @{}
        $out = New-Object System.Collections.Generic.List[object]
        foreach ($w in $wins) {
          if (-not $procs.ContainsKey($w.Pid)) { $p = Get-Process -Id $w.Pid -ErrorAction SilentlyContinue; $procs[$w.Pid] = $(if ($p) { $p.ProcessName } else { '' }) }
          $out.Add(@{ h = $w.H; title = $w.Title; pid = $w.Pid; process = $procs[$w.Pid]; x = $w.L; y = $w.T; w = ($w.R - $w.L); h2 = ($w.B - $w.T); min = $w.Min; fg = $w.Fg })
        }
        Out-Line @{ id = $id; ok = $true; windows = $out.ToArray() }
      }
      'lnk' {
        $sh = New-Object -ComObject WScript.Shell
        $sc = $sh.CreateShortcut([string]$req.path)
        Out-Line @{ id = $id; ok = $true; target = [string]$sc.TargetPath }
      }
      'launch' {
        $path = [string]$req.path
        if ($req.args -and @($req.args).Count -gt 0) { $p = Start-Process -FilePath $path -ArgumentList @($req.args | ForEach-Object { [string]$_ }) -PassThru }
        else { $p = Start-Process -FilePath $path -PassThru }
        Out-Line @{ id = $id; ok = $true; pid = $(if ($p) { $p.Id } else { 0 }) }
      }
      'place' { Out-Line @{ id = $id; ok = [SkyDesk]::Place([long]$req.h, [int]$req.x, [int]$req.y, [int]$req.w, [int]$req.height) } }
      'focus' { Out-Line @{ id = $id; ok = [SkyDesk]::Focus([long]$req.h) } }
      'mouse' {
        $from = [SkyDesk]::Cursor()
        $ms = [Math]::Max(0, [int]$req.travelMs)
        $steps = [Math]::Max(1, [int]($ms / 16))
        for ($s = 1; $s -le $steps; $s++) {
          $t = $s / $steps
          $e = $t * $t * (3 - 2 * $t)
          [SkyDesk]::MoveTo([int]($from.X + ([int]$req.x - $from.X) * $e), [int]($from.Y + ([int]$req.y - $from.Y) * $e))
          Start-Sleep -Milliseconds 16
        }
        [SkyDesk]::MoveTo([int]$req.x, [int]$req.y)
        Out-Line @{ id = $id; ok = $true }
      }
      'click' { [SkyDesk]::Click([string]$req.button); Out-Line @{ id = $id; ok = $true } }
      'keys' { [SkyDesk]::Type([string]$req.text); Out-Line @{ id = $id; ok = $true } }
      'combo' {
        $names = @($req.keys | ForEach-Object { ([string]$_).ToLower() })
        $joined = ($names | Sort-Object) -join '+'
        $bad = $refused | Where-Object { (($_ -split '\\+') | Sort-Object) -join '+' -eq $joined }
        if ($bad) { Out-Line @{ id = $id; ok = $false; error = 'REFUSED — THAT COMBINATION CLOSES OR LOCKS THE MACHINE, WHICH IS YOURS TO DO' } }
        else {
          $codes = New-Object System.Collections.Generic.List[uint16]
          foreach ($n in $names) {
            if ($vk.ContainsKey($n)) { $codes.Add([uint16]$vk[$n]) }
            elseif ($n.Length -eq 1) { $codes.Add([uint16][char]$n.ToUpper()) }
            else { throw "unknown key $n" }
          }
          [SkyDesk]::Combo($codes.ToArray())
          Out-Line @{ id = $id; ok = $true }
        }
      }
      'record' {
        if ($req.on) { $started = [SkyRec]::Start(); Out-Line @{ id = $id; ok = $true; recording = [SkyRec]::Running(); started = $started } }
        else { [SkyRec]::Stop() | Out-Null; Out-Line @{ id = $id; ok = $true; recording = $false } }
      }
      'recstatus' { Out-Line @{ id = $id; ok = $true; recording = [SkyRec]::Running() } }
      'uiafind' {
        $found = [SkyRec]::Find([long]$req.h, [string]$req.name, [string]$req.type, [int]$req.budgetMs)
        if ($found) { $p = $found -split ','; Out-Line @{ id = $id; ok = $true; found = $true; rect = @([int]$p[0], [int]$p[1], [int]$p[2], [int]$p[3]) } }
        else { Out-Line @{ id = $id; ok = $true; found = $false } }
      }
      'wheel' { [SkyDesk]::Wheel([int]$req.delta); Out-Line @{ id = $id; ok = $true } }
      'fgtitle' { Out-Line @{ id = $id; ok = $true; title = [SkyRec]::FgTitle(); process = [SkyRec]::FgProcess() } }
      default { Out-Line @{ id = $id; ok = $false; error = "unknown op" } }
    }
  } catch {
    Out-Line @{ id = $(if ($req) { $req.id } else { $null }); ok = $false; error = [string]$_.Exception.Message }
  }
}
`;
}

/* ────────────────────────── reaching into a window (2026-09-27) ────────────────────────── */
/*
 * William: "Jarvis, hit play on the video in my firefox browser … intelligently use my mouse to
 * select the firefox window, then hit spacebar." Four rule-grammar sentences that need no model:
 *
 *   press|hit <key or phrase> in <app>      focus by pointer, then a chord
 *   scroll (up|down) [amount] in <app>      focus by pointer, then the wheel
 *   click <control> in <app>                focus by pointer, then a control by UI Automation name
 *   type <text> in(to) <app>                focus by pointer, then the text
 *
 * Every plan is exactly two steps: a `focus` with `focusByPointer` (the pointer travels visibly
 * to the window's centre; its title bar is clicked only when Windows refuses the foreground), and
 * the action. Nothing else. `<app>` is matched at RUN time against the windows that are open
 * (`pickWindow`): a process name ("firefox", "notepad"), a title token (a chip's "JARVIS-TQR"),
 * "my browser" (the default browser's process), or "the terminal". The same refusals as every
 * other plan: no chord `plannerChord` refuses, no control that answers a dialog, never a sign-in
 * window, and never typing into a shell (here by name, and again at run time by process).
 */

/** Browser processes, in the order `defaultBrowser` prefers them. */
export const BROWSER_PROCESSES = ['firefox', 'chrome', 'msedge', 'brave', 'opera', 'vivaldi'] as const;
/** What "the terminal" can be: a terminal host or a shell with its own console. */
export const TERMINAL_PROCESSES = ['windowsterminal', 'wt', 'cmd', 'powershell', 'pwsh', 'conhost', 'openconsole', 'mintty', 'wezterm-gui', 'alacritty'] as const;
/** SkynetOS's own windows (the board, the JARVIS window) are never a reaching target. */
const OWN_PROCESSES = /^(?:skynetos|electron)$/i;

/** Spoken program names to the process Windows reports, where the two differ. */
const PROCESS_ALIASES: Record<string, readonly string[]> = {
  edge: ['msedge'], 'microsoft edge': ['msedge'], 'google chrome': ['chrome'], chrome: ['chrome'],
  'vs code': ['code'], vscode: ['code'], 'visual studio code': ['code'], code: ['code'],
  word: ['winword'], 'microsoft word': ['winword'], excel: ['excel'], powerpoint: ['powerpnt'],
  outlook: ['outlook', 'olk'], obs: ['obs64', 'obs32', 'obs'], 'obs studio': ['obs64'],
  'file explorer': ['explorer'], explorer: ['explorer'], 'after effects': ['afterfx'],
  premiere: ['adobe premiere pro'], 'premiere pro': ['adobe premiere pro'], photoshop: ['photoshop'],
  discord: ['discord'], spotify: ['spotify'], notepad: ['notepad'], steam: ['steam'], vlc: ['vlc']
};

export interface WindowTarget {
  /** What `pickWindow` matches at run time: `browser`, `terminal`, or the spoken words. */
  window: string;
  /** How JARVIS says it: "Firefox", "your browser", "the terminal", "JARVIS-TQR". */
  label: string;
  kind: 'browser' | 'terminal' | 'named';
}

const targetWords = (text: string): string[] =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && !/^(?:the|my|a|an|window|app)$/.test(w));

const titleCase = (text: string): string => text.replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** A spoken "<app>" to what the helper will look for, or null when there is nothing to look for. */
export function windowTarget(spoken: string, apps: readonly AppEntry[] = []): WindowTarget | null {
  let t = spoken.toLowerCase().replace(/[^a-z0-9+ -]+/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(?:my|the|a|an|that|this|our)\s+/, '').trim();
  if (/^(?:web |internet )?browser$|^internet$/.test(t)) {
    const hit = defaultBrowser(apps);
    return { window: 'browser', label: hit ? displayName(hit.name) : 'your browser', kind: 'browser' };
  }
  t = t.replace(/\s+(?:window|app|application|program|browser|tab)$/, '').replace(/^(?:my|the)\s+/, '').trim();
  if (!t || /^(?:the|my|a|an|that|this|it|there|here|window|app)$/.test(t)) return null;
  if (/^(?:terminal|windows terminal|command prompt|cmd|powershell|console|shell|command line)$/.test(t)) {
    return { window: 'terminal', label: 'the terminal', kind: 'terminal' };
  }
  const app = matchApp(t, apps);
  const shown = app ? displayName(app.name) : '';
  const label = shown ? (shown === shown.toLowerCase() ? titleCase(shown) : shown) : /[0-9-]/.test(t) || t.length <= 4 ? t.toUpperCase() : titleCase(t);
  return { window: t, label, kind: 'named' };
}

export interface PickableWindow {
  h: number;
  title: string;
  process: string;
  /** Physical size, as the helper's `windows` reports it. */
  w: number;
  h2: number;
  min?: boolean;
  fg?: boolean;
}

export interface PickOptions {
  /** The default browser's process name, for `browser`. */
  preferredBrowser?: string;
  /** A small bonus among equals: a chip's session window over a page that mentions its name. */
  prefer?: (title: string, process: string) => boolean;
}

/**
 * The open window a target means, or null. Scored, not first-found: an exact process name (or
 * its alias) beats a window whose title holds every spoken word, which beats a process that only
 * starts with them. Among equals the helper's order wins, and that order is Windows' Z-order, so
 * the most recently active window is taken. SkynetOS's own windows and tool slivers are skipped.
 */
export function pickWindow<T extends PickableWindow>(target: string, windows: readonly T[], opts: PickOptions = {}): T | null {
  const all = targetWords(target);
  // "firefox browser", "notepad window": the kind word goes when a name comes with it.
  const words = all.length > 1 ? all.filter((w) => !/^(?:browser|program|application)$/.test(w)) : all;
  if (!words.length) return null;
  const joined = words.join(' ');
  const compact = words.join('');
  const aliases = PROCESS_ALIASES[joined] ?? [];
  let best: { win: T; score: number } | null = null;
  for (const win of windows) {
    const proc = (win.process ?? '').toLowerCase();
    if (!win.title || OWN_PROCESSES.test(proc)) continue;
    if (!win.min && (win.w < 200 || win.h2 < 120)) continue;
    let score = 0;
    if (joined === 'browser') {
      if ((BROWSER_PROCESSES as readonly string[]).includes(proc)) score = 50 + (opts.preferredBrowser && proc === opts.preferredBrowser.toLowerCase() ? 10 : 0);
    } else if (joined === 'terminal') {
      if ((TERMINAL_PROCESSES as readonly string[]).includes(proc)) score = 50;
    } else {
      const titleTokens = new Set(win.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean));
      if (proc === compact || aliases.includes(proc)) score = 60;
      else if (words.every((w) => titleTokens.has(w))) score = 40 + Math.min(10, words.length);
      else if (compact.length >= 3 && proc.startsWith(compact)) score = 30;
    }
    if (!score) continue;
    if (opts.prefer?.(win.title, proc)) score += 5;
    if (!best || score > best.score) best = { win, score };
  }
  return best?.win ?? null;
}

/**
 * Where a title-bar click lands, in the window's own (physical) coordinates: a caption row near
 * the top, left of the minimise/maximise/close buttons and of a browser's tab-list button, so the
 * click activates the window without pressing anything in it. A narrow window gets its centre.
 */
export function titleBarPoint(rect: Rect, scale = 1): { x: number; y: number } {
  const s = scale > 0 ? scale : 1;
  const y = rect.y + Math.round(Math.min(Math.max(4, rect.height / 4), 10 * s));
  const fromRight = Math.round(200 * s);
  const x = rect.width > fromRight * 2 ? rect.x + rect.width - fromRight : rect.x + Math.round(rect.width / 2);
  return { x, y };
}

/** Phrases for the keys a video, a page or a player understands. */
const MEDIA_KEYS: Record<string, { combo: string; label: string }> = {
  play: { combo: 'space', label: 'Play' },
  pause: { combo: 'space', label: 'Pause' },
  'play pause': { combo: 'space', label: 'Play/pause' },
  'play or pause': { combo: 'space', label: 'Play/pause' },
  resume: { combo: 'space', label: 'Play' },
  unpause: { combo: 'space', label: 'Play' },
  mute: { combo: 'm', label: 'Mute' },
  unmute: { combo: 'm', label: 'Unmute' },
  fullscreen: { combo: 'f', label: 'Fullscreen' },
  'full screen': { combo: 'f', label: 'Fullscreen' },
  'exit fullscreen': { combo: 'f', label: 'Fullscreen off' },
  'exit full screen': { combo: 'f', label: 'Fullscreen off' },
  next: { combo: 'shift+n', label: 'Next' },
  'next video': { combo: 'shift+n', label: 'Next' },
  skip: { combo: 'shift+n', label: 'Next' },
  back: { combo: 'alt+left', label: 'Back' },
  'go back': { combo: 'alt+left', label: 'Back' },
  'previous page': { combo: 'alt+left', label: 'Back' },
  forward: { combo: 'alt+right', label: 'Forward' },
  'go forward': { combo: 'alt+right', label: 'Forward' },
  refresh: { combo: 'f5', label: 'Refresh' },
  reload: { combo: 'f5', label: 'Refresh' }
};

const SPOKEN_KEYS: Record<string, string> = {
  control: 'ctrl', ctrl: 'ctrl', alt: 'alt', option: 'alt', shift: 'shift', windows: 'win', win: 'win', super: 'win',
  enter: 'enter', return: 'enter', escape: 'escape', esc: 'escape', tab: 'tab', space: 'space', spacebar: 'space',
  backspace: 'backspace', delete: 'delete', del: 'delete', up: 'up', down: 'down', left: 'left', right: 'right',
  home: 'home', end: 'end', pageup: 'pageup', pagedown: 'pagedown'
};

const F_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

/**
 * A spoken key or chord ("space bar", "control shift t", "ctrl+s", "f five", "page down") in the
 * helper's spelling, or null when a word is not a key. `plannerChord` then decides if it may be
 * pressed: the same refusals as a planned step.
 */
export function spokenChord(phrase: string): string | null {
  let t = ` ${phrase.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  t = t
    .replace(/ space bar /g, ' space ')
    .replace(/ page (up|down) /g, ' page$1 ')
    .replace(/ back space /g, ' backspace ')
    .replace(/ arrow (up|down|left|right) /g, ' $1 ')
    .replace(/ (up|down|left|right) arrow /g, ' $1 ')
    .replace(/ f (\d{1,2}) /g, ' f$1 ')
    .replace(/ f (one|two|three|five|six|seven|eight|nine|ten|eleven|twelve) /g, (_m, n: string) => ` f${F_WORDS[n]} `);
  // Twice: a separator word removed leaves its neighbour's space shared with the next one.
  for (let i = 0; i < 2; i++) t = t.replace(/ (?:plus|and|then|key|keys|the|letter|button) /g, ' ');
  const parts = t.trim().split(' ').filter(Boolean);
  if (!parts.length || parts.length > 4) return null;
  const keys: string[] = [];
  for (const p of parts) {
    const named = SPOKEN_KEYS[p];
    if (named) keys.push(named);
    else if (/^f(?:[1-9]|1[0-2])$/.test(p)) keys.push(p);
    else if (/^[a-z0-9]$/.test(p)) keys.push(p);
    else return null;
  }
  // A bare modifier is still a chord: "press the windows key" reaches plannerChord, which refuses it.
  return normaliseChord(keys.join('+'));
}

export type ReachParse = { plan: DesktopPlan } | { refuse: string };

const NOTCHES: Record<string, number> = {
  'a bit': 2, 'a little': 2, 'a little bit': 2, some: 4, more: 5, 'a lot': 10, lots: 10, way: 12, 'way more': 12, 'all the way': 20,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20
};

/** The words between the verb and " in(to) <app>" from what was actually said, case and punctuation kept. */
function rawBetween(raw: string, verbs: string): string | null {
  const cleaned = raw.replace(/[\s.!?]+$/, '').trim();
  const m = new RegExp(`\\b(?:${verbs})\\s+([\\s\\S]+)\\s+in(?:to)?\\s+[^\\s][\\s\\S]*$`, 'i').exec(cleaned);
  if (!m) return null;
  return m[1]!.replace(/^["'“‘]+|["'”’]+$/g, '').trim() || null;
}

function reachPlan(heard: string, target: WindowTarget, action: DesktopStep, reply: string): ReachParse {
  return { plan: { source: 'voice', heard, reply, steps: [{ kind: 'focus', window: target.window, focusByPointer: true }, action] } };
}

function clickPlan(raw: string, spokenControl: string, target: WindowTarget): ReachParse | null {
  const clean = (s: string): string => s.replace(/ (?:button|link|tab|menu|icon|option|item)$/i, '').replace(/^(?:on )?(?:the|a|an) /i, '').trim();
  const fromRaw = rawBetween(raw, 'click on|double click|click|press|hit|push|tap');
  const control = clean(fromRaw ?? spokenControl);
  if (!control || control.length > 80) return null;
  if (DIALOG_ANSWERS.test(control.replace(/[.…!]+$/, '').trim())) return { refuse: `"${control}" answers a dialog or closes something, which is yours to press.` };
  return reachPlan(raw, target, { kind: 'uiaClick', window: FOREGROUND, control }, `${titleCase(control)} pressed in ${target.label}.`);
}

/**
 * "press|hit <key> in <app>", "scroll down in <app>", "click <control> in <app>", "type <text>
 * in <app>" to a two-step plan, or a refusal in words, or null when the sentence is none of them.
 * `text` is the normalised sentence (intent.ts's `stripPreamble`); `raw` is what was heard, for the
 * text to type and the control's name, which keep their case.
 */
export function parseReachCommand(text: string, raw: string, ctx: { apps: readonly AppEntry[] }): ReachParse | null {
  const t = text.trim();
  // The target is split at the LAST " in ", so "the sign in window" would leave only "window":
  // the sign-in check also reads everything after the FIRST " in(to) ".
  const afterFirstIn = /\s+in(?:to)?\s+(.+)$/.exec(t)?.[1] ?? '';
  const signIn = (spoken: string): boolean => isSensitiveTitle(spoken) || isSensitiveTitle(afterFirstIn);

  // ── scroll ───────────────────────────────────────────────────────────────────────────────
  const scroll = /^scroll (up|down)(?: (.+?))?(?: times| notches| clicks)? in(?:to)? (.+)$/.exec(t);
  if (scroll) {
    if (signIn(scroll[3]!)) return { refuse: 'That looks like a sign-in window; I do not reach into those.' };
    const target = windowTarget(scroll[3]!, ctx.apps);
    if (!target) return null;
    const amount = scroll[2] ? (NOTCHES[scroll[2]] ?? (/^\d+$/.test(scroll[2]) ? Number(scroll[2]) : undefined)) : 5;
    if (amount === undefined) return null;
    const notches = Math.max(1, Math.min(20, amount));
    return reachPlan(raw, target, { kind: 'scroll', direction: scroll[1] as 'up' | 'down', notches }, `Scrolled ${scroll[1]} in ${target.label}.`);
  }

  // ── press / hit: a key, a media phrase, or (failing both) a control by name ──────────────
  const press = /^(?:press|hit|push|tap|smash) (.+) in(?:to)? (.+)$/.exec(t);
  if (press) {
    if (signIn(press[2]!)) return { refuse: 'That looks like a sign-in window; I do not reach into those.' };
    const target = windowTarget(press[2]!, ctx.apps);
    if (!target) return null;
    const phrase = press[1]!
      .replace(/ (?:on|in|for) (?:the |this |that |my )?(?:video|page|player|tab|window|song|track|movie|stream|clip|it|this|that|youtube|netflix|twitch)$/, '')
      .replace(/ (?:button|key)$/, '')
      .replace(/^(?:the|a) /, '')
      .trim();
    const media = MEDIA_KEYS[phrase];
    const chord = media?.combo ?? spokenChord(phrase);
    if (chord) {
      const ok = plannerChord(chord);
      if (!ok.ok) return { refuse: `I will not press that: ${ok.why}.` };
      const label = media?.label ?? ok.chord;
      return reachPlan(raw, target, { kind: 'keys', combo: ok.chord }, `${label} in ${target.label}.`);
    }
    // Not a key: "press the subscribe button in firefox" is a click on a control by name.
    return clickPlan(raw, phrase, target);
  }

  // ── click ────────────────────────────────────────────────────────────────────────────────
  const click = /^(?:click|double click)(?: on)? (.+) in(?:to)? (.+)$/.exec(t);
  if (click) {
    if (signIn(click[2]!)) return { refuse: 'That looks like a sign-in window; I do not reach into those.' };
    const target = windowTarget(click[2]!, ctx.apps);
    if (!target) return null;
    return clickPlan(raw, click[1]!, target);
  }

  // ── type ─────────────────────────────────────────────────────────────────────────────────
  const type = /^(?:type|write) (.+) into (.+)$/.exec(t) ?? /^(?:type|write) (.+) in (.+)$/.exec(t);
  if (type) {
    // "type this into JARVIS-TQR" is a dictation target (intent.ts takes it first), never text.
    if (/^(?:this|that|it|what i say|what i m saying|for me)$/.test(type[1]!)) return null;
    if (signIn(type[2]!)) return { refuse: 'That looks like a sign-in window; I do not type into those.' };
    const target = windowTarget(type[2]!, ctx.apps);
    if (!target) return null;
    if (target.kind === 'terminal' || SHELL_WORDS.test(type[2]!)) return { refuse: 'I do not type into a shell; a typed line there would run.' };
    const typed = rawBetween(raw, 'type|write') ?? type[1]!;
    if (typed.length > PLANNER_MAX_TEXT) return { refuse: `That is ${typed.length} characters; I type at most ${PLANNER_MAX_TEXT} at a time.` };
    return reachPlan(raw, target, { kind: 'keys', text: typed }, `Typed it into ${target.label}.`);
  }
  return null;
}

/* ────────────────────────── side by side (2026-09-27, window-split.ts) ────────────────────────── */

/** The share of monitor one the terminal gets in a split; JARVIS takes the rest, on the right. */
export const SPLIT_RATIO = 0.62;

/**
 * "Put JARVIS-TQR on monitor one and sit beside it": the terminal on the left 62% of the work
 * area at full height, the JARVIS window in the remaining width on the right. Whole DIPs, no gap,
 * no overlap; the two widths always sum to the work area's.
 */
export function splitBounds(work: Rect, ratio: number = SPLIT_RATIO): { left: Rect; right: Rect } {
  const r = Math.max(0.3, Math.min(0.85, Number.isFinite(ratio) ? ratio : SPLIT_RATIO));
  const leftW = Math.round(work.width * r);
  return {
    left: { x: work.x, y: work.y, width: leftW, height: work.height },
    right: { x: work.x + leftW, y: work.y, width: work.width - leftW, height: work.height }
  };
}

/** A SkynetOS session window: "SkynetOS - U1 - JARVIS-TQR" (launch-script.ts writes it in ASCII). */
export function isSessionTitle(title: string): boolean {
  return /^SkynetOS\s+[-—]\s+/i.test(title);
}

/* ────────────────────────── dictation target and split: the channels' shapes ────────────────────────── */

/** `dictate:setTarget`: aim dictation at a window, press Enter there, clear it, or ask. User-only. */
export type DictateTargetRequest =
  | { op: 'set'; window: string; start?: boolean }
  | { op: 'clear' }
  | { op: 'enter' }
  | { op: 'status' };

export interface DictateTargetView {
  title: string;
  process: string;
  hwnd: number;
  /** What JARVIS calls it. */
  label: string;
}

export interface DictateTargetResult {
  ok: boolean;
  /** One line, spoken by the caller. */
  said: string;
  target: DictateTargetView | null;
  error?: string;
}

/** `hologram:split`: the named terminal left, JARVIS right, on monitor one; or back. User-only. */
export type HologramSplitRequest = { op: 'on'; window: string } | { op: 'off' };

export interface HologramSplitResult {
  ok: boolean;
  said: string;
  split: boolean;
  window?: string;
  error?: string;
}
