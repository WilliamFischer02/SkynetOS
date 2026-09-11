/**
 * Where the couriers walk: along the copper.
 *
 * William: "the bots don't follow the wires; their base paths should be along drawn or generated
 * wires, so the wires are the paths basically." They used to cut an L-shaped line straight from
 * the JARVIS head to the destination, across components and bare substrate alike, which made the
 * traces decoration and the robots a separate layer that ignored them. Now the traces ARE the
 * road network: a courier to MinecraftOS walks the JARVIS→MinecraftOS supervises trace, and a
 * courier to a repo two hops away walks both traces, passing through the chip in between.
 *
 * Pure: no Pixi, no DOM. test/courier-paths.test.ts holds the graph search and the geometry.
 */

import type { Point } from './traces.js';

/** One drawn trace as a road: its two ends and the polyline the router actually laid down. */
export interface Wire {
  id: string;
  from: string;
  to: string;
  /** World pixels, orthogonal, running from the `from` node to the `to` node. */
  points: Point[];
}

function dedupe(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  return out;
}

/** Total length of a polyline. Orthogonal, so each segment is |dx| + |dy|. */
export function pathLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    total += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
  }
  return total;
}

/**
 * The point a given distance along a polyline, which way that stretch runs, and how far along
 * the stretch it is (0..1). The last two drive the wobble: it is applied across the stretch and
 * tapers to nothing at each corner, so a courier never jumps sideways when it turns.
 */
export function pointAt(
  points: readonly Point[],
  distance: number
): { x: number; y: number; horizontal: boolean; along: number } {
  const first = points[0];
  if (!first) return { x: 0, y: 0, horizontal: true, along: 0 };
  let left = Math.max(0, distance);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (length === 0) continue;
    if (left <= length || i === points.length - 1) {
      const t = Math.min(1, left / length);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, horizontal: a.y === b.y, along: t };
    }
    left -= length;
  }
  return { x: first.x, y: first.y, horizontal: true, along: 0 };
}

/**
 * Join two orthogonal polylines end to start.
 *
 * Consecutive traces meet at a node but on different faces of it, so there is a gap between the
 * end of one and the start of the next. It is bridged with an elbow, never a diagonal, and the
 * bridge passes under the chip. The courier layer is drawn below the components, so a packet
 * walking through a component reads as going through it, which is what the second hop means.
 */
export function joinOrthogonal(a: readonly Point[], b: readonly Point[]): Point[] {
  if (!a.length) return [...b];
  if (!b.length) return [...a];
  const end = a[a.length - 1]!;
  const start = b[0]!;
  const out = [...a];
  if (end.x !== start.x && end.y !== start.y) out.push({ x: start.x, y: end.y });
  out.push(...b);
  return dedupe(out);
}

/**
 * The walk from one node to another along the wires, or null if the wires do not join them.
 *
 * Dijkstra over nodes, each trace an undirected road weighted by its drawn length: couriers
 * deliver in both directions along a trace, whatever its relation says, because the relation
 * describes the projects and not the road. Ties are broken by board order so the same board
 * sends couriers the same way every launch.
 */
export function wirePath(sourceId: string, destId: string, wires: readonly Wire[]): Point[] | null {
  if (sourceId === destId) return null;

  const adjacency = new Map<string, { to: string; wire: Wire; forward: boolean; cost: number }[]>();
  const link = (from: string, to: string, wire: Wire, forward: boolean, cost: number): void => {
    const list = adjacency.get(from) ?? [];
    list.push({ to, wire, forward, cost });
    adjacency.set(from, list);
  };
  for (const wire of wires) {
    if (wire.from === wire.to || wire.points.length < 2) continue;
    const cost = Math.max(1, pathLength(wire.points));
    link(wire.from, wire.to, wire, true, cost);
    link(wire.to, wire.from, wire, false, cost);
  }
  if (!adjacency.has(sourceId) || !adjacency.has(destId)) return null;

  const dist = new Map<string, number>([[sourceId, 0]]);
  const prev = new Map<string, { from: string; wire: Wire; forward: boolean }>();
  const done = new Set<string>();

  for (;;) {
    let current: string | null = null;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (!done.has(id) && d < best) { best = d; current = id; }
    }
    if (current === null) return null;
    if (current === destId) break;
    done.add(current);
    for (const step of adjacency.get(current) ?? []) {
      const next = best + step.cost;
      if (next < (dist.get(step.to) ?? Infinity)) {
        dist.set(step.to, next);
        prev.set(step.to, { from: current, wire: step.wire, forward: step.forward });
      }
    }
  }

  const hops: { wire: Wire; forward: boolean }[] = [];
  for (let at = destId; at !== sourceId;) {
    const step = prev.get(at);
    if (!step) return null;
    hops.unshift({ wire: step.wire, forward: step.forward });
    at = step.from;
  }

  let path: Point[] = [];
  for (const hop of hops) {
    const points = hop.forward ? hop.wire.points : [...hop.wire.points].reverse();
    path = joinOrthogonal(path, points);
  }
  return path.length >= 2 ? path : null;
}

/**
 * Where couriers set off from on a board.
 *
 * The JARVIS head when there is one: the packets are its errands and it has jurisdiction over
 * everything. A room has no head, so the best-connected node stands in for it, which is the
 * room's natural hub and the node its traces already radiate from. Ties go to board order. Null
 * when nothing on the board is wired at all.
 */
export function courierHub(nodes: readonly { id: string; kind: string }[], wires: readonly Wire[]): string | null {
  const head = nodes.find((n) => n.kind === 'agent.jarvis');
  if (head) return head.id;
  const degree = new Map<string, number>();
  for (const wire of wires) {
    if (wire.from === wire.to) continue;
    degree.set(wire.from, (degree.get(wire.from) ?? 0) + 1);
    degree.set(wire.to, (degree.get(wire.to) ?? 0) + 1);
  }
  let hub: string | null = null;
  let most = 0;
  for (const node of nodes) {
    const d = degree.get(node.id) ?? 0;
    if (d > most) { most = d; hub = node.id; }
  }
  return hub;
}

/** An L from one point to another, horizontal first. The last resort, and the old behaviour. */
export function elbowPath(from: Point, to: Point): Point[] {
  return dedupe([from, { x: to.x, y: from.y }, to]);
}
