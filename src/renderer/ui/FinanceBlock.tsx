import { useEffect, useState } from 'react';
import type { FinanceStatus, Meter } from '@shared/finance.js';
import { formatMoney } from '@shared/finance.js';
import { relativeTime } from './TargetField.js';

/**
 * The LEDGER node in the inspector: every account as a meter, the totals, the rates, the alerts.
 *
 * It shows `private/finance/report.json` and nothing else (services/finance.ts). No report, no
 * ledger, or a stale one is said in words, never drawn as a bar at zero: an empty bar reads as
 * "nothing owed", which is the one thing this block must never say by accident.
 *
 * Polled every 30 s while open: the report changes when William runs the tool, not on an event
 * main sees. Whole cells only in the bar (docs/02 anti-mush), as the usage meter does it.
 */

const CELLS = 20;

function Bar({ meter }: { meter: Meter }): React.JSX.Element {
  const filled = Math.round(meter.fill * CELLS);
  return (
    <div className={`meter-bar ${meter.state}${meter.stale ? ' unknown' : ''}`}>
      {Array.from({ length: CELLS }, (_, i) => <span key={i} className={i < filled ? 'cell on' : 'cell'} />)}
    </div>
  );
}

export function FinanceBlock(): React.JSX.Element {
  const available = typeof window.skynet['finance:status'] === 'function';
  const [status, setStatus] = useState<FinanceStatus | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  useEffect(() => {
    if (!available) return;
    const pull = (): void => {
      window.skynet['finance:status']()
        .then((next) => { setStatus(next); setReadError(null); })
        .catch((err: unknown) => { setStatus(null); setReadError((err as Error).message || 'NO ANSWER'); });
    };
    pull();
    const timer = setInterval(pull, 30_000);
    return () => clearInterval(timer);
  }, [available]);

  if (!available) {
    return (
      <div className="state warn">
        <div className="state-line">RESTART SKYNETOS TO SEE THE LEDGER</div>
        <div className="state-detail">The running app predates the finance report.</div>
      </div>
    );
  }
  if (readError) {
    return <div className="state warn"><div className="state-line">COULD NOT READ THE REPORT — {readError}. IT TRIES AGAIN EVERY 30 S</div></div>;
  }
  if (!status) return <div className="state ok"><div className="state-line">READING THE REPORT…</div></div>;
  if (!status.ready) {
    return (
      <div className="state warn">
        <div className="state-line">NO FIGURES YET</div>
        <div className="state-detail">{status.reason}</div>
      </div>
    );
  }

  const s = status.summary;
  const money = (v: number): string => formatMoney(v, s.currency);
  const worst = s.alerts[0]?.severity;
  return (
    <div className="session-block">
      <div className={worst === 'fault' ? 'state fault' : worst === 'warn' ? 'state warn' : 'state ok'}>
        <div className="state-line">
          {`CASH ${money(s.totals.cash)} · DEBT ${money(s.totals.debt)} · NET ${money(s.totals.net)}`}
        </div>
        <div className="state-meta">
          <span>{`SPENT ${money(s.rates.perDaySpent)}/DAY`}</span>
          <span>{`EARNED ${money(s.rates.perDayEarned)}/DAY`}</span>
          <span>{`${s.rates.windowDays}-DAY NET ${money(s.rates.net)}`}</span>
        </div>
        <div className="state-detail">
          {`${s.bills.unpaid.length} UNPAID (${money(s.bills.totalUnpaid)}) · ${s.bills.overdue.length} OVERDUE · ${s.bills.dueSoon.length} DUE THIS WEEK`}
          {s.totals.utilisation !== null ? ` · CREDIT USED ${Math.round(s.totals.utilisation * 100)}%` : ''}
          {` · REPORT ${relativeTime(Date.parse(s.generatedAt)).toUpperCase()}`}
        </div>
      </div>

      {s.meters.map((m) => (
        <div key={m.accountId} className="meter-row" title={`${m.institution || m.kind} · as of ${m.asOf}${m.stale ? ' · STALE: update balance and asOf in ledger.json' : ''}`}>
          <div className="meter-line">
            <span className="meter-label">{m.name}{m.stale ? ' (STALE)' : ''}</span>
            <span className="meter-value">{m.label}</span>
          </div>
          <Bar meter={m} />
        </div>
      ))}

      {s.alerts.map((a, i) => (
        <div key={`${a.code}-${a.accountId ?? a.billId ?? i}`} className={a.severity === 'info' ? 'state ok' : `state ${a.severity}`}>
          <div className="state-line">{a.text}</div>
          <div className="state-detail">{a.action}</div>
        </div>
      ))}
    </div>
  );
}
