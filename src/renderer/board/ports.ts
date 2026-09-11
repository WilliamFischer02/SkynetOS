import type { BoardEdge, EdgeKind, NodeKind } from '@shared/types.js';
import type { NodeRect } from './layout.js';

/**
 * Wiring: drawing a trace between two nodes by hand.
 *
 * William: "add the ability to connect (generate) a wire between any two nodes; hovering over one
 * of the four edges of a node shows a glowing dot and when clicked starts a wire, then clicking
 * the edge of a different node connects / ends the wire. These wires stay dynamically attached /
 * adaptable."
 *
 * The last part is already true and is why this is only about the gesture: a `BoardEdge` stores
 * two NODE IDS and no coordinates at all. The router works out the copper every time the board is
 * built, so a trace follows its endpoints when they move, resize, or change footprint — there is
 * nothing to keep in step.
 *
 * Pure — no Pixi, no DOM — so the geometry can be tested without a canvas.
 */

/** Which edge of a node a wire attaches to. */
export type Side = 'n' | 'e' | 's' | 'w';

export interface Port {
  nodeId: string;
  side: Side;
  /** The dot's position, in world pixels: the midpoint of that edge. */
  x: number;
  y: number;
}

/** Wiring in progress: where it started, and nothing else. The other end is the cursor. */
export interface WiringState {
  from: Port;
}

/**
 * Kinds that cannot be wired.
 *
 * Backdrops and board furniture are scenery — a trace running to a decorative via or to the
 * picture behind the board would be a trace that means nothing, and the router would dutifully
 * draw it. Notes and zones ARE wirable: a bracket with a trace to the agent that owns it is a real
 * statement about the board.
 */
const UNWIRABLE: readonly string[] = ['decor.image', 'decor.part'];

export function isWirable(kind: NodeKind | string): boolean {
  return !UNWIRABLE.includes(kind);
}

/** The four edge midpoints of a rect, in world pixels. */
export function portsFor(rect: NodeRect): Port[] {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return [
    { nodeId: rect.nodeId, side: 'n', x: cx, y: rect.y },
    { nodeId: rect.nodeId, side: 'e', x: rect.x + rect.w, y: cy },
    { nodeId: rect.nodeId, side: 's', x: cx, y: rect.y + rect.h },
    { nodeId: rect.nodeId, side: 'w', x: rect.x, y: cy }
  ];
}

/** Distance from a point to a line segment, in world pixels. */
function distanceToSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * How far outside a node's edge still counts as aiming at it, as a multiple of the tolerance.
 *
 * The band is deliberately LOPSIDED: it reaches further out than in.
 *
 * Outside the node is empty substrate where the only other gesture is panning, so reach costs
 * nothing and buys the approach — you arrive at an edge from the outside, and a generous outer
 * band is what makes the dot easy to catch. Inside the node is where selecting, dragging to move
 * and the resize handle all live, and every world pixel of reach there is a pixel stolen from
 * them. On a 2x2 node — 32 world pixels square — a symmetric band would make a meaningful
 * fraction of the node's face un-draggable.
 */
const OUTSIDE = 1.6;
const INSIDE = 0.45;

/**
 * The port under a world point, or null.
 *
 * Hit-tested against the whole EDGE rather than against the dot, then snapped to that edge's
 * midpoint. Requiring the cursor to find a four-pixel dot would make the feature undiscoverable —
 * you would have to already know the dots were there to hover one. Hovering anywhere along the
 * top of a chip is an unambiguous way of saying "the top", so that is what it means.
 *
 * `tolerance` is in world pixels and the caller scales it by zoom, so the target is a constant
 * number of SCREEN pixels however far in you are.
 */
export function portAt(rects: readonly NodeRect[], x: number, y: number, tolerance: number): Port | null {
  let best: Port | null = null;
  let bestDistance = Infinity;

  const outer = tolerance * OUTSIDE;
  const inner = tolerance * INSIDE;

  for (const rect of rects) {
    if (!isWirable(rect.kind)) continue;

    // Cheap reject: anything further away than the outer reach on either axis cannot be close.
    if (x < rect.x - outer || x > rect.x + rect.w + outer) continue;
    if (y < rect.y - outer || y > rect.y + rect.h + outer) continue;

    /*
     * Which band applies is decided per NODE, not per edge: a point is either over this component
     * or beside it. Deciding per edge would let a point inside the node qualify under the outer
     * band for the far edge, which is the inner band leaking back in through the side door.
     */
    const within = x > rect.x && x < rect.x + rect.w && y > rect.y && y < rect.y + rect.h;
    const limit = within ? inner : outer;

    const right = rect.x + rect.w;
    const bottom = rect.y + rect.h;
    const edges: [Side, number, number, number, number][] = [
      ['n', rect.x, rect.y, right, rect.y],
      ['e', right, rect.y, right, bottom],
      ['s', rect.x, bottom, right, bottom],
      ['w', rect.x, rect.y, rect.x, bottom]
    ];

    for (const [side, ax, ay, bx, by] of edges) {
      const distance = distanceToSegment(x, y, ax, ay, bx, by);
      if (distance > limit || distance >= bestDistance) continue;
      bestDistance = distance;
      const port = portsFor(rect).find((p) => p.side === side);
      if (port) best = port;
    }
  }

  return best;
}

/**
 * The port under a point, unless the resize handle has a better claim on it.
 *
 * ── The conflict ─────────────────────────────────────────────────────────────────────────────
 *
 * Reported: "i'm having trouble scaling nodes because of the wire creation ui, instead of scaling
 * it always tried to create a wire instead."
 *
 * The resize handle sits in the selected node's bottom-right CORNER, which is exactly where the
 * east and south edges meet — and `portAt` hit-tests along the whole length of an edge. So every
 * press on the handle was also a press on two ports, and wiring, which runs first, took all of
 * them. The mouse path to resizing became unreachable the day wiring landed. (Shift+arrows still
 * worked, which is why it was a frustration rather than a wall.)
 *
 * The handle already outranks the MOVE gesture for the same reason — it is drawn on top of the
 * node, so a press there is unambiguous — and it has to outrank wiring too.
 *
 * The dead zone is the handle PADDED by the tolerance, because an exact test means missing an
 * eight-pixel target by two pixels starts a trace instead: the same frustration, rarer and harder
 * to explain. Nothing is lost by the padding — ports live at edge MIDPOINTS, so a node's corner is
 * not where you aim to wire it.
 */
export function portUnderPoint(
  rects: readonly NodeRect[],
  x: number,
  y: number,
  tolerance: number,
  /** The selected node's resize handle in world pixels, or null when nothing is selected. */
  handle: { x: number; y: number; w: number; h: number } | null
): Port | null {
  if (handle &&
    x >= handle.x - tolerance && x <= handle.x + handle.w + tolerance &&
    y >= handle.y - tolerance && y <= handle.y + handle.h + tolerance
  ) {
    return null;
  }
  return portAt(rects, x, y, tolerance);
}

/**
 * Whether a wire from `from` to `to` may be created, and why not when it may not.
 *
 * Returns a reason rather than a boolean so the cursor can say what is wrong. A gesture that
 * silently does nothing is indistinguishable from one that is broken — which is a lesson this
 * codebase has already paid for twice.
 */
export function wireRefusal(from: Port, to: Port, edges: readonly BoardEdge[]): string | null {
  if (from.nodeId === to.nodeId) return 'A TRACE CANNOT RETURN TO ITS OWN NODE';

  const exists = edges.some(
    (e) =>
      (e.from === from.nodeId && e.to === to.nodeId) ||
      (e.from === to.nodeId && e.to === from.nodeId)
  );
  // Not because a second trace would be invalid, but because two traces between the same pair of
  // nodes render on top of each other: the board would look unchanged and the click would seem
  // to have failed.
  if (exists) return 'THESE NODES ARE ALREADY CONNECTED';

  return null;
}

/**
 * A free edge id.
 *
 * The seeded boards use `e1`, `e2`, ... so this continues the convention rather than minting a
 * uuid — the ids are read by a human editing board JSON by hand, and `e12` is a thing you can
 * refer to in a sentence.
 */
export function freeEdgeId(edges: readonly BoardEdge[]): string {
  const taken = new Set(edges.map((e) => e.id));
  for (let i = 1; i < 10_000; i++) {
    const candidate = `e${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `e${Date.now()}`;
}

/**
 * What relationship a new trace probably describes, from the kinds at its ends.
 *
 * A guess, and an editable one — the point is that drawing a wire should not open a dialog asking
 * which of six words you meant. Wiring an agent to a repo means the agent reads it far more often
 * than anything else, and if the guess is wrong the inspector changes it in one click.
 */
export function guessEdgeKind(fromKind: string, toKind: string): EdgeKind {
  const pair = (a: string, b: string): boolean =>
    (fromKind.startsWith(a) && toKind.startsWith(b)) || (fromKind.startsWith(b) && toKind.startsWith(a));

  if (pair('agent.jarvis', 'drive.room')) return 'supervises';
  if (pair('agent.jarvis', 'agent')) return 'supervises';
  if (pair('store.repo', 'file.artifact')) return 'produces';
  if (pair('agent', 'file.artifact')) return 'produces';
  if (pair('store.cloud', 'store.repo')) return 'syncs';
  if (pair('store.cloud', 'link.url')) return 'syncs';
  if (pair('service.process', 'store.repo')) return 'deploys';
  if (pair('store.repo', 'store.repo')) return 'depends';
  return 'reads';
}
