import { describe, expect, it } from 'vitest';
import { isDestructive } from '../packages/shared/commands.js';
import type { BoardEdge, BoardNode } from '../packages/shared/types.js';
import { edgeIdFor, matchNode, resolveIntent, scoreNode, stripPreamble, type IntentContext } from '../packages/shared/intent.js';

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
