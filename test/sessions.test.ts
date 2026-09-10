import { describe, expect, it } from 'vitest';
import type { BoardNode } from '../packages/shared/types.js';
import { claudeArgs, elevatedCommand, popoutCommand, psQuote, resumeCommandLine } from '../src/main/services/launch-args.js';

/**
 * The resume contract.
 *
 * docs/06 M3's exit criterion is "closing and reclicking resumes the same session", and the
 * mechanism is that SkynetOS ASSIGNS the conversation id rather than discovering it. Verified
 * against the real CLI on this machine (claude 2.1.267):
 *
 *     --session-id <uuid>   Use a specific session ID for the conversation (must be a valid UUID)
 *     -r, --resume [value]  Resume a conversation by session ID
 *
 * These tests pin that behaviour, because the failure mode is silent and expensive: a chip that
 * opens a fresh conversation every time looks like it works.
 */

const agent = (over: Partial<BoardNode> = {}): BoardNode => ({
  id: 'u1_agent_stalker',
  kind: 'agent.code',
  name: 'CC-STALKER',
  pos: { x: 4, y: 6 },
  cwd: 'C:/dev/TheStalker',
  launch: 'popout',
  ...over
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('claudeArgs — first launch', () => {
  it('assigns a fresh UUID with --session-id', () => {
    const { args, sessionId, resumed } = claudeArgs(agent(), null);
    expect(resumed).toBe(false);
    expect(sessionId).toMatch(UUID);
    expect(args).toContain('--session-id');
    expect(args[args.indexOf('--session-id') + 1]).toBe(sessionId);
    expect(args).not.toContain('--resume');
  });

  it('generates a different id each time', () => {
    expect(claudeArgs(agent(), null).sessionId).not.toBe(claudeArgs(agent(), null).sessionId);
  });

  it('sends the initial prompt', () => {
    const { args } = claudeArgs(agent({ initialPrompt: 'read CLAUDE.md first' }), null);
    expect(args).toContain('read CLAUDE.md first');
  });
});

describe('claudeArgs — subsequent launches', () => {
  const prior = '11111111-2222-3333-4444-555555555555';

  it('resumes the prior conversation rather than starting one', () => {
    const { args, sessionId, resumed } = claudeArgs(agent(), prior);
    expect(resumed).toBe(true);
    expect(sessionId).toBe(prior);
    expect(args).toContain('--resume');
    expect(args[args.indexOf('--resume') + 1]).toBe(prior);
    expect(args).not.toContain('--session-id');
  });

  it('does NOT resend the initial prompt on a resume', () => {
    // Otherwise every reopen re-asks the same question at the top of the conversation.
    const { args } = claudeArgs(agent({ initialPrompt: 'read CLAUDE.md first' }), prior);
    expect(args).not.toContain('read CLAUDE.md first');
  });

  it('starts a fresh conversation when the node opts out of resume', () => {
    const { args, sessionId, resumed } = claudeArgs(agent({ resume: false }), prior);
    expect(resumed).toBe(false);
    expect(sessionId).not.toBe(prior);
    expect(args).toContain('--session-id');
    expect(args).not.toContain('--resume');
  });

  it('is stable — the same prior id resumes the same conversation every time', () => {
    expect(claudeArgs(agent(), prior).sessionId).toBe(claudeArgs(agent(), prior).sessionId);
  });
});

describe('claudeArgs — optional node fields', () => {
  it('passes the model only when the node sets one', () => {
    expect(claudeArgs(agent(), null).args).not.toContain('--model');
    const { args } = claudeArgs(agent({ model: 'claude-opus-5' }), null);
    expect(args[args.indexOf('--model') + 1]).toBe('claude-opus-5');
  });

  it('passes each declared MCP server', () => {
    const { args } = claudeArgs(agent({ mcpServers: ['skynet-mcp', 'other'] }), null);
    expect(args.filter((a) => a === '--mcp-config')).toHaveLength(2);
    expect(args).toContain('skynet-mcp');
  });
});

describe('popoutCommand', () => {
  const argv = ['--resume', 'abc'];

  it('opens Windows Terminal in the node cwd when wt is present', () => {
    const { file, args } = popoutCommand('C:\\dev\\TheStalker', argv, true);
    expect(file).toBe('wt.exe');
    // -d is what puts the new tab in the repo. Without it the agent starts in the wrong place,
    // which is the single most damaging way this feature could quietly misbehave.
    expect(args[args.indexOf('-d') + 1]).toBe('C:\\dev\\TheStalker');
    expect(args).toContain('pwsh');
    expect(args.join(' ')).toContain('claude');
    expect(args.join(' ')).toContain('--resume');
  });

  it('falls back to pwsh when Windows Terminal is absent', () => {
    // wt.exe ships with Windows 11 but can be removed, and a launcher that fails on a missing
    // optional component is a launcher that fails.
    const { file, args } = popoutCommand('C:\\dev\\TheStalker', argv, false);
    expect(file).toBe('pwsh.exe');
    expect(args).toContain('-NoExit');
    expect(args.join(' ')).toContain('claude');
  });

  it('keeps the terminal open after claude exits', () => {
    // -NoExit is why you can still read the output of a session that crashed on startup.
    expect(popoutCommand('C:\\dev\\x', argv, true).args).toContain('-NoExit');
    expect(popoutCommand('C:\\dev\\x', argv, false).args).toContain('-NoExit');
  });

  it('quotes arguments so a path with spaces or a quote cannot break out', () => {
    const { args } = popoutCommand('C:\\dev\\My Repo', ['--resume', "it's here"], true);
    const command = args[args.length - 1]!;
    // PowerShell single-quoting, with '' as the escape for a literal quote.
    expect(command).toContain("'it''s here'");
    expect(args[args.indexOf('-d') + 1]).toBe('C:\\dev\\My Repo');
  });

  it('never interpolates an argument into the command unquoted', () => {
    const { args } = popoutCommand('C:\\dev\\x', ['--session-id', '$(whoami)'], true);
    const command = args[args.length - 1]!;
    expect(command).toContain("'$(whoami)'");
    expect(command).not.toMatch(/[^']\$\(whoami\)/);
  });
});

describe('elevatedCommand', () => {
  it('goes through Start-Process -Verb RunAs, which is what raises the UAC prompt', () => {
    const { file, args } = elevatedCommand('C:\dev\TheStalker', ['--resume', 'abc']);
    // docs/07: "SkynetOS itself never runs elevated. It launches an elevated child when asked."
    expect(file).toBe('powershell.exe');
    expect(args.join(' ')).toContain('-Verb RunAs');
    expect(args.join(' ')).toContain('Start-Process pwsh.exe');
  });

  it('sets the working directory inside the elevated shell', () => {
    // -d is a wt.exe flag and is not available here, so the cwd has to be a Set-Location.
    const { args } = elevatedCommand('C:\dev\TheStalker', ['--resume', 'abc']);
    expect(args.join(' ')).toContain('Set-Location');
    expect(args.join(' ')).toContain('TheStalker');
  });

  it('quotes the nested argument list so a path cannot break out of two shell layers', () => {
    // Two layers of PowerShell: the outer -Command string, and the -ArgumentList inside it. A
    // quote therefore has to survive being doubled TWICE — ' -> '' -> ''''. Getting this wrong
    // is a command-injection bug that only shows up on a path with an apostrophe in it.
    const { args } = elevatedCommand("C:\\dev\\My'Repo", ['--session-id', 'x']);
    expect(args.join(' ')).toContain("My''''Repo");
  });
});

describe('psQuote', () => {
  it('wraps in single quotes', () => {
    expect(psQuote('plain')).toBe("'plain'");
  });

  it('doubles an embedded quote, which is PowerShell\'s escape', () => {
    expect(psQuote("it's")).toBe("'it''s'");
  });

  it('neutralises command substitution and variable expansion', () => {
    // Inside PowerShell single quotes nothing expands, which is the entire point.
    expect(psQuote('$(whoami)')).toBe("'$(whoami)'");
    expect(psQuote('$env:PATH')).toBe("'$env:PATH'");
    expect(psQuote('`echo hi`')).toBe("'`echo hi`'");
  });
});

describe('resumeCommandLine', () => {
  it('is a command you can paste into a terminal', () => {
    const line = resumeCommandLine('C:/dev/TheStalker', 'abc-123');
    expect(line).toBe('cd "C:\\dev\\TheStalker" && claude --resume abc-123');
  });

  it('uses backslashes, because it is going into a Windows shell', () => {
    expect(resumeCommandLine('C:/dev/a/b', 'x')).toContain('C:\\dev\\a\\b');
  });
});
