import { describe, expect, it } from 'vitest';
import {
  AVATAR_WINDOW_SIZE,
  asciiTitle,
  dockBeside,
  isJarvisIteration,
  isSpeaking,
  offsetFrom,
  parseTrackerLine,
  placeFace,
  streamingProbeScript,
  terminalTitleFragment
} from '../packages/shared/avatar-window.js';
import { buildLaunchScript } from '../src/main/services/launch-script.js';
import { trackerScript } from '../src/main/services/window-tracker.js';
import type { BoardNode } from '../packages/shared/types.js';

const area = { x: 0, y: 0, width: 1920, height: 1040 };
const size = AVATAR_WINDOW_SIZE;

describe('who gets a face', () => {
  const node = (over: Partial<BoardNode>): BoardNode => ({ id: 'n', kind: 'agent.code', name: 'X', pos: { x: 0, y: 0 }, ...over }) as BoardNode;

  it('the Face, JARVIS Prime and anything tagged jarvis', () => {
    expect(isJarvisIteration(node({ kind: 'agent.jarvis', name: 'U1' }), null)).toBe(true);
    expect(isJarvisIteration(node({ id: 'u3', kind: 'agent.code' }), 'u3')).toBe(true);
    expect(isJarvisIteration(node({ kind: 'agent.code', tags: ['Jarvis'] }), null)).toBe(true);
    expect(isJarvisIteration(node({ kind: 'agent.chat', name: 'JARVIS scratch' }), null)).toBe(true);
  });

  it('not an ordinary chip or conversation', () => {
    expect(isJarvisIteration(node({ id: 'u2', kind: 'agent.code' }), 'u3')).toBe(false);
    expect(isJarvisIteration(node({ kind: 'agent.chat', name: 'MC MIND PALACE' }), null)).toBe(false);
    expect(isJarvisIteration(node({ kind: 'store.repo', tags: ['jarvis'], name: 'repo' }), null)).toBe(true);
  });

  it('avatarWindow: false switches it off, and true never grants one', () => {
    expect(isJarvisIteration(node({ kind: 'agent.jarvis', avatarWindow: false }), null)).toBe(false);
    expect(isJarvisIteration(node({ id: 'u2', kind: 'agent.code', avatarWindow: true }), 'u3')).toBe(false);
  });
});

describe('docking', () => {
  it('sits to the left of its window, top-aligned', () => {
    const r = dockBeside({ x: 600, y: 100, width: 520, height: 900 }, size, area, 8);
    expect(r).toEqual({ x: 600 - 220 - 8, y: 100, width: 220, height: 240 });
  });

  it('flips to the right when there is no room on the left', () => {
    const r = dockBeside({ x: 50, y: 100, width: 520, height: 900 }, size, area, 8);
    expect(r.x).toBe(50 + 520 + 8);
  });

  it('stays inside the work area when there is room on neither side', () => {
    const r = dockBeside({ x: 0, y: 900, width: 1920, height: 400 }, size, area, 8);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(1920);
    expect(r.y + r.height).toBeLessThanOrEqual(1040);
  });

  it('keeps a dragged face where the user put it, relative to its window', () => {
    const target = { x: 600, y: 100, width: 520, height: 900 };
    const offset = offsetFrom(target, { x: 1200, y: 150, width: 220, height: 240 });
    const moved = placeFace({ ...target, x: 700 }, size, area, offset);
    expect(moved.x).toBe(1300);
    expect(moved.y).toBe(150);
  });
});

describe('speaking', () => {
  it('is a transcript written within the window', () => {
    expect(isSpeaking(10_000, 11_000)).toBe(true);
    expect(isSpeaking(10_000, 13_000)).toBe(false);
    expect(isSpeaking(null, 13_000)).toBe(false);
  });
});

describe('the tracker', () => {
  it('parses a helper line, array or single object', () => {
    const line = '[{"f":"SkynetOS - U3 - JARVIS","found":true,"x":10,"y":20,"w":800,"h":600,"min":false,"vis":true,"fg":true},{"f":"other","found":false}]';
    const states = parseTrackerLine(line)!;
    expect(states[0]).toEqual({ fragment: 'SkynetOS - U3 - JARVIS', found: true, x: 10, y: 20, width: 800, height: 600, minimized: false, visible: true, foreground: true });
    expect(states[1]).toMatchObject({ fragment: 'other', found: false, foreground: false });
    expect(parseTrackerLine('{"f":"a","found":false}')).toHaveLength(1);
    expect(parseTrackerLine('not json')).toBeNull();
    expect(parseTrackerLine('   ')).toBeNull();
  });

  it('matches the title the launch script actually writes', () => {
    const fragment = terminalTitleFragment('U3', 'JARVIS HANDS');
    const script = buildLaunchScript({
      title: 'SkynetOS — U3 — JARVIS HANDS',
      cwd: 'C:\\dev',
      banner: [],
      prime: [],
      pidFile: 'C:\\x.pid',
      claude: { args: [] }
    });
    expect(script).toContain(`$Host.UI.RawUI.WindowTitle = '${fragment}'`);
    expect(asciiTitle('a — b')).toBe('a - b');
  });

  it('keeps Claude Code from retitling a session terminal', () => {
    const script = buildLaunchScript({ title: 't', cwd: 'C:\\dev', banner: [], prime: [], pidFile: 'C:\\x.pid', claude: { args: [] } });
    expect(script).toContain("$env:CLAUDE_CODE_DISABLE_TERMINAL_TITLE = '1'");
  });

  it('helper only READS windows: no input, no moving, no messages', () => {
    const script = trackerScript(['SkynetOS - U3 - JARVIS']);
    for (const forbidden of ['SendInput', 'keybd_event', 'mouse_event', 'SetWindowPos', 'MoveWindow', 'PostMessage', 'SendMessage', 'SetForegroundWindow', 'ShowWindow']) {
      expect(script).not.toContain(forbidden);
    }
    // The titles go in as base64, never spliced into the script as text.
    expect(script).not.toContain('SkynetOS - U3 - JARVIS');
  });
});

describe('the streaming probe', () => {
  it('only looks: it never clicks, types or dispatches', () => {
    const script = streamingProbeScript();
    expect(script).not.toContain('.click(');
    expect(script).not.toContain('insertText');
    expect(script).not.toContain('dispatchEvent');
    expect(script).not.toContain('.value =');
    expect(script).toContain('querySelector');
  });
});
