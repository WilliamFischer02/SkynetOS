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
}

export const DEFAULT_DESKTOP: DesktopSettings = {
  enabled: false,
  monitors: [],
  apps: {},
  stepDelayMs: 250,
  mouseTravelMs: 450
};

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
  | { kind: 'focus'; window: string }
  | { kind: 'url'; url: string; browser?: string; monitor?: number; site?: string }
  | { kind: 'mouse'; x: number; y: number; monitor?: number; click?: 'left' | 'right' | 'double' }
  | { kind: 'keys'; text?: string; combo?: string }
  | { kind: 'wait'; ms: number }
  | { kind: 'say'; text: string };

export interface DesktopPlan {
  /** Where the plan came from: a rule in intent.ts, a typed line, or the planner (slice 2). */
  source: 'voice' | 'typed' | 'planner';
  /** The sentence it answers, for the log and the hologram. */
  heard: string;
  steps: DesktopStep[];
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
 * What JARVIS says when the plan has run. Answer first, in the register: what is open and where,
 * then what did not happen and why, one clause each, no exclamation marks. A refused plan is its
 * own message, unchanged.
 */
export function replyFor(plan: DesktopPlan, result: DesktopResult): string {
  if (!result.steps.length) return result.message;
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
        Condition byName = new PropertyCondition(AutomationElement.NameProperty, name);
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
