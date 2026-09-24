import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { powerMonitor } from 'electron';
import {
  AWAY_DEFAULT_EFFORT,
  AWAY_DEFAULT_MODEL,
  AWAY_MAX_LINES,
  AWAY_MAX_TOOL_CALLS,
  AWAY_WALL_CLOCK_MS,
  awayArgs,
  awayJournal,
  awayJournalName,
  awayPrompt,
  levelOf,
  poolCheck,
  type AwayLevel,
  type AwayLine,
  type AwayLogEvent,
  type AwayLogItem,
  type AwayStatus
} from '@shared/away.js';
import { PRESENCE_CHECK_MS, WAKE_CHECK_MS, clampAwayMinutes, isSettled, judgePresence, shouldWake } from '@shared/presence.js';
import type { LaunchModel } from '@shared/model-availability.js';
import { weightedTokens } from '@shared/usage.js';
import { pickHandsNode } from '@shared/face-brief.js';
import { getSettings } from './settings.js';
import { lastCommandAt, setAwayRun } from './activity.js';
import { readUsage } from './usage.js';
import { loadBoard } from './board-store.js';
import { expandPath, skynetRoot } from './target-resolver.js';
import { resolveMcpConfigs } from './mcp-config.js';
import { which } from './which.js';
import { sendMail } from './mailbox.js';
import { startAwayRun, type AwayRun, type AwayRunEnd } from './away-session.js';

/**
 * Away (sleep) mode: noticing William has gone, running JARVIS Prime headless while he is, and
 * handing him the write-up when he is back.
 *
 * ── Cost while he is here ─────────────────────────────────────────────────────────────────────
 * One `powerMonitor.getSystemIdleTime()` every 30 s, a single cheap syscall. The transcript folder
 * is stat'ed only once input has ALREADY been idle past the threshold, so a present William costs
 * no disk access at all.
 *
 * ── What it never does ────────────────────────────────────────────────────────────────────────
 * It never types into the claude.ai window (claude.ai's terms forbid scripted use of it, and docs/07
 * allows it only on William's Enter), and it never raises or focuses the SkynetOS window. Thirty
 * minutes of no input is also what a film looks like, and the away screen must not pop up over one.
 * The sleep screen is drawn inside SkynetOS for whenever he looks at it.
 */

type Listener<T> = (value: T) => void;
const stateListeners = new Set<Listener<AwayStatus>>();
const logListeners = new Set<Listener<AwayLogEvent>>();

export function onAwayState(listener: Listener<AwayStatus>): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

export function onAwayLog(listener: Listener<AwayLogEvent>): () => void {
  logListeners.add(listener);
  return () => logListeners.delete(listener);
}

function blank(): Omit<AwayStatus, 'mode' | 'afterMinutes' | 'model'> {
  return {
    phase: 'present', since: null, wokeAt: null, running: false, refusal: null,
    lines: [], items: [], files: [], tokens: null, costUsd: null, summary: null, journal: null, endReason: null
  };
}

let state = blank();
let run: AwayRun | null = null;
let checkTimer: ReturnType<typeof setInterval> | null = null;
let wakeTimer: ReturnType<typeof setInterval> | null = null;
/** Idle long enough since away began that the next input really is William coming back. */
let settled = false;

export function getAwayStatus(): AwayStatus {
  const s = getSettings();
  return { ...state, mode: s.awayMode, afterMinutes: clampAwayMinutes(s.awayAfterMinutes), model: s.awayModel || AWAY_DEFAULT_MODEL };
}

function emitState(): void {
  const status = getAwayStatus();
  for (const listener of stateListeners) listener(status);
}

/** After a settings change, so the renderer shows the new mode at once. */
export function refreshAwayStatus(): void {
  emitState();
}

function pushLine(line: AwayLine): void {
  state.lines = [...state.lines, line].slice(-AWAY_MAX_LINES);
  for (const listener of logListeners) listener({ line });
}

function pushItem(item: AwayLogItem): void {
  state.items = [...state.items, item];
  for (const listener of logListeners) listener({ item });
}

/* ────────────────────────── noticing ────────────────────────── */

/**
 * The newest Claude Code conversation write on this machine. Top-level `.jsonl` files only, one
 * `stat` each, and only called once OS input has already been idle past the threshold.
 */
function latestTranscriptWrite(): number | null {
  const root = join(homedir(), '.claude', 'projects');
  let latest: number | null = null;
  let dirs: string[];
  try { dirs = readdirSync(root); } catch { return null; }
  for (const d of dirs) {
    let names: string[];
    try { names = readdirSync(join(root, d)); } catch { continue; }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      try {
        const m = statSync(join(root, d, name)).mtimeMs;
        if (latest === null || m > latest) latest = m;
      } catch { /* vanished between readdir and stat */ }
    }
  }
  return latest;
}

function idleSeconds(): number | null {
  try { return powerMonitor.getSystemIdleTime(); } catch { return null; }
}

function check(): void {
  if (state.phase === 'away') return;
  const settings = getSettings();
  if (settings.awayMode === 'off') return;
  const idle = idleSeconds();
  if (idle === null) return;
  const threshold = clampAwayMinutes(settings.awayAfterMinutes);
  // The cheap signal first: while William is typing, nothing touches the disk.
  if (idle < threshold * 60) return;
  const verdict = judgePresence({
    now: Date.now(),
    systemIdleSeconds: idle,
    lastTranscriptAt: latestTranscriptWrite(),
    lastCommandAt: lastCommandAt(),
    thresholdMinutes: threshold
  });
  if (verdict.away) void enterAway('idle', Math.round(idle / 60));
}

function startWakeWatch(): void {
  stopWakeWatch();
  wakeTimer = setInterval(() => {
    const idle = idleSeconds();
    if (idle === null) return;
    if (!settled && isSettled(idle)) settled = true;
    if (shouldWake(idle, settled)) void wake('input');
  }, WAKE_CHECK_MS);
}

function stopWakeWatch(): void {
  if (wakeTimer) clearInterval(wakeTimer);
  wakeTimer = null;
}

/* ────────────────────────── going away ────────────────────────── */

export async function enterAway(trigger: 'idle' | 'manual', awayMinutes: number): Promise<{ ok: boolean; error?: string }> {
  if (state.phase === 'away') return { ok: true };
  const settings = getSettings();
  if (settings.awayMode === 'off') return { ok: false, error: 'AWAY MODE IS OFF — TURN IT ON IN THE LOOK PANEL' };

  state = { ...blank(), phase: 'away', since: Date.now() };
  // A manual sleep is itself a key press: wait until the machine has actually been left alone.
  settled = trigger === 'idle';
  startWakeWatch();
  pushLine({ at: Date.now(), kind: 'system', text: trigger === 'idle' ? `away after ${awayMinutes} min without input or agent activity` : 'sleep requested' });

  const level = levelOf(settings.awayMode);
  if (!level) {
    state.refusal = 'AWAY MODE IS VISUAL: NOTHING RUNS WHILE YOU ARE AWAY';
  } else {
    const refusal = startRun(level, settings.awayModel || AWAY_DEFAULT_MODEL, Math.max(awayMinutes, clampAwayMinutes(settings.awayAfterMinutes)));
    if (refusal) {
      state.refusal = refusal;
      pushLine({ at: Date.now(), kind: 'error', text: refusal });
    }
  }
  emitState();
  return { ok: true };
}

/** Start the headless run, or say why not. */
function startRun(level: AwayLevel, model: string, awayMinutes: number): string | null {
  const exe = which('claude.exe') ?? which('claude');
  if (!exe) return 'NOT STARTED — CLAUDE CODE IS NOT ON PATH';

  const load = loadBoard('root');
  if (!load.ok) return `NOT STARTED — ${load.error}`;
  const hands = pickHandsNode(load.board.nodes);
  if (!hands?.cwd) return 'NOT STARTED — NO JARVIS PRIME CHIP WITH A WORKING DIRECTORY ON THE ROOT BOARD';
  const cwd = expandPath(hands.cwd).replace(/\//g, '\\');
  try {
    if (!statSync(cwd).isDirectory()) return `NOT STARTED — NOT A FOLDER: ${cwd}`;
  } catch {
    return `NOT STARTED — WORKING DIRECTORY DOES NOT EXIST: ${cwd}`;
  }

  const mcpConfig = resolveMcpConfigs(['skynet'])[0];
  if (!mcpConfig) return 'NOT STARTED — NO SKYNET MCP CONFIG';

  let pool: ReturnType<typeof poolCheck>;
  try {
    const usage = readUsage();
    pool = poolCheck(weightedTokens(usage.window), usage.budgetTokens);
  } catch {
    pool = { ok: true, left: null, reason: 'USAGE COULD NOT BE READ, SO THE POOL WAS NOT CHECKED' };
  }
  if (!pool.ok) return `NOT STARTED — ${pool.reason}`;
  pushLine({ at: Date.now(), kind: 'system', text: `usage: ${pool.reason.toLowerCase()}` });

  const since = new Date(state.since ?? Date.now());
  const stamp = `${String(since.getHours()).padStart(2, '0')}:${String(since.getMinutes()).padStart(2, '0')}`;
  const launch: LaunchModel = { model, effort: AWAY_DEFAULT_EFFORT as LaunchModel['effort'], label: `${model.toUpperCase()} · MEDIUM · AWAY` };
  setAwayRun({ level, model: launch });

  run = startAwayRun({
    exe,
    args: awayArgs({ level, model, effort: AWAY_DEFAULT_EFFORT, mcpConfig, name: `JARVIS AWAY ${stamp}` }),
    cwd,
    prompt: awayPrompt({ level, awayMinutes, startedAt: since, capMinutes: AWAY_WALL_CLOCK_MS / 60_000 }),
    wallClockMs: AWAY_WALL_CLOCK_MS,
    maxToolCalls: AWAY_MAX_TOOL_CALLS,
    onLine: pushLine,
    onItem: pushItem,
    onEnd: (end) => finishRun(end, level, model)
  });
  state.running = true;
  pushLine({ at: Date.now(), kind: 'system', text: `JARVIS Prime started headless: ${model}, level ${level}` });
  return null;
}

function describeEnd(end: AwayRunEnd): string {
  switch (end.reason) {
    case 'finished': return 'finished on its own';
    case 'stopped': return 'stopped: William came back';
    case 'wall-clock': return `stopped at the ${AWAY_WALL_CLOCK_MS / 60_000}-minute cap`;
    case 'tool-cap': return `stopped at the ${AWAY_MAX_TOOL_CALLS}-tool-call cap`;
    case 'crashed': return `crashed${end.stderr ? `: ${end.stderr.split(/\r?\n/).filter(Boolean).pop() ?? ''}` : ''}`;
  }
}

/**
 * The run ended. If it did not leave its own journal and Face mail (a run stopped mid-task never
 * does), SkynetOS leaves them. The journal is written with `wx`, never overwriting.
 */
function finishRun(end: AwayRunEnd, level: AwayLevel, model: string): void {
  run = null;
  setAwayRun(null);
  const since = state.since ?? Date.now();
  state.running = false;
  state.files = end.tally.files;
  state.tokens = end.tally.tokens;
  state.costUsd = end.tally.costUsd;
  state.summary = end.tally.summary ?? end.tally.lastText;
  state.endReason = describeEnd(end);
  pushLine({ at: Date.now(), kind: end.reason === 'crashed' ? 'error' : 'system', text: `away session ${state.endReason}` });

  const didSomething = end.tally.toolCalls > 0 || state.items.length > 0;
  if (end.tally.wroteJournal) {
    state.journal = 'written by the session';
  } else if (didSomething) {
    const text = awayJournal({ since, ended: Date.now(), level, model, endReason: state.endReason, items: state.items, tally: end.tally });
    const dir = join(skynetRoot(), 'codex', 'journal');
    const name = awayJournalName(new Date(since));
    try {
      mkdirSync(dir, { recursive: true });
      let file = join(dir, name);
      try {
        writeFileSync(file, text, { encoding: 'utf8', flag: 'wx' });
      } catch {
        file = join(dir, name.replace(/\.md$/, '-skynetos.md'));
        writeFileSync(file, text, { encoding: 'utf8', flag: 'wx' });
      }
      state.journal = file;
    } catch (err) {
      pushLine({ at: Date.now(), kind: 'error', text: `could not write the away journal: ${(err as Error).message}` });
    }
  }
  if (didSomething && !end.tally.mailedFace) {
    const body = [
      `Away session, ${state.endReason}. ${state.items.length} item(s):`,
      '',
      ...state.items.map((i) => `- ${i.text}`),
      ...(state.summary ? ['', 'Its last word:', '', state.summary] : []),
      ...(state.journal && state.journal !== 'written by the session' ? ['', `Journal: ${state.journal}`] : [])
    ].join('\n');
    const mailed = sendMail('to-face', { from: 'hands', subject: `Away session: ${state.items.length} item(s)`, body });
    if (!mailed.ok) pushLine({ at: Date.now(), kind: 'error', text: `could not mail the Face: ${mailed.error ?? 'unknown'}` });
  }
  emitState();
}

/* ────────────────────────── coming back ────────────────────────── */

export async function wake(by: 'input' | 'renderer'): Promise<AwayStatus> {
  if (state.phase !== 'away') return getAwayStatus();
  state.phase = 'woken';
  state.wokeAt = Date.now();
  stopWakeWatch();
  pushLine({ at: Date.now(), kind: 'system', text: by === 'input' ? 'input detected: William is back' : 'William is back' });
  emitState();
  if (run) await run.stop('stopped');
  return getAwayStatus();
}

export function startPresence(): void {
  if (checkTimer) return;
  checkTimer = setInterval(check, PRESENCE_CHECK_MS);
}

export function stopPresence(): void {
  if (checkTimer) clearInterval(checkTimer);
  checkTimer = null;
  stopWakeWatch();
  // The first step of stop is a synchronous kill, which is all a quitting app has time for.
  if (run) void run.stop('stopped');
}
