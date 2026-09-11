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
  let bestDistance = tolerance;

  for (const rect of rects) {
    if (!isWirable(rect.kind)) continue;

    // Cheap reject: anything further away than the tolerance on either axis cannot be close.
    if (x < rect.x - tolerance || x > rect.x + rect.w + tolerance) continue;
    if (y < rect.y - tolerance || y > rect.y + rect.h + tolerance) continue;

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
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      const port = portsFor(rect).find((p) => p.side === side);
      if (port) best = port;
    }
  }

  return best;
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
