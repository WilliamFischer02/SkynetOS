/**
 * The DOM chrome's scale, and William's override of it.
 *
 * Main forces `devicePixelRatio` to 1 so the board is pixel-exact at any OS scaling (docs/02
 * anti-mush rule 9). The side effect is that every CSS pixel is one DEVICE pixel, so the chrome
 * carries its own integer scale, `--ui-scale`, taken from the same OS scale factor the board
 * cancels. Integer only: every chrome dimension is a multiple of `--p`, so a 1px border stays a
 * whole number of device pixels and Departure Mono stays on a multiple of 11.
 *
 * William, 2026-09-27: "a lot of the buttons and UI elements are squashed at the program's current
 * scale." So the scale is also a setting: `auto` (the default, and the only behaviour before this)
 * follows the OS; 1, 2 or 3 fixes it. Still integers, still 1 to 3: 4× chrome on a 1080p screen
 * would leave no board, and a fraction would break the font. The BOARD's pixel zoom is separate.
 */

export type UiScaleSetting = 'auto' | 1 | 2 | 3;

export const UI_SCALE_CHOICES: readonly UiScaleSetting[] = ['auto', 1, 2, 3];

/** Whatever settings.json says, as one of the four choices. Anything unrecognised is `auto`. */
export function clampUiScale(raw: unknown): UiScaleSetting {
  if (raw === 'auto') return 'auto';
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'auto';
  const whole = Math.round(n);
  if (whole !== n) return 'auto';
  return whole === 1 || whole === 2 || whole === 3 ? whole : 'auto';
}

/** The automatic scale: the OS scale factor, rounded to a whole number, 1 to 3. */
export function uiScaleFor(scaleFactor: number): 1 | 2 | 3 {
  const n = Math.round(Number.isFinite(scaleFactor) ? scaleFactor : 1);
  return n >= 3 ? 3 : n <= 1 ? 1 : 2;
}

/** The scale the chrome is drawn at: the override, or the OS's when it is `auto`. */
export function resolveUiScale(setting: UiScaleSetting, scaleFactor: number): 1 | 2 | 3 {
  return setting === 'auto' ? uiScaleFor(scaleFactor) : setting;
}

/** The palette's "UI scale" steps through the four in order and wraps. */
export function nextUiScale(setting: UiScaleSetting): UiScaleSetting {
  const i = UI_SCALE_CHOICES.indexOf(setting);
  return UI_SCALE_CHOICES[(i + 1) % UI_SCALE_CHOICES.length] ?? 'auto';
}

/** How the choice is written on a button: AUTO, 1×, 2×, 3×. */
export function uiScaleLabel(setting: UiScaleSetting): string {
  return setting === 'auto' ? 'AUTO' : `${setting}×`;
}
