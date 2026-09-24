/**
 * The pure half of voice control: the wake grammar script, the lines it prints, what whisper returns,
 * whether the install can run, and how the grammar tells a command from a question.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_VOICE, parseWakeLine, transcriptOf, voiceReadiness, wakeScript } from '@shared/voice.js';
import { resolveIntent, type IntentContext } from '@shared/intent.js';

describe('the wake grammar', () => {
  it('holds exactly the phrases it is given, and nothing else', () => {
    const script = wakeScript(['hey jarvis', 'jarvis']);
    expect(script).toContain("$choices.Add('hey jarvis')");
    expect(script).toContain("$choices.Add('jarvis')");
    expect(script.match(/\$choices\.Add\(/g)).toHaveLength(2);
    // No dictation grammar, which is what would let it transcribe anything at all.
    expect(script).not.toMatch(/DictationGrammar/);
  });

  it('prints its confidence the same way in every locale', () => {
    // A German or French Windows prints 0,95 unless told otherwise.
    expect(wakeScript(['jarvis'])).toContain('InvariantCulture');
  });

  it('refuses a phrase that is not plain words', () => {
    expect(() => wakeScript(["jarvis'); Remove-Item C:\\ -Recurse #"])).toThrow();
    expect(() => wakeScript([])).toThrow();
  });
});

describe('the lines the sidecar prints', () => {
  it('reads readiness, a wake with its confidence, and a fatal error', () => {
    expect(parseWakeLine('READY listening for: hey jarvis / jarvis')).toEqual({ type: 'ready' });
    expect(parseWakeLine('WAKE 0.95 hey jarvis')).toEqual({ type: 'wake', confidence: 0.95, phrase: 'hey jarvis' });
    expect(parseWakeLine('FATAL no default input device')).toEqual({ type: 'fatal', message: 'no default input device' });
  });

  it('copes with a comma for a decimal point', () => {
    expect(parseWakeLine('WAKE 0,81 jarvis')).toEqual({ type: 'wake', confidence: 0.81, phrase: 'jarvis' });
  });

  it('treats anything else as not a wake', () => {
    expect(parseWakeLine('WARNING: something').type).toBe('other');
    expect(parseWakeLine('WAKE nonsense').type).toBe('other');
  });
});

describe('what whisper returns', () => {
  it('keeps the words and drops its markers for non-speech', () => {
    expect(transcriptOf({ text: ' Give me manual control.\n' })).toBe('Give me manual control.');
    expect(transcriptOf({ text: ' [BLANK_AUDIO]\n' })).toBe('');
    expect(transcriptOf({ text: ' (keyboard clicking) Zoom in.' })).toBe('Zoom in.');
    expect(transcriptOf({ text: ' ... ' })).toBe('');
    expect(transcriptOf(null)).toBe('');
  });
});

describe('whether the install can run', () => {
  const settings = { ...DEFAULT_VOICE, server: 'C:/whisper-server.exe', serverModel: 'C:/model.bin' };

  it('says what is missing, in order', () => {
    expect(voiceReadiness({ ...settings, server: '' }, { server: false, model: true, recogniser: true })).toMatchObject({ ok: false });
    expect(voiceReadiness(settings, { server: false, model: true, recogniser: true })).toMatchObject({ ok: false, error: expect.stringContaining('SERVER') });
    expect(voiceReadiness(settings, { server: true, model: false, recogniser: true })).toMatchObject({ ok: false, error: expect.stringContaining('MODEL') });
    expect(voiceReadiness(settings, { server: true, model: true, recogniser: true })).toEqual({ ok: true });
  });

  it('refuses wake phrases the grammar could not hold', () => {
    expect(voiceReadiness({ ...settings, phrases: ['hey, jarvis!'] }, { server: true, model: true, recogniser: true })).toMatchObject({ ok: false });
  });
});

describe('a command, or a question for the Face', () => {
  const context: IntentContext = { boardId: 'root', nodes: [], edges: [], selectedId: null, actor: 'voice' };

  it('marks a sentence that is not a command at all as not understood — that one goes to the Face', () => {
    const intent = resolveIntent('what did I work on yesterday', context);
    expect(intent.kind).toBe('unknown');
    expect(intent.kind === 'unknown' && intent.understood).toBe(false);
  });

  it('marks a command that could not be carried out as understood — that one is not sent anywhere', () => {
    const intent = resolveIntent('select the stalker', context);
    expect(intent.kind).toBe('unknown');
    expect(intent.kind === 'unknown' && intent.understood).toBe(true);
  });

  it('lets voice close its own microphone', () => {
    for (const phrase of ['stop listening', 'hey jarvis, mute', 'voice off']) {
      expect(resolveIntent(phrase, context)).toMatchObject({ kind: 'view', action: { type: 'voiceControl', on: false } });
    }
  });
});

describe('the MATRIX and the board, by voice', () => {
  const context: IntentContext = { boardId: 'root', nodes: [], edges: [], selectedId: null, actor: 'voice' };

  it('opens and leaves the MATRIX', () => {
    expect(resolveIntent('open the matrix', context)).toMatchObject({ kind: 'view', action: { type: 'matrix', open: true } });
    expect(resolveIntent('hey jarvis, close the matrix', context)).toMatchObject({ kind: 'view', action: { type: 'matrix', open: false } });
  });

  it('zooms in on the board, written the way the speech engine actually heard it', () => {
    expect(resolveIntent('Zoom in on the board.', context)).toMatchObject({ kind: 'view', action: { type: 'zoom', to: 'in' } });
  });
});
