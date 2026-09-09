import { useEffect, useRef, useState } from 'react';
/**
 * MUST be imported before anything creates a renderer, and must stay imported.
 *
 * Pixi v8 generates its uniform-upload and batch-shader code with `new Function()`. Our CSP
 * (src/renderer/index.html, per docs/07-SECURITY.md) sets `script-src 'self'` with no
 * 'unsafe-eval', so that code generation throws and the canvas never initialises.
 *
 * The subpath's name reads backwards: `pixi.js/unsafe-eval` is the build FOR environments that
 * FORBID unsafe-eval — it swaps in precompiled, non-eval implementations. The alternative was to
 * add 'unsafe-eval' to the CSP, which is exactly the kind of quiet security relaxation docs/07
 * exists to prevent. Removing this import re-breaks the renderer. See docs/DECISIONS.md.
 */
import 'pixi.js/unsafe-eval';
import { Application, Container, Sprite, TextureSource } from 'pixi.js';
import type { Board, BoardNode } from '@shared/types.js';
import { footprintOf, spriteKeyOf } from '@shared/types.js';
import { FAULT, WARN } from '@shared/palette.js';
import { isBroken, type TargetInfo } from '@shared/targets.js';
import {
  type Camera,
  type Viewport,
  type Zoom,
  boardPixelSize,
  clampCamera,
  isZoom,
  screenToWorld,
  stagePosition,
  stepCamera,
  stepZoom,
  TILE
} from './camera.js';
import { buildSubstrate } from './substrate.js';
import { SpriteStore } from './sprites.js';
import { buildTraceLayer, routeOrthogonal, styleFor, type RoutedEdge } from './traces.js';
import { buildBrokenOverlay, buildSelectionOverlay, buildSilkNote, buildZone } from './silk-layer.js';
import { centreOn, hitTest, isVisible, layoutRects, nodeRect, nextInOrder, type NodeRect } from './layout.js';
import fontUrl from '../../../assets/fonts/DepartureMono-1.500/DepartureMono-Regular.woff2?url';
import { ensureSilkFont } from './silkscreen.js';

/** Atlas URL, or null when there is none. M2 points this at assets/atlas/skynet.json. */
const ATLAS_URL: string | null = null;

export interface BoardCanvasProps {
  board: Board;
  selectedId: string | null;
  targets: Record<string, TargetInfo>;
  focus: boolean;
  onSelect: (nodeId: string | null) => void;
  onActivate: (nodeId: string) => void;
  onStatus?: (status: BoardCanvasStatus) => void;
}

export interface BoardCanvasStatus {
  zoom: Zoom;
  cameraX: number;
  cameraY: number;
  devicePixelRatio: number;
  atlasFrames: number;
  placeholderCount: number;
  brokenCount: number;
  fps: number;
}

const PAN_KEYS: Record<string, 'up' | 'down' | 'left' | 'right'> = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right'
};

interface PanHeld { up: boolean; down: boolean; left: boolean; right: boolean; heldFrames: number }

/** Layer order from docs/01 §Rendering pipeline. Indices are the addChild order below. */
export function BoardCanvas(props: BoardCanvasProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Props the ticker and event handlers need to see without re-running the whole init effect.
  const live = useRef(props);
  live.current = props;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let app: Application | null = null;
    const held: PanHeld = { up: false, down: false, left: false, right: false, heldFrames: 0 };
    let camera: Camera = { x: 0, y: 0, zoom: 3 };
    let rects: NodeRect[] = [];
    let overlayLayer: Container | null = null;
    let nodeLayer: Container | null = null;
    const spriteById = new Map<string, Sprite>();

    const viewport = (): Viewport => ({ width: app?.renderer.width ?? 0, height: app?.renderer.height ?? 0 });

    const onKeyDown = (event: KeyboardEvent) => {
      // Never steal keys from a form field — the inspector is full of them.
      const el = event.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;

      const dir = PAN_KEYS[event.code];
      if (dir) { held[dir] = true; event.preventDefault(); return; }

      if (event.code === 'Digit2' || event.code === 'Digit3' || event.code === 'Digit4') {
        const z = Number(event.code.slice(-1));
        if (isZoom(z)) camera = { ...camera, zoom: z };
        event.preventDefault();
        return;
      }

      if (event.code === 'Tab') {
        event.preventDefault();
        const next = nextInOrder(rects, live.current.selectedId, event.shiftKey ? -1 : 1);
        if (!next) return;
        live.current.onSelect(next);
        const rect = rects.find((r) => r.nodeId === next);
        // Scroll to the node only if it is not already fully on screen, so Tab does not jerk
        // the camera around while cycling through a cluster you are already looking at.
        if (rect && !isVisible(rect, camera, viewport())) {
          const centred = centreOn(rect, camera.zoom, viewport());
          camera = clampCamera({ ...camera, ...centred }, boardPx, viewport());
        }
        return;
      }

      if (event.code === 'Space' || event.code === 'Enter') {
        if (live.current.selectedId) { event.preventDefault(); live.current.onActivate(live.current.selectedId); }
        return;
      }

      if (event.code === 'Escape') {
        live.current.onSelect(null);
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const dir = PAN_KEYS[event.code];
      if (dir) { held[dir] = false; }
    };

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      camera = { ...camera, zoom: stepZoom(camera.zoom, event.deltaY < 0 ? 1 : -1) };
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !app) return;
      const bounds = app.canvas.getBoundingClientRect();
      const world = screenToWorld(camera, event.clientX - bounds.left, event.clientY - bounds.top);
      const hit = hitTest(rects, world.x, world.y);
      live.current.onSelect(hit ? hit.nodeId : null);
    };

    const onDoubleClick = (event: MouseEvent) => {
      if (!app) return;
      const bounds = app.canvas.getBoundingClientRect();
      const world = screenToWorld(camera, event.clientX - bounds.left, event.clientY - bounds.top);
      const hit = hitTest(rects, world.x, world.y);
      if (hit) live.current.onActivate(hit.nodeId);
    };

    const boardPx = boardPixelSize(props.board.grid);

    void (async () => {
      try {
        await ensureSilkFont(fontUrl);
        if (disposed) return;

        TextureSource.defaultOptions.scaleMode = 'nearest';
        TextureSource.defaultOptions.autoGenerateMipmaps = false;

        app = new Application();
        await app.init({
          preference: 'webgl',
          antialias: false,
          // Main has already forced devicePixelRatio to 1, so resolution 1 with autoDensity off
          // means one canvas pixel is one device pixel. No resampling anywhere in the stack.
          resolution: 1,
          autoDensity: false,
          roundPixels: true,
          backgroundColor: props.board.theme.maskDark,
          resizeTo: host
        });
        if (disposed) { app.destroy(true, { children: true }); return; }

        host.appendChild(app.canvas);
        app.canvas.style.imageRendering = 'pixelated';
        app.canvas.style.display = 'block';

        const world = new Container();
        app.stage.addChild(world);

        // Layer 0 — substrate.
        world.addChild(buildSubstrate(
          {
            maskDark: props.board.theme.maskDark,
            maskLight: props.board.theme.maskLight,
            seed: props.board.theme.substrateSeed ?? 1
          },
          boardPx
        ));

        // Layer 1 — copper traces. Routed once; re-routed only when the graph changes.
        const routed: RoutedEdge[] = [];
        const rectById = new Map(props.board.nodes.map((n) => [n.id, nodeRect(n)] as const));
        for (const edge of props.board.edges) {
          const from = rectById.get(edge.from);
          const to = rectById.get(edge.to);
          if (!from || !to) continue;
          routed.push({
            edge,
            points: routeOrthogonal(from, to, edge.waypoints, props.board.grid.tile),
            style: styleFor(edge, props.board.theme.signal)
          });
        }
        world.addChild(buildTraceLayer(routed));

        // Layer 2 — silkscreen zones, printed under the components they group.
        const silkLayer = new Container();
        for (const node of props.board.nodes) {
          if (node.kind === 'group.zone') silkLayer.addChild(buildZone(node, props.board.theme.signal));
        }
        world.addChild(silkLayer);

        // Layer 3 — node sprites. All placeholders until the atlas exists.
        const sprites = new SpriteStore();
        const atlas = await sprites.load(ATLAS_URL);
        if (disposed) { app.destroy(true, { children: true }); return; }
        if (!atlas.loaded) console.info(`[atlas] ${atlas.reason} — every node renders as a placeholder`);

        nodeLayer = new Container();
        world.addChild(nodeLayer);

        let placeholderCount = 0;
        for (const node of props.board.nodes) {
          if (node.kind === 'note.silk' || node.kind === 'group.zone') continue;
          const fp = footprintOf(node);
          const key = spriteKeyOf(node);
          const texture = sprites.get(key) ?? sprites.placeholder({
            w: fp.w,
            h: fp.h,
            designator: node.designator ?? '',
            maskLight: props.board.theme.maskLight
          });
          if (!sprites.has(key)) placeholderCount++;

          const sprite = new Sprite(texture);
          sprite.x = node.pos.x * TILE;
          sprite.y = node.pos.y * TILE;
          sprite.roundPixels = true;
          nodeLayer.addChild(sprite);
          spriteById.set(node.id, sprite);
        }

        // Layer 4 — printed notes, on top of components so a label is never buried.
        const noteLayer = new Container();
        for (const node of props.board.nodes) {
          if (node.kind !== 'note.silk') continue;
          const note = buildSilkNote(node);
          if (note) noteLayer.addChild(note);
        }
        world.addChild(noteLayer);

        // Layer 5 — selection and broken-state overlays, rebuilt when either changes.
        overlayLayer = new Container();
        world.addChild(overlayLayer);

        rects = layoutRects(props.board);

        let lastSelection: string | null = null;
        let lastBrokenKey = '';
        let brokenCount = 0;

        const rebuildOverlay = () => {
          if (!overlayLayer) return;
          overlayLayer.removeChildren().forEach((c) => c.destroy({ children: true }));

          const { targets, selectedId } = live.current;
          brokenCount = 0;
          for (const node of props.board.nodes) {
            const info = targets[node.id];
            if (!info || !isBroken(info)) continue;
            if (node.kind === 'note.silk' || node.kind === 'group.zone') continue;
            brokenCount++;
            const rect = nodeRect(node);
            // outside-dev-root is usable, just confirmed — warn, not fault.
            const color = info.state === 'outside-dev-root' || info.state === 'unset' ? WARN : FAULT;
            overlayLayer.addChild(buildBrokenOverlay(rect, color));
          }

          if (selectedId) {
            const node = props.board.nodes.find((n) => n.id === selectedId);
            if (node) overlayLayer.addChild(buildSelectionOverlay(nodeRect(node), props.board.theme.signal));
          }
        };

        rebuildOverlay();

        const applyFocus = () => {
          const { focus, selectedId } = live.current;
          if (!nodeLayer) return;
          if (!focus || !selectedId) {
            for (const sprite of spriteById.values()) sprite.alpha = 1;
            return;
          }
          // Focus mode dims by alpha on whole sprites only. That is a uniform multiply on an
          // already-flat colour, not a blur or a filter — anti-mush rule 6 holds.
          const related = new Set<string>([selectedId]);
          for (const edge of props.board.edges) {
            if (edge.from === selectedId) related.add(edge.to);
            if (edge.to === selectedId) related.add(edge.from);
          }
          for (const [id, sprite] of spriteById) sprite.alpha = related.has(id) ? 1 : 0.25;
        };

        let frames = 0;
        let fpsAccum = 0;
        let fps = 0;
        let lastFocus = false;

        app.ticker.add((ticker) => {
          const view = viewport();

          const panning = held.up || held.down || held.left || held.right;
          held.heldFrames = panning ? held.heldFrames + 1 : 0;
          camera = panning
            ? stepCamera(camera, { ...held }, boardPx, view)
            : clampCamera(camera, boardPx, view);

          // The one line that keeps the board from shimmering.
          const pos = stagePosition(camera);
          world.x = pos.x;
          world.y = pos.y;
          world.scale.set(camera.zoom);

          const brokenKey = Object.entries(live.current.targets)
            .map(([id, t]) => `${id}:${t.state}`)
            .join('|');
          if (live.current.selectedId !== lastSelection || brokenKey !== lastBrokenKey) {
            lastSelection = live.current.selectedId;
            lastBrokenKey = brokenKey;
            rebuildOverlay();
          }
          if (live.current.focus !== lastFocus || live.current.selectedId !== lastSelection) {
            lastFocus = live.current.focus;
            applyFocus();
          }

          fpsAccum += ticker.FPS;
          if (++frames >= 30) {
            fps = Math.round(fpsAccum / frames);
            fpsAccum = 0;
            frames = 0;
            live.current.onStatus?.({
              zoom: camera.zoom,
              cameraX: Math.round(camera.x),
              cameraY: Math.round(camera.y),
              devicePixelRatio: window.devicePixelRatio,
              atlasFrames: sprites.frameCount,
              placeholderCount,
              brokenCount,
              fps
            });
          }
        });

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        host.addEventListener('wheel', onWheel, { passive: false });
        app.canvas.addEventListener('pointerdown', onPointerDown);
        app.canvas.addEventListener('dblclick', onDoubleClick);
      } catch (err) {
        console.error(err);
        setError((err as Error).message);
      }
    })();

    return () => {
      disposed = true;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      host.removeEventListener('wheel', onWheel);
      app?.canvas.removeEventListener('pointerdown', onPointerDown);
      app?.canvas.removeEventListener('dblclick', onDoubleClick);
      app?.destroy(true, { children: true });
    };
    // Re-initialising on every board object identity change is correct: an edit rewrites the
    // board, and the trace routing and zone geometry both derive from it. Cheap at this size.
  }, [props.board]);

  if (error) {
    return (
      <div className="fault">
        <p>RENDERER FAULT</p>
        <p>{error}</p>
      </div>
    );
  }
  return <div className="board-host" ref={hostRef} />;
}

export type { BoardNode };
