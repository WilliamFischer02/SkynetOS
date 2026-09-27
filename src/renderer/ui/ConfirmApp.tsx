import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { decodeConfirm, type ConfirmPayload } from '@shared/confirm.js';
import { Icon } from './Icon.js';
import './confirm.css';

/**
 * The themed confirmation page (src/main/services/confirm-window.ts). One question, its buttons,
 * and nothing else in the window.
 *
 * Keyboard first, because a confirmation is answered from the keyboard more often than not:
 * focus opens on the refusal (`cancelId`), Tab and Shift+Tab cycle the buttons, Enter presses the
 * FOCUSED button only (never a default the user has not moved to), Esc refuses. A `danger`
 * question draws its confirm button in the fault colour so a deletion never looks like a launch.
 *
 * This page may call exactly one channel, `confirm:answer`, and reads its question from the URL
 * hash; it asks main for nothing (docs/07 § Path and execution policy).
 */

function payloadFromHash(): ConfirmPayload | null {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const q = params.get('q');
  return q ? decodeConfirm(q) : null;
}

export function ConfirmApp(): React.JSX.Element {
  const payload = useMemo(payloadFromHash, []);
  const [answered, setAnswered] = useState(false);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const answer = useCallback((index: number): void => {
    if (!payload || answered) return;
    setAnswered(true);
    const api = window.skynet;
    if (typeof api?.['confirm:answer'] === 'function') {
      void api['confirm:answer'](payload.id, index).catch(() => setAnswered(false));
    }
  }, [payload, answered]);

  // The room's theme, when the question came from a room.
  useEffect(() => {
    if (!payload?.theme) return;
    const root = document.documentElement.style;
    root.setProperty('--mask-dark', payload.theme.maskDark);
    root.setProperty('--mask-light', payload.theme.maskLight);
    root.setProperty('--signal', payload.theme.signal);
  }, [payload]);

  // Focus starts on the refusal.
  useEffect(() => {
    if (!payload) return;
    const target = buttonRefs.current[payload.cancelId] ?? buttonRefs.current[0];
    target?.focus();
  }, [payload]);

  // Esc refuses from anywhere in the window; Enter is left to the focused button's own click.
  useEffect(() => {
    if (!payload) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); answer(payload.cancelId); }
      if (event.key === 'Tab') {
        // Cycle inside the button row, so focus never leaves the question.
        const buttons = buttonRefs.current.filter((b): b is HTMLButtonElement => !!b);
        if (!buttons.length) return;
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.shiftKey
          ? (current <= 0 ? buttons.length - 1 : current - 1)
          : (current < 0 || current >= buttons.length - 1 ? 0 : current + 1);
        event.preventDefault();
        buttons[next]?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [payload, answer]);

  if (!payload) {
    return (
      <div className="confirm-root kind-info" role="alertdialog" aria-label="Confirm">
        <div className="confirm-head"><span className="with-icon"><Icon name="info" />CONFIRM</span></div>
        <div className="confirm-body">
          <div className="confirm-message">THIS QUESTION DID NOT ARRIVE. CLOSE THIS WINDOW AND TRY THE ACTION AGAIN.</div>
        </div>
      </div>
    );
  }

  const kind = payload.kind ?? 'info';
  const icon = kind === 'danger' ? 'fault' : kind === 'launch' ? 'open' : 'info';
  return (
    <div className={`confirm-root kind-${kind}`} role="alertdialog" aria-labelledby="confirm-title" aria-describedby="confirm-message">
      <div className="confirm-head">
        <span className="with-icon" id="confirm-title"><Icon name={icon} />{payload.title.toUpperCase()}</span>
        <span className="confirm-hint">ESC = {payload.buttons[payload.cancelId]?.toUpperCase() ?? 'CANCEL'}</span>
      </div>
      <div className="confirm-body">
        <div className="confirm-message" id="confirm-message">{payload.message}</div>
        {payload.detail ? <pre className="confirm-detail">{payload.detail}</pre> : null}
      </div>
      <div className="confirm-actions">
        {payload.buttons.map((label, index) => {
          const isCancel = index === payload.cancelId;
          const cls = isCancel ? 'btn' : kind === 'danger' ? 'btn danger' : 'btn primary';
          return (
            <button
              key={`${index}-${label}`}
              ref={(el) => { buttonRefs.current[index] = el; }}
              type="button"
              className={cls}
              disabled={answered}
              onClick={() => answer(index)}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
