import { useEffect } from 'react';
import { useBoardStore } from '../store/useBoardStore.js';
import { Icon } from './Icon.js';
import { relativeTime } from './TargetField.js';
import { unreadCount } from './notification-history.js';

/**
 * The bell in the HUD and the list it opens: every toast, kept after it fades.
 *
 * Toasts are right for "this just happened" and wrong for "what did it say?". A fault that faded
 * while you were looking at the other monitor was simply gone. Now each one is also kept here,
 * newest first, repeats merged, and the bell shows how many are unread.
 */
export function NotificationBell(): React.JSX.Element {
  const unread = useBoardStore((s) => unreadCount(s.notifications));
  const open = useBoardStore((s) => s.notificationsOpen);
  const setOpen = useBoardStore((s) => s.setNotificationsOpen);
  return (
    <button
      type="button"
      className={unread ? 'hud-bell unread' : 'hud-bell'}
      aria-pressed={open}
      onClick={() => setOpen(!open)}
      title={unread ? `${unread} unread notification${unread === 1 ? '' : 's'}` : 'Notifications'}
      aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
    >
      <Icon name="bell" />
      {unread ? <span>{unread}</span> : null}
    </button>
  );
}

export function NotificationCentre(): React.JSX.Element | null {
  const open = useBoardStore((s) => s.notificationsOpen);
  const setOpen = useBoardStore((s) => s.setNotificationsOpen);
  const list = useBoardStore((s) => s.notifications);
  const clear = useBoardStore((s) => s.clearNotifications);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); setOpen(false); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <div className="notif-panel" role="dialog" aria-label="Notifications">
      <div className="notif-head">
        <Icon name="bell" />
        <span>Notifications</span>
        <span className="notif-spacer" />
        <button type="button" className="btn tiny" disabled={!list.length} onClick={clear}>Clear</button>
        <button type="button" className="btn tiny" onClick={() => setOpen(false)}>Close (Esc)</button>
      </div>
      {list.length ? list.map((n) => (
        <div key={n.id} className={`notif-row ${n.level}`}>
          <Icon name={n.level} />
          <span className="notif-text">
            {n.text}
            {n.count > 1 ? <span className="toast-count">×{n.count}</span> : null}
          </span>
          <span className="notif-meta">{relativeTime(n.at)}</span>
        </div>
      )) : <div className="notif-empty">Nothing yet. Toasts land here after they fade.</div>}
    </div>
  );
}
