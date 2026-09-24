import { describe, expect, it } from 'vitest';
import { QUOTES, eligibleQuotes, fillQuote, nextQuote, quoteFits, timeOfDay, type QuoteStats } from '../packages/shared/quotes.js';

const stats: QuoteStats = { nodes: 80, repos: 12, rooms: 4, provisional: 9, phantoms: 4 };
const none: QuoteStats = { nodes: 0, repos: 0, rooms: 0, provisional: 0, phantoms: 0 };

describe('quotes', () => {
  it('keeps the voice: no exclamation marks, no emoji', () => {
    for (const q of QUOTES) {
      expect(q.text).not.toMatch(/!/);
      expect(q.text).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('includes the two lines William asked for', () => {
    const texts = QUOTES.map((q) => q.text);
    expect(texts).toContain('What shall we work on today, sir?');
    expect(texts.some((t) => t.startsWith('Short on ideas lately?'))).toBe(true);
  });

  it('buckets the day', () => {
    expect(timeOfDay(2)).toBe('night');
    expect(timeOfDay(8)).toBe('morning');
    expect(timeOfDay(14)).toBe('afternoon');
    expect(timeOfDay(21)).toBe('evening');
  });

  it('fills counts from the board', () => {
    expect(fillQuote('{repos} repos and {phantoms} ideas', stats)).toBe('12 repos and 4 ideas');
  });

  it('never shows a count of zero', () => {
    const counted = QUOTES.find((q) => q.text.includes('{provisional}'))!;
    expect(quoteFits(counted, none)).toBe(false);
    expect(eligibleQuotes(10, none).some((t) => /\b0\b/.test(t))).toBe(false);
    expect(eligibleQuotes(10, none).some((t) => t.includes('{'))).toBe(false);
  });

  it('keeps night lines to the night', () => {
    const night = QUOTES.find((q) => q.when === 'night')!.text;
    expect(eligibleQuotes(2, stats)).toContain(night);
    expect(eligibleQuotes(14, stats)).not.toContain(night);
  });

  it('never repeats the line just shown', () => {
    const first = nextQuote(10, stats, null, () => 0);
    for (let i = 0; i < 20; i++) expect(nextQuote(10, stats, first, () => i / 20)).not.toBe(first);
  });
});
