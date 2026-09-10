import { useBoardStore } from '../store/useBoardStore.js';

/**
 * Drop-in ingestion, confirmed. docs/03 §14.
 *
 * Drag a file or folder from Explorer onto the board and this offers the node it thinks you
 * want, pre-filled, with the reason it chose that kind. It never places anything on its own —
 * docs/03 §2 is explicit that "you can't place a broken node by accident", and a silent
 * auto-placed node would also be a board edit you did not review.
 *
 * Accepting goes through the same command bus as every other mutation, so it is validated,
 * snapshotted and Ctrl+Z-undoable like anything else.
 */
export function IngestWizard(): React.JSX.Element | null {
  const pending = useBoardStore((s) => s.pendingIngest);
  const accept = useBoardStore((s) => s.acceptIngest);
  const cancel = useBoardStore((s) => s.cancelIngest);

  if (!pending) return null;

  return (
    <div className="ingest">
      <div className="ingest-head">
        DROPPED {pending.suggestions.length} ITEM{pending.suggestions.length === 1 ? '' : 'S'} — PLACE ON THE BOARD?
      </div>

      {pending.suggestions.map((s) => (
        <div className="ingest-row" key={s.path}>
          <div className="ingest-kind">{s.kind}</div>
          <div className="ingest-name">{s.name}</div>
          <div className="ingest-path">{s.path}</div>
          <div className="ingest-reason">{s.reason}</div>
          {s.fields.glob ? <div className="ingest-field">glob: {s.fields.glob}</div> : null}
          {s.fields.exclude?.length ? <div className="ingest-field">exclude: {s.fields.exclude.join(', ')}</div> : null}
          <button type="button" className="btn primary" onClick={() => void accept(s)}>
            Place as {s.kind}
          </button>
        </div>
      ))}

      <div className="ingest-actions">
        <button type="button" className="btn" onClick={cancel}>Cancel</button>
      </div>
    </div>
  );
}
