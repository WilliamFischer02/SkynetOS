import {
  DONE_WORD,
  ONE_MOMENT,
  TIMED_OUT,
  TURN_IDLE,
  isStopSentence,
  sameTurn,
  turnBusy,
  turnReduce,
  type TurnEvent,
  type TurnReport,
  type TurnState
} from '@shared/turn.js';
import type { VoiceHeard } from '@shared/voice.js';
import { markTurn, observeTiming } from './turn-timing.js';

/**
 * The turn engine (docs/11 § One turn at a time). ONE state, owned here, that every producer
 * reports into and every view reads:
 *
 *   voice.ts     micOpened / speechStarted / micClosed (from the capture window's real tracks),
 *                the sentence, nothingHeard;
 *   speech.ts    speakStart / speakEnd, from the sidecar's own START, DONE, STOPPED, PLAYED;
 *   desktop.ts   planStarted / step (a human label per step) / done or failed for a plan it owns;
 *   planner.ts   thinking('PLANNING'), then ask, or the read-back and the run;
 *   converse.ts  thinking('ASKING CLAUDE'), then the reply and done;
 *   the board    `turn:report` for a sentence it acted on itself (actOnIntent).
 *
 * `turn:state` is pushed to the board and the hologram on every change (identical states are not
 * re-sent). A tick every 250 ms while anything is going on ends DONE after 2 s and FAILED after 4 s,
 * and is the watchdog: heard, thinking or acting with no progress for 60 s is FAILED, said once,
 * and the desktop is halted.
 *
 * It never opens a microphone. The follow-up window is voice.ts's, which listens here for the turn
 * to END (`onTurn`) instead of for a line to stop being spoken.
 *
 * Nothing here imports speech.ts, desktop.ts or voice.ts: they import this. What it needs from
 * them (say a line, wait for silence, halt) is handed in by index.ts (`setTurnEffects`).
 */

export interface TurnHandlers {
  /** `turn:state` to the board and the hologram. */
  onState(state: TurnState): void;
  /** A sentence that starts a turn: `voice:heard` to the board (which acts) and the hologram (which shows). */
  onSentence(heard: VoiceHeard): void;
}

export interface TurnEffects {
  say(text: string): Promise<unknown>;
  /** Resolves when nothing is being said, queued, or being synthesised. */
  whenSpeechIdle(timeoutMs?: number): Promise<boolean>;
  halt(): void;
  stopSpeaking(): void;
}

type Listener = (prev: TurnState, next: TurnState) => void;

let state: TurnState = { ...TURN_IDLE };
let handlers: TurnHandlers | null = null;
let effects: TurnEffects | null = null;
const listeners = new Set<Listener>();
let ticker: ReturnType<typeof setInterval> | null = null;
const TICK_MS = 250;

export function setTurnHandlers(next: TurnHandlers): void { handlers = next; }
export function setTurnEffects(next: TurnEffects): void { effects = next; }

/** Every change, after it is pushed. voice.ts opens the follow-up here; nothing else may. */
export function onTurn(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function turnState(): TurnState { return state; }
export function currentTurnId(): number { return state.turnId; }
export function isTurnBusy(): boolean { return turnBusy(state); }

function syncTicker(): void {
  const active = state.phase !== 'idle';
  if (active && !ticker) {
    ticker = setInterval(() => dispatch({ type: 'tick' }), TICK_MS);
    ticker.unref?.();
  } else if (!active && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

/** One event, now. Pushes the new state if it differs, then runs the rules that follow a change. */
export function dispatch(event: TurnEvent, now: number = Date.now()): TurnState {
  const prev = state;
  const next = turnReduce(prev, event, now);
  if (sameTurn(prev, next)) return state;
  state = next;
  syncTicker();
  try { observeTiming(prev, next, event, now); } catch (err) { console.warn('[turn] timing threw', err); }
  try { handlers?.onState(state); } catch (err) { console.warn('[turn] state listener threw', err); }
  after(prev, next);
  for (const listener of listeners) {
    try { listener(prev, state); } catch (err) { console.warn('[turn] listener threw', err); }
  }
  return state;
}

/** An event from a producer that began under `turnId`: ignored once that turn is over. */
export function dispatchFor(turnId: number, event: TurnEvent): boolean {
  if (turnId !== state.turnId) return false;
  dispatch(event);
  return true;
}

function sayLine(text: string): void {
  if (!effects) return;
  void Promise.resolve(effects.say(text)).catch((err: unknown) => console.warn('[turn] could not speak:', (err as Error)?.message));
}

/** What follows a change: "One moment." once, a held sentence started, a watchdog failure said. */
function after(prev: TurnState, next: TurnState): void {
  // A sentence was held for the first time this turn.
  if (next.pending && next.acked && !(prev.acked && prev.turnId === next.turnId)) {
    console.log(`[turn] held while ${next.phase}: "${next.pending}"`);
    sayLine(ONE_MOMENT);
  }
  // The watchdog: said once, and whatever was running is halted so it cannot act after the fact.
  if (next.phase === 'failed' && prev.phase !== 'failed' && next.error === TIMED_OUT) {
    console.warn(`[turn] ${TIMED_OUT} (turn ${next.turnId}, was ${prev.phase})`);
    effects?.halt();
    sayLine('That timed out; nothing happened for a minute.');
  }
  // The turn ended with a sentence held: that sentence is the next turn. Not after a failure (the
  // reducer drops it) and not after a stop (cleared).
  if (next.pending && !turnBusy(next) && (next.phase === 'done' || next.phase === 'waiting' || next.phase === 'idle')) {
    queueMicrotask(() => startPending());
  }
}

function startPending(): void {
  if (!state.pending || turnBusy(state)) return;
  const next = dispatch({ type: 'takePending' });
  if (next.phase !== 'heard' || !next.transcript) return;
  console.log(`[turn] starting the held sentence as turn ${next.turnId}`);
  handlers?.onSentence({ text: next.transcript, confidence: 1, ms: 0, turnId: next.turnId });
}

/**
 * A sentence, heard (voice.ts) or typed (`voice:typed`). While a turn is busy it is held, and a
 * "stop" is obeyed rather than held. Otherwise it starts a turn and goes to the board.
 */
export function sentence(text: string, meta: { confidence: number; ms: number; origin: 'voice' | 'typed' }): 'started' | 'held' | 'stopped' | 'empty' {
  const line = (typeof text === 'string' ? text : '').replace(/\s+/g, ' ').trim();
  if (!line) return 'empty';
  if (turnBusy(state) && isStopSentence(line)) {
    stopTurn();
    return 'stopped';
  }
  const next = dispatch({ type: 'sentence', text: line, origin: meta.origin });
  if (next.pending === line && turnBusy(next)) return 'held';
  handlers?.onSentence({ text: line, confidence: meta.confidence, ms: meta.ms, turnId: next.turnId });
  return 'started';
}

/**
 * The end of a turn, from its owner: once whatever it asked to be said has been said (and anything
 * still being synthesised), DONE. `word` says "Done." first (a multi-step plan's quiet success).
 */
export async function finishTurn(turnId: number, summary?: string, opts: { word?: boolean } = {}): Promise<void> {
  if (turnId !== state.turnId) return;
  if (opts.word) {
    await effects?.whenSpeechIdle(30_000);
    if (turnId !== state.turnId) return;
    await Promise.resolve(effects?.say(DONE_WORD)).catch(() => undefined);
  }
  await effects?.whenSpeechIdle(60_000);
  if (turnId !== state.turnId) return;
  dispatch({ type: 'done', ...(summary ? { summary } : {}) });
}

/** A failure, now: the amber and the error; no follow-up after it. */
export function failTurn(turnId: number, error: string): void {
  dispatchFor(turnId, { type: 'failed', error });
}

/** STOP: the desktop halted, speech stopped, a held sentence dropped, READY. Opens nothing. */
export function stopTurn(): { ok: boolean } {
  effects?.halt();
  effects?.stopSpeaking();
  dispatch({ type: 'stop' });
  return { ok: true };
}

/** `turn:report` from the board window: the end of a sentence it acted on itself. */
export function reportTurn(report: TurnReport): { ok: boolean } {
  const id = Number(report?.turnId);
  if (!Number.isFinite(id) || id !== state.turnId) return { ok: false };
  const text = typeof report.text === 'string' ? report.text.slice(0, 400) : undefined;
  markTurn('intent', { path: 'board' });
  if (report.outcome === 'failed') {
    failTurn(id, text || 'THAT DID NOT WORK');
    return { ok: true };
  }
  void finishTurn(id, text);
  return { ok: true };
}

/** For tests and for voice off: back to READY with nothing held. */
export function resetTurn(): void {
  dispatch({ type: 'reset' });
}
