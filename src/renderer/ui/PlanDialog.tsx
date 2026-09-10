import { useEffect, useState } from 'react';
import { PLANS, PLAN_SPECS, parsePlanInput, planFromPeak, type PlanId } from '@shared/plans.js';
import { formatTokens } from '@shared/usage.js';
import { useBoardStore } from '../store/useBoardStore.js';

/**
 * "Which plan am I on?" — asked once, from the meter, instead of by editing JSON.
 *
 * William: "the 'SET A PLAN' text should be clickable and open up a dialogue prompt that the user
 * can input their plan into and it automatically parses the data from there."
 *
 * So the primary control is a text box that takes whatever you actually say — `Max 20x`, `max20`,
 * `20x`, `Claude Pro`, or a bare `96M` if you would rather state the budget directly — and echoes
 * back what it understood before you commit. The buttons underneath are the same thing for people
 * who would rather point at it.
 *
 * It also shows the account's own measured peak, so the estimate can be checked against evidence
 * rather than taken on trust. If a ceiling has ever been hit, that peak IS approximately it.
 */

export interface PlanDialogProps {
  /** The busiest window ever measured, for the calibration line. */
  peakWindowTokens: number;
  windowHours: number;
  onClose: () => void;
  onSaved: () => void;
}

export function PlanDialog({ peakWindowTokens, windowHours, onClose, onSaved }: PlanDialogProps): React.JSX.Element {
  const toast = useBoardStore((s) => s.toast);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { event.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const parsed = parsePlanInput(text);
  const suggested = planFromPeak(peakWindowTokens);

  const commit = async (plan: PlanId | null, tokenBudget: number | null) => {
    setSaving(true);
    const result = await window.skynet['settings:setPlan'](plan, tokenBudget);
    setSaving(false);
    if (!result.ok) { toast('fault', result.error ?? 'COULD NOT SAVE'); return; }
    toast('ok', plan ? `plan set to ${PLAN_SPECS[plan].label}` : 'plan cleared');
    onSaved();
    onClose();
  };

  return (
    <div className="plan-dialog">
      <div className="plan-head">
        <span>WHICH CLAUDE PLAN?</span>
        <button type="button" className="btn tiny" onClick={onClose}>Close (Esc)</button>
      </div>

      <p className="plan-note">
        SkynetOS cannot read this from your account — nothing local reports it. Tell it once and the
        meter can show a remaining pool instead of a dash.
      </p>

      <form
        className="plan-form"
        onSubmit={(e) => { e.preventDefault(); if (parsed.plan) void commit(parsed.plan, parsed.tokenBudget); }}
      >
        <label className="field-label" htmlFor="plan-input">
          Type it however you say it
          <span className="field-hint" title="Max 20x · max20 · 20x · Claude Pro · free — or a budget directly, like 96M">?</span>
        </label>
        <input
          id="plan-input"
          className="input"
          type="text"
          autoFocus
          spellCheck={false}
          placeholder="Max 20x"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={saving}
        />
        <div className={parsed.plan ? 'plan-reading ok' : 'plan-reading'}>
          {text.trim() ? <>Read as: <strong>{parsed.reading}</strong></> : <>Also accepts a budget directly — <code>96M</code>, <code>96,000,000</code>.</>}
        </div>
        <button type="submit" className="btn primary" disabled={!parsed.plan || saving}>
          {saving ? 'Saving…' : 'Use that'}
        </button>
      </form>

      <div className="plan-choices">
        <div className="section-head">Or pick one</div>
        {PLANS.filter((id) => id !== 'custom').map((id) => {
          const spec = PLAN_SPECS[id];
          return (
            <button
              type="button"
              className={suggested === id ? 'btn primary' : 'btn'}
              key={id}
              disabled={saving}
              onClick={() => void commit(id, null)}
              title={`${spec.note} Estimated budget: ${formatTokens(spec.windowTokens ?? 0)} weighted tokens per ${windowHours}h.`}
            >
              {spec.label}
              <span className="plan-budget">{formatTokens(spec.windowTokens ?? 0)}</span>
              {suggested === id ? <span className="plan-match">matches your history</span> : null}
            </button>
          );
        })}
      </div>

      <div className="plan-calibration">
        <div className="section-head">Your own numbers</div>
        {peakWindowTokens > 0 ? (
          <p className="plan-note">
            Busiest {windowHours}h you have ever had: <strong>{formatTokens(peakWindowTokens)}</strong> weighted tokens.
            {suggested
              ? <> That is closest to <strong>{PLAN_SPECS[suggested].label}</strong>. If you have ever hit a ceiling, this is roughly where it is.</>
              : <> Not close enough to any plan to say which — an account that has never come near its limit has not revealed it.</>}
          </p>
        ) : (
          <p className="plan-note">No history measured yet.</p>
        )}
        {peakWindowTokens > 0 ? (
          <button
            type="button"
            className="btn"
            disabled={saving}
            onClick={() => void commit('custom', Math.round(peakWindowTokens))}
            title="Meter against exactly what you have actually managed to spend in one window, rather than against an estimate."
          >
            Use my measured peak ({formatTokens(peakWindowTokens)})
          </button>
        ) : null}
      </div>

      <div className="plan-foot">
        Every plan figure is an ESTIMATE: the multiplier is published, the baseline is calibrated
        from this machine&apos;s history. An exact budget always wins over one. Stored in
        %APPDATA%/SkynetOS/settings.json — the only two settings this app will write for you.
      </div>
    </div>
  );
}
