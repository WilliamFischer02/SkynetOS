import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// The hook is plain ESM JavaScript so it can run under whatever node Claude Code finds.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore no types for the .mjs hook
import { PER_FILE_CAP, attachMode, buildContext, buildListing, classify, findPathCandidates, hookOutput, looksLikeText } from '../tools/claude-hooks/drop-attach.mjs';
// @ts-ignore same
import { hookCommandFor, mergeHook } from '../tools/claude-hooks/install.mjs';

/**
 * drop-attach: the Claude Code hook that turns a dropped path into context. William, 2026-09-26:
 * "a drag/drop feature for documents and files and images or other filetypes" in his terminal
 * Claude Code sessions.
 */

let root = '';
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'drop-attach-'));
  mkdirSync(join(root, 'with space'));
  mkdirSync(join(root, 'node_modules', 'x'), { recursive: true });
  mkdirSync(join(root, 'folder'));
  writeFileSync(join(root, 'notes.md'), '# Notes\n\nhello ```fence``` world\n');
  writeFileSync(join(root, 'with space', 'plan.txt'), 'plan\n');
  writeFileSync(join(root, 'big.log'), 'x'.repeat(PER_FILE_CAP + 500));
  writeFileSync(join(root, 'blob.bin'), Buffer.from([0, 1, 2, 3, 255, 254, 0, 0]));
  writeFileSync(join(root, '.env'), 'SECRET=1\n');
  writeFileSync(join(root, 'server.key'), 'not really a key\n');
  writeFileSync(join(root, 'node_modules', 'x', 'index.js'), 'module.exports = 1;\n');
  writeFileSync(join(root, 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(root, 'paper.pdf'), '%PDF-1.4\n');
  writeFileSync(join(root, 'sheet.xlsx'), Buffer.from([0x50, 0x4b, 3, 4]));
  for (let i = 0; i < 3; i++) writeFileSync(join(root, 'folder', `f${i}.txt`), `${i}\n`);
});
afterAll(() => { /* the temp dir is left for the OS: nothing here deletes (docs/07). */ });

describe('finding paths in a prompt', () => {
  it('takes a quoted path with spaces whole, and a bare path up to whitespace', () => {
    const p = `look at "C:\\Users\\w\\with space\\plan.txt" and C:\\dev\\SkynetOS\\README.md please`;
    expect(findPathCandidates(p)).toEqual(['C:\\Users\\w\\with space\\plan.txt', 'C:\\dev\\SkynetOS\\README.md']);
  });

  it('drops the punctuation a sentence hangs on a path', () => {
    expect(findPathCandidates('fix C:\\dev\\a\\b.ts.')).toEqual(['C:\\dev\\a\\b.ts']);
    expect(findPathCandidates('(see C:\\dev\\a\\b.ts)')).toEqual(['C:\\dev\\a\\b.ts']);
    expect(findPathCandidates('is it C:\\dev\\a\\b.ts?')).toEqual(['C:\\dev\\a\\b.ts']);
  });

  it('does not mistake a URL for a path, and dedupes case-insensitively', () => {
    expect(findPathCandidates('read https://example.com/c/x.md')).toEqual([]);
    expect(findPathCandidates('C:\\dev\\x.md and c:\\dev\\X.MD')).toEqual(['C:\\dev\\x.md']);
  });

  it('understands git-bash and home-relative forms', () => {
    expect(findPathCandidates('open /c/dev/SkynetOS/README.md')).toEqual(['C:/dev/SkynetOS/README.md']);
    expect(findPathCandidates('open ~/Documents/x.md', 'C:\\Users\\w')).toEqual([join('C:\\Users\\w', 'Documents/x.md')]);
  });

  it('finds nothing in an ordinary prompt', () => {
    expect(findPathCandidates('what time is it in Bozeman: 5 PM?')).toEqual([]);
  });
});

describe('classifying what was dropped', () => {
  it('names each kind', () => {
    expect(classify(join(root, 'notes.md'))).toBe('text');
    expect(classify(join(root, 'blob.bin'))).toBe('binary');
    expect(classify(join(root, 'shot.png'))).toBe('image');
    expect(classify(join(root, 'paper.pdf'))).toBe('pdf');
    expect(classify(join(root, 'sheet.xlsx'))).toBe('office');
    expect(classify(join(root, 'folder'))).toBe('dir');
    expect(classify(join(root, 'nope.md'))).toBe('missing');
  });

  it('refuses secrets and vendored trees by name before touching the disk', () => {
    expect(classify(join(root, '.env'))).toBe('secret');
    expect(classify(join(root, 'server.key'))).toBe('secret');
    expect(classify(join(root, 'node_modules', 'x', 'index.js'))).toBe('denied');
  });

  it('sniffs text without an extension', () => {
    expect(looksLikeText(Buffer.from('plain words\n'))).toBe(true);
    expect(looksLikeText(Buffer.from([0, 1, 2]))).toBe(false);
  });
});

describe('the context it builds', () => {
  it('is null when no candidate exists, so ordinary prompts stay silent', () => {
    expect(buildContext([join(root, 'nope.md'), 'Q:\\nowhere\\x.txt'])).toBeNull();
  });

  it('inlines text with a fence longer than any run of backticks in the file', () => {
    const ctx = buildContext([join(root, 'notes.md')]) as string;
    expect(ctx.startsWith('[dropped files]')).toBe(true);
    expect(ctx).toContain('````\n# Notes');
    expect(ctx).toContain('hello ```fence``` world');
  });

  it('truncates at the per-file cap and says so', () => {
    const ctx = buildContext([join(root, 'big.log')]) as string;
    expect(ctx).toContain('[truncated at 64.0 KB of');
    expect(ctx.length).toBeLessThan(PER_FILE_CAP + 1024);
  });

  it('stops inlining when the total cap is spent', () => {
    const ctx = buildContext([join(root, 'big.log'), join(root, 'notes.md')], { perFile: 1024, total: 1024 }) as string;
    expect(ctx).toContain('NOT INLINED, the 1.0 KB total cap is spent');
  });

  it('points at Read for images and PDFs, at the office skill for xlsx, and lists a folder', () => {
    const ctx = buildContext([join(root, 'shot.png'), join(root, 'paper.pdf'), join(root, 'sheet.xlsx'), join(root, 'folder')]) as string;
    expect(ctx).toMatch(/shot\.png: an image\. Use the Read tool/);
    expect(ctx).toMatch(/paper\.pdf: a PDF\. Use the Read tool/);
    expect(ctx).toContain('anthropic-skills:xlsx');
    expect(ctx).toMatch(/folder \(folder, 3 entries\):\n {2}f0\.txt/);
  });

  it('names a refused secret without reading it', () => {
    const ctx = buildContext([join(root, '.env')]) as string;
    expect(ctx).toContain('NOT ATTACHED. It looks like a secret');
    expect(ctx).not.toContain('SECRET=1');
  });

  it('wraps the context in the UserPromptSubmit shape', () => {
    expect(hookOutput('x')).toEqual({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'x' } });
  });
});

describe('installing into ~/.claude/settings.json', () => {
  it('adds one entry, keeps every other key, and is idempotent', () => {
    const settings: Record<string, unknown> = { model: 'x', hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo' }] }] } };
    expect(mergeHook(settings, 'node "C:/u/.claude/hooks/drop-attach.mjs"')).toBe(true);
    expect(mergeHook(settings, 'node "C:/u/.claude/hooks/drop-attach.mjs"')).toBe(false);
    const hooks = settings.hooks as { PreToolUse: unknown[]; UserPromptSubmit: { hooks: { command: string; timeout: number }[] }[] };
    expect(hooks.PreToolUse).toHaveLength(1);
    expect(hooks.UserPromptSubmit).toHaveLength(1);
    expect(hooks.UserPromptSubmit[0]!.hooks[0]!.timeout).toBe(10);
    expect(settings.model).toBe('x');
  });

  it('writes the command with forward slashes, quoted', () => {
    expect(hookCommandFor('C:\\Users\\w\\.claude\\hooks\\drop-attach.mjs')).toBe('node "C:/Users/w/.claude/hooks/drop-attach.mjs"');
  });
});

describe('over-trigger guard and trailing separators (coordinator, 2026-09-26)', () => {
  it('trims a trailing backslash or slash and stops a bare path at brackets, commas, quotes and backticks', () => {
    expect(findPathCandidates('hook at C:/Users/w/.claude/hooks/drop-attach.mjs\\ and more')).toEqual(['C:/Users/w/.claude/hooks/drop-attach.mjs']);
    expect(findPathCandidates('see [C:\\dev\\a\\b.ts], (C:\\dev\\c.ts); `C:\\dev\\d.ts` "C:\\dev\\e.ts"')).toEqual(['C:\\dev\\e.ts', 'C:\\dev\\a\\b.ts', 'C:\\dev\\c.ts', 'C:\\dev\\d.ts']);
    expect(findPathCandidates('folder C:\\dev\\SkynetOS\\ done')).toEqual(['C:\\dev\\SkynetOS']);
  });

  it('attaches contents only for a short prompt naming a few paths', () => {
    expect(attachMode(200, 2)).toBe('contents');
    expect(attachMode(1500, 6)).toBe('contents');
    expect(attachMode(1501, 1)).toBe('list');
    expect(attachMode(100, 7)).toBe('list');
    expect(attachMode(100, 21)).toBe('none');
    expect(attachMode(100, 0)).toBe('none');
  });

  it('lists paths with kind and size, no contents, in list mode', () => {
    const ctx = buildListing([join(root, 'notes.md'), join(root, 'nope.md'), join(root, 'folder')]) as string;
    expect(ctx.startsWith('[dropped files]')).toBe(true);
    expect(ctx).toMatch(/notes\.md \(text, \d+ B\)/);
    expect(ctx).toMatch(/folder \(dir\)/);
    expect(ctx).not.toContain('# Notes');
    expect(buildListing([join(root, 'nope.md')])).toBeNull();
  });
});
