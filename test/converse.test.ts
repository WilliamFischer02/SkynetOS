import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONVERSE,
  MAX_REPLY_CHARS,
  conversePrompt,
  converseSystemPrompt,
  fallbackReply,
  pushTurn,
  trimReply,
  type ConverseTurn
} from '../packages/shared/converse.js';

const ctx = { boardName: 'SKYNETOS', desktopEnabled: false, monitors: 3, apps: 299, timeLocal: 'Wednesday 24 September, 23:40' };
const turn = (who: ConverseTurn['who'], text: string, n: number): ConverseTurn => ({ at: `2026-09-24T23:${String(n).padStart(2, '0')}:00.000Z`, who, text });

describe('converseSystemPrompt (the spoken register)', () => {
  it('asks for one or two spoken sentences with no structure and no exclamation marks', () => {
    const p = converseSystemPrompt();
    expect(p).toContain('ONE or TWO short sentences');
    expect(p).toContain('no exclamation marks');
    expect(p).toContain('Never claim to have done');
    expect(p).toMatch(/what you can do/);
  });
});

describe('conversePrompt', () => {
  it('carries the room state and the question', () => {
    const p = conversePrompt([], ctx, 'what time is it');
    expect(p).toContain('Wednesday 24 September, 23:40');
    expect(p).toContain('Desktop control: off. Monitors: 3. Programs the board can open by name: 299.');
    expect(p).toContain('William says: what time is it');
    expect(p).not.toContain('The conversation so far');
  });

  it('carries only the last N turns, oldest first', () => {
    const history = Array.from({ length: 12 }, (_, i) => turn(i % 2 ? 'jarvis' : 'william', `line ${i}`, i));
    const p = conversePrompt(history, ctx, 'and now?', 4);
    expect(p).not.toContain('line 7');
    expect(p).toContain('William: line 8');
    expect(p).toContain('JARVIS: line 11');
    expect(p.indexOf('line 8')).toBeLessThan(p.indexOf('line 11'));
  });
});

describe('trimReply', () => {
  it('keeps the first two sentences and calms exclamation marks', () => {
    expect(trimReply('Good evening! The build is clean. A third sentence here. And a fourth.')).toBe('Good evening. The build is clean.');
  });

  it('strips markdown, code and control characters', () => {
    expect(trimReply('**Yes**, sir.\u0007 See `docs/11`.\n```js\nx\n```')).toBe('Yes, sir. See docs/11.');
    expect(trimReply('- one\n- two')).toBe('one two');
  });

  it('caps the length at a sentence boundary when it can', () => {
    const long = `${'A short clause that goes on, '.repeat(6)}and stops here. ${'More words. '.repeat(20)}`;
    const out = trimReply(long)!;
    expect(out.length).toBeLessThanOrEqual(MAX_REPLY_CHARS);
    expect(out.endsWith('.')).toBe(true);
  });

  it('answers null for nothing usable', () => {
    expect(trimReply('')).toBeNull();
    expect(trimReply('```\n```')).toBeNull();
    expect(trimReply(42)).toBeNull();
  });
});

describe('fallbackReply', () => {
  it('is never empty, names the reason, and ends in what still works', () => {
    for (const reason of ['off', 'timeout', 'missing', 'error'] as const) {
      const line = fallbackReply('play some jazz', reason);
      expect(line.length).toBeGreaterThan(20);
      expect(line).toContain('still hear the usual commands');
      expect(line).not.toContain('!');
    }
    expect(fallbackReply('x', 'missing')).toContain('cannot reach the model');
  });
});

describe('pushTurn', () => {
  it('keeps twice maxTurns turns, dropping the oldest', () => {
    let h: ConverseTurn[] = [];
    for (let i = 0; i < 30; i++) h = pushTurn(h, turn(i % 2 ? 'jarvis' : 'william', `t${i}`, i), 4);
    expect(h).toHaveLength(8);
    expect(h[0]!.text).toBe('t22');
    expect(h[7]!.text).toBe('t29');
  });

  it('defaults match the settings block', () => {
    expect(DEFAULT_CONVERSE.maxTurns).toBe(8);
    expect(DEFAULT_CONVERSE.model).toContain('haiku');
  });
});
