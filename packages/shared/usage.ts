/**
 * Claude usage: what it is measured from, and what may honestly be said about it.
 *
 * ── Where the numbers come from ───────────────────────────────────────────────────────────────
 *
 * Claude Code writes every conversation to `~/.claude/projects/<mangled-cwd>/<uuid>.jsonl`, and
 * every assistant record in there carries a real `usage` object and a real timestamp:
 *
 *     { "type": "assistant", "timestamp": "...", "message": { "model": "...", "usage": {
 *         "input_tokens": 2, "cache_creation_input_tokens": 16416,
 *         "cache_read_input_tokens": 31396, "output_tokens": 226 } } }
 *
 * That is measurement, not estimation, and it is per project directory — which is exactly the
 * granularity the board needs, because a node's `cwd` IS a project directory.
 *
 * ── What is NOT knowable, and is therefore not invented ───────────────────────────────────────
 *
 * How much of a subscription's allowance is left is not on this disk. There is no file for it and
 * no local API that reports it. Prime directive 1 forbids making one up, so `remainingTokens` and
 * `remainingTime` are `null` until the user writes a `tokenBudget` into settings.json, and the
 * widget says SET A BUDGET instead of showing a confident fiction.
 *
 * The rate is real whether or not a budget exists. That is the number that answers "am I burning
 * this fast on purpose", and it needs no allowance to be true.
 */

/** Every token that passed through the model, by category. All four are billable in some form. */
export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const ZERO_TOKENS: TokenCounts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export function addTokens(a: TokenCounts, b: TokenCounts): TokenCounts {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite
  };
}

/**
 * One number for "how much did this cost me".
 *
 * Cache reads are counted at a tenth, because that is what they are priced at across the Claude
 * models and counting them at par would make a long session look ten times heavier than it is —
 * SkynetOS's own project directory has 445M cache-read tokens against 1.6M output, so an unweighted
 * total is a cache-read meter wearing a usage meter's label.
 *
 * This is a weighting, not a price. It is deliberately not dollars: pricing changes, this file
 * would go stale, and a stale money number is worse than an honest relative one.
 */
export const CACHE_READ_WEIGHT = 0.1;

export function weightedTokens(t: TokenCounts): number {
  return t.input + t.output + t.cacheWrite + t.cacheRead * CACHE_READ_WEIGHT;
}

export function totalTokens(t: TokenCounts): number {
  return t.input + t.output + t.cacheWrite + t.cacheRead;
}

/** Usage attributed to one project directory. */
export interface ProjectUsage {
  /** The mangled directory name under ~/.claude/projects, e.g. `C--dev-SkynetOS`. */
  projectDir: string;
  /** The working directory it corresponds to, e.g. `C:\dev\SkynetOS`. Best effort. */
  cwd: string;
  /** Everything ever recorded for this project. */
  allTime: TokenCounts;
  /** Recorded inside the rolling window — what the rate and the share are computed from. */
  window: TokenCounts;
  /** Cost in USD, summed from Claude Code's own `cost-state` records. Null when it recorded none. */
  costUSD: number | null;
  /** Epoch ms of the most recent assistant message. Null when there has never been one. */
  lastActivity: number | null;
  /** Assistant messages inside the window. The robots' packet count is derived from this. */
  messagesInWindow: number;
}

export interface UsageSummary {
  /** The rolling window these figures cover, in hours. */
  windowHours: number;
  /** When this snapshot was taken, epoch ms. */
  takenAt: number;
  /** Every project directory, busiest first by weighted window tokens. */
  projects: ProjectUsage[];
  /** Sum across every project, inside the window. */
  window: TokenCounts;
  allTime: TokenCounts;
  /**
   * The allowance, from settings.json. Null when the user has not set one — see the header for
   * why this is not guessed.
   */
  budgetTokens: number | null;
  /** Set when reading the conversation store failed, so the widget can say so. */
  error?: string;
}

/** The three numbers William asked for, plus what each is derived from. */
export interface UsageReadout {
  /** Weighted tokens per hour across the window. Always real. */
  ratePerHour: number;
  /** Budget minus what the window consumed. Null when no budget is configured. */
  remainingTokens: number | null;
  /** Hours of headroom at the current rate. Null when there is no budget, or the rate is zero. */
  remainingHours: number | null;
  /** Weighted tokens consumed inside the window. */
  usedTokens: number;
}

/**
 * Turn a summary into the readout. Pure, so test/usage.test.ts can hold the arithmetic — and
 * specifically hold the rule that an unknown budget produces `null` rather than a number.
 */
export function readout(summary: UsageSummary): UsageReadout {
  const used = weightedTokens(summary.window);
  const hours = Math.max(summary.windowHours, 1 / 60);
  const ratePerHour = used / hours;

  if (summary.budgetTokens === null || summary.budgetTokens <= 0) {
    return { ratePerHour, remainingTokens: null, remainingHours: null, usedTokens: used };
  }

  const remainingTokens = Math.max(0, summary.budgetTokens - used);
  // A zero rate means infinite headroom, which is not a useful thing to print. Null says
  // "nothing is running", and the widget renders that as a dash.
  const remainingHours = ratePerHour > 0 ? remainingTokens / ratePerHour : null;
  return { ratePerHour, remainingTokens, remainingHours, usedTokens: used };
}

/**
 * Each project's share of window activity, 0..1, summing to 1 across all of them.
 *
 * This is what drives the couriers: how many little robots walk to a node, and how often. An
 * empty window means no shares at all rather than an even split — nothing is happening, so
 * nothing should be walking.
 */
export function shares(summary: UsageSummary): Map<string, number> {
  const out = new Map<string, number>();
  const total = summary.projects.reduce((sum, p) => sum + weightedTokens(p.window), 0);
  if (total <= 0) return out;
  for (const p of summary.projects) out.set(p.projectDir, weightedTokens(p.window) / total);
  return out;
}

/**
 * Claude Code's directory name for a working directory: every non-alphanumeric becomes `-`.
 * Mirrors `projectDirName` in src/main/services/conversations.ts, which has the caveats.
 */
export function projectDirFor(cwd: string): string {
  return cwd.replace(/\\/g, '/').replace(/\//g, '-').replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * One node's slice of board activity, and what it was derived from.
 *
 * Computed in main (src/main/services/usage.ts) because attributing a room drive to everything
 * inside it needs to read child board files. Declared here because it crosses the IPC boundary,
 * and packages/shared is the one place both sides may look at.
 */
export interface UsageRoute {
  nodeId: string;
  /** 0..1. Sums to at most 1 across a board — a project claimed by several nodes is SPLIT. */
  share: number;
  /** The project directories this node stands for. Shown in the inspector. */
  projects: string[];
  /** Weighted tokens inside the window, attributed to this node. */
  windowTokens: number;
}

/** Compact token counts for a HUD: 1.2M, 43.7K, 812. Never scientific notation. */
export function formatTokens(value: number): string {
  const n = Math.max(0, Math.round(value));
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Hours as `4h 20m`, `18m`, or `< 1m`. Null renders as a dash by the caller. */
export function formatDuration(hours: number): string {
  const minutes = Math.round(hours * 60);
  if (minutes < 1) return '< 1m';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
