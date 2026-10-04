import { getSettings } from './settings.js';
import { desktopMonitors, findTargetWindow, placeHandle } from './desktop.js';
import { setHologramSplit } from './hologram-window.js';
import { isSensitiveTitle } from '@shared/actions.js';
import { isSessionTitle, splitBounds, windowTarget, type HologramSplitRequest, type HologramSplitResult } from '@shared/desktop.js';
import { setDictateTargetWindow } from './dictate-target.js';

/**
 * Side by side (docs/11 § Reaching into windows, the board, and a terminal).
 *
 * William: "put JARVIS-TQR on monitor one and sit beside it", "split screen with JARVIS-TQR".
 * `splitWith` finds the chip's terminal by its title (session windows are titled
 * "SkynetOS - <designator> - <name>" by launch-script.ts, fuzzy on the spoken tokens, the most
 * recently active first), puts it on monitor one's left 62% at full work-area height, and moves
 * the JARVIS window into the remaining width on the right: the SPLIT layout in
 * hologram-window.ts, which writes nothing to settings, so `hologram.desk` and `hologram.size`
 * are untouched and leaving SPLIT restores them. The terminal also becomes the dictation target,
 * so "take dictation" types into it. Per app run: nothing here is remembered.
 *
 * Moving another program's window is desktop control, so it needs `desktop.enabled` like any
 * plan; the channel (`hologram:split`) is user-only (docs/07 § JARVIS Voice).
 */

let current: { title: string; hwnd: number } | null = null;

export function splitState(): { title: string; hwnd: number } | null {
  return current;
}

export async function splitWith(fragment: string): Promise<HologramSplitResult> {
  const refuse = (said: string, error?: string): HologramSplitResult => ({ ok: false, said, split: current !== null, ...(error ? { error } : {}) });
  if (getSettings().desktop.enabled !== true) return refuse('Desktop control is off; switch DESK on and ask again.', 'DESKTOP CONTROL IS OFF');
  const spoken = typeof fragment === 'string' ? fragment.trim().slice(0, 120) : '';
  const target = windowTarget(spoken);
  if (!target) return refuse('Split with which window, sir?');
  const win = await findTargetWindow(target.window, (title) => isSessionTitle(title));
  if (!win) return refuse(`I do not see a window for ${target.label}; is it open?`);
  if (isSensitiveTitle(win.title)) return refuse(`${win.title} looks like a sign-in window; I do not move those.`);
  const one = desktopMonitors().find((m) => m.index === 1);
  if (!one) return refuse('I cannot find monitor one.');
  const { left, right } = splitBounds(one.work);
  const placed = await placeHandle(win.h, left);
  if (!placed.ok) return refuse(placed.message);
  setHologramSplit(right);
  current = { title: win.title, hwnd: win.h };
  // Beside it is where William dictates from: aim dictation at it, without starting the microphone.
  const aimed = await setDictateTargetWindow(win, target.label);
  return {
    ok: true,
    said: `${target.label} is on the left of monitor one, and I am beside it.${aimed ? ' Dictation will type there.' : ''}`,
    split: true,
    window: win.title
  };
}

export function leaveSplit(): HologramSplitResult {
  const was = current !== null;
  current = null;
  setHologramSplit(null);
  return { ok: true, said: was ? 'Back to my own corner.' : 'I was not beside anything.', split: false };
}

/** `hologram:split`. */
export async function hologramSplit(req: HologramSplitRequest | null | undefined): Promise<HologramSplitResult> {
  if (req && req.op === 'on' && typeof req.window === 'string') return splitWith(req.window);
  if (req && req.op === 'off') return leaveSplit();
  return { ok: false, said: 'Split with which window, sir?', split: current !== null, error: 'NO WINDOW NAMED' };
}
