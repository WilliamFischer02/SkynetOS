import { describe, expect, it } from 'vitest';
import type { BoardEdge } from '../packages/shared/types.js';
import type { NodeRect } from '../src/renderer/board/layout.js';
import { freeEdgeId, guessEdgeKind, isWirable, portAt, portUnderPoint, portsFor, wireRefusal } from '../src/renderer/board/ports.js';

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

  it('reaches further OUTSIDE the node than inside it', () => {
    /*
     * The band is deliberately lopsided. Outside is empty substrate where the only competing
     * gesture is panning, and approaching an edge from the outside is how you actually do it — so
     * reach there is free and makes the dot easy to catch. Inside is where selecting, dragging to
     * move and the resize handle all live, and every pixel of reach is stolen from them.
     *
     * With tolerance 6: ~9.6 world px outside, ~2.7 inside.
     */
    expect(portAt(rects, 132, 192, 6)?.side, '8px outside the top edge should still light it').toBe('n');
    expect(portAt(rects, 132, 189, 6), '11px outside is too far').toBeNull();

    expect(portAt(rects, 132, 202, 6)?.side, '2px inside the top edge should light it').toBe('n');
    expect(portAt(rects, 132, 205, 6), '5px inside belongs to the node, not the wire').toBeNull();
  });

  it('leaves most of a small node draggable', () => {
    /*
     * The case that motivated the asymmetry. A 2x2 node is 32 world px square; a symmetric band
     * would make a meaningful fraction of its face un-draggable, and a press meant to move it
     * would start a trace instead.
     */
    const small = [rect('s3', 0, 0, 32, 32)];
    let free = 0;
    let total = 0;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        total++;
        if (!portAt(small, x + 0.5, y + 0.5, 6)) free++;
      }
    }
    expect(free / total, 'too much of a small node is given over to wiring').toBeGreaterThan(0.6);
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

/**
 * ── The resize handle keeps its corner ───────────────────────────────────────────────────────
 *
 * Reported: "i'm having trouble scaling nodes because of the wire creation ui, instead of scaling
 * it always tried to create a wire instead."
 *
 * The handle sits in the selected node's bottom-right CORNER — exactly where the east and south
 * edges meet — and ports are hit-tested along the whole length of an edge. So every press on the
 * handle was also a press on two ports, and wiring, which runs first, took all of them. The mouse
 * path to resizing became unreachable the day wiring landed.
 */
describe('the resize handle outranks wiring', () => {
  // A node at 100,200, 64x48. Its handle is the 8px square in the bottom-right corner.
  const rects = [rect('s1', 100, 200, 64, 48)];
  const handle = { x: 156, y: 240, w: 8, h: 8 };

  it('lights no port anywhere on the handle', () => {
    for (const [x, y] of [[157, 241], [160, 244], [163, 247], [156, 240], [164, 248]]) {
      expect(portUnderPoint(rects, x!, y!, 6, handle), `the handle at ${x},${y} still started a wire`)
        .toBeNull();
    }
  });

  it('lights no port just OUTSIDE the handle either', () => {
    /*
     * The dead zone is the handle padded by the tolerance. An exact test would mean missing an
     * eight-pixel target by two pixels starts a trace instead — the same frustration, rarer and
     * harder to explain.
     */
    expect(portUnderPoint(rects, 153, 245, 6, handle)).toBeNull();
    expect(portUnderPoint(rects, 160, 237, 6, handle)).toBeNull();
  });

  it('would have started a wire there without the handle — which is the bug', () => {
    // The premise. If this ever stops being true the guard above is measuring nothing.
    expect(portAt(rects, 160, 247, 6)).not.toBeNull();
    expect(portUnderPoint(rects, 160, 247, 6, null)).not.toBeNull();
  });

  it('still wires every edge away from the corner', () => {
    // The handle takes a corner, not a node. Ports live at edge MIDPOINTS, which are untouched.
    expect(portUnderPoint(rects, 132, 201, 6, handle)?.side).toBe('n');
    expect(portUnderPoint(rects, 101, 224, 6, handle)?.side).toBe('w');
    expect(portUnderPoint(rects, 132, 247, 6, handle)?.side).toBe('s');
    expect(portUnderPoint(rects, 163, 224, 6, handle)?.side).toBe('e');
  });

  it('takes nothing from an unselected node', () => {
    // Only the selected node has a handle, so every other node's corner still wires.
    const two = [rect('s1', 100, 200, 64, 48), rect('s2', 400, 200, 64, 48)];
    expect(portUnderPoint(two, 462, 247, 6, handle)?.nodeId).toBe('s2');
  });
});
