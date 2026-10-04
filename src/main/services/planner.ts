import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { normalisePlan, plannerActive, replyFor, type DesktopPlan, type DesktopResult } from '@shared/desktop.js';
import {
  MAX_LOG_LINES,
  PLANNER_TIMEOUT_MS,
  graceMs,
  isPlannable,
  parsePlannerReply,
  plannerPrompt,
  refusalLine,
  type PlannerLogEntry
} from '@shared/planner.js';
import { getSettings } from './settings.js';
import { askClaude } from './headless-claude.js';
import { markTurn } from './turn-timing.js';
import { say, whenSpeechIdle } from './speech.js';
import { desktopMonitors, lastHaltRequest, listApps, listDesktopWindows, pushDesktopState, runPlan } from './desktop.js';
import { listSavedActions } from './action-recorder.js';
import { currentTurnId, dispatch as turnDispatch, dispatchFor as turnDispatchFor, failTurn, finishTurn } from './turn.js';
import { SAME_AS_LAST_TIME, forgetPlan, recallPlan, rememberPlan } from './action-memory.js';

/**
 * The planner (M13.3; docs/11 § Slice 2; rules docs/07 § JARVIS Voice, the planner row).
 *
 * A desktop request the rule grammar did not match reaches `planAndRun` through the user-only
 * `desktop:plan` channel (the board's voice path and the hologram's text box; never an agent or a
 * phone). With desktop control on, the planner not switched off, and a desktop verb first:
 *
 *   1. `planDesktop` asks headless `claude -p` for a plan, shaped exactly like converse.ts: the
 *      prompt on stdin, `--strict-mcp-config` on an empty server set, `--permission-mode dontAsk`,
 *      every tool disallowed. The model can only answer text. Nothing runs here.
 *   2. The answer is parsed defensively and passed through `normalisePlan`, which drops every step
 *      outside docs/07; a plan with anything dropped does not run, and the refusal is said.
 *   3. A question ("ask") is spoken and nothing runs. Otherwise the line ("say") is spoken from
 *      main, the service waits for it to finish, and a "stop" or Esc since the line began cancels.
 *   4. `runPlan` runs the steps under the same switch, twelve-step cap and halt as a rule plan.
 *   5. `{sentence, say, steps, tiers}` is appended to `%APPDATA%/SkynetOS/desktop/planner.log.jsonl`.
 */

const MAX_SENTENCE_CHARS = 400;

export interface PlanOutcome {
  ok: boolean;
  plan?: DesktopPlan;
  say?: string;
  ask?: string;
  dropped?: string[];
  error?: string;
}

/** What `desktop:plan` answers. `handled: false` means: not the planner's; conversation may answer. */
export interface PlanRunResult {
  handled: boolean;
  ok: boolean;
  /** The line to show: the read-back, the question, the refusal, or the result. */
  reply?: string;
  say?: string;
  ask?: string;
  steps?: number;
  dropped?: string[];
  error?: string;
}

let inFlight = false;

function desktopDir(): string {
  const dir = join(app.getPath('userData'), 'desktop');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function logFile(): string {
  return join(desktopDir(), 'planner.log.jsonl');
}

/** The last lines of the planner's own log, or nothing. Reads at most the file's last 64 KB. */
function recentLog(): string[] {
  const file = logFile();
  try {
    if (!existsSync(file)) return [];
    const size = statSync(file).size;
    const text = readFileSync(file, 'utf8');
    const tail = size > 65_536 ? text.slice(-65_536) : text;
    return tail.split(/\r?\n/).filter((l) => l.trim().startsWith('{')).slice(-MAX_LOG_LINES);
  } catch {
    return [];
  }
}

function writeLog(entry: PlannerLogEntry): void {
  try {
    appendFileSync(logFile(), JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.warn('[planner] could not append the log:', (err as Error).message);
  }
}

/** An MCP config that loads nothing: with `--strict-mcp-config` it is the whole server set. */
function emptyMcpConfig(): string {
  const dir = app.getPath('userData');
  const file = join(dir, 'planner-mcp.json');
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify({ mcpServers: {} }, null, 2) + '\n', 'utf8');
  }
  return file;
}

/** The planner's whole system prompt: it answers one JSON object and nothing else. */
const PLANNER_SYSTEM = 'You are the SkynetOS desktop planner. You have no tools and must not try to use any. Answer with exactly one JSON object as the user message specifies, and nothing else.';

/** One `claude -p` run with no tools: the prompt on stdin, the text on stdout (headless-claude.ts). */
function askModel(prompt: string): Promise<{ text: string | null; reason: 'missing' | 'timeout' | 'error' | null }> {
  const model = getSettings().desktop.plannerModel || getSettings().converse.model;
  return askClaude(prompt, { model, system: PLANNER_SYSTEM, mcpConfig: emptyMcpConfig(), timeoutMs: PLANNER_TIMEOUT_MS, tag: 'planner' });
}

/**
 * A plan for one sentence, or why there is none. Gathers the desktop as it is (windows through
 * the helper's read-only `windows`, the monitors, the catalogue, the saved actions, the log),
 * asks the model, normalises. NOTHING RUNS HERE.
 */
export async function planDesktop(sentence: string): Promise<PlanOutcome> {
  const heard = (typeof sentence === 'string' ? sentence : '').replace(/\s+/g, ' ').trim().slice(0, MAX_SENTENCE_CHARS);
  if (!heard) return { ok: false, error: 'NOTHING TO PLAN' };
  const apps = listApps();
  const monitors = desktopMonitors();
  let windows: Awaited<ReturnType<typeof listDesktopWindows>> = [];
  try { windows = await listDesktopWindows(); } catch (err) { console.warn('[planner] could not list windows:', (err as Error).message); }
  let actions: ReturnType<typeof listSavedActions> = [];
  try { actions = listSavedActions(); } catch { actions = []; }
  const prompt = plannerPrompt({
    sentence: heard,
    windows,
    monitors,
    apps,
    actions: actions.map((a) => ({ name: a.name, description: a.description, summary: a.summary })),
    log: recentLog()
  });
  markTurn('modelAsked');
  const answer = await askModel(prompt);
  markTurn('modelAnswered');
  if (answer.text === null) {
    const why = answer.reason === 'missing' ? 'CLAUDE CODE IS NOT ON THIS MACHINE\'S PATH' : answer.reason === 'timeout' ? 'THE PLANNER DID NOT ANSWER IN 30 SECONDS' : 'THE PLANNER FAILED';
    return { ok: false, error: why };
  }
  const parsed = parsePlannerReply(answer.text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const { say: line, ask, steps: raw } = parsed.reply;
  if (ask) return { ok: true, ask, ...(line ? { say: line } : {}) };
  const normal = normalisePlan(raw, { apps, monitors: monitors.length || 1 });
  if (normal.dropped.length) return { ok: false, dropped: normal.dropped, error: refusalLine(normal.dropped), ...(line ? { say: line } : {}) };
  if (!normal.steps.length) return { ok: true };
  const plan: DesktopPlan = { source: 'planner', heard, steps: normal.steps };
  return { ok: true, plan, say: line || 'Very well.' };
}

function tiersOf(result: DesktopResult): string[] {
  return result.steps.map((r) => (r.ok ? (r.step.kind === 'uiaClick' ? 'element' : 'ok') : `failed: ${r.message}`));
}

function speak(text: string): Promise<{ ok: boolean }> {
  return say({ text, interrupt: false }).catch((err: unknown) => {
    console.warn('[planner] could not speak:', (err as Error).message);
    return { ok: false };
  });
}

/**
 * `desktop:plan`: plan, read back, run. `handled: false` (and nothing spoken) when the planner does
 * not apply: desktop control off, the planner off, no desktop verb, or the model says the
 * sentence is not a desktop request. The caller then answers it as conversation.
 */
export async function planAndRun(sentence: string): Promise<PlanRunResult> {
  const heard = (typeof sentence === 'string' ? sentence : '').replace(/\s+/g, ' ').trim().slice(0, MAX_SENTENCE_CHARS);
  if (!heard || !plannerActive(getSettings().desktop) || !isPlannable(heard)) return { handled: false, ok: false };
  if (inFlight) {
    const reply = 'I am still working out the last request.';
    void speak(reply);
    return { handled: true, ok: false, reply, error: 'THE PLANNER IS BUSY' };
  }
  inFlight = true;
  const started = Date.now();
  const entry: PlannerLogEntry = { at: new Date().toISOString(), sentence: heard, say: '', ask: null, steps: [], dropped: [], tiers: [], ok: null, message: '', ms: 0 };
  const finish = (result: PlanRunResult): PlanRunResult => {
    entry.ms = Date.now() - started;
    entry.message = result.reply ?? result.error ?? '';
    writeLog(entry);
    return result;
  };
  // One turn at a time (services/turn.ts): THINKING · PLANNING while the model works; from here the
  // planner owns the end of this turn. Everything after is dispatched for THIS turn only, so a
  // "stop" (which starts a new turn id) cannot be overtaken by a plan that was already in hand.
  turnDispatch({ type: 'thinking', detail: 'PLANNING' });
  const turnId = currentTurnId();
  try {
    pushDesktopState({ busy: false, message: 'planning' });
    // Action memory (services/action-memory.ts): a sentence whose plan ran to completion before is
    // not sent to the model again; the remembered plan, re-checked against today's rules, is read
    // back as "Same as last time." and runs through the same read-back, pause, turn and runPlan.
    const remembered = recallPlan(heard);
    markTurn('intent', { path: remembered ? 'remembered' : 'planner' });
    if (remembered) turnDispatchFor(turnId, { type: 'thinking', detail: 'REMEMBERED — SAME AS LAST TIME' });
    const outcome: PlanOutcome = remembered ? { ok: true, plan: remembered, say: SAME_AS_LAST_TIME } : await planDesktop(heard);
    entry.say = outcome.say ?? '';
    entry.ask = outcome.ask ?? null;
    entry.dropped = outcome.dropped ?? [];

    if (outcome.ask) {
      const question = outcome.ask;
      pushDesktopState({ busy: false, message: question });
      // The question is said first; only then WAITING, which is when the follow-up may open.
      void (async () => {
        const spoken = await speak(question);
        if (spoken.ok) await whenSpeechIdle(Math.max(10_000, question.length * 150));
        turnDispatchFor(turnId, { type: 'ask', question });
      })();
      return finish({ handled: true, ok: true, reply: question, ask: question });
    }
    if (!outcome.ok) {
      const reply = outcome.dropped?.length ? (outcome.error ?? refusalLine(outcome.dropped)) : `I could not plan that: ${(outcome.error ?? 'no plan').toLowerCase()}.`;
      entry.ok = false;
      pushDesktopState({ busy: false, message: reply });
      failTurn(turnId, reply);
      void speak(reply);
      return finish({ handled: true, ok: false, reply, error: outcome.error, ...(outcome.dropped ? { dropped: outcome.dropped } : {}) });
    }
    if (!outcome.plan) {
      // The model says it is not a desktop request: conversation answers it instead. Not logged.
      pushDesktopState({ busy: false, message: '' });
      return { handled: false, ok: false };
    }

    const plan = outcome.plan;
    const line = outcome.say ?? 'Very well.';
    entry.steps = plan.steps;
    // The read-back: shown in the hologram's state line and spoken from main, THEN the plan runs.
    // The turn stays THINKING through it (SPEAKING while the line plays): nothing opens the
    // microphone until the plan has run and its turn has ended.
    pushDesktopState({ busy: false, total: plan.steps.length, message: line });
    const lineStartedAt = Date.now();
    const spoken = await speak(line);
    if (spoken.ok) await whenSpeechIdle(Math.max(10_000, line.length * 150));
    turnDispatchFor(turnId, { type: 'thinking', detail: 'ABOUT TO ACT — ESC STOPS IT' });
    await new Promise((r) => setTimeout(r, graceMs(plan.steps)));
    if (lastHaltRequest() >= lineStartedAt || turnId !== currentTurnId()) {
      entry.ok = false;
      const reply = 'Stopped before I began, as asked.';
      pushDesktopState({ busy: false, message: 'stopped' });
      turnDispatchFor(turnId, { type: 'stop' });
      return finish({ handled: true, ok: false, reply, say: line, steps: plan.steps.length });
    }
    // Same switch, same cap, same halt as a rule plan: runPlan re-checks every one of them, and
    // reports each step to the turn (ACTING · 2 / 5 · FOCUS FIREFOX).
    const result = await runPlan(plan);
    entry.tiers = tiersOf(result);
    entry.ok = result.ok;
    // Remember what ran to completion; a failure evicts whatever was remembered for this sentence.
    // A halt (Esc, "stop") or a refusal before any step ran (desktop busy, switched off) says
    // nothing about the plan, so it is not forgotten for those (bug sweep 2026-09-27).
    if (result.ok) rememberPlan(heard, plan);
    else if (!result.halted && result.steps.some((r) => !r.ok)) forgetPlan(heard);
    const reply = result.steps.length ? replyFor(plan, result) : result.message;
    // Success was said in the read-back; after more than one step, "Done." as well, so a quiet
    // success never looks like a failure. A failure (runPlan made it FAILED) or a halt is said now.
    if (result.ok) void finishTurn(turnId, line, { word: plan.steps.length > 1 });
    else void speak(reply);
    return finish({ handled: true, ok: result.ok, reply: result.ok ? line : reply, say: line, steps: plan.steps.length, ...(result.ok ? {} : { error: result.message }) });
  } catch (err) {
    const reply = `The planner failed: ${(err as Error).message}`;
    entry.ok = false;
    failTurn(turnId, reply);
    return finish({ handled: true, ok: false, reply, error: (err as Error).message });
  } finally {
    inFlight = false;
  }
}

