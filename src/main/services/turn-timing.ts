import { appendFileSync } from 'node:fs';
import { markTiming, newTiming, timingLine, timingRecord, type TimingMark, type TurnTiming } from '@shared/turn-timing.js';
import type { TurnEvent, TurnState } from '@shared/turn.js';

/**
 * Where a turn's time goes (docs/11 § One turn at a time → Where the time goes). services/turn.ts
 * hands every change here (`observeTiming`); the services that know a moment the engine cannot see
 * mark it (`markTurn`): the planner and conversation when the model is asked and answers, speech
 * when a line starts synthesising and when the first audio of the turn starts. When the turn ends
 * (DONE, FAILED, a stop, or the next turn), one JSON line goes to `userData/turn-timing.jsonl` and
 * one line to the console:
 *
 *   [turn] heard→speak 1,840 ms (whisper 90, intent 3, model 1,400, synth 350)
 *
 * Only a turn that heard or was typed a sentence is written. No audio, no words: the marks, the
 * spans, the turn's origin and outcome. Nothing here imports Electron; index.ts names the file.
 */

let file: string | null = null;
let current: TurnTiming | null = null;
let written = false;

export function setTurnTimingFile(path: string | null): void { file = path; }

/** For tests: the record being filled in. */
export function currentTiming(): TurnTiming | null { return current; }

function write(t: TurnTiming, outcome: string): void {
  if (written) return;
  if (t.marks.micClosed === undefined && t.marks.transcript === undefined) return;
  written = true;
  t.outcome = outcome;
  const line = timingLine(t);
  if (line) console.log(line);
  if (!file) return;
  try {
    appendFileSync(file, JSON.stringify(timingRecord(t, new Date().toISOString())) + '\n', 'utf8');
  } catch (err) {
    console.warn('[turn] could not append the timing log:', (err as Error).message);
  }
}

/** Every change the engine makes, after it is made. */
export function observeTiming(prev: TurnState, next: TurnState, event: TurnEvent, now: number): void {
  if (!current || next.turnId !== current.turnId) {
    if (current) {
      markTiming(current, 'ended', now);
      write(current, event.type === 'stop' ? 'stopped' : event.type === 'reset' ? 'reset' : 'replaced');
    }
    current = newTiming(next.turnId, next.origin);
    written = false;
  }
  const t = current;
  if (next.origin && !t.origin) t.origin = next.origin;
  switch (event.type) {
    case 'micClosed':
      if (prev.phase === 'listening' && next.phase === 'heard') markTiming(t, 'micClosed', now);
      break;
    case 'sentence':
    case 'takePending':
      if (next.phase === 'heard' && next.transcript) markTiming(t, 'transcript', now);
      break;
    case 'step':
      markTiming(t, 'planFirstStep', now);
      break;
    default:
      break;
  }
  if ((next.phase === 'done' || next.phase === 'failed') && prev.phase !== next.phase) {
    markTiming(t, 'ended', now);
    write(t, next.phase);
  }
}

/**
 * A moment only a service sees, in the turn now running. The first of each wins. `via` says who
 * spoke the first line; `path` how the sentence was answered.
 */
export function markTurn(mark: TimingMark, extra: { via?: TurnTiming['firstVia']; path?: string } = {}, now: number = Date.now()): void {
  const t = current;
  if (!t || written) return;
  const set = markTiming(t, mark, now);
  if (set && mark === 'firstAudio' && extra.via) t.firstVia = extra.via;
  if (extra.path && !t.path) t.path = extra.path;
}

/** For tests. */
export function resetTiming(): void {
  current = null;
  written = false;
}
