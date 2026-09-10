import { describe, expect, it } from 'vitest';
import {
  CACHE_READ_WEIGHT,
  ZERO_TOKENS,
  addTokens,
  formatDuration,
  formatTokens,
  projectDirFor,
  readout,
  shares,
  totalTokens,
  weightedTokens,
  type TokenCounts,
  type UsageSummary
} from '../packages/shared/usage.js';

/**
 * The usage maths.
 *
 * The load-bearing rule under test is the honesty one: SkynetOS cannot read a subscription
 * allowance off this disk, so with no budget configured it must return `null` rather than a
 * plausible number. A meter that invents a remaining pool is worse than one that admits it does
 * not know — CLAUDE.md prime directive 1.
 */

const tokens = (over: Partial<TokenCounts> = {}): TokenCounts => ({ ...ZERO_TOKENS, ...over });

const summary = (over: Partial<UsageSummary> = {}): UsageSummary => ({
  windowHours: 5,
  takenAt: Date.now(),
  projects: [],
  window: ZERO_TOKENS,
  allTime: ZERO_TOKENS,
  budgetTokens: null,
  ...over
});

describe('token weighting', () => {
  it('counts cache reads at a tenth', () => {
    /*
     * Not a nicety. This machine's SkynetOS project has 445M cache-read tokens against 1.6M
     * output; counted at par, every figure on the meter becomes a cache-read figure wearing a
     * usage label, and the couriers would walk in proportion to conversation LENGTH rather than
     * to work done.
     */
    expect(CACHE_READ_WEIGHT).toBe(0.1);
    expect(weightedTokens(tokens({ cacheRead: 1000 }))).toBe(100);
    expect(totalTokens(tokens({ cacheRead: 1000 }))).toBe(1000);
  });

  it('counts input, output and cache writes at par', () => {
    expect(weightedTokens(tokens({ input: 10, output: 20, cacheWrite: 30 }))).toBe(60);
  });

  it('adds category by category', () => {
    const sum = addTokens(tokens({ input: 1, cacheRead: 5 }), tokens({ output: 2, cacheRead: 5 }));
    expect(sum).toEqual({ input: 1, output: 2, cacheRead: 10, cacheWrite: 0 });
  });
});

describe('readout — the three numbers on the meter', () => {
  it('reports a real rate with no budget configured', () => {
    // The rate needs no allowance to be true, so it is always shown.
    const result = readout(summary({ window: tokens({ output: 50_000 }), windowHours: 5 }));
    expect(result.ratePerHour).toBe(10_000);
    expect(result.usedTokens).toBe(50_000);
  });

  it('refuses to guess the remaining pool', () => {
    const result = readout(summary({ window: tokens({ output: 50_000 }) }));
    expect(result.remainingTokens).toBeNull();
    expect(result.remainingHours).toBeNull();
  });

  it('treats a zero or negative budget as no budget', () => {
    expect(readout(summary({ budgetTokens: 0 })).remainingTokens).toBeNull();
    expect(readout(summary({ budgetTokens: -5 })).remainingTokens).toBeNull();
  });

  it('subtracts the window from a configured budget', () => {
    const result = readout(summary({ window: tokens({ output: 40_000 }), budgetTokens: 100_000 }));
    expect(result.remainingTokens).toBe(60_000);
  });

  it('never reports a negative pool', () => {
    // Over budget is a real state and it is shown as empty, not as a negative number.
    const result = readout(summary({ window: tokens({ output: 250_000 }), budgetTokens: 100_000 }));
    expect(result.remainingTokens).toBe(0);
  });

  it('divides the pool by the rate to get the time left', () => {
    // 100k budget, 40k used over 5h = 8k/h, 60k left -> 7.5h.
    const result = readout(summary({ window: tokens({ output: 40_000 }), budgetTokens: 100_000, windowHours: 5 }));
    expect(result.ratePerHour).toBe(8_000);
    expect(result.remainingHours).toBeCloseTo(7.5, 5);
  });

  it('reports no time left rather than infinity when nothing is running', () => {
    const result = readout(summary({ budgetTokens: 100_000 }));
    expect(result.ratePerHour).toBe(0);
    expect(result.remainingHours).toBeNull();
  });

  it('does not divide by zero on a zero-length window', () => {
    const result = readout(summary({ window: tokens({ output: 100 }), windowHours: 0 }));
    expect(Number.isFinite(result.ratePerHour)).toBe(true);
  });
});

describe('shares — what the couriers walk in proportion to', () => {
  const withProjects = (entries: [string, number][]) =>
    summary({
      projects: entries.map(([projectDir, out]) => ({
        projectDir,
        cwd: projectDir,
        allTime: tokens({ output: out }),
        window: tokens({ output: out }),
        costUSD: null,
        lastActivity: null,
        messagesInWindow: 1
      }))
    });

  it('splits activity in proportion to weighted tokens', () => {
    const result = shares(withProjects([['a', 750], ['b', 250]]));
    expect(result.get('a')).toBeCloseTo(0.75, 6);
    expect(result.get('b')).toBeCloseTo(0.25, 6);
  });

  it('sums to one', () => {
    const result = shares(withProjects([['a', 1], ['b', 2], ['c', 7]]));
    expect([...result.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it('is empty when nothing happened, rather than an even split', () => {
    // Nothing running must mean nothing walking. An even split over zero work would put robots
    // on the board that represent no activity at all, which is the feature lying.
    expect(shares(withProjects([['a', 0], ['b', 0]])).size).toBe(0);
    expect(shares(summary()).size).toBe(0);
  });
});

describe('projectDirFor', () => {
  it('matches how Claude Code mangles a working directory', () => {
    // Verified against the real ~/.claude/projects on this machine.
    expect(projectDirFor('C:\\dev\\SkynetOS')).toBe('C--dev-SkynetOS');
    expect(projectDirFor('C:/dev/SkynetOS')).toBe('C--dev-SkynetOS');
  });

  it('reduces every run of punctuation the same way', () => {
    expect(projectDirFor('D:/work/my.repo')).toBe('D--work-my-repo');
  });
});

describe('formatting', () => {
  it('scales token counts without scientific notation', () => {
    expect(formatTokens(812)).toBe('812');
    expect(formatTokens(43_700)).toBe('43.7K');
    expect(formatTokens(1_240_000)).toBe('1.2M');
    expect(formatTokens(3_400_000_000)).toBe('3.4B');
  });

  it('never shows a negative count', () => {
    expect(formatTokens(-5)).toBe('0');
  });

  it('reads durations the way a person says them', () => {
    expect(formatDuration(0.005)).toBe('< 1m');
    expect(formatDuration(0.3)).toBe('18m');
    expect(formatDuration(4)).toBe('4h');
    expect(formatDuration(4.333)).toBe('4h 20m');
  });
});
