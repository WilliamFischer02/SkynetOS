/**
 * One turn at a time (packages/shared/turn.ts, src/main/services/turn.ts; docs/11 § One turn at a
 * time). William, after the first live session: "doesn't stack voice commands or prompt to listen
 * again until the current requested task is completed … the listening brighten animation keeps
 * going the entire time Jarvis listens … never confuses the user as to whether they've been heard
 * or if the action is in progress."
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  DONE_HOLD_MS,
  FAILED_HOLD_MS,
  ONE_MOMENT,
  TIMED_OUT,
  TURN_IDLE,
  WATCHDOG_MS,
  elapsedLabel,
  isStopSentence,
  mayFollowUp,
  stepLabel,
  turnBusy,
  turnReduce,
  turnView,
  type TurnEvent,
  type TurnPhase,
  type TurnState
} from '@shared/turn.js';
import { FOREGROUND } from '@shared/desktop.js';
import { dispatch, finishTurn, reportTurn, resetTurn, sentence, setTurnEffects, setTurnHandlers, turnState } from '../src/main/services/turn.js';

/** Run events from a state, each a millisecond apart unless an event says `at`. */
function play(events: (TurnEvent | [TurnEvent, number])[], from: TurnState = TURN_IDLE, start = 1000): TurnState {
  let state = from;
  let now = start;
  for (const item of events) {
    const [event, at] = Array.isArray(item) ? item : [item, now + 1];
    now = at;
    state = turnReduce(state, event, now);
  }
  return state;
}

/** A turn heard by wake and now working: heard "open firefox and notepad", then thinking. */
const heardTurn = (): TurnState =>
  play([
    { type: 'micOpened', kind: 'wake' },
    { type: 'speechStarted' },
    { type: 'micClosed' },
    { type: 'sentence', text: 'open firefox and notepad' }
  ]);

const ALL: TurnPhase[] = ['idle', 'listening', 'heard', 'thinking', 'speaking', 'acting', 'waiting', 'done', 'failed'];

describe('the phases of one turn', () => {
  it('walks listening → heard → thinking → speaking → acting → done → idle', () => {
    let s = play([{ type: 'micOpened', kind: 'wake' }]);
    expect(s.phase).toBe('listening');
    expect(s.mic).toBe('open');
    s = turnReduce(s, { type: 'speechStarted' }, 1100);
    expect(s.mic).toBe('speech');
    expect(turnView(s).detail).toBe('HEARING YOU');
    // `heard` the moment the endpointer closes, before the transcript is back.
    s = turnReduce(s, { type: 'micClosed' }, 1200);
    expect(s.phase).toBe('heard');
    expect(s.mic).toBe('closed');
    expect(turnView(s).detail).toBe('TRANSCRIBING');
    s = turnReduce(s, { type: 'sentence', text: '  open   firefox ' }, 1300);
    expect(s.phase).toBe('heard');
    expect(s.transcript).toBe('open firefox');
    const id = s.turnId;
    s = turnReduce(s, { type: 'thinking', detail: 'PLANNING' }, 1400);
    expect(s.phase).toBe('thinking');
    s = turnReduce(s, { type: 'speakStart', text: 'Opening Firefox.' }, 1500);
    expect(s.phase).toBe('speaking');
    expect(s.saying).toBe('Opening Firefox.');
    s = turnReduce(s, { type: 'speakEnd' }, 1600);
    expect(s.phase).toBe('thinking');
    s = turnReduce(s, { type: 'planStarted', of: 2 }, 1700);
    expect(s.phase).toBe('acting');
    s = turnReduce(s, { type: 'step', index: 1, label: 'FOCUS FIREFOX' }, 1800);
    expect(s.step).toEqual({ index: 1, of: 2, label: 'FOCUS FIREFOX' });
    s = turnReduce(s, { type: 'done' }, 1900);
    expect(s.phase).toBe('done');
    // The transcript is shown for the whole turn, and it is the same turn throughout.
    expect(s.transcript).toBe('open firefox');
    expect(s.turnId).toBe(id);
    s = turnReduce(s, { type: 'tick' }, 1900 + DONE_HOLD_MS);
    expect(s.phase).toBe('idle');
  });

  it('asks a question and then waits for him', () => {
    const s = play([{ type: 'thinking', detail: 'PLANNING' }, { type: 'ask', question: 'Which monitor, sir?' }], heardTurn());
    expect(s.phase).toBe('waiting');
    expect(turnView(s).detail).toBe('Which monitor, sir?');
    expect(mayFollowUp(s)).toBe(true);
  });

  it('keeps a failure on screen 4 s and DONE 2 s', () => {
    const failed = turnReduce(heardTurn(), { type: 'failed', error: 'FIREFOX WOULD NOT START' }, 5000);
    expect(failed.phase).toBe('failed');
    expect(turnReduce(failed, { type: 'tick' }, 5000 + FAILED_HOLD_MS - 1).phase).toBe('failed');
    expect(turnReduce(failed, { type: 'tick' }, 5000 + FAILED_HOLD_MS).phase).toBe('idle');
    const done = turnReduce(heardTurn(), { type: 'done' }, 5000);
    expect(turnReduce(done, { type: 'tick' }, 5000 + DONE_HOLD_MS - 1).phase).toBe('done');
    expect(turnReduce(done, { type: 'tick' }, 5000 + DONE_HOLD_MS).phase).toBe('idle');
    expect(DONE_HOLD_MS).toBe(2000);
    expect(FAILED_HOLD_MS).toBe(4000);
  });

  it('keeps FAILED while its own line is said over it', () => {
    let s = turnReduce(heardTurn(), { type: 'failed', error: 'NO' }, 5000);
    s = turnReduce(s, { type: 'speakStart', text: 'Firefox would not start.' }, 5100);
    expect(s.phase).toBe('failed');
    s = turnReduce(s, { type: 'speakEnd' }, 5200);
    expect(s.phase).toBe('failed');
  });

  it('a press (a profile line, dictation) lights LISTENING and ends with its tracks, starting no turn', () => {
    let s = play([{ type: 'micOpened', kind: 'press', detail: 'DICTATION' }]);
    expect(s.phase).toBe('listening');
    expect(turnView(s).detail).toBe('DICTATION');
    s = turnReduce(s, { type: 'micClosed' }, 2000);
    expect(s.phase).toBe('idle');
    expect(s.mic).toBe('closed');
  });

  it('closes on silence with nothing heard', () => {
    let s = play([{ type: 'micOpened', kind: 'followUp' }]);
    expect(turnView(s).detail).toMatch(/NO WAKE WORD/);
    s = turnReduce(s, { type: 'micClosed' }, 3000);
    s = turnReduce(s, { type: 'nothingHeard' }, 3001);
    expect(s.phase).toBe('idle');
  });
});

describe('no stacking: a sentence during a busy turn is held, never started', () => {
  for (const phase of ['thinking', 'speaking', 'acting'] as const) {
    it(`while ${phase}`, () => {
      let s = heardTurn();
      if (phase === 'thinking') s = turnReduce(s, { type: 'thinking', detail: 'PLANNING' }, 2000);
      if (phase === 'speaking') s = turnReduce(turnReduce(s, { type: 'thinking', detail: 'X' }, 2000), { type: 'speakStart', text: 'Very well.' }, 2001);
      if (phase === 'acting') s = turnReduce(s, { type: 'planStarted', of: 3 }, 2000);
      expect(turnBusy(s)).toBe(true);
      const id = s.turnId;
      const held = turnReduce(s, { type: 'sentence', text: 'then open notepad' }, 2100);
      expect(held.phase).toBe(phase);
      expect(held.turnId).toBe(id);
      expect(held.transcript).toBe('open firefox and notepad');
      expect(held.pending).toBe('then open notepad');
      expect(held.acked).toBe(true);
      expect(turnView(held).pending).toBe('then open notepad');
    });
  }

  it('holds at most one: a second replaces the first, and "One moment." is due once', () => {
    let s = turnReduce(heardTurn(), { type: 'planStarted', of: 3 }, 2000);
    s = turnReduce(s, { type: 'sentence', text: 'open notepad' }, 2100);
    expect(s.acked).toBe(true);
    s = turnReduce(s, { type: 'sentence', text: 'no, open word' }, 2200);
    expect(s.pending).toBe('no, open word');
    expect(s.acked).toBe(true);
  });

  it('starts the held sentence as the next turn once this one is done', () => {
    let s = turnReduce(heardTurn(), { type: 'planStarted', of: 1 }, 2000);
    s = turnReduce(s, { type: 'sentence', text: 'open notepad' }, 2100);
    const id = s.turnId;
    s = turnReduce(s, { type: 'done' }, 3000);
    expect(mayFollowUp(s)).toBe(false); // the held sentence comes first
    s = turnReduce(s, { type: 'takePending' }, 3001);
    expect(s.phase).toBe('heard');
    expect(s.transcript).toBe('open notepad');
    expect(s.turnId).toBe(id + 1);
    expect(s.pending).toBeUndefined();
    expect(s.acked).toBe(false);
  });

  it('drops the held sentence when the turn fails, and says so', () => {
    let s = turnReduce(heardTurn(), { type: 'planStarted', of: 1 }, 2000);
    s = turnReduce(s, { type: 'sentence', text: 'then type hello' }, 2100);
    s = turnReduce(s, { type: 'failed', error: 'FIREFOX WOULD NOT START' }, 2200);
    expect(s.pending).toBeUndefined();
    expect(s.dropped).toBe('then type hello');
    expect(turnView(s).detail).toMatch(/HELD COMMAND WAS DROPPED/);
    expect(turnReduce(s, { type: 'takePending' }, 2300).phase).toBe('failed');
  });

  it('a wake phrase during a busy turn opens the light, not a new turn', () => {
    let s = turnReduce(heardTurn(), { type: 'planStarted', of: 2 }, 2000);
    s = turnReduce(s, { type: 'micOpened', kind: 'wake' }, 2100);
    expect(s.phase).toBe('acting');
    expect(s.mic).toBe('open');
    expect(turnView(s).mic).toBe(true);
    s = turnReduce(s, { type: 'micClosed' }, 2200);
    expect(s.phase).toBe('acting');
    expect(s.mic).toBe('closed');
    s = turnReduce(s, { type: 'nothingHeard' }, 2300);
    expect(s.phase).toBe('acting');
  });
});

describe('the follow-up is permitted only once the turn has ended', () => {
  it('from done, waiting or idle; never from anything else', () => {
    for (const phase of ALL) {
      const s: TurnState = { ...TURN_IDLE, phase };
      expect(mayFollowUp(s)).toBe(phase === 'done' || phase === 'waiting' || phase === 'idle');
    }
  });

  it('never from acting, thinking or speaking, whatever else is true', () => {
    for (const phase of ['acting', 'thinking', 'speaking', 'heard', 'listening', 'failed'] as const) {
      expect(mayFollowUp({ ...TURN_IDLE, phase, mic: 'closed' })).toBe(false);
    }
  });

  it('never over an open microphone or a held sentence', () => {
    expect(mayFollowUp({ ...TURN_IDLE, phase: 'done', mic: 'open' })).toBe(false);
    expect(mayFollowUp({ ...TURN_IDLE, phase: 'done', pending: 'x' })).toBe(false);
  });

  it('a spoken read-back does not end the turn: the planner line ends, the turn is still THINKING', () => {
    // The bug William saw: speech `done` opened the follow-up before the plan moved.
    let s = turnReduce(heardTurn(), { type: 'thinking', detail: 'PLANNING' }, 2000);
    s = turnReduce(s, { type: 'speakStart', text: 'Opening Firefox and Notepad.' }, 3000);
    s = turnReduce(s, { type: 'speakEnd' }, 4000);
    expect(s.phase).toBe('thinking');
    expect(mayFollowUp(s)).toBe(false);
  });
});

describe('stop', () => {
  it('from any phase is idle, with nothing held and a new turn id', () => {
    const froms: TurnState[] = [
      play([{ type: 'micOpened', kind: 'wake' }]),
      heardTurn(),
      turnReduce(heardTurn(), { type: 'thinking', detail: 'x' }, 2000),
      turnReduce(turnReduce(heardTurn(), { type: 'planStarted', of: 2 }, 2000), { type: 'sentence', text: 'held' }, 2001),
      turnReduce(heardTurn(), { type: 'speakStart', text: 'x' }, 2000),
      turnReduce(heardTurn(), { type: 'ask', question: 'x?' }, 2000),
      turnReduce(heardTurn(), { type: 'done' }, 2000),
      turnReduce(heardTurn(), { type: 'failed', error: 'x' }, 2000)
    ];
    for (const from of froms) {
      const s = turnReduce(from, { type: 'stop' }, 9000);
      expect(s.phase).toBe('idle');
      expect(s.pending).toBeUndefined();
      expect(s.turnId).toBe(from.turnId + 1);
    }
  });

  it('knows "Jarvis, stop" in its variants, and nothing longer', () => {
    for (const t of ['stop', 'Stop.', 'Jarvis, stop!', 'hey jarvis stop that', 'cancel that', 'never mind', 'stop please', 'hold on', 'enough']) {
      expect(isStopSentence(t)).toBe(true);
    }
    for (const t of ['stop listening', 'stop the dictation', 'open notepad', 'stop firefox from opening', '']) {
      expect(isStopSentence(t)).toBe(false);
    }
  });
});

describe('the watchdog', () => {
  it('fails acting after 60 s with no step, and not before', () => {
    const s = turnReduce(heardTurn(), { type: 'planStarted', of: 3 }, 10_000);
    expect(turnReduce(s, { type: 'tick' }, 10_000 + WATCHDOG_MS).phase).toBe('acting');
    const failed = turnReduce(s, { type: 'tick' }, 10_000 + WATCHDOG_MS + 1);
    expect(failed.phase).toBe('failed');
    expect(failed.error).toBe(TIMED_OUT);
    expect(TIMED_OUT).toBe('TIMED OUT — nothing happened for 60 s');
  });

  it('is reset by every step', () => {
    let s = turnReduce(heardTurn(), { type: 'planStarted', of: 3 }, 10_000);
    s = turnReduce(s, { type: 'step', index: 1, label: 'LAUNCH NOTEPAD' }, 10_000 + 50_000);
    expect(turnReduce(s, { type: 'tick' }, 10_000 + 100_000).phase).toBe('acting');
    expect(turnReduce(s, { type: 'tick' }, 10_000 + 50_000 + WATCHDOG_MS + 1).phase).toBe('failed');
  });

  it('fails thinking, and a heard sentence nobody acted on, after 60 s', () => {
    const thinking = turnReduce(heardTurn(), { type: 'thinking', detail: 'ASKING CLAUDE' }, 10_000);
    expect(turnReduce(thinking, { type: 'tick' }, 10_000 + WATCHDOG_MS + 1).phase).toBe('failed');
    const heard = heardTurn();
    expect(turnReduce(heard, { type: 'tick' }, heard.progressAt + WATCHDOG_MS + 1).phase).toBe('failed');
  });

  it('never fails a turn that is waiting for him, done, or idle', () => {
    for (const s of [turnReduce(heardTurn(), { type: 'ask', question: 'x?' }, 10_000), { ...TURN_IDLE }]) {
      expect(turnReduce(s, { type: 'tick' }, 10_000 + 10 * WATCHDOG_MS).phase).not.toBe('failed');
    }
  });
});

describe('the connective continuation, as the light and the strip see it', () => {
  it('reopens as LISTENING with the words so far, then hears the whole sentence', () => {
    let s = play([{ type: 'micOpened', kind: 'wake' }, { type: 'micClosed' }]);
    const id = s.turnId;
    s = turnReduce(s, { type: 'partialTranscript', text: 'Open Firefox and' }, 2000);
    s = turnReduce(s, { type: 'micOpened', kind: 'wake', continuation: true }, 2100);
    expect(s.phase).toBe('listening');
    expect(s.turnId).toBe(id);
    expect(turnView(s).detail).toBe('GO ON · “Open Firefox and …”');
    s = turnReduce(s, { type: 'micClosed' }, 3000);
    s = turnReduce(s, { type: 'sentence', text: 'Open Firefox and go to YouTube.' }, 3100);
    expect(s.phase).toBe('heard');
    expect(s.transcript).toBe('Open Firefox and go to YouTube.');
    expect(s.partial).toBeUndefined();
    expect(s.turnId).toBe(id);
  });

  it('a line spoken while the microphone is open never takes LISTENING away', () => {
    let s = play([{ type: 'micOpened', kind: 'followUp' }]);
    s = turnReduce(s, { type: 'speakStart', text: 'This is David.' }, 2000);
    expect(s.phase).toBe('listening');
    s = turnReduce(s, { type: 'speakEnd' }, 2100);
    expect(s.phase).toBe('listening');
    expect(turnView(s).mic).toBe(true);
  });
});

describe('step labels', () => {
  it('reads each step as William would say it', () => {
    expect(stepLabel({ kind: 'focus', window: 'Firefox' })).toBe('FOCUS FIREFOX');
    expect(stepLabel({ kind: 'keys', combo: 'space' })).toBe('PRESS SPACE');
    expect(stepLabel({ kind: 'keys', combo: 'ctrl + t' })).toBe('PRESS CTRL+T');
    expect(stepLabel({ kind: 'launch', app: 'Notepad' })).toBe('LAUNCH NOTEPAD');
    expect(stepLabel({ kind: 'launch', app: 'Firefox', monitor: 2 })).toBe('LAUNCH FIREFOX ON TWO');
    expect(stepLabel({ kind: 'uiaClick', window: 'Firefox', control: 'New Tab' })).toBe("CLICK 'NEW TAB'");
    expect(stepLabel({ kind: 'keys', text: 'hello from jarvis' })).toBe("TYPE 'hello from jarvis'");
    expect(stepLabel({ kind: 'place', window: FOREGROUND, monitor: 3 })).toBe('MOVE THE WINDOW IN FRONT TO THREE');
    expect(stepLabel({ kind: 'url', url: 'https://youtube.com', site: 'youtube', browser: 'Firefox' })).toBe('OPEN YOUTUBE IN FIREFOX');
    expect(stepLabel({ kind: 'wait', ms: 1500 })).toBe('WAIT 1.5 S');
    expect(stepLabel({ kind: 'mouse', x: 10, y: 20, click: 'left' })).toBe('LEFT CLICK');
    expect(stepLabel({ kind: 'focus', window: 'firefox', focusByPointer: true })).toBe('FOCUS FIREFOX WITH THE MOUSE');
    expect(stepLabel({ kind: 'scroll', direction: 'down', notches: 3 })).toBe('SCROLL DOWN 3');
    // A step kind added later still reads as something.
    expect(stepLabel({ kind: 'split' })).toBe('SPLIT');
  });
});

describe('what the strip shows', () => {
  it('shows the step, the timer and STOP while acting', () => {
    let s = turnReduce(heardTurn(), { type: 'planStarted', of: 5 }, 2000);
    s = turnReduce(s, { type: 'step', index: 1, label: 'FOCUS FIREFOX' }, 2100);
    const view = turnView(s);
    expect(view.word).toBe('ACTING');
    expect(view.progress).toBe('2 / 5 · FOCUS FIREFOX');
    expect(view.fraction).toBeCloseTo(0.4);
    expect(view.timed).toBe(true);
    expect(view.stoppable).toBe(true);
    expect(view.transcript).toBe('open firefox and notepad');
  });

  it('hides what he said in stream mode', () => {
    const s = turnReduce(turnReduce(heardTurn(), { type: 'planStarted', of: 1 }, 2000), { type: 'sentence', text: 'secret' }, 2001);
    const view = turnView(s, true);
    expect(view.transcript).toBeNull();
    expect(view.pending).toBe('A COMMAND');
  });

  it('has a word for every phase, STOP only while something is going on', () => {
    for (const phase of ALL) {
      const view = turnView({ ...TURN_IDLE, phase });
      expect(view.word.length).toBeGreaterThan(0);
      expect(view.stoppable).toBe(phase === 'thinking' || phase === 'speaking' || phase === 'acting');
    }
    expect(elapsedLabel(0)).toBe('0:00');
    expect(elapsedLabel(65_400)).toBe('1:05');
  });
});

describe('the engine in main (services/turn.ts)', () => {
  afterEach(() => resetTurn());

  function wire(): { said: string[]; heard: { text: string; turnId?: number }[]; halted: number } {
    const log = { said: [] as string[], heard: [] as { text: string; turnId?: number }[], halted: 0 };
    setTurnHandlers({ onState: () => undefined, onSentence: (h) => log.heard.push({ text: h.text, turnId: h.turnId }) });
    setTurnEffects({
      say: async (text) => { log.said.push(text); },
      whenSpeechIdle: async () => true,
      halt: () => { log.halted++; },
      stopSpeaking: () => undefined
    });
    return log;
  }

  it('starts a turn for a sentence and sends it to the board with its id', () => {
    const log = wire();
    resetTurn();
    expect(sentence('open firefox', { confidence: 1, ms: 0, origin: 'voice' })).toBe('started');
    expect(log.heard).toEqual([{ text: 'open firefox', turnId: turnState().turnId }]);
  });

  it('holds a second sentence, says "One moment." once, and starts it after DONE', async () => {
    const log = wire();
    resetTurn();
    sentence('open firefox', { confidence: 1, ms: 0, origin: 'voice' });
    const first = turnState().turnId;
    dispatch({ type: 'planStarted', of: 2 });
    expect(sentence('open notepad', { confidence: 1, ms: 0, origin: 'voice' })).toBe('held');
    expect(sentence('open word', { confidence: 1, ms: 0, origin: 'typed' })).toBe('held');
    expect(log.said.filter((l) => l === ONE_MOMENT)).toHaveLength(1);
    expect(log.heard).toHaveLength(1);
    await finishTurn(first);
    await new Promise((r) => setTimeout(r, 0));
    expect(log.heard).toHaveLength(2);
    expect(log.heard[1]!.text).toBe('open word');
    expect(turnState().phase).toBe('heard');
  });

  it('obeys "stop" during a busy turn instead of holding it', () => {
    const log = wire();
    resetTurn();
    sentence('open firefox', { confidence: 1, ms: 0, origin: 'voice' });
    dispatch({ type: 'planStarted', of: 2 });
    expect(sentence('Jarvis, stop.', { confidence: 1, ms: 0, origin: 'voice' })).toBe('stopped');
    expect(turnState().phase).toBe('idle');
    expect(log.halted).toBe(1);
  });

  it('ignores a report for a turn that is over', () => {
    wire();
    resetTurn();
    sentence('zoom in', { confidence: 1, ms: 0, origin: 'voice' });
    const id = turnState().turnId;
    dispatch({ type: 'stop' });
    expect(reportTurn({ turnId: id, outcome: 'failed', text: 'late' }).ok).toBe(false);
    expect(turnState().phase).toBe('idle');
  });

  it('ends a board turn only after its line has been spoken', async () => {
    wire();
    resetTurn();
    let release: (v: boolean) => void = () => undefined;
    setTurnEffects({ say: async () => undefined, whenSpeechIdle: () => new Promise((r) => { release = r; }), halt: () => undefined, stopSpeaking: () => undefined });
    sentence('zoom in', { confidence: 1, ms: 0, origin: 'voice' });
    expect(reportTurn({ turnId: turnState().turnId, outcome: 'done', text: 'Zoomed in.' }).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(turnState().phase).toBe('heard');
    release(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(turnState().phase).toBe('done');
  });

  it('says the time-out once and halts the desktop', () => {
    const log = wire();
    resetTurn();
    sentence('open firefox', { confidence: 1, ms: 0, origin: 'voice' });
    const at = Date.now();
    dispatch({ type: 'planStarted', of: 2 }, at);
    dispatch({ type: 'tick' }, at + WATCHDOG_MS + 1);
    dispatch({ type: 'tick' }, at + WATCHDOG_MS + 2);
    expect(turnState().phase).toBe('failed');
    expect(log.halted).toBe(1);
    expect(log.said.filter((l) => /timed out/i.test(l))).toHaveLength(1);
  });

  it('says "Done." after a multi-step plan before DONE', async () => {
    const log = wire();
    resetTurn();
    dispatch({ type: 'planStarted', of: 3 });
    await finishTurn(turnState().turnId, undefined, { word: true });
    expect(log.said).toContain('Done.');
    expect(turnState().phase).toBe('done');
  });
});
