import type { Board } from '@shared/types.js';
import { footprintOf } from '@shared/types.js';
import type { Point } from './traces.js';

/**
 * Routed traces, remembered by the geometry that produced them (2026-09-26 audit).
 *
 * `buildTraces` re-routes every edge on every rebuild: entering a room, coming back to it, and
 * after every board mutation, including a rename or a colour change that moved nothing. The
 * router's answer depends only on the nodes' rectangles and the edges' endpoints and pins, so a
 * rebuild whose geometry is unchanged can reuse the last answer. The key is that geometry spelled
 * out; anything else on the board (names, notes, themes, tags) is deliberately not in it, and a
 * theme change therefore restyles the same routes rather than recomputing them.
 *
 * Twelve boards deep, least recently used out, so flipping between rooms costs no routing after
 * the first visit to each. Held in module scope: the canvas is torn down per room, the cache is not.
 */

export interface CachedRoute { points: Point[]; routed: boolean; fellBack: boolean }
export interface CachedRoutes { routes: Map<string, CachedRoute>; routedCount: number; fallbackCount: number }

export const ROUTE_CACHE_SIZE = 12;

const cache = new Map<string, CachedRoutes>();

/** Every input the router reads, and nothing it does not. */
export function routeCacheKey(board: Board): string {
  const nodes = board.nodes
    .map((n) => {
      const fp = footprintOf(n);
      const rot = (n as { rotation?: number }).rotation ?? 0;
      return `${n.id}:${n.kind}:${n.pos.x},${n.pos.y}:${fp.w}x${fp.h}:${rot}`;
    })
    .join(';');
  const edges = board.edges
    .map((e) => {
      const ex = e as { waypoints?: unknown; fromAnchor?: unknown; toAnchor?: unknown; width?: number };
      return `${e.id}:${e.from}>${e.to}:${JSON.stringify(ex.waypoints ?? null)}:${JSON.stringify(ex.fromAnchor ?? null)}:${JSON.stringify(ex.toAnchor ?? null)}:${ex.width ?? ''}`;
    })
    .join(';');
  return `${board.id}|${board.grid.tile}x${board.grid.width}x${board.grid.height}|${nodes}|${edges}`;
}

export function getCachedRoutes(key: string): CachedRoutes | null {
  const hit = cache.get(key);
  if (!hit) return null;
  // Refresh recency: a Map iterates in insertion order, so re-inserting moves it to the back.
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

export function putCachedRoutes(key: string, value: CachedRoutes): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > ROUTE_CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function routeCacheSize(): number {
  return cache.size;
}

/** For tests. */
export function clearRouteCache(): void {
  cache.clear();
}
