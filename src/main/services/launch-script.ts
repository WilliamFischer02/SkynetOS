import type { PrimeStep } from '@shared/prime-steps.js';
import { psQuote, wtEscape } from './launch-args.js';

/**
 * The PowerShell script a popout terminal actually runs.
 *
 * ── Why a script file instead of a command line ───────────────────────────────────────────────
 *
 * The previous design put the whole launch on one command line and then escaped it for each
 * parser in the chain. That chain is `spawn` -> wt.exe -> pwsh -> claude's own argv, and every
 * link has its own opinion about `;`, `'`, `"`, `&`, `(` and newlines. It has now been debugged
 * twice — a semicolon in U3's prompt silently ate an entire launch, and the fix for that only
 * moved the problem to the next character class.
 *
 * So the command line is now nothing but file paths. Everything else — priming, the banner, the
 * working directory, the arguments, the failure messages — is written to a `.ps1` under
 * userData and run with `pwsh -File`. There is exactly one parser left, PowerShell's, and every
 * value handed to it is single-quoted by `psQuote`. Prose never reaches even that: the initial
 * prompt is read back out of its own file at runtime.
 *
 * The script is also a debugging artifact. When a launch misbehaves, the exact thing that ran is
 * sitting on disk to be opened and run by hand. That is the difference between "it reported
 * success and nothing happened" and a bug you can see.
 *
 * ── Why it writes a pid file ──────────────────────────────────────────────────────────────────
 *
 * `wt.exe` is a launcher stub: it hands off to the real terminal process and exits 0 within
 * about 200ms. Every session SkynetOS has ever recorded therefore looked like it started and
 * died instantly, and `spawn` succeeding was mistaken for the session existing. The script
 * writes its own `$PID` before doing anything and removes it when the agent exits, so main can
 * ask a question with a real answer: is there a live shell, and which one.
 */

export interface LaunchScriptSpec {
  /** The terminal window's title. Shown in the taskbar, so it says which chip this is. */
  title: string;
  /** Windows path, backslashes. The script's first act is to go there. */
  cwd: string;
  /** Lines printed under the title before priming. Identity, not decoration. */
  banner: string[];
  /** Update steps, already filtered to the ones this node asked for. */
  prime: readonly PrimeStep[];
  /** Where the script records its own process id. See the header. */
  pidFile: string;
  /** Present for an agent chip; absent for a plain "open a terminal here". */
  claude?: {
    /** Flags and their values. UUIDs, model names, paths — never prose. */
    args: readonly string[];
    /** A file containing the first message, read at runtime. Prose never enters the script. */
    promptFile?: string;
  };
  /** Shown at the end of a plain terminal launch, in place of starting an agent. */
  readyNote?: string;
}

/**
 * ASCII only, deliberately.
 *
 * A `.ps1` without a byte-order mark is read as the system ANSI codepage by Windows PowerShell
 * 5.1, which is the fallback shell when pwsh is missing. An em-dash in a banner would arrive as
 * mojibake there. Writing the file with a BOM fixes the encoding half; keeping the generated
 * text ASCII means it is also correct in every other tool that opens it.
 */
function ascii(value: string): string {
  return value
    .replace(/[—–]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[…]/g, '...')
    .replace(/[^\x20-\x7E]/g, '?');
}

/** A `Write-Host` line, with the text quoted so it can never be code. */
function say(text: string, colour?: string): string {
  const quoted = psQuote(ascii(text));
  return colour ? `Write-Host ${quoted} -ForegroundColor ${colour}` : `Write-Host ${quoted}`;
}

/** A PowerShell array literal of quoted strings, for splatting at a native command. */
function psArray(values: readonly string[]): string {
  return values.length ? `@(${values.map(psQuote).join(', ')})` : '@()';
}

/**
 * One priming step, inline.
 *
 * Emitted literally rather than looped over a table with `Invoke-Expression`, for two reasons:
 * the generated script is meant to be readable by a human debugging a launch, and there is then
 * no code path in it that turns a string into a command. The step's `command` is a constant from
 * `packages/shared/prime-steps.ts` and cannot come from board JSON — see that file's header.
 */
function primeBlock(step: PrimeStep, index: number, total: number): string[] {
  const lines: string[] = [];
  const heading = `[${index + 1}/${total}] ${step.label}`;

  const body = [
    `  ${say(heading, 'Yellow')}`,
    `  ${say(`      ${step.command}`, 'DarkGray')}`,
    `  ${step.command}`,
    '  if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) {',
    `    ${say(`      ${step.label} exited non-zero - continuing anyway`, 'DarkYellow')}`,
    '  }',
    '  $LASTEXITCODE = 0',
    '  Write-Host ""'
  ];

  if (step.markers.length === 0) {
    lines.push(...body.map((l) => l.replace(/^ {2}/, '')));
    return lines;
  }

  // Bind to reality: a step whose marker is absent is SKIPPED and says so, rather than running
  // `npm install` in a repo with no package.json and filling the window with a red stack trace.
  const test = step.markers.map((m) => `(Test-Path -LiteralPath ${psQuote(m)})`).join(' -or ');
  lines.push(`if (${test}) {`);
  lines.push(...body);
  lines.push('} else {');
  lines.push(`  ${say(`[${index + 1}/${total}] ${step.label} - skipped, no ${step.markers.join(' or ')} here`, 'DarkGray')}`);
  lines.push('  Write-Host ""');
  lines.push('}');
  return lines;
}

/**
 * Build the script. Pure string work: no fs, no Electron, so test/launch-script.test.ts can hold
 * it to the guarantees above instead of trusting them.
 */
export function buildLaunchScript(spec: LaunchScriptSpec): string {
  const L: string[] = [];

  L.push('# SkynetOS - generated launch script. Overwritten on every launch; edit the node, not this.');
  L.push(`# ${ascii(spec.title)}`);
  L.push('');
  L.push("$ErrorActionPreference = 'Continue'");
  L.push('$ProgressPreference = \'SilentlyContinue\'');
  L.push(`$Host.UI.RawUI.WindowTitle = ${psQuote(ascii(spec.title))}`);
  L.push('');

  // The pid file is written FIRST, before anything that can fail, so main can tell the
  // difference between "the shell never opened" and "the shell opened and the agent failed".
  L.push(`$SkynetPidFile = ${psQuote(spec.pidFile)}`);
  L.push('try {');
  L.push('  Set-Content -LiteralPath $SkynetPidFile -Value $PID -Encoding ascii -ErrorAction SilentlyContinue');
  L.push('} catch { }');
  L.push('');
  L.push('try {');

  L.push(`  Set-Location -LiteralPath ${psQuote(spec.cwd)}`);
  L.push('  Write-Host ""');
  L.push(`  ${say(`  ${spec.title}`, 'Cyan')}`);
  for (const line of spec.banner) L.push(`  ${say(`  ${line}`, 'DarkGray')}`);
  L.push('  Write-Host ""');

  if (spec.prime.length) {
    for (const [i, step] of spec.prime.entries()) {
      for (const line of primeBlock(step, i, spec.prime.length)) L.push(`  ${line}`);
    }
  }

  if (spec.claude) {
    /*
     * Resolve the CLI before invoking it. `claude` not being on PATH is a real thing that
     * happens — a fresh machine, a PATH that an installer did not refresh — and the difference
     * between a red line saying so and a window that flashes and closes is the whole complaint
     * this rewrite exists to answer.
     */
    /*
     * Keep the window title ours. Claude Code retitles its terminal after the conversation, and
     * the JARVIS face window finds a Prime terminal BY its title (services/window-tracker.ts). A
     * retitled window would leave its face behind, hidden, the moment JARVIS started talking.
     */
    L.push("  $env:CLAUDE_CODE_DISABLE_TERMINAL_TITLE = '1'");
    L.push('  $SkynetClaude = (Get-Command claude -ErrorAction SilentlyContinue).Source');
    L.push('  if (-not $SkynetClaude) {');
    L.push(`    ${say('  CLAUDE CODE IS NOT ON PATH IN THIS SHELL.', 'Red')}`);
    L.push(`    ${say('  Install it, or open a terminal where `claude --version` works, and try again.', 'DarkGray')}`);
    L.push('    return');
    L.push('  }');
    L.push('');
    L.push(`  $SkynetArgs = ${psArray(spec.claude.args)}`);

    if (spec.claude.promptFile) {
      L.push(`  $SkynetPromptFile = ${psQuote(spec.claude.promptFile)}`);
      L.push("  $SkynetPrompt = ''");
      L.push('  if (Test-Path -LiteralPath $SkynetPromptFile) {');
      L.push('    $SkynetPrompt = Get-Content -Raw -LiteralPath $SkynetPromptFile');
      L.push('  }');
      L.push(`  ${say('  Briefing this session, then handing it to you.', 'Green')}`);
      L.push('  Write-Host ""');
      L.push('  if ($SkynetPrompt.Trim().Length -gt 0) {');
      L.push('    & claude @SkynetArgs $SkynetPrompt');
      L.push('  } else {');
      L.push('    & claude @SkynetArgs');
      L.push('  }');
    } else {
      L.push(`  ${say('  Starting Claude Code.', 'Green')}`);
      L.push('  Write-Host ""');
      L.push('  & claude @SkynetArgs');
    }
  } else {
    L.push(`  ${say(spec.readyNote ?? '  Ready.', 'Green')}`);
    L.push('  Write-Host ""');
  }

  L.push('}');
  L.push('finally {');
  if (spec.claude) {
    // Removed when the agent exits, which is what makes the chip go idle at the right moment
    // rather than 30 seconds after a launcher stub that was never the session in the first place.
    L.push('  Remove-Item -LiteralPath $SkynetPidFile -ErrorAction SilentlyContinue');
  } else {
    /*
     * A plain terminal KEEPS its pid file. Its script ends within milliseconds of starting and the
     * -NoExit shell stays open, so removing the file here deleted it about 50 ms after writing it.
     * Main polls every 150 ms, so it usually never saw the file and reported a window that HAD
     * opened as a failed launch. The file lives as long as the shell; readLivePid checks the pid
     * against the OS, so a stale one is harmless, and the next launch clears it first.
     */
    L.push('  # a plain terminal keeps its pid file while the shell lives');
  }
  L.push('}');
  L.push('');

  return L.join('\r\n');
}

/* ────────────────────────── what the launcher is told ────────────────────────── */

export type ShellKind = 'pwsh' | 'powershell';

/**
 * One namespace for staged files, so nothing a user typed ever becomes a path segment.
 * `..` and separators are stripped, not escaped — there is no legitimate reason for either.
 */
export function safeKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

/**
 * The command line for a popout terminal. Nothing but file paths — see the module header.
 *
 * `wt.exe` still gets its own escaping because it parses its command line before pwsh does and
 * splits on `;`, and a folder is allowed to contain one. That is now the ONLY thing wtEscape
 * has to survive, because nothing else on this command line is text.
 */
export function popoutArgv(
  shell: ShellKind,
  cwd: string,
  scriptFile: string,
  useWt: boolean
): { file: string; args: string[] } {
  const exe = shell === 'pwsh' ? 'pwsh.exe' : 'powershell.exe';
  const flags = ['-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'];
  if (useWt) {
    return { file: 'wt.exe', args: ['-d', wtEscape(cwd), exe, ...flags, wtEscape(scriptFile)] };
  }

  /*
   * No Windows Terminal — and this fallback has to go through `cmd /c start`, not straight at
   * the shell.
   *
   * Electron's main process is a GUI-subsystem process: it owns no console. Spawning a console
   * application from it, even detached, does not reliably produce a window you can see — the
   * process runs, writes to nothing, and exits. Verified on this machine: a direct detached
   * `pwsh.exe -File <script>` never reported in, while the identical script under `wt` did.
   *
   * `start` is the documented way to ask the shell to create a NEW console for a program, and it
   * is what turns "the process ran somewhere invisible" into "a window opened". The empty first
   * argument is the window title, which `start` requires before it will accept anything else.
   *
   * The script itself does the Set-Location, so `cwd` is deliberately not on this command line —
   * one fewer path for cmd.exe, which has its own metacharacters, to re-parse.
   */
  return { file: 'cmd.exe', args: ['/c', 'start', 'SkynetOS', exe, ...flags, scriptFile] };
}

/**
 * The elevated command line.
 *
 * docs/07: "SkynetOS itself never runs elevated. It launches an elevated child when asked." So a
 * non-elevated `powershell.exe` is asked to `Start-Process -Verb RunAs`, which is what raises UAC.
 *
 * `-ArgumentList` is deliberately ONE pre-quoted string rather than an array. Start-Process joins
 * an array with spaces and does not quote the elements, so an array silently breaks the moment a
 * path contains a space — and the script lives under `C:\Users\<name>\AppData`, which is exactly
 * where a space turns up.
 *
 * `wt.exe` is not used here even when installed: elevating a Store app execution alias is
 * unreliable, and an elevated plain PowerShell console is precisely what "admin PowerShell
 * window" means anyway.
 */
/** The elevated helper's exit code when UAC was declined: ERROR_CANCELLED, as Windows spells it. */
export const UAC_DECLINED_EXIT = 1223;

/*
 * Reworked 2026-09-11, after William: "the whole admin component … just doesn't seem to be
 * working." The helper used to run one bare Start-Process with its output discarded, so every way
 * elevation can fail looked the same: the UAC prompt was declined, the shell could not be
 * elevated, or the working directory was invalid. Nothing appeared, and 90 s later came a guess.
 * Now it:
 *   - fails loudly: -ErrorAction Stop, the reason written to stderr, which main captures;
 *   - separates "declined" (exit 1223) from "broken" (exit 2), so the toast can say which;
 *   - falls back once. pwsh 7 here is the Microsoft Store build, reached through an App Execution
 *     Alias, and asking Windows to elevate an alias is the one step in this chain with a history
 *     of failing. So a pwsh failure that is not a refusal retries with Windows PowerShell by full
 *     System32 path, which is always elevatable.
 * One line, `;`-separated: newlines inside a -Command argument are one more thing for the
 * CreateProcess command line to mangle.
 */
export function elevatedArgv(
  shell: ShellKind,
  cwd: string,
  scriptFile: string
): { file: string; args: string[] } {
  const exe = shell === 'pwsh' ? 'pwsh.exe' : 'powershell.exe';
  const argumentList = `-NoExit -NoProfile -ExecutionPolicy Bypass -File "${scriptFile}"`;
  const start = (filePath: string): string =>
    `Start-Process -FilePath ${filePath} -Verb RunAs ` +
    `-WorkingDirectory ${psQuote(cwd)} -ArgumentList ${psQuote(argumentList)} -ErrorAction Stop`;
  const systemPowerShell =
    `(Join-Path $env:SystemRoot ${psQuote(['System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'].join(BACKSLASH))})`;
  const declined = `if ($_.Exception.Message -match 'cancel') { [Console]::Error.WriteLine('UAC_DECLINED'); exit ${UAC_DECLINED_EXIT} }`;
  const giveUp = `[Console]::Error.WriteLine($_.Exception.Message); exit 2`;

  const command = shell === 'pwsh'
    ? `try { ${start(psQuote(exe))} } catch { ${declined}; ` +
      `[Console]::Error.WriteLine('PWSH COULD NOT BE ELEVATED, USING WINDOWS POWERSHELL: ' + $_.Exception.Message); ` +
      `try { ${start(systemPowerShell)} } catch { ${declined}; ${giveUp} } }`
    : `try { ${start(psQuote(exe))} } catch { ${declined}; ${giveUp} }`;
  return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', command] };
}

/**
 * The argv that asks Windows to start a PROGRAM elevated.
 *
 * `elevatedArgv` above does this for a terminal running our staged script; this does it for an
 * arbitrary executable a `file.exe` node points at.
 *
 * ── Why PowerShell and not spawn ──────────────────────────────────────────────────────────────
 *
 * A process cannot raise its own privileges, and it cannot hand them to a child either. Elevation
 * goes through the Application Information service, which shows the UAC consent dialog and starts
 * the process on your behalf; `Start-Process -Verb RunAs` is how you ask. There is no `spawn`
 * option for "and also be administrator".
 *
 * This is also why SkynetOS stays non-elevated (docs/07): it asks Windows for an elevated CHILD
 * rather than running elevated and inheriting that everywhere. The cost is a UAC prompt on every
 * launch, which CLAUDE.md already warns about and which cannot be avoided by an app that is not
 * itself elevated. The alternative is a board editor running as administrator all day.
 */
export function elevatedProgramArgv(
  exePath: string,
  args: readonly string[],
  cwd: string
): { file: string; args: string[] } {
  /*
   * `-ArgumentList` is omitted entirely when there are none. Passing an empty list makes
   * Start-Process fail with "Cannot validate argument on parameter 'ArgumentList'", and that
   * surfaces as a launch silently not happening — the exact failure mode this codebase has spent
   * more time on than any other.
   */
  const argumentList = args.length
    ? ` -ArgumentList ${args.map((a) => psQuote(a)).join(', ')}`
    : '';
  const command =
    `Start-Process -FilePath ${psQuote(toWindowsPath(exePath))} -Verb RunAs ` +
    `-WorkingDirectory ${psQuote(toWindowsPath(cwd))}${argumentList}`;
  return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', command] };
}

/**
 * Board paths are stored with forward slashes; Windows wants back ones.
 *
 * Spelled this way because the obvious `.replace(/\//g, '\')` literal has been mangled three
 * times by tools that eat backslashes — see the landmine note in handoff.md.
 */
const BACKSLASH = String.fromCharCode(92);
export function toWindowsPath(p: string): string {
  return p.split('/').join(BACKSLASH);
}
