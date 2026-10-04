import { describe, expect, it } from 'vitest';
import type { BoardNode } from '../packages/shared/types.js';
import { DESTRUCTIVE, isDestructive } from '../packages/shared/commands.js';
import {
  VOICE_DELETION_REFUSAL,
  boardAnswer,
  boardWrite,
  isVoiceDeletion,
  matchAcrossBoards,
  matchRoom,
  parseMoveToRoom,
  parseNotes,
  rawValue,
  whichOne,
  type BoardHit
} from '../packages/shared/board-voice.js';
import { resolveIntent, scoreNode, type Intent, type IntentContext } from '../packages/shared/intent.js';

/*
 * The board by voice across every room (docs/11 § Reaching into windows, the board, and a
 * terminal; docs/07 § JARVIS Voice). Three boards shaped like the real ones: the mainboard with two
 * room drives and JARVIS-PRIME, STORYOS and DEDUCTIONOS below it, and a name ("TIMESERVED") on two
 * boards at once, the ambiguity whisper will hand us.
 */

const ROOT: BoardNode[] = [
  { id: 'r_story', kind: 'drive.room', name: 'Story', pos: { x: 2, y: 2 }, boardFile: 'storyos/room.board.json' },
  { id: 'r_deduction', kind: 'drive.room', name: 'Deduction', pos: { x: 6, y: 2 }, boardFile: 'deductionos/room.board.json' },
  { id: 'a_prime', kind: 'agent.code', name: 'JARVIS-PRIME', designator: 'U3', pos: { x: 10, y: 4 } }
] as BoardNode[];
const STORY: BoardNode[] = [
  { id: 's_timeserved', kind: 'store.repo', name: 'TIMESERVED JAR', designator: 'M4', pos: { x: 3, y: 3 } },
  { id: 's_plush', kind: 'agent.code', name: 'PLUSH WRITER', designator: 'U2', pos: { x: 8, y: 3 } }
] as BoardNode[];
const DEDUCTION: BoardNode[] = [
  { id: 'd_timeserved', kind: 'file.document', name: 'TIMESERVED NOTES', pos: { x: 1, y: 1 } },
  { id: 'd_engine', kind: 'agent.code', name: 'DEDUCTION ENGINE', designator: 'U5', pos: { x: 5, y: 1 } }
] as BoardNode[];

const HITS: BoardHit[] = [
  ...ROOT.map((node) => ({ boardId: 'root', path: [], room: 'SKYNETOS MAINBOARD', node })),
  ...STORY.map((node) => ({ boardId: 'storyos', path: ['r_story'], room: 'STORYOS', node })),
  ...DEDUCTION.map((node) => ({ boardId: 'deductionos', path: ['r_deduction'], room: 'DEDUCTIONOS', node }))
];

function inStory(over: Partial<IntentContext> = {}): IntentContext {
  return { boardId: 'storyos', nodes: STORY, edges: [], selectedId: null, actor: 'voice', boards: HITS, inRoom: true, ...over };
}
function atRoot(over: Partial<IntentContext> = {}): IntentContext {
  return { boardId: 'root', nodes: ROOT, edges: [], selectedId: null, actor: 'voice', boards: HITS, inRoom: false, ...over };
}

const op = (out: Intent): unknown => (out.kind === 'board' ? out.op : out);

describe('matchAcrossBoards: the room on screen first, then every board', () => {
  it('finds a node on another board by its whole name', () => {
    const m = matchAcrossBoards('timeserved jar', 'root', HITS, scoreNode);
    expect(m.hit?.node.id).toBe('s_timeserved');
    expect(m.hit?.boardId).toBe('storyos');
    expect(m.hit?.path).toEqual(['r_story']);
  });

  it('asks when two boards hold an equal fit', () => {
    const m = matchAcrossBoards('timeserved', 'root', HITS, scoreNode);
    expect(m.hit).toBeUndefined();
    expect(m.candidates.map((c) => c.node.id).sort()).toEqual(['d_timeserved', 's_timeserved']);
    expect(whichOne(m.candidates)).toMatch(/Which one: .*TIMESERVED JAR in STORYOS.*TIMESERVED NOTES in DEDUCTIONOS/);
  });

  it('prefers the room on screen over an equal fit elsewhere', () => {
    expect(matchAcrossBoards('timeserved', 'storyos', HITS, scoreNode).hit?.node.id).toBe('s_timeserved');
  });

  it('does not take a stray prefix on a board nobody is looking at', () => {
    expect(matchAcrossBoards('dedu', 'storyos', HITS, scoreNode).hit).toBeUndefined();
    expect(matchAcrossBoards('kitchen sink', 'root', HITS, scoreNode).candidates).toEqual([]);
  });
});

describe('matchRoom', () => {
  it('finds a room by its drive, its engraving, or "the mainboard"', () => {
    expect(matchRoom('deduction', HITS, scoreNode)).toEqual({ boardId: 'deductionos', path: ['r_deduction'], room: 'DEDUCTIONOS' });
    expect(matchRoom('the deduction room', HITS, scoreNode)).toMatchObject({ boardId: 'deductionos' });
    expect(matchRoom('deductionos', HITS, scoreNode)).toMatchObject({ boardId: 'deductionos' });
    expect(matchRoom('story', HITS, scoreNode)).toMatchObject({ boardId: 'storyos', path: ['r_story'] });
    expect(matchRoom('the mainboard', HITS, scoreNode)).toEqual({ boardId: 'root', path: [], room: 'SKYNETOS MAINBOARD' });
    expect(matchRoom('kitchen', HITS, scoreNode)).toBeNull();
  });
});

describe('the board by voice: the phrase table', () => {
  it('goes to a room from inside another, and climbs out', () => {
    expect(op(resolveIntent('go to the deduction room', inStory()))).toEqual({ type: 'goto', target: { boardId: 'deductionos', path: ['r_deduction'], room: 'DEDUCTIONOS' } });
    expect(op(resolveIntent('Jarvis, open the deduction room', inStory()))).toMatchObject({ type: 'goto', target: { boardId: 'deductionos' } });
    expect(op(resolveIntent('go to the mainboard', inStory()))).toMatchObject({ type: 'goto', target: { boardId: 'root' } });
    for (const said of ['go back', 'up', 'back']) {
      expect(resolveIntent(said, inStory()), said).toMatchObject({ kind: 'view', action: { type: 'ascend' } });
    }
    // At the root, "go back" is still the JARVIS window's main panel, as before.
    expect(resolveIntent('go back', atRoot())).toMatchObject({ kind: 'hologram' });
  });

  it('still descends into a room on screen the old way', () => {
    expect(resolveIntent('go into deduction', atRoot())).toMatchObject({ kind: 'view', action: { type: 'descend', nodeId: 'r_deduction' } });
  });

  it('selects, inspects, opens and zooms to a node on any board', () => {
    const select = resolveIntent('select jarvis prime', inStory());
    expect(select).toMatchObject({ kind: 'board', op: { type: 'select', hit: { boardId: 'root', node: { id: 'a_prime' } } } });
    expect(select.kind === 'board' && select.say).toMatch(/JARVIS-PRIME, in SKYNETOS MAINBOARD/);
    expect(op(resolveIntent('inspect timeserved jar', atRoot()))).toMatchObject({ type: 'inspect', hit: { node: { id: 's_timeserved' } } });
    expect(op(resolveIntent('show me the plush writer', inStory()))).toMatchObject({ type: 'inspect', hit: { boardId: 'storyos', node: { id: 's_plush' } } });
    expect(op(resolveIntent('open jarvis prime', inStory()))).toMatchObject({ type: 'open', hit: { node: { id: 'a_prime' } } });
    expect(op(resolveIntent('zoom to the deduction engine', inStory()))).toMatchObject({ type: 'zoomTo', hit: { boardId: 'deductionos', node: { id: 'd_engine' } } });
    // In the room on screen, select and open stay the old view actions.
    expect(resolveIntent('select the plush writer', inStory())).toMatchObject({ kind: 'view', action: { type: 'select', nodeId: 's_plush' } });
  });

  it('asks which one, in words, when two boards hold the name', () => {
    const out = resolveIntent('select timeserved', atRoot());
    expect(out.kind).toBe('ambiguous');
    expect(out.kind === 'ambiguous' && out.say).toMatch(/STORYOS.*DEDUCTIONOS/);
  });

  it('leaves an unknown "open" to the planner, as before', () => {
    const out = resolveIntent('open the kitchen sink', atRoot());
    expect(out).toMatchObject({ kind: 'unknown', plannable: true });
  });

  it('reads a rename back in his own words before it lands', () => {
    const out = resolveIntent('Jarvis, rename TIMESERVED JAR to TimeServed 1.3.', atRoot());
    expect(out.kind).toBe('board');
    if (out.kind !== 'board' || out.op.type !== 'write') throw new Error('not a read-back');
    expect(out.op.command).toEqual({ type: 'node.update', boardId: 'storyos', nodeId: 's_timeserved', patch: { name: 'TimeServed 1.3' } });
    expect(out.say).toBe('Renaming M4 TIMESERVED JAR in STORYOS to TimeServed 1.3. Go?');
    expect(out.op.readBack).toBe(out.say);
  });

  it('reads notes back, keeping what was said', () => {
    const out = resolveIntent("Set the plush writer's notes to Draft chapter two by Friday.", inStory());
    if (out.kind !== 'board' || out.op.type !== 'write') throw new Error('not a read-back');
    expect(out.op.command).toEqual({ type: 'node.update', boardId: 'storyos', nodeId: 's_plush', patch: { notes: 'Draft chapter two by Friday.' } });
    expect(out.say).toBe('Setting U2 PLUSH WRITER\'s notes in STORYOS to "Draft chapter two by Friday". Go?');
    expect(op(resolveIntent('set the notes on jarvis prime to check the mail', inStory()))).toMatchObject({ type: 'write', command: { nodeId: 'a_prime', patch: { notes: 'check the mail' } } });
  });

  it('keeps the old immediate rename for a typed or gestured sentence', () => {
    const out = resolveIntent('rename the plush writer to night writer', inStory({ actor: 'user' }));
    expect(out).toMatchObject({ kind: 'command', request: { command: { type: 'node.update', patch: { name: 'NIGHT WRITER' } } } });
  });
});

describe('the board by voice: "go" and "no" answer a read-back, and only then', () => {
  it('reads go, yes, do it as yes and no, cancel as no while an edit waits', () => {
    for (const said of ['go', 'yes', 'do it', 'go ahead', 'yes please', 'Jarvis, go.', 'make it so']) {
      expect(op(resolveIntent(said, inStory({ pendingEdit: true }))), said).toEqual({ type: 'answer', yes: true });
    }
    for (const said of ['no', 'cancel', 'never mind', 'no thanks', 'cancel that']) {
      expect(op(resolveIntent(said, inStory({ pendingEdit: true }))), said).toEqual({ type: 'answer', yes: false });
    }
  });

  it('leaves them alone when nothing waits: "yes" is conversation, "cancel" is stop', () => {
    expect(resolveIntent('yes', inStory())).toMatchObject({ kind: 'unknown', understood: false });
    expect(resolveIntent('cancel', inStory())).toMatchObject({ kind: 'view', action: { type: 'stop' } });
    // "stop" is always the halt, pending or not (actOnIntent's stop also drops the pending edit).
    expect(resolveIntent('stop', inStory({ pendingEdit: true }))).toMatchObject({ kind: 'view', action: { type: 'stop' } });
  });

  it('boardAnswer is exact', () => {
    expect(boardAnswer('go')).toBe(true);
    expect(boardAnswer('go to deduction')).toBeNull();
    expect(boardAnswer('nope')).toBe(false);
  });
});

describe('the board by voice: refusals', () => {
  it('never deletes by voice, however it is said, on any board', () => {
    for (const said of ['delete timeserved jar', 'remove the plush writer', 'get rid of jarvis prime', 'kill the deduction engine', 'erase the plush writer', 'trash it', 'unapprove the plush writer']) {
      const out = resolveIntent(said, inStory());
      expect(out, said).toMatchObject({ kind: 'unknown', understood: true, say: VOICE_DELETION_REFUSAL });
      expect(isVoiceDeletion(said)).toBe(true);
    }
    // Typed or gestured, a deletion is still a confirm the UI refuses (unchanged).
    expect(resolveIntent('delete the plush writer', inStory({ actor: 'user' })).kind).toBe('confirm');
  });

  it('refuses in words to move a node between rooms: the bus has no such command', () => {
    const out = resolveIntent('move the plush writer to the deduction room', inStory());
    expect(out.kind).toBe('unknown');
    expect(out.say).toMatch(/no command that moves U2 PLUSH WRITER into DEDUCTIONOS/);
    expect(parseMoveToRoom('move the plush writer to the deduction room')).toEqual({ target: 'the plush writer', room: 'deduction' });
    // A nudge is still a nudge.
    expect(resolveIntent('move the plush writer left two', inStory())).toMatchObject({ kind: 'command', request: { command: { type: 'node.move' } } });
  });

  it('builds no destructive command from any spoken write, and boardWrite refuses to', () => {
    const phrases = ['rename timeserved jar to jar', 'set the plush writer s notes to hi', 'set the notes on jarvis prime to hello'];
    for (const said of phrases) {
      const out = resolveIntent(said, inStory());
      if (out.kind !== 'board' || out.op.type !== 'write') throw new Error(said);
      expect(isDestructive(out.op.command), said).toBe(false);
      expect(DESTRUCTIVE).not.toContain(out.op.command.type);
    }
    const hit = HITS.find((h) => h.node.id === 's_plush')!;
    expect(boardWrite(hit, 'name', '   ', 'U2 PLUSH WRITER')).toBeNull();
    const w = boardWrite(hit, 'name', 'x'.repeat(500), 'U2 PLUSH WRITER');
    expect(w?.type === 'write' && (w.command as { patch: { name: string } }).patch.name.length).toBe(80);
  });

  it('no board intent ever carries an approval', () => {
    for (const said of ['rename timeserved jar to jar', 'go', 'select jarvis prime', 'open jarvis prime']) {
      const out = resolveIntent(said, inStory({ pendingEdit: true }));
      expect(JSON.stringify(out)).not.toMatch(/"approved"/);
    }
  });
});

describe('parse helpers', () => {
  it('parseNotes reads both shapes', () => {
    expect(parseNotes("set the stalker's notes to ship friday")).toEqual({ target: 'the stalker', value: 'ship friday' });
    expect(parseNotes('update the notes for u4 to call back')).toEqual({ target: 'u4', value: 'call back' });
    expect(parseNotes('set the stalker to red')).toBeNull();
  });

  it('rawValue keeps case and punctuation, and splits at the first "to" as the grammar does', () => {
    expect(rawValue('Jarvis, rename TIMESERVED JAR to TimeServed 1.3.', 'rename|retitle', 'to|as')).toBe('TimeServed 1.3');
    expect(rawValue('rename the stalker to Go To Bed', 'rename|retitle', 'to|as')).toBe('Go To Bed');
    expect(rawValue("set X's notes to Done. Ship it.", 'notes?', 'to|as|say|read', true)).toBe('Done. Ship it.');
  });
});

describe('dictation into a window and the split, as intents', () => {
  const ctx = (): IntentContext => atRoot();
  it.each([
    ['transcribe into jarvis tqr', { op: 'set', window: 'jarvis tqr', start: true }],
    ['Jarvis, dictate to JARVIS-TQR', { op: 'set', window: 'jarvis tqr', start: true }],
    ['type this into jarvis tqr', { op: 'set', window: 'jarvis tqr', start: true }],
    ['start transcribing into u1', { op: 'set', window: 'u1', start: true }],
    ['send it', { op: 'enter' }],
    ['press enter', { op: 'enter' }],
    ['enter', { op: 'enter' }],
    ['stop transcribing', { op: 'clear' }]
  ])('%s', (said, request) => {
    expect(resolveIntent(said, ctx())).toMatchObject({ kind: 'dictate', request });
  });

  it.each([
    ['split screen with jarvis tqr', { op: 'on', window: 'jarvis tqr' }],
    ['put jarvis tqr on monitor one and sit beside it', { op: 'on', window: 'jarvis tqr' }],
    ['sit beside jarvis tqr', { op: 'on', window: 'jarvis tqr' }],
    ['leave split screen', { op: 'off' }],
    ['unsplit', { op: 'off' }]
  ])('%s', (said, request) => {
    expect(resolveIntent(said, ctx())).toMatchObject({ kind: 'split', request });
  });

  it('leaves plain dictation and the SEND button where they were', () => {
    expect(resolveIntent('take dictation', ctx())).toMatchObject({ kind: 'hologram', control: { op: 'dictate', on: true } });
    expect(resolveIntent('send', ctx())).toMatchObject({ kind: 'hologram', control: { op: 'press', id: 'btn-send' } });
    expect(resolveIntent('transcribe this', ctx())).toMatchObject({ kind: 'hologram', control: { op: 'dictate', on: true } });
  });
});
