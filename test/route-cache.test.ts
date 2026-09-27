import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Board } from '../packages/shared/types.js';
import {
  ROUTE_CACHE_SIZE,
  clearRouteCache,
  getCachedRoutes,
  putCachedRoutes,
  routeCacheKey,
  routeCacheSize
} from '../src/renderer/board/route-cache.js';

const root = JSON.parse(readFileSync(join(process.cwd(), 'board', 'root.board.json'), 'utf8')) as Board;

const clone = (): Board => JSON.parse(JSON.stringify(root)) as Board;

describe('routeCacheKey', () => {
  it('is stable for the same geometry', () => {
    expect(routeCacheKey(clone())).toBe(routeCacheKey(clone()));
  });

  it('ignores what the router does not read: names, notes text, themes, tags', () => {
    const b = clone();
    b.nodes[0]!.name = 'RENAMED';
    b.theme = { ...b.theme, signal: '#FFFFFF' };
    (b.nodes[0] as { tags?: string[] }).tags = ['changed'];
    expect(routeCacheKey(b)).toBe(routeCacheKey(root));
  });

  it('changes when a node moves, resizes, or an edge is re-pinned', () => {
    const moved = clone();
    moved.nodes[0]!.pos = { x: moved.nodes[0]!.pos.x + 1, y: moved.nodes[0]!.pos.y };
    expect(routeCacheKey(moved)).not.toBe(routeCacheKey(root));

    const resized = clone();
    const n = resized.nodes.find((x) => x.footprint)!;
    n.footprint = { w: n.footprint!.w + 1, h: n.footprint!.h };
    expect(routeCacheKey(resized)).not.toBe(routeCacheKey(root));

    const repinned = clone();
    (repinned.edges[0] as { waypoints?: number[][] }).waypoints = [[1, 1], [2, 2]];
    expect(routeCacheKey(repinned)).not.toBe(routeCacheKey(root));
  });
});

describe('the cache', () => {
  beforeEach(() => clearRouteCache());

  it('returns what was put, and keeps the newest twelve boards', () => {
    for (let i = 0; i < ROUTE_CACHE_SIZE + 3; i++) {
      putCachedRoutes(`k${i}`, { routes: new Map(), routedCount: i, fallbackCount: 0 });
    }
    expect(routeCacheSize()).toBe(ROUTE_CACHE_SIZE);
    expect(getCachedRoutes('k0')).toBeNull();
    expect(getCachedRoutes(`k${ROUTE_CACHE_SIZE + 2}`)?.routedCount).toBe(ROUTE_CACHE_SIZE + 2);
  });

  it('a hit counts as recent use', () => {
    for (let i = 0; i < ROUTE_CACHE_SIZE; i++) putCachedRoutes(`k${i}`, { routes: new Map(), routedCount: i, fallbackCount: 0 });
    expect(getCachedRoutes('k0')).not.toBeNull();
    putCachedRoutes('fresh', { routes: new Map(), routedCount: 99, fallbackCount: 0 });
    expect(getCachedRoutes('k0')).not.toBeNull();
    expect(getCachedRoutes('k1')).toBeNull();
  });
});
