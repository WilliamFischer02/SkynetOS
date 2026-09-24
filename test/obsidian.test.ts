import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BoardNode } from '../packages/shared/types.js';
import {
  buildJournalNote,
  chooseTags,
  decisionsOn,
  extractTags,
  formatObsidianDate,
  isObsidianAware,
  journalFileName,
  nextFromHandoff,
  normaliseTag,
  projectNameOf,
  tagStyleOf,
  vaultRootOf,
  wordsOf,
  type JournalInput
} from '../packages/shared/obsidian.js';
import { primaryTargetField } from '../packages/shared/node-fields.js';
import { findVaultRoot, readDailyNotesConfig, scanVault, templateKeysOf } from '../src/main/services/obsidian.js';

describe('vaultRootOf', () => {
  const vaults = new Set(['C:/Users/w/Vault']);
  const has = (dir: string): boolean => vaults.has(dir);

  it('finds the vault at or above a path, with either slash', () => {
    expect(vaultRootOf('C:/Users/w/Vault', has)).toBe('C:/Users/w/Vault');
    expect(vaultRootOf('C:\\Users\\w\\Vault\\01 Personal\\note.md', has)).toBe('C:/Users/w/Vault');
  });

  it('returns null outside any vault, and stops at the drive root', () => {
    expect(vaultRootOf('C:/dev/SkynetOS', has)).toBeNull();
    expect(vaultRootOf('C:/', has)).toBeNull();
    expect(vaultRootOf('', has)).toBeNull();
  });
});

describe('isObsidianAware', () => {
  const node = (over: Partial<BoardNode>): BoardNode => ({ id: 'n', kind: 'agent.code', name: 'N', pos: { x: 0, y: 0 }, ...over }) as BoardNode;

  it('is aware by tag, in any case', () => {
    expect(isObsidianAware(node({ tags: ['Obsidian'] }), () => false)).toBe(true);
  });
  it('is aware when any bound path is inside a vault', () => {
    expect(isObsidianAware(node({ cwd: 'C:/dev', addDirs: ['C:/v'] }), (p) => p === 'C:/v')).toBe(true);
  });
  it('is not aware otherwise', () => {
    expect(isObsidianAware(node({ cwd: 'C:/dev' }), () => false)).toBe(false);
  });
});

describe('tags', () => {
  it('normalises to what Obsidian accepts', () => {
    expect(normaliseTag('#Writing')).toBe('Writing');
    expect(normaliseTag('project//skynet/')).toBe('project/skynet');
    expect(normaliseTag('1984')).toBeNull();
    expect(normaliseTag('y1984')).toBe('y1984');
    expect(normaliseTag('"Life Goals"')).toBe('LifeGoals');
  });

  it('reads frontmatter lists, inline arrays and body tags, and skips code and headings', () => {
    const md = [
      '---',
      'aliases:',
      'tags:',
      '  - Feelings',
      '  - "Career"',
      'URL:',
      '---',
      '# Heading is not a tag',
      'Some #Writing here, and #project/skynet too.',
      '```',
      '#include <nope>',
      '```',
      'Inline `#nope` code.'
    ].join('\n');
    expect(extractTags(md)).toEqual(['Feelings', 'Career', 'Writing', 'project/skynet']);
    expect(extractTags('---\ntags: [a, "b c"]\n---\n')).toEqual(['a', 'bc']);
  });

  it('reads the vault\'s style', () => {
    expect(tagStyleOf(['Writing', 'LifeGoals', 'Career'])).toEqual({ case: 'camel', nested: false });
    expect(tagStyleOf(['project/dirty-plush', 'journal/daily', 'mood'])).toMatchObject({ case: 'kebab', nested: true });
    expect(tagStyleOf([])).toEqual({ case: 'camel', nested: false });
  });

  it('splits names into words', () => {
    expect(wordsOf('DirtyPlush')).toEqual(['Dirty', 'Plush']);
    expect(wordsOf('the-stalker')).toEqual(['the', 'stalker']);
    expect(wordsOf('SkynetOS')).toEqual(['Skynet', 'OS']);
  });

  it('prefers the vault\'s existing spelling, and styles new ones the vault\'s way', () => {
    const camel = chooseTags([{ phrase: 'writing' }, { phrase: 'Dirty Plush', group: 'project' }], ['Writing', 'Career']);
    expect(camel).toEqual(['Writing', 'DirtyPlush']);
    const nested = chooseTags([{ phrase: 'Dirty Plush', group: 'project' }], ['project/the-stalker', 'journal/daily', 'mood']);
    expect(nested).toEqual(['project/dirty-plush']);
    // Matching an existing leaf reuses the whole nested tag.
    expect(chooseTags([{ phrase: 'The Stalker', group: 'project' }], ['project/the-stalker'])).toEqual(['project/the-stalker']);
  });
});

describe('dates', () => {
  it('formats the daily-notes subset of moment.js', () => {
    const d = { y: 2026, m: 9, d: 11 };
    expect(formatObsidianDate(d)).toBe('2026-09-11');
    expect(formatObsidianDate(d, 'dddd D MMMM YYYY')).toBe('Friday 11 September 2026');
    expect(formatObsidianDate(d, 'MM-DD-YYYY')).toBe('09-11-2026');
    expect(formatObsidianDate(d, '[Journal] YYYY/MMM Do')).toBe('Journal 2026/Sep 11th');
    expect(formatObsidianDate({ y: 2026, m: 1, d: 1 }, 'Do')).toBe('1st');
    expect(formatObsidianDate({ y: 2026, m: 1, d: 22 }, 'Do')).toBe('22nd');
    expect(formatObsidianDate({ y: 2026, m: 1, d: 13 }, 'Do')).toBe('13th');
  });
});

describe('journal note', () => {
  const input = (over: Partial<JournalInput> = {}): JournalInput => ({
    date: { y: 2026, m: 9, d: 11 },
    created: '2026-09-11T22:04:00',
    folder: '01 Personal/-a- JOURNAL/SkynetOS',
    format: null,
    projects: [
      { name: 'SkynetOS', tokens: 800_000, messages: 200, note: null },
      { name: 'DirtyPlush', tokens: 1_200_000, messages: 90, note: 'DirtyPlush' },
      { name: 'C:/dev', tokens: 10_000, messages: 3, note: null }
    ],
    sessions: [{ at: '09:12', label: 'U3 JARVIS-PRIME', room: 'SKYNETOS' }],
    rooms: ['SKYNETOS'],
    decisions: ['Copy and paste nodes'],
    next: ['Restart SkynetOS'],
    vocabulary: ['Writing', 'Career', 'SkynetOS'],
    templateKeys: ['aliases', 'tags', 'URL'],
    exists: () => false,
    ...over
  });

  it('lands in the folder under the day\'s name', () => {
    const note = buildJournalNote(input());
    expect(note.relPath).toBe('01 Personal/-a- JOURNAL/SkynetOS/2026-09-11.md');
  });

  it('never overwrites: an existing day note gets a SkynetOS-marked sibling', () => {
    const taken = new Set(['J/2026-09-11.md']);
    expect(journalFileName('J', '2026-09-11', (p) => taken.has(p))).toBe('2026-09-11 (SkynetOS).md');
    taken.add('J/2026-09-11 (SkynetOS).md');
    expect(journalFileName('J', '2026-09-11', (p) => taken.has(p))).toBe('2026-09-11 (SkynetOS 2).md');
  });

  it('writes typed properties Obsidian reads, and the vault template\'s own keys', () => {
    const { content } = buildJournalNote(input());
    const fm = content.split('\n---\n')[0]!;
    expect(fm).toMatch(/^---\naliases:\n {2}- SkynetOS journal 2026-09-11\ntags:\n/);
    expect(fm).toContain('\nURL:');
    expect(fm).toContain('\ndate: 2026-09-11');
    expect(fm).toContain('\ncreated: 2026-09-11T22:04:00');
    expect(fm).toContain('\ntype: journal');
    expect(fm).toContain('\nsource: skynetos');
    expect(fm).toContain('\nsessions: 1');
    expect(fm).toContain('\ntokens: 2010000');
    // A value YAML would misread is quoted.
    expect(fm).toContain('  - "C:/dev"');
    expect(fm.match(/^aliases:/gm)).toHaveLength(1);
    expect(fm.match(/^tags:/gm)).toHaveLength(1);
  });

  it('tags from the vault first, then new ones in its style, busiest project first', () => {
    const { tags } = buildJournalNote(input());
    // SkynetOS is the vault's own tag; Journal and DirtyPlush are new, in its CamelCase; the dev
    // root is a path, not a topic, so it mints nothing.
    expect(tags).toEqual(['SkynetOS', 'Journal', 'DirtyPlush']);
  });

  it('links only to notes that exist', () => {
    const { content } = buildJournalNote(input());
    expect(content).toContain('**[[DirtyPlush]]**');
    expect(content).not.toContain('[[SkynetOS]]');
    expect(content).toContain('- [ ] Restart SkynetOS');
    expect(content).toContain('- Copy and paste nodes');
  });

  it('says so plainly on an empty day', () => {
    const { content } = buildJournalNote(input({ projects: [], sessions: [], decisions: [], next: [] }));
    expect(content).toContain('no Claude work recorded on this machine today');
    expect(content).toContain('projects: []');
  });
});

describe('journal sources', () => {
  it('finds today\'s decisions', () => {
    const md = '## 2026-09-10 — Old\n\n## 2026-09-11 — Copy and paste nodes\n## 2026-09-11 — Summon JARVIS\n';
    expect(decisionsOn(md, '2026-09-11')).toEqual(['Copy and paste nodes', 'Summon JARVIS']);
  });

  it('reads the handoff\'s numbered next items', () => {
    const md = '# h\n## What is next\n\n1. **Restart SkynetOS.** body\n   - sub\n2. **A board selector** — x\n\n## Other\n3. **Not this**';
    expect(nextFromHandoff(md)).toEqual(['Restart SkynetOS', 'A board selector']);
  });

  it('names projects by folder, and says what a root is', () => {
    expect(projectNameOf('C:\\dev\\DirtyPlush')).toBe('DirtyPlush');
    expect(projectNameOf('C:\\dev')).toBe('C:/dev');
  });
});

describe('the journal node\'s target', () => {
  it('is the vault when set, and nothing when not, so a plain cron task never reads as broken', () => {
    const task = { id: 't', kind: 'task.scheduled', name: 'T', pos: { x: 0, y: 0 }, schedule: '0 22 * * *', action: {} } as BoardNode;
    expect(primaryTargetField('task.scheduled', task)).toBeUndefined();
    expect(primaryTargetField('task.scheduled', { ...task, journalVault: 'C:/v' })?.key).toBe('journalVault');
  });
});

describe('vaults on disk', () => {
  const root = mkdtempSync(join(tmpdir(), 'skynet-vault-'));
  const vault = join(root, 'My Vault');
  mkdirSync(join(vault, '.obsidian'), { recursive: true });
  mkdirSync(join(vault, 'Notes', 'Deep'), { recursive: true });
  mkdirSync(join(vault, '04 Templates'), { recursive: true });
  mkdirSync(join(vault, '.trash'), { recursive: true });
  writeFileSync(join(vault, '.obsidian', 'daily-notes.json'), JSON.stringify({ folder: '01 Personal/Journal/', format: 'YYYY-MM-DD', template: '04 Templates/Daily' }));
  writeFileSync(join(vault, '04 Templates', 'Daily.md'), '---\naliases:\ntags:\nURL:\n---\n');
  writeFileSync(join(vault, 'Notes', 'DirtyPlush.md'), '---\ntags:\n  - Writing\n---\n#Writing and #Career');
  writeFileSync(join(vault, 'Notes', 'Deep', 'Other.md'), 'Just #Writing');
  writeFileSync(join(vault, '.trash', 'Gone.md'), '#Trashed');

  it('finds the vault from a path inside it', () => {
    expect(findVaultRoot(join(vault, 'Notes', 'Deep'))).toBe(vault.replace(/\\/g, '/'));
    expect(findVaultRoot(root)).toBeNull();
  });

  it('reads the vault\'s daily-notes settings and template keys', () => {
    expect(readDailyNotesConfig(vault)).toEqual({ folder: '01 Personal/Journal', format: 'YYYY-MM-DD', template: '04 Templates/Daily' });
    expect(templateKeysOf(vault, '04 Templates/Daily')).toEqual(['aliases', 'tags', 'URL']);
    expect(readDailyNotesConfig(root)).toEqual({ folder: '', format: null, template: null });
  });

  it('scans tags most-used first, and note names, skipping the trash', () => {
    const scan = scanVault(vault, 1);
    expect(scan.tags[0]).toBe('Writing');
    expect(scan.tags).toContain('Career');
    expect(scan.tags).not.toContain('Trashed');
    expect(scan.notes.sort()).toEqual(['Daily', 'DirtyPlush', 'Other']);
    expect(scanVault(vault, 2)).toBe(scan);
  });
});
