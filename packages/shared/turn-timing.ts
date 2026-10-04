/**
 * Where a turn's time goes (docs/11 § One turn at a time → Where the time goes). Pure: the record
 * services/turn-timing.ts fills in as the turn moves, and the one console line made from it:
 *
 *   [turn] heard→speak 1,840 ms (whisper 90, intent 3, model 1,400, synth 350)
 *
 * Every mark is ms since the epoch, set ONCE (the first time it happens in the turn); a later mark
 * of the same name is ignored. Nothing here reads a clock.
 */

export type TimingMark =
  /** The capture window's tracks stopped: the endpointer decided the sentence was over. */
  | 'micClosed'
  /** whisper answered; the sentence is known. */
  | 'transcript'
  /** Main learned what the sentence is: the planner, conversation, a spoken result, or a plan. */
  | 'intent'
  /** `claude -p` was started, and answered (the planner or conversation). */
  | 'modelAsked'
  | 'modelAnswered'
  /** The first line of the turn began synthesising, and began playing. */
  | 'synthStart'
  | 'firstAudio'
  /** The first step of a plan started. */
  | 'planFirstStep'
  | 'ended';

export interface TurnTiming {
  turnId: number;
  /** Where the turn came from, as the engine had it. */
  origin?: string;
  /** How it ended: done, failed, stopped, idle. */
  outcome?: string;
  marks: Partial<Record<TimingMark, number>>;
  /** Who spoke the first line: a banked acknowledgement, the server, or Windows' voice. */
  firstVia?: 'bank' | 'server' | 'sapi';
  /** How the intent was reached: planner, remembered, converse, board, plan. */
  path?: string;
}

export function newTiming(turnId: number, origin?: string): TurnTiming {
  return { turnId, ...(origin ? { origin } : {}), marks: {} };
}

/** Set a mark once; the first time wins. Returns whether it was set. */
export function markTiming(t: TurnTiming, mark: TimingMark, at: number): boolean {
  if (t.marks[mark] !== undefined || !Number.isFinite(at)) return false;
  t.marks[mark] = at;
  return true;
}

export interface TimingSpans {
  /** From the microphone closing to the first audio: what William waits through. */
  heardToSpeak: number | null;
  whisper: number | null;
  intent: number | null;
  model: number | null;
  synth: number | null;
  /** From the microphone closing to the plan's first step. */
  heardToAct: number | null;
  total: number | null;
}

const span = (a: number | undefined, b: number | undefined): number | null =>
  a !== undefined && b !== undefined && b >= a ? Math.round(b - a) : null;

/**
 * The pieces, each measured from the mark before it that exists: whisper (mic closed → transcript),
 * intent (transcript → intent), model (the model call itself), synth (whatever came before the
 * first audio → the first audio: synthesis, or the queue, or nothing for a banked line).
 */
export function timingSpans(t: TurnTiming): TimingSpans {
  const m = t.marks;
  const beforeAudio = m.modelAnswered ?? m.synthStart ?? m.intent ?? m.transcript;
  const synthFrom = m.synthStart !== undefined && (m.modelAnswered === undefined || m.synthStart >= m.modelAnswered) ? m.synthStart : beforeAudio;
  return {
    heardToSpeak: span(m.micClosed, m.firstAudio),
    whisper: span(m.micClosed, m.transcript),
    intent: span(m.transcript, m.intent),
    model: span(m.modelAsked, m.modelAnswered),
    synth: span(synthFrom, m.firstAudio),
    heardToAct: span(m.micClosed, m.planFirstStep),
    total: span(m.micClosed ?? m.transcript ?? m.intent, m.ended)
  };
}

const ms = (n: number): string => n.toLocaleString('en-GB');

/**
 * `[turn] heard→speak 1,840 ms (whisper 90, intent 3, model 1,400, synth 350)`, with `→act` for a
 * plan's first step and `bank` when the first line was banked. Null when nothing was measured.
 */
export function timingLine(t: TurnTiming): string | null {
  const s = timingSpans(t);
  const parts: string[] = [];
  if (s.whisper !== null) parts.push(`whisper ${ms(s.whisper)}`);
  if (s.intent !== null) parts.push(`intent ${ms(s.intent)}`);
  if (s.model !== null) parts.push(`model ${ms(s.model)}`);
  if (s.synth !== null) parts.push(`synth ${ms(s.synth)}${t.firstVia === 'bank' ? ' bank' : t.firstVia === 'sapi' ? ' sapi' : ''}`);
  const head: string[] = [];
  if (s.heardToSpeak !== null) head.push(`heard→speak ${ms(s.heardToSpeak)} ms`);
  if (s.heardToAct !== null) head.push(`heard→act ${ms(s.heardToAct)} ms`);
  if (!head.length && s.total !== null) head.push(`turn ${ms(s.total)} ms`);
  if (!head.length) return null;
  return `[turn] ${head.join(' · ')}${parts.length ? ` (${parts.join(', ')})` : ''}${t.path ? ` · ${t.path}` : ''}`;
}

/** The JSON line for `userData/turn-timing.jsonl`: the marks relative to the first, and the spans. */
export function timingRecord(t: TurnTiming, at: string): Record<string, unknown> {
  const values = Object.values(t.marks).filter((v): v is number => typeof v === 'number');
  const zero = values.length ? Math.min(...values) : 0;
  const rel: Record<string, number> = {};
  for (const [k, v] of Object.entries(t.marks)) if (typeof v === 'number') rel[k] = Math.round(v - zero);
  return { at, turnId: t.turnId, origin: t.origin ?? null, outcome: t.outcome ?? null, path: t.path ?? null, firstVia: t.firstVia ?? null, marks: rel, spans: timingSpans(t) };
}
