/**
 * Target resolution — the answer to "does this node point at something real?"
 *
 * Prime directive 1: "Every node resolves to a real path, URL, or process. If it can't resolve,
 * show it broken. Never mock, never stub-and-forget, never fabricate a file listing."
 *
 * So resolution is a first-class result type, not a boolean. `state` is what the sprite and the
 * inspector render from, and `detail` is the sentence printed under it — in the board's voice:
 * "TARGET NOT FOUND — C:/dev/TheStalker/build/libs/*.jar".
 */

export type TargetState =
  /** Resolves, exists, all good. */
  | 'ok'
  /** Nothing to resolve — note.silk, group.zone, monitor.system. Not an error. */
  | 'none'
  /** The field is empty. A node that has not been pointed at anything yet. */
  | 'unset'
  /** Resolved, but the thing is not there. */
  | 'missing'
  /** Syntactically wrong — a malformed URL, a glob with no wildcard. */
  | 'invalid'
  /** Outside every dev root and outside the user profile. Usable, but confirmed on every click. */
  | 'outside-dev-root'
  /** We could not tell. Permission denied, a disconnected network drive. */
  | 'unknown';

export interface TargetInfo {
  state: TargetState;
  /** The raw field value, as typed. */
  raw: string | null;
  /** Absolute, normalised, env-expanded. Null when nothing resolved. */
  resolved: string | null;
  /** One sentence for the UI. Always populated when state is not 'ok' or 'none'. */
  detail: string | null;
  kind?: 'file' | 'directory' | 'url';
  sizeBytes?: number;
  mtimeMs?: number;
  /** For a glob: how many files matched, and which one won on mtime. */
  matchCount?: number;
  /** For a glob with a versionPattern: the captured version label. */
  versionLabel?: string;
}

export const OK_STATES: readonly TargetState[] = ['ok', 'none'];

export function isBroken(info: TargetInfo): boolean {
  return !OK_STATES.includes(info.state);
}

/**
 * URL shape validation. Deliberately does NOT hit the network.
 *
 * Two reasons: docs/01 says the renderer never touches the network, and main firing a request at
 * whatever URL is typed would leak to a third party at edit time — on a machine that is going to
 * be streamed. A URL that 404s is a fact about the internet at that moment, not about the board.
 * We check that it is a well-formed http/https URL and say plainly that we did not fetch it.
 */
export function validateUrl(raw: string): { ok: true; normalised: string } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'URL is empty' };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: `MALFORMED URL — ${trimmed}` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `UNSUPPORTED SCHEME "${url.protocol}" — only http and https open in a browser` };
  }
  if (!url.hostname) return { ok: false, reason: `URL HAS NO HOST — ${trimmed}` };
  return { ok: true, normalised: url.toString() };
}

/** A placeholder left in the seeded board data, which must be replaced before the node works. */
export function looksLikePlaceholder(value: string): boolean {
  return /REPLACE_ME|REPLACE_WITH_/.test(value);
}
