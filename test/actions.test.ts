import { describe, expect, it } from 'vitest';
import {
  DOUBLE_CLICK_MS,
  MAX_REPLAY_MS,
  MAX_REPLAY_STEPS,
  REPLAY_GAP_MAX_MS,
  REPLAY_GAP_MIN_MS,
  adaptTarget,
  coalesceSteps,
  isRefusedChord,
  isSensitiveTitle,
  matchWindow,
  normaliseChord,
  recordingId,
  replayGaps,
  replayPlan,
  summariseSteps,
  titleSimilarity,
  type ActionStep,
  type LiveElement,
  type LiveWindow,
  type RawEvent,
  type UiTarget
} from '../packages/shared/actions.js';

const target = (over: Partial<UiTarget> = {}): UiTarget => ({
  process: 'firefox',
  windowTitle: 'Mozilla Firefox — SkynetOS docs',
  controlName: 'New Tab',
  controlType: 'ControlType.Button',
  className: 'MozillaWindowClass',
  rect: [100, 10, 40, 30],
  relX: 0.5,
  relY: 0.5,
  monitor: 1,
  windowRect: [0, 0, 1920, 1080],
  ...over
});

describe('coalesceSteps', () => {
  it('runs printable characters together into one text step, and keeps chords apart', () => {
    const raw: RawEvent[] = [
      { t: 0, kind: 'char', ch: 'h' },
      { t: 40, kind: 'char', ch: 'i' },
      { t: 80, kind: 'char', ch: ' ' },
      { t: 120, kind: 'key', keys: 'ctrl+s' },
      { t: 200, kind: 'char', ch: 'o' },
      { t: 240, kind: 'char', ch: 'k' }
    ];
    expect(coalesceSteps(raw)).toEqual([
      { t: 0, kind: 'text', text: 'hi ' },
      { t: 120, kind: 'key', keys: 'ctrl+s' },
      { t: 200, kind: 'text', text: 'ok' }
    ]);
  });

  it('decimates moves and merges two quick clicks into a double click', () => {
    const raw: RawEvent[] = [
      { t: 0, kind: 'move', x: 10, y: 10 },
      { t: 10, kind: 'move', x: 12, y: 11 },
      { t: 100, kind: 'move', x: 60, y: 60 },
      { t: 300, kind: 'click', x: 120, y: 25, target: target() },
      { t: 300 + DOUBLE_CLICK_MS - 50, kind: 'click', x: 121, y: 25, target: target() },
      { t: 2000, kind: 'click', x: 121, y: 25, target: target() }
    ];
    const steps = coalesceSteps(raw);
    expect(steps.filter((s) => s.kind === 'move').length).toBe(2);
    expect(steps.filter((s) => s.kind === 'dblclick').length).toBe(1);
    expect(steps.filter((s) => s.kind === 'click').length).toBe(1);
  });

  it('keeps one paused marker per stretch and drops the keys that arrived under it', () => {
    const raw: RawEvent[] = [
      { t: 0, kind: 'paused', reason: 'a window that looks like a sign-in: Sign in' },
      { t: 500, kind: 'paused', reason: 'a window that looks like a sign-in: Sign in' },
      { t: 900, kind: 'char', ch: 'x' },
      { t: 1200, kind: 'paused', reason: 'a window that looks like a sign-in: Sign in' }
    ];
    const steps = coalesceSteps(raw);
    expect(steps.filter((s) => s.kind === 'paused').length).toBe(2);
    expect(steps.find((s) => s.kind === 'text')).toEqual({ t: 900, kind: 'text', text: 'x' });
  });
});

describe('the sign-in rule', () => {
  it('matches the titles a password could be typed into', () => {
    for (const t of ['Sign in – Google Accounts', 'Log in to Steam', 'Login | Bank', 'Enter your password', '2FA required', 'Verification code']) {
      expect(isSensitiveTitle(t), t).toBe(true);
    }
    for (const t of ['SkynetOS - U3 - JARVIS-PRIME', 'Firefox', 'passwords.md - Obsidian'.replace('passwords', 'notes')]) {
      expect(isSensitiveTitle(t), t).toBe(false);
    }
  });
});

describe('refused chords', () => {
  it('normalises modifier order and aliases', () => {
    expect(normaliseChord('F4+ALT')).toBe('alt+f4');
    expect(normaliseChord('Shift+Control+s')).toBe('ctrl+shift+s');
    expect(normaliseChord('meta+l')).toBe('win+l');
  });

  it('refuses closing, locking, the security screen and a bare Windows key', () => {
    for (const c of ['alt+f4', 'F4+alt', 'win+l', 'ctrl+alt+delete', 'ctrl+alt+del', 'ctrl+shift+esc', 'ctrl+shift+escape', 'win', 'win+r', 'win+x']) {
      expect(isRefusedChord(c), c).toBe(true);
    }
    for (const c of ['ctrl+s', 'ctrl+shift+s', 'alt+tab', 'win+d', 'enter', 'escape']) {
      expect(isRefusedChord(c), c).toBe(false);
    }
  });
});

describe('summariseSteps', () => {
  it('writes one readable line per action and none for a move', () => {
    const steps: ActionStep[] = [
      { t: 0, kind: 'move', x: 1, y: 1 },
      { t: 10, kind: 'click', x: 120, y: 25, target: target() },
      { t: 20, kind: 'key', keys: 'ctrl+t' },
      { t: 30, kind: 'text', text: 'skynet' },
      { t: 40, kind: 'rightclick', x: 5, y: 5, target: target({ controlName: '', windowTitle: 'Desktop' }) }
    ];
    expect(summariseSteps(steps)).toEqual([
      'CLICK   firefox · "New Tab" button',
      'KEY     CTRL+T',
      'TYPE    "skynet"',
      'RIGHT   firefox · Desktop · button'
    ]);
  });
});

describe('timing', () => {
  it('compresses gaps into the replay band', () => {
    const steps: ActionStep[] = [
      { t: 0, kind: 'key', keys: 'a' },
      { t: 5, kind: 'key', keys: 'b' },
      { t: 5000, kind: 'key', keys: 'c' }
    ];
    expect(replayGaps(steps)).toEqual([REPLAY_GAP_MIN_MS, REPLAY_GAP_MIN_MS, REPLAY_GAP_MAX_MS]);
  });

  it('drops moves, then caps the count and the duration', () => {
    const many: ActionStep[] = [];
    for (let i = 0; i < 1000; i++) many.push({ t: i * 10, kind: 'move', x: i, y: i });
    for (let i = 0; i < 500; i++) many.push({ t: 20_000 + i * 1000, kind: 'key', keys: 'enter' });
    const plan = replayPlan(many);
    expect(plan.steps.every((s) => s.kind !== 'move')).toBe(true);
    expect(plan.steps.length).toBeLessThanOrEqual(MAX_REPLAY_STEPS);
    expect(plan.gaps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(MAX_REPLAY_MS);
    expect(plan.truncated).toBe(true);
  });
});

describe('adaptation', () => {
  const windows: LiveWindow[] = [
    { process: 'firefox', title: 'Mozilla Firefox — something else entirely', rect: [500, 300, 1200, 700], monitor: 2 },
    { process: 'obsidian', title: 'SkynetOS docs - Obsidian', rect: [0, 0, 800, 600], monitor: 1 }
  ];

  it('matches the window by process first, then by the words in its title', () => {
    expect(titleSimilarity('Mozilla Firefox — SkynetOS docs', 'Mozilla Firefox — something else entirely')).toBeGreaterThan(0.3);
    expect(matchWindow(target(), windows)?.process).toBe('firefox');
    expect(matchWindow(target({ process: 'code' }), windows)).toBeNull();
  });

  it('clicks the same-named control where it is NOW (tier element)', () => {
    const elements: LiveElement[] = [{ controlName: 'New Tab', controlType: 'ControlType.Button', className: 'x', rect: [900, 320, 40, 30] }];
    const a = adaptTarget({ x: 120, y: 25, target: target() }, windows, elements, [0, 0, 1920, 1080]);
    expect(a.tier).toBe('element');
    expect([a.x, a.y]).toEqual([920, 335]);
  });

  it('falls back to the recorded offset inside the moved window (tier window)', () => {
    const a = adaptTarget({ x: 192, y: 108, target: target() }, windows, [], [0, 0, 1920, 1080]);
    expect(a.tier).toBe('window');
    // 10% in from the window's top-left, applied to the window's current rect.
    expect([a.x, a.y]).toEqual([620, 370]);
  });

  it('uses the raw coordinate when no window matches (tier screen)', () => {
    const a = adaptTarget({ x: 33, y: 44, target: target({ process: 'notepad' }) }, windows, [], [0, 0, 1920, 1080]);
    expect(a).toMatchObject({ tier: 'screen', x: 33, y: 44, window: null });
  });
});

describe('recordingId', () => {
  it('is sortable and filename-safe', () => {
    const id = recordingId(new Date('2026-09-26T21:05:03.118Z'), 0.5);
    expect(id).toBe('2026-09-26T21-05-03-118-7fff');
    expect(id).toMatch(/^[A-Za-z0-9-]+$/);
  });
});
