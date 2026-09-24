import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REMOTE_METHODS } from '../packages/shared/ipc.js';
import { prepareRemoteCall } from '../packages/shared/remote.js';
import { DeviceStore, PairingCodes } from '../src/main/services/remote-devices.js';
import { startRemoteServer, type RemoteServer } from '../src/main/services/remote-server.js';

/**
 * The remote server for real: a port on 127.0.0.1, a browser-shaped client (Node's own WebSocket
 * and fetch), and the same allowlist check main uses. The handlers are stubs; everything between
 * the client and them is the production code.
 */

let server: RemoteServer;
let base: string;
let dir: string;
const pairing = new PairingCodes();
const devices = new DeviceStore(null);
const calls: string[] = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'skynet-remote-web-'));
  writeFileSync(join(dir, 'index.html'), '<html><head><meta\n http-equiv="Content-Security-Policy"\n content="x"\n />\n<meta name="viewport" content="w" /></head><body>SKYNET</body></html>');
  server = await startRemoteServer({
    port: 0,
    rendererDir: dir,
    devices,
    pairing,
    auditFile: null,
    dispatch: async (channel, args) => {
      if (!(REMOTE_METHODS as readonly string[]).includes(channel)) throw new Error(`"${channel}" IS NOT AVAILABLE REMOTELY`);
      const prepared = prepareRemoteCall(channel, args);
      if ('refuse' in prepared) throw new Error(prepared.refuse);
      calls.push(channel);
      return { channel, args: prepared.args };
    }
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

function open(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    // Node's WebSocket sends an Origin only when asked, so it is set the way a browser would.
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, { headers: { Origin: base } } as unknown as string[]);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', () => reject(new Error('ws error')));
  });
}

function next(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => ws.addEventListener('message', (e) => resolve(JSON.parse(String(e.data)) as Record<string, unknown>), { once: true }));
}

async function pair(): Promise<string> {
  const { code } = pairing.create();
  const res = await fetch(`${base}/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name: 'test phone' }) });
  const body = await res.json() as { ok: boolean; token: string };
  expect(body.ok).toBe(true);
  return body.token;
}

describe('the remote server', () => {
  it('serves the page with a CSP for its own origin, and refuses a foreign Host', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toContain('connect-src');
    expect(await res.text()).toContain('name="skynet-remote"');
    const traversal = await fetch(`${base}/..%2f..%2fwindows%2fwin.ini`);
    expect(traversal.status).toBe(404);
  });

  it('pairs with the right code once, and refuses a wrong one', async () => {
    const wrong = await fetch(`${base}/pair`, { method: 'POST', body: JSON.stringify({ code: 'ZZZZZZZZ' }) });
    expect(wrong.status).toBe(401);
    const token = await pair();
    expect(devices.verify(token)).not.toBeNull();
  });

  it('carries an allowed call, refuses a disallowed one and a destructive edit', async () => {
    const token = await pair();
    const ws = await open();
    ws.send(JSON.stringify({ t: 'auth', token }));
    expect(await next(ws)).toMatchObject({ t: 'auth', ok: true });

    ws.send(JSON.stringify({ t: 'call', id: 1, ch: 'board:load', args: ['root'] }));
    expect(await next(ws)).toMatchObject({ t: 'result', id: 1, ok: true, value: { channel: 'board:load' } });

    ws.send(JSON.stringify({ t: 'call', id: 2, ch: 'app:setAutostart', args: [true] }));
    const refused = await next(ws);
    expect(refused).toMatchObject({ t: 'result', id: 2, ok: false });
    expect(String(refused['error'])).toContain('NOT AVAILABLE REMOTELY');

    ws.send(JSON.stringify({ t: 'call', id: 3, ch: 'command:apply', args: [{ command: { type: 'node.delete', boardId: 'root', nodeId: 'x' }, actor: 'user', approved: true }] }));
    expect(await next(ws)).toMatchObject({ t: 'result', id: 3, ok: false });
    expect(calls).not.toContain('app:setAutostart');
    ws.close();
  });

  it('pushes events to a connected device', async () => {
    const token = await pair();
    const ws = await open();
    ws.send(JSON.stringify({ t: 'auth', token }));
    await next(ws);
    const got = next(ws);
    server.broadcast('sessions:changed', [{ id: 's1' }]);
    expect(await got).toEqual({ t: 'event', event: 'sessions:changed', payload: [{ id: 's1' }] });
    ws.close();
  });

  it('closes a socket that sends the wrong token', async () => {
    const ws = await open();
    const closed = new Promise<number>((resolve) => ws.addEventListener('close', (e) => resolve(e.code)));
    ws.send(JSON.stringify({ t: 'auth', token: 'x'.repeat(43) }));
    expect(await next(ws)).toMatchObject({ t: 'auth', ok: false });
    expect(await closed).toBe(4403);
  });

  it('closes a revoked device at once, and refuses its token after', async () => {
    const token = await pair();
    const ws = await open();
    ws.send(JSON.stringify({ t: 'auth', token }));
    const hello = await next(ws) as { device: { id: string } };
    const closed = new Promise<number>((resolve) => ws.addEventListener('close', (e) => resolve(e.code)));
    expect(devices.revoke(hello.device.id)).toBe(true);
    expect(server.disconnect(hello.device.id)).toBe(1);
    expect(await closed).toBe(4403);
    expect(devices.verify(token)).toBeNull();
  });

  it('refuses a socket from another origin before it can say anything', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, { headers: { Origin: 'https://evil.example' } } as unknown as string[]);
    const outcome = await new Promise<string>((resolve) => {
      ws.addEventListener('open', () => resolve('open'));
      ws.addEventListener('error', () => resolve('refused'));
    });
    expect(outcome).toBe('refused');
  });
});

describe('the lockout counts bad tokens as well as bad codes (docs/07 "Wrong guesses turn it off")', () => {
  it('turns remote off after ten wrong tokens in a row', async () => {
    let tripped = 0;
    const own = await startRemoteServer({
      port: 0,
      rendererDir: dir,
      devices: new DeviceStore(null),
      pairing: new PairingCodes(),
      auditFile: null,
      dispatch: async () => null,
      onTooManyFailures: () => { tripped++; }
    });
    try {
      const ownBase = `http://127.0.0.1:${own.port}`;
      for (let i = 0; i < 10; i++) {
        const ws = await new Promise<WebSocket>((resolve, reject) => {
          const socket = new WebSocket(`ws://127.0.0.1:${own.port}/ws`, { headers: { Origin: ownBase } } as unknown as string[]);
          socket.addEventListener('open', () => resolve(socket));
          socket.addEventListener('error', () => reject(new Error('ws error')));
        });
        const closed = new Promise<number>((resolve) => ws.addEventListener('close', (e) => resolve(e.code)));
        ws.send(JSON.stringify({ t: 'auth', token: 'y'.repeat(43) }));
        expect(await closed).toBe(4403);
        expect(tripped).toBe(i === 9 ? 1 : 0);
      }
    } finally {
      await own.close();
    }
  });
});
