/**
 * The planner (M13.3; docs/11 § Slice 2; rules docs/07 § JARVIS Voice, the planner row).
 *
 * "Open my most recent project in After Effects", "put the stream chat on the portrait monitor",
 * "do the notepad test but in Word": sentences the rule grammar (parseDesktopCommand) does not
 * match. With desktop control on, main asks a headless `claude -p` (no tools, no MCP servers) for a
 * PLAN, reads the plan's line back aloud, and only then runs it under `runPlan`: the same switch,
 * the same twelve-step cap, the same halt. The model writes steps; `normalisePlan` drops anything
 * outside the rules; nothing the model says is ever executed as a command.
 *
 * This file is the PURE half: which sentences are worth planning, the prompt, the parse of the
 * model's answer, the worked examples chosen from TRAIN ACTION's saved actions, and the log line.
 * The process, the speech and the run are src/main/services/planner.ts.
 */

import type { AppEntry, DesktopStep, DesktopWindow, MonitorInfo } from './desktop.js';
import { MAX_PLAN_STEPS, PLANNER_MAX_TEXT, PLANNER_MAX_WAIT_MS } from './desktop.js';
import { isSensitiveTitle } from './actions.js';

/** The whole prompt stays under this many characters, whatever the desktop holds. */
export const MAX_PROMPT_CHARS = 6000;
/** At most this many windows are listed (25 until 2026-09-27: the front and the unminimised come first). */
export const MAX_PROMPT_WINDOWS = 15;
/**
 * The catalogue: every program that shares a word with the sentence, then at most this many
 * others (alphabetical). Until 2026-09-27 the rest of the 6,000 characters was filled with the
 * whole Start Menu, 300 names on William-Desktop, which the model never needed.
 */
export const MAX_OTHER_PROGRAMS = 20;
/** At most this many saved actions travel as worked examples. */
export const MAX_EXAMPLES = 3;
/** At most this many lines of the planner's own log travel as recent history (20 until 2026-09-27). */
export const MAX_LOG_LINES = 10;
/** How long `claude -p` may take to answer with a plan. */
export const PLANNER_TIMEOUT_MS = 30_000;

/** After the read-back, the time to say "stop" or press Esc before a plan of several steps moves. */
export const GRACE_MS = 1500;
/** The same pause before a single step (2026-09-27: 1.5 s felt like a stall before one launch). */
export const GRACE_SINGLE_MS = 400;

/** How long the planner waits after its read-back before the first step (docs/11 § Slice 2). */
export function graceMs(steps: readonly unknown[]): number {
  return steps.length > 1 ? GRACE_MS : GRACE_SINGLE_MS;
}

/* ────────────────────────── the verb gate ────────────────────────── */

/**
 * The verbs that make a sentence a desktop request worth a model call. The FIRST word after the
 * politeness has to be one of these; "do you know …" and "can you tell me …" are questions, and
 * conversation answers them.
 */
export const DESKTOP_VERBS = [
  'open', 'launch', 'start', 'run', 'load', 'move', 'put', 'send', 'place', 'drag', 'resize', 'maximise', 'maximize', 'snap',
  'click', 'press', 'hit', 'tap', 'type', 'write', 'enter', 'paste', 'switch', 'focus', 'bring', 'show', 'pull', 'do', 'repeat', 'redo', 'fill', 'make', 'set', 'arrange', 'swap', 'split', 'tile'
] as const;

const PREAMBLE = /^(?:(?:hey |ok |okay )?jarvis[,.]?\s+|please\s+|(?:can|could|would|will) you(?: please)?\s+|i (?:want|need|would like|'d like|d like) you to\s+|go ahead and\s+|now\s+|then\s+|just\s+|quickly\s+)+/;

/** The sentence without the courtesy: "Jarvis, could you please open …" → "open …". Lower case. */
export function plannerCore(sentence: string): string {
  return (typeof sentence === 'string' ? sentence : '')
    .toLowerCase()
    .replace(/[“”"]/g, '')
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(PREAMBLE, '')
    .trim();
}

/** True when a sentence starts with a desktop verb and is not a question about one. */
export function isPlannable(sentence: string): boolean {
  const core = plannerCore(sentence);
  if (!core || core.length > 400) return false;
  const [first = '', second = ''] = core.split(' ');
  if (!(DESKTOP_VERBS as readonly string[]).includes(first)) return false;
  // "do you …", "do i …", "make sense", "show me what you can do" are conversation.
  if (first === 'do' && /^(?:you|i|we|they|it|not|nothing|so)$/.test(second)) return false;
  if (first === 'make' && /^(?:sense|sure|a joke)$/.test(second)) return false;
  if (first === 'show' && /^(?:me)$/.test(second) && /\b(?:what|how)\b/.test(core)) return false;
  // Closing, deleting and shutting down are never planned (docs/07): nothing to plan for.
  if (/\b(?:close|quit|exit|kill|delete|uninstall|shut ?down|restart|log ?off|sign ?out|lock)\b/.test(core)) return false;
  return true;
}

/* ────────────────────────── worked examples ────────────────────────── */

/** What the planner may know about a saved action: its name, description and readable lines. */
export interface ExampleSource {
  name: string;
  description: string;
  summary: readonly string[];
}

const STOP = new Set(['the', 'a', 'an', 'my', 'me', 'to', 'on', 'in', 'of', 'and', 'or', 'it', 'this', 'that', 'but', 'with', 'for', 'at', 'is', 'do', 'please', 'jarvis', 'then', 'now', 'test', 'action', 'up']);

function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t));
}

/** How many of the sentence's words appear in the action's name and description. */
export function overlapScore(sentence: string, action: Pick<ExampleSource, 'name' | 'description'>): number {
  const asked = new Set(tokens(sentence));
  if (!asked.size) return 0;
  const own = new Set(tokens(`${action.name} ${action.description}`));
  let hit = 0;
  for (const t of asked) if (own.has(t)) hit++;
  // A word of the NAME counts twice: "the notepad test" is about the action called that.
  const name = new Set(tokens(action.name));
  for (const t of asked) if (name.has(t)) hit++;
  return hit;
}

/** Up to MAX_EXAMPLES saved actions, best overlap first; none that share no word with the sentence. */
export function chooseExamples<T extends ExampleSource>(sentence: string, actions: readonly T[], max = MAX_EXAMPLES): T[] {
  return actions
    .map((action, i) => ({ action, i, score: overlapScore(sentence, action) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, max)
    .map((c) => c.action);
}

/**
 * A summary line with every coordinate taken out. The saved `summary` lines carry none, but they
 * are read back from a file under userData, so the prompt does not take that on trust: anything
 * like "1234,567", "x=12", "(80, 40)" or "1920x1080" goes.
 */
export function scrubCoordinates(line: string): string {
  return line
    .replace(/\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/g, '')
    .replace(/\[\s*-?\d+(?:\s*,\s*-?\d+){1,3}\s*\]/g, '')
    .replace(/-?\d+(?:\.\d+)?\s*[,x×]\s*-?\d+(?:\.\d+)?/g, '')
    .replace(/\b(?:x|y|dx|dy|left|top|width|height|rel[xy])\s*[=:]\s*-?\d+(?:\.\d+)?/gi, '')
    .replace(/\b(?:at|to)\s+-?\d{2,5}\b/gi, '')
    .replace(/\b\d{3,5}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/* ────────────────────────── the prompt ────────────────────────── */

export interface PlannerInput {
  sentence: string;
  windows: readonly Pick<DesktopWindow, 'title' | 'process' | 'monitor' | 'minimized' | 'foreground'>[];
  monitors: readonly Pick<MonitorInfo, 'index' | 'primary' | 'width' | 'height' | 'label'>[];
  apps: readonly Pick<AppEntry, 'name'>[];
  /** Saved actions; the prompt picks up to three by overlap and uses only their words. */
  actions: readonly ExampleSource[];
  /** Raw lines of planner.log.jsonl, oldest first; the prompt keeps the last MAX_LOG_LINES. */
  log: readonly string[];
}

const RULES = [
  'You plan desktop actions on William\'s Windows PC for JARVIS, the voice of SkynetOS. You never act: you write a plan, JARVIS reads it aloud, then a separate program runs it under its own rules and drops any step outside them.',
  'Rules:',
  `- At most ${MAX_PLAN_STEPS} steps. Fewer is better. If it cannot be done in ${MAX_PLAN_STEPS}, set "ask" instead.`,
  '- Only these step kinds, exactly as written:',
  '  {"kind":"launch","app":"<a PROGRAMS name>","monitor":<n, optional>,"layout":"fill|left|right|top|bottom|centre, optional"}',
  '  {"kind":"focus","window":"<words from a WINDOWS title>"}',
  '  {"kind":"place","window":"<words from a WINDOWS title>","monitor":<n>,"layout":"<optional, as above>"}  (move or resize a window)',
  '  {"kind":"uiaClick","window":"<words from a title>","control":"<the UI Automation name of a button, tab, menu item or list item>","type":"Button|MenuItem|TabItem|ListItem|Hyperlink|Edit|…, optional"}',
  `  {"kind":"keys","text":"<text to type, at most ${PLANNER_MAX_TEXT} characters>"}  or  {"kind":"keys","combo":"ctrl+s"}`,
  `  {"kind":"wait","ms":<at most ${PLANNER_MAX_WAIT_MS}>}`,
  '- No coordinates, no mouse moves, no URLs, no file paths, no shell or terminal, no command line, no scripts.',
  '- Never press alt+f4, win+l, ctrl+alt+delete, ctrl+shift+esc, win, win+r, win+x, ctrl+w or ctrl+q, or anything else with the Windows key.',
  '- Never close a program, answer a dialog (OK, Yes, Save, Delete, Allow, Don\'t Save …), sign in, send, buy or delete anything.',
  '- Launch only an installed program: a name from PROGRAMS (the list may be cut short; a well-known program by its usual name is checked against the full Start Menu). Refer to a window by words that are in its title in WINDOWS, or by the program you launched.',
  '- If a step needs a decision (which file, which window, which monitor is meant, anything you cannot see), STOP: return no steps and put one short question in "ask".',
  '- If the sentence is not a request to do something on the desktop, return {"say":"","steps":[],"ask":null}.',
  '- "say" is ONE short spoken line in the JARVIS register (formal, British, no exclamation marks) saying what is about to happen, e.g. "Opening Word and typing the note, sir."'
].join('\n');

const ANSWER = [
  'ANSWER with one JSON object and nothing else, no prose, no code fence:',
  '{"say":"<one line to read back>","steps":[ … ],"ask":"<question>" or null}'
].join('\n');

const oneLine = (s: string, max: number): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** Lines added in order until the next would pass `budget` characters (newlines counted). */
function fit(lines: readonly string[], budget: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (const line of lines) {
    const cost = line.length + 1;
    if (used + cost > budget) break;
    out.push(line);
    used += cost;
  }
  return out;
}

function windowLines(windows: PlannerInput['windows']): string[] {
  const ranked = [...windows].sort((a, b) => Number(b.foreground) - Number(a.foreground) || Number(a.minimized) - Number(b.minimized));
  return ranked.slice(0, MAX_PROMPT_WINDOWS).map((w) => {
    const title = isSensitiveTitle(w.title) ? '(a sign-in window)' : oneLine(w.title, 90);
    const flags = [w.monitor ? `monitor ${w.monitor}` : 'off-screen', w.minimized ? 'minimised' : '', w.foreground ? 'IN FRONT' : ''].filter(Boolean).join(', ');
    return `- "${title}" (${oneLine(w.process || '?', 30)}; ${flags})`;
  });
}

function monitorLines(monitors: PlannerInput['monitors']): string[] {
  return monitors.map((m) => {
    const shape = m.height > m.width ? 'portrait' : 'landscape';
    return `- ${m.index}: ${m.width}x${m.height} ${shape}${m.primary ? ', primary' : ''}${m.label ? ` (${oneLine(m.label, 30)})` : ''}`;
  });
}

/** Catalogue names, the ones that share a word with the sentence first. */
function appNames(sentence: string, apps: PlannerInput['apps']): string[] {
  const asked = new Set(tokens(sentence));
  const seen = new Set<string>();
  const names = apps.map((a) => oneLine(a.name, 50)).filter((n) => { const k = n.toLowerCase(); if (!n || seen.has(k)) return false; seen.add(k); return true; });
  const relevant = names.filter((n) => tokens(n).some((t) => asked.has(t)));
  const rest = names.filter((n) => !relevant.includes(n)).sort((a, b) => a.localeCompare(b)).slice(0, MAX_OTHER_PROGRAMS);
  return [...relevant, ...rest];
}

function exampleLines(sentence: string, actions: PlannerInput['actions']): string[] {
  const lines: string[] = [];
  for (const action of chooseExamples(sentence, actions)) {
    const description = scrubCoordinates(oneLine(action.description, 160));
    lines.push(`## "${scrubCoordinates(oneLine(action.name, 60))}"${description ? ` — ${description}` : ''}`);
    for (const line of action.summary.slice(0, 14)) {
      const clean = scrubCoordinates(oneLine(String(line), 100));
      if (clean) lines.push(`  ${clean}`);
    }
  }
  return lines;
}

/** One planner.log.jsonl line as a short history line, or null. Only the sentence and what ran. */
export function logLineForPrompt(raw: string): string | null {
  try {
    const o = JSON.parse(raw) as { sentence?: unknown; steps?: unknown; ok?: unknown; ask?: unknown };
    const sentence = typeof o.sentence === 'string' ? oneLine(o.sentence, 70) : '';
    if (!sentence) return null;
    if (typeof o.ask === 'string' && o.ask) return `- "${sentence}" → asked: ${oneLine(o.ask, 60)}`;
    const steps = Array.isArray(o.steps) ? o.steps : [];
    const kinds = steps.map((s) => (s && typeof s === 'object' && typeof (s as { kind?: unknown }).kind === 'string' ? (s as { kind: string }).kind : '?')).join(', ');
    return `- "${sentence}" → ${kinds || 'nothing'}${o.ok === true ? ' (done)' : o.ok === false ? ' (failed)' : ''}`;
  } catch {
    return null;
  }
}

/**
 * The prompt, at most MAX_PROMPT_CHARS: the rules, William's sentence, the desktop now (monitors,
 * up to 25 windows, the catalogue), up to three saved actions as worked examples (their words,
 * never their coordinates), the last lines of the planner's own log, and the answer format.
 * Sections are filled in order of importance; the catalogue and the log take what is left.
 */
export function plannerPrompt(input: PlannerInput): string {
  const sentence = oneLine(typeof input.sentence === 'string' ? input.sentence : '', 400).replace(/"/g, '\'');
  const head = [`# RULES\n${RULES}`, `# WILLIAM SAID\n"${sentence}"`];
  const tail = [`# ${ANSWER}`];
  const monitors = monitorLines(input.monitors);
  const fixed = [...head, `# MONITORS (spoken numbers)\n${monitors.join('\n') || '- 1: unknown'}`, ...tail].join('\n\n');
  let budget = MAX_PROMPT_CHARS - fixed.length - 200; // headings and blank lines for the rest

  const wins = fit(windowLines(input.windows), Math.max(0, Math.min(budget, 2200)));
  budget -= wins.reduce((n, l) => n + l.length + 1, 0);
  const examples = fit(exampleLines(input.sentence, input.actions), Math.max(0, Math.min(budget, 1400)));
  budget -= examples.reduce((n, l) => n + l.length + 1, 0);
  const logLines = input.log.slice(-MAX_LOG_LINES).map(logLineForPrompt).filter((l): l is string => !!l);
  const log = fit(logLines.slice().reverse(), Math.max(0, Math.min(budget - 400, 900))).reverse();
  budget -= log.reduce((n, l) => n + l.length + 1, 0);
  const apps: string[] = [];
  let used = 0;
  for (const name of appNames(input.sentence, input.apps)) {
    if (used + name.length + 2 > Math.max(0, budget)) break;
    apps.push(name);
    used += name.length + 2;
  }

  const sections = [
    ...head,
    `# MONITORS (spoken numbers)\n${monitors.join('\n') || '- 1: unknown'}`,
    `# WINDOWS (${wins.length} of ${input.windows.length})\n${wins.join('\n') || '- none listed'}`,
    `# PROGRAMS (${apps.length} of ${input.apps.length}; launch uses these names)\n${apps.join('; ') || 'none'}`,
    ...(examples.length ? [`# SAVED ACTIONS William recorded (worked examples: what he clicked and typed)\n${examples.join('\n')}`] : []),
    ...(log.length ? [`# RECENT PLANS\n${log.join('\n')}`] : []),
    ...tail
  ];
  const prompt = sections.join('\n\n');
  // The budget above keeps it under; this is the belt to those braces, and keeps the answer format.
  if (prompt.length <= MAX_PROMPT_CHARS) return prompt;
  const answer = `\n\n# ${ANSWER}`;
  return prompt.slice(0, MAX_PROMPT_CHARS - answer.length) + answer;
}

/* ────────────────────────── the answer ────────────────────────── */

export interface PlannerReply {
  say: string;
  steps: unknown[];
  ask: string | null;
}

/** The first balanced JSON object in a text, string-aware, or null. */
export function firstJsonObject(text: string): string | null {
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          try { JSON.parse(candidate); return candidate; } catch { break; }
        }
      }
    }
  }
  return null;
}

/**
 * The model's answer, parsed defensively: a bare object, one inside a ```json fence, or the first
 * object in prose. Missing fields default (no say, no steps, no question); anything that is not an
 * object is an error. The steps are NOT checked here: `normalisePlan` does that.
 */
export function parsePlannerReply(raw: unknown): { ok: true; reply: PlannerReply } | { ok: false; error: string } {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, error: 'the planner said nothing' };
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const body = firstJsonObject(fenced ? fenced[1]! : raw) ?? (fenced ? firstJsonObject(raw) : null);
  if (!body) return { ok: false, error: 'the planner did not answer with a plan' };
  let value: unknown;
  try { value = JSON.parse(body); } catch { return { ok: false, error: 'the planner\'s plan was not valid JSON' }; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'the planner\'s plan was not an object' };
  const o = value as Record<string, unknown>;
  const say = typeof o['say'] === 'string' ? oneLine(o['say'], 240) : '';
  const ask = typeof o['ask'] === 'string' && o['ask'].trim() ? oneLine(o['ask'], 240) : null;
  const steps = Array.isArray(o['steps']) ? o['steps'] : [];
  return { ok: true, reply: { say, steps, ask } };
}

/* ────────────────────────── the log ────────────────────────── */

export interface PlannerLogEntry {
  at: string;
  sentence: string;
  say: string;
  ask: string | null;
  steps: DesktopStep[];
  dropped: string[];
  /** Per step that ran: `element` (a control found by name), `ok`, or `failed: <why>`. */
  tiers: string[];
  ok: boolean | null;
  message: string;
  ms: number;
}

/** The reply spoken when the planner will not run a plan it was given. */
export function refusalLine(dropped: readonly string[]): string {
  const first = (dropped[0] ?? 'part of it is outside the rules').replace(/^step \d+:\s*/, '').replace(/[.\s]+$/, '');
  return `I will not run that plan: ${first}.`;
}
