import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * 2026-09-26 (fork J): vite's import lexer misreads a literal backtick inside a regex character
 * class as the start of a template literal, so tools/claude-hooks/drop-attach.mjs loaded under
 * Node and failed under vitest with "Invalid or unexpected token" on an unrelated line. Every
 * backtick in the hook's regexes is written as \x60. This holds it there, because the fault only
 * shows up in a test run and points at the wrong line when it does.
 */
describe('drop-attach.mjs stays loadable under vitest', () => {
  it('writes no literal backtick inside a regex character class', () => {
    const source = readFileSync(join(process.cwd(), 'tools', 'claude-hooks', 'drop-attach.mjs'), 'utf8');
    const classWithBacktick = /\/[^\n/]*\[[^\]\n]*`[^\]\n]*\][^\n/]*\//;
    expect(source).not.toMatch(classWithBacktick);
  });

  it('is importable by the test runner at all', async () => {
    // @ts-expect-error untyped .mjs: it is loaded only to prove vite's lexer accepts it
    const mod = await import('../tools/claude-hooks/drop-attach.mjs');
    expect(typeof mod).toBe('object');
  });
});
