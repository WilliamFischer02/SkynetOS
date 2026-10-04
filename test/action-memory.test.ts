import { describe, expect, it } from 'vitest';
import {
  ACTION_MEMORY_CAP,
  forgetIn,
  memoryKey,
  parseMemoryFile,
  recallFrom,
  rememberIn,
  type ActionMemoryEntry
} from '../packages/shared/action-memory.js';
import type { DesktopStep } from '../packages/shared/desktop.js';

/*
 * Action memory (docs/11 § Reaching into windows, the board, and a terminal): a planned sentence
 * that ran to completion is reused next time without the model. The key is what makes two
 * sentences the same request, so it is tested hardest.
 */

const PLAN: DesktopStep[] = [{ kind: 'launch', app: 'notepad' }, { kind: 'keys', text: 'hello from jarvis' }];

describe('memoryKey', () => {
  it('ignores case, punctuation, the wake word and courtesy', () => {
    const key = 'open notepad and type hello from jarvis';
    expect(memoryKey('Open Notepad and type hello from jarvis')).toBe(key);
    expect(memoryKey('Jarvis, could you please open notepad and type hello from jarvis?')).toBe(key);
    expect(memoryKey('Hey Jarvis — um, open notepad, and type "hello from jarvis", thanks.')).toBe(key);
    expect(memoryKey('can you open notepad and type hello from jarvis for me please')).toBe(key);
    expect(memoryKey("I'd like you to open notepad and type hello from jarvis")).toBe(key);
  });

  it('keeps what changes the request', () => {
    expect(memoryKey('open after effects on two')).not.toBe(memoryKey('open after effects on one'));
    expect(memoryKey('open notepad')).not.toBe(memoryKey('open wordpad'));
  });

  it('is empty for nothing but courtesy', () => {
    expect(memoryKey('Jarvis, please.')).toBe('');
    expect(memoryKey('')).toBe('');
  });
});

describe('remember, recall, forget', () => {
  const at = (n: number): string => new Date(Date.UTC(2026, 8, 27, 12, 0, n)).toISOString();

  it('recalls a remembered plan by a differently-said sentence', () => {
    const mem = rememberIn([], 'Open notepad and type hello from jarvis', PLAN, ['Firefox', 'notepad', 'firefox'], at(1));
    const hit = recallFrom(mem, 'jarvis, please open notepad and type hello from jarvis!');
    expect(hit?.steps).toEqual(PLAN);
    expect(hit?.successes).toBe(1);
    expect(hit?.windows).toEqual(['firefox', 'notepad']);
    expect(recallFrom(mem, 'open notepad')).toBeNull();
  });

  it('counts a second success on the same entry, keeping the first wording', () => {
    let mem = rememberIn([], 'Open notepad and type hello from jarvis', PLAN, [], at(1));
    mem = rememberIn(mem, 'please open notepad and type hello from jarvis', PLAN, [], at(2));
    expect(mem).toHaveLength(1);
    expect(mem[0]!.successes).toBe(2);
    expect(mem[0]!.sentence).toBe('Open notepad and type hello from jarvis');
    expect(mem[0]!.at).toBe(at(2));
  });

  it('forgets on failure', () => {
    const mem = rememberIn([], 'open notepad and type hi', PLAN, [], at(1));
    expect(forgetIn(mem, 'Open Notepad and type hi.')).toEqual([]);
  });

  it(`keeps at most ${ACTION_MEMORY_CAP}, the least recently run going first`, () => {
    let mem: ActionMemoryEntry[] = [];
    for (let i = 0; i < ACTION_MEMORY_CAP + 5; i++) mem = rememberIn(mem, `open program number ${i}`, PLAN, [], at(i));
    expect(mem).toHaveLength(ACTION_MEMORY_CAP);
    expect(recallFrom(mem, 'open program number 0')).toBeNull();
    expect(recallFrom(mem, 'open program number 4')).toBeNull();
    expect(recallFrom(mem, 'open program number 5')).not.toBeNull();
    expect(recallFrom(mem, `open program number ${ACTION_MEMORY_CAP + 4}`)).not.toBeNull();
  });

  it('remembers nothing for an empty plan or an empty key', () => {
    expect(rememberIn([], 'open notepad', [], [], at(1))).toEqual([]);
    expect(rememberIn([], 'jarvis please', PLAN, [], at(1))).toEqual([]);
  });
});

describe('parseMemoryFile', () => {
  it('keeps entries and drops anything else, never throwing', () => {
    const good = { key: 'open notepad', sentence: 'Open notepad', steps: PLAN, windows: ['notepad', 3], at: 'x', successes: 2 };
    expect(parseMemoryFile({ entries: [good, null, 7, { key: '' }, { key: 'k', steps: [] }, { key: 'k2', steps: 'no' }] })).toEqual([
      { ...good, windows: ['notepad'] }
    ]);
    expect(parseMemoryFile(null)).toEqual([]);
    expect(parseMemoryFile('garbage')).toEqual([]);
    expect(parseMemoryFile({ entries: 'no' })).toEqual([]);
  });
});
