import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WARM_WAIT_MS,
  MAX_WARM_WAIT_MS,
  MIN_WARM_WAIT_MS,
  PROFILE_LINES,
  chooseVoice,
  clampWarmWait,
  isLoopbackUrl,
  speechRoute,
  newProfile,
  nextUnrecorded,
  normaliseProfile,
  parseSpeechLine,
  profileSummary,
  safeProfileName,
  sanitiseSpeech,
  speechScript
} from '../packages/shared/speech.js';

describe('the speech sidecar script', () => {
  const script = speechScript();

  it('evaluates nothing it is sent and opens no network', () => {
    expect(script).not.toMatch(/Invoke-Expression|iex\b|Invoke-WebRequest|Invoke-RestMethod|Net\.WebClient|HttpClient|Start-Process/i);
    expect(script).toContain('ConvertFrom-Json');
    expect(script).toContain('System.Speech');
  });

  it('reports the protocol lines the service parses', () => {
    for (const marker of ['VOICES ', 'READY ', 'START ', 'WORD ', 'DONE', 'STOPPED', 'PLAYED ', 'FATAL ']) expect(script).toContain(marker);
    expect(script).toContain('SpeakAsync');
    expect(script).toContain('SpeakAsyncCancelAll');
  });
});

describe('parseSpeechLine', () => {
  it('reads every line kind', () => {
    expect(parseSpeechLine('VOICES Microsoft David Desktop|Microsoft Zira Desktop')).toEqual({ type: 'voices', voices: ['Microsoft David Desktop', 'Microsoft Zira Desktop'] });
    expect(parseSpeechLine('READY Microsoft David Desktop')).toEqual({ type: 'ready', voice: 'Microsoft David Desktop' });
    expect(parseSpeechLine('VOICE Microsoft George')).toEqual({ type: 'voice', voice: 'Microsoft George' });
    expect(parseSpeechLine('START 42')).toEqual({ type: 'start', chars: 42 });
    expect(parseSpeechLine('WORD 7 5')).toEqual({ type: 'word', position: 7, length: 5 });
    expect(parseSpeechLine('DONE')).toEqual({ type: 'done' });
    expect(parseSpeechLine('STOPPED')).toEqual({ type: 'stopped' });
    expect(parseSpeechLine('PLAYED C:/x/line-l01.wav')).toEqual({ type: 'played', path: 'C:/x/line-l01.wav' });
    expect(parseSpeechLine('FATAL no audio device')).toEqual({ type: 'fatal', message: 'no audio device' });
    expect(parseSpeechLine('FAULT play file missing')).toEqual({ type: 'fault', message: 'play file missing' });
    expect(parseSpeechLine('something else')).toEqual({ type: 'other', text: 'something else' });
  });

  it('never throws on rubbish', () => {
    expect(parseSpeechLine('')).toEqual({ type: 'other', text: '' });
    expect(parseSpeechLine('WORD x y')).toEqual({ type: 'other', text: 'WORD x y' });
    expect(parseSpeechLine('FATAL').type).toBe('fatal');
  });
});

describe('chooseVoice', () => {
  const us = ['Microsoft David Desktop', 'Microsoft Zira Desktop', 'Microsoft Mark'];
  it('picks David on a machine with only the US voices', () => {
    expect(chooseVoice(us, '')).toBe('Microsoft David Desktop');
  });
  it('prefers a named substring, then a British male, then any British voice', () => {
    expect(chooseVoice(us, 'zira')).toBe('Microsoft Zira Desktop');
    expect(chooseVoice([...us, 'Microsoft Hazel Desktop', 'Microsoft George'], '')).toBe('Microsoft George');
    expect(chooseVoice([...us, 'Microsoft Hazel Desktop'], '')).toBe('Microsoft Hazel Desktop');
  });
  it('falls back to the first voice, and to null with none', () => {
    expect(chooseVoice(['Voz Helena'], '')).toBe('Voz Helena');
    expect(chooseVoice([], 'george')).toBeNull();
    expect(chooseVoice(us, 'nobody')).toBe('Microsoft David Desktop');
  });
});

describe('sanitiseSpeech and isLoopbackUrl', () => {
  it('strips control characters, collapses space, bounds the length', () => {
    expect(sanitiseSpeech('  Hello\u0000\u0007 there\n\nsir  ')).toBe('Hello there sir');
    expect(sanitiseSpeech('x'.repeat(1000)).length).toBe(400);
    expect(sanitiseSpeech(42)).toBe('');
  });
  it('accepts only loopback servers', () => {
    expect(isLoopbackUrl('http://127.0.0.1:47832')).toBe(true);
    expect(isLoopbackUrl('http://localhost:5000/')).toBe(true);
    expect(isLoopbackUrl('http://192.168.1.4:47832')).toBe(false);
    expect(isLoopbackUrl('https://example.com')).toBe(false);
    expect(isLoopbackUrl('not a url')).toBe(false);
  });
});

describe('speechRoute: where a line goes while the server warms', () => {
  const server = { backend: 'server' as const, warmWaitMs: 120_000 };

  it('holds a line while the server is starting, and while it is up but cold', () => {
    expect(speechRoute({ ...server, serverUp: false, warm: false, starting: true, waitedMs: 0 })).toBe('wait');
    expect(speechRoute({ ...server, serverUp: true, warm: false, starting: false, waitedMs: 30_000 })).toBe('wait');
  });

  it('speaks on the server once it is up and warm', () => {
    expect(speechRoute({ ...server, serverUp: true, warm: true, starting: false, waitedMs: 0 })).toBe('server');
    expect(speechRoute({ ...server, serverUp: true, warm: true, starting: true, waitedMs: 119_000 })).toBe('server');
  });

  it("falls back to Windows' voice when the wait expires", () => {
    expect(speechRoute({ ...server, serverUp: true, warm: false, starting: false, waitedMs: 120_000 })).toBe('sapi');
    expect(speechRoute({ ...server, serverUp: false, warm: false, starting: true, waitedMs: 200_000 })).toBe('sapi');
  });

  it('never waits on the sapi backend', () => {
    expect(speechRoute({ backend: 'sapi', serverUp: true, warm: false, starting: true, waitedMs: 0, warmWaitMs: 120_000 })).toBe('sapi');
    expect(speechRoute({ backend: 'sapi', serverUp: true, warm: true, starting: false, waitedMs: 0, warmWaitMs: 120_000 })).toBe('sapi');
  });

  it("goes to Windows' voice when the server exits mid-wait and nobody is restarting it", () => {
    expect(speechRoute({ ...server, serverUp: false, warm: false, starting: false, waitedMs: 5_000 })).toBe('sapi');
  });

  it('reads warmWaitMs with a default and clamps it to 5 s – 5 min', () => {
    expect(clampWarmWait(undefined)).toBe(DEFAULT_WARM_WAIT_MS);
    expect(clampWarmWait('soon')).toBe(DEFAULT_WARM_WAIT_MS);
    expect(clampWarmWait(NaN)).toBe(DEFAULT_WARM_WAIT_MS);
    expect(clampWarmWait(1)).toBe(MIN_WARM_WAIT_MS);
    expect(clampWarmWait(10 ** 9)).toBe(MAX_WARM_WAIT_MS);
    expect(clampWarmWait(45_000.4)).toBe(45_000);
  });
});

describe('PROFILE_LINES', () => {
  it('has forty lines with unique ids, each short and without exclamation marks', () => {
    expect(PROFILE_LINES.length).toBe(40);
    expect(new Set(PROFILE_LINES.map((l) => l.id)).size).toBe(40);
    for (const line of PROFILE_LINES) {
      expect(line.text.length).toBeLessThan(120);
      expect(line.text).not.toContain('!');
      expect(line.id).toMatch(/^l\d\d$/);
    }
  });
  it('varies: some questions, some numbers, some "sir"', () => {
    expect(PROFILE_LINES.filter((l) => l.text.includes('?')).length).toBeGreaterThanOrEqual(4);
    expect(PROFILE_LINES.filter((l) => /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|twenty|hundred)\b/i.test(l.text)).length).toBeGreaterThanOrEqual(8);
    const sirs = PROFILE_LINES.filter((l) => /\bsir\b/.test(l.text)).length;
    expect(sirs).toBeGreaterThanOrEqual(5);
    expect(sirs).toBeLessThanOrEqual(12);
  });
});

describe('voice profiles', () => {
  it('names are folder-safe', () => {
    expect(safeProfileName(' William / Jarvis ')).toBe('william-jarvis');
    expect(safeProfileName('..')).toBeNull();
    expect(safeProfileName(7)).toBeNull();
  });

  it('a new profile has every line unrecorded and summarises as 0 of 40', () => {
    const p = newProfile('test', 'http://127.0.0.1:47832', new Date('2026-09-24T10:00:00Z'));
    expect(p.lines.length).toBe(40);
    expect(p.lines.every((l) => l.file === null)).toBe(true);
    expect(profileSummary(p)).toEqual({ name: 'test', recorded: 0, total: 40, imported: 0, trained: false, updatedAt: '2026-09-24T10:00:00.000Z' });
    expect(p.lines.every((l) => l.source === 'scripted')).toBe(true);
    expect(nextUnrecorded(p)?.id).toBe('l01');
  });

  it('normalises a mangled file: keeps real recordings, drops fakes, restores missing lines', () => {
    const raw = {
      lines: [
        { id: 'l01', file: 'line-l01.wav', ms: 1500, recordedAt: '2026-09-24T10:01:00.000Z' },
        { id: 'l02', file: '../../etc/passwd', ms: 3 },
        { id: 'zzz', file: 'line-zzz.wav' }
      ],
      trained: { at: 'x' },
      server: 'http://127.0.0.1:1'
    };
    const p = normaliseProfile(raw, 'test', 'http://127.0.0.1:47832');
    expect(p.lines.length).toBe(40);
    expect(p.lines[0]).toMatchObject({ id: 'l01', file: 'line-l01.wav', ms: 1500 });
    expect(p.lines[1]).toMatchObject({ id: 'l02', file: null, ms: 0, recordedAt: null });
    expect(p.lines.find((l) => l.id === 'zzz')).toBeUndefined();
    expect(p.trained).toBeNull();
    expect(p.server).toBe('http://127.0.0.1:1');
    expect(normaliseProfile('garbage', 'test', 's').lines.length).toBe(40);
    expect(nextUnrecorded(p)?.id).toBe('l02');
  });
});
