/**
 * The MATRIX's geometry: the grid, where each end product sits, the keys, the spin and the dolly zoom.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATRIX,
  DEG,
  angularDistance,
  cardHalfOnScreen,
  dollyCamera,
  dragBy,
  eligibleTiles,
  globeGrid,
  hoverHeight,
  itemsOf,
  nearestItem,
  neighbourOf,
  placeItems,
  pointOn,
  project,
  recordVisit,
  releaseVelocity,
  spinSpeed,
  spinStep,
  toView,
  visitCounts,
  wrapLon,
  type MatrixItem,
  type Spin
} from '@shared/matrix.js';
import type { BoardNode } from '@shared/types.js';

const tiles = globeGrid();

const item = (boardId: string, n: number, visits = 0): MatrixItem => ({
  key: `${boardId}/n${n}`,
  boardId,
  nodeId: `n${n}`,
  project: boardId.toUpperCase(),
  name: `FILE ${n}`,
  kind: 'file.document',
  target: `C:/dev/${boardId}/file${n}.md`,
  visits
});

describe('the grid', () => {
  it('covers the whole sphere, once', () => {
    const area = tiles.reduce((sum, t) => sum + (t.lon1 - t.lon0) * (Math.sin(t.lat1) - Math.sin(t.lat0)), 0);
    expect(area).toBeCloseTo(4 * Math.PI, 6);
  });

  it('keeps the tiles a file can sit on close to square', () => {
    for (const tile of eligibleTiles(tiles)) {
      const width = (tile.lon1 - tile.lon0) * Math.cos(tile.lat);
      const height = tile.lat1 - tile.lat0;
      expect(width / height).toBeGreaterThan(0.75);
      expect(width / height).toBeLessThan(1.3);
    }
  });

  it('keeps files out of the pole margin', () => {
    const eligible = eligibleTiles(tiles);
    expect(eligible.length).toBeGreaterThan(100);
    for (const tile of eligible) expect(Math.max(Math.abs(tile.lat0), Math.abs(tile.lat1))).toBeLessThanOrEqual((90 - DEFAULT_MATRIX.poleMarginDeg) * DEG + 1e-9);
    expect(eligible.length).toBeLessThan(tiles.length);
  });
});

describe('where the files go', () => {
  const items = ['alpha', 'bravo', 'charlie'].flatMap((project) => [0, 1, 2, 3, 4].map((n) => item(project, n)));

  it('one file to a tile, and the same answer every time', () => {
    const { placed, unplaced } = placeItems(items, tiles);
    expect(unplaced).toHaveLength(0);
    expect(new Set(placed.map((p) => p.tile)).size).toBe(items.length);
    expect(placeItems([...items].reverse(), tiles).placed.map((p) => [p.key, p.tile]).sort()).toEqual(placed.map((p) => [p.key, p.tile]).sort());
  });

  it('keeps a project together as a region of the globe', () => {
    const { placed } = placeItems(items, tiles);
    const mean = (pairs: [number, number][]): number => pairs.reduce((sum, [a, b]) => sum + angularDistance(placed[a]!, placed[b]!), 0) / pairs.length;
    const within: [number, number][] = [];
    const across: [number, number][] = [];
    placed.forEach((a, i) => placed.forEach((b, j) => { if (i < j) (a.boardId === b.boardId ? within : across).push([i, j]); }));
    expect(mean(within)).toBeLessThan(mean(across));
  });

  it('says which files did not fit rather than stacking them', () => {
    const many = Array.from({ length: 400 }, (_, n) => item('alpha', n));
    const { placed, unplaced } = placeItems(many, tiles);
    expect(placed).toHaveLength(eligibleTiles(tiles).length);
    expect(unplaced).toHaveLength(400 - placed.length);
  });

  it('floats a file higher the more it is visited, and never off the scale', () => {
    expect(hoverHeight(0, 50)).toBe(DEFAULT_MATRIX.hoverMin);
    expect(hoverHeight(50, 50)).toBeCloseTo(DEFAULT_MATRIX.hoverMax, 9);
    expect(hoverHeight(5, 50)).toBeGreaterThan(hoverHeight(1, 50));
    expect(hoverHeight(500, 50)).toBeCloseTo(DEFAULT_MATRIX.hoverMax, 9);
    const { placed } = placeItems([item('alpha', 0, 0), item('alpha', 1, 9)], tiles);
    const [cold, hot] = [placed.find((p) => p.visits === 0)!, placed.find((p) => p.visits === 9)!];
    expect(hot.height).toBeGreaterThan(cold.height);
  });

  it('takes only documents, artifacts and links, and counts their visits', () => {
    const node = (id: string, kind: BoardNode['kind'], extra: Partial<BoardNode> = {}): BoardNode => ({ id, kind, name: id, ...extra }) as unknown as BoardNode;
    const boards = [{ id: 'root', name: 'SKYNET', engraving: 'SKYNET', nodes: [
      node('doc', 'file.document', { path: 'C:/dev/a.md' }),
      node('link', 'link.url', { url: 'https://example.com' }),
      node('art', 'file.artifact', { path: 'C:/dev/out.pdf' }),
      node('agent', 'agent.code'),
      node('folder', 'store.folder'),
      node('todo', 'file.document', { provisional: true })
    ] }];
    const found = itemsOf(boards, { 'root/doc': 4 });
    expect(found.map((f) => f.nodeId).sort()).toEqual(['art', 'doc', 'link']);
    expect(found.find((f) => f.nodeId === 'doc')!.visits).toBe(4);
    expect(found.find((f) => f.nodeId === 'link')!.target).toBe('https://example.com');
  });
});

describe('looking at the globe', () => {
  it('turns the chosen point to face the camera, with east to the right and north up', () => {
    const o = { lat: 20 * DEG, lon: -70 * DEG };
    const front = toView(pointOn(o.lat, o.lon), o);
    expect(front[0]).toBeCloseTo(0, 9);
    expect(front[1]).toBeCloseTo(0, 9);
    expect(front[2]).toBeCloseTo(1, 9);
    expect(toView(pointOn(o.lat, o.lon + 5 * DEG), o)[0]).toBeGreaterThan(0);
    expect(toView(pointOn(o.lat + 5 * DEG, o.lon), o)[1]).toBeGreaterThan(0);
  });

  it('a drag carries the surface under the pointer along with it', () => {
    const view = { width: 640, height: 360 };
    const camera = dollyCamera(0, view, 1.1);
    const centre = { x: 320, y: 180 };
    const o = { lat: 10 * DEG, lon: 30 * DEG };
    const moved = dragBy(o, 12, -7, camera);
    const at = project(toView(pointOn(o.lat, o.lon), moved), camera, centre)!;
    expect(at.x - centre.x).toBeCloseTo(12, 0);
    expect(at.y - centre.y).toBeCloseTo(-7, 0);
  });

  it('never tilts past the limit, and wraps round the back', () => {
    const camera = dollyCamera(0, { width: 640, height: 360 }, 1.1);
    expect(dragBy({ lat: 0, lon: 0 }, 0, 100000, camera).lat).toBeCloseTo(DEFAULT_MATRIX.maxTiltDeg * DEG, 9);
    expect(wrapLon(3 * Math.PI)).toBeCloseTo(-Math.PI, 9);
    expect(wrapLon(-0.5)).toBeCloseTo(-0.5, 9);
  });
});

describe('the keys and the snap', () => {
  const at = (key: string, latDeg: number, lonDeg: number) => ({ key, lat: latDeg * DEG, lon: lonDeg * DEG });
  const placed = [at('here', 0, 0), at('east', 2, 15), at('north', 15, -1), at('far-east', 0, 60), at('back', 0, -150)];

  it('moves to the next file in each direction, and nowhere when there is none', () => {
    const from = { ...placed[0]!, key: 'here' };
    expect(neighbourOf(from, 'east', placed)?.key).toBe('east');
    expect(neighbourOf(from, 'north', placed)?.key).toBe('north');
    expect(neighbourOf(from, 'south', placed)).toBeNull();
    expect(neighbourOf(from, 'west', placed)?.key).toBe('back');
  });

  it('crosses the date line the short way', () => {
    expect(neighbourOf({ key: 'back', lat: 0, lon: 179 * DEG }, 'east', [at('over', 0, -170)])?.key).toBe('over');
  });

  it('snaps to the nearest file', () => {
    expect(nearestItem({ lat: 5 * DEG, lon: 12 * DEG }, placed)?.key).toBe('east');
  });
});

describe('a released spin', () => {
  it('keeps turning, slows, and settles', () => {
    let spin: Spin = { lat: 0, lon: 0, vLat: 0, vLon: 4 };
    let t = 0;
    while (spinSpeed(spin) >= DEFAULT_MATRIX.settleBelow && t < 10000) {
      spin = spinStep(spin, 16, DEFAULT_MATRIX);
      t += 16;
    }
    expect(t).toBeGreaterThan(500);
    expect(t).toBeLessThan(5000);
  });

  it('stops tilting at the limit', () => {
    const spin = spinStep({ lat: 59 * DEG, lon: 0, vLat: 5, vLon: 0 }, 100);
    expect(spin.lat).toBeCloseTo(DEFAULT_MATRIX.maxTiltDeg * DEG, 9);
    expect(spin.vLat).toBe(0);
  });

  it('is thrown by a moving release, and not by one that stopped first', () => {
    const samples = [0, 20, 40, 60].map((at) => ({ at, lat: 0, lon: at * 0.002 }));
    expect(releaseVelocity(samples, 70).vLon).toBeCloseTo(2, 5);
    expect(releaseVelocity(samples, 300)).toEqual({ vLat: 0, vLon: 0 });
  });
});

describe('the dolly zoom', () => {
  const view = { width: 640, height: 360 };
  const cardRadius = 1 + DEFAULT_MATRIX.hoverMax;

  it('shows the whole globe at rest', () => {
    const camera = dollyCamera(0, view, cardRadius);
    const silhouette = camera.focal / Math.sqrt(camera.distance ** 2 - 1);
    expect(silhouette).toBeLessThan(view.height / 2);
    expect(camera.distance).toBeCloseTo(DEFAULT_MATRIX.restDistance, 9);
  });

  it('fills the screen with the card when fully in', () => {
    const camera = dollyCamera(1, view, cardRadius);
    expect(cardHalfOnScreen(camera, cardRadius)).toBeGreaterThanOrEqual(view.width / 2);
    expect(camera.distance).toBeGreaterThan(cardRadius);
  });

  it('grows the card and lengthens the lens steadily in both directions', () => {
    let lastHalf = 0;
    let lastFov = Infinity;
    for (let z = 0; z <= 1.0001; z += 0.05) {
      const camera = dollyCamera(z, view, cardRadius);
      const half = cardHalfOnScreen(camera, cardRadius);
      expect(half).toBeGreaterThan(lastHalf);
      expect(camera.fovDeg).toBeLessThanOrEqual(lastFov);
      lastHalf = half;
      lastFov = camera.fovDeg;
    }
  });
});

describe('the visit log', () => {
  it('counts every open and remembers the last', () => {
    let log = recordVisit({}, 'root/doc', new Date('2026-09-12T10:00:00Z'));
    log = recordVisit(log, 'root/doc', new Date('2026-09-12T11:00:00Z'));
    expect(log['root/doc']).toEqual({ count: 2, last: '2026-09-12T11:00:00.000Z' });
    expect(visitCounts({ ...log, bad: { count: Number.NaN, last: '' } })).toEqual({ 'root/doc': 2 });
  });
});
