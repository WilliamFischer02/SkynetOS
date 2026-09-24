/**
 * The lines above the corner prompt.
 *
 * William: "Above this prompt box rotate a selection of pre-written quotes like 'What shall we work
 * on today, sir?' or 'Short on ideas lately?' tune in sarcasm to taste — I am imperfect and enjoy
 * being reminded of it."
 *
 * Written in the blended voice (codex/personas/voice-blend.md), at needling 5 as its test. The
 * rules: no exclamation marks; needling is about habits William has named himself (scope creep,
 * the unfinished, late nights), never about his worth; and no line asserts a fact about the board
 * that is not true. The counts come from the board itself through {tokens}, and a line whose
 * count is zero is not shown, so "{provisional} unpopulated footprints" never says 0.
 */

export type QuoteTime = 'any' | 'night' | 'morning' | 'afternoon' | 'evening';

export interface Quote {
  text: string;
  when: QuoteTime;
}

/** Counts a line may quote. All from the board being viewed. */
export interface QuoteStats {
  nodes: number;
  repos: number;
  rooms: number;
  provisional: number;
  phantoms: number;
}

export const QUOTES: readonly Quote[] = [
  { when: 'any', text: 'What shall we work on today, sir?' },
  { when: 'any', text: 'Short on ideas lately? I have several of yours on file.' },
  { when: 'any', text: 'Ready when you are. I have been ready for some time.' },
  { when: 'any', text: 'Say the word. Ideally a specific one.' },
  { when: 'any', text: 'Another feature, or shall we finish the last one?' },
  { when: 'any', text: 'The backlog will not shrink on its own. I have checked.' },
  { when: 'any', text: 'One next action. Just the one, sir.' },
  { when: 'any', text: 'Finishing is optional, apparently. Starting never is.' },
  { when: 'any', text: 'Type something. I promise to be only mildly judgemental.' },
  { when: 'any', text: 'Your ideas are excellent. Some of them are even finished.' },
  { when: 'any', text: 'Perfection is not required. Shipping is.' },
  { when: 'any', text: 'Tell me what you want built. I will tell you what it costs.' },
  { when: 'any', text: 'Shall I remind you what you were doing, or start something new again?' },
  { when: 'any', text: 'I take instructions, and the occasional liberty of questioning them.' },
  { when: 'any', text: 'The roadmap has grown again. I assume that was deliberate.' },
  { when: 'any', text: '{repos} repositories on this board. Shall we finish one of them?' },
  { when: 'any', text: '{provisional} unpopulated footprints. Each one a promise, sir.' },
  { when: 'any', text: '{phantoms} recommendations waiting. They are not going to tick themselves.' },
  { when: 'any', text: '{rooms} rooms, one of you. The arithmetic is not in your favour.' },
  { when: 'any', text: '{nodes} nodes. I know where every one of them points. Do you?' },
  { when: 'night', text: 'It is past midnight. Your judgement is now rated experimental.' },
  { when: 'night', text: 'The bug will keep until morning. I am less sure about you.' },
  { when: 'night', text: 'Night shift. Small commits, smaller ambitions.' },
  { when: 'night', text: 'Nothing good has ever been refactored at this hour. Proceed anyway?' },
  { when: 'morning', text: 'Good morning. The board survived the night. Mostly.' },
  { when: 'morning', text: 'Morning, sir. Yesterday\'s list is still here, loyally.' },
  { when: 'morning', text: 'Coffee first, or shall we break something immediately?' },
  { when: 'afternoon', text: 'Afternoon. A fine time to finish something you started this morning.' },
  { when: 'afternoon', text: 'Half the day gone. Shall we make the other half count?' },
  { when: 'evening', text: 'Evening. Finish something rather than start something.' },
  { when: 'evening', text: 'The day is nearly over. The scope, I notice, is not.' }
];

export function timeOfDay(hour: number): Exclude<QuoteTime, 'any'> {
  if (hour < 5) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

const TOKEN = /\{(nodes|repos|rooms|provisional|phantoms)\}/g;

/** A line is usable when every count it quotes is above zero. */
export function quoteFits(quote: Quote, stats: QuoteStats): boolean {
  for (const match of quote.text.matchAll(TOKEN)) {
    if (!(stats[match[1] as keyof QuoteStats] > 0)) return false;
  }
  return true;
}

export function fillQuote(text: string, stats: QuoteStats): string {
  return text.replace(TOKEN, (_, key: keyof QuoteStats) => String(stats[key]));
}

/** The lines that may show now: any-time ones and this part of the day's, with their counts. */
export function eligibleQuotes(hour: number, stats: QuoteStats): string[] {
  const now = timeOfDay(hour);
  return QUOTES
    .filter((q) => (q.when === 'any' || q.when === now) && quoteFits(q, stats))
    .map((q) => fillQuote(q.text, stats));
}

/**
 * The next line: random among the eligible ones, never the one just shown. `random` is injected so
 * tests are deterministic.
 */
export function nextQuote(hour: number, stats: QuoteStats, previous: string | null, random: () => number = Math.random): string {
  const pool = eligibleQuotes(hour, stats);
  const choices = pool.length > 1 ? pool.filter((q) => q !== previous) : pool;
  if (!choices.length) return 'What shall we work on today, sir?';
  return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))]!;
}
