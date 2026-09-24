import type { AwayMode } from './presence.js';

/**
 * The away session: JARVIS Prime as a HEADLESS Claude Code process while William is away.
 *
 * Why headless Claude Code and not the Face: claude.ai's consumer terms forbid automated, scripted
 * use of the web conversation, and docs/07 lets SkynetOS type into that window only on William's
 * own Enter. Claude Code is built for autonomous agentic runs. So the "JARVIS head session" on the
 * away screen is Prime, streamed live (`--output-format stream-json`), and the Face gets the
 * summary as `to-face` mail.
 *
 * Everything here is pure: the bounds, the command line, the prompt, the stream parser and the
 * running tally. src/main/services/away-session.ts spawns; presence.ts decides when.
 */

/* ────────────────────────── defaults and budgets ────────────────────────── */

/**
 * Sonnet at medium effort, not Fable or Opus. An away run reads a lot and writes a little
 * (roadmaps, notes, phantoms), which a mid-tier model does well. The expensive models' usage is
 * what William spends on his own work; burning it while he sleeps would leave him short in the
 * morning. `awayModel` in settings.json overrides it.
 */
export const AWAY_DEFAULT_MODEL = 'claude-sonnet-5';
export const AWAY_DEFAULT_EFFORT = 'medium';
/** Wall-clock cap on one away run. */
export const AWAY_WALL_CLOCK_MS = 90 * 60_000;
/** Tool-call ceiling. The CLI has no --max-turns, so main counts and stops the run itself. */
export const AWAY_MAX_TOOL_CALLS = 250;
/** Sub-sessions an away run may start, at level `work` only. */
export const AWAY_MAX_SUBSESSIONS = 2;
/** An away run does not start with less than this fraction of the usage pool left. */
export const AWAY_MIN_POOL = 0.25;

export type AwayLevel = 'plan' | 'work';

/** The level a mode runs an agent at, or null for modes that run none. */
export function levelOf(mode: AwayMode): AwayLevel | null {
  return mode === 'plan' || mode === 'work' ? mode : null;
}

/* ────────────────────────── bounds ────────────────────────── */

const SKYNET = (tool: string): string => `mcp__skynet__${tool}`;

/** Reading, anywhere under the working directory (C:/dev), plus read-only git. */
export const AWAY_READ_TOOLS: readonly string[] = [
  'Read', 'Glob', 'Grep', 'TodoWrite',
  'Bash(git status)', 'Bash(git status *)', 'Bash(git log *)', 'Bash(git diff *)', 'Bash(git branch *)',
  SKYNET('board_list'), SKYNET('board_read'), SKYNET('board_resolve'), SKYNET('node_fields'),
  SKYNET('classify_path'), SKYNET('usage_summary'), SKYNET('usage_routes'), SKYNET('system_info'),
  SKYNET('session_list'), SKYNET('mailbox_read'), SKYNET('history'), SKYNET('phantom_list')
];

/** The only writes a PLAN run may make: the codex, the roadmap, recommendations and mail. */
export const AWAY_PLAN_WRITES: readonly string[] = [
  'Edit(SkynetOS/codex/**)', 'Write(SkynetOS/codex/**)',
  'Edit(SkynetOS/docs/06-ROADMAP.md)', 'Write(SkynetOS/docs/06-ROADMAP.md)',
  SKYNET('phantom_propose'), SKYNET('phantom_withdraw'), SKYNET('mailbox_send')
];

/** What a WORK run adds: starting sessions on existing agent nodes. Capped by main. */
export const AWAY_WORK_EXTRA: readonly string[] = [SKYNET('session_start')];

/** Denied at every level, whatever else is allowed. */
export const AWAY_ALWAYS_DENIED: readonly string[] = [
  'Bash(git push *)', 'Bash(git commit *)', 'Bash(git reset *)', 'Bash(git checkout *)',
  'Bash(git clean *)', 'Bash(git rebase *)', 'Bash(git restore *)',
  'Bash(rm *)', 'Bash(rmdir *)', 'Bash(del *)', 'Bash(Remove-Item *)',
  'PowerShell', 'WebFetch', 'WebSearch',
  SKYNET('node_create'), SKYNET('node_update'), SKYNET('node_move'), SKYNET('node_delete'),
  SKYNET('edge_create'), SKYNET('edge_delete'),
  SKYNET('terminal_open'), SKYNET('open_target'), SKYNET('session_stop'), SKYNET('mailbox_archive')
];

export function awayAllowedTools(level: AwayLevel): string[] {
  return [...AWAY_READ_TOOLS, ...AWAY_PLAN_WRITES, ...(level === 'work' ? AWAY_WORK_EXTRA : [])];
}

export function awayDeniedTools(level: AwayLevel): string[] {
  return [...AWAY_ALWAYS_DENIED, ...(level === 'plan' ? AWAY_WORK_EXTRA : [])];
}

/**
 * The command line. Flags only, never prose: the prompt goes in on stdin.
 *
 * `dontAsk` denies every tool that no allow rule covers, and `--permission-prompts none` makes
 * sure nothing waits for a human who is not there. Together they are the bounds: William chose
 * them by choosing the level, and the run cannot widen them. `--strict-mcp-config` loads the skynet
 * server and nothing else, so none of William's other connectors (mail, drive) are reachable.
 */
export function awayArgs(opts: {
  level: AwayLevel;
  model: string;
  effort: string;
  mcpConfig: string;
  name: string;
}): string[] {
  return [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', opts.model,
    '--effort', opts.effort,
    '--permission-mode', 'dontAsk',
    '--permission-prompts', 'none',
    '--strict-mcp-config',
    '--mcp-config', opts.mcpConfig,
    '--name', opts.name,
    '--allowedTools', ...awayAllowedTools(opts.level),
    '--disallowedTools', ...awayDeniedTools(opts.level)
  ];
}

/* ────────────────────────── the prompt ────────────────────────── */

export function awayJournalName(date: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `away-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.md`;
}

export function awayPrompt(opts: { level: AwayLevel; awayMinutes: number; startedAt: Date; capMinutes: number }): string {
  const journal = `SkynetOS/codex/journal/${awayJournalName(opts.startedAt)}`;
  const lines = [
    'AWAY SESSION. You are JARVIS Prime, running headless inside SkynetOS.',
    `William has been away for ${opts.awayMinutes} minutes: no input, no agent activity, no board commands.`,
    `SkynetOS started you to use that time well. Level: ${opts.level.toUpperCase()}. Working directory: C:/dev.`,
    '',
    'YOUR JOB',
    '1. Survey. Read SkynetOS/codex/index.md, SkynetOS/codex/projects/*.md, the handoffs in',
    '   SkynetOS/codex/handoffs/, SkynetOS/docs/06-ROADMAP.md, and the active repos under C:/dev',
    '   (README, handoff.md, TODOs, `git log` and `git status`).',
    '2. Roadmap. Turn what you find into concrete, sized next tasks: each project\'s "Next" section in',
    '   SkynetOS/codex/projects/<project>.md, and SkynetOS/docs/06-ROADMAP.md for SkynetOS itself.',
    '   One fact, one home. Mark what you infer as inferred.',
    '3. Recommend. Where a next step deserves a board node, propose it with phantom_propose (read',
    '   phantom_list first; each room holds at most 4).'
  ];
  if (opts.level === 'work') {
    lines.push(
      '4. Work. For at most 2 uncompleted, well-defined tasks, start a session with session_start on the',
      '   EXISTING agent node for that repo, with a precise task prompt. SkynetOS enforces the cap of 2.'
    );
  }
  lines.push(
    '',
    'BOUNDS (enforced by SkynetOS; asking will not widen them)',
    '- You may write ONLY under SkynetOS/codex/ and to SkynetOS/docs/06-ROADMAP.md. Every other write is denied.',
    '- Never commit, push, delete, run elevated, or approve anything. Those tools are denied.',
    '- No board edits except recommendations (phantoms). No web access.',
    opts.level === 'plan' ? '- You may not start sessions at this level: propose them as phantoms or mail instead.' : '- Sessions only through session_start, at most 2.',
    '',
    'LOGGING',
    '- Before each piece of work, say in ONE line what you are about to do. After it, ONE line of what changed.',
    '  Those lines are William\'s "while you were away" list. Plain sentences, no headers.',
    '',
    'FINISH',
    `- When done, or before ${opts.capMinutes} minutes: write ${journal} (what you did, what you propose,`,
    '  what needs William\'s decision), send ONE mailbox_send to "to-face" with the same summary, and end with a',
    '  final message of at most 8 lines.',
    '- If William comes back you will be stopped mid-task; SkynetOS then writes the journal and the mail itself.',
    '',
    'docs/07-SECURITY.md is the hard boundary.'
  );
  return lines.join('\n');
}

/* ────────────────────────── the usage pool ────────────────────────── */

export function poolCheck(usedWeighted: number, budget: number | null): { ok: boolean; left: number | null; reason: string } {
  if (budget === null || !(budget > 0)) {
    return { ok: true, left: null, reason: 'NO BUDGET SET, SO THE POOL CANNOT BE CHECKED' };
  }
  const left = Math.max(0, 1 - usedWeighted / budget);
  return left < AWAY_MIN_POOL
    ? { ok: false, left, reason: `ONLY ${Math.round(left * 100)}% OF THE USAGE POOL LEFT (NEEDS ${AWAY_MIN_POOL * 100}%)` }
    : { ok: true, left, reason: `${Math.round(left * 100)}% OF THE USAGE POOL LEFT` };
}

/* ────────────────────────── the stream ────────────────────────── */

export interface AwayLine {
  at: number;
  kind: 'text' | 'tool' | 'result' | 'error' | 'system';
  text: string;
}

export type AwayItemKind = 'edit' | 'write' | 'roadmap' | 'phantom' | 'mail' | 'session' | 'blocked' | 'note' | 'error';

export interface AwayLogItem {
  at: number;
  kind: AwayItemKind;
  text: string;
  path?: string;
}

export type AwayEvent =
  | { kind: 'system'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'usage'; messageId: string; input: number; output: number }
  | { kind: 'tool-result'; id: string; isError: boolean; text: string }
  | { kind: 'result'; ok: boolean; text: string; costUsd: number | null; input: number | null; output: number | null };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => (c && typeof c === 'object' && 'text' in c ? str((c as { text: unknown }).text) : '')).join(' ');
  }
  return '';
}

/** One line of `claude -p --output-format stream-json --verbose` output, as events. Junk yields none. */
export function parseStreamLine(line: string): AwayEvent[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return [];
  let msg: Record<string, unknown>;
  try { msg = JSON.parse(trimmed) as Record<string, unknown>; } catch { return []; }

  const type = msg['type'];
  if (type === 'system') {
    return msg['subtype'] === 'init' ? [{ kind: 'system', text: `session started on ${str(msg['model']) || 'the default model'}` }] : [];
  }
  if (type === 'result') {
    const usage = (msg['usage'] ?? {}) as Record<string, unknown>;
    return [{
      kind: 'result',
      ok: msg['is_error'] !== true && (msg['subtype'] === undefined || msg['subtype'] === 'success'),
      text: str(msg['result']),
      costUsd: num(msg['total_cost_usd']),
      input: num(usage['input_tokens']),
      output: num(usage['output_tokens'])
    }];
  }
  const message = (msg['message'] ?? {}) as Record<string, unknown>;
  const content = Array.isArray(message['content']) ? (message['content'] as Record<string, unknown>[]) : [];
  const out: AwayEvent[] = [];
  if (type === 'assistant') {
    for (const block of content) {
      if (block['type'] === 'text' && str(block['text']).trim()) out.push({ kind: 'text', text: str(block['text']).trim() });
      if (block['type'] === 'tool_use') {
        out.push({ kind: 'tool', id: str(block['id']), name: str(block['name']), input: (block['input'] ?? {}) as Record<string, unknown> });
      }
    }
    const usage = message['usage'] as Record<string, unknown> | undefined;
    if (usage && str(message['id'])) {
      out.push({ kind: 'usage', messageId: str(message['id']), input: num(usage['input_tokens']) ?? 0, output: num(usage['output_tokens']) ?? 0 });
    }
  } else if (type === 'user') {
    for (const block of content) {
      if (block['type'] === 'tool_result') {
        out.push({ kind: 'tool-result', id: str(block['tool_use_id']), isError: block['is_error'] === true, text: contentText(block['content']).slice(0, 300) });
      }
    }
  }
  return out;
}

/** A path, shortened to be readable in a log: relative to C:/dev, forward slashes. */
export function shortPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^[a-z]:\/dev\//i, '');
}

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function filePathOf(input: Record<string, unknown>): string {
  return str(input['file_path']) || str(input['notebook_path']) || str(input['path']);
}

/** The transcript line for a tool call. */
export function toolLine(name: string, input: Record<string, unknown>): string {
  if (WRITE_TOOLS.has(name) || name === 'Read') return `${name} ${shortPath(filePathOf(input))}`;
  if (name === 'Glob' || name === 'Grep') return `${name} ${str(input['pattern'])}`;
  if (name === 'Bash') return `$ ${str(input['command']).slice(0, 140)}`;
  if (name.startsWith('mcp__skynet__')) {
    const keys = ['boardId', 'nodeId', 'name', 'to', 'subject'].filter((k) => typeof input[k] === 'string');
    return `skynet.${name.slice('mcp__skynet__'.length)}${keys.length ? ` ${keys.map((k) => `${k}=${str(input[k])}`).join(' ')}` : ''}`;
  }
  return name;
}

/** The "while you were away" entry a tool call earns, if any. Reads earn none: they are not work done. */
export function logItemFor(name: string, input: Record<string, unknown>, at: number): AwayLogItem | null {
  if (WRITE_TOOLS.has(name)) {
    const path = shortPath(filePathOf(input));
    if (/codex\/journal\//i.test(path)) return { at, kind: 'note', text: `journal written: ${path}`, path };
    if (/codex\/projects\/|06-ROADMAP/i.test(path)) return { at, kind: 'roadmap', text: `roadmap updated: ${path}`, path };
    return { at, kind: name === 'Write' ? 'write' : 'edit', text: `${name === 'Write' ? 'wrote' : 'edited'} ${path}`, path };
  }
  switch (name) {
    case 'mcp__skynet__phantom_propose': {
      const proposal = (input['proposal'] ?? input) as Record<string, unknown>;
      return { at, kind: 'phantom', text: `recommended a node: ${str(proposal['name']) || 'unnamed'}${str(input['boardId']) ? ` (${str(input['boardId'])})` : ''}` };
    }
    case 'mcp__skynet__phantom_withdraw':
      return { at, kind: 'phantom', text: `withdrew a recommendation${str(input['phantomId']) ? `: ${str(input['phantomId'])}` : ''}` };
    case 'mcp__skynet__mailbox_send':
      return { at, kind: 'mail', text: `mailed ${str(input['to']) || 'the mailbox'}: ${str(input['subject']) || '(no subject)'}` };
    case 'mcp__skynet__session_start':
      return { at, kind: 'session', text: `started a session on ${str(input['nodeId']) || 'a node'}${str(input['boardId']) ? ` (${str(input['boardId'])})` : ''}` };
    default:
      return null;
  }
}

export interface AwayTally {
  toolCalls: number;
  files: string[];
  tokens: { input: number; output: number };
  costUsd: number | null;
  summary: string | null;
  lastText: string | null;
  sessionStarts: number;
  wroteJournal: boolean;
  mailedFace: boolean;
  blocked: number;
  finished: boolean;
}

export interface AwayTracker {
  ingest(line: string, now: number): { lines: AwayLine[]; items: AwayLogItem[] };
  tally(): AwayTally;
}

/** The running tally of one away run, fed line by line. */
export function createAwayTracker(): AwayTracker {
  const toolNames = new Map<string, string>();
  const messageUsage = new Map<string, { input: number; output: number }>();
  const files = new Set<string>();
  const t: AwayTally = {
    toolCalls: 0, files: [], tokens: { input: 0, output: 0 }, costUsd: null, summary: null, lastText: null,
    sessionStarts: 0, wroteJournal: false, mailedFace: false, blocked: 0, finished: false
  };
  let resultTokens: { input: number; output: number } | null = null;

  return {
    ingest(line, now) {
      const lines: AwayLine[] = [];
      const items: AwayLogItem[] = [];
      for (const e of parseStreamLine(line)) {
        switch (e.kind) {
          case 'system': lines.push({ at: now, kind: 'system', text: e.text }); break;
          case 'text':
            t.lastText = e.text;
            lines.push({ at: now, kind: 'text', text: e.text });
            break;
          case 'tool': {
            toolNames.set(e.id, e.name);
            t.toolCalls++;
            lines.push({ at: now, kind: 'tool', text: toolLine(e.name, e.input) });
            const item = logItemFor(e.name, e.input, now);
            if (item) items.push(item);
            if (WRITE_TOOLS.has(e.name)) {
              const path = shortPath(filePathOf(e.input));
              if (path) files.add(path);
              if (/codex\/journal\/away-/i.test(path)) t.wroteJournal = true;
            }
            if (e.name === 'mcp__skynet__session_start') t.sessionStarts++;
            if (e.name === 'mcp__skynet__mailbox_send' && /face/i.test(str(e.input['to']))) t.mailedFace = true;
            break;
          }
          case 'usage': messageUsage.set(e.messageId, { input: e.input, output: e.output }); break;
          case 'tool-result':
            if (e.isError && /permission|denied|not allowed|blocked/i.test(e.text)) {
              t.blocked++;
              items.push({ at: now, kind: 'blocked', text: `held back by the away bounds: ${toolNames.get(e.id) ?? 'a tool'}` });
            }
            break;
          case 'result':
            t.finished = true;
            t.summary = e.text.trim() || null;
            t.costUsd = e.costUsd;
            if (e.input !== null && e.output !== null) resultTokens = { input: e.input, output: e.output };
            lines.push({ at: now, kind: e.ok ? 'result' : 'error', text: e.ok ? 'session finished' : `session ended with an error: ${e.text.slice(0, 200)}` });
            break;
        }
      }
      return { lines, items };
    },
    tally() {
      let input = 0;
      let output = 0;
      for (const u of messageUsage.values()) { input += u.input; output += u.output; }
      return { ...t, files: [...files], tokens: resultTokens ?? { input, output } };
    }
  };
}

/* ────────────────────────── status and the journal ────────────────────────── */

export type AwayPhase = 'present' | 'away' | 'woken';

export interface AwayStatus {
  phase: AwayPhase;
  mode: AwayMode;
  afterMinutes: number;
  model: string;
  since: number | null;
  wokeAt: number | null;
  running: boolean;
  /** Why no agent ran (visual mode, a low pool, no Prime chip…), or null. */
  refusal: string | null;
  lines: AwayLine[];
  items: AwayLogItem[];
  files: string[];
  tokens: { input: number; output: number } | null;
  costUsd: number | null;
  summary: string | null;
  journal: string | null;
  endReason: string | null;
}

export interface AwayLogEvent {
  line?: AwayLine;
  item?: AwayLogItem;
}

/** Kept in memory and sent to the renderer; the tail is what a screen can show. */
export const AWAY_MAX_LINES = 400;

export function awayJournal(opts: {
  since: number;
  ended: number;
  level: AwayLevel;
  model: string;
  endReason: string;
  items: readonly AwayLogItem[];
  tally: AwayTally;
}): string {
  const iso = (ms: number): string => new Date(ms).toISOString();
  const minutes = Math.max(0, Math.round((opts.ended - opts.since) / 60_000));
  const lines = [
    '---',
    'type: away-session',
    `started: ${iso(opts.since)}`,
    `ended: ${iso(opts.ended)}`,
    `level: ${opts.level}`,
    `model: ${opts.model}`,
    `ended-because: ${opts.endReason}`,
    'written-by: skynetos (the session was stopped before it wrote its own)',
    '---',
    '',
    `# Away session: ${minutes} min, ${opts.items.length} item${opts.items.length === 1 ? '' : 's'}`,
    '',
    '## While William was away'
  ];
  if (opts.items.length) for (const item of opts.items) lines.push(`- ${item.text}`);
  else lines.push('- Nothing written: the session was reading when it stopped.');
  if (opts.tally.files.length) {
    lines.push('', '## Files written');
    for (const f of opts.tally.files) lines.push(`- \`${f}\``);
  }
  lines.push('', '## Cost', `- ${opts.tally.tokens.input} input / ${opts.tally.tokens.output} output tokens, ${opts.tally.toolCalls} tool calls${opts.tally.blocked ? `, ${opts.tally.blocked} held back by the bounds` : ''}`);
  const last = opts.tally.summary ?? opts.tally.lastText;
  if (last) lines.push('', '## Its last word', '', last);
  lines.push('');
  return lines.join('\n');
}
