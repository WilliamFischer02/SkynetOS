import { isDestructive, type CommandRequest } from './commands.js';

/**
 * Remote: SkynetOS from a phone, a tablet or another computer. See docs/08-REMOTE.md.
 *
 * The remote client is the SAME renderer bundle the desktop window runs, served over HTTP by main
 * (src/main/services/remote-server.ts) and talking to main over one WebSocket instead of through the
 * preload bridge. Everything here is pure: the wire format, pairing codes, which hosts may be
 * served, the page's CSP, the failure rate limit, and how a call from a remote device is made safe
 * before it reaches a handler. The allowlist itself (REMOTE_METHODS) sits with CHANNELS and
 * AGENT_METHODS in ipc.ts, where the three are read together.
 */

export const REMOTE_DEFAULT_PORT = 47821;
export const REMOTE_MAX_MESSAGE_BYTES = 1_000_000;

/** What Tailscale says about this machine, when it is installed. */
export interface TailscaleInfo {
  installed: boolean;
  running: boolean;
  /** This machine's tailnet name, e.g. `william-desktop.tail1234.ts.net`, without the trailing dot. */
  dnsName: string | null;
  /**
   * Where the phone opens SkynetOS — non-null ONLY when `tailscale serve` is actually publishing
   * this port.
   *
   * It used to be derived from "Tailscale is running and this machine has a name", which is not the
   * same question. Pressing PAIR before PUBLISH then produced a QR code pointing at a confident
   * `https://<pc>.<tailnet>.ts.net/` URL that simply would not load, with nothing on screen to say
   * why. Now it is read back from `tailscale serve status`.
   */
  serveUrl: string | null;
  /** `tailscale serve` is publishing our port right now. */
  serving: boolean;
  /**
   * The tailnet has HTTPS certificates provisioned. Without this, `tailscale serve` cannot give an
   * https URL and PUBLISH fails — and the fix is in Tailscale's admin console (DNS → HTTPS
   * Certificates), not in SkynetOS, so the panel has to say so rather than just failing.
   */
  httpsReady: boolean;
  error?: string;
}

/** The desktop's REMOTE panel, in one read. */
export interface RemoteStatusView {
  enabled: boolean;
  listening: boolean;
  port: number;
  /** http://127.0.0.1:<port>/ — only this PC can open it. */
  localUrl: string;
  clients: number;
  devices: { id: string; name: string; createdAt: string; lastSeenAt: string | null }[];
  pairing: { code: string; expiresAt: number } | null;
  tailscale: TailscaleInfo;
  /** Whether a built renderer exists to serve (`npm run build:app`). */
  built: boolean;
  error?: string;
}

/* ────────────────────────── the wire ────────────────────────── */

export type ClientMessage =
  | { t: 'auth'; token: string }
  | { t: 'call'; id: number; ch: string; args: unknown[] }
  | { t: 'ping' };

export type ServerMessage =
  | { t: 'auth'; ok: true; device: { id: string; name: string } }
  | { t: 'auth'; ok: false; error: string }
  | { t: 'result'; id: number; ok: true; value: unknown }
  | { t: 'result'; id: number; ok: false; error: string }
  | { t: 'event'; event: string; payload: unknown }
  | { t: 'pong' };

/** A client frame, checked for shape. Anything else is null and the connection is closed. */
export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > REMOTE_MAX_MESSAGE_BYTES) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const m = value as Record<string, unknown>;
  if (m['t'] === 'ping') return { t: 'ping' };
  if (m['t'] === 'auth') {
    return typeof m['token'] === 'string' && m['token'].length >= 16 && m['token'].length <= 200
      ? { t: 'auth', token: m['token'] }
      : null;
  }
  if (m['t'] === 'call') {
    const id = m['id'];
    const ch = m['ch'];
    const args = m['args'];
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 0) return null;
    if (typeof ch !== 'string' || !/^[a-z]+:[a-zA-Z]+$/.test(ch)) return null;
    if (!Array.isArray(args) || args.length > 8) return null;
    return { t: 'call', id, ch, args };
  }
  return null;
}

/* ────────────────────────── pairing ────────────────────────── */

/** No 0/O, 1/I/L: a code read off a screen and typed on a phone must survive the reading. */
export const PAIR_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PAIR_CODE_LENGTH = 8;
export const PAIR_CODE_TTL_MS = 5 * 60_000;

export function makePairCode(randomBytes: (n: number) => Uint8Array): string {
  const bytes = randomBytes(PAIR_CODE_LENGTH * 2);
  let out = '';
  // Rejection sampling, so every character is equally likely: 248 is the largest multiple of 31 under 256.
  for (let i = 0; i < bytes.length && out.length < PAIR_CODE_LENGTH; i++) {
    const b = bytes[i]!;
    if (b < 248) out += PAIR_ALPHABET[b % PAIR_ALPHABET.length];
  }
  // Astronomically unlikely to run short; topped up rather than looped, so this always returns.
  while (out.length < PAIR_CODE_LENGTH) out += PAIR_ALPHABET[randomBytes(1)[0]! % PAIR_ALPHABET.length];
  return out;
}

/** What a person types, made comparable: case, spaces and dashes do not matter. */
export function normalisePairCode(input: string): string {
  return String(input).toUpperCase().replace(/[\s-]/g, '');
}

/** The code shown in two halves, the way it is easiest to read aloud: `ABCD-EFGH`. */
export function formatPairCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/* ────────────────────────── which hosts may be served ────────────────────────── */

/**
 * DNS-rebinding protection. The server binds 127.0.0.1, so everything that reaches it came through
 * this machine: a browser on it, or `tailscale serve`, which forwards from the tailnet with the
 * tailnet name as Host. A page on some other site that points its own hostname at 127.0.0.1 would
 * send ITS name, and is refused.
 */
export function hostAllowed(hostHeader: string | undefined, port: number, extra: readonly string[] = []): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.trim().toLowerCase();
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]!;
  const withPort = host.includes(':') && !host.startsWith('[') ? Number(host.split(':')[1]) : null;
  if (name === '127.0.0.1' || name === 'localhost' || name === '[::1]') return withPort === null || withPort === port;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/.test(name)) return true;
  return extra.map((h) => h.toLowerCase()).includes(name);
}

/** The Origin a WebSocket upgrade carries must be the same host the page was served from. */
export function originMatchesHost(origin: string | undefined, hostHeader: string | undefined): boolean {
  if (!origin || !hostHeader) return false;
  try { return new URL(origin).host.toLowerCase() === hostHeader.trim().toLowerCase(); } catch { return false; }
}

/* ────────────────────────── the page ────────────────────────── */

/**
 * The CSP the remote page runs under. The desktop one allows `ws://localhost:*` for Vite's HMR; the
 * remote page talks to its own origin and nothing else. `'self'` covers the WebSocket too, and
 * `wss:`/`ws:` of the same host are named explicitly because older Safari did not count them.
 */
export function remoteCsp(host: string): string {
  const h = host.replace(/[^a-zA-Z0-9.:\-[\]]/g, '');
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    `connect-src 'self' wss://${h} ws://${h}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join('; ');
}

/** The built index.html, with its CSP swapped for the remote one and a marker the client can read. */
export function rewriteIndexHtml(html: string, host: string): string {
  const withCsp = html.replace(
    /<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/i,
    `<meta http-equiv="Content-Security-Policy" content="${remoteCsp(host)}" />`
  );
  return withCsp.replace(
    /<meta name="viewport"[^>]*>/i,
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />\n    <meta name="skynet-remote" content="1" />\n    <meta name="apple-mobile-web-app-capable" content="yes" />'
  );
}

/* ────────────────────────── failures ────────────────────────── */

/** Failed pairings in a sliding window. Past the limit the caller stops listening altogether. */
export class FailureWindow {
  private readonly times: number[] = [];
  constructor(private readonly limit: number, private readonly windowMs: number) {}

  record(now: number): number {
    this.times.push(now);
    return this.count(now);
  }

  count(now: number): number {
    while (this.times.length && now - this.times[0]! > this.windowMs) this.times.shift();
    return this.times.length;
  }

  exceeded(now: number): boolean {
    return this.count(now) >= this.limit;
  }
}

/* ────────────────────────── making a remote call safe ────────────────────────── */

/**
 * What a remote call may carry, rewritten before any handler sees it. The allowlist decides WHICH
 * channels; this decides what their arguments may say.
 *
 *   - `command:apply`: attributed to `remote` whatever it claims, `approved` stripped, and a
 *     destructive command refused outright. docs/07 wants deletion approved in the desktop UI's
 *     native dialog; a phone-side confirmation is designed for later (docs/08), not assumed now.
 *   - `prompt:send`: text only. The files a prompt attaches are PATHS on this disk, which a phone
 *     cannot choose, and accepting any would let a remote page name files for SkynetOS to upload.
 */
export function prepareRemoteCall(channel: string, args: readonly unknown[]): { args: unknown[] } | { refuse: string } {
  if (channel === 'command:apply') {
    const request = (args[0] ?? {}) as CommandRequest;
    if (!request || typeof request !== 'object' || !request.command) return { refuse: 'NOT A COMMAND' };
    if (isDestructive(request.command)) {
      return { refuse: 'DELETIONS ARE CONFIRMED ON THE DESKTOP — remote cannot approve a destructive edit yet' };
    }
    const { approved: _dropped, ...rest } = request;
    return { args: [{ ...rest, actor: 'remote' }] };
  }
  if (channel === 'prompt:send') {
    const request = (args[0] ?? {}) as Record<string, unknown>;
    return { args: [{ ...request, files: [] }] };
  }
  return { args: [...args] };
}
