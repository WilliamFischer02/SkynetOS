import { createServer, type Server, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { controlFilePath, ownsControlFile } from '@shared/control-file.js';
import { dirname, join } from 'node:path';
import { app } from 'electron';

/**
 * The control channel: how an agent reaches the running board.
 *
 * ── The shape of the problem ──────────────────────────────────────────────────────────────────
 *
 * `skynet-mcp` is an MCP stdio server, which means Claude Code SPAWNS it as a child process. It
 * therefore cannot be the Electron main process — main is already running and owns the board, the
 * database, the command bus and the undo stack. So the MCP server is a thin proxy, and this is
 * what it proxies to.
 *
 * ── Why a pipe and not a port ─────────────────────────────────────────────────────────────────
 *
 * A localhost TCP port is reachable by every process on the machine and, on a misconfigured box,
 * from the network. A named pipe (`\\.\pipe\...` on Windows, a filesystem socket elsewhere) is
 * neither: it has no port, it is not routable, and it is subject to the same user-account boundary
 * that already protects sessions.db and settings.json. That boundary is the one this app already
 * relies on everywhere else, so using a second, weaker one for the most powerful surface in the
 * program would be indefensible.
 *
 * A random token is written next to it and required on every request. It is not the security
 * boundary — the pipe is — but it means a process that stumbles onto the pipe name cannot drive
 * the board without also being able to read the user's own AppData.
 *
 * ── What it does NOT do ───────────────────────────────────────────────────────────────────────
 *
 * It has no method table of its own. Every request is dispatched to a handler registered by
 * src/main/ipc.ts from the SAME allowlist the renderer uses, so an agent can reach exactly the
 * surface a human can and not one call more. In particular there is no route to `settings:setPlan`
 * or to anything else that grants access — see `AGENT_METHODS` there, and docs/07 §Agent authority.
 */

export interface ControlRequest {
  id: number;
  token: string;
  method: string;
  params: unknown[];
}

export interface ControlResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export type ControlHandler = (method: string, params: unknown[]) => Promise<unknown>;

let server: Server | null = null;
let token = '';
let pipePath = '';

/**
 * Where the MCP proxy looks to find us. Same directory as every other bit of app state.
 *
 * `SKYNET_CONTROL_FILE` overrides it so a test can stand up a control channel without writing over
 * the real one and pointing every agent on this machine at a fixture.
 */
export function controlFile(): string {
  // A smoke run keeps its own, in its capture folder, so it can never take the live app's.
  // packages/shared/control-file.ts has the fault that taught this.
  return controlFilePath(process.env, app.getPath('userData'));
}

function makePipePath(): string {
  const id = randomBytes(6).toString('hex');
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\skynetos-${id}`
    : join(app.getPath('temp'), `skynetos-${id}.sock`);
}

/**
 * Start listening. Returns the details the proxy needs, and writes them where it will look.
 *
 * The token is minted per RUN, not stored: a stale control.json from a crashed session names a
 * pipe that no longer exists and a token nothing will accept, which is the correct outcome.
 */
export function startControlServer(handle: ControlHandler): { pipePath: string; token: string } | null {
  if (server) return { pipePath, token };

  token = randomBytes(32).toString('hex');
  pipePath = makePipePath();

  server = createServer((socket: Socket) => {
    socket.setEncoding('utf8');
    let buffer = '';

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      /*
       * Newline-delimited JSON. A board read can be tens of kilobytes, so a message can and does
       * span several chunks — the buffer is what stops a large response being parsed as garbage.
       */
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (line.trim()) void dispatch(socket, line, handle);
      }
    });

    socket.on('error', (err) => console.warn('[control] socket error:', err.message));
  });

  server.on('error', (err) => {
    console.error('[control] could not listen:', err.message);
    server = null;
  });

  try {
    server.listen(pipePath, () => {
      mkdirSync(dirname(controlFile()), { recursive: true });
      writeFileSync(controlFile(), JSON.stringify({ pipePath, token, pid: process.pid }, null, 2), 'utf8');
      console.log(`[control] listening on ${pipePath}`);
    });
  } catch (err) {
    console.error('[control] listen threw:', (err as Error).message);
    server = null;
    return null;
  }

  return { pipePath, token };
}

async function dispatch(socket: Socket, line: string, handle: ControlHandler): Promise<void> {
  let request: ControlRequest;
  try {
    request = JSON.parse(line) as ControlRequest;
  } catch {
    socket.write(`${JSON.stringify({ id: 0, ok: false, error: 'MALFORMED REQUEST' })}\n`);
    return;
  }

  const reply = (response: ControlResponse): void => {
    try {
      socket.write(`${JSON.stringify(response)}\n`);
    } catch (err) {
      console.warn('[control] could not reply:', (err as Error).message);
    }
  };

  if (request.token !== token) {
    // Deliberately not specific about why. A caller with the wrong token learns nothing.
    reply({ id: request.id, ok: false, error: 'REFUSED' });
    return;
  }

  try {
    const result = await handle(request.method, request.params ?? []);
    reply({ id: request.id, ok: true, result });
  } catch (err) {
    reply({ id: request.id, ok: false, error: (err as Error).message });
  }
}

export function stopControlServer(): void {
  server?.close();
  server = null;
  // The file names a pipe that is gone. Leaving it behind makes the next proxy wait on nothing.
  // But only OUR file: another copy of SkynetOS may have written its own over it since, and
  // removing that one tells every agent the board is closed while it is open.
  try {
    let raw: string | null = null;
    try { raw = readFileSync(controlFile(), 'utf8'); } catch { /* already gone */ }
    if (ownsControlFile(raw, process.pid)) rmSync(controlFile(), { force: true });
  } catch { /* nothing to clean up */ }
}
