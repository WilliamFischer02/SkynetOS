import { useEffect, useState } from 'react';
import { elapsedLabel, turnView, type TurnState } from '@shared/turn.js';

/**
 * The status strip under the caption (docs/11 § One turn at a time): what JARVIS is doing in this
 * exact moment, from the turn engine alone (services/turn.ts, pushed as `turn:state`).
 *
 *   ● LISTENING   SPEAK NOW
 *   ❝ HEARD       “open firefox and notepad”
 *   … THINKING    PLANNING                              0:04   [PENDING] [STOP]
 *   ▶ ACTING      2 / 5 · FOCUS FIREFOX   ■■□□□           0:07             [STOP]
 *   ? WAITING FOR YOU   Which monitor, sir?
 *   ✓ DONE        ✕ FAILED  FIREFOX WOULD NOT START
 *
 * A held sentence shows as PENDING (its words in the tooltip). STOP (Esc) is there whenever
 * something is thinking, speaking or acting; it halts the desktop, stops speech and drops a held
 * sentence (`turn:stop`). In stream mode nothing he said is printed.
 */
export function TurnStrip({ turn, streamMode, onStop }: { turn: TurnState | null; streamMode: boolean; onStop: () => void }): React.JSX.Element | null {
  const view = turn ? turnView(turn, streamMode) : null;
  const timed = view?.timed === true;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!timed) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [timed, turn?.since]);

  if (!turn || !view) return null;
  if (turn.phase === 'idle' && !view.mic && !view.pending) return null;

  const detail = turn.phase === 'heard' && view.transcript ? `“${view.transcript}”` : view.progress ?? view.detail;
  const segments = turn.step && view.progress ? Array.from({ length: Math.min(12, Math.max(1, turn.step.of)) }, (_, i) => i <= turn.step!.index) : null;

  return (
    <div className={`holo-turn phase-${turn.phase}`} role="status" aria-live="polite" data-control="turn-strip">
      <div className="holo-turn-row">
        <span className="holo-turn-glyph" aria-hidden="true">{view.glyph}</span>
        <span className="holo-turn-word">{view.word}</span>
        {detail ? <span className="holo-turn-detail" title={detail}>{detail}</span> : <span className="holo-turn-detail" />}
        {timed ? <span className="holo-turn-time" title="How long this has been going">{elapsedLabel(now - turn.since)}</span> : null}
        {view.mic && turn.phase !== 'listening' ? <span className="holo-turn-chip mic" title="The microphone is open">● MIC</span> : null}
        {view.pending ? (
          <span className="holo-turn-chip pending" title={`Heard, and held until this one is finished: ${view.pending}`}>PENDING</span>
        ) : null}
        {view.stoppable ? (
          <button type="button" className="btn holo-btn holo-turn-stop" data-control="btn-stop" onClick={onStop} title="Stop what JARVIS is doing (Esc)">
            STOP
          </button>
        ) : null}
      </div>
      {segments ? (
        <div className="holo-turn-bar" aria-hidden="true">
          {segments.map((on, i) => <span key={i} className={on ? 'on' : ''} />)}
        </div>
      ) : null}
    </div>
  );
}

