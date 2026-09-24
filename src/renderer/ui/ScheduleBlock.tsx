import { useCallback, useEffect, useState } from 'react';
import type { BoardNode } from '@shared/types.js';
import type { TaskStatusView } from '@shared/schedule.js';
import { useBoardStore } from '../store/useBoardStore.js';
import { relativeTime } from './TargetField.js';

/**
 * A scheduled task in the inspector: when it runs next, how the last run went, and Run now.
 *
 * Polled every 30 s while open, because "next run" and "last run" change with the clock rather
 * than with any event. Guards the bridge: a SkynetOS started before the scheduler existed has no
 * `task:*` channels, and says so instead of a button that does nothing.
 */

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ScheduleBlock({ node }: { node: BoardNode }): React.JSX.Element {
  const boardId = useBoardStore((s) => s.boardId);
  const toast = useBoardStore((s) => s.toast);
  const [status, setStatus] = useState<TaskStatusView | null>(null);
  /** Why the last read failed; a failed read used to look like one that had not finished. */
  const [readError, setReadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const available = typeof window.skynet['task:status'] === 'function' && typeof window.skynet['task:runNow'] === 'function';

  const pull = useCallback(() => {
    if (!available) return;
    window.skynet['task:status'](boardId, node.id)
      .then((next) => { setStatus(next); setReadError(null); })
      .catch((err: unknown) => { setStatus(null); setReadError((err as Error).message || 'NO ANSWER'); });
    // node.schedule and node.enabled are here so an edit refreshes the readout at once.
  }, [available, boardId, node.id, node.schedule, node.enabled]);

  useEffect(() => {
    pull();
    const timer = setInterval(pull, 30_000);
    return () => clearInterval(timer);
  }, [pull]);

  if (!available) {
    return (
      <div className="state warn">
        <div className="state-line">RESTART SKYNETOS TO RUN SCHEDULES</div>
        <div className="state-detail">The running app predates the scheduler.</div>
      </div>
    );
  }

  const runNow = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await window.skynet['task:runNow'](boardId, node.id);
      toast(result.ok ? 'ok' : 'fault', result.message);
      pull();
    } catch (err) {
      toast('fault', `RUN FAILED — ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const failed = status?.last && !status.last.ok;
  return (
    <div className="session-block">
      <div className={readError || status?.error ? 'state warn' : failed ? 'state fault' : 'state ok'}>
        <div className="state-line">
          {readError
            ? `COULD NOT READ THE SCHEDULE — ${readError}. IT TRIES AGAIN EVERY 30 S`
            : !status ? 'READING THE SCHEDULE…' : status.error ? `NOT SCHEDULED — ${status.error}` : status.next ? `NEXT RUN ${when(status.next).toUpperCase()}` : 'NO NEXT RUN'}
        </div>
        {status ? (
          <div className="state-meta">
            <span>{status.schedule}</span>
            <span>{status.action}</span>
          </div>
        ) : null}
        <div className="state-detail">
          {status?.last
            ? `LAST ${status.last.mode.toUpperCase()} RUN ${relativeTime(Date.parse(status.last.at))}: ${status.last.message}`
            : 'NOT RUN YET. RUNS ONLY WHILE SKYNETOS IS OPEN.'}
        </div>
      </div>
      <div className="inspector-actions">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void runNow()}
          title="Run this task now, exactly as the schedule would. Not counted against the daily cap."
        >
          {busy ? 'Running…' : 'Run now'}
        </button>
      </div>
    </div>
  );
}
