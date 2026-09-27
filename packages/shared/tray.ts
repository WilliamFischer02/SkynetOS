/**
 * The tray icon (roadmap M13.5, docs/11 § The window): a second home for the board and the JARVIS
 * Voice window when both are minimised. Main-process only, in src/main/services/tray.ts. It adds no
 * IPC channel: every item below calls a main-side function directly, the same ones William's own
 * switches reach through user-only channels. No agent and no phone can press a tray item.
 *
 * What is here is pure, so the menu's words and ticks are tested without Electron (test/tray.test.ts).
 */

/** What the tray says when the pointer rests on it. */
export const TRAY_TOOLTIP = 'SkynetOS';

/**
 * `tray.minimizeToTray` in settings.json. File-only, like every view preference that is not a
 * switch in a panel: there is no channel that writes it.
 */
export interface TraySettings {
  /** Minimising the board hides it (off the taskbar); the tray icon brings it back. */
  minimizeToTray: boolean;
}

export const DEFAULT_TRAY: TraySettings = { minimizeToTray: false };

/** A hand-edited block is read defensively: anything but `true` is the default. */
export function normaliseTraySettings(raw: unknown): TraySettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { minimizeToTray: r['minimizeToTray'] === true };
}

/** The icon files, one per display scale, in `assets/tray/` (tools/make-tray-icon.mjs draws them). */
export const TRAY_ICONS: readonly { scale: 1 | 2; file: string; size: 16 | 32 }[] = [
  { scale: 1, file: 'tray-16.png', size: 16 },
  { scale: 2, file: 'tray-32.png', size: 32 }
];

/** The file that matches a display scale: 32 px from 150% up, where 16 px would be scaled past 1.5x. */
export function trayIconFor(scaleFactor: number): { scale: 1 | 2; file: string; size: 16 | 32 } {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  return scale >= 1.5 ? TRAY_ICONS[1]! : TRAY_ICONS[0]!;
}

/** Where the icons live under the program root: the repo in dev, `resources/` in an install. */
export function trayIconPath(programRoot: string, file: string): string {
  return `${programRoot.replace(/[\\/]+$/, '')}/assets/tray/${file}`;
}

/** What the menu reflects. Read fresh each time the menu opens. */
export interface TrayState {
  /** `voice.enabled`: the wake word is listening. */
  voice: boolean;
  /** `desktop.enabled`: JARVIS may launch programs and move the mouse. */
  desktop: boolean;
  /** Whether the Run value exists; null while it has not been read yet. */
  autostart: boolean | null;
  /** False off Windows, where "Start with Windows" means nothing. */
  autostartSupported: boolean;
}

export type TrayAction = 'openBoard' | 'openHologram' | 'toggleVoice' | 'toggleDesktop' | 'toggleAutostart' | 'quit';

export type TrayMenuItem =
  | { type: 'normal'; id: TrayAction; label: string; enabled?: boolean }
  | { type: 'checkbox'; id: TrayAction; label: string; checked: boolean; enabled?: boolean }
  | { type: 'separator' };

/**
 * The menu, top to bottom. A checkbox's tick is the state now; clicking it asks for the opposite.
 * "Start with Windows" is greyed while its state is unknown or unsupported, so a click never guesses.
 */
export function trayMenuTemplate(state: TrayState): TrayMenuItem[] {
  const autostartKnown = state.autostartSupported && state.autostart !== null;
  return [
    { type: 'normal', id: 'openBoard', label: 'Open board' },
    { type: 'normal', id: 'openHologram', label: 'JARVIS Voice' },
    { type: 'checkbox', id: 'toggleVoice', label: 'Voice', checked: state.voice },
    { type: 'checkbox', id: 'toggleDesktop', label: 'Desk control', checked: state.desktop },
    { type: 'separator' },
    { type: 'checkbox', id: 'toggleAutostart', label: 'Start with Windows', checked: state.autostart === true, enabled: autostartKnown },
    { type: 'separator' },
    { type: 'normal', id: 'quit', label: 'Quit' }
  ];
}
