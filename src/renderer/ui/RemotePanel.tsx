import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RemoteStatusView } from '@shared/remote.js';
import { qrMatrix } from '@shared/qr.js';
import { useBoardStore } from '../store/useBoardStore.js';

/**
 * REMOTE: let a phone, tablet or laptop use this board. The desktop side of docs/08.
 *
 * Self-contained, so any settings surface can host it (LOOK → SYSTEM today). Desktop only: on a
 * remote page it renders nothing, because a paired phone must not be able to pair another device
 * or switch remote off (none of the `remote:*` channels is in REMOTE_METHODS).
 */
export function RemotePanel(): React.JSX.Element | null {
  const toast = useBoardStore((s) => s.toast);
  const onRemotePage = document.documentElement.dataset['remote'] === '1';
  const available = !onRemotePage && typeof window.skynet['remote:status'] === 'function';
  const [status, setStatus] = useState<RemoteStatusView | null>(null);
  const [pair, setPair] = useState<{ code: string; expiresAt: number; urls: string[] } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (!available) return;
    try { setStatus(await window.skynet['remote:status']()); } catch { /* shown as unavailable */ }
  }, [available]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [refresh]);

  // The code's countdown, and forgetting it once it has expired or been used.
  useEffect(() => {
    if (!pair) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pair]);
  const remaining = pair ? Math.max(0, Math.round((pair.expiresAt - now) / 1000)) : 0;
  useEffect(() => { if (pair && (remaining === 0 || status?.pairing === null)) setPair(null); }, [pair, remaining, status?.pairing]);

  if (onRemotePage) return null;
  if (!available) return <div className="look-note">Restart SkynetOS to use remote devices: the running copy predates them.</div>;

  /*
   * Every call below can REJECT, not only answer `ok: false`: main throws when a handler fails, and
   * the bridge from a remote page rejects when the socket drops. Unhandled, `toggle` left `busy`
   * set, which disables the switch until the panel is reopened, and `revoke` said nothing at all,
   * so William could not tell a revoked device from one that was not. Each now says what failed, and the
   * status is read back so the panel shows what is true rather than what was asked for.
   */
  const failed = (what: string, err: unknown): void => {
    toast('fault', `${what} — ${(err as Error).message ?? String(err)}`);
    void refresh();
  };

  const toggle = async (on: boolean): Promise<void> => {
    setBusy(true);
    try {
      const next = await window.skynet['remote:setEnabled'](on);
      setStatus(next);
      if (!next.ok) toast('fault', next.error ?? 'COULD NOT START REMOTE');
      if (!on) setPair(null);
    } catch (err) {
      failed(on ? 'COULD NOT TURN REMOTE ON' : 'COULD NOT TURN REMOTE OFF', err);
    } finally {
      setBusy(false);
    }
  };

  const makeCode = async (): Promise<void> => {
    try {
      const result = await window.skynet['remote:pairCode']();
      if (!result.ok || !result.code || !result.urls || !result.expiresAt) { toast('warn', result.error ?? 'NO CODE'); return; }
      setPair({ code: result.code, expiresAt: result.expiresAt, urls: result.urls });
      setNow(Date.now());
    } catch (err) {
      failed('NO PAIRING CODE', err);
    }
  };

  const revoke = async (id: string, name: string): Promise<void> => {
    try {
      const result = await window.skynet['remote:revoke'](id);
      // `error` means the device is out for this run but the list on disk still names it.
      if (result.error) toast('fault', `${name}: ${result.error}`);
      else toast('ok', `${name} can no longer connect`);
      void refresh();
    } catch (err) {
      failed(`${name} MAY NOT BE REVOKED. CHECK THE LIST, AND TURN REMOTE OFF IF IT IS STILL THERE`, err);
    }
  };

  const publish = async (): Promise<void> => {
    try {
      const result = await window.skynet['remote:tailscaleServe']();
      if (result.ok) toast('ok', 'published to your tailnet');
      else if (result.error !== 'CANCELLED') toast('fault', result.error ?? 'TAILSCALE SERVE FAILED');
      void refresh();
    } catch (err) {
      failed('TAILSCALE SERVE FAILED', err);
    }
  };

  const tail = status?.tailscale;
  return (
    <div className="remote-panel">
      <label className="look-check">
        <input type="checkbox" disabled={busy || !status} checked={status?.enabled === true} onChange={(e) => void toggle(e.target.checked)} />
        Allow remote devices (phone, tablet, another computer)
      </label>
      <div className="look-note">
        {!status ? 'Reading…'
          : !status.enabled ? 'Off. When on, SkynetOS listens on this PC only (127.0.0.1); devices reach it through Tailscale and must pair with a one-time code.'
            : status.listening ? `Listening on ${status.localUrl} · ${status.clients} connected${status.error ? ` · ${status.error}` : ''}`
              : status.error ?? 'Starting…'}
      </div>
      {status?.enabled && !status.built ? <div className="look-note warn">No built renderer to serve yet. On this PC: npm run build:app</div> : null}

      {status?.listening ? (
        <button type="button" className="btn" onClick={() => void makeCode()}>{pair ? 'NEW CODE' : 'PAIR A DEVICE'}</button>
      ) : null}
      {/*
        * Order matters and the panel now says so. PAIR used to be offered the moment the server was
        * listening, and the QR code was built from "Tailscale is running" rather than from "our port
        * is published" — so pairing before publishing produced a confident https URL that simply
        * would not load, with nothing on screen to explain it. `serving` is now read back from
        * `tailscale serve status`.
        */}
      {status?.listening && tail?.running && !tail.serving ? (
        <div className="look-note warn">
          Not published to your tailnet yet, so a QR code will only work on this PC. Press PUBLISH TO MY TAILNET first.
          {tail.httpsReady ? '' : ' Tailscale also has no HTTPS certificate for this tailnet: turn on HTTPS Certificates in the Tailscale admin console under DNS, then press PUBLISH.'}
        </div>
      ) : null}
      {pair ? (
        <div className="remote-pairbox">
          <QrCode text={pair.urls[0] ?? ''} />
          <div>
            <div className="remote-paircode">{pair.code}</div>
            <div className="look-note">One use · expires in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</div>
            <div className="look-note">Scan with the device&apos;s camera, or open one of these and type the code:</div>
            {pair.urls.map((u) => <div key={u} className="remote-url">{u.replace(/#pair=.*$/, '')}</div>)}
          </div>
        </div>
      ) : null}

      {status && status.devices.length ? (
        <div className="remote-devices">
          {status.devices.map((d) => (
            <div key={d.id} className="remote-device">
              <span className="remote-device-name">{d.name}</span>
              <span className="remote-device-seen">{d.lastSeenAt ? `seen ${new Date(d.lastSeenAt).toLocaleString()}` : 'never connected'}</span>
              <button type="button" className="btn tiny" onClick={() => void revoke(d.id, d.name)}>REVOKE</button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="look-note">
        {!tail ? null
          : !tail.installed ? 'Away from home: install Tailscale on this PC and on the device (tailscale.com/download), signed in to the same account.'
            : !tail.running ? 'Tailscale is installed but not connected on this PC. Open it and sign in.'
              : `Tailscale: this PC is ${tail.dnsName ?? '(no name)'}${tail.serving ? ' · published to your tailnet' : ' · not published yet'}${tail.httpsReady ? '' : ' · no HTTPS certificate for this tailnet'}.`}
      </div>
      {tail?.running && status?.listening ? (
        <button type="button" className="btn" onClick={() => void publish()}
          title="Runs `tailscale serve` so devices on your tailnet reach this server over HTTPS. Asks first.">
          PUBLISH TO MY TAILNET
        </button>
      ) : null}
    </div>
  );
}

/** The pairing URL as a QR code: whole-pixel modules, a white quiet zone, crisp at any scale. */
function QrCode({ text }: { text: string }): React.JSX.Element | null {
  const matrix = useMemo(() => (text ? qrMatrix(text) : null), [text]);
  if (!matrix) return null;
  const n = matrix.length;
  const size = n + 8;
  const px = 4;
  return (
    <svg className="remote-qr" width={size * px} height={size * px} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" aria-label="Pairing QR code">
      <rect x={0} y={0} width={size} height={size} fill="#ffffff" />
      {matrix.flatMap((row, r) => row.map((dark, c) => (dark ? <rect key={`${r},${c}`} x={c + 4} y={r + 4} width={1} height={1} fill="#000000" /> : null)))}
    </svg>
  );
}
