import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pathExists, pathInfo } from '../src/main/services/which.js';
import { isBroken, needsConfirmation, type TargetInfo } from '../packages/shared/targets.js';

/**
 * Windows App Execution Aliases, and why `existsSync` must never be asked about one.
 *
 * ── The bug ──────────────────────────────────────────────────────────────────────────────────
 *
 * `%LOCALAPPDATA%/Microsoft/WindowsApps` holds a stub for every Store app — Notepad, Paint,
 * Terminal, PowerShell, Python. They are zero-length reparse points tagged APPEXECLINK: the
 * process loader follows them, and nothing else can. Measured:
 *
 *     existsSync        false     <- stat under the covers
 *     statSync          THROWS EACCES
 *     lstatSync         ok, size 93, isSymbolicLink
 *     accessSync(X_OK)  ok
 *     readdirSync       lists it
 *
 * So `services/target-resolver.ts`, which asked `existsSync`, reported every Store app as
 * TARGET NOT FOUND and drew a broken footprint for a program that launches perfectly. That reads
 * exactly like a permissions problem — which is how it costs someone an afternoon granting
 * themselves Full Control over `C:\\Program Files\\WindowsApps`, a change that fixes nothing
 * (nothing is being denied) and can break Store app servicing.
 *
 * `which.ts` already hit the same rock once, from the other direction: "is Windows Terminal
 * installed" was answered with `existsSync` and came back false on a machine where it was.
 */

const ALIAS_DIR = join(process.env['LOCALAPPDATA'] ?? '', 'Microsoft', 'WindowsApps');
const onWindows = process.platform === 'win32';

/** An alias that exists on this machine, or null. Never assume a specific app is installed. */
function findAlias(): string | null {
  if (!onWindows) return null;
  for (const name of ['wt.exe', 'winget.exe', 'notepad.exe', 'python.exe', 'MicrosoftEdge.exe']) {
    const full = join(ALIAS_DIR, name);
    // The signature of an unfollowable reparse point: stat fails where lstat succeeds.
    try { require('node:fs').statSync(full); continue; } catch { /* keep looking below */ }
    try { require('node:fs').lstatSync(full); return full; } catch { /* not this one */ }
  }
  return null;
}

let dir = '';
let realFile = '';
let realDir = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'skynet-alias-'));
  realFile = join(dir, 'ordinary.txt');
  realDir = join(dir, 'ordinary-dir');
  writeFileSync(realFile, 'hello', 'utf8');
  require('node:fs').mkdirSync(realDir);
});

afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe('pathExists and pathInfo on ordinary things', () => {
  it('sees a real file', () => {
    expect(pathExists(realFile)).toBe(true);
    expect(pathInfo(realFile)).toMatchObject({ kind: 'file', sizeBytes: 5 });
    // An ordinary file is NOT flagged as an alias — the flag has to mean something.
    expect(pathInfo(realFile)?.alias).toBeUndefined();
  });

  it('sees a real directory', () => {
    expect(pathExists(realDir)).toBe(true);
    expect(pathInfo(realDir)?.kind).toBe('directory');
  });

  it('reports nothing for a path that is not there', () => {
    const gone = join(dir, 'no-such-thing');
    expect(pathExists(gone)).toBe(false);
    expect(pathInfo(gone)).toBeNull();
  });
});

/**
 * These need a real alias, so they are skipped off Windows and on a machine that happens to have
 * none. Skipped rather than faked: the whole point is the behaviour of a real reparse point, and a
 * stand-in would test the stand-in.
 */
describe.runIf(onWindows && findAlias() !== null)('an App Execution Alias', () => {
  const alias = findAlias()!;

  it('is exactly the case existsSync gets wrong', () => {
    // The premise. If this ever stops being true, the rest of this file is measuring nothing —
    // and the fix in target-resolver.ts could be reverted without a single test noticing.
    expect(existsSync(alias), `${alias} is no longer an unfollowable reparse point`).toBe(false);
  });

  it('is found by pathExists anyway', () => {
    expect(pathExists(alias), 'a Store app still resolves as missing').toBe(true);
  });

  it('is reported as a launchable file, flagged as an alias', () => {
    const info = pathInfo(alias);
    expect(info).not.toBeNull();
    expect(info!.kind).toBe('file');
    expect(info!.alias).toBe(true);
  });

  it('reports no size, rather than the size of the reparse buffer', () => {
    // 93 bytes is not the size of Notepad. Showing it beside a Launch button is a confident lie.
    expect(pathInfo(alias)!.sizeBytes).toBe(0);
  });
});

/**
 * ── "Broken" means it does not resolve ───────────────────────────────────────────────────────
 *
 * Reported: "I need to be able to link any exe anywhere on my drive... so the program CAN show
 * representations of any exe I can launch from within the program."
 *
 * It could launch them all along. `outside-dev-root` was lumped in with the states that mean "this
 * target does not exist", so a node pointing at `C:/Program Files/…/WINWORD.EXE` drew the
 * broken-hardware overlay, went fault-red on the minimap and marked its own input field bad — for
 * a program that runs perfectly. Every BEHAVIOURAL call site wrote the exception out by hand
 * (`isBroken(t) && t.state !== 'outside-dev-root'`, four times, four files); the three RENDERING
 * sites did not. One rule written down twice, again.
 */
describe('outside a dev root is a policy, not a fault', () => {
  const at = (state: TargetInfo['state']): TargetInfo =>
    ({ state, raw: 'C:/Program Files/Thing/thing.exe', resolved: 'C:/Program Files/Thing/thing.exe', detail: null });

  it('does not call a resolvable target broken', () => {
    expect(isBroken(at('outside-dev-root'))).toBe(false);
  });

  it('still calls a genuinely unresolvable target broken', () => {
    for (const state of ['missing', 'invalid', 'unknown'] as const) {
      expect(isBroken(at(state)), `${state} should still render as broken`).toBe(true);
    }
  });

  it('leaves the happy states alone', () => {
    expect(isBroken(at('ok'))).toBe(false);
    expect(isBroken(at('none'))).toBe(false);
  });

  it('asks for confirmation exactly where docs/07 requires it', () => {
    expect(needsConfirmation(at('outside-dev-root'))).toBe(true);
    for (const state of ['ok', 'none', 'missing', 'invalid', 'unknown'] as const) {
      expect(needsConfirmation(at(state)), `${state} must not prompt`).toBe(false);
    }
  });
});

/**
 * ── CreateProcess cannot run a shortcut ──────────────────────────────────────────────────────
 *
 * Reported: "exe nodes show a message but don't launch a game."
 *
 * The node pointed at `assets/Shortcuts/minecraft.lnk`, and `file.exe` launched with `spawn`.
 * Measured on this machine:
 *
 *     spawn("thing.lnk")  ->  EFTYPE
 *     spawn("thing.bat")  ->  EINVAL
 *
 * A `.lnk` is a shell object, not an executable image. The node editor's own file filter offers
 * `exe, bat, cmd, ps1`, so three of the four types it invites you to choose could never have
 * launched — the dialog appeared, the user said yes, and nothing happened.
 *
 * There was a second reason too, which is why resolving the shortcut ourselves would not have been
 * enough: that shortcut's target is inside `C:/Program Files/WindowsApps/Microsoft.4297127D64EC6_…/`,
 * an MSIX payload that needs package identity to run. Only the shell can give it that.
 */
describe('a program is launched by a mechanism that can actually run it', () => {
  const opener = readFileSync(join(process.cwd(), 'src/main/services/shell-opener.ts'), 'utf8');

  it('only spawns real executable images', () => {
    const list = /const SPAWNABLE = \[([^\]]*)\]/.exec(opener)?.[1] ?? '';
    expect(list).toContain('.exe');
    // Any of these in the spawn list is the bug: CreateProcess refuses all of them.
    for (const cannot of ['.lnk', '.bat', '.cmd', '.ps1', '.msi']) {
      expect(list, `${cannot} cannot be spawned — it has to go through the shell`).not.toContain(cannot);
    }
  });

  it('sends everything else through the shell', () => {
    expect(opener, 'non-executables must go through ShellExecute').toContain('shell.openPath');
  });

  it('falls back to the shell when spawn refuses', () => {
    // An .exe CreateProcess rejects may still be something Explorer knows how to open, and a
    // silent failure here is indistinguishable from the bug that was just fixed.
    expect(opener).toMatch(/spawn refused/);
  });
});

/**
 * ── Who may skip a confirmation ──────────────────────────────────────────────────────────────
 *
 * William: "I want to remove the confirmation messages as much as possible too." `confirmBeforeLaunch:
 * false` now means it — but only for a human.
 *
 * Board JSON is agent-writable (`command:apply` is in AGENT_METHODS) and so is activation
 * (`node:open`). If the flag applied to everyone, an agent could point a node at anything, clear
 * the flag, activate it, and run an arbitrary program with nothing on screen.
 */
describe('a node can silence its own prompt only for the user', () => {
  const opener = readFileSync(join(process.cwd(), 'src/main/services/shell-opener.ts'), 'utf8');
  const ipc = readFileSync(join(process.cwd(), 'src/main/ipc.ts'), 'utf8');

  it('refuses to trust an agent-initiated activation', () => {
    const fn = opener.slice(opener.indexOf('function trustedByUser'), opener.indexOf('const SPAWNABLE'));
    expect(fn).toContain("by !== 'user'");
  });

  it('lets settings.json override the node in the other direction', () => {
    // settings.json has no write channel, so this is the one lever an agent cannot touch.
    const fn = opener.slice(opener.indexOf('function trustedByUser'), opener.indexOf('const SPAWNABLE'));
    expect(fn).toContain('confirmAllLaunches');
  });

  it('always confirms elevation, whatever the node says', () => {
    // "Run this" and "run this as administrator" are different questions.
    expect(opener).toMatch(/elevated \|\| !trustedByUser/);
  });

  it('activates as the user from the renderer and as an agent over the control channel', () => {
    expect(ipc).toContain("openNode(boardId, nodeId, 'user')");
    expect(ipc).toContain("openNode(boardId, nodeId, 'agent')");
  });
});
