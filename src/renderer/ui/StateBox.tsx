/**
 * A status box: one line in caps that says the state, an optional detail that says what to do.
 *
 * The inspector's session and schedule blocks drew `.state ok|warn|fault|dim` by hand; the
 * mailbox and the gesture catalogue copied it on 2026-09-26. This is the same markup once, so a
 * loading, empty or failed state looks the same in every panel (docs/06 "Known issues" 11–15).
 */
export type StateTone = 'ok' | 'warn' | 'fault' | 'dim';

export function StateBox(props: {
  tone: StateTone;
  line: string;
  detail?: React.ReactNode;
  className?: string;
  role?: 'status' | 'alert';
}): React.JSX.Element {
  const { tone, line, detail, className, role } = props;
  return (
    <div className={`state ${tone}${className ? ` ${className}` : ''}`} role={role ?? (tone === 'fault' ? 'alert' : 'status')}>
      <div className="state-line">{line}</div>
      {detail ? <div className="state-detail">{detail}</div> : null}
    </div>
  );
}
