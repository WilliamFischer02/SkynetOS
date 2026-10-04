import { isSensitiveTitle } from '@shared/actions.js';
import {
  SHELL_PROCESSES,
  TERMINAL_PROCESSES,
  isSessionTitle,
  windowTarget,
  type DictateTargetRequest,
  type DictateTargetResult,
  type DictateTargetView
} from '@shared/desktop.js';
import { getSettings } from './settings.js';
import { bringForward, desktopMonitors, ensureHelper, findTargetWindow, helperWindows, type RawWindow } from './desktop.js';
import { dictateStatus, toggleDictation, typeText } from './dictate.js';
import { controlHologram } from './hologram-window.js';
import { say } from './speech.js';

/**
 * A dictation TARGET (docs/11 § Reaching into windows, the board, and a terminal).
 *
 * William: "dictate into a named JARVIS Claude Code window". Once set ("transcribe into
 * JARVIS-TQR", "dictate to JARVIS-TQR", "type this into JARVIS-TQR", or a split), every take of
 * dictation is typed into THAT window: before each take's text, dictate.ts calls `aimDictation`,
 * which brings the window forward (the helper's `focus`, a title-bar click if Windows refuses) and
 * only then lets the existing SendKeys path type. "Send it" / "enter" presses Enter there; "stop
 * transcribing" clears the target and stops the dictation.
 *
 * The rules, beside docs/07 § Voice (dictation) and § JARVIS Voice (desktop control):
 *   - bringing another program's window forward is desktop control, so a target needs
 *     `desktop.enabled`; off, it is refused, and a take never types into a window it could not aim;
 *   - never a sign-in window; never a bare shell, where a dictated line and Enter would run as a
 *     command. A shell window is accepted only when it is a SkynetOS session window
 *     ("SkynetOS - <designator> - <name>"), whose prompt is Claude Code's;
 *   - a target that has closed is said aloud and cleared, and that take is not typed anywhere;
 *   - per app run: never written to disk. `dictate:setTarget` is user-only.
 */

let target: DictateTargetView | null = null;

export function dictateTarget(): DictateTargetView | null {
  return target;
}

function isShell(process: string): boolean {
  const p = process.toLowerCase();
  return SHELL_PROCESSES.test(p) || (TERMINAL_PROCESSES as readonly string[]).includes(p);
}

/** Why a window cannot be a dictation target, or null. */
export function targetRefusal(win: { title: string; process: string }): string | null {
  if (isSensitiveTitle(win.title)) return `${win.title} looks like a sign-in window; I do not type into those.`;
  if (isShell(win.process) && !isSessionTitle(win.title)) return 'That is a bare shell, where a dictated line would run; I dictate into a chip\'s Claude Code window.';
  return null;
}

function speak(text: string): void {
  void say({ text, interrupt: false }).catch(() => undefined);
}

/** Aim at a window already found (window-split.ts). False, and nothing set, when it is refused. */
export async function setDictateTargetWindow(win: RawWindow, label: string): Promise<boolean> {
  if (targetRefusal(win)) return false;
  target = { title: win.title, process: win.process, hwnd: win.h, label };
  return true;
}

async function liveWindow(hwnd: number, process: string): Promise<RawWindow | null> {
  if (!(await ensureHelper())) return null;
  // The same handle AND the same program: Windows reuses handles (bug sweep 2026-09-27).
  const want = process.toLowerCase();
  return (await helperWindows()).find((w) => w.h === hwnd && (!want || (w.process ?? '').toLowerCase() === want)) ?? null;
}

/**
 * Before a take is typed (dictate.ts): no target, nothing to do; a target, bring it forward. Not
 * ok means: do not type this take anywhere. A closed window is said aloud and the target cleared.
 */
export async function aimDictation(): Promise<{ ok: boolean; error?: string }> {
  const aim = target;
  if (!aim) return { ok: true };
  if (getSettings().desktop.enabled !== true) {
    target = null;
    speak(`Desktop control is off, so I will not switch to ${aim.label}. Dictation stopped.`);
    return { ok: false, error: 'DESKTOP CONTROL IS OFF — THE DICTATION TARGET WAS CLEARED' };
  }
  const win = await liveWindow(aim.hwnd, aim.process);
  if (!win) {
    target = null;
    speak(`${aim.label} has closed; I have stopped typing there.`);
    return { ok: false, error: `${aim.label.toUpperCase()} HAS CLOSED — THE DICTATION TARGET WAS CLEARED` };
  }
  const refused = targetRefusal(win);
  if (refused) {
    target = null;
    speak(refused);
    return { ok: false, error: refused.toUpperCase() };
  }
  const forward = await bringForward(win, desktopMonitors(), { visible: false });
  if (!forward.ok) return { ok: false, error: `COULD NOT BRING ${aim.label.toUpperCase()} FORWARD — ${forward.message}` };
  return { ok: true };
}

async function setFromSpoken(spoken: string, start: boolean): Promise<DictateTargetResult> {
  const refuse = (said: string, error?: string): DictateTargetResult => ({ ok: false, said, target, ...(error ? { error } : {}) });
  if (getSettings().desktop.enabled !== true) return refuse('Desktop control is off; switch DESK on and ask again.', 'DESKTOP CONTROL IS OFF');
  const t = windowTarget(typeof spoken === 'string' ? spoken.slice(0, 120) : '');
  if (!t) return refuse('Into which window, sir?');
  const win = await findTargetWindow(t.window, (title) => isSessionTitle(title));
  if (!win) return refuse(`I do not see a window for ${t.label}; is it open?`);
  const refused = targetRefusal(win);
  if (refused) return refuse(refused);
  target = { title: win.title, process: win.process, hwnd: win.h, label: t.label };
  if (!start) return { ok: true, said: `Dictation will type into ${t.label}.`, target };
  if (dictateStatus().phase === 'idle') toggleDictation();
  const status = dictateStatus();
  if (status.phase === 'idle' && status.error) return { ok: false, said: `${t.label} is the target, but ${status.error.toLowerCase()}.`, target, error: status.error };
  return { ok: true, said: `Dictating into ${t.label}. Speak.`, target };
}

async function pressEnter(): Promise<DictateTargetResult> {
  if (!target) {
    // No target: "send it" is the JARVIS window's own SEND button, as it was before.
    const pressed = controlHologram({ op: 'press', id: 'btn-send' });
    return { ok: pressed.ok, said: pressed.ok ? 'Sent.' : (pressed.error ?? 'Nothing to send.'), target: null, ...(pressed.ok ? {} : { error: pressed.error ?? 'NO TARGET' }) };
  }
  const label = target.label;
  const aimed = await aimDictation();
  if (!aimed.ok) return { ok: false, said: aimed.error ?? `I could not reach ${label}.`, target, ...(aimed.error ? { error: aimed.error } : {}) };
  await typeText('\n');
  return { ok: true, said: `Sent, in ${label}.`, target };
}

function clear(): DictateTargetResult {
  const was = target;
  target = null;
  if (dictateStatus().phase !== 'idle') toggleDictation();
  return { ok: true, said: was ? `Stopped transcribing into ${was.label}.` : 'Stopped transcribing.', target: null };
}

/** `dictate:setTarget`. User-only (the board and the JARVIS window). */
export async function dictateSetTarget(req: DictateTargetRequest | null | undefined): Promise<DictateTargetResult> {
  switch (req?.op) {
    case 'set': return setFromSpoken(req.window, req.start === true);
    case 'clear': return clear();
    case 'enter': return pressEnter();
    case 'status': return { ok: true, said: target ? `Dictation types into ${target.label}.` : 'Dictation types wherever the cursor is.', target };
    default: return { ok: false, said: 'Into which window, sir?', target, error: 'UNKNOWN REQUEST' };
  }
}
