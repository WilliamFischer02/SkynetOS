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
   * The allowance, from settings.json. Null when neither a `tokenBudget` nor a `plan` is set —
   * see the header for why this is not guessed.
   */
  budgetTokens: number | null;
  /** Where that number came from, so the meter can say whether it is chosen or estimated. */
  budgetSource: 'setting' | 'plan' | 'none';
  /** The plan named in settings, if any. */
  plan: string | null;
  /**
   * Calibration, measured from the whole history rather than the window: the busiest five-hour
   * span this account has ever had. If a ceiling has ever been hit, this is approximately it.
   */
  peakWindowTokens: number;
  /** What a real limit hit says the budget is. See `calibrateFromLimits`. Absent on an error. */
  calibration?: UsageCalibration;
  /** Set when reading the conversation store failed, so the widget can say so. */
  error?: string;
}

/* ────────────────────────── calibrating against a real limit ────────────────────────── */

/**
 * One request Claude refused because a limit was reached, as the transcript recorded it.
 *
 * Claude Code writes the refusal into the conversation with a `quotaLimits` object:
 * `{ status: "rejected", rateLimitType: "five_hour", resetsAt: <epoch s>, … }`. Found on this
 * machine on 2026-09-08. It is the one place a ceiling is recorded rather than estimated.
 */
export interface LimitHit {
  /** When the refusal happened, epoch ms. */
  at: number;
  /** When that limit resets, epoch ms. */
  resetsAt: number;
  /** `five_hour`, `seven_day`, …, as Claude Code named it. */
  type: string;
}

export interface UsageCalibration {
  /**
   * Weighted tokens spent in the five-hour window that ended in a refusal: the budget, MEASURED.
   * Null when no five-hour limit has ever been hit here, in which case every budget is an estimate.
   */
  measuredBudget: number | null;
  /** When that limit was hit, epoch ms. */
  measuredAt: number | null;
  /** How many distinct five-hour windows have ended in a refusal. */
  hits: number;
}

const FIVE_HOURS_MS = 5 * 3_600_000;

/**
 * The budget, from the most recent five-hour limit actually hit.
 *
 * William: "double down on ensuring the resource monitor for credit usage is as accurate as
 * possible." A refusal is the only moment the account says where its ceiling is. The window it
 * closed began five hours before it resets. Everything spent between that start and the refusal
 * is, by definition, the whole allowance. The most recent hit wins, because a plan can change
 * and an old ceiling is a stale fact. Several refusals in the same window count once.
 */
export function calibrateFromLimits(limits: readonly LimitHit[], events: readonly [number, number][]): UsageCalibration {
  const windows = new Map<number, LimitHit>();
  for (const hit of [...limits].filter((l) => l.type === 'five_hour' && Number.isFinite(l.at) && Number.isFinite(l.resetsAt)).sort((a, b) => b.at - a.at)) {
    if (!windows.has(hit.resetsAt)) windows.set(hit.resetsAt, hit);
  }
  const latest = [...windows.values()][0];
  if (!latest) return { measuredBudget: null, measuredAt: null, hits: 0 };
  const start = latest.resetsAt - FIVE_HOURS_MS;
  let spent = 0;
  for (const [at, w] of events) if (at >= start && at <= latest.at) spent += w;
  return { measuredBudget: spent > 0 ? Math.round(spent) : null, measuredAt: latest.at, hits: windows.size };
}

/**
 * The budget implied by Claude's own percentage: what was measured here, divided by the share of
 * the allowance Claude says it was. `/usage` in Claude Code and claude.ai's usage page both show
 * the current session as a percentage. That is the one number the account reports and this disk
 * does not have.
 */
export function budgetFromPercent(usedTokens: number, percentUsed: number): number | null {
  if (!(percentUsed > 0 && percentUsed <= 100) || !(usedTokens > 0)) return null;
  return Math.round(usedTokens / (percentUsed / 100));
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
  /** Distinct files Claude touched inside this node's folders or files, inside the window. */
  touchedFiles?: number;
}

/* ────────────────────────── what Claude actually worked on ────────────────────────── */

/**
 * One assistant message inside the window: what it cost, which project's conversation it was in,
 * and which files its tool calls named.
 *
 * ── Why files, and not only projects ──────────────────────────────────────────────────────────
 *
 * William: "the bot movement should be proportional and updating based on which repos or files
 * claude has worked within." Attributing by project directory alone credits the directory a
 * session was STARTED in. A session started in C:/dev that spends an hour editing
 * C:/dev/SkynetOS/src sent every token to "C:/dev" and none to the SkynetOS repo node, which is
 * where the work actually happened. The tool calls say where it happened: every Read, Edit and
 * Write names its file in the same transcript line that carries the usage.
 */
export interface ActivityEvent {
  /** Weighted tokens (see `weightedTokens`). */
  w: number;
  /** The Claude project directory the conversation lives in, e.g. `C--dev`. */
  project: string;
  /** Normalised absolute paths the message's tool calls named. Often empty. */
  paths: string[];
}

/** What one board node stands for, for attribution. */
export interface NodeClaim {
  nodeId: string;
  /** Claude project directories whose conversations are this node's own (an agent's cwd). */
  projects: string[];
  /** Folders: a touched path inside one of these is work in this node. */
  dirs: string[];
  /** Single files: a touched path equal to one of these is work in this node. */
  files: string[];
}

/** One spelling for a path, so `C:\Dev\X` and `c:/dev/x/` compare equal. Windows is case-insensitive. */
export function normalisePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

const isAbsolutePath = (p: string): boolean => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\');

/**
 * The paths a transcript message's tool calls named.
 *
 * `file_path` (Read, Edit, Write), `notebook_path` (NotebookEdit) and `path` (Grep, Glob, which
 * name a folder). A relative one is resolved against the conversation's own `cwd`, which every
 * transcript line records. Anything else, including a Bash command line, is not parsed: guessing
 * paths out of shell text would credit work to folders that were only mentioned.
 */
export function toolPaths(content: unknown, cwd?: string): string[] {
  if (!Array.isArray(content)) return [];
  const out = new Set<string>();
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as { type?: unknown; input?: unknown };
    if (b.type !== 'tool_use' || !b.input || typeof b.input !== 'object') continue;
    const input = b.input as Record<string, unknown>;
    for (const key of ['file_path', 'notebook_path', 'path']) {
      const value = input[key];
      if (typeof value !== 'string' || !value.trim()) continue;
      const raw = value.trim();
      const absolute = isAbsolutePath(raw) ? raw : cwd ? `${cwd.replace(/[\\/]+$/, '')}/${raw}` : null;
      if (absolute) out.add(normalisePath(absolute));
    }
  }
  return [...out];
}

/**
 * Share out the window's activity between the nodes of one board.
 *
 * Each message is claimed by every node it belongs to: the node whose own conversation it was
 * (by project), and every node whose folder or file it touched. It is SPLIT evenly between them,
 * so a message is never counted twice and the shares across a board still sum to at most 1. That
 * rule is the whole point: a repo that is both a `store.repo` on the board and inside a room
 * drive would otherwise send twice the traffic it earned.
 *
 * A message nobody claims still counts toward the total. The shares are fractions of ALL Claude
 * activity on this machine, not of the part this board happens to show, so a quiet board looks
 * quiet.
 */
export function attributeActivity(events: readonly ActivityEvent[], claims: readonly NodeClaim[]): UsageRoute[] {
  const total = events.reduce((sum, e) => sum + e.w, 0);
  if (total <= 0) return [];

  const prepared = claims.map((c) => ({
    nodeId: c.nodeId,
    projects: new Set(c.projects),
    dirs: c.dirs.map(normalisePath).filter(Boolean),
    files: new Set(c.files.map(normalisePath).filter(Boolean))
  }));
  const tally = new Map<string, { tokens: number; projects: Set<string>; touched: Set<string> }>();

  for (const event of events) {
    const claimants: { nodeId: string; byProject: boolean; touched: string[] }[] = [];
    for (const claim of prepared) {
      const byProject = claim.projects.has(event.project);
      const touched = event.paths.filter((p) => claim.files.has(p) || claim.dirs.some((d) => p === d || p.startsWith(`${d}/`)));
      if (byProject || touched.length) claimants.push({ nodeId: claim.nodeId, byProject, touched });
    }
    if (!claimants.length) continue;
    const portion = event.w / claimants.length;
    for (const c of claimants) {
      const entry = tally.get(c.nodeId) ?? { tokens: 0, projects: new Set<string>(), touched: new Set<string>() };
      entry.tokens += portion;
      entry.projects.add(event.project);
      for (const p of c.touched) entry.touched.add(p);
      tally.set(c.nodeId, entry);
    }
  }

  const routes: UsageRoute[] = [];
  for (const [nodeId, entry] of tally) {
    if (entry.tokens <= 0) continue;
    routes.push({
      nodeId,
      share: entry.tokens / total,
      projects: [...entry.projects].sort(),
      windowTokens: entry.tokens,
      touchedFiles: entry.touched.size
    });
  }
  routes.sort((a, b) => b.share - a.share || a.nodeId.localeCompare(b.nodeId));
  return routes;
}

/**
 * Where a value sits between zero and a ceiling, as a fraction 0..1.
 *
 * Pulled out because three different bars need it and each one has a different reason to be
 * ungraded: no ceiling at all, a ceiling of zero, or a value past it. Every one of those has to
 * come back as a number a bar can draw rather than NaN or Infinity.
 */
export function fraction(value: number, ceiling: number | null): number {
  if (ceiling === null || !Number.isFinite(ceiling) || ceiling <= 0) return 0;
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(1, value / ceiling);
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
