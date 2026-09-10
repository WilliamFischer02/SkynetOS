import { useBoardStore } from '../store/useBoardStore.js';
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

  const live = sessions.filter((s) => s.state === 'running');
  const liveServices = services.filter((s) => s.state === 'running');
  if (!live.length && !liveServices.length) return null;

  return (
    <div className="dock">
      <div className="dock-head">
        SESSIONS {live.length}
        {liveServices.length ? ` · SERVICES ${liveServices.length}` : ''}
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
            {session.designator ? `${session.designator} ` : ''}{session.nodeName}
          </button>
          {session.boardId !== boardId ? <span className="dock-room">{session.boardId}</span> : null}
          <span className="dock-meta">{session.resumed ? 'RESUMED' : 'NEW'}</span>
          <span className="dock-meta">{relativeTime(Date.parse(session.startedAt))}</span>
          {session.mode === 'popout-elevated' ? <span className="dock-meta elevated">⚡ELEVATED</span> : null}
          <button type="button" className="btn tiny" onClick={() => void stopSession(session.id)}>Kill</button>
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
            {service.nodeName}
          </button>
          {service.port !== null ? <span className="dock-meta">:{service.port}</span> : null}
          <span className="dock-meta">{relativeTime(Date.parse(service.startedAt))}</span>
          <button
            type="button"
            className="btn tiny"
            onClick={() => void stopService(service.boardId, service.nodeId)}
          >
            Stop
          </button>
        </div>
      ))}
    </div>
  );
}
