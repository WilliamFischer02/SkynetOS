/**
 * The delay itself (docs/11 § One turn at a time → Where the time goes), 2026-09-27. William, after
 * the first live session: "there is still quite a delay … look for ways to make the program even
 * snappier." Each cut here was measured before it was made; these tests hold what the cut relies on.
 */

import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACK_LINES,
  ackFile,
  ackLookup,
  ackText,
  ackToBuild,
  fnv1a,
  normaliseAckIndex,
  splitFirstSentence
} from '@shared/ack.js';
import { markTiming, newTiming, timingLine, timingRecord, timingSpans } from '@shared/turn-timing.js';
import { GRACE_MS, GRACE_SINGLE_MS, MAX_LOG_LINES, MAX_OTHER_PROGRAMS, MAX_PROMPT_CHARS, MAX_PROMPT_WINDOWS, graceMs, plannerPrompt } from '@shared/planner.js';
import { HEADLESS_DISALLOWED, HEADLESS_ENV, HEADLESS_SETTINGS, headlessClaudeArgs, unknownOption } from '@shared/converse.js';
import { stopsAfterFailure, type DesktopStep } from '@shared/desktop.js';
import { ONE_MOMENT, DONE_WORD, TIMED_OUT, TURN_IDLE, WATCHDOG_MS, streamLabel, turnReduce, turnView } from '@shared/turn.js';
import { speechScript } from '@shared/speech.js';
import { bankedWav, buildAckBank, clearAckCache, readAckIndex, type AckBankDeps } from '../src/main/services/ack-bank.js';
import { dispatch, resetTurn, setTurnEffects, setTurnHandlers } from '../src/main/services/turn.js';
import { currentTiming, markTurn, resetTiming, setTurnTimingFile } from '../src/main/services/turn-timing.js';
import { SAME_AS_LAST_TIME } from '../src/main/services/action-memory.js';

/* ────────────────────────── the acknowledgement bank ────────────────────────── */

describe('the acknowledgement bank: the lines', () => {
  it('holds the brief\'s short lines and the fixed phrases JARVIS says word for word', () => {
    for (const line of ['Right away.', 'One moment.', 'Done.', 'Opening it now.', 'On it.', 'Which one?', 'I heard you.', 'Same as last time.', 'Stopping.', 'That is refused.']) {
      expect(ACK_LINES).toContain(line);
    }
    // The turn engine's, the planner's and action memory's own constants are banked verbatim.
    for (const line of [ONE_MOMENT, DONE_WORD, SAME_AS_LAST_TIME, 'Very well.', 'Stopped before I began, as asked.', 'I am still working out the last request.', 'That timed out; nothing happened for a minute.', 'Stopped there, as asked.']) {
      expect(ACK_LINES).toContain(line);
    }
    expect(ACK_LINES.length).toBeGreaterThanOrEqual(24);
    expect(new Set(ACK_LINES).size).toBe(ACK_LINES.length);
    for (const line of ACK_LINES) expect(line).toBe(ackText(line));
  });

  it('names a file by profile, checkpoint and text, so another checkpoint never finds it', () => {
    const a = ackFile('jarvis', 'F5TTS_v1_Base', 'Done.');
    expect(a).toMatch(/^[0-9a-f]{8}\.wav$/);
    expect(ackFile('jarvis', 'F5TTS_v1_Base', ' Done. ')).toBe(a);
    expect(ackFile('jarvis', 'model_1200.pt', 'Done.')).not.toBe(a);
    expect(ackFile('william', 'F5TTS_v1_Base', 'Done.')).not.toBe(a);
    expect(fnv1a('')).toBe('811c9dc5');
  });

  it('rebuilds for a new checkpoint or profile, tops up otherwise', () => {
    const index = { profile: 'jarvis', checkpoint: 'A', builtAt: '', lines: { 'Done.': ackFile('jarvis', 'A', 'Done.') } };
    expect(ackToBuild(null, 'jarvis', 'A', ['Done.', 'On it.'])).toEqual({ rebuild: true, missing: ['Done.', 'On it.'] });
    expect(ackToBuild(index, 'jarvis', 'A', ['Done.', 'On it.', 'On it.'])).toEqual({ rebuild: false, missing: ['On it.'] });
    expect(ackToBuild(index, 'jarvis', 'B', ['Done.'])).toEqual({ rebuild: true, missing: ['Done.'] });
    expect(ackToBuild(index, 'william', 'A', ['Done.'])).toEqual({ rebuild: true, missing: ['Done.'] });
  });

  it('matches exactly: the same words, whitespace aside; never a near miss, never another checkpoint', () => {
    const index = normaliseAckIndex({ profile: 'jarvis', checkpoint: 'A', builtAt: 'x', lines: { 'Done.': 'deadbeef.wav', 'bad': '../x.wav' } });
    expect(index?.lines).toEqual({ 'Done.': 'deadbeef.wav' });
    expect(ackLookup(index, 'jarvis', 'A', 'Done.')).toBe('deadbeef.wav');
    expect(ackLookup(index, 'jarvis', null, '  Done.  ')).toBe('deadbeef.wav');
    expect(ackLookup(index, 'jarvis', 'A', 'Done, sir.')).toBeNull();
    expect(ackLookup(index, 'jarvis', 'A', 'done.')).toBeNull();
    expect(ackLookup(index, 'jarvis', 'B', 'Done.')).toBeNull();
    expect(ackLookup(index, 'william', 'A', 'Done.')).toBeNull();
    expect(normaliseAckIndex({ profile: 1 })).toBeNull();
  });
});

describe('the acknowledgement bank: on disk', () => {
  const wav = (): Uint8Array => { const b = new Uint8Array(64); b.set([82, 73, 70, 70]); return b; };
  function deps(root: string, over: Partial<AckBankDeps> = {}): AckBankDeps & { synthesised: string[] } {
    const synthesised: string[] = [];
    return {
      synthesised,
      profileDir: (p) => join(root, p),
      synthesise: async (text) => { synthesised.push(text); return wav(); },
      busy: () => false,
      stillWanted: () => true,
      ...over
    };
  }
  afterEach(() => clearAckCache());

  it('synthesises each line once under <profile>/ack, then plays it from disk', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skynet-ack-'));
    const d = deps(root);
    expect(await buildAckBank(d, 'jarvis', 'A', ['Done.', 'On it.'])).toBe(2);
    expect(d.synthesised).toEqual(['Done.', 'On it.']);
    const file = bankedWav(d, 'jarvis', 'A', 'Done.');
    expect(file).toBe(join(root, 'jarvis', 'ack', ackFile('jarvis', 'A', 'Done.')));
    expect(existsSync(file!)).toBe(true);
    expect(bankedWav(d, 'jarvis', null, 'On it.')).not.toBeNull();
    expect(bankedWav(d, 'jarvis', 'A', 'Right away.')).toBeNull();
    // Built: a second build synthesises nothing.
    expect(await buildAckBank(d, 'jarvis', 'A', ['Done.', 'On it.'])).toBe(0);
    expect(d.synthesised).toHaveLength(2);
    expect(JSON.parse(readFileSync(join(root, 'jarvis', 'ack', 'index.json'), 'utf8')).checkpoint).toBe('A');
  });

  it('rebuilds when the checkpoint changes, and the old checkpoint\'s lines are not played', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skynet-ack-'));
    const d = deps(root);
    await buildAckBank(d, 'jarvis', 'A', ['Done.']);
    clearAckCache();
    expect(bankedWav(d, 'jarvis', 'B', 'Done.')).toBeNull();
    expect(await buildAckBank(d, 'jarvis', 'B', ['Done.'])).toBe(1);
    clearAckCache();
    expect(readAckIndex(d, 'jarvis')?.checkpoint).toBe('B');
    expect(bankedWav(d, 'jarvis', 'B', 'Done.')).toBe(join(root, 'jarvis', 'ack', ackFile('jarvis', 'B', 'Done.')));
  });

  it('waits while JARVIS is speaking, and stops when the profile is no longer wanted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skynet-ack-'));
    let busyFor = 2;
    let wanted = true;
    const d = deps(root, {
      busy: () => busyFor-- > 0,
      stillWanted: () => wanted
    });
    const synth = d.synthesise;
    d.synthesise = async (text, p) => { const r = await synth(text, p); wanted = false; return r; };
    expect(await buildAckBank(d, 'jarvis', 'A', ['Done.', 'On it.', 'Stopping.'])).toBe(1);
    expect(d.synthesised).toEqual(['Done.']);
  });

  it('skips a line the server will not make; it is synthesised when said', async () => {
    const root = mkdtempSync(join(tmpdir(), 'skynet-ack-'));
    const d = deps(root, { synthesise: async (text) => (text === 'On it.' ? null : wav()) });
    expect(await buildAckBank(d, 'jarvis', 'A', ['Done.', 'On it.'])).toBe(1);
    expect(bankedWav(d, 'jarvis', 'A', 'On it.')).toBeNull();
  });
});

/* ────────────────────────── the first sentence first ────────────────────────── */

describe('splitFirstSentence', () => {
  it('splits a two-sentence reply at the first sentence end', () => {
    expect(splitFirstSentence('The board shows twelve nodes in the root room, sir. Two Claude Code sessions are running.'))
      .toEqual(['The board shows twelve nodes in the root room, sir.', 'Two Claude Code sessions are running.']);
    expect(splitFirstSentence('Is that the Firefox on two? I see two of them open right now.'))
      .toEqual(['Is that the Firefox on two?', 'I see two of them open right now.']);
  });

  it('leaves one sentence, a short head or a short tail whole', () => {
    expect(splitFirstSentence('Opening Firefox on monitor two now.')).toBeNull();
    expect(splitFirstSentence('Done. Firefox is open on two.')).toBeNull();
    expect(splitFirstSentence('Firefox is open on monitor two. Done.')).toBeNull();
    expect(splitFirstSentence('Version 2.5 of the tool is installed on this machine.')).toBeNull();
  });

  it('does not split after an abbreviation', () => {
    expect(splitFirstSentence('I have asked Dr. Smith about the schedule for the meeting. He has not answered.'))
      .toEqual(['I have asked Dr. Smith about the schedule for the meeting.', 'He has not answered.']);
  });
});

/* ────────────────────────── where the time goes ────────────────────────── */

describe('turn timing (pure)', () => {
  it('prints the line the brief asked for', () => {
    const t = newTiming(7, 'voice');
    markTiming(t, 'micClosed', 1000);
    markTiming(t, 'transcript', 1090);
    markTiming(t, 'intent', 1093);
    markTiming(t, 'modelAsked', 1093);
    markTiming(t, 'modelAnswered', 2490);
    markTiming(t, 'synthStart', 2490);
    markTiming(t, 'firstAudio', 2840);
    expect(timingLine(t)).toBe('[turn] heard→speak 1,840 ms (whisper 90, intent 3, model 1,397, synth 350)');
    expect(markTiming(t, 'micClosed', 5000)).toBe(false);
    expect(timingSpans(t).heardToSpeak).toBe(1840);
  });

  it('shows a banked first line, and heard→act for a plan', () => {
    const t = newTiming(8);
    markTiming(t, 'micClosed', 0);
    markTiming(t, 'transcript', 80);
    markTiming(t, 'intent', 85);
    markTiming(t, 'firstAudio', 140);
    markTiming(t, 'planFirstStep', 700);
    t.firstVia = 'bank';
    t.path = 'remembered';
    expect(timingLine(t)).toBe('[turn] heard→speak 140 ms · heard→act 700 ms (whisper 80, intent 5, synth 55 bank) · remembered');
    const rec = timingRecord(t, '2026-09-27T00:00:00Z');
    expect(rec['marks']).toEqual({ micClosed: 0, transcript: 80, intent: 85, firstAudio: 140, planFirstStep: 700 });
  });

  it('says nothing for a turn with nothing measured', () => {
    expect(timingLine(newTiming(1))).toBeNull();
  });
});

describe('turn timing (the service, through the engine)', () => {
  afterEach(() => { setTurnTimingFile(null); resetTiming(); });

  it('writes one JSON line per heard turn when it ends', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skynet-timing-'));
    const file = join(dir, 'turn-timing.jsonl');
    setTurnHandlers({ onState: () => undefined, onSentence: () => undefined });
    setTurnEffects({ say: async () => undefined, whenSpeechIdle: async () => true, halt: () => undefined, stopSpeaking: () => undefined });
    resetTurn();
    resetTiming();
    setTurnTimingFile(file);
    const t0 = 10_000_000;
    dispatch({ type: 'micOpened', kind: 'wake' }, t0);
    dispatch({ type: 'micClosed' }, t0 + 5);
    dispatch({ type: 'sentence', text: 'what time is it', origin: 'voice' }, t0 + 95);
    dispatch({ type: 'thinking', detail: 'ASKING CLAUDE' }, t0 + 97);
    markTurn('intent', { path: 'converse' }, t0 + 97);
    markTurn('modelAsked', {}, t0 + 98);
    markTurn('modelAnswered', {}, t0 + 2500);
    markTurn('synthStart', {}, t0 + 2500);
    dispatch({ type: 'speakStart', text: 'It is two.' }, t0 + 3700);
    markTurn('firstAudio', { via: 'server' }, t0 + 3700);
    dispatch({ type: 'speakEnd' }, t0 + 4500);
    expect(currentTiming()?.marks.micClosed).toBe(t0 + 5);
    dispatch({ type: 'done' }, t0 + 4600);
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]!);
    expect(rec.outcome).toBe('done');
    expect(rec.path).toBe('converse');
    expect(rec.spans).toMatchObject({ heardToSpeak: 3695, whisper: 90, intent: 2, model: 2402, synth: 1200 });
    // A later mark cannot reopen a written turn.
    markTurn('planFirstStep', {}, t0 + 9000);
    dispatch({ type: 'tick' }, t0 + 9000);
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('writes a stopped turn as stopped, and nothing for a turn nobody spoke', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skynet-timing-'));
    const file = join(dir, 'turn-timing.jsonl');
    resetTurn();
    resetTiming();
    setTurnTimingFile(file);
    dispatch({ type: 'planStarted', of: 2 }, 1);
    dispatch({ type: 'step', index: 0, label: 'FOCUS FIREFOX' }, 2);
    dispatch({ type: 'stop' }, 3);
    expect(existsSync(file)).toBe(false);
    dispatch({ type: 'sentence', text: 'open firefox', origin: 'typed' }, 10);
    dispatch({ type: 'thinking', detail: 'PLANNING' }, 11);
    dispatch({ type: 'stop' }, 20);
    expect(JSON.parse(readFileSync(file, 'utf8').trim()).outcome).toBe('stopped');
  });
});

/* ────────────────────────── the watchdog and a long synthesis ────────────────────────── */

describe('the watchdog does not fire during a legitimately long synthesis', () => {
  it('a progress event moves only the watchdog clock, and only in a busy turn', () => {
    let s = turnReduce(TURN_IDLE, { type: 'sentence', text: 'tell me about the board' }, 1000);
    s = turnReduce(s, { type: 'thinking', detail: 'ASKING CLAUDE' }, 1001);
    // A model call and a cold synthesis: 70 s with a heartbeat every 5 s from speech.ts.
    for (let t = 5001; t <= 71_001; t += 5000) s = turnReduce(s, { type: 'progress' }, t);
    s = turnReduce(s, { type: 'tick' }, 72_000);
    expect(s.phase).toBe('thinking');
    expect(s.detail).toBe('ASKING CLAUDE');
    expect(turnReduce(s, { type: 'tick' }, 71_001 + WATCHDOG_MS + 1).error).toBe(TIMED_OUT);
    expect(turnReduce(TURN_IDLE, { type: 'progress' }, 5)).toBe(TURN_IDLE);
  });
});

/* ────────────────────────── the planner and the headless call ────────────────────────── */

describe('the planner: the pause and the prompt', () => {
  it('pauses 1.5 s before a plan of several steps and 400 ms before one step', () => {
    expect(GRACE_MS).toBe(1500);
    expect(GRACE_SINGLE_MS).toBe(400);
    expect(graceMs([{}, {}])).toBe(1500);
    expect(graceMs([{}])).toBe(400);
  });

  it('lists at most 15 windows, the programs that share a word plus 20, and 10 recent plans', () => {
    expect(MAX_PROMPT_WINDOWS).toBe(15);
    expect(MAX_OTHER_PROGRAMS).toBe(20);
    expect(MAX_LOG_LINES).toBe(10);
    const apps = [...Array.from({ length: 300 }, (_, i) => ({ name: `Program ${String(i).padStart(3, '0')}`, path: '', source: 'startmenu' as const })), { name: 'Mozilla Firefox', path: '', source: 'startmenu' as const }, { name: 'Firefox Developer Edition', path: '', source: 'startmenu' as const }];
    const windows = Array.from({ length: 40 }, (_, i) => ({ title: `Window ${i}`, process: `p${i}`, monitor: 1, minimized: false, foreground: i === 0 }));
    const log = Array.from({ length: 30 }, (_, i) => JSON.stringify({ sentence: `sentence ${i}`, steps: [{ kind: 'launch' }], ok: true }));
    const p = plannerPrompt({ sentence: 'open firefox on two', windows, monitors: [], apps, actions: [], log });
    expect(p.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
    const programs = p.split('# PROGRAMS')[1]!.split('\n')[1]!.split('; ');
    expect(programs.slice(0, 2).sort()).toEqual(['Firefox Developer Edition', 'Mozilla Firefox']);
    expect(programs).toHaveLength(22);
    expect(p.split('\n').filter((l) => l.startsWith('- "Window '))).toHaveLength(15);
    expect(p.split('\n').filter((l) => l.startsWith('- "sentence '))).toHaveLength(10);
    expect(p).toContain('- "sentence 29"');
  });
});

describe('the headless claude call', () => {
  const opts = { model: 'claude-haiku-4-5-20251001', mcpConfig: 'C:/x/empty.json', system: 'You are JARVIS.' };

  it('can only answer text: no tools, no MCP server, no CLAUDE.md or hooks, no thinking', () => {
    const args = headlessClaudeArgs(opts);
    expect(args.slice(0, 1)).toEqual(['-p']);
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args).toContain('--safe-mode');
    expect(args).toContain('--strict-mcp-config');
    expect(args[args.indexOf('--mcp-config') + 1]).toBe(opts.mcpConfig);
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('dontAsk');
    expect(args[args.indexOf('--settings') + 1]).toBe(HEADLESS_SETTINGS);
    expect(JSON.parse(HEADLESS_SETTINGS)).toEqual({ alwaysThinkingEnabled: false });
    expect(HEADLESS_ENV['MAX_THINKING_TOKENS']).toBe('0');
    expect(args).toContain('--no-session-persistence');
    expect(args[args.indexOf('--system-prompt') + 1]).toBe(opts.system);
    expect(args).not.toContain('--append-system-prompt');
    for (const tool of ['Bash', 'PowerShell', 'Edit', 'Write', 'Read', 'WebFetch', 'Agent']) expect(HEADLESS_DISALLOWED).toContain(tool);
    const denied = args.slice(args.indexOf('--disallowedTools') + 1, args.indexOf('--system-prompt'));
    expect(denied).toEqual(HEADLESS_DISALLOWED);
    expect(args.join(' ')).not.toMatch(/--allowedTools|--dangerously|bypassPermissions/);
  });

  it('falls back to the 2026-09-24 list for a CLI that does not know the lean arguments', () => {
    const legacy = headlessClaudeArgs({ ...opts, legacy: true });
    expect(legacy).toContain('--append-system-prompt');
    expect(legacy).not.toContain('--safe-mode');
    expect(legacy).not.toContain('--tools');
    expect(legacy).toContain('--disallowedTools');
    expect(unknownOption("error: unknown option '--safe-mode'")).toBe(true);
    expect(unknownOption('API Error: 529 overloaded')).toBe(false);
  });
});

/* ────────────────────────── bug sweep: plans, stream mode, the sidecar ────────────────────────── */

describe('a plan stops after a failed step when what is left would act on the wrong window', () => {
  const keys: DesktopStep = { kind: 'keys', text: 'Dear Sam' };
  const launch: DesktopStep = { kind: 'launch', app: 'Notepad', monitor: 2 };
  it('stops before typing, clicking, scrolling or moving the pointer', () => {
    expect(stopsAfterFailure([keys])).toBe(true);
    expect(stopsAfterFailure([{ kind: 'uiaClick', window: 'Word', control: 'Save' }])).toBe(true);
    expect(stopsAfterFailure([{ kind: 'scroll', direction: 'down', notches: 3 }])).toBe(true);
    expect(stopsAfterFailure([{ kind: 'mouse', x: 1, y: 1, click: 'left' }])).toBe(true);
  });
  it('goes on to launches and moves, which stand alone', () => {
    expect(stopsAfterFailure([launch, { kind: 'place', window: 'Firefox', monitor: 1 }])).toBe(false);
    expect(stopsAfterFailure([])).toBe(false);
  });
});

describe('stream mode never shows what is being typed', () => {
  it('cuts a TYPE label to TYPE, and nothing else', () => {
    expect(streamLabel("TYPE 'HELLO SAM'", true)).toBe('TYPE');
    expect(streamLabel("TYPE 'HELLO SAM'", false)).toBe("TYPE 'HELLO SAM'");
    expect(streamLabel('FOCUS FIREFOX', true)).toBe('FOCUS FIREFOX');
    let s = turnReduce(TURN_IDLE, { type: 'planStarted', of: 2 }, 1);
    s = turnReduce(s, { type: 'step', index: 1, label: "TYPE 'HELLO SAM'" }, 2);
    expect(turnView(s, true).progress).toBe('2 / 2 · TYPE');
    expect(turnView(s, false).progress).toBe("2 / 2 · TYPE 'HELLO SAM'");
  });
});

describe('the sidecar plays a WAV so that "stop" ends it at once', () => {
  const script = speechScript();
  it('plays asynchronously on its own thread and cuts the wait on stop', () => {
    expect(script).toContain('public void Play(string path)');
    expect(script).toContain('p.Play();');
    expect(script).toContain('cut.WaitOne(');
    expect(script).toContain('cut.Set();');
    expect(script).not.toContain('PlaySync');
    expect(script).toContain('$speaker.Play([string]$msg.play)');
    expect(script).toContain('Emit("PLAYED " + path)');
  });
});
