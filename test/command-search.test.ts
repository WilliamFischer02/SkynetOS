import { describe, expect, it } from 'vitest';
import { pushRecent, rankCommands, scoreCommand, type CommandItem } from '../src/renderer/ui/command-search.js';

const items: CommandItem[] = [
  { id: 'n:stalker', label: 'CC-THE-STALKER', detail: 'agent.code · minecraftos', group: 'node' },
  { id: 'n:pacekeeper', label: 'PACEKEEPER', detail: 'store.repo · minecraftos', group: 'node' },
  { id: 'n:jarvis', label: 'JARVIS', detail: 'agent.jarvis · root', group: 'node' },
  { id: 'a:look', label: 'Board look', detail: 'L', group: 'action', keywords: ['colour', 'vignette', 'background'] },
  { id: 'a:settings', label: 'Settings', detail: 'Ctrl+,', group: 'action', keywords: ['preferences', 'options'] },
  { id: 'a:sleep', label: 'Sleep now', detail: 'Shift+Z', group: 'action', keywords: ['away'] },
  { id: 'a:zoom8', label: 'Zoom 8x', detail: '8', group: 'action' }
];

describe('scoreCommand', () => {
  it('ranks exact over prefix over word start over substring over letters in order', () => {
    const exact = scoreCommand('jarvis', items[2]!)!;
    const prefix = scoreCommand('jar', items[2]!)!;
    const wordStart = scoreCommand('stalker', items[0]!)!;
    const substring = scoreCommand('talk', items[0]!)!;
    const inOrder = scoreCommand('ctsr', items[0]!)!;
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(inOrder);
  });

  it('requires every query word to match', () => {
    expect(scoreCommand('stalker minecraftos', items[0]!)).not.toBeNull();
    expect(scoreCommand('stalker gameos', items[0]!)).toBeNull();
  });

  it('finds an action by its keywords', () => {
    expect(scoreCommand('vignette', items[3]!)).not.toBeNull();
    expect(scoreCommand('away', items[5]!)).not.toBeNull();
  });
});

describe('rankCommands', () => {
  it('puts the best match first', () => {
    expect(rankCommands('pace', items)[0]!.id).toBe('n:pacekeeper');
    expect(rankCommands('settings', items)[0]!.id).toBe('a:settings');
  });

  it('with no query shows recent things, then actions, then nodes', () => {
    const list = rankCommands('', items, ['n:jarvis']);
    expect(list[0]!.id).toBe('n:jarvis');
    expect(list[0]!.recent).toBe(true);
    expect(list[1]!.group).toBe('action');
    expect(list[list.length - 1]!.group).toBe('node');
  });

  it('nudges recent items up without letting a weak match beat a strong one', () => {
    const recentWeak = rankCommands('look', items, ['n:jarvis']);
    expect(recentWeak[0]!.id).toBe('a:look');
    const tie = rankCommands('s', items, ['a:sleep']);
    expect(tie[0]!.id).toBe('a:sleep');
  });

  it('drops what does not match', () => {
    expect(rankCommands('zzzz', items)).toEqual([]);
  });
});

describe('pushRecent', () => {
  it('keeps the most recent first, without duplicates, capped', () => {
    expect(pushRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    expect(pushRecent(['a', 'b'], 'x', 2)).toEqual(['x', 'a']);
  });
});
