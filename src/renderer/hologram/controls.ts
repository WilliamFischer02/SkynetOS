import type { HologramControl, HologramControlId, HologramDropdown, HologramPanel } from '@shared/hologram-control.js';

/**
 * What a spoken control does in the window, as data: the renderer applies an `Effect`, and this
 * mapping is what the tests hold. No DOM here.
 *
 * `press` effects are clicks on the element carrying `data-control`; `state` effects set React
 * state directly (so "go to the train panel" is the same as pressing TRAIN, but "open the
 * profiles dropdown" opens it rather than toggling it); `call` effects go straight to main.
 */
export type ControlEffect =
  | { kind: 'panel'; panel: HologramPanel }
  | { kind: 'dropdown'; name: HologramDropdown; open: boolean }
  | { kind: 'toggle'; which: 'talkback' | 'mic' | 'desk' | 'dictate' | 'train-action'; on: boolean }
  | { kind: 'press'; id: HologramControlId }
  | { kind: 'call'; channel: 'hologram:minimize' | 'hologram:close' | 'hologram:shutdown' };

export function controlEffect(control: HologramControl): ControlEffect {
  switch (control.op) {
    case 'panel': return { kind: 'panel', panel: control.panel };
    case 'dropdown': return { kind: 'dropdown', name: control.name, open: control.open };
    case 'talkback': return { kind: 'toggle', which: 'talkback', on: control.on };
    case 'mic': return { kind: 'toggle', which: 'mic', on: control.on };
    case 'desk': return { kind: 'toggle', which: 'desk', on: control.on };
    case 'dictate': return { kind: 'toggle', which: 'dictate', on: control.on };
    case 'train-action': return { kind: 'toggle', which: 'train-action', on: control.on };
    case 'press': return { kind: 'press', id: control.id };
    case 'minimise': return { kind: 'call', channel: 'hologram:minimize' };
    case 'close': return { kind: 'call', channel: 'hologram:close' };
    case 'shutdown': return { kind: 'call', channel: 'hologram:shutdown' };
  }
}

/** Which panel a button id opens, if it is a panel button; `main` closes the others. */
export function panelForButton(id: HologramControlId): HologramPanel | null {
  switch (id) {
    case 'btn-train': return 'train';
    case 'btn-desk': return 'desk';
    case 'btn-actions': return 'actions';
    case 'btn-say': return 'say';
    default: return null;
  }
}

/** The pressed-control caption, 1.2 s. */
export const CONTROL_CAPTION_MS = 1200;
