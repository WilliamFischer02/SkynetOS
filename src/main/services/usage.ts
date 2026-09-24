import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { BoardNode } from '@shared/types.js';
import {
  ZERO_TOKENS,
  addTokens,
  attributeActivity,
  calibrateFromLimits,
  normalisePath,
  projectDirFor,
  toolPaths,
  weightedTokens,
  type ActivityEvent,
  type LimitHit,
  type NodeClaim,
  type ProjectUsage,
  type TokenCounts,
  type UsageRoute,
  type UsageSummary
} from '@shared/usage.js';
import { resolveBudget } from '@shared/plans.js';
import { loadBoard, loadBoardByFile } from './board-store.js';
import { expandPath } from './target-resolver.js';
import { claudeProjectsDir } from './conversations.js';
import { getSettings } from './settings.js';

/**
 * Reading real Claude usage off this machine's disk.
 *
 * Every number here is measured from `~/.claude/projects/**\/*.jsonl`, which Claude Code writes
 * as it goes. Nothing is estimated and nothing is asked of a network. See packages/shared/usage.ts
 * for the shape of those records and for the one number that is NOT knowable this way.
 *
 * ── Why it is careful about cost ──────────────────────────────────────────────────────────────
 *
 * This machine has ~3.4 billion cache-read tokens on disk across eight projects, in files that run
 * to 22 MB. Parsing all of it as JSON on every board tick would stall the app. So:
 *
 *   - Only lines containing `"usage"` or `"cost-state"` are parsed at all. A string test on the
 *     raw line is roughly two orders of magnitude cheaper than JSON.parse, and skips the file
 *     snapshots and diffs that make up most of the bulk.
 *   - Results are cached against the newest mtime in each project directory, so a re-read after
 *     nothing has changed costs one stat per directory.
 *   - Files untouched since before the window are skipped entirely for window figures, which is
 *     most of them most of the time.
 */

interface CacheEntry {
  newestMtime: number;
  fileCount: number;
  windowStart: number;
  usage: ProjectUsage;
  /** [timestampMs, weightedTokens] for every assistant message, for the peak calculation. */
  events: [number, number][];
  /** Every assistant message inside the window, with the files its tool calls named. */
  activity: ActivityEvent[];
  /** Every refusal for a reached limit, for calibration. */
  limits: LimitHit[];
}

const cache = new Map<string, CacheEntry>();

/** The window's activity across every project, as of the last `readUsage`. What the couriers are shared out from. */
let latestActivity: ActivityEvent[] = [];

/** Undo Claude Code's directory mangling well enough to show a path. Best effort, and labelled so. */
function cwdFromProjectDir(dir: string): string {
  // `C--dev-SkynetOS` -> `C:\dev\SkynetOS`. The mangling is lossy (a real `-` in a folder name is
  // indistinguishable from a separator), so this is for display only and never for resolution.
  const drive = /^([A-Za-z])--(.*)$/.exec(dir);
  if (!drive) return dir;
  return `${drive[1]}:\\${(drive[2] ?? '').replace(/-/g, '\\')}`;
}

function tokensFrom(usage: Record<string, unknown>): TokenCounts {
  const num = (key: string): number => {
    const value = usage[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  };
  return {
    input: num('input_tokens'),
    output: num('output_tokens'),
    cacheRead: num('cache_read_input_tokens'),
    cacheWrite: num('cache_creation_input_tokens')
  };
}

/**
 * The busiest five-hour span in a stream of timestamped costs.
 *
 * A sliding window maximum over the whole history, not just the reporting window. This is the
 * calibration number: if the account has ever hit its plan's ceiling, the peak IS approximately
 * the ceiling, and it is the only defensible figure available locally. See packages/shared/plans.ts.
 */
export function peakWindow(events: [number, number][], hours: number): number {
  if (!events.length) return 0;
  const sorted = [...events].sort((a, b) => a[0] - b[0]);
  const span = hours * 3600_000;
  let best = 0;
  let sum = 0;
  let left = 0;
  for (let right = 0; right < sorted.length; right++) {
    sum += sorted[right]![1];
    while (sorted[right]![0] - sorted[left]![0] > span) {
      sum -= sorted[left]![1];
      left++;
    }
    if (sum > best) best = sum;
  }
  return best;
}

function scanProject(
  dir: string,
  projectDir: string,
  windowStart: number,
  events: [number, number][],
  activity: ActivityEvent[],
  limits: LimitHit[]
): ProjectUsage {
  let allTime: TokenCounts = ZERO_TOKENS;
  let windowTokens: TokenCounts = ZERO_TOKENS;
  let messagesInWindow = 0;
  let lastActivity: number | null = null;
  let costUSD: number | null = null;

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return {
      projectDir, cwd: cwdFromProjectDir(projectDir),
      allTime, window: windowTokens, costUSD: null, lastActivity: null, messagesInWindow: 0
    };
  }

  for (const file of files) {
    const full = join(dir, file);
    let text: string;
    try {
      text = readFileSync(full, 'utf8');
    } catch {
      continue;
    }

    for (const line of text.split('\n')) {
      // The cheap gate. Most lines in a conversation file are file snapshots and tool results.
      const hasUsage = line.includes('"usage"');
      const hasCost = line.includes('"cost-state"');
      // A refused request carries `quotaLimits`: the one record of where a ceiling actually is.
      const hasQuota = line.includes('"quotaLimits"');
      if (!hasUsage && !hasCost && !hasQuota) continue;

      let record: {
        type?: string;
        timestamp?: string;
        totalCostUSD?: number;
        /** The conversation's working directory, recorded on every line. Resolves relative tool paths. */
        cwd?: string;
        message?: { usage?: Record<string, unknown>; content?: unknown };
        quotaLimits?: { status?: string; resetsAt?: number; rateLimitType?: string };
      };
      try {
        record = JSON.parse(line) as typeof record;
      } catch {
        continue;
      }

      const quota = record.quotaLimits;
      if (hasQuota && quota?.status === 'rejected' && typeof quota.resetsAt === 'number') {
        const refusedAt = record.timestamp ? Date.parse(record.timestamp) : NaN;
        // Seconds in every record seen so far; milliseconds tolerated in case that ever changes.
        const resetsAt = quota.resetsAt < 1e12 ? quota.resetsAt * 1000 : quota.resetsAt;
        if (Number.isFinite(refusedAt)) limits.push({ at: refusedAt, resetsAt, type: quota.rateLimitType ?? 'unknown' });
      }

      if (hasCost && record.type === 'cost-state' && typeof record.totalCostUSD === 'number') {
        // Claude Code rewrites this record as a session progresses, so the LAST one in a file is
        // that session's final figure. Summed across files gives the project's spend.
        costUSD = (costUSD ?? 0) + record.totalCostUSD;
        continue;
      }

      const usage = record.message?.usage;
      if (!usage) continue;

      const tokens = tokensFrom(usage);
      allTime = addTokens(allTime, tokens);

      const at = record.timestamp ? Date.parse(record.timestamp) : NaN;
      if (Number.isFinite(at)) {
        if (lastActivity === null || at > lastActivity) lastActivity = at;
        events.push([at, weightedTokens(tokens)]);
        if (at >= windowStart) {
          windowTokens = addTokens(windowTokens, tokens);
          messagesInWindow++;
          // The files this message's tool calls named, from the same line that carries its usage,
          // so attributing it by file costs no extra read. See attributeActivity.
          activity.push({ w: weightedTokens(tokens), project: projectDir, paths: toolPaths(record.message?.content, record.cwd) });
        }
      }
    }
  }

  return {
    projectDir,
    cwd: cwdFromProjectDir(projectDir),
    allTime,
    window: windowTokens,
    costUSD,
    lastActivity,
    messagesInWindow
  };
}

/**
 * The newest mtime and file count in a directory. Cheap enough to run on every request, and it is
 * what lets a cached scan be trusted — a conversation cannot change without its file changing.
 */
function directorySignature(dir: string): { newestMtime: number; fileCount: number } {
  let newestMtime = 0;
  let fileCount = 0;
  try {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.jsonl')) continue;
      fileCount++;
      try {
        newestMtime = Math.max(newestMtime, statSync(join(dir, file)).mtimeMs);
      } catch { /* a file that vanished mid-scan is not an error */ }
    }
  } catch { /* an unreadable project directory contributes nothing */ }
  return { newestMtime, fileCount };
}

/**
 * Read usage for every project Claude Code knows about.
 *
 * `windowHours` defaults to the setting, which defaults to 5 — the shape of Claude's own rolling
 * limit window, and a span short enough that "tokens per hour" describes what you are doing now
 * rather than what you did on Tuesday.
 */
export function readUsage(windowHours?: number): UsageSummary {
  const settings = getSettings();
  const hours = windowHours ?? settings.usageWindowHours;
  const takenAt = Date.now();
  const windowStart = takenAt - hours * 3600_000;

  const root = claudeProjectsDir();
  let dirs: string[];
  try {
    dirs = readdirSync(root);
  } catch (err) {
    return {
      windowHours: hours,
      takenAt,
      projects: [],
      window: ZERO_TOKENS,
      allTime: ZERO_TOKENS,
      budgetTokens: null,
      budgetSource: 'none',
      plan: settings.plan,
      peakWindowTokens: 0,
      error: `CANNOT READ ${root} — ${(err as Error).message}`
    };
  }

  const projects: ProjectUsage[] = [];
  const allEvents: [number, number][] = [];
  const activity: ActivityEvent[] = [];
  const limits: LimitHit[] = [];
  for (const projectDir of dirs) {
    const dir = join(root, projectDir);
    const signature = directorySignature(dir);
    if (signature.fileCount === 0) continue;

    const cached = cache.get(projectDir);
    // The window start moves every second, so a cached scan is only reusable while the window it
    // was computed for still starts at the same place. Rounded to a minute: re-scanning 22 MB of
    // JSONL once a second to move a boundary by one second is not a trade worth making.
    const sameWindow = cached && Math.abs(cached.windowStart - windowStart) < 60_000;
    if (cached && sameWindow && cached.newestMtime === signature.newestMtime && cached.fileCount === signature.fileCount) {
      projects.push(cached.usage);
      allEvents.push(...cached.events);
      activity.push(...cached.activity);
      limits.push(...cached.limits);
      continue;
    }

    const events: [number, number][] = [];
    const windowActivity: ActivityEvent[] = [];
    const projectLimits: LimitHit[] = [];
    const usage = scanProject(dir, projectDir, windowStart, events, windowActivity, projectLimits);
    cache.set(projectDir, { ...signature, windowStart, usage, events, activity: windowActivity, limits: projectLimits });
    projects.push(usage);
    allEvents.push(...events);
    activity.push(...windowActivity);
    limits.push(...projectLimits);
  }

  latestActivity = activity;
  projects.sort((a, b) => weightedTokens(b.window) - weightedTokens(a.window));

  const budget = resolveBudget(settings.plan, settings.tokenBudget);

  return {
    windowHours: hours,
    takenAt,
    projects,
    window: projects.reduce<TokenCounts>((sum, p) => addTokens(sum, p.window), ZERO_TOKENS),
    allTime: projects.reduce<TokenCounts>((sum, p) => addTokens(sum, p.allTime), ZERO_TOKENS),
    budgetTokens: budget.tokens,
    budgetSource: budget.source,
    plan: settings.plan,
    peakWindowTokens: peakWindow(allEvents, hours),
    calibration: calibrateFromLimits(limits, allEvents)
  };
}

/** Forget every cached scan. For tests, and after a settings reload changes the window. */
export function clearUsageCache(): void {
  cache.clear();
}

/* ────────────────────────── attributing usage to nodes ────────────────────────── */

type Claim = Omit<NodeClaim, 'nodeId'>;

const NO_CLAIM: Claim = { projects: [], dirs: [], files: [] };

/** A node's path as an absolute, normalised path, or null for a glob, a URL or nothing. */
function claimPath(value: string | undefined): string | null {
  if (!value?.trim() || value.includes('*')) return null;
  const expanded = expandPath(value);
  return /^[a-zA-Z]:[\\/]/.test(expanded) ? normalisePath(expanded) : null;
}

/**
 * What a node stands for, for attributing Claude's work to it.
 *
 * - An agent (or a service) owns the conversations started in its working directory.
 * - A repo or folder owns work done INSIDE it, whichever conversation did it, as well as
 *   conversations started in it. This is the change that made the couriers follow "which repos or
 *   files claude has worked within": a session started in C:/dev that edits the SkynetOS source
 *   now sends traffic to the SkynetOS repo node, not only to C:/dev.
 * - A document or program owns work done on that exact file.
 * - A room drive stands in for everything inside it, so MinecraftOS draws traffic from the top
 *   level without you having to go in.
 *
 * A `link.url` or a `note.silk` has no working directory and no file, so it gets no couriers.
 * William asked for the traffic to be proportional to "each actually claude-enabled node", and a
 * bookmark is not one.
 */
function claimFor(node: BoardNode, depth: number): Claim {
  switch (node.kind) {
    case 'agent.code':
    case 'agent.audit':
    case 'service.process':
      return node.cwd ? { ...NO_CLAIM, projects: [projectDirFor(expandPath(node.cwd))] } : NO_CLAIM;
    case 'store.repo':
    case 'store.folder':
    case 'store.explorer': {
      const dir = claimPath(node.path);
      return dir ? { projects: [projectDirFor(dir)], dirs: [dir], files: [] } : NO_CLAIM;
    }
    case 'file.document':
    case 'file.exe': {
      const file = claimPath(node.path);
      return file ? { ...NO_CLAIM, files: [file] } : NO_CLAIM;
    }
    case 'drive.room': {
      // Depth-limited because a board file is user-editable data, and a cycle in it must degrade
      // to "no couriers" rather than to a stack overflow.
      if (depth <= 0 || !node.boardFile) return NO_CLAIM;
      const load = loadBoardByFile(node.boardFile);
      if (!load.ok) return NO_CLAIM;
      const projects = new Set<string>();
      const dirs = new Set<string>();
      const files = new Set<string>();
      for (const child of load.board.nodes) {
        const claim = claimFor(child, depth - 1);
        claim.projects.forEach((p) => projects.add(p));
        claim.dirs.forEach((d) => dirs.add(d));
        claim.files.forEach((f) => files.add(f));
      }
      return { projects: [...projects], dirs: [...dirs], files: [...files] };
    }
    default:
      return NO_CLAIM;
  }
}

/**
 * Attribute the window's usage to the nodes of one board.
 *
 * Message by message, not project by project: each assistant message is split between every node
 * that claims it, by conversation or by the files it touched. So a message is never counted twice,
 * the shares across a board still sum to at most 1, and a repo that appears both as a `store.repo`
 * and inside a room drive does not send twice the traffic it earned. Proportions are the one thing
 * this feature exists to get right. The arithmetic is `attributeActivity` in packages/shared,
 * where test/activity.test.ts holds it.
 */
export function usageRoutes(boardId: string, summary?: UsageSummary): UsageRoute[] {
  const load = loadBoard(boardId);
  if (!load.ok) return [];
  // A caller that passes a summary has just read one, which refreshed the activity with it.
  if (!summary) readUsage();

  const claims: NodeClaim[] = [];
  for (const node of load.board.nodes) {
    const claim = claimFor(node, 3);
    if (claim.projects.length || claim.dirs.length || claim.files.length) claims.push({ nodeId: node.id, ...claim });
  }
  return attributeActivity(latestActivity, claims);
}
