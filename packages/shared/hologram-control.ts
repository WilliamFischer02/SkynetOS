/**
 * Every control in the JARVIS Voice window, by a stable id, so a spoken command can press it.
 *
 * William, 2026-09-26: "all of the Jarvis Voice UI, every submenu and button, should have voice
 * commands preset: 'Jarvis, go to the train panel', 'Jarvis, open the profiles dropdown', 'Jarvis,
 * turn off talkback'." The intent grammar (packages/shared/intent.ts) maps a sentence to a
 * `HologramControl`; main sends it to the hologram window on the `hologram:control` event; the
 * renderer performs it exactly as a click on the control with that `data-control` id would.
 *
 * The renderer MUST give each interactive element `data-control={id}` from `HOLOGRAM_CONTROLS`,
 * and the grammar MUST only name ids from this list. Add here first, then on both sides.
 */

export const HOLOGRAM_PANELS = ['main', 'train', 'desk', 'actions', 'say'] as const;
export type HologramPanel = (typeof HOLOGRAM_PANELS)[number];

export const HOLOGRAM_DROPDOWNS = ['profiles', 'voices', 'monitors'] as const;
export type HologramDropdown = (typeof HOLOGRAM_DROPDOWNS)[number];

/** Buttons and inputs. The spoken names live in intent.ts; these are the ids the DOM carries. */
export const HOLOGRAM_CONTROLS = [
  'btn-mic',
  'btn-say',
  'btn-desk',
  'btn-train',
  'btn-actions',
  'btn-minimise',
  'btn-close',
  'btn-train-action',
  'btn-dictate',
  'btn-use-voice',
  'btn-record',
  'btn-play',
  'btn-create-profile',
  'btn-save-action',
  'btn-discard-action',
  'btn-send',
  'input-text',
  'dropdown-profiles',
  'dropdown-voices',
  'dropdown-monitors'
] as const;
export type HologramControlId = (typeof HOLOGRAM_CONTROLS)[number];

export type HologramControl =
  | { op: 'panel'; panel: HologramPanel }
  | { op: 'dropdown'; name: HologramDropdown; open: boolean }
  | { op: 'talkback'; on: boolean }
  | { op: 'mic'; on: boolean }
  | { op: 'desk'; on: boolean }
  | { op: 'press'; id: HologramControlId }
  | { op: 'dictate'; on: boolean }
  | { op: 'train-action'; on: boolean }
  | { op: 'minimise' }
  | { op: 'close' }
  /** Close the window AND stop the microphone and speech. Never the computer. */
  | { op: 'shutdown' };

export function isHologramControlId(value: string): value is HologramControlId {
  return (HOLOGRAM_CONTROLS as readonly string[]).includes(value);
}

/** What the caption says while a control is being performed by voice, so the action is visible. */
export function describeControl(control: HologramControl): string {
  switch (control.op) {
    case 'panel': return `${control.panel.toUpperCase()} PANEL`;
    case 'dropdown': return `${control.open ? 'OPEN' : 'CLOSE'} ${control.name.toUpperCase()}`;
    case 'talkback': return `TALKBACK ${control.on ? 'ON' : 'OFF'}`;
    case 'mic': return `MIC ${control.on ? 'ON' : 'OFF'}`;
    case 'desk': return `DESK ${control.on ? 'ON' : 'OFF'}`;
    case 'press': return control.id.replace(/^btn-/, '').replace(/-/g, ' ').toUpperCase();
    case 'dictate': return control.on ? 'DICTATING' : 'DICTATION OFF';
    case 'train-action': return control.on ? 'RECORDING YOUR ACTIONS' : 'RECORDING STOPPED';
    case 'minimise': return 'MINIMISED';
    case 'close': return 'CLOSING';
    case 'shutdown': return 'SHUTTING DOWN JARVIS VOICE';
  }
}
