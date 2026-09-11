import { describe, expect, it } from 'vitest';
import type { BoardEdge } from '../packages/shared/types.js';
import type { NodeRect } from '../src/renderer/board/layout.js';
import { freeEdgeId, guessEdgeKind, isWirable, portAt, portsFor, wireRefusal } from '../src/renderer/board/ports.js';

/**
 * Drawing a trace by hand.
 *
 * The geometry is all that needs testing here. A `BoardEdge` stores two node ids and no
 * coordinates, so "these wires stay dynamically attached / adaptable" is a property of the data
 * model rather than of this code — the router redraws the copper from the endpoints every time the
 * board is built.
 */

const rect = (nodeId: string, x: number, y: number, w: number, h: number, kind = 'store.repo'): NodeRect =>
  ({ nodeId, kind: kind as NodeRect['kind'], x, y, w, h });

describe('a node offers four ports, at the middle of each edge', () => {
  const ports = portsFor(rect('s1', 100, 200, 64, 48));

  it('puts one at the midpoint of each side', () => {
    expect(ports.find((p) => p.side === 'n')).toMatchObject({ x: 132, y: 200 });
    expect(ports.find((p) => p.side === 'e')).toMatchObject({ x: 164, y: 224 });
    expect(ports.find((p) => p.side === 's')).toMatchObject({ x: 132, y: 248 });
    expect(ports.find((p) => p.side === 'w')).toMatchObject({ x: 100, y: 224 });
  });

  it('names the node they belong to', () => {
    for (const port of ports) expect(port.nodeId).toBe('s1');
  });
});

describe('hovering an edge finds its port', () => {
  const rects = [rect('s1', 100, 200, 64, 48), rect('s2', 400, 200, 64, 48)];

  it('snaps to the midpoint from anywhere along the edge', () => {
    /*
     * The whole point. Requiring the cursor to find a four-pixel dot would make the feature
     * undiscoverable — you would have to already know the dots were there to hover one. Hovering
     * anywhere along the top of a chip is an unambiguous way of saying "the top".
     */
    for (const x of [102, 120, 132, 150, 162]) {
      const port = portAt(rects, x, 201, 6);
      expect(port, `hovering the top edge at x=${x} found nothing`).not.toBeNull();
      expect(port!.side).toBe('n');
      expect(port!.x, 'the dot did not snap to the middle of the edge').toBe(132);
    }
  });

  it('picks the nearest edge when the cursor is near a corner', () => {
    // Just inside the top-left corner, a hair closer to the top.
    expect(portAt(rects, 101, 202, 6)!.side).toBe('w');
    expect(portAt(rects, 103, 201, 6)!.side).toBe('n');
  });

  it('finds nothing in open substrate', () => {
    expect(portAt(rects, 300, 300, 6)).toBeNull();
  });

  it('finds nothing deep inside a node', () => {
    // The middle of a chip is for selecting and dragging it, not for wiring.
    expect(portAt(rects, 132, 224, 6)).toBeNull();
  });

  it('reaches just outside the edge as well as just inside', () => {
    // Approaching from outside is how you actually do it — the cursor arrives from the substrate.
    expect(portAt(rects, 132, 196, 6)?.side).toBe('n');
    expect(portAt(rects, 132, 192, 6)).toBeNull();
  });

  it('picks the right node when two are near', () => {
    expect(portAt(rects, 398, 224, 6)!.nodeId).toBe('s2');
  });
});

describe('scenery cannot be wired', () => {
  it('refuses backdrops and board furniture', () => {
    // A trace to the picture behind the board, or to a decorative via, would mean nothing — and
    // the router would draw it anyway.
    expect(isWirable('decor.image')).toBe(false);
    expect(isWirable('decor.part')).toBe(false);
  });

  it('allows notes and zones', () => {
    // A bracket with a trace to the agent that owns it is a real statement about the board.
    expect(isWirable('note.silk')).toBe(true);
    expect(isWirable('group.zone')).toBe(true);
    expect(isWirable('agent.code')).toBe(true);
  });

  it('skips them when hit-testing', () => {
    const scenery = [rect('bg1', 0, 0, 400, 400, 'decor.image')];
    expect(portAt(scenery, 200, 2, 6)).toBeNull();
  });
});

describe('what a wire is refused for', () => {
  const edges: BoardEdge[] = [{ id: 'e1', from: 's1', to: 's2', kind: 'reads' }];
  const port = (nodeId: string) => ({ nodeId, side: 'n' as const, x: 0, y: 0 });

  it('refuses a node wired to itself', () => {
    expect(wireRefusal(port('s1'), port('s1'), edges)).toContain('OWN NODE');
  });

  it('refuses a duplicate, in either direction', () => {
    // Not because a second trace is invalid, but because it renders on top of the first: the board
    // would look unchanged and the click would seem to have failed.
    expect(wireRefusal(port('s1'), port('s2'), edges)).toContain('ALREADY CONNECTED');
    expect(wireRefusal(port('s2'), port('s1'), edges)).toContain('ALREADY CONNECTED');
  });

  it('allows a new pair', () => {
    expect(wireRefusal(port('s1'), port('s3'), edges)).toBeNull();
  });
});

describe('edge ids continue the board convention', () => {
  it('takes the first free number', () => {
    const edges = [{ id: 'e1' }, { id: 'e2' }, { id: 'e4' }] as BoardEdge[];
    expect(freeEdgeId(edges)).toBe('e3');
  });

  it('starts at e1 on an empty board', () => {
    expect(freeEdgeId([])).toBe('e1');
  });
});

describe('the guessed relationship', () => {
  it('reads as the default, because most traces are a read', () => {
    expect(guessEdgeKind('store.folder', 'file.document')).toBe('reads');
  });

  it('is symmetric — the direction you drew it in should not change the word', () => {
    expect(guessEdgeKind('agent.jarvis', 'drive.room')).toBe('supervises');
    expect(guessEdgeKind('drive.room', 'agent.jarvis')).toBe('supervises');
    expect(guessEdgeKind('store.repo', 'file.artifact')).toBe('produces');
    expect(guessEdgeKind('file.artifact', 'store.repo')).toBe('produces');
  });

  it('always names a real edge kind', () => {
    const kinds = ['agent.jarvis', 'agent.code', 'store.repo', 'store.cloud', 'file.artifact', 'drive.room', 'link.url', 'service.process'];
    for (const a of kinds) {
      for (const b of kinds) {
        expect(['produces', 'reads', 'depends', 'deploys', 'syncs', 'supervises']).toContain(guessEdgeKind(a, b));
      }
    }
  });
});
