import { useState } from 'react';
import { isRemotePage } from '../remote/shim.js';
import { Icon } from './Icon.js';

/**
 * A one-time card of the five things worth knowing on a first look, dismissed for good with GOT IT.
 * Kept to one card because anything more is a tour, and a tour stands between you and the board.
 */

const SEEN_KEY = 'skynet.firstRun.v1';

const HINTS: [string, string][] = [
  ['CTRL+K', 'find any node, room or action'],
  ['?', 'every key on one page'],
  ['E', 'edit the board: drag, wire, resize'],
  ['RIGHT-CLICK', 'a node\'s menu: copy, summon JARVIS'],
  ['CTRL+,', 'settings']
];

function seen(): boolean {
  try { return window.localStorage.getItem(SEEN_KEY) === '1'; } catch { return true; }
}

/** Settings' "show it again": the card returns the next time the window opens. */
export function resetFirstRunHints(): void {
  try { window.localStorage.removeItem(SEEN_KEY); } catch { /* nothing to reset */ }
}

export function FirstRunHints(): React.JSX.Element | null {
  // Not on a remote page (docs/08): a phone has none of these keys, and the board is its first sight.
  const [open, setOpen] = useState(() => !isRemotePage() && !seen());
  if (!open) return null;
  const dismiss = (): void => {
    try { window.localStorage.setItem(SEEN_KEY, '1'); } catch { /* shown again next time; harmless */ }
    setOpen(false);
  };
  return (
    <div className="firstrun-wrap">
      <div className="firstrun" role="dialog" aria-label="Getting started">
        <div className="firstrun-head"><Icon name="info" /><span>Getting started</span></div>
        {HINTS.map(([key, what]) => (
          <div className="firstrun-row" key={key}>
            <span className="firstrun-key">{key}</span>
            <span className="firstrun-what">{what}</span>
          </div>
        ))}
        <button type="button" className="btn primary" onClick={dismiss} autoFocus>Got it</button>
      </div>
    </div>
  );
}
