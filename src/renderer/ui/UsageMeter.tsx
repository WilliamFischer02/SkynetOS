import { useEffect, useState } from 'react';
import type { UsageSummary } from '@shared/usage.js';
import { formatDuration, formatTokens, fraction, readout, weightedTokens } from '@shared/usage.js';
import { PLAN_SPECS, planFromPeak, type PlanId } from '@shared/plans.js';

/**
 * The usage meter, top-left, always on.
 *
 * Three values, each with a bar. William: "don't just show values show a visual representation of
 * token usage." A number tells you where you are; a bar tells you how much room is left, which is
 * the question you actually have, and it answers it without being read.
 *
 * Every bar is drawn in whole cells. A partially-filled cell would be a sub-pixel edge, and
 * docs/02 anti-mush applies to the chrome as much as to the canvas.
 *
 * What each bar is measured AGAINST is the interesting part, and each one is different:
 *
 *   POOL   against the budget. The only one with a natural ceiling.
 *   RATE   against the rate that would exactly exhaust the budget over the window. Full means
 *          "at this pace you finish the window exactly as it ends" — which makes over-full mean
 *          something real rather than being an arbitrary scale.
 *   TIME   against the window length. Full means you have more headroom than a whole fresh window.
 *
 * With no budget configured only RATE has anything to measure against, so it is graded on the
 * account's own measured peak instead, and the other two say so. See packages/shared/plans.ts.
 */

const REFRESH_MS = 20_000;
const CELLS = 16;

/** One labelled bar. `fill` is 0..1; `over` draws the past-the-end state without a wider bar. */
function Bar({ fill, level, unknown }: { fill: number; level: string; unknown?: boolean }): React.JSX.Element {
  const filled = Math.round(Math.max(0, Math.min(1, fill)) * CELLS);
  return (
    <div className={`meter-bar ${level}${unknown ? ' unknown' : ''}`}>
      {Array.from({ length: CELLS }, (_, i) => (
        <span key={i} className={i < filled ? 'cell on' : 'cell'} />
      ))}
    </div>
  );
}

export function UsageMeter(): React.JSX.Element | null {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    const pull = () => {
      void window.skynet['usage:summary']().then((next) => { if (live) setSummary(next); });
    };
    pull();
    // Usage moves on the scale of minutes, and a scan touches every conversation file on disk.
    // Polling this faster would cost more than the freshness is worth.
    const timer = setInterval(pull, REFRESH_MS);
    return () => { live = false; clearInterval(timer); };
  }, []);

  if (!summary) return null;

  if (summary.error) {
    return (
      <div className="usage-meter fault">
        <div className="usage-head-row">USAGE</div>
        <div className="usage-error">{summary.error}</div>
      </div>
    );
  }

  const { ratePerHour, remainingTokens, remainingHours, usedTokens } = readout(summary);
  const budget = summary.budgetTokens;
  const budgeted = budget !== null && budget > 0;

  // The pace that would spend exactly the budget across exactly the window. Without a budget,
  // the account's own measured peak stands in — it is the only real ceiling available.
  const paceCeiling = budgeted
    ? budget / Math.max(summary.windowHours, 1 / 60)
    : summary.peakWindowTokens > 0
      ? summary.peakWindowTokens / Math.max(summary.windowHours, 1 / 60)
      : null;

  const poolFill = budgeted ? fraction(usedTokens, budget) : 0;
  const rateFill = fraction(ratePerHour, paceCeiling);
  const timeFill = remainingHours === null ? 0 : fraction(remainingHours, summary.windowHours);

  const level = (f: number, invert = false): string => {
    const v = invert ? 1 - f : f;
    return v >= 0.9 ? 'fault' : v >= 0.7 ? 'warn' : 'ok';
  };

  const plan = summary.plan && summary.plan in PLAN_SPECS ? PLAN_SPECS[summary.plan as PlanId] : null;
  const suggested = planFromPeak(summary.peakWindowTokens);
  const busiest = summary.projects.filter((p) => weightedTokens(p.window) > 0).slice(0, 6);

  return (
    <div className={`usage-meter ${budgeted ? level(poolFill) : ''}`}>
      <button
        type="button"
        className="usage-head-row"
        onClick={() => setOpen((v) => !v)}
        title={
          `Measured from ~/.claude/projects over the last ${summary.windowHours}h. ` +
          'Weighted tokens: input + output + cache writes + cache reads at one tenth, because ' +
          'cache reads are priced at a tenth and would otherwise dominate every figure.'
        }
      >
        <span className="usage-title">USAGE</span>
        <span className="usage-window">{summary.windowHours}H</span>
        {plan ? (
          <span
            className={summary.budgetSource === 'plan' ? 'usage-plan est' : 'usage-plan'}
            title={
              summary.budgetSource === 'plan'
                ? `${plan.label}: ${plan.note} The budget is an ESTIMATE — ${formatTokens(plan.windowTokens ?? 0)} per ${summary.windowHours}h — calibrated from this machine's own history, not read from your account. Set tokenBudget in settings.json to override it.`
                : `${plan.label}. The budget comes from tokenBudget in settings.json, which overrides the plan estimate.`
            }
          >
            {plan.label}{summary.budgetSource === 'plan' ? '~' : ''}
          </span>
        ) : null}
        <span className="usage-toggle">{open ? '−' : '+'}</span>
      </button>

      <div className="meter-row" title="Weighted tokens per hour, measured. The bar is graded against the pace that would spend exactly one window's budget in exactly one window.">
        <div className="meter-line">
          <span className="meter-label">RATE</span>
          <span className="meter-value">{formatTokens(ratePerHour)}<span className="meter-unit">/h</span></span>
        </div>
        <Bar fill={rateFill} level={level(rateFill)} unknown={paceCeiling === null} />
      </div>

      <div className="meter-row" title={budgeted ? `${formatTokens(usedTokens)} of ${formatTokens(budget)} used this window.` : 'SkynetOS cannot read your subscription allowance — no local file or API reports it, so it will not guess. Set `plan` or `tokenBudget` in %APPDATA%/SkynetOS/settings.json.'}>
        <div className="meter-line">
          <span className="meter-label">POOL LEFT</span>
          <span className="meter-value">
            {remainingTokens === null
              ? <span className="usage-unset">SET A PLAN</span>
              : <>{formatTokens(remainingTokens)}<span className="meter-unit"> of {formatTokens(budget as number)}</span></>}
          </span>
        </div>
        <Bar fill={budgeted ? 1 - poolFill : 0} level={level(poolFill)} unknown={!budgeted} />
      </div>

      <div className="meter-row" title="Pool left divided by the current rate: how long you can keep going at this pace. The bar is graded against one whole window, so a full bar means more headroom than a fresh window.">
        <div className="meter-line">
          <span className="meter-label">TIME LEFT</span>
          <span className="meter-value">
            {remainingHours === null
              ? <span className="usage-unset">{budgeted ? 'IDLE' : '—'}</span>
              : formatDuration(remainingHours)}
          </span>
        </div>
        <Bar fill={timeFill} level={level(timeFill, true)} unknown={remainingHours === null} />
      </div>

      {open ? (
        <div className="usage-drawer">
          <div className="usage-projects-head">BUSIEST THIS WINDOW</div>
          {busiest.length ? busiest.map((p) => {
            const share = fraction(weightedTokens(p.window), weightedTokens(summary.window));
            return (
              <div className="usage-project" key={p.projectDir} title={p.cwd}>
                <div className="meter-line">
                  <span className="up-name">{p.projectDir.replace(/^[A-Za-z]--/, '').replace(/-/g, '/')}</span>
                  <span className="up-tokens">{formatTokens(weightedTokens(p.window))}</span>
                </div>
                {/* The same proportion the couriers walk in. */}
                <Bar fill={share} level="ok" />
              </div>
            );
          }) : <div className="dim">NOTHING IN THE LAST {summary.windowHours}H</div>}

          <div className="usage-calibrate">
            <div className="usage-projects-head">CALIBRATION</div>
            <div className="meter-line">
              <span className="meter-label">BUSIEST {summary.windowHours}H EVER</span>
              <span className="meter-value">{formatTokens(summary.peakWindowTokens)}</span>
            </div>
            <p className="usage-note">
              {summary.peakWindowTokens > 0 ? (
                suggested
                  ? <>That looks like <strong>{PLAN_SPECS[suggested].label}</strong>. If a ceiling has ever been hit, the busiest window IS approximately the ceiling.</>
                  : <>Not close enough to any plan&apos;s estimate to say which. An account that has never come near its limit has not revealed it.</>
              ) : <>No history yet.</>}
            </p>
            <p className="usage-note dim">
              Set <code>&quot;plan&quot;: &quot;max-20x&quot;</code> or an exact <code>&quot;tokenBudget&quot;</code> in
              %APPDATA%/SkynetOS/settings.json. A number always wins over a plan estimate.
            </p>
          </div>

          <div className="usage-foot">
            ALL TIME {formatTokens(weightedTokens(summary.allTime))} WEIGHTED
          </div>
        </div>
      ) : null}
    </div>
  );
}
