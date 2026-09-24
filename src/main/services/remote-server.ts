import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { Duplex } from 'node:stream';
import {
  FailureWindow,
  REMOTE_MAX_MESSAGE_BYTES,
  hostAllowed,
  originMatchesHost,
  parseClientMessage,
  remoteCsp,
  rewriteIndexHtml,
  type ServerMessage
} from '@shared/remote.js';
import { upgradeToWebSocket, type WsConnection } from './websocket.js';
import { appendAudit, type DeviceStore, type PairingCodes, type RemoteDevice } from './remote-devices.js';

/**
 * The remote server: the renderer over HTTP, and the bridge over one WebSocket. No Electron here;
 * src/main/services/remote.ts supplies the handlers and the paths, and the tests start this in
 * plain Node (test/remote-server.test.ts).
 *
 *   GET  /          the built index.html, with a CSP for this origin
 *   GET  /assets/…  the built renderer, read-only, nothing outside rendererDir
 *   POST /pair      { code, name } → { token }  (the one-time code from the desktop)
 *   WS   /ws        { t:'auth', token } first, then calls and pushed events
 *
 * It binds 127.0.0.1 and nothing else. Reaching it from another device goes through something
 * that terminates on this machine: `tailscale serve` (docs/08). Every request is held to a Host
 * allowlist, and every upgrade to a same-origin check, before anything else is read.
 */

export interface RemoteServerOptions {
  port: number;
  rendererDir: string;
  /** Run one allowlisted call for a device. Throw or reject for an error the client sees. */
  dispatch: (channel: string, args: unknown[], device: RemoteDevice) => Promise<unknown>;
  devices: DeviceStore;
  pairing: PairingCodes;
  auditFile: string | null;
  allowedHosts?: readonly string[];
  /** Too many bad pairings: the caller turns remote off. */
  onTooManyFailures?: () => void;
  log?: (message: string) => void;
}

export interface RemoteServer {
  readonly port: number;
  broadcast(event: string, payload: unknown): void;
  clientCount(): number;
  /** Close every open connection of one device at once, with 4403 (REVOKE). Returns how many. */
  disconnect(deviceId: string): number;
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.webp': 'image/webp'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin'
};

const AUTH_TIMEOUT_MS = 5000;
const PAIR_FAILURE_LIMIT = 10;
const PAIR_FAILURE_WINDOW_MS = 10 * 60_000;

export async function startRemoteServer(opts: RemoteServerOptions): Promise<RemoteServer> {
  const log = opts.log ?? (() => undefined);
  const failures = new FailureWindow(PAIR_FAILURE_LIMIT, PAIR_FAILURE_WINDOW_MS);
  const clients = new Set<{ conn: WsConnection; device: RemoteDevice }>();
  const root = resolve(opts.rendererDir);
  let boundPort = opts.port;

  const refuse = (res: ServerResponse, code: number, text: string): void => {
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    res.end(text);
  };

  const serveFile = (req: IncomingMessage, res: ServerResponse, urlPath: string): void => {
    const host = String(req.headers.host ?? '');
    if (urlPath === '/' || urlPath === '/index.html') {
      const index = join(root, 'index.html');
      if (!existsSync(index)) { refuse(res, 503, 'SkynetOS has no built renderer yet. On the PC: npm run build:app'); return; }
      const html = rewriteIndexHtml(readFileSync(index, 'utf8'), host);
      res.writeHead(200, {
        'Content-Type': TYPES['.html']!, 'Cache-Control': 'no-store',
        'Content-Security-Policy': remoteCsp(host), ...SECURITY_HEADERS
      });
      res.end(html);
      return;
    }
    // Only real files inside the renderer folder: no `..`, no absolute paths, no directories.
    let decoded: string;
    try { decoded = decodeURIComponent(urlPath); } catch { refuse(res, 400, 'bad path'); return; }
    const target = resolve(root, '.' + normalize(decoded).replace(/\\/g, '/'));
    if (target !== root && !target.startsWith(root + sep)) { refuse(res, 404, 'not found'); return; }
    let isFile = false;
    try { isFile = statSync(target).isFile(); } catch { isFile = false; }
    if (!isFile) { refuse(res, 404, 'not found'); return; }
    const type = TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store',
      ...SECURITY_HEADERS
    });
    res.end(readFileSync(target));
  };

  const readBody = (req: IncomingMessage, limit: number): Promise<string | null> => new Promise((done) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { done(null); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => done(null));
  });

  const pair = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const now = Date.now();
    if (failures.exceeded(now)) { refuse(res, 429, 'too many pairing attempts'); return; }
    const origin = req.headers.origin;
    if (origin && !originMatchesHost(origin, req.headers.host)) { refuse(res, 403, 'cross-origin'); return; }
    const body = await readBody(req, 4096);
    let parsed: { code?: unknown; name?: unknown } = {};
    try { parsed = JSON.parse(body ?? '') as typeof parsed; } catch { /* stays empty */ }
    const code = typeof parsed.code === 'string' ? parsed.code : '';
    if (!code || !opts.pairing.consume(code)) {
      const count = failures.record(now);
      log(`[remote] pairing refused (${count}/${PAIR_FAILURE_LIMIT})`);
      appendAudit(opts.auditFile, { at: new Date(now).toISOString(), device: '-', channel: 'pair', ok: false, error: 'bad code' });
      if (failures.exceeded(now)) { log('[remote] too many bad codes or tokens: turning remote off'); opts.onTooManyFailures?.(); }
      res.writeHead(401, { 'Content-Type': 'application/json', ...SECURITY_HEADERS });
      res.end(JSON.stringify({ ok: false, error: 'THAT CODE IS WRONG OR EXPIRED — make a new one on the PC' }));
      return;
    }
    const name = typeof parsed.name === 'string' ? parsed.name : 'device';
    const { device, token } = opts.devices.issue(name);
    log(`[remote] paired "${device.name}"`);
    appendAudit(opts.auditFile, { at: new Date().toISOString(), device: device.id, channel: 'pair', ok: true });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
    res.end(JSON.stringify({ ok: true, token, device: { id: device.id, name: device.name } }));
  };

  const server: Server = createServer((req, res) => {
    if (!hostAllowed(req.headers.host, boundPort, opts.allowedHosts)) { refuse(res, 421, 'misdirected request'); return; }
    const urlPath = (req.url ?? '/').split('?')[0]!;
    if (req.method === 'POST' && urlPath === '/pair') { void pair(req, res); return; }
    if (req.method === 'GET' || req.method === 'HEAD') { serveFile(req, res, urlPath); return; }
    refuse(res, 405, 'method not allowed');
  });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/ws' || !hostAllowed(req.headers.host, boundPort, opts.allowedHosts) || !originMatchesHost(req.headers.origin, req.headers.host)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const conn = upgradeToWebSocket(req, socket, head, REMOTE_MAX_MESSAGE_BYTES);
    if (!conn) return;

    let client: { conn: WsConnection; device: RemoteDevice } | null = null;
    const send = (message: ServerMessage): void => conn.send(JSON.stringify(message));
    const authTimer = setTimeout(() => { if (!client) conn.close(4401, 'auth timeout'); }, AUTH_TIMEOUT_MS);

    conn.on('message', (raw: string) => {
      const message = parseClientMessage(raw);
      if (!message) { conn.close(1008, 'bad message'); return; }
      if (message.t === 'ping') { send({ t: 'pong' }); return; }
      if (!client) {
        if (message.t !== 'auth') { conn.close(4401, 'auth first'); return; }
        const device = opts.devices.verify(message.token);
        if (!device) {
          // A bad token counts toward the same lockout as a bad pairing code (docs/07 "Wrong
          // guesses turn it off"). Until 2026-09-23 only codes counted, so a token could be guessed
          // at without limit while the doc said otherwise.
          const now = Date.now();
          const count = failures.record(now);
          log(`[remote] bad token refused (${count}/${PAIR_FAILURE_LIMIT})`);
          appendAudit(opts.auditFile, { at: new Date(now).toISOString(), device: '-', channel: 'auth', ok: false, error: 'bad token' });
          send({ t: 'auth', ok: false, error: 'THIS DEVICE IS NOT PAIRED, OR WAS REVOKED' });
          conn.close(4403, 'unknown device');
          if (failures.exceeded(now)) { log('[remote] too many bad codes or tokens: turning remote off'); opts.onTooManyFailures?.(); }
          return;
        }
        clearTimeout(authTimer);
        client = { conn, device };
        clients.add(client);
        opts.devices.touch(device.id);
        send({ t: 'auth', ok: true, device: { id: device.id, name: device.name } });
        log(`[remote] "${device.name}" connected (${clients.size} open)`);
        return;
      }
      if (message.t !== 'call') return;
      const { id, ch, args } = message;
      const at = new Date().toISOString();
      void opts.dispatch(ch, args, client.device)
        .then((value) => {
          send({ t: 'result', id, ok: true, value: value === undefined ? null : value });
          appendAudit(opts.auditFile, { at, device: client!.device.id, channel: ch, ok: true });
        })
        .catch((err: unknown) => {
          const error = (err as Error)?.message ?? String(err);
          send({ t: 'result', id, ok: false, error });
          appendAudit(opts.auditFile, { at, device: client!.device.id, channel: ch, ok: false, error: error.slice(0, 200) });
        });
    });

    conn.on('close', () => {
      clearTimeout(authTimer);
      if (client) { clients.delete(client); log(`[remote] "${client.device.name}" disconnected (${clients.size} open)`); }
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    // 127.0.0.1 and only 127.0.0.1. See the module header and docs/08.
    server.listen(opts.port, '127.0.0.1', () => {
      server.off('error', rejectListen);
      const address = server.address();
      if (address && typeof address === 'object') boundPort = address.port;
      resolveListen();
    });
  });
  log(`[remote] listening on http://127.0.0.1:${boundPort}`);

  return {
    get port() { return boundPort; },
    broadcast(event: string, payload: unknown): void {
      const text = JSON.stringify({ t: 'event', event, payload } satisfies ServerMessage);
      for (const c of clients) if (c.conn.isOpen) c.conn.send(text);
    },
    clientCount: () => clients.size,
    disconnect(deviceId: string): number {
      let closed = 0;
      for (const c of clients) {
        if (c.device.id !== deviceId) continue;
        c.conn.close(4403, 'device revoked');
        clients.delete(c);
        closed++;
      }
      if (closed) log(`[remote] revoked device closed (${closed} connection${closed === 1 ? '' : 's'})`);
      return closed;
    },
    close: () => new Promise<void>((done) => {
      for (const c of clients) c.conn.close(1001, 'server going away');
      clients.clear();
      server.close(() => done());
      server.closeAllConnections?.();
    })
  };
}
