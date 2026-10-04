import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearWhichCache, hasExecutable, which } from '../src/main/services/which.js';

/**
 * `which()` is how SkynetOS decides whether Windows Terminal, pwsh, claude and tailscale are
 * installed (services/which.ts: the "clicking the chip does nothing" bug). It had no test of its
 * own, and `clearWhichCache` said "for tests" with no test using it (docs/06 "Known issues" 18).
 * These run against real directories on a PATH this file sets and puts back.
 */

describe('which', () => {
  let fixture = '';
  let first = '';
  let second = '';
  const saved = { PATH: process.env['PATH'], Path: process.env['Path'] };
  const setPath = (...dirs: string[]): void => {
    delete process.env['Path'];
    process.env['PATH'] = dirs.join(delimiter);
  };

  beforeAll(() => {
    fixture = mkdtempSync(join(tmpdir(), 'skynet-which-'));
    first = join(fixture, 'first');
    second = join(fixture, 'second');
    mkdirSync(first);
    mkdirSync(second);
    writeFileSync(join(first, 'Tool.EXE'), '');
    writeFileSync(join(second, 'tool.exe'), '');
    writeFileSync(join(second, 'other.exe'), '');
  });
  afterAll(() => {
    // Only this test's own temp folder, made above.
    if (fixture) rmSync(fixture, { recursive: true, force: true });
  });
  beforeEach(() => { clearWhichCache(); });
  afterEach(() => {
    for (const key of ['PATH', 'Path'] as const) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    clearWhichCache();
  });

  it('finds a name whatever its case, and answers with the name as it is on disk', () => {
    setPath(first);
    expect(which('tool.exe')).toBe(join(first, 'Tool.EXE'));
    expect(which('TOOL.exe')).toBe(join(first, 'Tool.EXE'));
    expect(hasExecutable('tool.exe')).toBe(true);
  });

  it('takes the first PATH directory that has it', () => {
    setPath(second, first);
    expect(which('tool.exe')).toBe(join(second, 'tool.exe'));
  });

  it('skips a PATH entry that cannot be read and keeps looking', () => {
    setPath(join(fixture, 'unplugged-drive'), '', second);
    expect(which('other.exe')).toBe(join(second, 'other.exe'));
  });

  it('reads a quoted PATH entry', () => {
    setPath(`"${second}"`);
    expect(which('other.exe')).toBe(join(second, 'other.exe'));
  });

  it('answers null for a name that is nowhere on PATH', () => {
    setPath(first, second);
    expect(which('not-installed.exe')).toBeNull();
    expect(hasExecutable('not-installed.exe')).toBe(false);
  });

  it('remembers an answer until the cache is cleared, a miss included', () => {
    setPath(first);
    expect(which('other.exe')).toBeNull();
    // PATH changes under the running process: the remembered miss stands...
    setPath(first, second);
    expect(which('other.exe')).toBeNull();
    // ...until someone says the PATH changed.
    clearWhichCache();
    expect(which('other.exe')).toBe(join(second, 'other.exe'));
  });
});
