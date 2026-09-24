import { CHANNELS, REMOTE_METHODS, type EventName, type SkynetBridge, type SkynetEvents } from '@shared/ipc.js';
import type { ClientMessage, ServerMessage } from '@shared/remote.js';

/**
 * The remote half of `window.skynet`: the same bridge the desktop's preload builds, carried over
 * one WebSocket to the PC instead of Electron IPC. docs/08-REMOTE.md.
 *
 * Installed only on a page served by the remote server (it carries `<meta name="skynet-remote">`
 * and has no preload), before the app mounts. Every panel then works unchanged: a call goes out
 * as `{t:'call', id, ch, args}` and resolves when `{t:'result', id}` comes back; a pushed event
 * arrives as `{t:'event'}` and reaches the same `on()` handlers the desktop uses.
 *
 * What cannot cross:
 *   - `display:info` is answered HERE, about this screen. The PC's scale factor means nothing on
 *     a phone, whose CSS pixels are already device-scaled.
 *   - `pathsForFiles` returns nothing: a file on the phone is not a path on the PC. Attachments
 *     from the phone are a later milestone (docs/08).
 *   - A channel outside REMOTE_METHODS rejects with a sentence, so the store's usual error path
 *     shows it as a toast rather than the app throwing.
 */

export type RemoteConnection = 'pairing' | 'connecting' | 'connected' | 'offline' | 'refused';

const TOKEN_KEY = 'skynet.remote.token';
const CALL_TIMEOUT_MS = 60_000;
const REMOTE_SET: ReadonlySet<string> = new Set(REMOTE_METHODS);
const CHANNEL_SET: ReadonlySet<string> = new Set(CHANNELS);

export function isRemotePage(): boolean {
  return document.querySelector('meta[name="skynet-remote"]') !== null || typeof (window as { skynet?: unknown }).skynet === 'undefined';
}

function readToken(): string | null {
  try { return window.localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function writeToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch { /* a private tab: the pairing lasts until the tab closes */ }
}

/** A readable default name for a device, from what the browser says it is. */
export function guessDeviceName(ua: string = navigator.userAgent): string {
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  return 'Browser';
}

export class RemoteClient {
  state: RemoteConnection = readToken() ? 'connecting' : 'pairing';
  error: string | null = null;
  deviceName: string | null = null;
  /** True once the first connection succeeded: the app is mounted from then on. */
  everConnected = false;

  private ws: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly queue: ClientMessage[] = [];
  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
  private readonly stateListeners = new Set<() => void>();
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  onState(listener: () => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private setState(next: RemoteConnection, error: string | null = null): void {
    this.state = next;
    this.error = error;
    for (const l of this.stateListeners) l();
  }

  /** Exchange a one-time code from the PC for this device's token. */
  async pair(code: string, name: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch('/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name })
      });
      const body = await res.json() as { ok: boolean; token?: string; error?: string };
      if (!body.ok || !body.token) return { ok: false, error: body.error ?? `PAIRING FAILED (${res.status})` };
      writeToken(body.token);
      this.connect();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `CANNOT REACH SKYNETOS — ${(err as Error).message}` };
    }
  }

  connect(): void {
    const token = readToken();
    if (!token) { this.setState('pairing'); return; }
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.setState('connecting');
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.ws = ws;
    ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'auth', token } satisfies ClientMessage)));
    ws.addEventListener('message', (event) => this.onMessage(String(event.data)));
    ws.addEventListener('close', (event) => this.onClose(event.code));
  }

  /** Forget this device's pairing (the PC can also revoke it). */
  unpair(): void {
    writeToken(null);
    this.ws?.close();
    this.setState('pairing');
  }

  private onMessage(raw: string): void {
    let message: ServerMessage;
    try { message = JSON.parse(raw) as ServerMessage; } catch { return; }
    if (message.t === 'auth') {
      if (message.ok) {
        this.retry = 0;
        this.everConnected = true;
        this.deviceName = message.device.name;
        this.setState('connected');
        for (const queued of this.queue.splice(0)) this.ws?.send(JSON.stringify(queued));
      } else {
        writeToken(null);
        this.setState('refused', message.error);
      }
      return;
    }
    if (message.t === 'result') {
      const p = this.pending.get(message.id);
      if (!p) return;
      this.pending.delete(message.id);
      clearTimeout(p.timer);
      if (message.ok) p.resolve(message.value);
      else p.reject(new Error(message.error));
      return;
    }
    if (message.t === 'event') {
      for (const h of this.handlers.get(message.event) ?? []) {
        try { h(message.payload); } catch (err) { console.error('[remote] event handler failed', err); }
      }
    }
  }

  private onClose(code: number): void {
    this.ws = null;
    if (this.state === 'refused' || this.state === 'pairing') return;
    if (code === 4403) { writeToken(null); this.setState('refused', 'THIS DEVICE IS NOT PAIRED, OR WAS REVOKED'); return; }
    // Calls in flight cannot be answered by a new connection: fail them now, with a reason.
    for (const [id, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('CONNECTION TO SKYNETOS LOST')); this.pending.delete(id); }
    this.setState('offline');
    const delay = Math.min(15_000, 1000 * 2 ** this.retry++);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  call(channel: string, args: unknown[]): Promise<unknown> {
    if (!REMOTE_SET.has(channel)) {
      return Promise.reject(new Error(`NOT AVAILABLE FROM A REMOTE DEVICE — do "${channel}" at the PC`));
    }
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`SKYNETOS DID NOT ANSWER "${channel}" IN ${CALL_TIMEOUT_MS / 1000} s`));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      const message: ClientMessage = { t: 'call', id, ch: channel, args };
      if (this.state === 'connected' && this.ws) this.ws.send(JSON.stringify(message));
      else this.queue.push(message);
    });
  }

  on<K extends EventName>(event: K, handler: (payload: SkynetEvents[K]) => void): () => void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler as (payload: unknown) => void);
    this.handlers.set(event, set);
    return () => set.delete(handler as (payload: unknown) => void);
  }
}

/** Put the remote bridge on `window.skynet` and mark the page as remote for the mobile layer. */
export function installRemoteBridge(): RemoteClient {
  const client = new RemoteClient();
  const local: Record<string, (...args: unknown[]) => unknown> = {
    'display:info': async () => ({
      scaleFactor: 1,
      appliedZoomFactor: 1,
      workArea: { width: window.innerWidth, height: window.innerHeight }
    })
  };
  const bridge = new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      if (prop === 'on') return client.on.bind(client);
      if (prop === 'pathsForFiles') return () => [];
      if (typeof prop !== 'string') return undefined;
      if (prop in local) return local[prop];
      if (CHANNEL_SET.has(prop)) return (...args: unknown[]) => client.call(prop, args);
      return undefined;
    }
  });
  window.skynet = bridge as unknown as SkynetBridge;
  document.documentElement.dataset['remote'] = '1';
  document.documentElement.classList.add('remote');
  if (client.state !== 'pairing') client.connect();
  return client;
}
