import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESKTOP,
  MAX_PLAN_STEPS,
  PLANNER_MAX_WAIT_MS,
  normalisePlan,
  plannerActive,
  plannerChord,
  type AppEntry
} from '../packages/shared/desktop.js';
import {
  MAX_PROMPT_CHARS,
  MAX_PROMPT_WINDOWS,
  chooseExamples,
  firstJsonObject,
  isPlannable,
  logLineForPrompt,
  parsePlannerReply,
  plannerPrompt,
  refusalLine,
  scrubCoordinates,
  type ExampleSource,
  type PlannerInput
} from '../packages/shared/planner.js';
import { DEFAULT_CONVERSE } from '../packages/shared/converse.js';
import { AGENT_METHODS, CHANNELS, HOLOGRAM_ALLOWED, REMOTE_METHODS, VISION_METHODS, VOICE_METHODS } from '../packages/shared/ipc.js';
import { resolveIntent, type IntentContext } from '../packages/shared/intent.js';

/** M13.3, the planner: docs/11 § Slice 2, docs/07 § JARVIS Voice (the planner row). */

const app = (name: string): AppEntry => ({ name, path: `C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\${name}.lnk`, source: 'startmenu' });
// The last six are on this PC's real Start Menu (2026-09-27), and each takes typed commands.
const APPS: AppEntry[] = ['Notepad', 'Word', 'Adobe After Effects 2026', 'Firefox', 'Windows Terminal', 'Command Prompt', 'Windows PowerShell', 'OBS Studio',
  'Python 3.14', 'IDLE (Python 3.14)', 'Git for Windows', 'Run', 'Control Panel', 'Administrative Tools'].map(app);
const CTX = { apps: APPS, monitors: 3 };

const ACTIONS: ExampleSource[] = [
  { name: 'Morning setup', description: 'OBS and Discord on two', summary: ['CLICK   obs64 · "Start Streaming" button'] },
  { name: 'Notepad test', description: 'open notepad and type a line', summary: ['CLICK   explorer · "Notepad" listitem', 'TYPE    "hello from jarvis"', 'KEY     CTRL+S'] },
  { name: 'Stream chat', description: 'twitch chat popout on the portrait monitor', summary: ['CLICK   firefox · "Popout chat" menuitem'] },
  { name: 'Invoice run', description: 'finance export', summary: ['CLICK   excel · "Export" button'] }
];

function input(over: Partial<PlannerInput> = {}): PlannerInput {
  return {
    sentence: 'do the notepad test but in Word',
    windows: [
      { title: 'Untitled - Notepad', process: 'notepad', monitor: 1, minimized: false, foreground: true },
      { title: 'Twitch chat - Mozilla Firefox', process: 'firefox', monitor: 2, minimized: false, foreground: false }
    ],
    monitors: [
      { index: 1, primary: true, width: 2560, height: 1440, label: 'DISPLAY3' },
      { index: 2, primary: false, width: 1920, height: 1080, label: 'DISPLAY1' },
      { index: 3, primary: false, width: 1080, height: 1920, label: 'DISPLAY2' }
    ],
    apps: APPS,
    actions: ACTIONS,
    log: [],
    ...over
  };
}

describe('the planner: settings', () => {
  it('plans only when desktop control is on as well, so a new install never plans', () => {
    expect(DEFAULT_DESKTOP.enabled).toBe(false);
    expect(DEFAULT_DESKTOP.planner).toBe(true);
    expect(plannerActive(DEFAULT_DESKTOP)).toBe(false);
    expect(plannerActive({ enabled: true, planner: true })).toBe(true);
    expect(plannerActive({ enabled: true, planner: false })).toBe(false);
    expect(plannerActive(null)).toBe(false);
    expect(DEFAULT_DESKTOP.plannerModel).toBe(DEFAULT_CONVERSE.model);
  });
});

describe('the planner: the verb gate', () => {
  it('lets through desktop requests the rules did not match', () => {
    for (const s of ['open my most recent project in After Effects', 'put the stream chat on the portrait monitor', 'do the notepad test but in Word', 'Jarvis, could you please type hello into notepad', 'switch to firefox', 'click the record button in OBS']) {
      expect(isPlannable(s), s).toBe(true);
    }
  });
  it('leaves questions, chatter and closing to conversation', () => {
    for (const s of ['what time is it', 'do you know what day it is', 'how are you', 'can you tell me a joke', 'make sense of this', 'close notepad', 'open notepad and delete everything', 'shut down the computer', '', 'show me what you can do']) {
      expect(isPlannable(s), s).toBe(false);
    }
  });
});

describe('the planner: the prompt', () => {
  it('holds the rules, the sentence, the context and the answer format', () => {
    const p = plannerPrompt(input());
    for (const section of ['# RULES', '# WILLIAM SAID', '# MONITORS', '# WINDOWS', '# PROGRAMS', '# SAVED ACTIONS', '# ANSWER']) expect(p).toContain(section);
    expect(p).toContain('do the notepad test but in Word');
    expect(p).toContain('Untitled - Notepad');
    expect(p).toContain('portrait');
    expect(p).toContain('"steps"');
    expect(p).toMatch(/alt\+f4/);
    expect(p).toMatch(/uiaClick/);
    expect(p).toMatch(/"ask"/);
  });

  it('stays under 6,000 characters with a crowded desktop, and lists at most 25 windows', () => {
    const windows = Array.from({ length: 80 }, (_, i) => ({ title: `Window number ${i} with a very long title that goes on and on about something ${'x'.repeat(60)}`, process: `proc${i}`, monitor: 1, minimized: false, foreground: false }));
    const apps = Array.from({ length: 400 }, (_, i) => app(`Program ${i} with a long shortcut name`));
    const log = Array.from({ length: 60 }, (_, i) => JSON.stringify({ sentence: `sentence ${i} ${'y'.repeat(80)}`, steps: [{ kind: 'launch' }], ok: true }));
    const actions = Array.from({ length: 30 }, (_, i) => ({ name: `Notepad test ${i}`, description: 'notepad '.repeat(40), summary: Array.from({ length: 50 }, () => 'TYPE    "' + 'z'.repeat(60) + '"') }));
    const p = plannerPrompt(input({ windows, apps, log, actions }));
    expect(p.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
    const listed = p.split('\n').filter((l) => l.startsWith('- "Window number'));
    expect(listed.length).toBeLessThanOrEqual(MAX_PROMPT_WINDOWS);
    expect(p).toContain('# ANSWER');
    expect(p).toContain('# RULES');
  });

  it('picks worked examples by overlap with the sentence, at most three', () => {
    expect(chooseExamples('do the notepad test but in Word', ACTIONS).map((a) => a.name)[0]).toBe('Notepad test');
    expect(chooseExamples('put the stream chat on the portrait monitor', ACTIONS).map((a) => a.name)[0]).toBe('Stream chat');
    expect(chooseExamples('what is the weather', ACTIONS)).toEqual([]);
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `Notepad ${i}`, description: 'notepad', summary: [] }));
    expect(chooseExamples('open notepad', many)).toHaveLength(3);
    const p = plannerPrompt(input());
    expect(p).toContain('"Notepad test"');
    expect(p).not.toContain('Invoice run');
  });

  it('never lets a coordinate into an example', () => {
    const leaky: ExampleSource = {
      name: 'Notepad test',
      description: 'click at 1234,567 then (80, 40) on 1920x1080',
      summary: ['CLICK   notepad · "File" menuitem at 1234,567', 'MOVE    x=4321 y=876', 'CLICK   rect [100, 200, 300, 400]', 'TYPE    "hello"']
    };
    const p = plannerPrompt(input({ actions: [leaky], windows: [], monitors: [] }));
    for (const n of ['1234', '567', '4321', '876', '1920x1080', '[100', '(80, 40)']) expect(p).not.toContain(n);
    expect(p).toContain('"File" menuitem');
    expect(p).toContain('TYPE "hello"');
    expect(scrubCoordinates('CLICK at 1234, 567 in explorer')).not.toMatch(/\d/);
  });

  it('hides a sign-in window\'s title and keeps the log to sentences and step kinds', () => {
    const p = plannerPrompt(input({ windows: [{ title: 'Sign in to your account - Firefox', process: 'firefox', monitor: 1, minimized: false, foreground: true }], log: [JSON.stringify({ sentence: 'open word', steps: [{ kind: 'launch', app: 'Word' }], ok: true }), 'not json'] }));
    expect(p).not.toContain('Sign in to your account');
    expect(p).toContain('(a sign-in window)');
    expect(p).toContain('- "open word" → launch (done)');
    expect(logLineForPrompt('garbage')).toBeNull();
  });
});

describe('the planner: the answer', () => {
  it('parses a bare object', () => {
    const r = parsePlannerReply('{"say":"Opening Word, sir.","steps":[{"kind":"launch","app":"Word"}],"ask":null}');
    expect(r).toEqual({ ok: true, reply: { say: 'Opening Word, sir.', steps: [{ kind: 'launch', app: 'Word' }], ask: null } });
  });
  it('parses a fenced object, and one inside prose', () => {
    const fenced = parsePlannerReply('Here is the plan:\n```json\n{"say":"Done.","steps":[],"ask":"Which project, sir?"}\n```\n');
    expect(fenced.ok && fenced.reply.ask).toBe('Which project, sir?');
    const prose = parsePlannerReply('Sure. {"say":"A {brace} in a string","steps":[{"kind":"wait","ms":10}]} trailing');
    expect(prose.ok && prose.reply.say).toBe('A {brace} in a string');
    expect(firstJsonObject('x {bad json} {"a":1}')).toBe('{"a":1}');
  });
  it('refuses garbage and defaults missing fields', () => {
    expect(parsePlannerReply('I cannot do that.').ok).toBe(false);
    expect(parsePlannerReply('').ok).toBe(false);
    expect(parsePlannerReply(undefined).ok).toBe(false);
    expect(parsePlannerReply('[1,2,3]').ok).toBe(false);
    expect(parsePlannerReply('{"steps": [}').ok).toBe(false);
    expect(parsePlannerReply('{}')).toEqual({ ok: true, reply: { say: '', steps: [], ask: null } });
    expect(parsePlannerReply('{"say":5,"steps":"launch","ask":""}')).toEqual({ ok: true, reply: { say: '', steps: [], ask: null } });
  });
});

describe('the planner: normalisePlan', () => {
  it('keeps the six step kinds, rewrites a launch to its catalogue name, and caps the wait', () => {
    const out = normalisePlan([
      { kind: 'launch', app: 'word', monitor: 2, layout: 'left' },
      { kind: 'wait', ms: 60_000 },
      { kind: 'focus', window: 'Document1 - Word' },
      { kind: 'uiaClick', window: 'Word', control: 'Blank document', type: 'ListItem' },
      { kind: 'keys', text: 'hello from jarvis' },
      { kind: 'keys', combo: 'Ctrl+S' },
      { kind: 'place', window: 'Word', monitor: 3, layout: 'center' },
      { kind: 'wait', ms: -5 }
    ], CTX);
    expect(out.dropped).toEqual([]);
    expect(out.steps).toEqual([
      { kind: 'launch', app: 'Word', monitor: 2, layout: 'left' },
      { kind: 'wait', ms: PLANNER_MAX_WAIT_MS },
      { kind: 'focus', window: 'Document1 - Word' },
      { kind: 'uiaClick', window: 'Word', control: 'Blank document', type: 'ControlType.ListItem' },
      { kind: 'keys', text: 'hello from jarvis' },
      { kind: 'keys', combo: 'ctrl+s' },
      { kind: 'place', window: 'Word', monitor: 3, layout: 'centre' },
      { kind: 'wait', ms: 0 }
    ]);
  });

  it('drops alt+f4 and every refused or Windows-key chord', () => {
    for (const combo of ['alt+f4', 'F4+ALT', 'win+l', 'ctrl+alt+delete', 'ctrl+shift+esc', 'win', 'win+r', 'win+x', 'ctrl+w', 'ctrl+q', 'win+up', 'alt+space']) {
      const out = normalisePlan([{ kind: 'keys', combo }], CTX);
      expect(out.steps, combo).toEqual([]);
      expect(out.dropped, combo).toHaveLength(1);
      expect(plannerChord(combo).ok, combo).toBe(false);
    }
    expect(plannerChord('ctrl+shift+n')).toEqual({ ok: true, chord: 'ctrl+shift+n' });
    expect(plannerChord('ctrl+banana').ok).toBe(false);
  });

  it('refuses a plan of 20 steps whole, and accepts twelve', () => {
    const twenty = Array.from({ length: 20 }, () => ({ kind: 'wait', ms: 100 }));
    const out = normalisePlan(twenty, CTX);
    expect(out.steps).toEqual([]);
    expect(out.dropped.join(' ')).toMatch(/20 steps/);
    expect(normalisePlan(twenty.slice(0, MAX_PLAN_STEPS), CTX).steps).toHaveLength(MAX_PLAN_STEPS);
  });

  it('drops every shell string, path, unknown kind and coordinate', () => {
    const attempts: unknown[] = [
      { kind: 'run', command: 'powershell -c Remove-Item C:\\ -Recurse' },
      { kind: 'shell', text: 'del /s /q C:\\' },
      { kind: 'launch', app: 'cmd.exe /c del C:\\*' },
      { kind: 'launch', app: 'C:\\Windows\\System32\\cmd.exe' },
      { kind: 'launch', app: 'Windows PowerShell' },
      { kind: 'launch', app: 'Command Prompt' },
      { kind: 'launch', app: 'Windows Terminal' },
      { kind: 'launch', app: 'Totally Unknown App' },
      { kind: 'launch', app: 'Python 3.14' },
      { kind: 'launch', app: 'IDLE' },
      { kind: 'launch', app: 'Git for Windows' },
      { kind: 'launch', app: 'run' },
      { kind: 'launch', app: 'Control Panel' },
      { kind: 'launch', app: 'Administrative Tools' },
      { kind: 'focus', window: 'Administrator: Windows PowerShell' },
      { kind: 'uiaClick', window: 'Terminal', control: 'New tab' },
      { kind: 'mouse', x: 100, y: 200, click: 'left' },
      { kind: 'url', url: 'https://example.com' },
      { kind: 'say', text: 'hello' },
      { kind: 'keys', text: 'x'.repeat(501) },
      { kind: 'keys', text: 'a', combo: 'ctrl+a' },
      'launch notepad',
      null
    ];
    const out = normalisePlan(attempts, CTX);
    expect(out.steps).toEqual([]);
    expect(out.dropped).toHaveLength(attempts.length);
    expect(normalisePlan('launch everything', CTX)).toEqual({ steps: [], dropped: ['the steps were not a list'] });
  });

  it('never answers a dialog, closes a program, or touches a sign-in window', () => {
    for (const control of ['OK', 'Yes', "Don't Save", 'Delete', 'Allow', 'Close', 'Exit', 'Sign in', 'Install']) {
      expect(normalisePlan([{ kind: 'uiaClick', window: 'Word', control }], CTX).steps, control).toEqual([]);
    }
    expect(normalisePlan([{ kind: 'focus', window: 'Sign in - Google Accounts' }], CTX).steps).toEqual([]);
    expect(normalisePlan([{ kind: 'place', window: 'Word', monitor: 9 }], CTX).steps).toEqual([]);
    expect(refusalLine(['step 2: alt+f4 closes, locks or opens a shell, which is yours to do'])).toBe('I will not run that plan: alt+f4 closes, locks or opens a shell, which is yours to do.');
  });
});

describe('the planner: the intent path and the channel', () => {
  const ctx = (): IntentContext => ({ boardId: 'root', nodes: [], edges: [], actor: 'voice', apps: APPS, monitors: 3 });

  it('offers an unmatched open, and a changed saved action, to the planner', () => {
    const open = resolveIntent('open my most recent project in after effects', ctx());
    expect(open).toMatchObject({ kind: 'unknown', understood: true, plannable: true });
    expect(resolveIntent('do the notepad test but in word', ctx())).toMatchObject({ kind: 'unknown', understood: false });
    expect(resolveIntent('do the notepad test', ctx())).toMatchObject({ kind: 'action', name: 'notepad test' });
    // The sentence William tries first (docs/11 § Still open): the rules cannot type, so it is planned.
    expect(resolveIntent('open notepad and type hello from jarvis', ctx())).toMatchObject({ kind: 'unknown', plannable: true });
    expect(isPlannable('open notepad and type hello from jarvis')).toBe(true);
    // The rule grammar still wins where it matches.
    expect(resolveIntent('open notepad on two', ctx())).toMatchObject({ kind: 'desktop' });
  });

  it('is a user-only channel: the board and the hologram window, never an agent, a phone or a capture page', () => {
    expect(CHANNELS).toContain('desktop:plan');
    expect(HOLOGRAM_ALLOWED as readonly string[]).toContain('desktop:plan');
    expect(AGENT_METHODS as readonly string[]).not.toContain('desktop:plan');
    expect(REMOTE_METHODS as readonly string[]).not.toContain('desktop:plan');
    expect(VISION_METHODS as readonly string[]).not.toContain('desktop:plan');
    expect(VOICE_METHODS as readonly string[]).not.toContain('desktop:plan');
    // Running an arbitrary plan stays off the hologram's list: it plans, it does not take steps.
    expect(HOLOGRAM_ALLOWED as readonly string[]).not.toContain('desktop:run');
  });
});
