/**
 * Claude plans, and the one honest way to turn one into a number.
 *
 * ── The problem ───────────────────────────────────────────────────────────────────────────────
 *
 * William asked: "How can I set it so that it knows I have the Claude Max plan 20x usage over Pro."
 *
 * SkynetOS cannot ask. There is no local file and no local API that reports which plan an account
 * is on or how much of its allowance is left, and Anthropic does not publish a TOKEN figure for
 * any plan — the published shape is "Max 20x is twenty times Pro", and the documented per-plan
 * numbers are ranges of prompts per five hours, which is not a unit this meter can add up.
 *
 * So the plan name gives a MULTIPLIER, which is published and stable, and the baseline it
 * multiplies is CALIBRATED from the machine's own history. That is the part SkynetOS can actually
 * know, because every token this account has ever spent is sitting in ~/.claude/projects.
 *
 * ── How the baseline was calibrated ───────────────────────────────────────────────────────────
 *
 * Measured on William's machine, 2026-09-10, over 10,715 assistant messages spanning three weeks:
 *
 *     5-hour window distribution:  p50 13.2M   p90 52.0M   p99 94.6M   max 96.1M
 *
 * The top of that distribution is flat: p99 is 94.6M and the maximum is 96.1M, a gap of 1.6%
 * across the last percentile. Demand that tapers does not do that. A ceiling being hit does.
 * So ~96M weighted tokens is this account's real five-hour ceiling, on Max 20x.
 *
 * Dividing by the published multiplier gives a Pro-equivalent baseline of ~4.8M, and the other
 * plans follow. These are ESTIMATES calibrated from one account's observed behaviour, and they are
 * labelled as such everywhere they are shown. `tokenBudget` in settings.json overrides all of it
 * with a number the user trusts, and `usage:calibrate` re-measures at any time.
 *
 * Weighted tokens, not raw: cache reads count at a tenth. See packages/shared/usage.ts.
 */

export const PLANS = ['free', 'pro', 'max-5x', 'max-20x', 'custom'] as const;
export type PlanId = (typeof PLANS)[number];

export interface PlanSpec {
  id: PlanId;
  label: string;
  /** Multiple of Pro, as Anthropic names the plans. `custom` has none. */
  multiplier: number | null;
  /**
   * Weighted tokens in a five-hour window. Null for `custom`, which means "use `tokenBudget`".
   * An estimate — see the header for exactly what it was derived from.
   */
  windowTokens: number | null;
  note: string;
}

/**
 * The Pro-equivalent five-hour budget, in weighted tokens.
 *
 * Everything else is this times the plan's published multiplier. One number to re-tune when a
 * better measurement turns up, rather than four that can drift apart.
 */
export const PRO_BASELINE_TOKENS = 4_800_000;

export const PLAN_SPECS: Record<PlanId, PlanSpec> = {
  'free': {
    id: 'free',
    label: 'Free',
    multiplier: 0.2,
    windowTokens: Math.round(PRO_BASELINE_TOKENS * 0.2),
    note: 'Roughly a fifth of Pro. Claude Code is not generally available on Free.'
  },
  'pro': {
    id: 'pro',
    label: 'Pro',
    multiplier: 1,
    windowTokens: PRO_BASELINE_TOKENS,
    note: 'The baseline every other plan is a multiple of.'
  },
  'max-5x': {
    id: 'max-5x',
    label: 'Max 5x',
    multiplier: 5,
    windowTokens: PRO_BASELINE_TOKENS * 5,
    note: 'Five times Pro.'
  },
  'max-20x': {
    id: 'max-20x',
    label: 'Max 20x',
    multiplier: 20,
    windowTokens: PRO_BASELINE_TOKENS * 20,
    note: 'Twenty times Pro. Calibrated against a measured 96.1M peak five-hour window.'
  },
  'custom': {
    id: 'custom',
    label: 'Custom',
    multiplier: null,
    windowTokens: null,
    note: 'Uses tokenBudget from settings.json verbatim.'
  }
};

export function isPlanId(value: string): value is PlanId {
  return (PLANS as readonly string[]).includes(value);
}

/**
 * The budget to meter against, and where it came from.
 *
 * An explicit `tokenBudget` always wins: it is a number the user chose, and a measurement should
 * never argue with an instruction. Absent that, the plan supplies an estimate. Absent both, null —
 * and the meter says SET A BUDGET rather than inventing one.
 */
export interface ResolvedBudget {
  tokens: number | null;
  source: 'setting' | 'plan' | 'none';
  plan: PlanId | null;
  /** True when this is a calibrated estimate rather than a number the user chose. */
  estimated: boolean;
}

export function resolveBudget(plan: PlanId | null, tokenBudget: number | null): ResolvedBudget {
  if (tokenBudget !== null && tokenBudget > 0) {
    return { tokens: tokenBudget, source: 'setting', plan, estimated: false };
  }
  if (plan && plan !== 'custom') {
    const spec = PLAN_SPECS[plan];
    if (spec.windowTokens !== null) {
      return { tokens: spec.windowTokens, source: 'plan', plan, estimated: true };
    }
  }
  return { tokens: null, source: 'none', plan, estimated: false };
}

/**
 * Which plan a measured peak most resembles.
 *
 * Used by the calibration readout to say "your ceiling looks like Max 20x" from evidence, rather
 * than asking the user to trust the table. Returns null when there is not enough history to have
 * seen a ceiling at all — an account that has never come close to its limit has not revealed it,
 * and guessing from a quiet week would be worse than saying nothing.
 */
export function planFromPeak(peakWindowTokens: number): PlanId | null {
  if (peakWindowTokens <= 0) return null;
  let best: PlanId | null = null;
  let bestRatio = Infinity;
  for (const id of PLANS) {
    const spec = PLAN_SPECS[id];
    if (spec.windowTokens === null) continue;
    // Log-distance, so being 2x over and 2x under a plan count the same. A linear comparison
    // makes every large peak look like the largest plan.
    const ratio = Math.abs(Math.log(peakWindowTokens / spec.windowTokens));
    if (ratio < bestRatio) { bestRatio = ratio; best = id; }
  }
  // More than 2.5x away from every plan means it matches none of them convincingly.
  return bestRatio <= Math.log(2.5) ? best : null;
}

/**
 * Parse a plan out of whatever a person types.
 *
 * William asked for a prompt he can "input their plan into and it automatically parses the data
 * from there", so this accepts the shapes people actually write: `Max 20x`, `max20`, `20x`,
 * `claude max 20`, `pro`, `Claude Pro`. It also accepts a bare token count — `96000000`, `96M` —
 * because "what my plan is" and "how many tokens I get" are the same question answered two ways.
 *
 * Returns what it understood AND what it did not, so the dialog can say "I read that as Max 20x"
 * rather than silently picking something.
 */
export interface ParsedPlan {
  plan: PlanId | null;
  tokenBudget: number | null;
  /** How the input was understood, for the dialog to echo back. */
  reading: string;
}

export function parsePlanInput(raw: string): ParsedPlan {
  const text = raw.trim().toLowerCase();
  if (!text) return { plan: null, tokenBudget: null, reading: 'nothing — the meter will ask again' };

  // An explicit token count wins: it is the least ambiguous thing anyone can type.
  const tokens = /^([\d.,]+)\s*([kmb])?\s*(tokens?)?$/.exec(text);
  if (tokens) {
    const value = Number.parseFloat((tokens[1] ?? '').replace(/,/g, ''));
    if (Number.isFinite(value) && value > 0) {
      const scale = tokens[2] === 'b' ? 1e9 : tokens[2] === 'm' ? 1e6 : tokens[2] === 'k' ? 1e3 : 1;
      const budget = Math.round(value * scale);
      return { plan: 'custom', tokenBudget: budget, reading: `an exact budget of ${budget.toLocaleString()} weighted tokens per window` };
    }
  }

  // "20x", "max 20", "max20x", "claude max 20x"
  const multiple = /(\d+)\s*x?/.exec(text);
  const mentionsMax = text.includes('max');
  if (mentionsMax && multiple) {
    const n = Number.parseInt(multiple[1] ?? '', 10);
    if (n >= 15) return { plan: 'max-20x', tokenBudget: null, reading: 'Max 20x' };
    if (n >= 3) return { plan: 'max-5x', tokenBudget: null, reading: 'Max 5x' };
  }
  if (mentionsMax) return { plan: 'max-20x', tokenBudget: null, reading: 'Max — assuming 20x, change it below if not' };
  if (text.includes('pro')) return { plan: 'pro', tokenBudget: null, reading: 'Pro' };
  if (text.includes('free')) return { plan: 'free', tokenBudget: null, reading: 'Free' };
  if (multiple) {
    const n = Number.parseInt(multiple[1] ?? '', 10);
    if (n >= 15) return { plan: 'max-20x', tokenBudget: null, reading: 'Max 20x' };
    if (n >= 3) return { plan: 'max-5x', tokenBudget: null, reading: 'Max 5x' };
    if (n === 1) return { plan: 'pro', tokenBudget: null, reading: 'Pro' };
  }

  return { plan: null, tokenBudget: null, reading: `could not read "${raw.trim()}" — pick one below` };
}
