import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pathExists, pathInfo } from '../src/main/services/which.js';

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
