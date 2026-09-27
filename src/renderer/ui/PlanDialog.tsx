import { PanelHead } from './PanelHead.js';
import { failureLine } from '@shared/ui-copy.js';
import { useEffect, useState } from 'react';
import { FIXED_PLAN, PLANS, PLAN_SPECS, isPlanId, parsePlanInput, planFromPeak, type PlanId } from '@shared/plans.js';
import { budgetFromPercent, formatTokens, type UsageCalibration } from '@shared/usage.js';
import type { WeeklyReadout } from '@shared/usage-week.js';
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
 *
 * William, 2026-09-27: "my plan never changes from max 20x and it always resets credits on Mondays
 * at 8pm." So the plan select starts on Max 20x and says FIXED once it is set, the free-text and
 * pick-one controls fold away under "Change plan", and the first thing the dialog asks for is the
 * two WEEKLY percentages from claude.ai/usage. See packages/shared/usage-week.ts.
 */

export interface PlanDialogProps {
  /** The busiest window ever measured, for the calibration line. */
  peakWindowTokens: number;
  windowHours: number;
  /** Weighted tokens measured in the current window, for the percentage calibration. */
  usedTokens: number;
  /** What a real five-hour limit hit says the budget is, if one has been hit. */
  calibration?: UsageCalibration;
  /** The plan in settings.json, if set. The select says FIXED when it is. */
  plan?: string | null;
  /** The weekly pools as they stand, for the reset caption and the last readings. */
  weekly?: WeeklyReadout;
  onClose: () => void;
  onSaved: () => void;
}

export function PlanDialog({ peakWindowTokens, windowHours, usedTokens, calibration, plan, weekly, onClose, onSaved }: PlanDialogProps): React.JSX.Element {
  const toast = useBoardStore((s) => s.toast);
  const current = plan && isPlanId(plan) ? plan : null;
  const [selected, setSelected] = useState<PlanId>(current ?? FIXED_PLAN);
  const [weekAll, setWeekAll] = useState('');
  const [weekTop, setWeekTop] = useState('');
  /** Empty is "not given" (null); anything outside 0..100 is NaN, which blocks the save. */
  const readPercent = (raw: string): number | null => {
    if (!raw.trim()) return null;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : NaN;
  };
  const allValue = readPercent(weekAll);
  const topValue = readPercent(weekTop);
  const weeklyValid = (allValue !== null || topValue !== null) && !Number.isNaN(allValue) && !Number.isNaN(topValue);
  const [text, setText] = useState('');
  const [percent, setPercent] = useState('');
  const fromPercent = budgetFromPercent(usedTokens, Number.parseFloat(percent));
  const measured = calibration?.measuredBudget ?? null;
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
    if (!result.ok) { toast('fault', failureLine(result.error, 'COULD NOT SAVE THE PLAN', 'check settings.json is writable and try again')); return; }
    toast('ok', plan ? `plan set to ${PLAN_SPECS[plan].label}` : 'plan cleared');
    onSaved();
    onClose();
  };

  const saveWeekly = async () => {
    if (!weeklyValid) return;
    setSaving(true);
    const result = await window.skynet['settings:addUsageReadings']({ all: allValue, top: topValue });
    setSaving(false);
    if (!result.ok) { toast('fault', failureLine(result.error, 'COULD NOT SAVE THE READINGS', 'check settings.json is writable and try again')); return; }
    const said = [allValue !== null ? `all ${allValue}%` : '', topValue !== null ? `Fable ${topValue}%` : ''].filter(Boolean).join(', ');
    toast('ok', `weekly reading saved: ${said}`);
    setWeekAll('');
    setWeekTop('');
    onSaved();
  };

  const lastReading = (id: 'all' | 'top'): string => {
    const pool = weekly?.pools.find((p) => p.id === id);
    if (!pool) return '';
    if (pool.reading) return `last: ${Math.round(pool.reading.percent)}% at ${new Date(pool.reading.at).toLocaleString()}`;
    return pool.lastWeek ? `none this week (${pool.lastWeek.label.toLowerCase()} ${Math.round(pool.lastWeek.percent)}%)` : 'none yet';
  };

  return (
    <div className="plan-dialog">
      <PanelHead name="WHICH CLAUDE PLAN?" icon="usage" onClose={onClose} />

      <p className="plan-note">
        SkynetOS cannot read this from your account — nothing local reports it. Tell it once and the
        meter can show a remaining pool instead of a dash.
      </p>

      <div className="field-row">
        <label className="field-label" htmlFor="plan-select">Plan</label>
        <select
          id="plan-select"
          className="input"
          value={selected}
          disabled={saving}
          title={current ? `${PLAN_SPECS[current].label} is set in settings.json.` : `Not set yet. ${PLAN_SPECS[FIXED_PLAN].label} is your plan.`}
          onChange={(e) => { if (isPlanId(e.target.value)) setSelected(e.target.value); }}
        >
          {PLANS.filter((id) => id !== 'custom' || current === 'custom').map((id) => <option key={id} value={id}>{PLAN_SPECS[id].label}</option>)}
        </select>
        {current && selected === current
          ? <span className="plan-match" title="Your plan does not change. Pick another above only if it ever does.">FIXED</span>
          : <button type="button" className="btn primary" disabled={saving} onClick={() => void commit(selected, null)} title={`Meter usage against the ${PLAN_SPECS[selected].label} plan from now on`}>Set {PLAN_SPECS[selected].label}</button>}
      </div>

      {/*
        * The weekly pools: the two percentages claude.ai/usage shows for the week, all models and
        * Fable. Saved with the time they were typed; the meter carries them forward from there.
        */}
      <form className="plan-calibration" onSubmit={(e) => { e.preventDefault(); void saveWeekly(); }}>
        <div className="section-head">This week, from claude.ai/usage</div>
        {weekly ? <p className="plan-note">{weekly.reset.caption}</p> : null}
        <label className="field-label" htmlFor="plan-week-all">
          This week, all models (%)
          <span className="field-hint" title={lastReading('all') || 'The weekly all-models bar on claude.ai → Settings → Usage.'}>?</span>
        </label>
        <input
          id="plan-week-all"
          className="input"
          type="number"
          min={0}
          max={100}
          step={1}
          autoFocus
          placeholder={lastReading('all') || '48'}
          value={weekAll}
          disabled={saving}
          onChange={(e) => setWeekAll(e.target.value)}
        />
        <label className="field-label" htmlFor="plan-week-top">
          This week, Fable (%)
          <span className="field-hint" title={lastReading('top') || 'The weekly Fable bar on claude.ai → Settings → Usage: the percentage USED, not left.'}>?</span>
        </label>
        <input
          id="plan-week-top"
          className="input"
          type="number"
          min={0}
          max={100}
          step={1}
          placeholder={lastReading('top') || '78'}
          value={weekTop}
          disabled={saving}
          onChange={(e) => setWeekTop(e.target.value)}
        />
        <button type="submit" className="btn primary" disabled={!weeklyValid || saving} title="Save both weekly percentages, stamped with the time now (Enter)">
          {saving ? 'Saving…' : 'Save readings'}
        </button>
        <p className="plan-note">
          Percentages USED, as the page shows them. Stamped with the time you save them; between
          readings the meter moves them by this machine&apos;s own usage, and says so.
        </p>
      </form>

      <details open={!current}>
        <summary className="section-head">Change plan</summary>
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
          spellCheck={false}
          placeholder="Max 20x"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={saving}
        />
        <div className={parsed.plan ? 'plan-reading ok' : 'plan-reading'}>
          {text.trim() ? <>Read as: <strong>{parsed.reading}</strong></> : <>Also accepts a budget directly — <code>96M</code>, <code>96,000,000</code>.</>}
        </div>
        <button type="submit" className="btn primary" disabled={!parsed.plan || saving} title="Save the plan or budget you typed, as read above (Enter)">
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
      </details>

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

      {/*
        * Calibration from evidence, strongest first. A limit actually hit is a measurement of the
        * ceiling. Claude's own percentage is the account's word for where you are. Either beats a
        * plan multiplier, and both say what they rest on.
        */}
      <div className="plan-calibration">
        <div className="section-head">Calibrate from Claude&apos;s own numbers</div>
        {measured && calibration?.measuredAt ? (
          <>
            <p className="plan-note">
              You hit your five-hour limit on <strong>{new Date(calibration.measuredAt).toLocaleString()}</strong>.
              The window that ended in that refusal spent <strong>{formatTokens(measured)}</strong> weighted tokens,
              so that is your ceiling, measured rather than estimated
              {calibration.hits > 1 ? ` (the latest of ${calibration.hits} limit hits on record)` : ''}.
            </p>
            <button type="button" className="btn primary" disabled={saving} onClick={() => void commit('custom', measured)} title="Set your five-hour ceiling to what the last limit hit actually spent">
              Use the measured limit ({formatTokens(measured)})
            </button>
          </>
        ) : calibration && calibration.hits > 0 && calibration.measuredAt ? (
          <p className="plan-note">
            You hit your five-hour limit on <strong>{new Date(calibration.measuredAt).toLocaleString()}</strong>, but none of
            the usage in that window was on this machine, so it cannot be measured here. The limit is per account,
            and the sessions that reached it ran somewhere else.
          </p>
        ) : (
          <p className="plan-note">No five-hour limit has been hit on this machine, so there is no measured ceiling yet.</p>
        )}

        <label className="field-label" htmlFor="plan-percent">
          Session used, as Claude shows it (%)
          <span className="field-hint" title="Run /usage in Claude Code, or open claude.ai → Settings → Usage, and type the current session's percentage.">?</span>
        </label>
        <div className="field-row">
          <input
            id="plan-percent"
            className="input"
            type="number"
            min={1}
            max={100}
            step={1}
            placeholder="42"
            value={percent}
            disabled={saving}
            onChange={(e) => setPercent(e.target.value)}
          />
          <button type="button" className="btn" disabled={!fromPercent || saving} onClick={() => fromPercent && void commit('custom', fromPercent)} title="Set your five-hour ceiling from the percentage Claude shows you">
            {fromPercent ? `Use ${formatTokens(fromPercent)}` : 'Use that'}
          </button>
        </div>
        <p className="plan-note">
          SkynetOS measured {formatTokens(usedTokens)} in the last {windowHours}h and divides it by that percentage.
          Claude&apos;s session starts at your first message rather than rolling, so this is closest
          when you calibrate a few hours into a session, not in its first minutes. Only this machine&apos;s
          usage is visible here: if you have been working on another machine in the same session, its
          tokens count against your limit but not in this sum, and the budget comes out low.
        </p>
      </div>

      <div className="plan-foot">
        Every plan figure is an ESTIMATE: the multiplier is published, the baseline is calibrated
        from this machine&apos;s history. An exact budget always wins over one. Stored in
        %APPDATA%/SkynetOS/settings.json, beside your weekly readings: the only usage settings this
        app will write for you.
      </div>
    </div>
  );
}
