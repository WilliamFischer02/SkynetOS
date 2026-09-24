import type { Session } from 'electron';

/**
 * Who may ask the operating system for what.
 *
 * Found on 2026-09-11, while building gesture control: main set NO permission handlers at all, so
 * Electron's defaults decided. Electron's default handler grants most requests, which meant any
 * script in the board window could have asked for the camera, the microphone or notifications and
 * been given them without anything appearing on screen. docs/07-SECURITY.md hardens the renderer in
 * every other respect; this was the gap.
 *
 * The rule now: deny by default, everywhere, and grant one permission to one window. `media` is
 * granted ONLY on the vision partition (services/vision.ts), which is the only page in the app
 * served from `skynet://vision` and the only one that opens a camera.
 *
 * Both handlers are needed and they are not redundant: `setPermissionRequestHandler` answers a page
 * that asks, and `setPermissionCheckHandler` answers a synchronous capability check — a page that
 * only consults `navigator.permissions` would otherwise be told "yes" by the default.
 *
 * NOT covered here, deliberately: the claude.ai conversation window, which runs in its own
 * partition (`persist:jarvis`). Denying everything there would also take away whatever claude.ai's
 * own voice features ask for, and that is William's call, not a side effect of gesture control.
 * Flagged rather than changed.
 */

/**
 * Writing to the clipboard, and nothing else.
 *
 * The board copies a resume command, the About box copies its version block and the mailbox copies
 * a message — three `navigator.clipboard.writeText` calls that Chromium gates behind
 * `clipboard-sanitized-write`. A blanket denial silently broke all three, which is why this
 * exception exists and why it is this one permission: `clipboard-read` stays refused, since reading
 * the clipboard is how a page learns what you copied somewhere else.
 */
const ALLOWED: ReadonlySet<string> = new Set(['clipboard-sanitized-write']);

/** Every permission refused but a clipboard write. Applied to the default session. */
export function denyAllPermissions(session: Session, label: string): void {
  session.setPermissionRequestHandler((_contents, permission, done) => {
    const allowed = ALLOWED.has(permission);
    if (!allowed) console.log(`[permissions] ${label}: refused "${permission}"`);
    done(allowed);
  });
  session.setPermissionCheckHandler((_contents, permission) => ALLOWED.has(permission));
}

/**
 * Cameras and microphones, and nothing else. For the vision partition only.
 *
 * Note what is still refused here: geolocation, notifications, MIDI, pointer lock, display capture,
 * clipboard reads. A page that needs a camera does not need the screen.
 */
export function allowMediaOnly(session: Session, label: string): void {
  session.setPermissionRequestHandler((_contents, permission, done) => {
    const allowed = permission === 'media' || ALLOWED.has(permission);
    if (!allowed) console.log(`[permissions] ${label}: refused "${permission}"`);
    done(allowed);
  });
  session.setPermissionCheckHandler((_contents, permission) => permission === 'media' || ALLOWED.has(permission));
}

/**
 * A microphone, and nothing else. For the voice partition only (services/voice.ts).
 *
 * Narrower than the vision grant on purpose: `media` covers cameras too, and the page that hears the room
 * has no business seeing it. Chromium says which kinds a media request is for, so a request that includes
 * video is refused even though one for audio alone is granted.
 */
export function allowMicrophoneOnly(session: Session, label: string): void {
  session.setPermissionRequestHandler((_contents, permission, done, details) => {
    const types = (details as { mediaTypes?: string[] } | undefined)?.mediaTypes ?? [];
    const allowed = (permission === 'media' && types.length > 0 && types.every((type) => type === 'audio')) || ALLOWED.has(permission);
    if (!allowed) console.log(`[permissions] ${label}: refused "${permission}"${types.length ? ` (${types.join(', ')})` : ''}`);
    done(allowed);
  });
  session.setPermissionCheckHandler((_contents, permission, _origin, details) => {
    const type = (details as { mediaType?: string } | undefined)?.mediaType;
    return (permission === 'media' && type !== 'video') || ALLOWED.has(permission);
  });
}
