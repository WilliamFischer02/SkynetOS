import { describe, expect, it } from 'vitest';
import { buildLaunchScript, elevatedProgramArgv } from '../src/main/services/launch-script.js';
import { DEFAULT_PRIME, PRIME_STEPS, normalisePrime, primeStepsFor } from '../packages/shared/prime-steps.js';

/**
 * The generated launch script.
 *
 * This is now the only thing that runs when a chip is clicked, so it carries every guarantee the
 * old command-line escaping was trying and failing to carry: nothing that came from board JSON
 * is ever code, priming is checked against the disk before it runs, and the script reports its
 * own pid so main can tell a launch that happened from a launch that did not.
 */

const B = String.fromCharCode(92);
const CWD = 'C:' + B + 'dev' + B + 'SkynetOS';
const PIDFILE = 'C:' + B + 'u' + B + 'launch' + B + 'root.u3.pid';

const base = {
  title: 'SkynetOS - U3 JARVIS-HANDS',
  cwd: CWD,
  banner: [CWD],
  prime: [],
  pidFile: PIDFILE
};

describe('the pid file', () => {
  it('is written before anything that can fail', () => {
    /*
     * wt.exe is a launcher stub: it exits 0 about 200ms after handing off, whether or not it
     * understood its arguments. Treating that exit as the session's exit is why fifteen recorded
     * sessions on this machine each "started" and "died" within a second. The script reporting
     * its own $PID is the only signal that means a shell really exists.
     */
    const script = buildLaunchScript(base);
    const setPid = script.indexOf('Set-Content -LiteralPath $SkynetPidFile');
    const setLocation = script.indexOf('Set-Location');
    expect(setPid).toBeGreaterThan(-1);
    expect(setPid).toBeLessThan(setLocation);
  });

  it('is removed when the agent exits, in a finally so a crash still clears it', () => {
    const script = buildLaunchScript(base);
    expect(script).toContain('finally {');
    expect(script).toContain('Remove-Item -LiteralPath $SkynetPidFile');
  });
});

describe('the working directory', () => {
  it('is set inside the script, not left to the launcher', () => {
    // An elevated shell does not inherit it, and wt's -d is not available in every path.
    expect(buildLaunchScript(base)).toContain('Set-Location -LiteralPath ' + "'" + CWD + "'");
  });

  it('is quoted, so a repo with an apostrophe in its name cannot become syntax', () => {
    const odd = "C:" + B + "dev" + B + "Will's Repo";
    expect(buildLaunchScript({ ...base, cwd: odd })).toContain("'C:" + B + "dev" + B + "Will''s Repo'");
  });
});

describe('priming', () => {
  it('runs nothing when nothing is asked for', () => {
    const script = buildLaunchScript(base);
    expect(script).not.toContain('claude update');
    expect(script).not.toContain('npm install');
  });

  it('runs the steps it is given, in order, numbered', () => {
    const script = buildLaunchScript({
      ...base,
      prime: [PRIME_STEPS['claude'], PRIME_STEPS['git-fetch']]
    });
    expect(script).toContain('claude update');
    expect(script).toContain('git fetch --all --prune');
    expect(script.indexOf('[1/2]')).toBeLessThan(script.indexOf('[2/2]'));
  });

  it('checks a step marker before running it, and says when it skips', () => {
    /*
     * Prime directive 1. `npm install` in a repo with no package.json is a red stack trace in
     * a window that is supposed to be handing you a ready session.
     */
    const script = buildLaunchScript({ ...base, prime: [PRIME_STEPS['npm-install']] });
    expect(script).toContain("Test-Path -LiteralPath 'package.json'");
    expect(script).toContain('skipped, no package.json here');
  });

  it('accepts any one of several markers', () => {
    const script = buildLaunchScript({ ...base, prime: [PRIME_STEPS['pip-self']] });
    expect(script).toContain("(Test-Path -LiteralPath 'requirements.txt')");
    expect(script).toContain(' -or ');
    expect(script).toContain("(Test-Path -LiteralPath 'pyproject.toml')");
  });

  it('runs a marker-free step unconditionally', () => {
    // Updating the CLI itself does not depend on what kind of repo this is.
    const script = buildLaunchScript({ ...base, prime: [PRIME_STEPS['claude']] });
    expect(script).not.toContain('Test-Path');
  });

  it('keeps going when a step fails', () => {
    // A failed `git fetch` on a machine that is offline must not cost you the session.
    const script = buildLaunchScript({ ...base, prime: [PRIME_STEPS['git-fetch']] });
    expect(script).toContain("$ErrorActionPreference = 'Continue'");
    expect(script).toContain('continuing anyway');
  });
});

describe('starting the agent', () => {
  const args = ['--session-id', 'abc-123', '--add-dir', 'D:' + B + 'work' + B + 'Other'];

  it('checks the CLI is on PATH and says so plainly when it is not', () => {
    const script = buildLaunchScript({ ...base, claude: { args } });
    expect(script).toContain('Get-Command claude');
    expect(script).toContain('CLAUDE CODE IS NOT ON PATH');
  });

  it('splats a quoted array rather than building a command string', () => {
    const script = buildLaunchScript({ ...base, claude: { args } });
    expect(script).toContain("$SkynetArgs = @('--session-id', 'abc-123'");
    expect(script).toContain('& claude @SkynetArgs');
  });

  it('reads the briefing out of a file, so prose never enters the script', () => {
    const promptFile = 'C:' + B + 'u' + B + 'prompts' + B + 'root.u3.txt';
    const script = buildLaunchScript({ ...base, claude: { args, promptFile } });
    expect(script).toContain('Get-Content -Raw -LiteralPath $SkynetPromptFile');
    expect(script).toContain(promptFile);
  });

  it('starts the agent with no prompt at all when there is no briefing', () => {
    const script = buildLaunchScript({ ...base, claude: { args } });
    expect(script).not.toContain('Get-Content -Raw');
    expect(script).toContain('& claude @SkynetArgs');
  });

  it('leaves you at a ready shell when there is no agent', () => {
    // "Open a terminal here" is the same machinery with the last step removed.
    const script = buildLaunchScript({ ...base, readyNote: '  Shell ready.' });
    expect(script).not.toContain('claude');
    expect(script).toContain('Shell ready.');
  });
});

describe('nothing from board JSON is ever code', () => {
  it('quotes a title that contains PowerShell syntax', () => {
    const script = buildLaunchScript({ ...base, title: '$(whoami) & del *' });
    expect(script).toContain("'$(whoami) & del *'");
    // Never bare: a Write-Host of an unquoted $(...) would execute it.
    expect(script).not.toMatch(/Write-Host \$\(whoami\)/);
  });

  it('quotes a banner line that contains a quote', () => {
    const script = buildLaunchScript({ ...base, banner: ["it's here"] });
    expect(script).toContain("it''s here");
  });

  it('is ASCII, because a BOM-less .ps1 is read as the ANSI codepage by PowerShell 5.1', () => {
    const script = buildLaunchScript({
      ...base,
      title: 'SkynetOS — U3',
      banner: ['a “quoted” thing…']
    });
    // eslint-disable-next-line no-control-regex
    expect(script).toMatch(/^[\x00-\x7F]*$/);
    expect(script).toContain('SkynetOS - U3');
    expect(script).toContain('a "quoted" thing...');
  });

  it('uses CRLF, because it is a Windows script file', () => {
    expect(buildLaunchScript(base)).toContain('\r\n');
  });
});

describe('the prime step registry', () => {
  it('defaults to steps that cannot rewrite a lockfile or a virtualenv', () => {
    for (const id of DEFAULT_PRIME) expect(PRIME_STEPS[id].mutates).toBe(false);
  });

  it('gives an unconfigured node the default, and an empty array nothing', () => {
    expect(primeStepsFor(undefined).map((s) => s.id)).toEqual([...DEFAULT_PRIME]);
    expect(primeStepsFor([])).toEqual([]);
  });

  it('drops an id it does not recognise instead of trusting it', () => {
    // Board JSON is data. An id that is not in the registry has no command, so it runs nothing.
    expect(normalisePrime(['claude', 'rm -rf /', 'git-fetch'])).toEqual(['claude', 'git-fetch']);
  });

  it('de-duplicates while keeping order', () => {
    expect(normalisePrime(['git-fetch', 'claude', 'git-fetch'])).toEqual(['git-fetch', 'claude']);
  });

  it('marks every step that can change files in the repo', () => {
    expect(PRIME_STEPS['npm-update'].mutates).toBe(true);
    expect(PRIME_STEPS['pip-reqs'].mutates).toBe(true);
    expect(PRIME_STEPS['npm-audit'].mutates).toBe(false);
  });
});

/**
 * ── Launching a program as administrator ─────────────────────────────────────────────────────
 *
 * William: "I need to be able to link any exe anywhere on my drive and the program can try to
 * launch it as admin."
 *
 * A process cannot raise its own privileges and cannot hand them to a child, so this goes through
 * `Start-Process -Verb RunAs` — there is no `spawn` option for "and also be administrator". The
 * command string is built here rather than in shell-opener so it can be read without spawning
 * anything, which is the only way to check quoting.
 */
describe('elevatedProgramArgv', () => {
  const BACKSLASH = String.fromCharCode(92);

  it('asks Windows to elevate, rather than trying to elevate itself', () => {
    const { file, args } = elevatedProgramArgv('C:/Program Files/Anki/anki.exe', [], 'C:/Program Files/Anki');
    expect(file).toBe('powershell.exe');
    expect(args.join(' ')).toContain('-Verb RunAs');
    expect(args.join(' ')).toContain('Start-Process');
  });

  it('converts board paths to Windows separators', () => {
    const { args } = elevatedProgramArgv('C:/Program Files/Anki/anki.exe', [], 'C:/Program Files/Anki');
    expect(args.join(' ')).toContain(`C:${BACKSLASH}Program Files${BACKSLASH}Anki${BACKSLASH}anki.exe`);
  });

  it('omits -ArgumentList entirely when there are no arguments', () => {
    /*
     * An empty list makes Start-Process fail with "Cannot validate argument on parameter
     * 'ArgumentList'", and that surfaces as a launch silently not happening — the failure mode this
     * codebase has spent more time on than any other.
     */
    const { args } = elevatedProgramArgv('C:/tools/thing.exe', [], 'C:/tools');
    expect(args.join(' ')).not.toContain('ArgumentList');
  });

  it('passes arguments as separate quoted strings', () => {
    const { args } = elevatedProgramArgv('C:/tools/thing.exe', ['--flag', 'a value'], 'C:/tools');
    const command = args[args.length - 1] ?? '';
    expect(command).toContain("-ArgumentList '--flag', 'a value'");
  });

  it('cannot be broken out of by a path or an argument', () => {
    /*
     * A single quote is the only character that matters to PowerShell inside a single-quoted
     * string, and psQuote doubles it. Everything else — ; & $ ` ( ) — is inert *as long as it
     * stays inside the quotes*, which is the property worth testing.
     *
     * Counting occurrences of "Start-Process" would be the wrong test: the injected text appears
     * in the command twice because it is sitting inside the quoted path, which is exactly the
     * outcome we want. So instead, strip every single-quoted region (PowerShell escapes a quote by
     * doubling it) and assert that what REMAINS — the actual PowerShell code — is one harmless
     * statement with none of the attacker's characters in it.
     */
    const stripQuoted = (text: string): string => {
      let out = '';
      let i = 0;
      let inString = false;
      while (i < text.length) {
        const ch = text[i];
        if (!inString) {
          if (ch === "'") { inString = true; i++; continue; }
          out += ch;
          i++;
          continue;
        }
        // Inside a string: '' is an escaped quote and stays inside; a lone ' ends it.
        if (ch === "'" && text[i + 1] === "'") { i += 2; continue; }
        if (ch === "'") { inString = false; i++; continue; }
        i++;
      }
      expect(inString, 'a quote was left open — the command is malformed').toBe(false);
      return out;
    };

    const nasty = "C:/tools/it's; Start-Process calc.exe #.exe";
    const { args } = elevatedProgramArgv(nasty, ['$(whoami)', "a'b"], 'C:/tools');
    const command = args[args.length - 1] ?? '';

    // The quotes are there and doubled correctly.
    expect(command).toContain("it''s");
    expect(command).toContain("'$(whoami)'");
    expect(command).toContain("'a''b'");

    const code = stripQuoted(command);
    expect(code.match(/Start-Process/g), 'a second statement escaped the quotes').toHaveLength(1);
    expect(code, 'a semicolon escaped the quotes').not.toContain(';');
    expect(code, 'a subexpression escaped the quotes').not.toContain('$(');
    expect(code, 'a comment escaped the quotes').not.toContain('#');
  });
});
