import { describe, expect, it } from 'vitest';
import {
  FOREGROUND,
  parseReachCommand,
  pickWindow,
  replyFor,
  spokenChord,
  splitBounds,
  titleBarPoint,
  windowTarget,
  type AppEntry,
  type DesktopStep
} from '../packages/shared/desktop.js';
import { resolveIntent, stripPreamble, type IntentContext } from '../packages/shared/intent.js';

/*
 * 2026-09-27, William: "Jarvis, hit play on the video in my firefox browser … intelligently use my
 * mouse to select the firefox window, then hit spacebar." Every phrase the reaching grammar takes,
 * walked, and every refusal it must make (docs/11 § Reaching into windows, the board, and a terminal).
 */

const APPS: AppEntry[] = [
  { name: 'Firefox', path: 'C:/sm/firefox.lnk', source: 'startmenu' },
  { name: 'notepad', path: 'C:\\Windows\\notepad.exe', source: 'settings' },
  { name: 'Windows Terminal', path: 'C:/sm/wt.lnk', source: 'startmenu' }
];

function ctx(over: Partial<IntentContext> = {}): IntentContext {
  return { boardId: 'root', nodes: [], edges: [], selectedId: null, actor: 'voice', apps: APPS, monitors: 3, ...over };
}

const reach = (heard: string): ReturnType<typeof parseReachCommand> => parseReachCommand(stripPreamble(heard), heard, { apps: APPS });

/** [said, window, the action step, the line said afterwards] */
const PHRASES: [string, string, DesktopStep, string][] = [
  ['Jarvis, hit play on the video in my firefox browser', 'firefox', { kind: 'keys', combo: 'space' }, 'Play in Firefox.'],
  ['press pause in firefox', 'firefox', { kind: 'keys', combo: 'space' }, 'Pause in Firefox.'],
  ['hit play pause in firefox', 'firefox', { kind: 'keys', combo: 'space' }, 'Play/pause in Firefox.'],
  ['hit mute in firefox', 'firefox', { kind: 'keys', combo: 'm' }, 'Mute in Firefox.'],
  ['press fullscreen in firefox', 'firefox', { kind: 'keys', combo: 'f' }, 'Fullscreen in Firefox.'],
  ['press full screen on the video in firefox', 'firefox', { kind: 'keys', combo: 'f' }, 'Fullscreen in Firefox.'],
  ['press next in firefox', 'firefox', { kind: 'keys', combo: 'shift+n' }, 'Next in Firefox.'],
  ['hit next video in firefox', 'firefox', { kind: 'keys', combo: 'shift+n' }, 'Next in Firefox.'],
  ['press back in firefox', 'firefox', { kind: 'keys', combo: 'alt+left' }, 'Back in Firefox.'],
  ['hit refresh in my browser', 'browser', { kind: 'keys', combo: 'f5' }, 'Refresh in Firefox.'],
  ['press reload in the browser', 'browser', { kind: 'keys', combo: 'f5' }, 'Refresh in Firefox.'],
  ['press the space bar in firefox', 'firefox', { kind: 'keys', combo: 'space' }, 'space in Firefox.'],
  ['press control s in notepad', 'notepad', { kind: 'keys', combo: 'ctrl+s' }, 'ctrl+s in Notepad.'],
  ['press ctrl+shift+t in firefox', 'firefox', { kind: 'keys', combo: 'ctrl+shift+t' }, 'ctrl+shift+t in Firefox.'],
  ['press enter in notepad', 'notepad', { kind: 'keys', combo: 'enter' }, 'enter in Notepad.'],
  ['press page down in notepad', 'notepad', { kind: 'keys', combo: 'pagedown' }, 'pagedown in Notepad.'],
  ['press f five in firefox', 'firefox', { kind: 'keys', combo: 'f5' }, 'f5 in Firefox.'],
  ['scroll down in firefox', 'firefox', { kind: 'scroll', direction: 'down', notches: 5 }, 'Scrolled down in Firefox.'],
  ['scroll up a bit in the terminal', 'terminal', { kind: 'scroll', direction: 'up', notches: 2 }, 'Scrolled up in the terminal.'],
  ['scroll down three times in notepad', 'notepad', { kind: 'scroll', direction: 'down', notches: 3 }, 'Scrolled down in Notepad.'],
  ['scroll down a lot in jarvis tqr', 'jarvis tqr', { kind: 'scroll', direction: 'down', notches: 10 }, 'Scrolled down in Jarvis Tqr.'],
  ['Jarvis, click the Subscribe button in Firefox.', 'firefox', { kind: 'uiaClick', window: FOREGROUND, control: 'Subscribe' }, 'Subscribe pressed in Firefox.'],
  ['click on settings in notepad', 'notepad', { kind: 'uiaClick', window: FOREGROUND, control: 'settings' }, 'Settings pressed in Notepad.'],
  ['press the subscribe button in firefox', 'firefox', { kind: 'uiaClick', window: FOREGROUND, control: 'subscribe' }, 'Subscribe pressed in Firefox.'],
  ['press record in obs', 'obs', { kind: 'uiaClick', window: FOREGROUND, control: 'record' }, 'Record pressed in OBS.'],
  ['Jarvis, type Hello, World! into Notepad.', 'notepad', { kind: 'keys', text: 'Hello, World!' }, 'Typed it into Notepad.'],
  ['write shopping list in notepad', 'notepad', { kind: 'keys', text: 'shopping list' }, 'Typed it into Notepad.']
];

describe('reaching into a window: the phrase table', () => {
  it.each(PHRASES)('%s', (said, window, action, reply) => {
    const out = reach(said);
    expect(out && 'plan' in out, said).toBe(true);
    if (!out || !('plan' in out)) return;
    // Exactly two steps: the pointer finds the window, then the action. Nothing else.
    expect(out.plan.steps).toEqual([{ kind: 'focus', window, focusByPointer: true }, action]);
    expect(out.plan.reply).toBe(reply);
  });

  it('reaches resolveIntent as a desktop plan, spoken or typed', () => {
    const spoken = resolveIntent('Jarvis, hit play on the video in my firefox browser', ctx());
    expect(spoken.kind).toBe('desktop');
    if (spoken.kind === 'desktop') {
      expect(spoken.plan.source).toBe('voice');
      expect(spoken.plan.steps[0]).toEqual({ kind: 'focus', window: 'firefox', focusByPointer: true });
    }
    const typed = resolveIntent('scroll down in firefox', ctx({ actor: 'user' }));
    expect(typed.kind === 'desktop' && typed.plan.source).toBe('typed');
  });

  it('needs no catalogue: the window is matched at run time', () => {
    const out = resolveIntent('press play in firefox', ctx({ apps: [] }));
    expect(out.kind).toBe('desktop');
  });

  it('says the plan\'s own line when every step ran, and only the failure otherwise', () => {
    const out = reach('hit play in firefox');
    if (!out || !('plan' in out)) throw new Error('no plan');
    const [focus, keys] = out.plan.steps as [DesktopStep, DesktopStep];
    expect(replyFor(out.plan, { ok: true, message: 'done', halted: false, steps: [{ step: focus, ok: true, message: 'in front', ms: 1 }, { step: keys, ok: true, message: 'space', ms: 1 }] })).toBe('Play in Firefox.');
    expect(replyFor(out.plan, { ok: false, message: 'x', halted: false, steps: [{ step: focus, ok: false, message: 'I do not see a window for firefox; is it open?', ms: 1 }] })).toBe('I do not see a window for firefox; is it open?');
  });
});

describe('reaching into a window: refusals', () => {
  const refused = (said: string): string => {
    const out = reach(said);
    if (!out || !('refuse' in out)) throw new Error(`not refused: ${said}`);
    return out.refuse;
  };

  it('never presses a chord that closes, locks or opens a shell', () => {
    expect(refused('press alt f4 in notepad')).toMatch(/alt\+f4/);
    expect(refused('press control w in firefox')).toMatch(/ctrl\+w/);
    expect(refused('press control q in firefox')).toMatch(/ctrl\+q/);
    expect(refused('press the windows key in notepad')).toMatch(/win/);
    expect(refused('press windows r in notepad')).toMatch(/win\+r/);
  });

  it('never clicks a control that answers a dialog or closes something', () => {
    for (const said of ['click ok in notepad', 'click delete in firefox', 'click don\'t save in notepad', 'press the close button in firefox', 'click sign in in firefox']) {
      expect(refused(said), said).toMatch(/answers a dialog|sign-in/);
    }
  });

  it('never reaches into a sign-in window', () => {
    expect(refused('press enter in the login window')).toMatch(/sign-in/);
    expect(refused('type my password into the sign in window')).toMatch(/sign-in/);
    expect(refused('scroll down in the sign in page')).toMatch(/sign-in/);
  });

  it('never types into a shell', () => {
    for (const said of ['type ls into the terminal', 'type dir in powershell', 'type exit into command prompt', 'type rm into the windows terminal']) {
      expect(refused(said), said).toMatch(/shell/);
    }
  });

  it('refuses in words through resolveIntent, understood and not sent to conversation', () => {
    const out = resolveIntent('press alt f4 in notepad', ctx());
    expect(out.kind).toBe('unknown');
    if (out.kind === 'unknown') expect(out.understood).toBe(true);
  });

  it('leaves other sentences alone', () => {
    for (const said of ['open firefox', 'play', 'send', 'type', 'press', 'scroll down', 'click in firefox', 'type this into notepad']) {
      expect(reach(said), said).toBeNull();
    }
  });
});

describe('spokenChord', () => {
  it('spells spoken keys the way the helper does', () => {
    expect(spokenChord('space bar')).toBe('space');
    expect(spokenChord('control shift t')).toBe('ctrl+shift+t');
    expect(spokenChord('ctrl s')).toBe('ctrl+s');
    expect(spokenChord('alt plus left arrow')).toBe('alt+left');
    expect(spokenChord('f five')).toBe('f5');
    expect(spokenChord('f 11')).toBe('f11');
    expect(spokenChord('page down')).toBe('pagedown');
    expect(spokenChord('shift n')).toBe('shift+n');
    expect(spokenChord('escape')).toBe('escape');
    expect(spokenChord('return')).toBe('enter');
  });

  it('is null for words that are not keys', () => {
    expect(spokenChord('subscribe')).toBeNull();
    expect(spokenChord('the big red one')).toBeNull();
    expect(spokenChord('')).toBeNull();
  });
});

describe('windowTarget: what "<app>" means', () => {
  it('reads a program, the browser, the terminal and a chip', () => {
    expect(windowTarget('my firefox browser', APPS)).toEqual({ window: 'firefox', label: 'Firefox', kind: 'named' });
    expect(windowTarget('my browser', APPS)).toEqual({ window: 'browser', label: 'Firefox', kind: 'browser' });
    expect(windowTarget('the browser', [])).toEqual({ window: 'browser', label: 'your browser', kind: 'browser' });
    expect(windowTarget('the terminal', APPS)).toEqual({ window: 'terminal', label: 'the terminal', kind: 'terminal' });
    expect(windowTarget('notepad', APPS)?.label).toBe('Notepad');
    expect(windowTarget('JARVIS-TQR', APPS)).toEqual({ window: 'jarvis-tqr', label: 'JARVIS-TQR', kind: 'named' });
    expect(windowTarget('the', APPS)).toBeNull();
  });
});

describe('pickWindow: the app matcher', () => {
  // The helper lists windows in Z-order: the most recently active first.
  const WINDOWS = [
    { h: 1, title: 'JARVIS', process: 'SkynetOS', w: 600, h2: 600 },
    { h: 2, title: 'Firefox tips - YouTube - Google Chrome', process: 'chrome', w: 1600, h2: 900 },
    { h: 3, title: 'Never Gonna Give You Up - YouTube — Mozilla Firefox', process: 'firefox', w: 1920, h2: 1040 },
    { h: 4, title: 'SkynetOS - U1 - JARVIS-TQR', process: 'WindowsTerminal', w: 1200, h2: 800 },
    { h: 5, title: 'Untitled - Notepad', process: 'Notepad', w: 900, h2: 700 },
    { h: 6, title: 'Sign in to your account — Mozilla Firefox', process: 'firefox', w: 1000, h2: 800 },
    { h: 7, title: 'Firefox', process: 'firefox', w: 60, h2: 20 },
    { h: 8, title: 'Document1 - Word', process: 'WINWORD', w: 160, h2: 28, min: true },
    { h: 9, title: 'SkynetOS', process: 'electron', w: 1920, h2: 1080 }
  ];
  const pick = (target: string, opts = {}): number | undefined => pickWindow(target, WINDOWS, opts)?.h;

  it('prefers the process over a title that mentions it, and the most recent of equals', () => {
    expect(pick('firefox')).toBe(3);
    expect(pick('my firefox browser')).toBe(3);
    expect(pick('notepad')).toBe(5);
  });

  it('takes an alias for a process Windows names differently, minimised or not', () => {
    expect(pick('word')).toBe(8);
  });

  it('finds the default browser for "browser", and any browser without one', () => {
    expect(pick('browser', { preferredBrowser: 'firefox' })).toBe(3);
    expect(pick('browser')).toBe(2);
  });

  it('finds the terminal, and a chip by its title tokens', () => {
    expect(pick('terminal')).toBe(4);
    expect(pick('jarvis tqr')).toBe(4);
    expect(pick('JARVIS-TQR')).toBe(4);
    expect(pick('u1')).toBe(4);
  });

  it('never picks SkynetOS\'s own windows or a sliver, and says null for nothing', () => {
    // "JARVIS" is the hologram's title, but the hologram is ours: the chip's terminal is meant.
    expect(pick('jarvis')).toBe(4);
    expect(pick('skynetos')).toBe(4);
    for (const t of ['jarvis', 'skynetos', 'firefox', 'notepad', 'browser', 'terminal']) expect([1, 7, 9]).not.toContain(pick(t));
    expect(pick('excel')).toBeUndefined();
    expect(pick('')).toBeUndefined();
  });

  it('gives a preferred title (a session window) the edge among equals', () => {
    const wins = [
      { h: 10, title: 'JARVIS-TQR notes - Notepad', process: 'notepad', w: 900, h2: 700 },
      { h: 11, title: 'SkynetOS - U1 - JARVIS-TQR', process: 'WindowsTerminal', w: 900, h2: 700 }
    ];
    expect(pickWindow('jarvis tqr', wins)?.h).toBe(10);
    expect(pickWindow('jarvis tqr', wins, { prefer: (t) => t.startsWith('SkynetOS - ') })?.h).toBe(11);
  });
});

describe('titleBarPoint', () => {
  it('lands in the caption, left of the window buttons, scaled', () => {
    expect(titleBarPoint({ x: 0, y: 0, width: 1920, height: 1080 }, 1)).toEqual({ x: 1720, y: 10 });
    expect(titleBarPoint({ x: -8, y: -8, width: 2576, height: 1416 }, 1.5)).toEqual({ x: 2268, y: 7 });
    expect(titleBarPoint({ x: 100, y: 50, width: 300, height: 200 }, 1)).toEqual({ x: 250, y: 60 });
  });
});

describe('splitBounds: side by side on monitor one', () => {
  it('gives the terminal the left 62% at full height and JARVIS the rest', () => {
    const { left, right } = splitBounds({ x: 0, y: 0, width: 2560, height: 1400 });
    expect(left).toEqual({ x: 0, y: 0, width: 1587, height: 1400 });
    expect(right).toEqual({ x: 1587, y: 0, width: 973, height: 1400 });
  });

  it('never gaps or overlaps, on any monitor origin', () => {
    for (const work of [{ x: -1920, y: 0, width: 1920, height: 1040 }, { x: 2560, y: -300, width: 1080, height: 1880 }, { x: 0, y: 40, width: 1366, height: 728 }]) {
      const { left, right } = splitBounds(work);
      expect(left.x).toBe(work.x);
      expect(left.x + left.width).toBe(right.x);
      expect(right.x + right.width).toBe(work.x + work.width);
      expect(left.height).toBe(work.height);
      expect(right.height).toBe(work.height);
      expect(left.y).toBe(work.y);
    }
  });

  it('clamps a silly ratio', () => {
    expect(splitBounds({ x: 0, y: 0, width: 1000, height: 800 }, 2).left.width).toBe(850);
    expect(splitBounds({ x: 0, y: 0, width: 1000, height: 800 }, Number.NaN).left.width).toBe(620);
  });
});
