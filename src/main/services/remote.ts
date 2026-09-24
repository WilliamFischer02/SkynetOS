import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app, dialog } from 'electron';
import type { RemoteStatusView, TailscaleInfo } from '@shared/remote.js';
import { formatPairCode } from '@shared/remote.js';
import { DeviceStore, PairingCodes } from './remote-devices.js';
import { startRemoteServer, type RemoteServer } from './remote-server.js';
import { getSettings, setRemoteSettings } from './settings.js';
import { boardWindow } from './main-window.js';
import { which } from './which.js';

/**
 * Remote, wired into the running app. The server itself (remote-server.ts) knows nothing about
 * Electron; this supplies it with the handlers, the paths and the switch.
 *
 * Off by default. William turns it on in the REMOTE panel (a user-only channel, never an agent,
 * never a paired device). Paired devices persist as token HASHES in userData; the pairing code is
 * memory only. See docs/08-REMOTE.md for the whole route from the iPhone to this function.
 */

export type RemoteDispatch = (channel: string, args: unknown[], deviceId: string) => Promise<unknown>;

let server: RemoteServer | null = null;
let starting: Promise<void> | null = null;
let devices: DeviceStore | null = null;
let dispatchFn: RemoteDispatch | null = null;
let lastError: string | null = null;
const pairing = new PairingCodes();
// Keyed by port as well as time: the answer to "is our port published" is port-specific.
let tailscaleCache: { at: number; port: number; info: TailscaleInfo } | null = null;

function userData(): string {
  return app.getPath('userData');
}

function deviceStore(): DeviceStore {
  devices ??= new DeviceStore(join(userData(), 'remote-devices.json'));
  return devices;
}

/** The built renderer: out/renderer, next to out/main. */
export function rendererDir(): string {
  return join(__dirname, '../renderer');
}

/** Main hands in `callAsRemote` once, at startup. */
export function setRemoteDispatch(fn: RemoteDispatch): void {
  dispatchFn = fn;
}

async function startServer(): Promise<void> {
  if (server) return;
  if (starting) return starting;
  starting = (async () => {
    const settings = getSettings();
    try {
      server = await startRemoteServer({
        port: settings.remotePort,
        rendererDir: rendererDir(),
        dispatch: (channel, args, device) => {
          if (!dispatchFn) return Promise.reject(new Error('SKYNETOS IS STILL STARTING'));
          return dispatchFn(channel, args, device.id);
        },
        devices: deviceStore(),
        pairing,
        auditFile: join(userData(), 'remote-audit.log'),
        allowedHosts: settings.remoteAllowedHosts,
        onTooManyFailures: () => { void setRemoteEnabled(false); },
        log: (message) => console.log(message)
      });
      lastError = null;
    } catch (err) {
      server = null;
      lastError = `COULD NOT LISTEN ON 127.0.0.1:${settings.remotePort} — ${(err as Error).message}`;
      console.error(`[remote] ${lastError}`);
    } finally {
      starting = null;
    }
  })();
  return starting;
}

export async function stopRemote(): Promise<void> {
  const s = server;
  server = null;
  pairing.clear();
  if (s) await s.close();
}

/** On startup: listen only if William turned remote on. */
export async function startRemoteIfEnabled(): Promise<void> {
  if (getSettings().remoteEnabled) await startServer();
}

export async function setRemoteEnabled(on: boolean): Promise<RemoteStatusView & { ok: boolean }> {
  const saved = setRemoteSettings({ enabled: on });
  if (!saved.ok) return { ...(await remoteStatus()), ok: false, error: saved.error ?? 'COULD NOT SAVE' };
  if (on) await startServer();
  else await stopRemote();
  const status = await remoteStatus();
  return { ...status, ok: on ? status.listening : true };
}

/** Every pushed event, to every connected device. A no-op while remote is off. */
export function remoteBroadcast(event: string, payload: unknown): void {
  server?.broadcast(event, payload);
}

function tailscaleExe(): string | null {
  const onPath = which('tailscale');
  if (onPath) return onPath;
  const installed = join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Tailscale', 'tailscale.exe');
  return existsSync(installed) ? installed : null;
}

function run(file: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error && typeof (error as NodeJS.ErrnoException).code === 'number' ? Number((error as NodeJS.ErrnoException).code) : error ? 1 : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr || (error?.message ?? '')) });
    });
  });
}

/** What Tailscale says about this machine. Cached for 20 s: the panel asks every few seconds. */
export async function tailscaleStatus(port: number, force = false): Promise<TailscaleInfo> {
  const now = Date.now();
  if (!force && tailscaleCache && tailscaleCache.port === port && now - tailscaleCache.at < 20_000) {
    return tailscaleCache.info;
  }
  const exe = tailscaleExe();
  let info: TailscaleInfo;
  if (!exe) {
    info = { installed: false, running: false, dnsName: null, serveUrl: null, serving: false, httpsReady: false };
  } else {
    const result = await run(exe, ['status', '--json'], 4000);
    try {
      const parsed = JSON.parse(result.stdout) as {
        BackendState?: string;
        Self?: { DNSName?: string };
        CertDomains?: string[] | null;
      };
      const dnsName = parsed.Self?.DNSName ? parsed.Self.DNSName.replace(/\.$/, '') : null;
      const running = parsed.BackendState === 'Running';
      /*
       * HTTPS certificates are a separate tailnet setting from MagicDNS, and `serve` needs them.
       * On this machine on 2026-09-11: MagicDNS on, `CertDomains: null` — so PUBLISH would have
       * failed with a Tailscale error and no explanation of where to go and fix it.
       */
      const httpsReady = Array.isArray(parsed.CertDomains) && parsed.CertDomains.length > 0;
      /*
       * Is our port actually published? Read it back rather than assuming, and only for this port:
       * a serve config for something else on this machine is not our URL.
       */
      let serving = false;
      if (running) {
        const served = await run(exe, ['serve', 'status'], 4000);
        serving = served.code === 0 && served.stdout.includes(`127.0.0.1:${port}`);
      }
      info = {
        installed: true,
        running,
        dnsName,
        serving,
        httpsReady,
        serveUrl: serving && dnsName ? `https://${dnsName}/` : null
      };
    } catch {
      info = {
        installed: true,
        running: false,
        dnsName: null,
        serveUrl: null,
        serving: false,
        httpsReady: false,
        error: (result.stderr || 'tailscale status failed').split('\n')[0] ?? ''
      };
    }
  }
  tailscaleCache = { at: now, port, info };
  return info;
}

export async function remoteStatus(): Promise<RemoteStatusView> {
  const settings = getSettings();
  const port = server?.port ?? settings.remotePort;
  return {
    enabled: settings.remoteEnabled,
    listening: server !== null,
    port,
    localUrl: `http://127.0.0.1:${port}/`,
    clients: server?.clientCount() ?? 0,
    devices: deviceStore().list(),
    pairing: pairing.current(),
    tailscale: await tailscaleStatus(port),
    built: existsSync(join(rendererDir(), 'index.html')),
    ...(lastError ? { error: lastError } : {})
  };
}

/** A new one-time code, and the URLs a phone can open with it already filled in. */
export async function createPairCode(): Promise<{ ok: boolean; code?: string; expiresAt?: number; urls?: string[]; error?: string }> {
  if (!server) return { ok: false, error: 'TURN REMOTE ON FIRST' };
  const { code, expiresAt } = pairing.create();
  const tail = await tailscaleStatus(server.port, true);
  const urls = [
    ...(tail.serveUrl ? [`${tail.serveUrl}#pair=${formatPairCode(code)}`] : []),
    `http://127.0.0.1:${server.port}/#pair=${formatPairCode(code)}`
  ];
  return { ok: true, code: formatPairCode(code), expiresAt, urls };
}

export function revokeDevice(id: string): { ok: boolean; error?: string } {
  const store = deviceStore();
  let ok = false;
  try {
    ok = store.revoke(String(id));
  } finally {
    // A revoked token stops working now, not at the device's next reconnect (docs/07). In a
    // `finally`, because this line is the one that must run whatever else went wrong.
    server?.disconnect(String(id));
  }
  if (store.lastRevokeError) {
    return {
      ok: false,
      error: `REVOKED UNTIL SKYNETOS RESTARTS, BUT THE DEVICE LIST COULD NOT BE SAVED, SO IT WOULD COME BACK — ${store.lastRevokeError}. PRESS REVOKE AGAIN ONCE THE FILE CAN BE WRITTEN, OR TURN REMOTE OFF`
    };
  }
  return { ok };
}

/**
 * `tailscale serve`: publish the local server to William's tailnet, over HTTPS, with Tailscale's
 * own certificate. Only ever after a native confirmation that says exactly what it changes, and
 * never from a remote device (the channel is desktop-only).
 */
export async function runTailscaleServe(): Promise<{ ok: boolean; output?: string; error?: string }> {
  const exe = tailscaleExe();
  if (!exe) return { ok: false, error: 'TAILSCALE IS NOT INSTALLED — https://tailscale.com/download/windows' };
  const port = server?.port ?? getSettings().remotePort;
  const args = ['serve', '--bg', `http://127.0.0.1:${port}`];
  const win = boardWindow();
  const options = {
    type: 'question' as const,
    buttons: ['Publish to my tailnet', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Publish SkynetOS to your tailnet?',
    message: 'Run `tailscale ' + args.join(' ') + '`?',
    detail:
      'This changes your Tailscale configuration: devices signed in to YOUR tailnet (your iPhone, iPad, laptop) ' +
      `can reach SkynetOS at https://<this-pc>.<tailnet>.ts.net, which Tailscale forwards to 127.0.0.1:${port} on this PC.\n\n` +
      'Nothing is exposed to the public internet. A device still has to pair with a one-time code before it can do anything.\n\n' +
      'To undo it later: tailscale serve reset',
    noLink: true
  };
  const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  if (response !== 0) return { ok: false, error: 'CANCELLED' };
  const result = await run(exe, args, 20_000);
  tailscaleCache = null;
  return result.code === 0
    ? { ok: true, output: result.stdout.trim() }
    : { ok: false, error: (result.stderr || result.stdout).trim().split('\n').slice(0, 3).join(' ') || `tailscale exited ${result.code}` };
}

/**
 * For the smoke capture only: a server on a random port, with devices and codes held in memory, so
 * a screenshot run can pair a "phone" window without writing anything to William's userData.
 */
export async function startRemoteForSmoke(dispatch: RemoteDispatch): Promise<{ port: number; code: string; close: () => Promise<void> }> {
  const smokePairing = new PairingCodes();
  const s = await startRemoteServer({
    port: 0,
    rendererDir: rendererDir(),
    dispatch: (channel, args, device) => dispatch(channel, args, device.id),
    devices: new DeviceStore(null),
    pairing: smokePairing,
    auditFile: null,
    log: (message) => console.log(message)
  });
  const { code } = smokePairing.create();
  return { port: s.port, code, close: () => s.close() };
}

/** For the smoke run's event fan-out check. */
export function smokeServerCount(): number {
  return server ? 1 : 0;
}
