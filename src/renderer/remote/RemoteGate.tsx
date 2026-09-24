import { useEffect, useState, useSyncExternalStore } from 'react';
import { guessDeviceName, type RemoteClient } from './shim.js';

/**
 * What a remote device shows before and around the app: pair, connect, and say so when the link
 * drops. docs/08-REMOTE.md.
 *
 * The app mounts once, on the first successful connection, and stays mounted through a dropped
 * link: the board you were looking at stays on screen under an OFFLINE strip while the client
 * reconnects, rather than the whole UI being torn down and rebuilt every time the phone changes
 * network. A `#pair=CODE` in the URL (what the PC's QR code carries) fills the code in and pairs
 * straight away.
 */
export function RemoteGate({ client, children }: { client: RemoteClient; children: React.ReactNode }): React.JSX.Element {
  const state = useSyncExternalStore(
    (listener) => client.onState(listener),
    () => `${client.state}|${client.error ?? ''}`
  );
  const [code, setCode] = useState(() => new URLSearchParams(location.hash.slice(1)).get('pair') ?? '');
  const [name, setName] = useState(() => guessDeviceName());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [phase] = state.split('|');

  const pair = async (): Promise<void> => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setNote(null);
    const result = await client.pair(code, name);
    setBusy(false);
    if (!result.ok) setNote(result.error ?? 'PAIRING FAILED');
    else history.replaceState(null, '', location.pathname);
  };

  // A code in the URL pairs on arrival: scanning the QR code is the whole gesture.
  useEffect(() => {
    if (phase === 'pairing' && code && new URLSearchParams(location.hash.slice(1)).get('pair')) void pair();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (client.everConnected) {
    return (
      <>
        {children}
        {phase !== 'connected' ? (
          <div className="remote-strip" role="status">
            {phase === 'refused' ? `${client.error ?? 'REVOKED'} — reload to pair again` : 'OFFLINE — RECONNECTING TO SKYNETOS…'}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="remote-gate">
      <div className="remote-card">
        <div className="remote-title">SKYNETOS · REMOTE</div>
        {phase === 'pairing' || phase === 'refused' ? (
          <form onSubmit={(e) => { e.preventDefault(); void pair(); }}>
            {phase === 'refused' ? <p className="remote-warn">{client.error}</p> : null}
            <p className="remote-note">On the PC: LOOK → SYSTEM → REMOTE → PAIR A DEVICE. Scan its code, or type it here.</p>
            <label className="field-label" htmlFor="remote-code">Pairing code</label>
            <input
              id="remote-code"
              className="input remote-code"
              autoCapitalize="characters"
              autoComplete="one-time-code"
              inputMode="text"
              placeholder="ABCD-EFGH"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <label className="field-label" htmlFor="remote-name">This device</label>
            <input id="remote-name" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            <button type="submit" className="btn primary remote-pair" disabled={busy || !code.trim()}>{busy ? 'PAIRING…' : 'PAIR'}</button>
            {note ? <p className="remote-warn">{note}</p> : null}
          </form>
        ) : (
          <p className="remote-note">{phase === 'offline' ? 'SKYNETOS IS NOT ANSWERING — RETRYING…' : 'CONNECTING TO SKYNETOS…'}</p>
        )}
      </div>
    </div>
  );
}
