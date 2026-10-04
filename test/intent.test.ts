import { describe, expect, it } from 'vitest';
import { isDestructive } from '../packages/shared/commands.js';
import type { BoardEdge, BoardNode } from '../packages/shared/types.js';
import { controlTargets, edgeIdFor, matchNode, resolveIntent, sayForControl, scoreNode, stripPreamble, type Intent, type IntentContext } from '../packages/shared/intent.js';
import { HOLOGRAM_CONTROLS, type HologramControl } from '../packages/shared/hologram-control.js';

/*
 * A room shaped like a real one: two nodes whose names share two words (the ambiguity whisper will
 * hand us constantly), a room to descend into, a node hard against the left edge, and one wire
 * already run.
 */
const NODES: BoardNode[] = [
  { id: 'a1_stalker', designator: 'U4', kind: 'agent.code', name: 'THE STALKER', pos: { x: 10, y: 6 } },
  { id: 'h_plush_hud', designator: 'U7', kind: 'agent.chat', name: 'DIRTY PLUSH (HUD)', pos: { x: 4, y: 12 } },
  { id: 'r_plush_repo', designator: 'M2', kind: 'store.repo', name: 'DIRTY PLUSH REPO', pos: { x: 8, y: 12 } },
  { id: 'd1_minecraftos', kind: 'drive.room', name: 'MINECRAFTOS', pos: { x: 2, y: 2 } },
  { id: 'n_edge', kind: 'file.document', name: 'READ ME', pos: { x: 0, y: 3 } }
];

const EDGES: BoardEdge[] = [{ id: 'w_hud_repo', from: 'h_plush_hud', to: 'r_plush_repo', kind: 'reads' }];

function ctx(over: Partial<IntentContext> = {}): IntentContext {
  return { boardId: 'root', nodes: NODES, edges: EDGES, selectedId: null, actor: 'user', ...over };
}

describe('stripPreamble', () => {
  it('drops the wake word and the politeness', () => {
    expect(stripPreamble('Jarvis, could you move the stalker left two?')).toBe('move the stalker left two');
    expect(stripPreamble('hey jarvis please select the stalker')).toBe('select the stalker');
    expect(stripPreamble('JARVIS')).toBe('');
  });
});

describe('scoreNode', () => {
  it('scores an exact name highest, then a designator, then a partial', () => {
    const stalker = NODES[0]!;
    expect(scoreNode('the stalker', stalker)).toBe(100);
    expect(scoreNode('u4', stalker)).toBe(96);
    expect(scoreNode('stalker', stalker)).toBeGreaterThan(70);
    expect(scoreNode('minecraft', NODES[3]!)).toBeGreaterThan(0);
    expect(scoreNode('gearbox', stalker)).toBe(0);
  });
});

describe('matchNode', () => {
  it('resolves a pronoun to the selection', () => {
    expect(matchNode('it', ctx({ selectedId: 'a1_stalker' })).node?.id).toBe('a1_stalker');
    expect(matchNode('it', ctx()).node).toBeUndefined();
  });

  it('reports rival nodes rather than picking one', () => {
    const hit = matchNode('dirty plush', ctx());
    expect(hit.node).toBeUndefined();
    expect(hit.candidates.map((n) => n.id).sort()).toEqual(['h_plush_hud', 'r_plush_repo']);
  });

  it('takes the full name over the shared prefix', () => {
    expect(matchNode('dirty plush repo', ctx()).node?.id).toBe('r_plush_repo');
  });
});

describe('resolveIntent — moving', () => {
  it('moves a named node by a spoken number', () => {
    const out = resolveIntent('move the stalker left two', ctx());
    expect(out.kind).toBe('command');
    if (out.kind !== 'command') return;
    expect(out.request.command).toEqual({ type: 'node.move', boardId: 'root', nodeId: 'a1_stalker', pos: { x: 8, y: 6 } });
    expect(out.request.actor).toBe('user');
    expect(out.say).toContain('U4 THE STALKER');
  });

  it('takes digits, a tiles suffix, and whisper punctuation', () => {
    const out = resolveIntent('Nudge THE STALKER, right, 3 tiles.', ctx());
    expect(out.kind === 'command' && out.request.command).toEqual({
      type: 'node.move', boardId: 'root', nodeId: 'a1_stalker', pos: { x: 13, y: 6 }
    });
  });

  it('moves the selection when told "it", and one tile by default', () => {
    const out = resolveIntent('move it down', ctx({ selectedId: 'a1_stalker' }));
    expect(out.kind === 'command' && out.request.command).toEqual({
      type: 'node.move', boardId: 'root', nodeId: 'a1_stalker', pos: { x: 10, y: 7 }
    });
  });

  it('says so rather than guessing when nothing is selected', () => {
    const out = resolveIntent('move left', ctx());
    expect(out.kind).toBe('unknown');
    expect(out.say).toMatch(/nothing is selected/i);
  });

  it('refuses to push a node off the board', () => {
    const out = resolveIntent('move read me left', ctx());
    expect(out.kind).toBe('unknown');
    expect(out.say).toMatch(/against that edge/i);
  });

  it('asks which one when two nodes fit', () => {
    const out = resolveIntent('move dirty plush up one', ctx());
    expect(out.kind).toBe('ambiguous');
    if (out.kind !== 'ambiguous') return;
    expect(out.candidates).toHaveLength(2);
    expect(out.say).toMatch(/which one/i);
  });
});

describe('resolveIntent — editing', () => {
  it('renames, in the board\'s own case', () => {
    const out = resolveIntent('rename the stalker to night stalker', ctx());
    expect(out.kind === 'command' && out.request.command).toEqual({
      type: 'node.update', boardId: 'root', nodeId: 'a1_stalker', patch: { name: 'NIGHT STALKER' }
    });
  });

  it('connects two nodes, defaulting the wire kind', () => {
    const out = resolveIntent('connect the stalker to dirty plush repo', ctx());
    expect(out.kind).toBe('command');
    if (out.kind !== 'command') return;
    expect(out.request.command).toMatchObject({
      type: 'edge.create',
      edge: { from: 'a1_stalker', to: 'r_plush_repo', kind: 'depends' }
    });
  });

  it('takes a named wire kind', () => {
    const out = resolveIntent('wire the stalker to dirty plush hud with a deploys wire', ctx());
    expect(out.kind === 'command' && out.request.command).toMatchObject({
      type: 'edge.create', edge: { kind: 'deploys', to: 'h_plush_hud' }
    });
  });

  it('will not run a second wire the same way', () => {
    const out = resolveIntent('connect dirty plush hud to dirty plush repo', ctx());
    expect(out.kind).toBe('unknown');
    expect(out.say).toMatch(/already runs/i);
  });

  it('will not wire a node to itself', () => {
    const out = resolveIntent('connect the stalker to the stalker', ctx());
    expect(out.kind).toBe('unknown');
    expect(out.say).toMatch(/two different ends/i);
  });
});

describe('resolveIntent — deletion is never done, only asked', () => {
  it('returns a confirmation, destructive and unapproved', () => {
    const out = resolveIntent('delete the stalker', ctx());
    expect(out.kind).toBe('confirm');
    if (out.kind !== 'confirm') return;
    expect(isDestructive(out.request.command)).toBe(true);
    expect(out.request.approved).toBeUndefined();
    expect(out.because).toMatch(/docs\/07/);
  });

  it('never yields an approved destructive request, however it is phrased', () => {
    for (const phrase of ['delete the stalker', 'remove the stalker', 'get rid of the stalker', 'kill the stalker']) {
      const out = resolveIntent(phrase, ctx());
      expect(out.kind).toBe('confirm');
      if (out.kind === 'confirm') expect(out.request.approved).toBeFalsy();
    }
  });
});

describe('resolveIntent — the view', () => {
  it('descends into a room but only selects a node', () => {
    expect(resolveIntent('go into minecraftos', ctx())).toMatchObject({
      kind: 'view', action: { type: 'descend', nodeId: 'd1_minecraftos' }
    });
    const out = resolveIntent('go into the stalker', ctx());
    expect(out).toMatchObject({ kind: 'view', action: { type: 'select', nodeId: 'a1_stalker' } });
    expect(out.kind === 'view' && out.say).toMatch(/not a room/i);
  });

  it('selects, clears, ascends, zooms, undoes', () => {
    expect(resolveIntent('select u4', ctx())).toMatchObject({ kind: 'view', action: { type: 'select', nodeId: 'a1_stalker' } });
    expect(resolveIntent('deselect', ctx())).toMatchObject({ kind: 'view', action: { type: 'clearSelection' } });
    expect(resolveIntent('come back', ctx())).toMatchObject({ kind: 'view', action: { type: 'ascend' } });
    expect(resolveIntent('zoom in', ctx())).toMatchObject({ kind: 'view', action: { type: 'zoom', to: 'in' } });
    expect(resolveIntent('zoom to four', ctx())).toMatchObject({ kind: 'view', action: { type: 'zoom', to: 4 } });
    expect(resolveIntent('undo that', ctx())).toMatchObject({ kind: 'view', action: { type: 'undo' } });
  });

  it('opens a node as a view action, leaving the launch rules where they are', () => {
    expect(resolveIntent('open read me', ctx())).toMatchObject({ kind: 'view', action: { type: 'open', nodeId: 'n_edge' } });
  });
});

describe('resolveIntent — failure', () => {
  it('changes nothing when it does not understand', () => {
    const out = resolveIntent('make me a sandwich', ctx());
    expect(out.kind).toBe('unknown');
    expect(out.say).toMatch(/did not understand/i);
    expect(out.kind === 'unknown' && out.heard).toBe('make me a sandwich');
  });

  it('says so when a name is not in the room', () => {
    const out = resolveIntent('select the forge editor', ctx());
    expect(out.kind).toBe('unknown');
    expect(out.say).toMatch(/do not see/i);
  });

  it('carries the caller\'s actor, never assuming one', () => {
    const out = resolveIntent('move the stalker up', ctx({ actor: 'jarvis' }));
    expect(out.kind === 'command' && out.request.actor).toBe('jarvis');
  });
});

describe('resolveIntent — manual control', () => {
  it('takes every phrasing William asked for', () => {
    const phrases = [
      'give me manual control',
      'manual controls on',
      'activate manual controls',
      'give me the controls',
      'hey jarvis give me the controls',
      'gesture mode',
      'enable hand control',
      'let me drive'
    ];
    for (const phrase of phrases) {
      expect(resolveIntent(phrase, ctx()), phrase).toMatchObject({
        kind: 'view', action: { type: 'gestureControl', on: true }
      });
    }
  });

  it('gives the board back', () => {
    for (const phrase of ['manual controls off', 'turn off manual control', 'disengage', 'hands off', "that's enough", 'give me the keyboard']) {
      expect(resolveIntent(phrase, ctx()), phrase).toMatchObject({
        kind: 'view', action: { type: 'gestureControl', on: false }
      });
    }
  });

  it('does not read an ordinary command as a mode change', () => {
    expect(resolveIntent('select the stalker', ctx()).kind).toBe('view');
    expect(resolveIntent('move the stalker left two', ctx()).kind).toBe('command');
    for (const phrase of ['select the stalker', 'move the stalker left two', 'open read me']) {
      const out = resolveIntent(phrase, ctx());
      expect(out.kind === 'view' && out.action.type === 'gestureControl', phrase).toBe(false);
    }
  });
});

describe('edgeIdFor', () => {
  it('avoids an id already on the board', () => {
    const taken: BoardEdge[] = [{ id: 'w_a_b', from: 'a', to: 'b', kind: 'reads' }];
    expect(edgeIdFor('a', 'b', [])).toBe('w_a_b');
    expect(edgeIdFor('a', 'b', taken)).toBe('w_a_b_2');
  });
});

describe('resolveIntent — the desktop (docs/11)', () => {
  const apps = [
    { name: 'Adobe After Effects 2026', path: 'C:/sm/ae.lnk', source: 'startmenu' as const },
    { name: 'Firefox', path: 'C:/sm/ff.lnk', source: 'startmenu' as const }
  ];

  it('makes a desktop plan when the words name a program, spoken or typed', () => {
    const spoken = resolveIntent('jarvis, open after effects on one and firefox on two', ctx({ actor: 'voice', apps, monitors: 3 }));
    expect(spoken.kind).toBe('desktop');
    if (spoken.kind !== 'desktop') throw new Error('not a plan');
    expect(spoken.plan.steps.map((s) => s.kind)).toEqual(['launch', 'launch']);
    expect(spoken.plan.source).toBe('voice');
    const typed = resolveIntent('open firefox', ctx({ apps, monitors: 1 }));
    expect(typed.kind).toBe('desktop');
    if (typed.kind === 'desktop') expect(typed.plan.source).toBe('typed');
  });

  it('leaves the board its own "open" when the name is a node, or when there is no catalogue', () => {
    const node = resolveIntent('open the stalker', ctx({ apps, monitors: 3 }));
    expect(node).toMatchObject({ kind: 'view', action: { type: 'open', nodeId: 'a1_stalker' } });
    const none = resolveIntent('open firefox', ctx());
    expect(none.kind).toBe('unknown');
  });

  it('opens his mail in a browser, and moves a window, as desktop plans', () => {
    const mail = resolveIntent('open my hotmail in firefox', ctx({ apps, monitors: 2 }));
    expect(mail.kind).toBe('desktop');
    if (mail.kind === 'desktop') expect(mail.plan.steps[0]).toMatchObject({ kind: 'url', browser: 'Firefox' });
    const move = resolveIntent('move firefox to two', ctx({ apps, monitors: 2 }));
    expect(move.kind).toBe('desktop');
    if (move.kind === 'desktop') expect(move.plan.steps[0]).toEqual({ kind: 'place', window: 'Firefox', monitor: 2 });
  });
});

describe('resolveIntent — the Face, by name only (docs/11 § Conversation)', () => {
  it('sends the words after "ask the face" and "tell the face"', () => {
    const a = resolveIntent('hey jarvis ask the face what year the stalker started', ctx());
    expect(a).toMatchObject({ kind: 'view', action: { type: 'faceSend', text: 'what year the stalker started' } });
    const b = resolveIntent('tell the face to draft the release notes', ctx());
    expect(b).toMatchObject({ kind: 'view', action: { type: 'faceSend', text: 'draft the release notes' } });
    const c = resolveIntent('send that to the face: the build is green', ctx());
    expect(c).toMatchObject({ kind: 'view', action: { type: 'faceSend', text: 'the build is green' } });
  });

  it('asks what, rather than sending nothing', () => {
    const empty = resolveIntent('ask the face', ctx());
    expect(empty.kind).toBe('unknown');
    if (empty.kind === 'unknown') expect(empty.understood).toBe(true);
  });

  it('leaves an ordinary question unknown and not understood, for JARVIS to answer himself', () => {
    const q = resolveIntent('what is the weather like tomorrow', ctx());
    expect(q.kind).toBe('unknown');
    if (q.kind === 'unknown') expect(q.understood).toBe(false);
  });
});

describe('resolveIntent — the JARVIS Voice window by voice (fork G, 2026-09-26)', () => {
  const control = (phrase: string): HologramControl => {
    const out = resolveIntent(phrase, ctx());
    expect(out.kind, phrase).toBe('hologram');
    return (out as Extract<Intent, { kind: 'hologram' }>).control;
  };

  it('goes to a panel however the panel is named', () => {
    expect(control('go to the train panel')).toEqual({ op: 'panel', panel: 'train' });
    expect(control('jarvis, show me the desk panel')).toEqual({ op: 'panel', panel: 'desk' });
    expect(control('back to the main panel')).toEqual({ op: 'panel', panel: 'main' });
    expect(control('open the actions tab')).toEqual({ op: 'panel', panel: 'actions' });
    expect(control('training menu')).toEqual({ op: 'panel', panel: 'train' });
    expect(control('go back')).toEqual({ op: 'panel', panel: 'main' });
  });

  it('opens and closes the dropdowns, but does not steal "open <node>"', () => {
    expect(control('open the profiles dropdown')).toEqual({ op: 'dropdown', name: 'profiles', open: true });
    expect(control('close the profiles dropdown')).toEqual({ op: 'dropdown', name: 'profiles', open: false });
    expect(control('show the voices list')).toEqual({ op: 'dropdown', name: 'voices', open: true });
    expect(control('open the monitors')).toEqual({ op: 'dropdown', name: 'monitors', open: true });
    // 2026-09-27: the session picker under the caption.
    expect(control('open the sessions dropdown')).toEqual({ op: 'dropdown', name: 'sessions', open: true });
    expect(control('show the session picker')).toEqual({ op: 'dropdown', name: 'sessions', open: true });
    expect(control('close the sessions list')).toEqual({ op: 'dropdown', name: 'sessions', open: false });
    expect(resolveIntent('open read me', ctx()).kind).toBe('view');
  });

  it('switches talkback, the microphone and desktop control', () => {
    expect(control('turn off talkback')).toEqual({ op: 'talkback', on: false });
    expect(control('turn on talkback')).toEqual({ op: 'talkback', on: true });
    expect(control('talk back off')).toEqual({ op: 'talkback', on: false });
    expect(control('mute the speech')).toEqual({ op: 'talkback', on: false });
    expect(control('mic off')).toEqual({ op: 'mic', on: false });
    expect(control('turn on the microphone')).toEqual({ op: 'mic', on: true });
    expect(control('desk on')).toEqual({ op: 'desk', on: true });
    expect(control('turn off desktop control')).toEqual({ op: 'desk', on: false });
  });

  it('presses the profile buttons, the text box, send, minimise and close', () => {
    expect(control('use this voice')).toEqual({ op: 'press', id: 'btn-use-voice' });
    expect(control('record')).toEqual({ op: 'press', id: 'btn-record' });
    expect(control('play it back')).toEqual({ op: 'press', id: 'btn-play' });
    expect(control('create a profile')).toEqual({ op: 'press', id: 'btn-create-profile' });
    expect(control('send')).toEqual({ op: 'press', id: 'btn-send' });
    expect(control('let me type')).toEqual({ op: 'press', id: 'input-text' });
    expect(control('minimise')).toEqual({ op: 'minimise' });
    expect(control('minimize yourself')).toEqual({ op: 'minimise' });
    expect(control('close the window')).toEqual({ op: 'close' });
    expect(control('close yourself')).toEqual({ op: 'close' });
  });

  it('dictates, trains an action, saves or discards it', () => {
    expect(control('dictate')).toEqual({ op: 'dictate', on: true });
    expect(control('take dictation')).toEqual({ op: 'dictate', on: true });
    expect(control('stop dictating')).toEqual({ op: 'dictate', on: false });
    expect(control('train action')).toEqual({ op: 'train-action', on: true });
    expect(control('watch what i do')).toEqual({ op: 'train-action', on: true });
    expect(control('stop watching')).toEqual({ op: 'train-action', on: false });
    expect(control('save the action')).toEqual({ op: 'press', id: 'btn-save-action' });
    expect(control('discard the action')).toEqual({ op: 'press', id: 'btn-discard-action' });
  });

  it('shuts JARVIS Voice down, and never the computer', () => {
    expect(control('shut yourself down')).toEqual({ op: 'shutdown' });
    expect(control('jarvis, shut down')).toEqual({ op: 'shutdown' });
    expect(control('jarvis power down')).toEqual({ op: 'shutdown' });
    for (const phrase of ['shut down the computer', 'shut the pc down', 'turn off windows', 'power off the machine']) {
      const out = resolveIntent(phrase, ctx());
      expect(out.kind, phrase).toBe('unknown');
      if (out.kind === 'unknown') { expect(out.understood).toBe(true); expect(out.say).toMatch(/do not shut the computer down/); }
    }
  });

  it('"stop" and its variants halt speech and the desktop without closing the microphone', () => {
    for (const phrase of ['stop', 'jarvis stop', 'hey jarvis, stop', 'stop talking', 'quiet', 'be quiet', 'cancel that', 'hold on']) {
      expect(resolveIntent(phrase, ctx()), phrase).toMatchObject({ kind: 'view', action: { type: 'stop' }, say: '' });
    }
    // The microphone closes only when told to in words; "that's enough" is still the hands' phrase.
    expect(resolveIntent('stop listening', ctx())).toMatchObject({ kind: 'view', action: { type: 'voiceControl', on: false } });
    expect(resolveIntent('hey jarvis stop listening', ctx())).toMatchObject({ kind: 'view', action: { type: 'voiceControl', on: false } });
    expect(resolveIntent("that's enough", ctx())).toMatchObject({ kind: 'view', action: { type: 'gestureControl', on: false } });
  });

  it('runs a saved action by name, and asks when the name is missing', () => {
    expect(resolveIntent('do the morning setup', ctx())).toMatchObject({ kind: 'action', name: 'morning setup' });
    expect(resolveIntent('run the stream setup action', ctx())).toMatchObject({ kind: 'action', name: 'stream setup' });
    expect(resolveIntent('perform stalker workspace', ctx())).toMatchObject({ kind: 'action', name: 'stalker workspace' });
    expect(resolveIntent('do it', ctx())).toMatchObject({ kind: 'unknown', understood: true });
    // "run <node>" is still the board's open.
    expect(resolveIntent('run the stalker', ctx())).toMatchObject({ kind: 'view', action: { type: 'open', nodeId: 'a1_stalker' } });
  });

  it('reaches every control in the window from at least one sentence', () => {
    const sentences = [
      'mic on', 'turn on talkback', 'desk on', 'go to the train panel', 'open the actions panel', 'minimise', 'close the window',
      'train action', 'dictate', 'use this voice', 'record', 'play', 'create a profile', 'save the action', 'discard the action',
      'send', 'let me type', 'open the profiles dropdown', 'open the voices dropdown', 'open the monitors dropdown',
      'open the sessions dropdown'
    ];
    const reached = new Set<string>();
    for (const sentence of sentences) {
      const out = resolveIntent(sentence, ctx());
      expect(out.kind, sentence).toBe('hologram');
      if (out.kind === 'hologram') for (const id of controlTargets(out.control)) reached.add(id);
    }
    for (const id of HOLOGRAM_CONTROLS) expect(reached.has(id), id).toBe(true);
  });

  it('says one line per control, and none for stop', () => {
    expect(sayForControl({ op: 'panel', panel: 'train' })).toBe('The train panel.');
    expect(sayForControl({ op: 'talkback', on: false })).toBe('Talkback off.');
    expect(sayForControl({ op: 'shutdown' })).toMatch(/Shutting down/);
    for (const id of HOLOGRAM_CONTROLS) if (id.startsWith('btn-') || id === 'input-text') expect(sayForControl({ op: 'press', id }).length).toBeGreaterThan(0);
  });

  it('does not read ordinary board commands as window controls', () => {
    for (const phrase of ['select the stalker', 'move the stalker left two', 'open read me', 'go into minecraftos', 'zoom in', 'undo']) {
      expect(resolveIntent(phrase, ctx()).kind, phrase).not.toBe('hologram');
    }
  });
});
