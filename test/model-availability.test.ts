import { describe, expect, it } from 'vitest';
import {
  FALLBACK,
  PRIMARY,
  decideFable,
  formatCountdown,
  limitEventFrom,
  parseResetText,
  zonedTimeToUtc,
  type LimitEvent
} from '../packages/shared/model-availability.js';
import { claudeArgs } from '../src/main/services/launch-args.js';
import type { BoardNode } from '../packages/shared/types.js';

/**
 * Which model a launch gets. William: "if fable 5 is disabled … all terminals should switch to opus
 * 5 automatically … when deadline is reached all terminals should now switch back to defaulting to
 * claude fable 5.1, high effort -- as mentioned otherwise opus 5 xhigh."
 *
 * The fixtures are the two refusal shapes actually found in this machine's transcripts, trimmed.
 */

const outOfCredits = {
  type: 'assistant',
  timestamp: '2026-09-11T03:50:41.000Z',
  isApiErrorMessage: true,
  error: 'rate_limit',
  apiErrorStatus: 429,
  message: { content: [{ type: 'text', text: "You're out of usage credits. Run /usage-credits to keep using Fable 5.1 or /model to switch models." }] }
};

const sessionLimit = {
  type: 'assistant',
  timestamp: '2026-09-08T01:21:12.000Z',
  isApiErrorMessage: true,
  error: 'rate_limit',
  apiErrorStatus: 429,
  quotaLimits: { status: 'rejected', resetsAt: 1788835200, rateLimitType: 'five_hour', overageDisabledReason: 'out_of_credits' },
  message: { content: [{ type: 'text', text: "You've hit your session limit · resets 8:40pm (America/Denver)" }] }
};

const DENVER = 'America/Denver';

describe('reading a refusal', () => {
  it('knows Fable is out of credits, and that the record gives no restart time', () => {
    const event = limitEventFrom(outOfCredits, DENVER);
    expect(event?.fable).toBe(true);
    expect(event?.resetsAt).toBeNull();
    expect(event?.at).toBe(Date.parse('2026-09-11T03:50:41.000Z'));
  });

  it('takes the restart time from quotaLimits when the record carries it', () => {
    const event = limitEventFrom(sessionLimit, DENVER);
    expect(event?.fable).toBe(false);
    expect(event?.resetsAt).toBe(1788835200 * 1000);
    expect(event?.rateLimitType).toBe('five_hour');
  });

  it('ignores anything that is not a refused request', () => {
    expect(limitEventFrom({ type: 'assistant', timestamp: '2026-09-11T00:00:00Z', message: { content: [] } }, DENVER)).toBeNull();
    expect(limitEventFrom({ ...outOfCredits, error: 'authentication_failed' }, DENVER)).toBeNull();
    expect(limitEventFrom(null, DENVER)).toBeNull();
  });
});

describe('parseResetText', () => {
  it('reads the CLI\'s own phrase, in the zone it names', () => {
    // The recorded refusal said 8:40pm Denver and recorded 1788835200. The text alone agrees.
    expect(parseResetText("resets 8:40pm (America/Denver)", Date.parse('2026-09-08T01:21:12Z'), 'UTC')).toBe(1788835200 * 1000);
  });

  it('reads "8pm Monday" as the next Monday at 8pm in the local zone', () => {
    // Written around 01:25 on Friday 11 September, Denver time. Monday 14th, 8pm MDT, is 02:00 UTC on the 15th.
    const written = Date.parse('2026-09-11T07:25:00Z');
    const at = parseResetText('8pm Monday', written, DENVER);
    expect(at).toBe(Date.UTC(2026, 8, 15, 2, 0));
    // "so 90.6 hours": the same figure the CLI's countdown gave.
    expect(((at as number) - written) / 3600_000).toBeCloseTo(90.58, 1);
  });

  it('accepts the other orders the CLI uses', () => {
    const after = Date.parse('2026-09-11T07:25:00Z');
    expect(parseResetText('Mon 8:00pm', after, DENVER)).toBe(Date.UTC(2026, 8, 15, 2, 0));
    expect(parseResetText('resets monday 8pm', after, DENVER)).toBe(Date.UTC(2026, 8, 15, 2, 0));
  });

  it('rolls a clock time with no day over to tomorrow once it has passed', () => {
    const after = Date.parse('2026-09-11T05:00:00Z'); // 23:00 Denver
    expect(parseResetText('8pm', after, DENVER)).toBe(Date.UTC(2026, 8, 12, 2, 0));
  });

  it('refuses what it does not understand rather than guessing', () => {
    expect(parseResetText('soon', Date.now(), DENVER)).toBeNull();
    expect(parseResetText('13pm', Date.now(), DENVER)).toBeNull();
  });

  it('handles a DST change on the day', () => {
    // US DST ends 1 November 2026; 8pm that evening is MST, UTC-7.
    expect(zonedTimeToUtc(2026, 11, 1, 20, 0, DENVER)).toBe(Date.UTC(2026, 10, 2, 3, 0));
  });
});

describe('decideFable', () => {
  const limit = limitEventFrom(outOfCredits, DENVER) as LimitEvent;
  const now = Date.parse('2026-09-11T07:25:00Z');

  it('launches Opus 5 at xhigh while Fable is out', () => {
    const status = decideFable({ limit, lastFableReply: Date.parse('2026-09-08T03:29:54Z'), overrideResetsAt: null }, now);
    expect(status.state).toBe('offline');
    expect(status.launch).toEqual(FALLBACK);
    expect(status.launch?.effort).toBe('xhigh');
    expect(status.resetsAt).toBeNull();
  });

  it('counts down to a typed restart time, and goes back to Fable 5.1 at high when it passes', () => {
    const restart = Date.UTC(2026, 8, 15, 2, 0);
    const before = decideFable({ limit, lastFableReply: null, overrideResetsAt: restart }, now);
    expect(before.state).toBe('offline');
    expect(before.resetsAt).toBe(restart);
    expect(before.resetSource).toBe('setting');

    const after = decideFable({ limit, lastFableReply: null, overrideResetsAt: restart }, restart + 1000);
    expect(after.state).toBe('online');
    expect(after.launch).toEqual(PRIMARY);
    expect(after.launch?.effort).toBe('high');
  });

  it('comes back as soon as Fable really answers again, credits bought or not', () => {
    const status = decideFable({ limit, lastFableReply: limit.at + 60_000, overrideResetsAt: null }, now);
    expect(status.state).toBe('online');
  });

  it('never lets a restart time from an earlier outage decide this one', () => {
    const stale = limit.at - 3600_000;
    const status = decideFable({ limit, lastFableReply: null, overrideResetsAt: stale }, now);
    expect(status.state).toBe('offline');
    expect(status.resetsAt).toBeNull();
  });

  it('prefers a recorded restart time over a typed one', () => {
    const recorded = { ...limit, resetsAt: Date.UTC(2026, 8, 14, 0, 0) };
    const status = decideFable({ limit: recorded, lastFableReply: null, overrideResetsAt: Date.UTC(2026, 8, 15, 2, 0) }, now);
    expect(status.resetSource).toBe('recorded');
    expect(status.resetsAt).toBe(recorded.resetsAt);
  });

  it('is online with nothing on record, and asks for nothing when automatic choice is off', () => {
    expect(decideFable({ limit: null, lastFableReply: null, overrideResetsAt: null }, now).launch).toEqual(PRIMARY);
    expect(decideFable({ limit, lastFableReply: null, overrideResetsAt: null }, now, false).launch).toBeNull();
  });
});

describe('formatCountdown', () => {
  it('prints HHH:MM:SS', () => {
    expect(formatCountdown(90.6 * 3600_000)).toBe('090:36:00');
    expect(formatCountdown(59_999)).toBe('000:00:59');
    expect(formatCountdown(-5)).toBe('000:00:00');
    expect(formatCountdown(1234 * 3600_000)).toBe('1234:00:00');
  });
});

describe('the launch command', () => {
  const agent = (over: Partial<BoardNode> = {}): BoardNode =>
    ({ id: 'u3', kind: 'agent.code', name: 'PRIME', pos: { x: 0, y: 0 }, cwd: 'C:/dev', ...over });
  const call = (node: BoardNode, launchModel: typeof PRIMARY | null) =>
    claudeArgs({ node, storedSessionId: null, storedIsReal: false, fresh: false, addDirs: [], launchModel }).args;

  it('asks for Fable 5.1 at high, with Opus as the CLI\'s own fallback', () => {
    const args = call(agent(), PRIMARY);
    expect(args.join(' ')).toContain('--model claude-fable-5-1 --effort high --fallback-model claude-opus-5');
  });

  it('asks for Opus 5 at xhigh while Fable is out', () => {
    const args = call(agent(), FALLBACK);
    expect(args.join(' ')).toContain('--model claude-opus-5 --effort xhigh');
    expect(args).not.toContain('--fallback-model');
  });

  it('lets a node\'s own model win, and leaves the CLI default alone when there is no decision', () => {
    expect(call(agent({ model: 'claude-sonnet-5' }), FALLBACK).join(' ')).toContain('--model claude-sonnet-5');
    expect(call(agent({ model: 'claude-sonnet-5' }), FALLBACK)).not.toContain('--effort');
    expect(call(agent(), null)).not.toContain('--model');
  });
});
