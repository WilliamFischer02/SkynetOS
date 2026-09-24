import { useEffect, useRef, useState } from 'react';
import { SILK } from '@shared/palette.js';
import {
  DEFAULT_MATRIX,
  DEG,
  angularDistance,
  approach,
  clampOrientation,
  dollyCamera,
  dragBy,
  facesCamera,
  globeGrid,
  itemsOf,
  nearestItem,
  neighbourOf,
  placeItems,
  pointOn,
  project,
  releaseVelocity,
  spinSpeed,
  spinStep,
  toView,
  type GlobeTile,
  type Heading,
  type MatrixCamera,
  type MatrixItem,
  type Orientation,
  type PlacedItem,
  type Spin,
  type Vec3
} from '@shared/matrix.js';
import type { BoardTheme, NodeKind } from '@shared/types.js';
import { iconRows, type IconName } from '../ui/Icon.js';
import { useBoardStore } from '../store/useBoardStore.js';

/**
 * THE MATRIX, drawn: a holographic globe of tiles in the room's own colours, with every document, artifact
 * and link from every board hovering over a tile of its own. The geometry is packages/shared/matrix.ts.
 *
 * Drawn by a small software rasteriser into a low-resolution buffer, then shown at a whole-number scale with
 * nearest-neighbour sampling. That is how it stays inside docs/02's anti-mush rules while being 3D: Canvas2D's
 * own polygons antialias their edges, which would put colours on screen that are in no palette. Here every
 * pixel written is one of the room's exact colours — mask-dark, mask-light, signal, silk — and shading is an
 * ordered 4×4 dither, never a blend.
 *
 * Input is the board's input: a drag turns it, a wheel zooms it, keys move tile to tile. Manual control
 * drives the same events (ui/useGesture.ts targets this canvas while it is open), so gestures work here too.
 */

/** Roughly how many rows of MATRIX pixels the screen holds. Few, on purpose: it is a low-resolution world. */
const TARGET_ROWS = 280;
const ZOOM_STEP = 0.25;
const TILES: GlobeTile[] = globeGrid();

const ICON_FOR: Partial<Record<NodeKind, IconName>> = { 'file.document': 'text', 'file.artifact': 'gem', 'link.url': 'open' };
const KIND_WORDS: Partial<Record<NodeKind, string>> = { 'file.document': 'DOCUMENT', 'file.artifact': 'ARTIFACT', 'link.url': 'LINK' };
const visitsText = (n: number): string => (n === 0 ? 'NEVER OPENED HERE' : `OPENED ${n} TIME${n === 1 ? '' : 'S'}`);

/** Each tile as a ring of points on the unit sphere: its south edge west to east, then its north edge back. */
const SHAPES = TILES.map((tile) => {
  const segments = Math.max(2, Math.ceil((tile.lon1 - tile.lon0) / (7.5 * DEG)));
  const south: Vec3[] = [];
  const north: Vec3[] = [];
  for (let k = 0; k <= segments; k++) {
    const lon = tile.lon0 + ((tile.lon1 - tile.lon0) * k) / segments;
    south.push(pointOn(tile.lat0, lon));
    north.push(pointOn(tile.lat1, lon));
  }
  return { tile, segments, ring: [...south, ...north.reverse()], centre: pointOn(tile.lat, tile.lon) };
});

// ── pixels ───────────────────────────────────────────────────────────────────────────────────

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** Whether this pixel is lit at this density, 0 to 1, by the ordered dither. */
const lit = (x: number, y: number, level: number): boolean => level * 16 > BAYER[((y & 3) << 2) | (x & 3)]!;

/** A #rrggbb as the 32-bit little-endian pixel ImageData stores. */
function pixelOf(hex: string): number {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}

interface Colours {
  ground: number;
  shade: number;
  signal: number;
  bright: number;
}

const coloursOf = (theme: BoardTheme | undefined): Colours => ({
  ground: pixelOf(theme?.maskDark ?? '#0e1a14'),
  shade: pixelOf(theme?.maskLight ?? '#16261d'),
  signal: pixelOf(theme?.signal ?? '#7fe0b0'),
  bright: pixelOf(SILK)
});

type Point = { x: number; y: number };

class Frame {
  readonly image: ImageData;
  readonly data: Uint32Array;

  constructor(readonly width: number, readonly height: number) {
    this.image = new ImageData(width, height);
    this.data = new Uint32Array(this.image.data.buffer);
  }

  clear(colour: number): void {
    this.data.fill(colour);
  }

  set(x: number, y: number, colour: number): void {
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) this.data[y * this.width + x] = colour;
  }

  /** Bresenham, optionally dithered to a density. */
  line(x0: number, y0: number, x1: number, y1: number, colour: number, level = 1): void {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const xe = Math.round(x1);
    const ye = Math.round(y1);
    if (Math.max(Math.abs(x), Math.abs(y), Math.abs(xe), Math.abs(ye)) > 20000) return;
    const dx = Math.abs(xe - x);
    const dy = -Math.abs(ye - y);
    const sx = x < xe ? 1 : -1;
    const sy = y < ye ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 40000; guard++) {
      if (level >= 1 || lit(x, y, level)) this.set(x, y, colour);
      if (x === xe && y === ye) return;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /** A convex polygon by scanlines. `paint` returns the colour for a pixel, or 0 to leave it as it is. */
  polygon(points: readonly Point[], paint: (x: number, y: number) => number): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const top = Math.max(0, Math.ceil(minY - 0.5));
    const bottom = Math.min(this.height - 1, Math.floor(maxY - 0.5));
    for (let y = top; y <= bottom; y++) {
      const yc = y + 0.5;
      let left = Infinity;
      let right = -Infinity;
      for (let i = 0; i < points.length; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % points.length]!;
        if ((a.y <= yc && b.y > yc) || (b.y <= yc && a.y > yc)) {
          const x = a.x + ((yc - a.y) * (b.x - a.x)) / (b.y - a.y);
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
      }
      if (left > right) continue;
      const from = Math.max(0, Math.ceil(left - 0.5));
      const to = Math.min(this.width - 1, Math.floor(right - 0.5));
      const row = y * this.width;
      for (let x = from; x <= to; x++) {
        const colour = paint(x, y);
        if (colour !== 0) this.data[row + x] = colour;
      }
    }
  }

  /** The midpoint circle. */
  circle(cx: number, cy: number, r: number, colour: number): void {
    if (!(r > 0) || r > 8192) return;
    const x0 = Math.round(cx);
    const y0 = Math.round(cy);
    let x = Math.round(r);
    let y = 0;
    let err = 1 - x;
    while (x >= y) {
      this.set(x0 + x, y0 + y, colour);
      this.set(x0 + y, y0 + x, colour);
      this.set(x0 - y, y0 + x, colour);
      this.set(x0 - x, y0 + y, colour);
      this.set(x0 - x, y0 - y, colour);
      this.set(x0 - y, y0 - x, colour);
      this.set(x0 + y, y0 - x, colour);
      this.set(x0 + x, y0 - y, colour);
      y++;
      if (err < 0) err += 2 * y + 1;
      else {
        x--;
        err += 2 * (y - x) + 1;
      }
    }
  }

  /** A 9×9 icon bitmap (Icon.tsx), at a whole-number scale. */
  glyph(rows: readonly string[], left: number, top: number, scale: number, colour: number): void {
    rows.forEach((row, gy) => {
      for (let gx = 0; gx < row.length; gx++) {
        if (row[gx] !== '#') continue;
        for (let j = 0; j < scale; j++) for (let i = 0; i < scale; i++) this.set(left + gx * scale + i, top + gy * scale + j, colour);
      }
    });
  }
}

// ── the scene ────────────────────────────────────────────────────────────────────────────────

interface CardHit {
  item: PlacedItem;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  depth: number;
}

interface Scene {
  placed: PlacedItem[];
  orientation: Orientation;
  spin: Spin | null;
  snap: Orientation | null;
  zoom: number;
  zoomTarget: number;
  focusedKey: string | null;
  drag: { x: number; y: number; moved: number; samples: { at: number; lat: number; lon: number }[] } | null;
  hits: CardHit[];
  camera: MatrixCamera | null;
}

function draw(frame: Frame, s: Scene, colours: Colours, now: number, still: boolean): CardHit[] {
  const W = frame.width;
  const H = frame.height;
  const centre = { x: W / 2, y: H / 2 };
  const focused = s.focusedKey ? (s.placed.find((p) => p.key === s.focusedKey) ?? null) : null;
  const camera = dollyCamera(s.zoom, { width: W, height: H }, 1 + (focused?.height ?? DEFAULT_MATRIX.hoverMin));
  s.camera = camera;
  const o = s.orientation;
  const D = camera.distance;

  frame.clear(colours.ground);
  // A dot every six pixels, offset on alternate rows: the screen the hologram is projected onto.
  for (let y = 3; y < H; y += 6) for (let x = (y - 3) % 12 === 0 ? 3 : 0; x < W; x += 6) frame.set(x, y, colours.shade);

  const occupied = new Set(s.placed.map((p) => p.tile));
  const focusTile = focused?.tile ?? -1;
  const scanY = still ? -10 : Math.floor((now / 28) % (H + 60)) - 30;

  const views = SHAPES.map((shape) => shape.ring.map((p) => toView(p, o)));
  const projected = views.map((ring) => ring.map((v) => project(v, camera, centre)));

  /** Whether the middle of an edge is on the near side of the globe. */
  const nearSide = (a: Vec3, b: Vec3): boolean => {
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const mz = (a[2] + b[2]) / 2;
    return (mz / (Math.hypot(mx, my, mz) || 1)) * D > 1;
  };

  /** Each tile draws its south and west edges; its neighbours draw the other two. */
  const strokeEdges = (near: boolean): void => {
    SHAPES.forEach((shape, t) => {
      const ring = views[t]!;
      const points = projected[t]!;
      const pairs: [number, number][] = [];
      for (let k = 0; k < shape.segments; k++) pairs.push([k, k + 1]);
      pairs.push([ring.length - 1, 0]);
      for (const [i, j] of pairs) {
        const a = points[i];
        const b = points[j];
        if (!a || !b || nearSide(ring[i]!, ring[j]!) !== near) continue;
        if (near) frame.line(a.x, a.y, b.x, b.y, colours.signal);
        else frame.line(a.x, a.y, b.x, b.y, colours.shade, 0.5);
      }
    });
  };

  // The far side's grid, faint and broken, seen through the near side: it is a hologram.
  strokeEdges(false);

  // The near side's tiles: denser towards the rim, where a hologram glows, and brighter where a file sits.
  SHAPES.forEach((shape, t) => {
    const normal = toView(shape.centre, o);
    if (normal[2] * D <= 1.02) return;
    const points = projected[t]!;
    if (points.some((p) => !p)) return;
    const rim = 1 - normal[2];
    const base = 0.16 + 0.5 * rim * rim;
    const glow = shape.tile.index === focusTile ? 0.45 : occupied.has(shape.tile.index) ? 0.12 + 0.3 * rim : 0.35 * rim * rim * rim;
    frame.polygon(points as Point[], (x, y) =>
      y === scanY || y === scanY + 1 ? (lit(x, y, 0.5) ? colours.signal : 0) : lit(x, y, glow) ? colours.signal : lit(x, y, base) ? colours.shade : 0
    );
  });

  frame.circle(centre.x, centre.y, camera.focal / Math.sqrt(Math.max(1e-6, D * D - 1)), colours.signal);
  strokeEdges(true);

  // The files: a card over each tile, tethered to it, drawn far to near.
  const half = DEFAULT_MATRIX.cardHalf;
  const cards: { item: PlacedItem; corners: Point[]; base: Point; top: Point & { depth: number } }[] = [];
  for (const item of s.placed) {
    const radius = 1 + item.height;
    const normal = toView(pointOn(item.lat, item.lon), o);
    if (!facesCamera(normal, D, radius)) continue;
    // Seen nearly edge-on at the rim a card is only a sliver of stray lines outside the globe: leave it out.
    const toCamera = Math.hypot(normal[0] * radius, normal[1] * radius, D - normal[2] * radius);
    if ((normal[2] * D - radius) / toCamera < 0.3) continue;
    const c = toView(pointOn(item.lat, item.lon, radius), o);
    const east = toView([Math.cos(item.lon), 0, -Math.sin(item.lon)], o);
    const north = toView([-Math.sin(item.lat) * Math.sin(item.lon), Math.cos(item.lat), -Math.sin(item.lat) * Math.cos(item.lon)], o);
    const corner = (a: number, b: number): Vec3 => [
      c[0] + (east[0] * a + north[0] * b) * half,
      c[1] + (east[1] * a + north[1] * b) * half,
      c[2] + (east[2] * a + north[2] * b) * half
    ];
    const corners = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)].map((v) => project(v, camera, centre));
    const top = project(c, camera, centre);
    const base = project(normal, camera, centre);
    if (!top || !base || corners.some((p) => !p)) continue;
    cards.push({ item, corners: corners as Point[], base, top });
  }
  cards.sort((a, b) => b.top.depth - a.top.depth);

  const hits: CardHit[] = [];
  for (const { item, corners, base, top } of cards) {
    const isFocus = item.key === s.focusedKey;
    const edge = isFocus ? colours.bright : colours.signal;
    // The tether, and a faint pyramid of wire from the tile to the card's corners: the spike it floats on.
    for (const corner of corners) frame.line(base.x, base.y, corner.x, corner.y, colours.shade, 0.5);
    frame.line(base.x, base.y, top.x, top.y, colours.signal);
    frame.set(Math.round(base.x), Math.round(base.y), colours.bright);
    frame.polygon(corners, () => colours.ground);
    for (let i = 0; i < 4; i++) {
      const a = corners[i]!;
      const b = corners[(i + 1) % 4]!;
      frame.line(a.x, a.y, b.x, b.y, edge);
    }
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const scale = Math.min(Math.floor((Math.min(maxX - minX, maxY - minY) - 4) / 11), Math.floor((Math.min(W, H) * 0.3) / 9));
    if (scale >= 1) frame.glyph(iconRows(ICON_FOR[item.kind] ?? 'text'), Math.round(top.x - 4.5 * scale), Math.round(top.y - 4.5 * scale), scale, edge);
    else frame.set(Math.round(top.x), Math.round(top.y), edge);
    hits.push({ item, minX: minX - 2, minY: minY - 2, maxX: maxX + 2, maxY: maxY + 2, depth: top.depth });
  }
  return hits;
}

function hitTest(hits: readonly CardHit[], at: Point): CardHit | null {
  let best: CardHit | null = null;
  for (const hit of hits) {
    if (at.x < hit.minX || at.x > hit.maxX || at.y < hit.minY || at.y > hit.maxY) continue;
    if (!best || hit.depth < best.depth) best = hit;
  }
  return best;
}

const asItem = (p: PlacedItem): MatrixItem => ({
  key: p.key,
  boardId: p.boardId,
  nodeId: p.nodeId,
  project: p.project,
  name: p.name,
  kind: p.kind,
  target: p.target,
  visits: p.visits
});

// ── the view ─────────────────────────────────────────────────────────────────────────────────

export function MatrixView({ onClose }: { onClose: () => void }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useBoardStore((s) => s.board?.theme);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [error, setError] = useState('');
  const [counts, setCounts] = useState({ files: 0, projects: 0, unplaced: 0 });
  const [focused, setFocused] = useState<PlacedItem | null>(null);
  const [zoomedIn, setZoomedIn] = useState(false);
  const [dragging, setDragging] = useState(false);

  const scene = useRef<Scene>({
    placed: [],
    orientation: { lat: 15 * DEG, lon: 0 },
    spin: null,
    snap: null,
    zoom: 0,
    zoomTarget: 0,
    focusedKey: null,
    drag: null,
    hits: [],
    camera: null
  });
  const colours = useRef<Colours>(coloursOf(theme));
  colours.current = coloursOf(theme);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Every board, read once on opening. Nothing here writes to a board.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const ids = await window.skynet['board:list']();
        const loads = await Promise.all(ids.map((id) => window.skynet['board:load'](id).catch(() => null)));
        const boards = loads.flatMap((load) => (load && load.ok ? [load.board] : []));
        let visits: Record<string, number> = {};
        try {
          visits = await window.skynet['node:visits']();
        } catch {
          // A remote screen has no visit log: every file floats at the same height, which is still true.
        }
        if (cancelled) return;
        const { placed, unplaced } = placeItems(itemsOf(boards, visits), TILES);
        const s = scene.current;
        s.placed = placed;
        const start = [...placed].sort((a, b) => b.visits - a.visits || a.key.localeCompare(b.key))[0] ?? null;
        if (start) {
          s.orientation = { lat: start.lat, lon: start.lon };
          s.focusedKey = start.key;
          setFocused(start);
        }
        setCounts({ files: placed.length, projects: new Set(placed.map((p) => p.boardId)).size, unplaced: unplaced.length });
        setStatus(placed.length ? 'ready' : 'empty');
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message);
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!host || !canvas || !context) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    (document.activeElement as HTMLElement | null)?.blur?.();
    host.focus({ preventScroll: true });

    let frame: Frame | null = null;
    let pixel = 4;
    let ratio = 1;
    const resize = (): void => {
      ratio = window.devicePixelRatio || 1;
      const deviceWidth = Math.round(host.clientWidth * ratio);
      const deviceHeight = Math.round(host.clientHeight * ratio);
      pixel = Math.max(2, Math.round(deviceHeight / TARGET_ROWS));
      const width = Math.max(16, Math.ceil(deviceWidth / pixel));
      const height = Math.max(16, Math.ceil(deviceHeight / pixel));
      canvas.width = width;
      canvas.height = height;
      // A whole number of device pixels per MATRIX pixel, so the upscale is exact.
      canvas.style.width = `${(width * pixel) / ratio}px`;
      canvas.style.height = `${(height * pixel) / ratio}px`;
      frame = new Frame(width, height);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const toFrame = (clientX: number, clientY: number): Point => {
      const bounds = host.getBoundingClientRect();
      return { x: ((clientX - bounds.left) * ratio) / pixel, y: ((clientY - bounds.top) * ratio) / pixel };
    };

    const s = scene.current;
    const focusOn = (item: PlacedItem): void => {
      s.snap = { lat: item.lat, lon: item.lon };
      s.focusedKey = item.key;
    };
    const settle = (): void => {
      const nearest = nearestItem(s.orientation, s.placed);
      if (nearest) focusOn(nearest);
    };
    const current = (): PlacedItem | null => s.placed.find((p) => p.key === s.focusedKey) ?? null;

    const open = async (item: PlacedItem): Promise<void> => {
      const store = useBoardStore.getState();
      try {
        const result = await window.skynet['node:open'](item.boardId, item.nodeId);
        if (!result.ok) {
          store.toast(result.target.state === 'missing' ? 'fault' : 'warn', result.error ?? result.action);
          return;
        }
        store.toast('ok', result.action);
        // Opened, so it floats a little higher. The tiles do not move: placement ignores visits.
        s.placed = placeItems(s.placed.map((p) => (p.key === item.key ? { ...asItem(p), visits: p.visits + 1 } : asItem(p))), TILES).placed;
        const updated = s.placed.find((p) => p.key === item.key);
        if (updated && s.focusedKey === item.key) setFocused(updated);
      } catch (err) {
        store.toast('fault', (err as Error).message);
      }
    };

    const move = (heading: Heading): void => {
      s.spin = null;
      if (s.zoomTarget > 0) s.zoomTarget = 0;
      const from = current() ?? nearestItem(s.orientation, s.placed);
      if (!from) return;
      const next = neighbourOf({ key: from.key, lat: from.lat, lon: from.lon }, heading, s.placed);
      if (next) {
        focusOn(next);
        return;
      }
      // Nothing further that way: a nudge and back, so the key is seen to have been heard.
      const nudge = 2 * DEG;
      s.orientation = clampOrientation({
        lat: s.orientation.lat + (heading === 'north' ? nudge : heading === 'south' ? -nudge : 0),
        lon: s.orientation.lon + (heading === 'east' ? nudge : heading === 'west' ? -nudge : 0)
      });
      focusOn(from);
    };

    const zoomBy = (direction: 1 | -1): void => {
      const stepped = Math.round(s.zoomTarget / ZOOM_STEP) * ZOOM_STEP;
      s.zoomTarget = Math.min(1, Math.max(0, stepped + direction * ZOOM_STEP));
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return;
      const at = toFrame(event.clientX, event.clientY);
      s.drag = { x: at.x, y: at.y, moved: 0, samples: [{ at: event.timeStamp, ...s.orientation }] };
      s.spin = null;
      s.snap = null;
      try {
        host.setPointerCapture(event.pointerId);
      } catch {
        // The hands' pointer is synthetic and cannot be captured; it does not need to be.
      }
      setDragging(true);
    };

    const onPointerMove = (event: PointerEvent): void => {
      const drag = s.drag;
      if (!drag || !s.camera) return;
      const at = toFrame(event.clientX, event.clientY);
      const dx = at.x - drag.x;
      const dy = at.y - drag.y;
      drag.x = at.x;
      drag.y = at.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      // Turning the globe while zoomed in on one file makes no sense: turning it steps back out.
      if (drag.moved > 3 && s.zoomTarget > 0) s.zoomTarget = 0;
      s.orientation = dragBy(s.orientation, dx, dy, s.camera);
      drag.samples.push({ at: event.timeStamp, ...s.orientation });
      if (drag.samples.length > 16) drag.samples.shift();
    };

    const onPointerUp = (event: PointerEvent): void => {
      const drag = s.drag;
      if (!drag) return;
      s.drag = null;
      setDragging(false);
      if (drag.moved <= 3) {
        // A click: go to the file under it, or into it if it is already the one in the middle.
        const hit = hitTest(s.hits, toFrame(event.clientX, event.clientY));
        if (hit && hit.item.key === s.focusedKey) s.zoomTarget = 1;
        else if (hit) focusOn(hit.item);
        else settle();
        return;
      }
      const spin: Spin = { ...s.orientation, ...releaseVelocity(drag.samples, event.timeStamp) };
      if (spinSpeed(spin) >= DEFAULT_MATRIX.settleBelow) s.spin = spin;
      else settle();
    };

    const onDoubleClick = (event: MouseEvent): void => {
      const hit = hitTest(s.hits, toFrame(event.clientX, event.clientY));
      if (!hit) return;
      focusOn(hit.item);
      void open(hit.item);
    };

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      if (event.deltaY === 0) return;
      if (event.deltaY < 0) {
        // Zoom where the pointer is: onto the file under it, which comes to the middle as the camera closes in.
        const hit = hitTest(s.hits, toFrame(event.clientX, event.clientY));
        if (hit && hit.item.key !== s.focusedKey && s.zoomTarget < 0.5) focusOn(hit.item);
        zoomBy(1);
      } else {
        zoomBy(-1);
      }
    };

    const onContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
      // A right click — or a peace sign — steps back out of a file.
      s.zoomTarget = 0;
    };

    const HEADINGS: Record<string, Heading> = {
      KeyW: 'north',
      ArrowUp: 'north',
      KeyS: 'south',
      ArrowDown: 'south',
      KeyA: 'west',
      ArrowLeft: 'west',
      KeyD: 'east',
      ArrowRight: 'east'
    };

    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === 'Tab' || event.code === 'Backquote' || /^F\d+$/.test(event.code)) return;
      const heading = HEADINGS[event.code];
      const focusedItem = current();
      if (heading) move(heading);
      else if (event.code === 'Equal' || event.code === 'NumpadAdd') zoomBy(1);
      else if (event.code === 'Minus' || event.code === 'NumpadSubtract') zoomBy(-1);
      else if (event.code === 'Space') s.zoomTarget = s.zoomTarget > 0.5 ? 0 : 1;
      else if ((event.code === 'Enter' || event.code === 'NumpadEnter') && focusedItem) void open(focusedItem);
      else if (event.code === 'Escape') {
        if (s.zoomTarget > 0) s.zoomTarget = 0;
        else closeRef.current();
      } else if (event.code === 'KeyG') closeRef.current();
      // Every other plain key is swallowed too: the board underneath must not pan, zoom or change mode unseen.
      event.preventDefault();
      event.stopPropagation();
    };

    host.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    host.addEventListener('dblclick', onDoubleClick);
    host.addEventListener('wheel', onWheel, { passive: false });
    host.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKey, true);

    let raf = 0;
    let last = performance.now();
    let shownKey: string | null = null;
    let shownIn = false;
    const tick = (now: number): void => {
      const dt = Math.min(50, Math.max(0, now - last));
      last = now;
      if (!s.drag) {
        if (s.spin) {
          s.spin = spinStep(s.spin, dt);
          s.orientation = { lat: s.spin.lat, lon: s.spin.lon };
          if (spinSpeed(s.spin) < DEFAULT_MATRIX.settleBelow) {
            s.spin = null;
            settle();
          }
        } else if (s.snap) {
          s.orientation = approach(s.orientation, s.snap, dt);
          if (angularDistance(s.orientation, s.snap) < 1e-4) {
            s.orientation = { ...s.snap };
            s.snap = null;
          }
        }
      }
      s.zoom += (s.zoomTarget - s.zoom) * (1 - Math.exp(-dt / 140));
      if (Math.abs(s.zoomTarget - s.zoom) < 5e-4) s.zoom = s.zoomTarget;
      if (frame) {
        s.hits = draw(frame, s, colours.current, now, still);
        context.putImageData(frame.image, 0, 0);
      }
      // The words follow the globe, but React hears only about changes, not sixty frames a second.
      const showing = s.drag || s.spin ? nearestItem(s.orientation, s.placed) : current();
      if ((showing?.key ?? null) !== shownKey) {
        shownKey = showing?.key ?? null;
        setFocused(showing);
      }
      const inNow = s.zoom > 0.9;
      if (inNow !== shownIn) {
        shownIn = inNow;
        setZoomedIn(inNow);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      host.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      host.removeEventListener('dblclick', onDoubleClick);
      host.removeEventListener('wheel', onWheel);
      host.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  return (
    <div ref={hostRef} className={dragging ? 'matrix-host dragging' : 'matrix-host'} tabIndex={-1} role="application" aria-label="The MATRIX">
      <canvas ref={canvasRef} aria-hidden="true" />
      <div className="matrix-title">
        <strong>THE MATRIX</strong>
        <span>{status === 'loading' ? 'READING EVERY BOARD…' : `${counts.files} FILES · ${counts.projects} PROJECTS`}</span>
        {counts.unplaced > 0 ? <span className="matrix-warn">{counts.unplaced} MORE THAN THE GLOBE HAS TILES FOR — NOT SHOWN</span> : null}
      </div>
      {status === 'empty' ? <div className="matrix-empty">NO DOCUMENTS OR LINKS ON ANY BOARD YET. A FILE OR LINK NODE APPEARS HERE AS SOON AS IT EXISTS.</div> : null}
      {status === 'error' ? <div className="matrix-empty">COULD NOT READ THE BOARDS — {error}</div> : null}
      {focused && !zoomedIn ? (
        <div className="matrix-label" aria-live="polite">
          <span className="matrix-project">{focused.project}</span>
          <strong>{focused.name}</strong>
          <span>
            {KIND_WORDS[focused.kind] ?? focused.kind} · {visitsText(focused.visits)}
          </span>
        </div>
      ) : null}
      {focused && zoomedIn ? (
        <div className="matrix-sheet">
          <div className="matrix-sheet-body">
            <div className="matrix-project">{focused.project}</div>
            <div className="matrix-sheet-name">{focused.name}</div>
            <div>
              {KIND_WORDS[focused.kind] ?? focused.kind} · {visitsText(focused.visits)}
            </div>
            <div className="matrix-sheet-target">{focused.target || 'POINTS AT NOTHING'}</div>
            <div className="matrix-sheet-keys">ENTER OPENS IT · WHEEL, − OR ESC STEPS BACK OUT</div>
          </div>
        </div>
      ) : null}
      <div className="matrix-help"><span>DRAG, WASD OR ARROWS TURN · WHEEL, +/− OR TWO HANDS ZOOM · CLICK A FILE TO GO TO IT · ENTER OPENS · G OR ESC LEAVES</span></div>
    </div>
  );
}
