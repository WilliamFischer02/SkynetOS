import { describe, expect, it } from 'vitest';
import {
  DICTATE_CHUNK_CHARS,
  DICTATE_HOTKEY,
  DICTATE_MAX_MS,
  chunkText,
  cleanTranscript,
  escapeSendKeys,
  idleStatus,
  mayTakeAgain,
  nextPhase
} from '../packages/shared/dictate.js';
import { matchActionName } from '../packages/shared/intent.js';

describe('dictation state machine', () => {
  it('starts on a toggle, and only on a toggle', () => {
    expect(nextPhase('idle', 'toggle')).toBe('listening');
    for (const e of ['captured', 'nothing', 'typed', 'failed', 'timeout'] as const) expect(nextPhase('idle', e)).toBe('idle');
  });

  it('walks listening → transcribing → typing, and back to listening for another take', () => {
    let phase = nextPhase('idle', 'toggle');
    phase = nextPhase(phase, 'captured');
    expect(phase).toBe('transcribing');
    phase = nextPhase(phase, 'typed');
    expect(phase).toBe('typing');
    expect(nextPhase(phase, 'captured')).toBe('listening');
  });

  it('ends on silence, a failure, the cap, or the second press', () => {
    expect(nextPhase('listening', 'nothing')).toBe('idle');
    expect(nextPhase('listening', 'failed')).toBe('idle');
    expect(nextPhase('transcribing', 'failed')).toBe('idle');
    expect(nextPhase('typing', 'timeout')).toBe('idle');
    expect(nextPhase('typing', 'toggle')).toBe('idle');
  });

  it('a second press while listening does not change the phase: the take finishes first', () => {
    expect(nextPhase('listening', 'toggle')).toBe('listening');
  });

  it('opens another take only while time remains and nobody asked to stop', () => {
    const startedAt = 1_000_000;
    expect(mayTakeAgain({ stopRequested: false, startedAt, now: startedAt + 10_000 })).toBe(true);
    expect(mayTakeAgain({ stopRequested: true, startedAt, now: startedAt + 10_000 })).toBe(false);
    expect(mayTakeAgain({ stopRequested: false, startedAt, now: startedAt + DICTATE_MAX_MS - 1000 })).toBe(false);
  });

  it('starts idle with the hotkey and whether it was taken', () => {
    expect(idleStatus(true)).toMatchObject({ phase: 'idle', hotkey: DICTATE_HOTKEY, hotkeyOk: true, typed: 0 });
    expect(DICTATE_HOTKEY).toBe('CommandOrControl+Alt+D');
  });
});

describe('SendKeys text', () => {
  it('wraps every SendKeys operator in braces and turns newlines and tabs into keys', () => {
    expect(escapeSendKeys('a+b^c%d~e(f)g{h}i[j]')).toBe('a{+}b{^}c{%}d{~}e{(}f{)}g{{}h{}}i{[}j{]}');
    expect(escapeSendKeys('one\r\ntwo\tthree')).toBe('one{ENTER}two{TAB}three');
    expect(escapeSendKeys('plain words, with punctuation.')).toBe('plain words, with punctuation.');
  });

  it('splits long text at spaces into pieces no longer than the chunk size', () => {
    const text = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
    const pieces = chunkText(text);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(DICTATE_CHUNK_CHARS);
    expect(pieces.join(' ')).toBe(text);
  });

  it('cuts a single word longer than the chunk size rather than looping', () => {
    const pieces = chunkText('x'.repeat(450));
    expect(pieces.map((p) => p.length)).toEqual([200, 200, 50]);
  });

  it('cleans whisper noise tags out of a transcript', () => {
    expect(cleanTranscript(' [BLANK_AUDIO] hello  there (laughs) ')).toBe('hello there');
  });
});

describe('matchActionName', () => {
  const actions = [
    { id: 'a1', name: 'Morning setup (OBS + Discord)' },
    { id: 'a2', name: 'Stream shutdown' },
    { id: 'a3', name: 'Open the Stalker workspace' }
  ];

  it('finds an action from most of its words, ignoring case and punctuation', () => {
    expect(matchActionName('the morning setup', actions)?.id).toBe('a1');
    expect(matchActionName('stalker workspace', actions)?.id).toBe('a3');
    expect(matchActionName('stream shutdown action', actions)?.id).toBe('a2');
  });

  it('returns null when nothing is close, or two are equally close', () => {
    expect(matchActionName('make coffee', actions)).toBeNull();
    expect(matchActionName('setup', [{ id: 'x', name: 'Setup one' }, { id: 'y', name: 'Setup two' }])).toBeNull();
    expect(matchActionName('', actions)).toBeNull();
  });
});
