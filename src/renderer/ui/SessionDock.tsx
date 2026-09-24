import { useState } from 'react';
import { useBoardStore } from '../store/useBoardStore.js';
import { Icon } from './Icon.js';
import { relativeTime } from './TargetField.js';

/**
 * The session dock: every live session across every room, with uptime and where it is.
 *
 * docs/03 §7 calls this "the thing that stops sessions getting orphaned", and that is exactly
 * its job — an agent running in a room you are not looking at is otherwise invisible, and the
 * failure mode is discovering three copies of the same session tomorrow.
 *
 * It shows sessions from OTHER rooms too, deliberately, with the room named. Filtering to the
 * current room would recreate the problem it exists to solve.
 */
export function SessionDock(): React.JSX.Element | null {
  const sessions = useBoardStore((s) => s.sessions);
  const services = useBoardStore((s) => s.services);
  const boardId = useBoardStore((s) => s.boardId);
  const stopSession = useBoardStore((s) => s.stopSession);
  const stopService = useBoardStore((s) => s.stopService);
  const select = useBoardStore((s) => s.select);
  /*
   * Folded to its header: by the user (persisted), or by the layout manager when the left-hand
   * column has run into the usage meter (ui/chrome-layout.ts). Unfolding it by hand holds until it
   * is folded again.
   */
  const userCollapsed = useBoardStore((s) => s.chromePrefs.dockCollapsed);
  const layoutCompact = useBoardStore((s) => s.layout.dockCompact);
  const setChromePref = useBoardStore((s) => s.setChromePref);
  const [heldOpen, setHeldOpen] = useState(false);
  const compact = userCollapsed || (layoutCompact && !heldOpen);

  const live = sessions.filter((s) => s.state === 'running');
  const liveServices = services.filter((s) => s.state === 'running');
  if (!live.length && !liveServices.length) return null;

  return (
    <div className={compact ? 'dock compact' : 'dock'}>
      <div className="dock-head">
        <button
          type="button"
          className="dock-toggle"
          aria-expanded={!compact}
          onClick={() => {
            if (compact) { setChromePref('dockCollapsed', false); setHeldOpen(true); }
            else { setChromePref('dockCollapsed', true); setHeldOpen(false); }
          }}
          title={compact ? 'Show every session' : 'Fold to this line'}
        >
          <Icon name={compact ? 'add' : 'minus'} />
          SESSIONS {live.length}
          {liveServices.length ? ` · SERVICES ${liveServices.length}` : ''}
        </button>
      </div>

      {live.map((session) => (
        <div className="dock-row" key={session.id}>
          <span className={session.mode === 'popout-elevated' ? 'dock-led elevated' : 'dock-led'} />
          <button
            type="button"
            className="dock-name"
            title={`${session.cwd}\nconversation ${session.claudeSessionId ?? '(none)'}`}
            onClick={() => { if (session.boardId === boardId) select(session.nodeId); }}
          >
            {session.boardId === boardId ? <Icon name="target" /> : null}
            {session.designator ? `${session.designator} ` : ''}{session.nodeName}
          </button>
          {session.boardId !== boardId ? <span className="dock-room">{session.boardId}</span> : null}
          <span className="dock-meta">{session.resumed ? 'RESUMED' : 'NEW'}</span>
          <span className="dock-meta">{relativeTime(Date.parse(session.startedAt))}</span>
          {session.mode === 'popout-elevated' ? <span className="dock-meta elevated">⚡ELEVATED</span> : null}
          <button type="button" className="btn tiny" onClick={() => void stopSession(session.id)} title="Kill this session"><Icon name="stop" />Kill</button>
        </div>
      ))}

      {liveServices.map((service) => (
        <div className="dock-row" key={service.id}>
          <span className="dock-led service" />
          <button
            type="button"
            className="dock-name"
            title={`${service.command}\n${service.cwd}`}
            onClick={() => { if (service.boardId === boardId) select(service.nodeId); }}
          >
            {service.boardId === boardId ? <Icon name="target" /> : null}
            {service.nodeName}
          </button>
          {service.port !== null ? <span className="dock-meta">:{service.port}</span> : null}
          <span className="dock-meta">{relativeTime(Date.parse(service.startedAt))}</span>
          <button
            type="button"
            className="btn tiny"
            onClick={() => void stopService(service.boardId, service.nodeId)}
            title="Stop this service"
          >
            <Icon name="stop" />Stop
          </button>
        </div>
      ))}
    </div>
  );
}
