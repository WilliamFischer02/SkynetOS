/**
 * ONE turn at a time (docs/11 § One turn at a time; rules in docs/07 § Voice).
 *
 * William, after the first live session (2026-09-27): "Jarvis often starts listening again before
 * taking its first directed action … commands keep getting cut off … make sure an intelligent system
 * that doesn't stack voice commands or prompt to listen again until the current requested task is
 * completed … the listening brighten animation … sometimes turns off while Jarvis keeps listening …
 * one action at a time … never confuses the user as to whether they've been heard or if the action
 * is in progress … add an indicator that gives visual cues as to what Jarvis is doing in that exact
 * moment."
 *
 * Before this there were three streams (`voice:state`, `speech:state`, `desktop:state`) and every
 * view guessed the moment from them, which is how the follow-up window opened when the planner's
 * read-back FINISHED SPEAKING (before the plan had moved anything), and how the LISTENING light went
 * out while the microphone was still open (a desktop step outranked it). Now one reducer owns the
 * moment and everything obeys it:
 *
 *   idle ─micOpened─► listening ─micClosed─► heard ─sentence─► heard "…" ─► thinking / acting /
 *   speaking ─► done (2 s) ─► idle          ask ─► waiting (a question: the follow-up may open)
 *                                           failed (4 s, never a follow-up) ─► idle
 *
 * The rules, each tested in test/turn.test.ts:
 *  - `heard` is entered the moment the endpointer closes (`micClosed`), and shows the transcript
 *    from then until the turn ends, so William sees what was understood.
 *  - A sentence that arrives while a turn is `heard|thinking|speaking|acting` is NOT started: it is
 *    held as `pending` (one; a second replaces it) and answered "One moment." once per turn. It
 *    starts (`takePending`) when the turn ends in `done` or `waiting`; a `failed` or a `stop` drops it.
 *  - The follow-up listen is permitted only from `done`, `waiting` or `idle` (`mayFollowUp`), never
 *    while anything is still thinking, speaking or acting, and never with a sentence held.
 *  - `stop` from any phase is `idle`, and clears `pending`. A later event from the stopped turn's
 *    producer carries the old `turnId` and is ignored by the service.
 *  - `done` lasts 2 s, `failed` 4 s. `heard`, `thinking` or `acting` with no progress for 60 s is
 *    `failed('TIMED OUT — nothing happened for 60 s')` (the watchdog, on `tick`).
 *  - The microphone is its own field (`mic`), set only from the capture window's real track state,
 *    so the LISTENING light is on exactly while a track is open, whatever the phase.
 *
 * Pure: every event carries no clock; `turnReduce(state, event, now)` is given one.
 */

import { FOREGROUND, monitorWord, type DesktopStep } from './desktop.js';

export type TurnPhase = 'idle' | 'listening' | 'heard' | 'thinking' | 'speaking' | 'acting' | 'waiting' | 'done' | 'failed';

/** Which door opened the microphone (docs/07 § Voice): the wake phrase, the follow-up window, a press or a hotkey. */
export type MicKind = 'wake' | 'followUp' | 'press' | 'hotkey';

/** Where a turn came from, which decides who ends it (docs/11 § One turn at a time). */
export type TurnOrigin = 'voice' | 'typed' | 'plan' | 'other';

export interface TurnStep {
  /** 0-based: the step now running. */
  index: number;
  of: number;
  label: string;
}

export interface TurnState {
  /** Bumped at every new turn and at every stop, so a stale producer cannot move a later turn. */
  turnId: number;
  phase: TurnPhase;
  /** When this phase began (ms since the epoch; main and the windows share the clock). */
  since: number;
  /** The last phase change, step or line: what the watchdog measures from. */
  progressAt: number;
  origin?: TurnOrigin;
  /** A short line under the phase word: PLANNING, ASKING CLAUDE, HEARING YOU … */
  detail?: string;
  /** The sentence this turn is about, once transcribed. '' while transcribing. */
  transcript?: string;
  /** The words so far, when a sentence was continued after a connective (docs/11 § Endpointing). */
  partial?: string;
  step?: TurnStep;
  question?: string;
  error?: string;
  /** What `done` said about it, if anything. */
  summary?: string;
  /** The line being spoken. */
  saying?: string;
  /** Where `speaking` returns when the line ends. */
  resume?: TurnPhase;
  /** The capture window's microphone, as its tracks report it. The LISTENING light is this. */
  mic: 'closed' | 'open' | 'speech';
  micKind?: MicKind;
  /** A sentence heard while this turn was busy: held, never stacked. At most one. */
  pending?: string;
  /** "One moment." has been said this turn. */
  acked: boolean;
  /** The held sentence that a failure dropped, so the strip can say so. */
  dropped?: string;
}

export type TurnEvent =
  | { type: 'micOpened'; kind: MicKind; continuation?: boolean; detail?: string }
  | { type: 'speechStarted' }
  | { type: 'partialTranscript'; text: string }
  | { type: 'micClosed' }
  | { type: 'sentence'; text: string; origin?: 'voice' | 'typed' }
  | { type: 'nothingHeard' }
  | { type: 'thinking'; detail: string }
  | { type: 'speakStart'; text: string }
  | { type: 'speakEnd' }
  | { type: 'planStarted'; of: number; detail?: string }
  | { type: 'step'; index: number; label: string; of?: number }
  | { type: 'ask'; question: string }
  | { type: 'done'; summary?: string }
  | { type: 'failed'; error: string }
  | { type: 'stop' }
  | { type: 'reset' }
  | { type: 'takePending' }
  /**
   * Work is still going on that no phase shows: a line being synthesised (services/speech.ts, every
   * 5 s while a `say` is in flight). It moves only the watchdog's clock, and only in a busy turn.
   */
  | { type: 'progress' }
  | { type: 'tick' };

/** How long DONE stays on screen before READY. */
export const DONE_HOLD_MS = 2000;
/** How long a failure stays on screen (amber) before READY. */
export const FAILED_HOLD_MS = 4000;
/** Thinking or acting with no step for this long is a failure, said once. */
export const WATCHDOG_MS = 60_000;
export const TIMED_OUT = 'TIMED OUT — nothing happened for 60 s';
/** The one thing said to a sentence that arrives while a turn is busy. Once per turn. */
export const ONE_MOMENT = 'One moment.';
/** Said after a multi-step plan succeeds, so a silent success never looks like a failure. */
export const DONE_WORD = 'Done.';

export const TURN_IDLE: TurnState = { turnId: 0, phase: 'idle', since: 0, progressAt: 0, mic: 'closed', acked: false };

const BUSY: ReadonlySet<TurnPhase> = new Set(['heard', 'thinking', 'acting']);

/**
 * A turn is in progress: something was heard and is being worked on. `speaking` counts only when it
 * is part of such a turn (a line said with nothing going on, "This is David.", is not a turn).
 * `heard` with an empty transcript is the turn's own sentence being transcribed.
 */
export function turnBusy(state: TurnState): boolean {
  if (BUSY.has(state.phase)) return true;
  return state.phase === 'speaking' && state.resume !== undefined && BUSY.has(state.resume);
}

/**
 * May the follow-up window open now (docs/07 § Voice)? Only once the turn has ENDED: `done`, or
 * `waiting` (a question was asked and its line has been spoken), or `idle`. Never while anything is
 * thinking, speaking or acting, never after `failed`, never with a sentence held, never while a
 * microphone is already open. `mayListenAgain` (voice.ts) calls this besides its time rule.
 */
export function mayFollowUp(state: Pick<TurnState, 'phase' | 'pending' | 'mic'>): boolean {
  if (state.pending) return false;
  if (state.mic !== 'closed') return false;
  return state.phase === 'done' || state.phase === 'waiting' || state.phase === 'idle';
}

/** A new turn: a fresh id, nothing carried over but the microphone and a held sentence. */
function fresh(state: TurnState, now: number, phase: TurnPhase, origin: TurnOrigin): TurnState {
  return {
    turnId: state.turnId + 1,
    phase,
    since: now,
    progressAt: now,
    origin,
    mic: state.mic,
    ...(state.micKind ? { micKind: state.micKind } : {}),
    ...(state.pending ? { pending: state.pending } : {}),
    acked: false
  };
}

/** Same turn, new phase: the phase-scoped fields cleared, the turn's own kept. */
function enter(state: TurnState, now: number, phase: TurnPhase, extra: Partial<TurnState> = {}): TurnState {
  const { detail: _d, saying: _s, resume: _r, error: _e, summary: _m, ...rest } = state;
  return { ...rest, phase, since: now, progressAt: now, ...extra };
}

const clean = (text: string): string => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '');

export function turnReduce(state: TurnState, event: TurnEvent, now: number = Date.now()): TurnState {
  const busy = turnBusy(state);
  switch (event.type) {
    case 'micOpened': {
      const mic = { mic: 'open' as const, micKind: event.kind };
      // The rest of this turn's own sentence (it stopped on a connective): LISTENING again, same turn.
      if (event.continuation && (state.phase === 'listening' || (state.phase === 'heard' && !state.transcript))) {
        return enter(state, now, 'listening', { ...mic, detail: 'GO ON' });
      }
      // A wake phrase during a busy turn: the microphone opens (the light says so) but the turn
      // is not replaced. What it hears will be held.
      if (busy) return { ...state, ...mic };
      const next = fresh(state, now, 'listening', event.kind === 'wake' || event.kind === 'followUp' ? 'voice' : 'other');
      return { ...next, ...mic, ...(event.detail ? { detail: event.detail } : {}) };
    }
    case 'speechStarted':
      return state.mic === 'open' ? { ...state, mic: 'speech', ...(state.phase === 'listening' ? { detail: 'HEARING YOU' } : {}) } : state;
    case 'partialTranscript': {
      const text = clean(event.text);
      return text ? { ...state, partial: text } : state;
    }
    case 'micClosed': {
      const closed: TurnState = { ...state, mic: 'closed' };
      if (state.phase !== 'listening') return closed;
      // A sentence door: the turn now waits for its transcript. A press (a profile line, dictation)
      // is not a turn: it ends with the tracks.
      if (state.micKind === 'wake' || state.micKind === 'followUp') return enter(closed, now, 'heard', { transcript: '', detail: 'TRANSCRIBING' });
      return enter(closed, now, 'idle');
    }
    case 'nothingHeard': {
      const closed: TurnState = { ...state, mic: 'closed' };
      if (state.phase === 'listening' || (state.phase === 'heard' && !state.transcript)) {
        const { partial: _p, transcript: _t, ...rest } = closed;
        return enter(rest as TurnState, now, 'idle');
      }
      return closed;
    }
    case 'sentence': {
      const text = clean(event.text);
      if (!text) return state;
      const transcribing = state.phase === 'heard' && !state.transcript;
      if (busy && !transcribing) {
        // Held, never stacked: at most one, and a second replaces it.
        return { ...state, pending: text, acked: true };
      }
      const origin: TurnOrigin = event.origin ?? 'voice';
      const base = state.phase === 'listening' || transcribing ? state : fresh(state, now, 'heard', origin);
      const { partial: _p, question: _q, step: _st, dropped: _dr, ...rest } = base;
      return enter(rest as TurnState, now, 'heard', { transcript: text, origin: base.origin ?? origin });
    }
    case 'thinking': {
      if (state.phase === 'speaking' && state.resume && BUSY.has(state.resume)) {
        return { ...state, resume: 'thinking', detail: event.detail, progressAt: now };
      }
      if (busy) return enter(state, now, 'thinking', { detail: event.detail });
      return { ...fresh(state, now, 'thinking', 'other'), detail: event.detail };
    }
    case 'speakStart': {
      const text = clean(event.text);
      if (state.phase === 'speaking') return { ...state, saying: text, progressAt: now };
      // A failure's own line is said over the amber: the phase stays FAILED. A line while the
      // microphone is open for a sentence leaves LISTENING alone: the tracks decide that phase.
      if (state.phase === 'failed' || state.phase === 'listening') return { ...state, saying: text };
      const { detail, ...rest } = state;
      return { ...rest, phase: 'speaking', since: now, progressAt: now, saying: text, resume: state.phase, ...(detail ? { detail } : {}) };
    }
    case 'speakEnd': {
      if (state.phase === 'failed' || state.phase === 'listening') { const { saying: _s, ...rest } = state; return rest; }
      if (state.phase !== 'speaking') return state;
      const back = state.resume ?? 'idle';
      const { saying: _s, resume: _r, ...rest } = state;
      // Back to where the line interrupted, with that phase's clock restarted (a DONE shows 2 s).
      return { ...(rest as TurnState), phase: back, since: now, progressAt: now };
    }
    case 'planStarted': {
      const step: TurnStep = { index: 0, of: Math.max(1, Math.round(event.of) || 1), label: event.detail ?? 'STARTING' };
      if (state.phase === 'speaking' && state.resume && BUSY.has(state.resume)) return { ...state, resume: 'acting', step, progressAt: now };
      if (busy) return enter(state, now, 'acting', { step });
      // Nothing was heard: a plan from a gesture or a panel is its own turn, and ends itself.
      return { ...fresh(state, now, 'acting', 'plan'), step };
    }
    case 'step': {
      const of = event.of ?? state.step?.of ?? event.index + 1;
      const step: TurnStep = { index: Math.max(0, Math.round(event.index)), of: Math.max(1, of), label: event.label };
      if (state.phase === 'speaking') return { ...state, step, progressAt: now, ...(state.resume && BUSY.has(state.resume) ? { resume: 'acting' as const } : {}) };
      if (state.phase === 'acting') return { ...state, step, progressAt: now };
      if (busy) return enter(state, now, 'acting', { step });
      return state;
    }
    case 'ask': {
      const question = clean(event.question);
      if (state.phase === 'speaking') return { ...state, resume: 'waiting', question, progressAt: now };
      return enter(state, now, 'waiting', { question });
    }
    case 'done': {
      if (state.phase === 'idle' || state.phase === 'failed') return state;
      const { saying: _s, resume: _r, ...rest } = state;
      return enter(rest as TurnState, now, 'done', event.summary ? { summary: clean(event.summary) } : {});
    }
    case 'failed': {
      // A failure drops a held sentence (it may have depended on this one) and says so.
      const base = state.phase === 'idle' ? fresh(state, now, 'idle', 'other') : state;
      const { pending, saying: _s, resume: _r, ...rest } = base;
      return enter(rest, now, 'failed', { error: clean(event.error) || 'THAT FAILED', ...(pending ? { dropped: pending } : {}) });
    }
    case 'stop':
      return { ...TURN_IDLE, turnId: state.turnId + 1, since: now, progressAt: now, mic: state.mic, ...(state.micKind ? { micKind: state.micKind } : {}) };
    case 'reset':
      return { ...TURN_IDLE, turnId: state.turnId + 1, since: now, progressAt: now };
    case 'takePending': {
      if (!state.pending || turnBusy(state) || state.phase === 'failed') return state;
      const text = state.pending;
      const { pending: _p, ...rest } = state;
      const next = fresh(rest as TurnState, now, 'heard', 'voice');
      return { ...next, transcript: text };
    }
    case 'progress':
      return busy ? { ...state, progressAt: now } : state;
    case 'tick': {
      if (state.phase === 'done' && now - state.since >= DONE_HOLD_MS) return enter(state, now, 'idle');
      if (state.phase === 'failed' && now - state.since >= FAILED_HOLD_MS) {
        const { dropped: _d, ...rest } = state;
        return enter(rest as TurnState, now, 'idle');
      }
      if (BUSY.has(state.phase) && now - state.progressAt > WATCHDOG_MS) return turnReduce(state, { type: 'failed', error: TIMED_OUT }, now);
      return state;
    }
  }
}

/** Two states that would draw the same strip: the service pushes only a change. */
export function sameTurn(a: TurnState, b: TurnState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* ────────────────────────── "stop" is never held ────────────────────────── */

/**
 * "Jarvis, stop" while a turn is busy is obeyed at once, never held as the next command. The same
 * words intent.ts reads as `{type:'stop'}` (speech and the desktop, what Esc does).
 */
export function isStopSentence(text: string): boolean {
  const t = (typeof text === 'string' ? text : '')
    .toLowerCase()
    .replace(/[^a-z' ]+/g, ' ')
    .replace(/'/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:(?:hey|ok|okay) )?jarvis /, '')
    .replace(/ please$/, '')
    .replace(/^please /, '')
    .trim();
  return /^(?:stop|halt|stop that|stop it|stop there|stop talking|stop speaking|stop moving|stop everything|quiet|be quiet|hush|shush|silence|cancel|cancel that|never mind|abort|freeze|hold on|hold it|wait|enough)$/.test(t);
}

/* ────────────────────────── step labels ────────────────────────── */

const short = (text: string, max = 28): string => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const windowName = (name: string): string => (name === FOREGROUND ? 'THE WINDOW IN FRONT' : name);

/**
 * What a step is, in the strip's words: "FOCUS FIREFOX", "PRESS SPACE", "LAUNCH NOTEPAD",
 * "CLICK 'NEW TAB'". ALL CAPS, short, never a coordinate in a sentence William would read aloud.
 */
export function stepLabel(step: DesktopStep | { kind: string }): string {
  const s = step as DesktopStep;
  switch (s.kind) {
    case 'launch': return `LAUNCH ${short(s.app)}${s.monitor ? ` ON ${monitorWord(s.monitor)}` : ''}`.toUpperCase();
    case 'url': return `OPEN ${short(s.site ?? s.url)}${s.browser ? ` IN ${short(s.browser, 16)}` : ''}`.toUpperCase();
    case 'place': return `MOVE ${short(windowName(s.window))} TO ${monitorWord(s.monitor) || s.monitor}`.toUpperCase();
    case 'focus': return `FOCUS ${short(windowName(s.window))}${s.focusByPointer ? ' WITH THE MOUSE' : ''}`.toUpperCase();
    case 'scroll': return `SCROLL ${s.direction.toUpperCase()}${s.notches > 1 ? ` ${s.notches}` : ''}`;
    case 'mouse': return s.click ? `${s.click.toUpperCase()} CLICK` : 'MOVE THE MOUSE';
    case 'keys':
      if (s.combo) return `PRESS ${s.combo.replace(/\s+/g, '').toUpperCase()}`;
      return s.text ? `TYPE '${short(s.text, 20)}'` : 'TYPE';
    case 'wait': return `WAIT ${(Math.max(0, s.ms) / 1000).toFixed(1).replace(/\.0$/, '')} S`;
    case 'say': return 'SAY A LINE';
    case 'uiaClick': return `CLICK '${short(s.control, 20).toUpperCase()}'`;
    default: return String((step as { kind?: unknown }).kind ?? 'STEP').toUpperCase();
  }
}

/* ────────────────────────── what the strip shows ────────────────────────── */

export interface TurnView {
  glyph: string;
  word: string;
  /** The phase's detail, the question, the error or the line being spoken. */
  detail: string;
  /** `2 / 5 · FOCUS FIREFOX`, while acting. */
  progress: string | null;
  /** 0..1 for the progress bar. */
  fraction: number | null;
  /** In quotes, for the whole of the turn once heard. */
  transcript: string | null;
  /** The timer runs for `thinking` and `acting`. */
  timed: boolean;
  /** A sentence is held. */
  pending: string | null;
  /** STOP (Esc) is shown. */
  stoppable: boolean;
  /** The microphone is open (the LISTENING light). */
  mic: boolean;
}

const GLYPH: Record<TurnPhase, string> = {
  idle: '·',
  listening: '●',
  heard: '❝',
  thinking: '…',
  speaking: '≈',
  acting: '▶',
  waiting: '?',
  done: '✓',
  failed: '✕'
};

const WORD: Record<TurnPhase, string> = {
  idle: 'READY',
  listening: 'LISTENING',
  heard: 'HEARD',
  thinking: 'THINKING',
  speaking: 'SPEAKING',
  acting: 'ACTING',
  waiting: 'WAITING FOR YOU',
  done: 'DONE',
  failed: 'FAILED'
};

/**
 * A step label fit for stream mode: "TYPE 'HELLO SAM'" carries the words being typed, so on stream
 * it is only "TYPE" (bug sweep 2026-09-27: the strip, the caption and the dock showed them).
 */
export function streamLabel(label: string, hide: boolean): string {
  return hide && /^TYPE '/.test(label) ? 'TYPE' : label;
}

/** Everything the strip and the dock draw, from the state alone. `hide` is stream mode: no words he said. */
export function turnView(state: TurnState, hide = false): TurnView {
  const phase = state.phase;
  const step = state.step;
  const acting = phase === 'acting' || (phase === 'speaking' && state.resume === 'acting');
  const progress = acting && step ? `${Math.min(step.of, step.index + 1)} / ${step.of} · ${streamLabel(step.label, hide)}` : null;
  let detail = '';
  switch (phase) {
    case 'listening':
      detail = state.detail ?? (state.micKind === 'followUp' ? 'GO ON — NO WAKE WORD NEEDED' : 'SPEAK NOW');
      if (state.partial && !hide) detail = `${detail} · “${state.partial} …”`;
      break;
    case 'heard': detail = state.transcript ? 'UNDERSTOOD' : state.detail ?? 'TRANSCRIBING'; break;
    case 'thinking': detail = state.detail ?? 'THINKING'; break;
    case 'speaking': detail = hide ? '' : state.saying ?? ''; break;
    case 'acting': detail = state.detail ?? ''; break;
    case 'waiting': detail = hide ? 'A QUESTION FOR YOU' : state.question ?? ''; break;
    case 'done': detail = hide ? '' : state.summary ?? ''; break;
    case 'failed': detail = `${state.error ?? 'THAT FAILED'}${state.dropped ? ' · THE HELD COMMAND WAS DROPPED' : ''}`; break;
    case 'idle': detail = ''; break;
  }
  const inTurn = phase !== 'idle' && phase !== 'listening';
  return {
    glyph: GLYPH[phase],
    word: WORD[phase],
    detail,
    progress,
    fraction: acting && step ? Math.min(1, (step.index + 1) / Math.max(1, step.of)) : null,
    transcript: !hide && inTurn && state.transcript ? state.transcript : null,
    timed: phase === 'thinking' || phase === 'acting' || (phase === 'speaking' && (state.resume === 'thinking' || state.resume === 'acting')),
    pending: state.pending ? (hide ? 'A COMMAND' : state.pending) : null,
    stoppable: phase === 'thinking' || phase === 'speaking' || phase === 'acting',
    mic: state.mic !== 'closed'
  };
}

/** One line for the board's corner dock (JarvisDock): the same phase word and step as the strip. */
export function turnOneLine(state: TurnState | null, hide = false): string | null {
  if (!state) return null;
  const view = turnView(state, hide);
  if (state.phase === 'idle' && !view.mic && !view.pending) return null;
  const tail = view.progress ?? (state.phase === 'heard' && view.transcript ? `“${view.transcript}”` : view.detail);
  return `${view.glyph} ${view.word}${tail ? ` · ${tail}` : ''}${view.pending ? ' · PENDING' : ''}`;
}

/** `m:ss` for the strip's timer. */
export function elapsedLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The board window's end of a turn it owns (`turn:report`, user-only): a sentence it acted on
 * through `actOnIntent`, whose one-line result it has already asked to be spoken. Main waits for
 * the speech to finish before the turn is DONE. A report for any other turn is ignored.
 */
export interface TurnReport {
  turnId: number;
  outcome: 'done' | 'failed';
  text?: string;
}
