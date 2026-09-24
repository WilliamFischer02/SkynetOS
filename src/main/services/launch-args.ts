import { randomUUID } from 'node:crypto';
import type { BoardNode } from '@shared/types.js';
import type { LaunchModel } from '@shared/model-availability.js';

/**
 * How a Claude Code session is spelled, and what it is told when it opens.
 *
 * Pure policy, deliberately in its own module with no Electron, no fs and no database import, so
 * it can be read and tested on its own. It is also the most consequential logic in M3 — a mistake
 * here is silent: a chip that opens a fresh conversation every time looks like it is working.
 *
 * ── How resume actually works ─────────────────────────────────────────────────────────────────
 * docs/01 said to capture the session id from the stream-json `system/init` event. That works for
 * headless, but a `popout` session runs in a terminal SkynetOS does not own and whose stdout it
 * never sees — so there would be nothing to capture, and the marquee launch mode could never
 * resume. `claude --help` on this machine (v2.1.267) has a better answer:
 *
 *     --session-id <uuid>   Use a specific session ID for the conversation (must be a valid UUID)
 *     -r, --resume [value]  Resume a conversation by session ID
 *
 * So SkynetOS *assigns* the id instead of discovering it. First launch generates a UUID and
 * passes `--session-id`; every later launch passes `--resume <uuid>`. Identical for popout,
 * elevated and headless, and it never depends on parsing another program's output.
 *
 * The correction that cost this project two sessions: an assigned id is a PLAN, not a fact. It
 * only becomes a real conversation if the launch works. `storedIsReal` is the caller's answer to
 * "does that conversation exist on disk" — see conversations.ts — and without it a single failed
 * launch poisons the chip forever.
 */

/**
 * Quote a single PowerShell argument. Single quotes, with '' as the escape for a literal quote.
 *
 * Everything that reaches PowerShell goes through this. Board JSON is git-tracked and reviewed,
 * but it is still data, and a repo path containing a quote or a `$(...)` must be a path — not
 * shell syntax.
 */
export function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Escape a value for Windows Terminal's OWN command-line parser, which runs before PowerShell's.
 *
 * `wt.exe` splits its command line on `;` to open a second tab. That is not a theory. U3's
 * initial prompt contained "...cannot see this disk; you are how its decisions become real." —
 * wt took everything after the semicolon as a second subcommand, failed to parse it, and exited
 * 0 without opening anything. `spawn` had succeeded, so SkynetOS reported LAUNCHED.
 *
 * Since launch-script.ts, the only things that reach wt are two file paths, and a folder is
 * still allowed to contain a semicolon. Only `;` is escaped: escaping backslashes as well would
 * corrupt every Windows path, and wt does not treat a lone backslash as special.
 */
export function wtEscape(value: string): string {
  return value.replace(/;/g, '\\;');
}

export interface ClaudeArgsInput {
  node: BoardNode;
  /** The conversation id remembered for this node, or null if it has never launched. */
  storedSessionId: string | null;
  /**
   * Whether that stored id names a conversation that EXISTS. The caller checks the disk; this
   * module refuses to resume on faith. See the header.
   */
  storedIsReal: boolean;
  /** The user asked for a brand-new conversation. */
  fresh: boolean;
  /**
   * Extra directories to grant the session, already resolved and existence-checked by the
   * caller. This is how one agent oversees repos that live outside its own working directory
   * without anything being moved on disk — `claude --add-dir`.
   */
  addDirs: readonly string[];
  /**
   * `--mcp-config` paths, already resolved by the caller.
   *
   * The node names a SERVER ("skynet"); turning that into a file path needs `app.getPath` and the
   * packaged-vs-dev distinction, neither of which belongs in a pure argv builder that has to run
   * under vitest without Electron. See services/mcp-config.ts.
   */
  mcpConfigs?: readonly string[];
  /**
   * The model and effort this launch asks for, decided by services/model-availability.ts: Fable 5.1
   * at high effort while Fable is available, Opus 5 at xhigh while it is out of usage. Null leaves
   * the choice to Claude Code's own default. A node's explicit `model` always wins over it.
   */
  launchModel?: LaunchModel | null;
}

export interface ClaudeInvocation {
  /**
   * Flags and their values. Never free text — see `briefing`. Everything in here is a UUID, a
   * model name, or a path, which is why it is safe to put in a PowerShell array literal.
   */
  args: string[];
  /** The conversation id this launch will use, whether newly minted or resumed. */
  sessionId: string;
  /** True when this launch continues an existing conversation rather than starting one. */
  resumed: boolean;
  /**
   * Set when the node WANTED to resume and could not, because the stored conversation is not on
   * disk. Surfaced to the user rather than silently starting over — a chip quietly losing its
   * history is exactly the failure that went unnoticed for two sessions.
   */
  recoveredFrom?: string;
}

export function claudeArgs(input: ClaudeArgsInput): ClaudeInvocation {
  const { node, storedSessionId, storedIsReal, fresh, addDirs } = input;
  const wantsResume = node.resume !== false && !fresh;

  const canResume = wantsResume && Boolean(storedSessionId) && storedIsReal;
  const sessionId = canResume && storedSessionId ? storedSessionId : randomUUID();

  const args: string[] = [];
  if (canResume && storedSessionId) args.push('--resume', storedSessionId);
  else args.push('--session-id', sessionId);

  /*
   * `--model`, `--effort` and `--fallback-model` are all in `claude --help` on this machine; effort
   * accepts low, medium, high, xhigh and max. The fallback is the CLI's own safety net for a model
   * that is "overloaded or not available" mid-session. Whether it catches running out of usage
   * credits is not documented, which is why SkynetOS decides the model before launch as well.
   */
  if (node.model) args.push('--model', node.model);
  else if (input.launchModel) {
    args.push('--model', input.launchModel.model, '--effort', input.launchModel.effort);
    if (input.launchModel.fallback) args.push('--fallback-model', input.launchModel.fallback);
  }
  for (const dir of addDirs) args.push('--add-dir', dir);
  for (const config of input.mcpConfigs ?? []) args.push('--mcp-config', config);

  /*
   * A display name, so the terminal's own title bar and `claude --resume`'s picker both say
   * which chip this is. Costs one flag and turns a wall of identical windows into a board.
   */
  const label = node.designator ? `${node.designator} ${node.name}` : node.name;
  /*
   * Remote Control, per node and off unless the node says so. `--remote-control [name]` is in
   * `claude --help` on this machine (2.1.278). The name is always given: the flag's value is
   * optional, and a bare flag would swallow whatever argument came next. The phone lists sessions
   * by this name, so it is the chip's own label.
   */
  if (node.remoteControl === true) args.push('--remote-control', label.trim().slice(0, 60) || 'SkynetOS');
  if (label.trim()) args.push('--name', label.trim().slice(0, 60));

  const invocation: ClaudeInvocation = { args, sessionId, resumed: canResume };

  if (wantsResume && storedSessionId && !storedIsReal) {
    invocation.recoveredFrom = storedSessionId;
  }
  return invocation;
}

/* ────────────────────────────── the briefing ────────────────────────────── */

/**
 * When a node's briefing is sent.
 *
 *   none   never. The session opens at an empty prompt.
 *   first  only on a launch that STARTS a conversation. The old `initialPrompt` behaviour.
 *   every  on every launch, resumes included, re-orienting rather than re-introducing.
 */
export type BriefingMode = 'none' | 'first' | 'every';

export interface BriefingInput {
  node: BoardNode;
  /** The room this chip is mounted in, for the first line. */
  boardName: string;
  /** The working directory, as Windows spells it. */
  cwd: string;
  /** Documents that exist, repo-relative, in the order they should be read. */
  reading: readonly string[];
  /** Documents the node named that are NOT on disk. Stated, never quietly dropped. */
  missing: readonly string[];
  /** Extra granted directories, for the paragraph that tells the agent it can see them. */
  addDirs: readonly string[];
  /** True when this launch starts a conversation rather than continuing one. */
  fresh: boolean;
}

/** A node's briefing mode, with the default applied. */
export function briefingModeOf(node: BoardNode): BriefingMode {
  return node.briefing ?? 'first';
}

/**
 * Compose what the session is told the moment it opens.
 *
 * This is the difference between "a terminal opened in the right folder" and "an agent that
 * knows who it is". It is assembled from what the node ALREADY declares — its persona file, its
 * codex entry, its working directory, the extra roots it was granted — so priming a new chip is
 * a matter of binding it to real files, not of writing a prompt twice.
 *
 * It ends by telling the session to stop and wait. A briefing that starts working before William
 * has said anything is a briefing that has to be interrupted, which is worse than no briefing.
 */
export function buildBriefing(input: BriefingInput): string | undefined {
  const { node, boardName, cwd, reading, missing, addDirs, fresh } = input;
  const mode = briefingModeOf(node);
  if (mode === 'none') return undefined;
  if (mode === 'first' && !fresh) return undefined;

  const who = node.designator ? `${node.designator} ${node.name}` : node.name;
  const lines: string[] = [];

  if (fresh) {
    lines.push(`You are ${who}, the agent bound to this chip on the SkynetOS board "${boardName}".`);
    lines.push(`SkynetOS opened this terminal for you, in ${cwd}. Everything on that board is bound to something real on this machine.`);
  } else {
    lines.push(`You are ${who} on the SkynetOS board "${boardName}", resuming your own conversation in ${cwd}.`);
    lines.push('You have context from before. Re-orient rather than re-introducing yourself.');
  }
  lines.push('');

  if (reading.length) {
    lines.push(fresh
      ? 'Before anything else, read these in order:'
      : 'Re-read whichever of these you have lost the thread of:');
    reading.forEach((file, i) => lines.push(`  ${i + 1}. ${file}`));
    lines.push('');
  }

  if (missing.length) {
    // Bind to reality: a briefing that tells an agent to read a file that is not there teaches it
    // that its own instructions are unreliable.
    lines.push('This chip also names these, and they are NOT on disk. Do not go looking:');
    for (const file of missing) lines.push(`  - ${file}`);
    lines.push('');
  }

  if (addDirs.length) {
    lines.push('You have also been granted these directories outside your working directory:');
    for (const dir of addDirs) lines.push(`  - ${dir}`);
    lines.push('They stay where they are. Read and work in them as if they were part of this repo.');
    lines.push('');
  }

  if (node.initialPrompt?.trim()) {
    lines.push(node.initialPrompt.trim());
    lines.push('');
  }

  lines.push('When you have finished reading, reply with exactly this and nothing more:');
  lines.push('');
  lines.push('  READY - <who you are, one line, in the voice the persona describes>');
  lines.push('  CONTEXT - <the single most important thing you now know about this repo>');
  lines.push('  NEXT - <up to three things you could do, one line each>');
  lines.push('');
  lines.push('Then stop and wait. Do not start work, edit files or run commands until William asks.');

  return lines.join('\n');
}

/** The command to reattach by hand — docs/03's "Copy resume command". */
export function resumeCommandLine(cwd: string, claudeSessionId: string): string {
  return `cd "${cwd.replace(/\//g, '\\')}" && claude --resume ${claudeSessionId}`;
}
