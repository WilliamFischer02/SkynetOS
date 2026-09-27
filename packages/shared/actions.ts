/**
 * Recorded desktop actions: what TRAIN ACTION captures, how it is saved, and the pure rules for
 * playing it back somewhere the windows have moved.
 *
 * William, 2026-09-26: a TRAIN ACTION button that "watches what I do on the PC, recording my mouse
 * and keyboard actions", saves it "in a decipherable way", and later, by voice, "imitates the
 * action with intelligence and context-aware adaptation to screen location or bookmark or taskbar
 * location changes".
 *
 * Adaptation is possible because every click records the UI Automation element under the cursor
 * (its name, control type, class and rectangle) and the window it lives in, not only a pixel. At
 * replay the element is looked up again by name; only when that fails does the position fall back
 * to the window's rectangle, and only after that to the raw screen coordinate.
 *
 * Rules that bind this (docs/07 § JARVIS Voice): recording only while the light is on; the
 * recorder pauses itself over anything that looks like a password prompt; recordings live under
 * userData, never in the repo; replay runs under the desktop-control switch with the same halt and
 * the same refused key combinations; nothing is uploaded anywhere.
 */

export type ActionStep =
  | { t: number; kind: 'move'; x: number; y: number }
  | { t: number; kind: 'click' | 'dblclick' | 'rightclick'; x: number; y: number; target: UiTarget }
  | { t: number; kind: 'wheel'; x: number; y: number; delta: number }
  | { t: number; kind: 'key'; keys: string }
  | { t: number; kind: 'text'; text: string }
  | { t: number; kind: 'paused'; reason: string };

export interface UiTarget {
  process: string;
  windowTitle: string;
  controlName: string;
  controlType: string;
  className: string;
  /** Screen pixels: left, top, width, height. */
  rect: [number, number, number, number];
  /** Where in the element the click landed, 0–1 of its width and height. */
  relX: number;
  relY: number;
  monitor: number;
  /** The foreground window's rectangle at record time, for the `window` tier of adaptation. */
  windowRect?: [number, number, number, number];
}

/** What the TRAIN ACTION light reports while it is on. */
export interface RecordStatus {
  recording: boolean;
  steps: number;
  pausedFor?: string;
  startedAt?: string;
}

export interface ActionRecording {
  id: string;
  startedAt: string;
  durationMs: number;
  steps: ActionStep[];
  screens: { w: number; h: number; x: number; y: number }[];
}

export interface SavedAction {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  recording: ActionRecording;
  /** One readable line per click or key step, for the save screen and the voice read-back. */
  summary: string[];
}

/* ────────────────────────── limits ────────────────────────── */

/** A replay is at most this many steps and this long, whatever was recorded. */
export const MAX_REPLAY_STEPS = 400;
export const MAX_REPLAY_MS = 120_000;
/** Recorded gaps are compressed into this band so a replay neither races nor idles. */
export const REPLAY_GAP_MIN_MS = 60;
export const REPLAY_GAP_MAX_MS = 800;
/** A `move` is kept only when the cursor travelled this far or this long since the last kept one. */
export const MOVE_MIN_PX = 8;
export const MOVE_MIN_MS = 50;
/** A UIA lookup during replay gets this long before the next tier is tried. */
export const LOOKUP_BUDGET_MS = 2000;

/* ────────────────────────── the password rule ────────────────────────── */

/** A foreground window whose title matches this is never recorded and never typed into. */
export const SENSITIVE_TITLE = /password|passcode|sign[ -]?in|log[ -]?in|login|2fa|verification code/i;

export function isSensitiveTitle(title: string | undefined | null): boolean {
  return SENSITIVE_TITLE.test(title ?? '');
}

/* ────────────────────────── refused keys ────────────────────────── */

/**
 * Chords a replay never sends. `alt+f4` closes a program, `win+l` locks the machine,
 * `ctrl+alt+delete` and `ctrl+shift+esc` reach the security screen and the task manager, and a
 * bare `win` (or `win+r`, `win+x`) opens a launcher a typed line could turn into a shell.
 */
const REFUSED_CHORDS = new Set([
  'alt+f4',
  'win+l',
  'ctrl+alt+delete',
  'ctrl+alt+del',
  'ctrl+shift+esc',
  'ctrl+shift+escape',
  'win',
  'win+r',
  'win+x'
]);

/** Canonical form: lower case, modifiers in ctrl, alt, shift, win order, then the key. */
export function normaliseChord(keys: string): string {
  const parts = keys.toLowerCase().split('+').map((p) => p.trim()).filter(Boolean);
  const mods = ['ctrl', 'alt', 'shift', 'win'];
  const alias: Record<string, string> = { control: 'ctrl', meta: 'win', windows: 'win', cmd: 'win', option: 'alt', esc: 'escape', del: 'delete', return: 'enter' };
  const named = parts.map((p) => alias[p] ?? p);
  const present = mods.filter((m) => named.includes(m));
  const rest = named.filter((p) => !mods.includes(p));
  return [...present, ...rest].join('+');
}

export function isRefusedChord(keys: string): boolean {
  const chord = normaliseChord(keys);
  if (REFUSED_CHORDS.has(chord)) return true;
  // ctrl+alt+delete under any spelling of the last key.
  if (chord.startsWith('ctrl+alt+') && /^(del|delete)$/.test(chord.slice('ctrl+alt+'.length))) return true;
  return false;
}

/* ────────────────────────── coalescing ────────────────────────── */

/** Raw events as the helper streams them, before coalescing. */
export type RawEvent =
  | { t: number; kind: 'move'; x: number; y: number }
  | { t: number; kind: 'click' | 'dblclick' | 'rightclick'; x: number; y: number; target: UiTarget }
  | { t: number; kind: 'wheel'; x: number; y: number; delta: number }
  | { t: number; kind: 'key'; keys: string }
  | { t: number; kind: 'char'; ch: string }
  | { t: number; kind: 'paused'; reason: string };

const PRINTABLE = /^[\x20-\x7e]$/;

/**
 * Turn the raw stream into steps: printable characters run together into one `text` step, chords
 * with a modifier stay `key`, moves are decimated, and a pause is kept once per stretch.
 */
export function coalesceSteps(events: readonly RawEvent[]): ActionStep[] {
  const out: ActionStep[] = [];
  let text: { t: number; text: string } | null = null;
  let lastMove: { t: number; x: number; y: number } | null = null;
  let lastPaused: string | null = null;

  const flushText = () => {
    if (text) out.push({ t: text.t, kind: 'text', text: text.text });
    text = null;
  };

  for (const ev of events) {
    if (ev.kind === 'char' && PRINTABLE.test(ev.ch)) {
      if (!text) text = { t: ev.t, text: '' };
      text.text += ev.ch;
      lastPaused = null;
      continue;
    }
    if (ev.kind === 'char') continue; // a non-printable char with no chord name: nothing to replay
    if (ev.kind === 'move') {
      lastPaused = null;
      if (lastMove && Math.hypot(ev.x - lastMove.x, ev.y - lastMove.y) < MOVE_MIN_PX && ev.t - lastMove.t < MOVE_MIN_MS) continue;
      lastMove = { t: ev.t, x: ev.x, y: ev.y };
      flushText();
      out.push({ t: ev.t, kind: 'move', x: ev.x, y: ev.y });
      continue;
    }
    if (ev.kind === 'paused') {
      flushText();
      if (lastPaused === ev.reason) continue;
      lastPaused = ev.reason;
      out.push({ t: ev.t, kind: 'paused', reason: ev.reason });
      continue;
    }
    lastPaused = null;
    flushText();
    if (ev.kind === 'key') {
      const chord = normaliseChord(ev.keys);
      // A plain printable key that arrived as a chord name is text.
      if (chord.length === 1 && PRINTABLE.test(chord)) { text = { t: ev.t, text: chord }; continue; }
      out.push({ t: ev.t, kind: 'key', keys: chord });
      continue;
    }
    if (ev.kind === 'wheel') { out.push({ t: ev.t, kind: 'wheel', x: ev.x, y: ev.y, delta: ev.delta }); continue; }
    // Two left clicks within the double-click window and a few pixels are one double click.
    const prev = out[out.length - 1];
    if (ev.kind === 'click' && prev && prev.kind === 'click' && ev.t - prev.t <= DOUBLE_CLICK_MS && Math.hypot(ev.x - prev.x, ev.y - prev.y) <= 6) {
      out[out.length - 1] = { ...prev, kind: 'dblclick' };
      continue;
    }
    out.push({ t: ev.t, kind: ev.kind, x: ev.x, y: ev.y, target: ev.target });
  }
  flushText();
  return out;
}

/** Windows' default double-click time. */
export const DOUBLE_CLICK_MS = 450;

/* ────────────────────────── the readable summary ────────────────────────── */

function shortTarget(target: UiTarget): string {
  const name = target.controlName.trim();
  const type = target.controlType.replace(/^ControlType\./, '').toLowerCase();
  const app = target.process.replace(/\.exe$/i, '').toLowerCase() || 'desktop';
  if (name) return `${app} · "${name.length > 40 ? name.slice(0, 39) + '…' : name}" ${type}`.trim();
  if (target.windowTitle) return `${app} · ${target.windowTitle.slice(0, 40)} · ${type || 'point'}`;
  return `${app} · ${type || 'point'}`;
}

/** One line per step a person would call an action; moves and wheel ticks are left out. */
export function summariseSteps(steps: readonly ActionStep[]): string[] {
  const lines: string[] = [];
  for (const s of steps) {
    switch (s.kind) {
      case 'click': lines.push(`CLICK   ${shortTarget(s.target)}`); break;
      case 'dblclick': lines.push(`DOUBLE  ${shortTarget(s.target)}`); break;
      case 'rightclick': lines.push(`RIGHT   ${shortTarget(s.target)}`); break;
      case 'key': lines.push(`KEY     ${s.keys.toUpperCase()}`); break;
      case 'text': lines.push(`TYPE    "${s.text.length > 48 ? s.text.slice(0, 47) + '…' : s.text}"`); break;
      case 'paused': lines.push(`PAUSED  ${s.reason}`); break;
      default: break;
    }
  }
  return lines;
}

/* ────────────────────────── timing ────────────────────────── */

/** The wait before step `i`, compressed into the replay band. The first step waits the minimum. */
export function replayGaps(steps: readonly ActionStep[]): number[] {
  const gaps: number[] = [];
  for (let i = 0; i < steps.length; i++) {
    if (i === 0) { gaps.push(REPLAY_GAP_MIN_MS); continue; }
    const raw = steps[i]!.t - steps[i - 1]!.t;
    gaps.push(Math.max(REPLAY_GAP_MIN_MS, Math.min(REPLAY_GAP_MAX_MS, raw)));
  }
  return gaps;
}

/**
 * The steps a replay will actually run: capped by count and by compressed duration. Moves are
 * dropped first: a click travels the mouse to its point anyway, so a recorded path adds nothing
 * but steps, and `paused` markers are records, not actions.
 */
export function replayPlan(steps: readonly ActionStep[]): { steps: ActionStep[]; gaps: number[]; truncated: boolean } {
  const actionable = steps.filter((s) => s.kind !== 'move' && s.kind !== 'paused');
  const kept: ActionStep[] = [];
  const gaps: number[] = [];
  const all = replayGaps(actionable);
  let total = 0;
  for (let i = 0; i < actionable.length; i++) {
    if (kept.length >= MAX_REPLAY_STEPS || total + all[i]! > MAX_REPLAY_MS) {
      return { steps: kept, gaps, truncated: true };
    }
    total += all[i]!;
    kept.push(actionable[i]!);
    gaps.push(all[i]!);
  }
  return { steps: kept, gaps, truncated: false };
}

/* ────────────────────────── adaptation ────────────────────────── */

/** A window as the helper lists it now. */
export interface LiveWindow { process: string; title: string; rect: [number, number, number, number]; monitor: number }
/** An element the helper found inside a live window. */
export interface LiveElement { controlName: string; controlType: string; className: string; rect: [number, number, number, number] }

export type AdaptTier = 'element' | 'window' | 'screen';

export interface AdaptedClick { tier: AdaptTier; x: number; y: number; window: LiveWindow | null }

function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1));
}

/** 0–1: how much of the recorded title's words survive in the candidate. Process must match. */
export function titleSimilarity(recorded: string, candidate: string): number {
  const a = tokens(recorded);
  const b = tokens(candidate);
  if (a.size === 0) return b.size === 0 ? 1 : 0.5;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit++;
  return hit / a.size;
}

/** The live window that best matches the recorded one, or null when no process matches at all. */
export function matchWindow(target: UiTarget, windows: readonly LiveWindow[]): LiveWindow | null {
  const proc = target.process.toLowerCase().replace(/\.exe$/, '');
  let best: LiveWindow | null = null;
  let bestScore = -1;
  for (const w of windows) {
    if (w.process.toLowerCase().replace(/\.exe$/, '') !== proc) continue;
    const score = titleSimilarity(target.windowTitle, w.title);
    if (score > bestScore) { best = w; bestScore = score; }
  }
  return best;
}

function sameControl(target: UiTarget, el: LiveElement): boolean {
  const nameOk = target.controlName.trim() !== '' && el.controlName.trim().toLowerCase() === target.controlName.trim().toLowerCase();
  const typeOk = !target.controlType || !el.controlType || el.controlType === target.controlType;
  return nameOk && typeOk;
}

/**
 * Where to click now. Tier `element`: the same-named control inside the matched window, at the
 * recorded fraction of its CURRENT rect. Tier `window`: no such control, so the recorded offset
 * from the window's recorded rect is applied to its current rect. Tier `screen`: no window matched,
 * so the raw recorded coordinate. `windowRectThen` is the window's rect at record time when known.
 */
export function adaptTarget(
  step: { x: number; y: number; target: UiTarget },
  windows: readonly LiveWindow[],
  elements: readonly LiveElement[],
  windowRectThen?: [number, number, number, number]
): AdaptedClick {
  const win = matchWindow(step.target, windows);
  if (win) {
    const el = elements.find((e) => sameControl(step.target, e));
    if (el && el.rect[2] > 0 && el.rect[3] > 0) {
      return {
        tier: 'element',
        x: Math.round(el.rect[0] + el.rect[2] * step.target.relX),
        y: Math.round(el.rect[1] + el.rect[3] * step.target.relY),
        window: win
      };
    }
    if (windowRectThen && windowRectThen[2] > 0 && windowRectThen[3] > 0) {
      const fx = (step.x - windowRectThen[0]) / windowRectThen[2];
      const fy = (step.y - windowRectThen[1]) / windowRectThen[3];
      return {
        tier: 'window',
        x: Math.round(win.rect[0] + win.rect[2] * Math.min(1, Math.max(0, fx))),
        y: Math.round(win.rect[1] + win.rect[3] * Math.min(1, Math.max(0, fy))),
        window: win
      };
    }
    // No recorded window rect: the recorded element rect is the best anchor for the offset.
    const r = step.target.rect;
    if (r[2] > 0 && r[3] > 0) {
      const dx = step.x - r[0];
      const dy = step.y - r[1];
      return { tier: 'window', x: Math.round(win.rect[0] + dx), y: Math.round(win.rect[1] + dy), window: win };
    }
  }
  return { tier: 'screen', x: step.x, y: step.y, window: win };
}

/* ────────────────────────── ids ────────────────────────── */

/** `2026-09-26T21-05-03-118` plus a short random tail: sortable, filename-safe. */
export function recordingId(now: Date = new Date(), rand: number = Math.random()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
  return `${stamp}-${Math.floor(rand * 0xffff).toString(16).padStart(4, '0')}`;
}

export function safeActionName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, 60);
}
