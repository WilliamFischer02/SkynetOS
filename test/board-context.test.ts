/**
 * What JARVIS's conversation can see of the board (packages/shared/board-context.ts, 2026-09-27).
 * William: the reply said it "needs the board state streamed to it".
 */

import { describe, expect, it } from 'vitest';
import { BOARD_BLOCK_MAX, BOARD_NODES_MAX, boardBlock, boardContextFrom, sanitiseBoardContext, type BoardContext } from '@shared/board-context.js';
import { conversePrompt, converseSystemPrompt } from '@shared/converse.js';
import type { BoardNode } from '@shared/types.js';

const node = (id: string, name: string, kind: string, extra: Partial<BoardNode> = {}): BoardNode => ({ id, name, kind, ...extra }) as unknown as BoardNode;

const ctx: BoardContext = {
  boardId: 'dev',
  roomPath: ['ROOT', 'DEV'],
  roomName: 'DEV',
  selected: { id: 'n1', designator: 'U4', name: 'SkynetOS', kind: 'store.repo', target: 'C:\\dev\\SkynetOS' },
  nodes: [
    { id: 'n1', designator: 'U4', name: 'SkynetOS', kind: 'store.repo' },
    { id: 'n2', designator: 'J2', name: 'Face', kind: 'agent.claude' }
  ],
  rooms: [{ id: 'r1', name: 'DEV' }, { id: 'r2', name: 'MEDIA' }]
};

describe('the BOARD block', () => {
  it('names the room, the selection, every node, the rooms, the sessions and what JARVIS is doing', () => {
    const block = boardBlock(ctx, [{ designator: 'J2', name: 'Face', state: 'running' }, { designator: null, name: 'Stalker', state: 'exited' }], 'answering William');
    expect(block).toContain('Room: DEV (path: ROOT > DEV).');
    expect(block).toContain('Selected: U4 SkynetOS (store.repo) -> C:\\dev\\SkynetOS [id n1].');
    expect(block).toContain('Rooms on the root board: DEV, MEDIA.');
    expect(block).toContain('Sessions: J2 Face running; Stalker not running.');
    expect(block).toContain('JARVIS is now: answering William.');
    expect(block).toContain('U4 SkynetOS (store.repo)\nJ2 Face (agent.claude)');
  });

  it('never runs past 3,000 characters, and says how many nodes it left out', () => {
    const many: BoardContext = { ...ctx, nodes: Array.from({ length: BOARD_NODES_MAX }, (_, i) => ({ id: `n${i}`, designator: `U${i}`, name: `A rather long node name number ${i} for the cap`, kind: 'store.folder' })) };
    const block = boardBlock(many, [], 'idle');
    expect(block.length).toBeLessThanOrEqual(BOARD_BLOCK_MAX);
    expect(block).toMatch(/\(and \d+ more\)/);
  });

  it('says so when the board window has not reported', () => {
    expect(boardBlock(null, [], 'idle')).toContain('has not reported yet');
  });
});

describe('what the board window sends, and what main keeps', () => {
  it('summarises the store: paths only for the selected node, at most 60 nodes', () => {
    const nodes = [node('a', 'SkynetOS', 'store.repo', { designator: 'U4', path: 'C:\\dev\\SkynetOS' } as Partial<BoardNode>), node('b', 'Notes', 'store.folder', { path: 'C:\\notes' } as Partial<BoardNode>)];
    const out = boardContextFrom({ boardId: 'root', board: { name: 'ROOT', nodes }, stack: [], selectedId: 'a', rootRooms: [] })!;
    expect(out.selected).toEqual({ id: 'a', designator: 'U4', name: 'SkynetOS', kind: 'store.repo', target: 'C:\\dev\\SkynetOS' });
    expect(out.nodes[1]).toEqual({ id: 'b', name: 'Notes', kind: 'store.folder' });
    expect(JSON.stringify(out.nodes)).not.toContain('C:\\\\notes');
    const lots = Array.from({ length: 90 }, (_, i) => node(`n${i}`, `N${i}`, 'store.folder'));
    expect(boardContextFrom({ boardId: 'root', board: { name: 'ROOT', nodes: lots }, stack: [], selectedId: null, rootRooms: [] })!.nodes).toHaveLength(BOARD_NODES_MAX);
  });

  it('accepts only a well-formed summary, trimmed and capped', () => {
    expect(sanitiseBoardContext(null)).toBeNull();
    expect(sanitiseBoardContext({ roomName: 'x' })).toBeNull();
    const clean = sanitiseBoardContext({ boardId: 'dev', roomName: 'DEV\u0007', roomPath: ['ROOT', 7, 'DEV'], selected: { id: 'n', name: 'X', kind: 'k', target: 'C:\\x' }, nodes: [{ id: 'n', name: 'X', kind: 'k', target: 'leak' }, { nope: 1 }], rooms: [{ id: 'r', name: 'R' }, 'bad'] })!;
    expect(clean.roomName).toBe('DEV');
    expect(clean.roomPath).toEqual(['ROOT', 'DEV']);
    expect(clean.selected?.target).toBe('C:\\x');
    expect(clean.nodes).toEqual([{ id: 'n', name: 'X', kind: 'k' }]);
    expect(clean.rooms).toEqual([{ id: 'r', name: 'R' }]);
  });
});

describe('the conversation sees it', () => {
  it('tells the model it can see the board and that the grammar does the selecting', () => {
    const p = converseSystemPrompt();
    expect(p).toContain('You can SEE William');
    expect(p).toContain('never say you lack the board state');
    expect(p).toContain('carried out by the board\'s own grammar');
  });

  it('puts the BOARD block in the prompt', () => {
    const block = boardBlock(ctx, [], 'answering William');
    const p = conversePrompt([], { desktopEnabled: false, monitors: 3, apps: 299, timeLocal: 'now', board: block }, 'what is selected?');
    expect(p).toContain('BOARD (what is on William');
    expect(p).toContain('Selected: U4 SkynetOS');
    expect(p.indexOf('BOARD')).toBeLessThan(p.indexOf('William says: what is selected?'));
  });
});
