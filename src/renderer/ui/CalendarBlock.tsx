import { useEffect, useState } from 'react';
import { upcomingBlocks, type CalendarBlock as Block, type CalendarStatus } from '@shared/schedule-calendar.js';
import { SCHEDULE_TZ, dayKey, dayLabel, hhmm, zonedParts } from '@shared/schedule-week.js';
import { relativeTime } from './TargetField.js';

/**
 * A calendar pane in the inspector: the next three blocks as text, and where the calendar came from.
 *
 * The pane on the board is the picture; this is the same file read out, for when a pad is too small
 * to carry its title (calendar-face.ts). It shows schedule/calendar.json through `schedule:calendar`
 * and nothing else, asked once and then kept current by main's push. No calendar is said in words,
 * with the command that makes one. Times are America/Denver, as every schedule time is.
 */

const clock = (ms: number): string => {
  const p = zonedParts(ms, SCHEDULE_TZ);
  return hhmm(p.hour * 60 + p.minute);
};

function when(b: Block, now: number): string {
  const start = Date.parse(b.start);
  const end = Date.parse(b.end);
  const day = dayKey(start, SCHEDULE_TZ);
  const today = dayKey(now, SCHEDULE_TZ);
  const label = day === today ? 'TODAY' : dayLabel(day, SCHEDULE_TZ).toUpperCase();
  const running = start <= now && now < end ? ' · NOW' : '';
  return `${label} ${clock(start)}–${clock(end)}${running}`;
}

export function CalendarBlock(): React.JSX.Element {
  const available = typeof window.skynet['schedule:calendar'] === 'function';
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!available) return;
    window.skynet['schedule:calendar']()
      .then((next) => { setStatus(next); setReadError(null); })
      .catch((err: unknown) => setReadError((err as Error).message || 'NO ANSWER'));
    const off = window.skynet.on('schedule:calendar', (next) => { setStatus(next); setReadError(null); });
    // "Next" moves with the clock even when the file does not.
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => { off(); clearInterval(tick); };
  }, [available]);

  if (!available) {
    return (
      <div className="state warn">
        <div className="state-line">RESTART SKYNETOS TO SEE THE CALENDAR</div>
        <div className="state-detail">The running app predates the calendar pane.</div>
      </div>
    );
  }
  if (readError) return <div className="state warn"><div className="state-line">COULD NOT READ THE CALENDAR — {readError}</div></div>;
  if (!status) return <div className="state ok"><div className="state-line">READING THE CALENDAR…</div></div>;
  if (!status.ready) {
    return (
      <div className="state warn">
        <div className="state-line">NO CALENDAR</div>
        <div className="state-detail">{status.reason}</div>
      </div>
    );
  }

  const cal = status.calendar;
  const next = upcomingBlocks(cal, now, 3);
  const generated = Date.parse(cal.generatedAt);
  return (
    <div className="session-block">
      <div className="state ok">
        <div className="state-line">{next.length ? 'NEXT' : 'NOTHING SCHEDULED IN THE NEXT 14 DAYS'}</div>
        <div className="state-meta">
          <span>{`PBS ${cal.counts.pbs}`}</span>
          <span>{`CALENDAR ${cal.counts.events}`}</span>
          <span>{`ICAL ${cal.counts.ics}`}</span>
          {Number.isFinite(generated) ? <span>{`MERGED ${relativeTime(generated).toUpperCase()}`}</span> : null}
        </div>
      </div>
      {next.map((b) => (
        <div key={`${b.start}|${b.title}`} className="state ok" title={`${b.calendar}${b.estimated ? ' · end estimated' : ''}`}>
          <div className="state-line">{b.title}</div>
          <div className="state-detail">{when(b, now)}{b.estimated ? ' · END ESTIMATED' : ''}</div>
        </div>
      ))}
      {(cal.notes ?? []).map((n) => (
        <div key={n} className="state warn"><div className="state-line">{n}</div></div>
      ))}
    </div>
  );
}
