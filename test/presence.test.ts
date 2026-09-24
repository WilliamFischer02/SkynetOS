import { describe, expect, it } from 'vitest';
import {
  AWAY_MODES,
  clampAwayMinutes,
  isAwayMode,
  isSettled,
  judgePresence,
  shouldWake
} from '../packages/shared/presence.js';

const NOW = Date.UTC(2026, 8, 11, 12, 0, 0);
const MIN = 60_000;

describe('presence', () => {
  it('is away only when input, agents and commands have all been quiet for the threshold', () => {
    expect(judgePresence({
      now: NOW, systemIdleSeconds: 31 * 60, lastTranscriptAt: NOW - 45 * MIN, lastCommandAt: null, thresholdMinutes: 30
    })).toEqual({ away: true, blockers: [] });
  });

  it('keeps William present while he types anywhere, even with no agent activity', () => {
    const v = judgePresence({ now: NOW, systemIdleSeconds: 12, lastTranscriptAt: null, lastCommandAt: null, thresholdMinutes: 30 });
    expect(v.away).toBe(false);
    expect(v.blockers).toEqual(['input']);
  });

  it('counts an agent writing its conversation as presence', () => {
    const v = judgePresence({ now: NOW, systemIdleSeconds: 3600, lastTranscriptAt: NOW - 2 * MIN, lastCommandAt: null, thresholdMinutes: 30 });
    expect(v.away).toBe(false);
    expect(v.blockers).toEqual(['agent']);
  });

  it('counts a board command or MCP call as presence', () => {
    const v = judgePresence({ now: NOW, systemIdleSeconds: 3600, lastTranscriptAt: null, lastCommandAt: NOW - MIN, thresholdMinutes: 30 });
    expect(v.blockers).toEqual(['command']);
  });

  it('clamps the threshold to 5..240 minutes', () => {
    expect(clampAwayMinutes(1)).toBe(5);
    expect(clampAwayMinutes(9999)).toBe(240);
    expect(clampAwayMinutes('45')).toBe(45);
    expect(clampAwayMinutes('nonsense')).toBe(30);
  });

  it('knows its modes', () => {
    expect([...AWAY_MODES]).toEqual(['off', 'visual', 'plan', 'work']);
    expect(isAwayMode('plan')).toBe(true);
    expect(isAwayMode('yolo')).toBe(false);
  });

  it('does not wake on the key press that asked for sleep, only after the machine has been left', () => {
    expect(shouldWake(0, false)).toBe(false);
    expect(isSettled(6)).toBe(true);
    expect(shouldWake(1, true)).toBe(true);
    expect(shouldWake(10, true)).toBe(false);
  });
});
