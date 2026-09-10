import { randomUUID } from 'node:crypto';
import type { BoardNode } from '@shared/types.js';

/**
 * How a Claude Code session is spelled on the command line.
 *
 * Pure policy, deliberately in its own module with no Electron and no database import, so it can
 * be read and tested on its own. It is also the most consequential logic in M3 — a mistake here
 * is silent: a chip that opens a fresh conversation every time looks like it is working.
 *
 * ── How resume actually works ─────────────────────────────────────────────────────────────────
 * docs/01 said to capture the session id from the stream-json `system/init` event. That works for
 * headless, but a `popout` session runs in a terminal SkynetOS does not own and whose stdout it
 * never sees — so there would be nothing to capture, and the marquee launch mode could never
 * resume. Checking `claude --help` on this machine (v2.1.267) turned up a better answer:
 *
 *     --session-id <uuid>   Use a specific session ID for the conversation (must be a valid UUID)
 *     -r, --resume [value]  Resume a conversation by session ID
 *
 * So SkynetOS *assigns* the id instead of discovering it. First launch generates a UUID and
 * passes `--session-id`; every later launch passes `--resume <uuid>`. Identical for popout,
 * elevated and headless, and it never depends on parsing another program's output.
 */

/**
 * Quote a single PowerShell argument. Single quotes, with '' as the escape for a literal quote.
 *
 * Everything that reaches a command line goes through this. Board JSON is git-tracked and
 * reviewed, but it is still data, and a repo path containing a quote or a `$(...)` must be a
 * path — not shell syntax.
 */
export function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Escape a value for Windows Terminal's OWN command-line parser, which runs before PowerShell's.
 *
 * `wt.exe` splits its command line on `;` to open a second tab. That is not a theory. The U3
 * JARVIS-HANDS node's initial prompt contained "...cannot see this disk; you are how its
 * decisions become real." — wt took everything after the semicolon as a second subcommand,
 * failed to parse it, and exited 0 without opening anything. `spawn` had succeeded, so SkynetOS
 * cheerfully reported LAUNCHED. Nothing on screen, no error, no clue.
 *
 * Backslash-escaping the semicolon is Windows Terminal's documented escape, and it is verified
 * here to round-trip a literal `;` all the way through to the inner shell.
 *
 * Only `;` is escaped. Escaping backslashes as well would corrupt every Windows path that goes
 * through here, and wt does not treat a lone backslash as special.
 */
export function wtEscape(value: string): string {
  return value.replace(/;/g, '\\;');
}

export interface ClaudeInvocation {
  /**
   * Flags and their values. Never free text — see `initialPrompt`. Everything in here is a UUID,
   * a model name, or a config path, which is why it is safe on a command line.
   */
  args: string[];
  /** The conversation id this launch will use, whether newly minted or resumed. */
  sessionId: string;
  /** True when this launch continues an existing conversation rather than starting one. */
  resumed: boolean;
  /**
   * The first message to send, present only when this launch STARTS a conversation.
   *
   * Deliberately not in `args`. It is arbitrary prose out of board JSON, and prose on a command
   * line has to survive wt.exe's parser, then PowerShell's parser, then argv splitting — three
   * chances to be mangled by a semicolon, a quote, an ampersand or a newline. The caller stages
   * it in a file and the command reads the file. See `popoutCommand`.
   */
  initialPrompt?: string;
}

export function claudeArgs(node: BoardNode, existingSessionId: string | null): ClaudeInvocation {
  const resume = node.resume !== false;
  const sessionId = resume && existingSessionId ? existingSessionId : randomUUID();
  const args: string[] = [];

  if (resume && existingSessionId) args.push('--resume', existingSessionId);
  else args.push('--session-id', sessionId);

  if (node.model) args.push('--model', node.model);
  for (const server of node.mcpServers ?? []) args.push('--mcp-config', server);

  // The initial prompt is only meaningful on a conversation that does not exist yet. Sending it
  // on every resume would re-ask the same question at the top of every session.
  const fresh = !(resume && existingSessionId);
  const initialPrompt = node.initialPrompt && fresh ? node.initialPrompt : undefined;

  return { args, sessionId, resumed: Boolean(resume && existingSessionId), initialPrompt };
}

/**
 * The command line for a popout session.
 *
 * Windows Terminal when it is installed, plain pwsh when it is not — `wt.exe` ships with Windows
 * 11 but can be removed, and a launcher that fails on a missing optional component is a launcher
 * that fails.
 *
 * `-NoExit` is why you can still read the output of a session that died on startup, and `-d` is
 * what puts the tab in the node's repo. Getting `-d` wrong is the most damaging way this could
 * quietly misbehave: the agent would run, in the wrong directory, and say nothing about it.
 */
export function popoutCommand(
  cwd: string,
  claudeArgv: string[],
  hasWindowsTerminal: boolean,
  promptFile?: string
): { file: string; args: string[] } {
  const inner = innerCommand(claudeArgv, promptFile);
  if (hasWindowsTerminal) {
    // Everything handed to wt gets escaped, the working directory included — a folder is allowed
    // to contain a semicolon and would otherwise silently truncate the launch.
    return { file: 'wt.exe', args: ['-d', wtEscape(cwd), 'pwsh', '-NoExit', '-Command', wtEscape(inner)] };
  }
  // Plain pwsh has no second parser in front of it, so nothing needs wt escaping here.
  return { file: 'pwsh.exe', args: ['-NoExit', '-Command', inner] };
}

/**
 * The PowerShell one-liner that actually runs Claude Code.
 *
 * One statement, no `;` of our own — a statement separator here would need escaping for wt on
 * every single launch, and the whole point of `promptFile` is to stop relying on that.
 */
function innerCommand(claudeArgv: string[], promptFile?: string): string {
  const parts = ['claude', ...claudeArgv.map(psQuote)];
  if (promptFile) parts.push(`(Get-Content -Raw -LiteralPath ${psQuote(promptFile)})`);
  return parts.join(' ');
}

/**
 * The elevated variant: PowerShell's `Start-Process -Verb RunAs`, which is what raises the UAC
 * prompt. SkynetOS itself stays non-elevated and asks Windows to create the elevated child —
 * docs/07: "SkynetOS itself never runs elevated. It launches an elevated child when asked."
 */
export function elevatedCommand(
  cwd: string,
  claudeArgv: string[],
  promptFile?: string
): { file: string; args: string[] } {
  const inner = innerCommand(claudeArgv, promptFile);
  const argumentList = ['-NoExit', '-Command', `Set-Location ${psQuote(cwd)}; ${inner}`]
    .map(psQuote)
    .join(', ');
  return {
    file: 'powershell.exe',
    args: ['-NoProfile', '-Command', `Start-Process pwsh.exe -Verb RunAs -ArgumentList ${argumentList}`]
  };
}

/** The command to reattach by hand — docs/03's "Copy resume command". */
export function resumeCommandLine(cwd: string, claudeSessionId: string): string {
  return `cd "${cwd.replace(/\//g, '\\')}" && claude --resume ${claudeSessionId}`;
}
