import { useCallback, useEffect, useState } from 'react';
import { formatCountdown, parseResetText, type FableStatus } from '@shared/model-availability.js';

/**
 * Fable's state, inside the usage meter.
 *
 * William: "Use something more simple and sleek like 'Fable 5.1 Cores: Offline' and below 'Core
 * Restart: HHH:MM:SS'." Offline, it says so, ticks down to the restart, and pulses. Online, it is
 * one quiet line naming what a new session gets, because "which model will this terminal open on"
 * is the question the meter should answer at a glance, even when nothing is wrong.
 *
 * The pulse is STEPPED: a few held brightness levels, never a fade (see styles.css). The chrome
 * follows the board's rule that nothing on screen is ever half-way between two states.
 *
 * The restart time can be typed here, in the CLI's own words ("8pm Monday"), because the CLI shows
 * it but does not always write it to disk. What the page sends is an instant; what main stores is
 * that instant, and it is used only while it is later than the refusal it answers.
 */

const POLL_MS = 15_000;

/**
 * The countdown with every digit in its own shade of white.
 *
 * William: "make every number of the Fable 5 countdown timer a slightly different shade of white /
 * gray for visual clarity and graphical texture." The shade belongs to the digit's POSITION, not
 * its value, so the clock keeps one fixed texture while it ticks instead of flickering.
 */
function ShadedClock({ text }: { text: string }): React.JSX.Element {
  let digit = 0;
  return (
    <span className="cores-clock" aria-label={text}>
      {[...text].map((ch, i) =>
        /\d/.test(ch)
          ? <span key={i} className={`cores-digit shade-${digit++ % 7}`}>{ch}</span>
          : <span key={i} className="cores-sep">{ch}</span>
      )}
    </span>
  );
}

function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function FableCores(): React.JSX.Element | null {
  const [status, setStatus] = useState<FableStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const pull = useCallback(() => {
    void window.skynet['models:status']().then((next) => { setStatus(next); setNow(Date.now()); });
  }, []);

  useEffect(() => {
    pull();
    const timer = setInterval(pull, POLL_MS);
    return () => clearInterval(timer);
  }, [pull]);

  // One tick a second, and only while there is a countdown to show.
  const counting = status?.state === 'offline' && status.resetsAt !== null;
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [counting]);

  // The deadline passing is the moment to ask main again: it will say Fable is back.
  useEffect(() => {
    if (status?.resetsAt && now >= status.resetsAt) pull();
  }, [now, status?.resetsAt, pull]);

  if (!status) return null;

  const save = async (iso: string | null): Promise<void> => {
    const result = await window.skynet['models:setFableReset'](iso);
    if (!result.ok) { setNote(result.error ?? 'COULD NOT SAVE'); return; }
    setEditing(false);
    setText('');
    setNote(null);
    pull();
  };

  const submit = (): void => {
    const at = parseResetText(text, Date.now(), localZone());
    if (at === null) { setNote('NOT UNDERSTOOD. TRY "8PM MONDAY"'); return; }
    void save(new Date(at).toISOString());
  };

  if (!status.auto) {
    return (
      <div className="cores online" title="autoModel is off in settings.json, so every session opens on Claude Code's own default model.">
        <span>MODEL: CLAUDE CODE DEFAULT</span>
        <span className="cores-model">AUTO OFF</span>
      </div>
    );
  }

  if (status.state === 'online') {
    return (
      <div className="cores online" title={status.evidence ? `Last refusal: "${status.evidence}". Fable has answered since, or its restart time has passed.` : 'No refusal naming Fable in the last fortnight of transcripts.'}>
        <span>FABLE 5.1 CORES: ONLINE</span>
        <span className="cores-model">NEW: {status.launch?.label ?? 'DEFAULT'}</span>
      </div>
    );
  }

  const resetsAt = status.resetsAt;
  return (
    <div
      className="cores offline"
      title={
        `${status.evidence ?? 'Fable refused a request.'}\n\n` +
        (status.resetSource === 'recorded' ? 'The restart time is from the refusal itself.'
          : status.resetSource === 'setting' ? 'The restart time is the one typed here; the CLI did not record one.'
            : 'The CLI recorded no restart time. Type the one it shows.') +
        '\nTerminals already open keep the model they started with.'
      }
    >
      <div className="cores-line cores-pulse">
        <span>FABLE 5.1 CORES:</span>
        <span className="cores-state">OFFLINE</span>
      </div>
      <div className="cores-line">
        <span>CORE RESTART:</span>
        {resetsAt !== null
          ? <ShadedClock text={formatCountdown(resetsAt - now)} />
          : <span className="cores-clock">UNKNOWN</span>}
      </div>
      <div className="cores-note">NEW SESSIONS: {status.launch?.label ?? 'DEFAULT'} · OPEN ONES KEEP THEIRS</div>

      {editing ? (
        <form className="cores-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <input
            className="input"
            autoFocus
            value={text}
            placeholder="8pm Monday"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); } }}
          />
          <button type="submit" className="btn">Set</button>
        </form>
      ) : status.resetSource !== 'recorded' ? (
        <div className="cores-actions">
          <button type="button" className="usage-unset link" onClick={() => setEditing(true)}>
            {resetsAt === null ? 'SET RESTART TIME' : 'CHANGE'}
          </button>
          {status.resetSource === 'setting' ? (
            <button type="button" className="usage-unset link" onClick={() => void save(null)}>CLEAR</button>
          ) : null}
        </div>
      ) : null}
      {note ? <div className="cores-note warn">{note}</div> : null}
    </div>
  );
}
