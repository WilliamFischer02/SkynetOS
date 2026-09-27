import { describe, expect, it } from 'vitest';
import {
  FOREGROUND,
  appKey,
  defaultBrowser,
  desktopScript,
  isRefusedCombo,
  matchApp,
  matchSite,
  monitorOf,
  numberMonitors,
  parseDesktopCommand,
  parseDesktopLine,
  placeIn,
  replyFor,
  type AppEntry,
  type DesktopPlan,
  type DesktopResult,
  type DisplayLike
} from '../packages/shared/desktop.js';

/** This machine on 2026-09-24: a primary at the origin, a landscape to its left, a portrait further left. */
const DISPLAYS: DisplayLike[] = [
  { id: 3, label: 'DISPLAY1', bounds: { x: -1920, y: 82, width: 1920, height: 1080 }, workArea: { x: -1920, y: 82, width: 1920, height: 1040 }, scaleFactor: 1 },
  { id: 5, label: 'DISPLAY2', bounds: { x: -2640, y: 153, width: 720, height: 1280 }, workArea: { x: -2640, y: 153, width: 720, height: 1240 }, scaleFactor: 1 },
  { id: 1, label: 'DISPLAY3', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1, primary: true }
];

const APPS: AppEntry[] = [
  { name: 'Adobe After Effects 2026', path: 'C:/sm/Adobe After Effects 2026.lnk', source: 'startmenu' },
  { name: 'Adobe Media Encoder 2026', path: 'C:/sm/Adobe Media Encoder 2026.lnk', source: 'startmenu' },
  { name: 'Firefox', path: 'C:/sm/Firefox.lnk', source: 'startmenu' },
  { name: 'Firefox Private Browsing', path: 'C:/sm/Firefox Private Browsing.lnk', source: 'startmenu' },
  { name: 'Google Chrome', path: 'C:/sm/Google Chrome.lnk', source: 'startmenu' },
  { name: 'Visual Studio Code', path: 'C:/sm/Visual Studio Code.lnk', source: 'startmenu' },
  { name: 'Obsidian', path: 'C:/sm/Obsidian.lnk', source: 'startmenu' }
];

const ctx = { apps: APPS, monitors: 3 };

describe('numberMonitors', () => {
  it('makes the primary one, then the rest left to right', () => {
    const m = numberMonitors(DISPLAYS);
    expect(m.map((x) => [x.index, x.id])).toEqual([[1, 1], [2, 5], [3, 3]]);
    expect(m[0]!.primary).toBe(true);
    expect(m[0]!.work.height).toBe(1040);
  });

  it('lets settings name the order by id or label, and still numbers the rest', () => {
    const m = numberMonitors(DISPLAYS, ['display1', '1']);
    expect(m.map((x) => [x.index, x.label])).toEqual([[1, 'DISPLAY1'], [2, 'DISPLAY3'], [3, 'DISPLAY2']]);
  });

  it('treats the display at the origin as primary when nothing says so', () => {
    const m = numberMonitors(DISPLAYS.map((d) => ({ ...d, primary: undefined })));
    expect(m[0]!.id).toBe(1);
  });
});

describe('placeIn and monitorOf', () => {
  const work = { x: 100, y: 50, width: 1000, height: 800 };
  it('fills, halves, and centres at seventy percent', () => {
    expect(placeIn(work)).toEqual(work);
    expect(placeIn(work, 'left')).toEqual({ x: 100, y: 50, width: 500, height: 800 });
    expect(placeIn(work, 'right')).toEqual({ x: 600, y: 50, width: 500, height: 800 });
    expect(placeIn(work, 'bottom')).toEqual({ x: 100, y: 450, width: 1000, height: 400 });
    expect(placeIn(work, 'centre')).toEqual({ x: 250, y: 170, width: 700, height: 560 });
  });
  it('names the monitor a window sits on by its centre', () => {
    const m = numberMonitors(DISPLAYS);
    expect(monitorOf({ x: -1000, y: 300, width: 400, height: 300 }, m)).toBe(3);
    expect(monitorOf({ x: 10, y: 10, width: 400, height: 300 }, m)).toBe(1);
    expect(monitorOf({ x: 5000, y: 5000, width: 10, height: 10 }, m)).toBe(0);
  });
});

describe('matchApp', () => {
  it('strips brand and year, and prefers the shortest exact name', () => {
    expect(appKey('Adobe After Effects 2026')).toBe('after effects');
    expect(matchApp('after effects', APPS)?.name).toBe('Adobe After Effects 2026');
    expect(matchApp('firefox', APPS)?.name).toBe('Firefox');
    expect(matchApp('chrome', APPS)?.name).toBe('Google Chrome');
  });
  it('knows the names William says for things', () => {
    expect(matchApp('vs code', APPS)?.name).toBe('Visual Studio Code');
    expect(matchApp('code', APPS)?.name).toBe('Visual Studio Code');
    expect(matchApp('AE', APPS)?.name).toBe('Adobe After Effects 2026');
  });
  it('finds a program by a subset of its words, and nothing by a stranger', () => {
    expect(matchApp('media encoder', APPS)?.name).toBe('Adobe Media Encoder 2026');
    expect(matchApp('the stalker', APPS)).toBeNull();
    expect(matchApp('', APPS)).toBeNull();
  });
  it('lets a settings entry win over the Start Menu', () => {
    const mine: AppEntry = { name: 'firefox', path: 'D:/ff/firefox.exe', source: 'settings' };
    expect(matchApp('firefox', [...APPS, mine])?.path).toBe('D:/ff/firefox.exe');
  });
});

describe('matchSite and defaultBrowser', () => {
  it('knows his mail and a few sites, with or without "my"', () => {
    expect(matchSite('my hotmail')?.url).toBe('https://outlook.live.com/mail/');
    expect(matchSite('hotmail')?.name).toBe('Hotmail');
    expect(matchSite('youtube')?.url).toContain('youtube');
    expect(matchSite('the stalker')).toBeNull();
  });
  it('picks Firefox before Chrome when both are installed, and nothing when neither is', () => {
    expect(defaultBrowser(APPS)?.name).toBe('Firefox');
    expect(defaultBrowser(APPS.filter((a) => !/firefox/i.test(a.name)))?.name).toBe('Google Chrome');
    expect(defaultBrowser([APPS[0]!])).toBeNull();
  });
});

describe('parseDesktopCommand', () => {
  it('opens two programs on two monitors from one sentence', () => {
    const plan = parseDesktopCommand('open after effects on one and firefox on two', ctx);
    expect(plan?.steps).toEqual([
      { kind: 'launch', app: 'Adobe After Effects 2026', monitor: 1 },
      { kind: 'launch', app: 'Firefox', monitor: 2 }
    ]);
    expect(plan?.source).toBe('voice');
  });

  it('accepts "monitor 2", digits, and a clause that keeps the last monitor', () => {
    expect(parseDesktopCommand('launch photoshop on monitor 2', { apps: [...APPS, { name: 'Adobe Photoshop 2026', path: 'x', source: 'startmenu' }], monitors: 2 })?.steps[0])
      .toEqual({ kind: 'launch', app: 'Adobe Photoshop 2026', monitor: 2 });
    const plan = parseDesktopCommand('open firefox on two and code', ctx);
    expect(plan?.steps[1]).toEqual({ kind: 'launch', app: 'Visual Studio Code', monitor: 2 });
  });

  it('opens a site in a named browser, or the default one', () => {
    expect(parseDesktopCommand('open my hotmail in firefox', ctx)?.steps).toEqual([
      { kind: 'url', url: 'https://outlook.live.com/mail/', site: 'Hotmail', browser: 'Firefox' }
    ]);
    expect(parseDesktopCommand('open youtube on two', ctx)?.steps).toEqual([
      { kind: 'url', url: 'https://www.youtube.com/', site: 'YouTube', browser: 'Firefox', monitor: 2 }
    ]);
    const noBrowser = parseDesktopCommand('open gmail', { apps: [APPS[0]!], monitors: 1 });
    expect(noBrowser?.steps[0]).toEqual({ kind: 'url', url: 'https://mail.google.com/', site: 'Gmail' });
  });

  it('moves a program, or whatever is in front, to a monitor', () => {
    expect(parseDesktopCommand('move firefox to two', ctx)?.steps).toEqual([{ kind: 'place', window: 'Firefox', monitor: 2 }]);
    expect(parseDesktopCommand('put this on one', ctx)?.steps).toEqual([{ kind: 'place', window: FOREGROUND, monitor: 1 }]);
  });

  it('is not a desktop plan when the name is a board node, not a program', () => {
    expect(parseDesktopCommand('open the stalker', ctx)).toBeNull();
    expect(parseDesktopCommand('open the stalker on one', ctx)).toBeNull();
    expect(parseDesktopCommand('zoom in', ctx)).toBeNull();
    expect(parseDesktopCommand('firefox on two', ctx)).toBeNull();
    expect(parseDesktopCommand('', ctx)).toBeNull();
  });
});

describe('replyFor', () => {
  const plan: DesktopPlan = { source: 'voice', heard: 'x', steps: [] };
  it('says what is open and where, then what did not happen', () => {
    const result: DesktopResult = {
      ok: false,
      message: '',
      halted: false,
      steps: [
        { step: { kind: 'launch', app: 'Firefox', monitor: 2 }, ok: true, message: 'ok', ms: 900 },
        { step: { kind: 'launch', app: 'Adobe After Effects 2026', monitor: 1 }, ok: false, message: 'After Effects did not show a window in twenty seconds; it may still be starting.', ms: 20000 }
      ]
    };
    expect(replyFor(plan, result)).toBe('Firefox on two is open. After Effects did not show a window in twenty seconds; it may still be starting.');
  });
  it('joins several with "and", and says when it was stopped', () => {
    const result: DesktopResult = {
      ok: true, message: '', halted: true,
      steps: [
        { step: { kind: 'launch', app: 'Firefox', monitor: 2 }, ok: true, message: 'ok', ms: 1 },
        { step: { kind: 'url', url: 'u', site: 'Hotmail', browser: 'Firefox', monitor: 2 }, ok: true, message: 'ok', ms: 1 }
      ]
    };
    expect(replyFor(plan, result)).toBe('Firefox on two and Hotmail in Firefox on two are open. Stopped there, as asked.');
  });
  it('passes a refusal through unchanged', () => {
    expect(replyFor(plan, { ok: false, message: 'DESKTOP CONTROL IS OFF', steps: [], halted: false })).toBe('DESKTOP CONTROL IS OFF');
  });
  it('never uses an exclamation mark', () => {
    const result: DesktopResult = { ok: true, message: '', halted: false, steps: [{ step: { kind: 'place', window: FOREGROUND, monitor: 1 }, ok: true, message: 'ok', ms: 1 }] };
    expect(replyFor(plan, result)).not.toContain('!');
    expect(replyFor(plan, result)).toBe('That on one is open.');
  });
});

describe('the helper script', () => {
  const script = desktopScript();
  it('never evaluates its input as code', () => {
    expect(script).not.toMatch(/Invoke-Expression|\biex\b|Invoke-Command|\[scriptblock\]::Create/i);
    expect(script).toContain('ConvertFrom-Json');
  });
  it('refuses the combinations that close or lock the machine', () => {
    expect(script).toContain("'alt+f4'");
    expect(isRefusedCombo('alt+f4')).toBe(true);
    expect(isRefusedCombo('F4+Alt')).toBe(true);
    expect(isRefusedCombo('ctrl+alt+delete')).toBe(true);
    expect(isRefusedCombo('ctrl+o')).toBe(false);
  });
  it('is a separate helper: it announces itself and answers by id', () => {
    expect(script).toContain('ready = $true');
    expect(script).toContain("'launch'");
    expect(script).toContain('SetCursorPos');
    expect(script).toContain('SendInput');
  });
  it('parses a helper line and ignores anything else', () => {
    expect(parseDesktopLine('{"id":1,"ok":true}')).toEqual({ id: 1, ok: true });
    expect(parseDesktopLine('WARNING: something')).toBeNull();
    expect(parseDesktopLine('[1,2]')).toBeNull();
    expect(parseDesktopLine('{bad')).toBeNull();
  });
});

describe('the helper script: TRAIN ACTION (fork H, 2026-09-26)', () => {
  const script = desktopScript();
  it('records only on the record op, through UI Automation, and pauses over a sign-in', () => {
    expect(script).toContain("'record'");
    expect(script).toContain('[SkyRec]::Start()');
    expect(script).toContain('[SkyRec]::Stop()');
    expect(script).toContain('System.Windows.Automation');
    expect(script).toContain('AutomationElement.FromPoint');
    expect(script).toContain('password|passcode|sign[ -]?in|log[ -]?in|login|2fa|verification code');
  });
  it('finds a control again by name for replay, and can turn the wheel', () => {
    expect(script).toContain("'uiafind'");
    expect(script).toContain('FindFirst(TreeScope.Descendants');
    expect(script).toContain("'wheel'");
    expect(script).toContain("'fgtitle'");
  });
  it('still never evaluates its input as code, with the recorder in it', () => {
    expect(script).not.toMatch(/Invoke-Expression|\biex\b|Invoke-Command|\[scriptblock\]::Create/i);
    // No backtick may appear in the script: it is a JS template literal.
    expect(script).not.toContain('`');
  });
});
