/**
 * The themed confirmation window (src/main/services/confirm-window.ts, ui/ConfirmApp.tsx).
 *
 * Until 2026-09-26 every yes/no SkynetOS asked — launch this program, delete this node, publish to
 * the tailnet — was Electron's `dialog.showMessageBox`: a plain Windows message box, black text on
 * grey, in the middle of a pixel-art program. William: "make the launch confirmation window match
 * the aesthetic of the entire program". This module is the shape both ends agree on.
 *
 * The contract is `showMessageBox`'s own for the fields that matter (`buttons`, `defaultId`,
 * `cancelId`, `title`, `message`, `detail`), so a call site changes one identifier and none of its
 * semantics: the refusal is still the default, Esc and closing the window still refuse, and the
 * answer is still an index into `buttons`. What changes is only what the question looks like.
 *
 * The options travel to the window in its URL hash, encoded here, because that window may call
 * exactly one channel (`confirm:answer`) and so cannot ask main for them. Pure: tested without
 * Electron.
 */

export const CONFIRM_KINDS = ['launch', 'danger', 'info'] as const;
export type ConfirmKind = (typeof CONFIRM_KINDS)[number];

export interface ConfirmTheme {
  maskDark: string;
  maskLight: string;
  signal: string;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  detail?: string;
  /** In display order, left to right. `response` is an index into this list. */
  buttons: string[];
  /** The button that starts focused. Every SkynetOS question sets this to the refusal. */
  defaultId: number;
  /** The answer for Esc, the close box, and anything that is not a button press. */
  cancelId: number;
  /** `launch` (a program or session), `danger` (deletes, irreversible), `info` (everything else). */
  kind?: ConfirmKind;
  /** The room's theme, so the question wears the room it was asked in. Root when absent. */
  theme?: ConfirmTheme;
}

/** What the page decodes: the options plus the id it answers with. */
export interface ConfirmPayload extends ConfirmOptions {
  id: string;
}

/** The window's inner size in device pixels at `ui` = 1. Multiplied by the chrome scale. */
export const CONFIRM_WIDTH = 520;
export const CONFIRM_MIN_HEIGHT = 200;
export const CONFIRM_MAX_HEIGHT = 560;

const HEX = /^#[0-9a-f]{6}$/i;

function clampIndex(value: unknown, count: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isInteger(value) ? value : fallback;
  return n >= 0 && n < count ? n : Math.min(Math.max(0, fallback), Math.max(0, count - 1));
}

/**
 * The options as a window can carry them: validated, defaulted, and with a theme that is three
 * hex colours or nothing. Every call site is trusted main-process code, so this is defence
 * against a typo, not an attacker; still, the page never receives anything but strings, numbers
 * and a fixed set of kinds.
 */
export function normaliseConfirm(id: string, options: ConfirmOptions): ConfirmPayload {
  const buttons = (options.buttons ?? []).map((b) => String(b)).filter((b) => b.length > 0);
  const safeButtons = buttons.length ? buttons : ['OK'];
  const cancelId = clampIndex(options.cancelId, safeButtons.length, safeButtons.length - 1);
  const defaultId = clampIndex(options.defaultId, safeButtons.length, cancelId);
  const kind: ConfirmKind = (CONFIRM_KINDS as readonly string[]).includes(options.kind ?? '') ? (options.kind as ConfirmKind) : 'info';
  const theme = options.theme && [options.theme.maskDark, options.theme.maskLight, options.theme.signal].every((c) => HEX.test(c))
    ? { maskDark: options.theme.maskDark, maskLight: options.theme.maskLight, signal: options.theme.signal }
    : undefined;
  return {
    id,
    title: String(options.title ?? '').trim() || 'Confirm',
    message: String(options.message ?? ''),
    detail: options.detail ? String(options.detail) : undefined,
    buttons: safeButtons,
    defaultId,
    cancelId,
    kind,
    theme
  };
}

/** Base64url of the JSON, so it survives a URL hash unchanged (no `+`, `/` or `=`). */
export function encodeConfirm(payload: ConfirmPayload): string {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The inverse. `null` for anything that is not a payload this module wrote. */
export function decodeConfirm(encoded: string): ConfirmPayload | null {
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (encoded.length % 4)) % 4);
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const raw = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (typeof r['id'] !== 'string' || !Array.isArray(r['buttons'])) return null;
    return normaliseConfirm(r['id'], r as unknown as ConfirmOptions);
  } catch {
    return null;
  }
}

/** The whole hash for the confirm page: `confirm?ui=<scale>&q=<payload>`. */
export function confirmHash(ui: number, payload: ConfirmPayload): string {
  return `confirm?ui=${Math.min(3, Math.max(1, Math.round(ui) || 1))}&q=${encodeConfirm(payload)}`;
}

/**
 * The index a press resolves to. Anything outside the button list is the refusal, so a page that
 * misbehaves can only ever say no.
 */
export function answerIndex(payload: ConfirmPayload, index: unknown): number {
  return typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < payload.buttons.length
    ? index
    : payload.cancelId;
}

/** How tall the window should be for this text, in device pixels at ui = 1. Rough, clamped. */
export function confirmHeightFor(payload: ConfirmPayload): number {
  const cols = 60;
  const lines = (text: string): number => text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / cols)), 0);
  const messageLines = lines(payload.message);
  const detailLines = payload.detail ? lines(payload.detail) : 0;
  // Title strip 26, padding 32, message 13/line, detail 13/line + 16 box padding, buttons 40.
  const raw = 26 + 32 + messageLines * 13 + (detailLines ? detailLines * 13 + 16 + 8 : 0) + 40;
  return Math.min(CONFIRM_MAX_HEIGHT, Math.max(CONFIRM_MIN_HEIGHT, raw));
}
