/**
 * Spoken controls for the JARVIS Voice window, and saved actions by name.
 *
 * William, 2026-09-26: "all of the Jarvis Voice UI, every submenu and button, should have voice
 * commands preset." The grammar (packages/shared/intent.ts) turns a sentence into a
 * `HologramControl`; this file carries it to the window on the `hologram:control` event, where the
 * renderer presses the control that has that `data-control` id. Main does nothing the click would
 * not do, with two exceptions it owns anyway: it opens the window when a control needs one, and
 * `shutdown` closes the microphone and stops speech before the window goes.
 *
 * `hologram:control` and `hologram:runAction` are user-only channels: the board window and the
 * hologram window may call them, an agent or a phone may not (test/jarvis-voice-contract.test.ts).
 */
import type { HologramControl } from '@shared/hologram-control.js';
import { matchActionName, sayForControl } from '@shared/intent.js';
import { hologramWindow, openHologram, shutdownHologram } from './hologram-window.js';
import { say } from './speech.js';
import { desktopStatus } from './desktop.js';
import { listSavedActions, runSavedAction } from './action-recorder.js';

export interface ControlResult { ok: boolean; said: string; error?: string }

/** How long the SHUTTING DOWN caption is on screen before the window closes for good. */
const SHUTDOWN_GRACE_MS = 450;

export async function sendHologramControl(control: HologramControl): Promise<ControlResult> {
  const said = sayForControl(control);

  if (control.op === 'shutdown') {
    // The JARVIS Voice program, never the computer: microphone off, speech stopped, any desktop
    // plan halted, then the window closes and stays closed until the VOICE button is pressed.
    // One shutdown path: `shutdownHologram` in hologram-window.ts (also the `hologram:shutdown`
    // channel behind the CLOSE button's sibling). The caption goes first so the window can say
    // SHUTTING DOWN before it disappears.
    const win = hologramWindow();
    if (win) win.webContents.send('hologram:control', control);
    setTimeout(() => {
      try { shutdownHologram(); } catch (err) { console.log(`[hologram] shutdown failed — ${(err as Error).message}`); }
    }, SHUTDOWN_GRACE_MS);
    return { ok: true, said };
  }

  if (control.op === 'close' || control.op === 'minimise') {
    const win = hologramWindow();
    if (!win) return { ok: true, said: control.op === 'close' ? 'It is already closed.' : 'It is already out of the way.' };
    win.webContents.send('hologram:control', control);
    return { ok: true, said };
  }

  let win = hologramWindow();
  if (!win) {
    try { openHologram(); } catch (err) { return { ok: false, said: '', error: `THE JARVIS WINDOW DID NOT OPEN — ${(err as Error).message}` }; }
    win = hologramWindow();
  }
  if (!win) return { ok: false, said: '', error: 'THE JARVIS WINDOW DID NOT OPEN' };
  const target = win;
  const deliver = (): void => { if (!target.isDestroyed()) target.webContents.send('hologram:control', control); };
  if (target.webContents.isLoading()) target.webContents.once('did-finish-load', deliver);
  else deliver();
  return { ok: true, said };
}

export interface RunActionResult { ok: boolean; name?: string; error?: string }

/**
 * "Do the morning setup": find the saved action the words mean, say so, run it.
 *
 * The same switch as every desktop plan: with desktop control off it is refused in the same words
 * `desktop:run` uses, so a spoken action can never move anything William has not allowed.
 */
export async function runNamedAction(spoken: string): Promise<RunActionResult> {
  if (!desktopStatus().enabled) {
    return { ok: false, error: 'DESKTOP CONTROL IS OFF — THE DESKTOP SWITCH IN THE HOLOGRAM WINDOW, OR settings.json desktop.enabled' };
  }
  const actions = listSavedActions();
  if (!actions.length) return { ok: false, error: 'NO ACTIONS SAVED YET — TRAIN ACTION IN THE JARVIS WINDOW RECORDS ONE' };
  const match = matchActionName(spoken, actions.map((a) => ({ id: a.id, name: a.name })));
  if (!match) {
    const names = actions.slice(0, 6).map((a) => a.name).join(', ');
    return { ok: false, error: `NO SAVED ACTION SOUNDS LIKE "${spoken}" — I HAVE: ${names}` };
  }
  // Said before it runs, so the first mouse movement is never a surprise.
  void say({ text: `Running ${match.name}.` });
  const result = await runSavedAction(match.id);
  return { ok: result.ok, name: match.name, ...(result.error ? { error: result.error } : {}) };
}
