import { useEffect, useState } from 'react';
import type { UsageSummary } from '@shared/usage.js';
import { formatDuration, formatTokens, readout, weightedTokens } from '@shared/usage.js';

/**
 * The usage meter, top-left, always on.
 *
 * William asked for three calculated values: the token usage rate, the remaining token pool, and
 * the remaining operation time. Two of the three are real measurements off this machine's own
 * conversation files. The third — the pool — is not knowable locally, so the meter says so and
 * points at the setting instead of printing a number it made up. See packages/shared/usage.ts.
 *
 * Expanding it lists the busiest projects in the window, which is the same ranking the couriers
 * walk: if MinecraftOS is at the top here, that is where the robots are going.
 */

const REFRESH_MS = 20_000;

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
        <div className="usage-head">USAGE</div>
        <div className="usage-error">{summary.error}</div>
      </div>
    );
  }

  const { ratePerHour, remainingTokens, remainingHours, usedTokens } = readout(summary);
  const budgeted = summary.budgetTokens !== null && summary.budgetTokens > 0;
  const fraction = budgeted ? Math.min(1, usedTokens / (summary.budgetTokens as number)) : 0;

  // Ten cells, filled by whole cells only. A partially-filled cell would be a sub-pixel edge,
  // and docs/02 anti-mush applies to the chrome as much as to the canvas.
  const filled = Math.round(fraction * 10);
  const level = fraction >= 0.9 ? 'fault' : fraction >= 0.7 ? 'warn' : 'ok';

  const busiest = summary.projects.filter((p) => weightedTokens(p.window) > 0).slice(0, 6);

  return (
    <div className={`usage-meter ${budgeted ? level : ''}`}>
      <button
        type="button"
        className="usage-head"
        onClick={() => setOpen((v) => !v)}
        title={
          `Measured from ~/.claude/projects over the last ${summary.windowHours}h. ` +
          'Weighted tokens: input + output + cache writes + cache reads at one tenth, because ' +
          'cache reads are priced at a tenth and would otherwise dominate every figure.'
        }
      >
        <span>USAGE</span>
        <span className="usage-window">{summary.windowHours}H</span>
        <span className="usage-toggle">{open ? '−' : '+'}</span>
      </button>

      <dl className="usage-rows">
        <dt title="Weighted tokens per hour across the window. Always measured, never estimated.">RATE</dt>
        <dd>{formatTokens(ratePerHour)}<span className="usage-unit">/h</span></dd>

        <dt title="Your configured budget minus what this window consumed.">POOL LEFT</dt>
        <dd>
          {remainingTokens === null
            ? <span className="usage-unset" title="SkynetOS cannot read your subscription allowance — no local file or API reports it, so it will not guess. Set tokenBudget in %APPDATA%/SkynetOS/settings.json.">SET A BUDGET</span>
            : formatTokens(remainingTokens)}
        </dd>

        <dt title="Pool left divided by the current rate. How long you can keep going at this pace.">TIME LEFT</dt>
        <dd>
          {remainingHours === null
            ? <span className="usage-unset">{budgeted ? 'IDLE' : '—'}</span>
            : formatDuration(remainingHours)}
        </dd>
      </dl>

      {budgeted ? (
        <div className="usage-bar" title={`${formatTokens(usedTokens)} of ${formatTokens(summary.budgetTokens as number)} used`}>
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} className={i < filled ? 'cell on' : 'cell'} />
          ))}
        </div>
      ) : null}

      {open ? (
        <div className="usage-projects">
          <div className="usage-projects-head">BUSIEST THIS WINDOW</div>
          {busiest.length ? busiest.map((p) => (
            <div className="usage-project" key={p.projectDir} title={p.cwd}>
              <span className="up-name">{p.projectDir.replace(/^[A-Za-z]--/, '').replace(/-/g, '/')}</span>
              <span className="up-tokens">{formatTokens(weightedTokens(p.window))}</span>
              <span className="up-msgs">{p.messagesInWindow} msg</span>
            </div>
          )) : <div className="dim">NOTHING IN THE LAST {summary.windowHours}H</div>}
          <div className="usage-foot">
            ALL TIME {formatTokens(weightedTokens(summary.allTime))} WEIGHTED
          </div>
        </div>
      ) : null}
    </div>
  );
}
