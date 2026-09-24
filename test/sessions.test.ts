import { describe, expect, it } from 'vitest';
import type { BoardNode } from '../packages/shared/types.js';
import {
  briefingModeOf,
  buildBriefing,
  claudeArgs,
  psQuote,
  resumeCommandLine,
  wtEscape
} from '../src/main/services/launch-args.js';
// From launch-script, not terminal: terminal.ts pulls in Electron and node:sqlite, and a unit
// test that has to boot half the app is a unit test that stops being run.
import { elevatedArgv, popoutArgv, safeKey, UAC_DECLINED_EXIT } from '../src/main/services/launch-script.js';

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
 * These tests pin that behaviour, because the failure mode is silent and expensive — and it
 * already happened. See the block at the bottom of this file.
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

/** The common shape: no stored conversation, not fresh, nothing granted. */
const call = (node: BoardNode, over: Partial<Parameters<typeof claudeArgs>[0]> = {}) =>
  claudeArgs({ node, storedSessionId: null, storedIsReal: false, fresh: false, addDirs: [], ...over });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A literal backslash, spelled this way so no editor or patch tool can eat it. */
const BACKSLASH = String.fromCharCode(92);

describe('claudeArgs — first launch', () => {
  it('assigns a fresh UUID with --session-id', () => {
    const { args, sessionId, resumed } = call(agent());
    expect(resumed).toBe(false);
    expect(sessionId).toMatch(UUID);
    expect(args).toContain('--session-id');
    expect(args[args.indexOf('--session-id') + 1]).toBe(sessionId);
    expect(args).not.toContain('--resume');
  });

  it('generates a different id each time', () => {
    expect(call(agent()).sessionId).not.toBe(call(agent()).sessionId);
  });

  it('names the session after the chip, so the window and the picker say which one it is', () => {
    const { args } = call(agent({ designator: 'U3', name: 'JARVIS-HANDS' }));
    expect(args[args.indexOf('--name') + 1]).toBe('U3 JARVIS-HANDS');
  });
});

describe('claudeArgs — Remote Control', () => {
  /*
   * William, 2026-09-21: "launch and interact with sessions ... from other locations on my phone."
   * Claude Code's own Remote Control does the interacting; the chip only has to ask for it, and
   * only when its node says so.
   */
  it('is off unless the node asks for it', () => {
    expect(call(agent()).args).not.toContain('--remote-control');
    expect(call(agent({ remoteControl: false })).args).not.toContain('--remote-control');
  });

  it('always gives the flag a name, because its value is optional and would swallow the next argument', () => {
    const { args } = call(agent({ designator: 'U4', name: 'CC-TIME', remoteControl: true }));
    const at = args.indexOf('--remote-control');
    expect(at).toBeGreaterThan(-1);
    expect(args[at + 1]).toBe('U4 CC-TIME');
    expect(args[at + 1]?.startsWith('--')).toBe(false);
  });

  it('works on a resume as well as a first launch', () => {
    const { args } = call(agent({ remoteControl: true }), { storedSessionId: '11111111-2222-3333-4444-555555555555', storedIsReal: true });
    expect(args).toContain('--resume');
    expect(args).toContain('--remote-control');
  });
});

describe('claudeArgs — subsequent launches', () => {
  const prior = '11111111-2222-3333-4444-555555555555';
  const real = { storedSessionId: prior, storedIsReal: true };

  it('resumes the prior conversation rather than starting one', () => {
    const { args, sessionId, resumed } = call(agent(), real);
    expect(resumed).toBe(true);
    expect(sessionId).toBe(prior);
    expect(args[args.indexOf('--resume') + 1]).toBe(prior);
    expect(args).not.toContain('--session-id');
  });

  it('starts a fresh conversation when the node opts out of resume', () => {
    const { args, sessionId, resumed } = call(agent({ resume: false }), real);
    expect(resumed).toBe(false);
    expect(sessionId).not.toBe(prior);
    expect(args).toContain('--session-id');
    expect(args).not.toContain('--resume');
  });

  it('starts a fresh conversation when the user asks for one', () => {
    const { resumed, args } = call(agent(), { ...real, fresh: true });
    expect(resumed).toBe(false);
    expect(args).not.toContain('--resume');
  });

  it('is stable — the same prior id resumes the same conversation every time', () => {
    expect(call(agent(), real).sessionId).toBe(call(agent(), real).sessionId);
  });
});

/*
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 * The phantom conversation.
 *
 * On 2026-09-10 every conversation id in this machine's database named a conversation that did
 * not exist. The first launch of each chip had failed (the wt.exe semicolon bug), but the id was
 * recorded before the spawn — so every click after that ran `claude --resume <phantom>`, got
 * "No conversation found with session ID", and the window closed. The chips had never worked
 * once, and nothing in the UI could say so.
 *
 * The id is still recorded before the spawn: that part was right, and it is what stops a crash
 * mid-launch from orphaning a conversation. What was missing is that an assigned id is a PLAN,
 * not a fact. `storedIsReal` is the caller's answer to "is it on disk" — see conversations.ts.
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 */
describe('claudeArgs — refuses to resume a conversation that does not exist', () => {
  const phantom = '259039b5-6ee9-4d40-81bd-01927bd5c67c';

  it('mints a new conversation instead of resuming a phantom', () => {
    const { args, resumed, sessionId } = call(agent(), { storedSessionId: phantom, storedIsReal: false });
    expect(resumed).toBe(false);
    expect(args).not.toContain('--resume');
    expect(args).toContain('--session-id');
    expect(sessionId).not.toBe(phantom);
  });

  it('says which conversation was lost, rather than silently starting over', () => {
    // A chip quietly losing its history looks identical to a chip working correctly, which is
    // exactly how this went unnoticed for two sessions.
    const { recoveredFrom } = call(agent(), { storedSessionId: phantom, storedIsReal: false });
    expect(recoveredFrom).toBe(phantom);
  });

  it('reports nothing lost when there was never a conversation to lose', () => {
    expect(call(agent()).recoveredFrom).toBeUndefined();
  });

  it('reports nothing lost on a deliberate fresh start', () => {
    const good = '11111111-2222-3333-4444-555555555555';
    expect(call(agent(), { storedSessionId: good, storedIsReal: true, fresh: true }).recoveredFrom).toBeUndefined();
  });
});

describe('claudeArgs — optional node fields', () => {
  it('passes the model only when the node sets one', () => {
    expect(call(agent()).args).not.toContain('--model');
    const { args } = call(agent({ model: 'claude-opus-5' }));
    expect(args[args.indexOf('--model') + 1]).toBe('claude-opus-5');
  });

  it('passes each resolved MCP config', () => {
    /*
     * The CONFIGS, not the node's `mcpServers`. A node names a server ("skynet"); turning that name
     * into a file path needs app.getPath and the packaged-vs-dev distinction, neither of which
     * belongs in a pure argv builder that has to run here without Electron. session-manager.ts
     * resolves them — see services/mcp-config.ts for why the file is generated rather than checked
     * in.
     */
    const { args } = call(agent({ mcpServers: ['skynet', 'other'] }), {
      mcpConfigs: ['C:/Users/x/AppData/Roaming/SkynetOS/mcp/skynet.json', 'D:/tools/other.json']
    });
    expect(args.filter((a) => a === '--mcp-config')).toHaveLength(2);
    expect(args).toContain('C:/Users/x/AppData/Roaming/SkynetOS/mcp/skynet.json');
    // A server the caller did not resolve contributes nothing, rather than a bare name the CLI
    // would try to open as a file and fail the whole launch over.
    expect(call(agent({ mcpServers: ['skynet'] })).args).not.toContain('--mcp-config');
  });

  it('grants extra directories with --add-dir, one flag each', () => {
    // The answer to "my other repos are on other drives and I am not moving them".
    const { args } = call(agent(), { addDirs: ['D:\\work\\Other', 'C:\\dev\\TheStalker'] });
    expect(args.filter((a) => a === '--add-dir')).toHaveLength(2);
    expect(args[args.indexOf('--add-dir') + 1]).toBe('D:\\work\\Other');
  });

  it('grants nothing when nothing is granted', () => {
    expect(call(agent()).args).not.toContain('--add-dir');
  });
});

/* ────────────────────────────── the briefing ────────────────────────────── */

const brief = (node: BoardNode, over: Partial<Parameters<typeof buildBriefing>[0]> = {}) =>
  buildBriefing({
    node,
    boardName: 'SKYNETOS',
    cwd: 'C:\\dev\\SkynetOS',
    reading: ['CLAUDE.md', 'codex/persona.md'],
    missing: [],
    addDirs: [],
    fresh: true,
    ...over
  });

describe('the session briefing', () => {
  it('defaults to first-launch only, which is the old initialPrompt behaviour', () => {
    expect(briefingModeOf(agent())).toBe('first');
    expect(brief(agent())).toBeTruthy();
    expect(brief(agent(), { fresh: false })).toBeUndefined();
  });

  it('re-orients on every launch when the node asks it to', () => {
    const node = agent({ briefing: 'every' });
    const resumeBrief = brief(node, { fresh: false });
    expect(resumeBrief).toBeTruthy();
    expect(resumeBrief).toContain('resuming');
    // Re-introducing itself on every resume is what makes a briefing annoying rather than useful.
    expect(resumeBrief).not.toContain('Before anything else');
  });

  it('can be switched off entirely', () => {
    expect(brief(agent({ briefing: 'none' }))).toBeUndefined();
    expect(brief(agent({ briefing: 'none' }), { fresh: false })).toBeUndefined();
  });

  it('tells the session who and where it is', () => {
    const text = brief(agent({ designator: 'U3', name: 'JARVIS-HANDS' })) ?? '';
    expect(text).toContain('U3 JARVIS-HANDS');
    expect(text).toContain('SKYNETOS');
    expect(text).toContain('C:\\dev\\SkynetOS');
  });

  it('lists the reading in order', () => {
    const text = brief(agent()) ?? '';
    expect(text.indexOf('CLAUDE.md')).toBeLessThan(text.indexOf('codex/persona.md'));
    expect(text).toContain('1. CLAUDE.md');
  });

  it('names what is missing instead of sending the agent after it', () => {
    // Prime directive 1. A briefing that points at a file that is not there teaches an agent
    // that its own instructions are unreliable.
    const text = brief(agent(), { missing: ['codex/persona.md'] }) ?? '';
    expect(text).toContain('NOT on disk');
    expect(text).toContain('codex/persona.md');
  });

  it('tells the agent about the directories it was granted', () => {
    const text = brief(agent(), { addDirs: ['D:\\work\\Other'] }) ?? '';
    expect(text).toContain('D:\\work\\Other');
    expect(text).toContain('They stay where they are');
  });

  it('carries the node\'s own initial prompt through', () => {
    const text = brief(agent({ initialPrompt: 'You are the Hands of JARVIS.' })) ?? '';
    expect(text).toContain('You are the Hands of JARVIS.');
  });

  it('ends by handing control back rather than starting work', () => {
    const text = brief(agent()) ?? '';
    expect(text).toContain('READY -');
    expect(text).toContain('Then stop and wait.');
  });
});

/* ────────────────────────────── command lines ────────────────────────────── */

describe('popoutArgv', () => {
  const script = 'C:' + BACKSLASH + 'u' + BACKSLASH + 'launch' + BACKSLASH + 'root.u3.ps1';

  it('opens Windows Terminal in the node cwd when wt is present', () => {
    const { file, args } = popoutArgv('pwsh', 'C:' + BACKSLASH + 'dev' + BACKSLASH + 'TheStalker', script, true);
    expect(file).toBe('wt.exe');
    // -d is what puts the new tab in the repo. Without it the agent starts in the wrong place,
    // which is the single most damaging way this feature could quietly misbehave.
    expect(args[args.indexOf('-d') + 1]).toBe('C:' + BACKSLASH + 'dev' + BACKSLASH + 'TheStalker');
    expect(args).toContain('pwsh.exe');
    expect(args[args.indexOf('-File') + 1]).toBe(script);
  });

  it('falls back through `cmd /c start` when Windows Terminal is absent', () => {
    /*
     * Not straight at pwsh. Electron main is a GUI-subsystem process with no console, so a
     * detached console app spawned from it runs somewhere invisible and you never see a window.
     * `start` is what asks the shell to create a new console. Verified on this machine: a direct
     * detached pwsh never reported in; the same script through wt did.
     */
    const { file, args } = popoutArgv('pwsh', 'C:' + BACKSLASH + 'dev', script, false);
    expect(file).toBe('cmd.exe');
    expect(args.slice(0, 3)).toEqual(['/c', 'start', 'SkynetOS']);
    expect(args).toContain('pwsh.exe');
    expect(args).toContain('-NoExit');
    expect(args[args.indexOf('-File') + 1]).toBe(script);
  });

  it('falls back to Windows PowerShell when pwsh 7 is not installed', () => {
    expect(popoutArgv('powershell', 'C:' + BACKSLASH + 'dev', script, false).args).toContain('powershell.exe');
    expect(popoutArgv('powershell', 'C:' + BACKSLASH + 'dev', script, true).args).toContain('powershell.exe');
  });

  it('keeps the terminal open after the agent exits', () => {
    // -NoExit is why you can still read the output of a session that crashed on startup.
    expect(popoutArgv('pwsh', 'C:' + BACKSLASH + 'x', script, true).args).toContain('-NoExit');
    expect(popoutArgv('pwsh', 'C:' + BACKSLASH + 'x', script, false).args).toContain('-NoExit');
  });

  it('names the executables it needs, so `which` can be asked about them', () => {
    /*
     * The two-bug disaster of 2026-09-10: SkynetOS decided wt.exe and pwsh.exe were absent with
     * existsSync, which answers false for every App Execution Alias. It therefore silently used
     * PowerShell 5.1 with no window for months. Both names now go through services/which.ts, and
     * this pins the names that lookup has to be asked about.
     */
    expect(popoutArgv('pwsh', 'C:' + BACKSLASH + 'x', script, true).file).toBe('wt.exe');
    expect(popoutArgv('pwsh', 'C:' + BACKSLASH + 'x', script, true).args).toContain('pwsh.exe');
  });

  it('puts NOTHING but file paths on the command line', () => {
    /*
     * The load-bearing property of the whole rewrite. Every previous bug in this file was a
     * value being re-parsed by a shell it was not written for; the fix is that there are no
     * values left to re-parse. If a prompt, a banner or a prime step ever appears here again,
     * the escaping arms race starts over.
     */
    const { args } = popoutArgv('pwsh', 'C:' + BACKSLASH + 'dev', script, true);
    const flags = new Set(['-d', 'pwsh.exe', 'powershell.exe', '/c', 'start', 'SkynetOS', '-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File']);
    for (const arg of args) {
      if (flags.has(arg)) continue;
      expect(arg.startsWith('C:')).toBe(true);
    }
  });

  it('escapes a semicolon in the working directory, which is allowed to contain one', () => {
    const { args } = popoutArgv('pwsh', 'C:' + BACKSLASH + 'dev' + BACKSLASH + 'odd;name', script, true);
    expect(args[args.indexOf('-d') + 1]).toBe('C:' + BACKSLASH + 'dev' + BACKSLASH + 'odd' + BACKSLASH + ';name');
  });
});

describe('elevatedArgv', () => {
  const script = 'C:' + BACKSLASH + 'Users' + BACKSLASH + 'a b' + BACKSLASH + 'launch.ps1';

  it('goes through Start-Process -Verb RunAs, which is what raises the UAC prompt', () => {
    // docs/07: "SkynetOS itself never runs elevated. It launches an elevated child when asked."
    const { file, args } = elevatedArgv('pwsh', 'C:' + BACKSLASH + 'dev', script);
    expect(file).toBe('powershell.exe');
    expect(args.join(' ')).toContain('-Verb RunAs');
    expect(args.join(' ')).toContain("Start-Process -FilePath 'pwsh.exe'");
  });

  it('sets the working directory of the elevated shell', () => {
    // An elevated process does not inherit the launcher's directory, and -d is a wt flag that
    // is not available here.
    const { args } = elevatedArgv('pwsh', 'C:' + BACKSLASH + 'dev' + BACKSLASH + 'TheStalker', script);
    expect(args.join(' ')).toContain('-WorkingDirectory');
    expect(args.join(' ')).toContain('TheStalker');
  });

  it('double-quotes the script path inside the argument list', () => {
    /*
     * Start-Process joins an -ArgumentList ARRAY with spaces and does not quote the elements, so
     * an array silently breaks the first time a path contains a space — and the script lives
     * under C:\Users\<name>\AppData, which is exactly where a space turns up. One pre-quoted
     * string is the only form that survives.
     */
    const { args } = elevatedArgv('pwsh', 'C:' + BACKSLASH + 'dev', script);
    expect(args.join(' ')).toContain('-File "' + script + '"');
  });

  it('quotes a working directory containing an apostrophe so it cannot break out', () => {
    const { args } = elevatedArgv('pwsh', "C:" + BACKSLASH + "dev" + BACKSLASH + "My'Repo", script);
    expect(args.join(' ')).toContain("My''Repo");
  });

  it('fails loudly: a refusal exits 1223, anything else exits 2 with the reason on stderr', () => {
    // A bare Start-Process with discarded output made every elevation failure look like nothing.
    const command = elevatedArgv('powershell', 'C:' + BACKSLASH + 'dev', script).args.join(' ');
    expect(command).toContain('-ErrorAction Stop');
    expect(command).toContain(`exit ${UAC_DECLINED_EXIT}`);
    expect(command).toContain("'UAC_DECLINED'");
    expect(command).toContain('exit 2');
    expect(UAC_DECLINED_EXIT).toBe(1223);
  });

  it('falls back from Store pwsh to Windows PowerShell by full path when pwsh cannot be elevated', () => {
    const command = elevatedArgv('pwsh', 'C:' + BACKSLASH + 'dev', script).args.join(' ');
    expect(command.indexOf("-FilePath 'pwsh.exe'")).toBeLessThan(command.indexOf('WindowsPowerShell'));
    expect(command).toContain(['System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'].join(BACKSLASH));
    // The retry is not attempted after a refusal: the declined check comes first in the catch.
    const catchAt = command.indexOf('catch {');
    expect(command.indexOf('UAC_DECLINED', catchAt)).toBeLessThan(command.indexOf('WindowsPowerShell'));
    // Windows PowerShell as the chosen shell has nothing to fall back to.
    expect(elevatedArgv('powershell', 'C:' + BACKSLASH + 'dev', script).args.join(' ')).not.toContain('Join-Path');
  });

  it('is one line, so no newline has to survive the CreateProcess command line', () => {
    expect(elevatedArgv('pwsh', 'C:' + BACKSLASH + 'dev', script).args.join(' ')).not.toMatch(/[\r\n]/);
  });
});

describe('safeKey', () => {
  it('keeps a board.node key readable', () => {
    expect(safeKey('root.u3_jarvis_hands')).toBe('root.u3_jarvis_hands');
  });

  it('cannot produce a path segment that escapes the launch directory', () => {
    expect(safeKey('../../etc/passwd')).not.toContain('/');
    expect(safeKey('..' + BACKSLASH + '..')).not.toContain(BACKSLASH);
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
    expect(line).toBe('cd "C:' + BACKSLASH + 'dev' + BACKSLASH + 'TheStalker" && claude --resume abc-123');
  });
});

/*
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 * The semicolon bug, kept because the escape it produced is still load-bearing.
 *
 * `wt.exe` splits its own command line on `;` to open a second tab. U3's initial prompt contained
 * "...cannot see this disk; you are how its decisions become real." — wt took the rest as a
 * second subcommand, could not parse it, and exited 0. `spawn` had succeeded, so SkynetOS
 * reported LAUNCHED and nothing appeared.
 *
 * Prose no longer goes anywhere near a command line, so this can only bite on a path now. It is
 * still tested, because a folder called `odd;name` is legal and would truncate a launch.
 * ──────────────────────────────────────────────────────────────────────────────────────────────
 */
describe('wtEscape — Windows Terminal eats semicolons', () => {
  it('escapes a semicolon so wt passes it through instead of splitting on it', () => {
    expect(wtEscape('see this disk; you are how it works')).toBe(
      'see this disk' + BACKSLASH + '; you are how it works'
    );
  });

  it('escapes every semicolon, not just the first', () => {
    expect(wtEscape('a;b;c')).toBe('a' + BACKSLASH + ';b' + BACKSLASH + ';c');
  });

  it('leaves text without a semicolon exactly as it was', () => {
    expect(wtEscape('C:/dev/SkynetOS')).toBe('C:/dev/SkynetOS');
  });

  it('does not touch backslashes, or every Windows path through it would break', () => {
    const p = 'C:' + BACKSLASH + 'dev' + BACKSLASH + 'SkynetOS';
    expect(wtEscape(p)).toBe(p);
  });
});
