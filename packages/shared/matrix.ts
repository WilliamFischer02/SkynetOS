/**
 * THE MATRIX: William's projects as a globe of tiles, each project's end product hovering over its own tile.
 *
 * William, 2026-09-12: "a globe made up of tiles, a hidden interface … a representation of my projects
 * specifically; agents, folder explorers, and other ui elements don't exist; just link nodes and document
 * nodes … all placed as a hovering tile, locked to a point on the globe but hovering / floating out from the
 * globe, tethered by a wire … rotated by clicking and dragging the screen, with wasd and arrow keys, and
 * always snaps … exclude a margin of the poles … zooming all the way into a tile stretches it flat until it
 * fills the screen … zoom + increase focal length … releasing the globe while it's moving should spin it …
 * a slight height from globe surface modifier … based on how much that file is visited."
 *
 * This file is the geometry and nothing else: the grid, where each file sits and how high it floats, which
 * way is north from a tile, how a released spin dies away, and the dolly zoom. It is pure, so all of that
 * is tested without a screen. src/renderer/matrix/MatrixView.tsx draws it.
 *
 * Conventions. The globe has radius 1. A point is [x, y, z] with y towards the north pole. The camera sits
 * on +z looking at the centre; screen x is view x, screen y is minus view y. An `Orientation` names the
 * point of the globe at the middle of the view.
 */

import type { Board, NodeKind } from './types.js';

export type Vec3 = [number, number, number];

export const DEG = Math.PI / 180;

/** The kinds that are a project's end product — a document, an artifact, a link — and the only kinds shown. */
export const MATRIX_KINDS: readonly NodeKind[] = ['file.document', 'file.artifact', 'link.url'];

export interface MatrixConfig {
  /** Latitude bands from pole to pole. */
  bands: number;
  /** Tiles around the equator. Bands nearer a pole have fewer, in proportion, so the tiles stay nearly square. */
  equator: number;
  /** No file sits on a tile reaching within this many degrees of a pole, where tiles squeeze towards a point. */
  poleMarginDeg: number;
  /** How high a file floats above its tile, in globe radii: never visited, and the most visited. */
  hoverMin: number;
  hoverMax: number;
  /** Half the width of a hovering card, in globe radii. */
  cardHalf: number;
  /** The camera at rest: distance from the centre in radii, and vertical field of view. */
  restDistance: number;
  restFovDeg: number;
  /** Fully zoomed in: the field of view the camera narrows to. The narrower, the flatter the card looks. */
  flatFovDeg: number;
  /** How quickly a released spin dies away, and the speed, radians a second, below which it settles. */
  spinTauMs: number;
  settleBelow: number;
  /** How far the view may tilt north or south. */
  maxTiltDeg: number;
}

export const DEFAULT_MATRIX: MatrixConfig = {
  bands: 12,
  equator: 24,
  poleMarginDeg: 30,
  hoverMin: 0.06,
  hoverMax: 0.3,
  cardHalf: 0.085,
  restDistance: 3.3,
  restFovDeg: 46,
  flatFovDeg: 6,
  spinTauMs: 900,
  settleBelow: 0.35,
  maxTiltDeg: 60
};

const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));

/** A longitude brought into [−π, π). */
export function wrapLon(lon: number): number {
  const turned = (lon + Math.PI) % (2 * Math.PI);
  return (turned < 0 ? turned + 2 * Math.PI : turned) - Math.PI;
}

export function pointOn(lat: number, lon: number, radius = 1): Vec3 {
  const c = Math.cos(lat);
  return [radius * c * Math.sin(lon), radius * Math.sin(lat), radius * c * Math.cos(lon)];
}

/** Great-circle distance between two points of the globe, in radians. */
export function angularDistance(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = b.lat - a.lat;
  const dLon = wrapLon(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat) * Math.cos(b.lat) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ── the grid ─────────────────────────────────────────────────────────────────────────────────

export interface GlobeTile {
  index: number;
  band: number;
  lat0: number;
  lat1: number;
  /** West and east edges. `lon1` may pass π; the centre `lon` is wrapped. */
  lon0: number;
  lon1: number;
  lat: number;
  lon: number;
}

/**
 * An even grid of tiles: equal latitude bands, each cut into as many tiles as keeps them close to square.
 * Every tile covers close to the same area, which is what "an even grid" has to mean on a sphere.
 */
export function globeGrid(config: Pick<MatrixConfig, 'bands' | 'equator'> = DEFAULT_MATRIX): GlobeTile[] {
  const tiles: GlobeTile[] = [];
  const height = Math.PI / config.bands;
  for (let band = 0; band < config.bands; band++) {
    const lat0 = -Math.PI / 2 + band * height;
    const lat1 = lat0 + height;
    const lat = (lat0 + lat1) / 2;
    const count = Math.max(3, Math.round(config.equator * Math.cos(lat)));
    const width = (2 * Math.PI) / count;
    for (let i = 0; i < count; i++) {
      const lon0 = -Math.PI + i * width;
      tiles.push({ index: tiles.length, band, lat0, lat1, lon0, lon1: lon0 + width, lat, lon: wrapLon(lon0 + width / 2) });
    }
  }
  return tiles;
}

/** The tiles a file may sit on: none reaching into the pole margin. */
export function eligibleTiles(tiles: readonly GlobeTile[], config: Pick<MatrixConfig, 'poleMarginDeg'> = DEFAULT_MATRIX): GlobeTile[] {
  const limit = Math.PI / 2 - config.poleMarginDeg * DEG + 1e-9;
  return tiles.filter((tile) => Math.max(Math.abs(tile.lat0), Math.abs(tile.lat1)) <= limit);
}

// ── the files ────────────────────────────────────────────────────────────────────────────────

export interface MatrixItem {
  /** `boardId/nodeId`: the same key the visit log uses. */
  key: string;
  boardId: string;
  nodeId: string;
  /** The room it lives in, by its engraving. */
  project: string;
  name: string;
  kind: NodeKind;
  /** The path or URL, for the label. */
  target: string;
  visits: number;
}

export interface PlacedItem extends MatrixItem {
  tile: number;
  lat: number;
  lon: number;
  /** Hover height above the surface, in radii. */
  height: number;
}

export const visitKey = (boardId: string, nodeId: string): string => `${boardId}/${nodeId}`;

/** Every end product on every board given, with its visit count. Unpopulated (provisional) nodes are left out. */
export function itemsOf(boards: readonly Pick<Board, 'id' | 'name' | 'engraving' | 'nodes'>[], visits: Readonly<Record<string, number>>): MatrixItem[] {
  const items: MatrixItem[] = [];
  for (const board of boards) {
    for (const node of board.nodes) {
      if (!MATRIX_KINDS.includes(node.kind) || node.provisional) continue;
      const key = visitKey(board.id, node.id);
      items.push({
        key,
        boardId: board.id,
        nodeId: node.id,
        project: board.engraving ?? board.name,
        name: node.designator ? `${node.designator} ${node.name}` : node.name,
        kind: node.kind,
        target: node.path ?? node.url ?? '',
        visits: Math.max(0, visits[key] ?? 0)
      });
    }
  }
  return items;
}

/** FNV-1a: a stable number from a string, so a project lands on the same part of the globe every time. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * How high a file floats: logarithmic in its visits, relative to the most visited, so one file opened a
 * hundred times does not flatten every other difference into the surface.
 */
export function hoverHeight(visits: number, maxVisits: number, config: Pick<MatrixConfig, 'hoverMin' | 'hoverMax'> = DEFAULT_MATRIX): number {
  const t = Math.log1p(Math.max(0, visits)) / Math.log1p(Math.max(1, maxVisits));
  return config.hoverMin + (config.hoverMax - config.hoverMin) * clamp(t, 0, 1);
}

/**
 * Put every file on a tile of its own. Each project is seeded at a tile chosen by its id, and its files fill
 * the nearest free tiles outward from there, so a project reads as a region of the globe. Files that do not
 * fit are returned as `unplaced` rather than stacked, so the view can say so.
 */
export function placeItems(
  items: readonly MatrixItem[],
  tiles: readonly GlobeTile[],
  config: MatrixConfig = DEFAULT_MATRIX
): { placed: PlacedItem[]; unplaced: MatrixItem[] } {
  const eligible = eligibleTiles(tiles, config);
  const free = new Set(eligible.map((tile) => tile.index));
  const maxVisits = items.reduce((most, item) => Math.max(most, item.visits), 1);
  const byProject = new Map<string, MatrixItem[]>();
  const sorted = [...items].sort((a, b) => (a.boardId < b.boardId ? -1 : a.boardId > b.boardId ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : a.key < b.key ? -1 : 1));
  for (const item of sorted) {
    const group = byProject.get(item.boardId);
    if (group) group.push(item);
    else byProject.set(item.boardId, [item]);
  }
  const placed: PlacedItem[] = [];
  const unplaced: MatrixItem[] = [];
  for (const [boardId, group] of byProject) {
    if (!eligible.length) {
      unplaced.push(...group);
      continue;
    }
    const seed = eligible[hashString(boardId) % eligible.length]!;
    const order = eligible
      .filter((tile) => free.has(tile.index))
      .sort((a, b) => angularDistance(a, seed) - angularDistance(b, seed) || a.index - b.index);
    group.forEach((item, i) => {
      const tile = order[i];
      if (!tile) {
        unplaced.push(item);
        return;
      }
      free.delete(tile.index);
      placed.push({ ...item, tile: tile.index, lat: tile.lat, lon: tile.lon, height: hoverHeight(item.visits, maxVisits, config) });
    });
  }
  return { placed, unplaced };
}

// ── looking at it ────────────────────────────────────────────────────────────────────────────

export interface Orientation {
  lat: number;
  lon: number;
}

/** Turn a point of the globe into view space, so that `o` faces the camera. */
export function toView(p: Vec3, o: Orientation): Vec3 {
  // About y by −lon, which brings that longitude to the front…
  const cy = Math.cos(-o.lon);
  const sy = Math.sin(-o.lon);
  const x1 = p[0] * cy + p[2] * sy;
  const z1 = -p[0] * sy + p[2] * cy;
  // …then about x by lat, which brings that latitude to the middle.
  const cx = Math.cos(o.lat);
  const sx = Math.sin(o.lat);
  return [x1, p[1] * cx - z1 * sx, p[1] * sx + z1 * cx];
}

export interface MatrixCamera {
  /** From the globe's centre, in radii. */
  distance: number;
  /** In pixels of the image being drawn. */
  focal: number;
  fovDeg: number;
}

export function project(v: Vec3, camera: Pick<MatrixCamera, 'distance' | 'focal'>, centre: { x: number; y: number }): { x: number; y: number; depth: number } | null {
  const depth = camera.distance - v[2];
  if (depth <= 1e-3) return null;
  return { x: centre.x + (camera.focal * v[0]) / depth, y: centre.y - (camera.focal * v[1]) / depth, depth };
}

/** Whether the surface at this view-space normal, at this radius, faces a camera at `distance`. */
export function facesCamera(normal: Vec3, distance: number, radius = 1): boolean {
  return normal[2] * distance > radius;
}

export function clampOrientation(o: Orientation, config: Pick<MatrixConfig, 'maxTiltDeg'> = DEFAULT_MATRIX): Orientation {
  const max = config.maxTiltDeg * DEG;
  return { lat: clamp(o.lat, -max, max), lon: wrapLon(o.lon) };
}

/**
 * Drag the globe by a movement of the pointer, in image pixels. The surface under the pointer follows it:
 * dragging right turns the globe east-to-west under the camera, so the middle of the view moves west.
 */
export function dragBy(o: Orientation, dx: number, dy: number, camera: Pick<MatrixCamera, 'distance' | 'focal'>, config: Pick<MatrixConfig, 'maxTiltDeg'> = DEFAULT_MATRIX): Orientation {
  const k = (camera.distance - 1) / camera.focal;
  return clampOrientation({ lat: o.lat + dy * k, lon: o.lon - dx * k }, config);
}

/** The placed file nearest the middle of the view. */
export function nearestItem<T extends { lat: number; lon: number }>(o: Orientation, placed: readonly T[]): T | null {
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const item of placed) {
    const d = angularDistance(o, item);
    if (d < bestDistance) {
      bestDistance = d;
      best = item;
    }
  }
  return best;
}

export type Heading = 'north' | 'south' | 'east' | 'west';

/**
 * The next file in a direction, for the keys: the nearest one that lies within about sixty degrees of that
 * heading on the surface. Null when there is none, so a key at the edge of the files does nothing rather
 * than jumping somewhere unexpected.
 */
export function neighbourOf<T extends { key: string; lat: number; lon: number }>(from: Orientation & { key?: string }, heading: Heading, placed: readonly T[]): T | null {
  let best: T | null = null;
  let bestScore = Infinity;
  for (const item of placed) {
    if (from.key !== undefined && item.key === from.key) continue;
    const east = wrapLon(item.lon - from.lon) * Math.cos((item.lat + from.lat) / 2);
    const north = item.lat - from.lat;
    const along = heading === 'north' ? north : heading === 'south' ? -north : heading === 'east' ? east : -east;
    const across = heading === 'north' || heading === 'south' ? east : north;
    if (along <= 1e-6 || Math.abs(across) > along * 1.8) continue;
    const score = Math.hypot(along, across * 2);
    if (score < bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}

// ── the spin ─────────────────────────────────────────────────────────────────────────────────

export interface Spin extends Orientation {
  /** Radians a second. */
  vLat: number;
  vLon: number;
}

/** The speed of the surface at the middle of the view, radians a second. */
export function spinSpeed(spin: Spin): number {
  return Math.hypot(spin.vLat, spin.vLon * Math.cos(spin.lat));
}

/** One step of a released globe: it keeps turning and slows, and stops tilting at the tilt limit. */
export function spinStep(spin: Spin, dtMs: number, config: Pick<MatrixConfig, 'spinTauMs' | 'maxTiltDeg'> = DEFAULT_MATRIX): Spin {
  const dt = dtMs / 1000;
  const decay = Math.exp(-dtMs / config.spinTauMs);
  const rawLat = spin.lat + spin.vLat * dt;
  const next = clampOrientation({ lat: rawLat, lon: spin.lon + spin.vLon * dt }, config);
  return { ...next, vLat: next.lat === rawLat ? spin.vLat * decay : 0, vLon: spin.vLon * decay };
}

/**
 * How fast the globe was moving when it was let go, from the last moments of the drag. A pointer held still
 * before release gives no spin: letting go of a globe you have stopped does not throw it.
 */
export function releaseVelocity(samples: readonly { at: number; lat: number; lon: number }[], releasedAt: number, windowMs = 90): { vLat: number; vLon: number } {
  const last = samples.at(-1);
  if (!last || releasedAt - last.at > 80) return { vLat: 0, vLon: 0 };
  const first = samples.find((sample) => sample.at >= last.at - windowMs) ?? last;
  const dt = (last.at - first.at) / 1000;
  if (dt <= 0) return { vLat: 0, vLon: 0 };
  return { vLat: (last.lat - first.lat) / dt, vLon: wrapLon(last.lon - first.lon) / dt };
}

/** Ease towards a target orientation, the short way round. */
export function approach(o: Orientation, target: Orientation, dtMs: number, tauMs = 140): Orientation {
  const k = 1 - Math.exp(-dtMs / tauMs);
  return { lat: o.lat + (target.lat - o.lat) * k, lon: wrapLon(o.lon + wrapLon(target.lon - o.lon) * k) };
}

// ── the dolly zoom ───────────────────────────────────────────────────────────────────────────

/**
 * The camera at a zoom from 0 (the whole globe) to 1 (the middle card filling the screen).
 *
 * A dolly zoom: the field of view narrows — a longer lens, which flattens perspective — while the distance is
 * chosen so the middle card grows at an even pace on screen, geometrically from its size at rest to one that
 * covers the view. At 1 the lens is so long the card is effectively flat. Zooming out is the same function
 * run backwards, so it is exactly the reverse.
 */
export function dollyCamera(zoom: number, view: { width: number; height: number }, cardRadius: number, config: MatrixConfig = DEFAULT_MATRIX): MatrixCamera {
  const z = clamp(zoom, 0, 1);
  const e = z * z * (3 - 2 * z);
  const fovDeg = config.restFovDeg + (config.flatFovDeg - config.restFovDeg) * e;
  const focal = view.height / 2 / Math.tan((fovDeg * DEG) / 2);
  const restFocal = view.height / 2 / Math.tan((config.restFovDeg * DEG) / 2);
  const restHalf = (restFocal * config.cardHalf) / (config.restDistance - cardRadius);
  const fullHalf = (Math.max(view.width, view.height) / 2) * 1.04;
  const half = restHalf * Math.pow(fullHalf / restHalf, e);
  return { distance: cardRadius + (focal * config.cardHalf) / half, focal, fovDeg };
}

/** The half-size on screen, in pixels, of a card facing the camera at `cardRadius`. */
export function cardHalfOnScreen(camera: MatrixCamera, cardRadius: number, config: Pick<MatrixConfig, 'cardHalf'> = DEFAULT_MATRIX): number {
  return (camera.focal * config.cardHalf) / (camera.distance - cardRadius);
}

// ── visits ───────────────────────────────────────────────────────────────────────────────────

export type VisitLog = Record<string, { count: number; last: string }>;

export function recordVisit(log: Readonly<VisitLog>, key: string, at: Date): VisitLog {
  return { ...log, [key]: { count: (log[key]?.count ?? 0) + 1, last: at.toISOString() } };
}

export function visitCounts(log: Readonly<VisitLog>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [key, entry] of Object.entries(log)) {
    if (entry && Number.isFinite(entry.count)) counts[key] = Math.max(0, Math.floor(entry.count));
  }
  return counts;
}
