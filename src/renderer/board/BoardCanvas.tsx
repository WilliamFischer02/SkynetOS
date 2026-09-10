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
import { Application, Container, Graphics, Sprite, TextureSource } from 'pixi.js';
import type { Board } from '@shared/types.js';
import { footprintOf, spriteKeyOf } from '@shared/types.js';
import { FAULT, SILK, WARN, hexToNumber } from '@shared/palette.js';
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
import type { Point } from './traces.js';
import { SpriteStore } from './sprites.js';
import { attachEndpoints, buildTraceLayer, routeOrthogonal, styleFor, type RoutedEdge } from './traces.js';
import { buildRouteGrid, routeAStar, type RouteObstacle } from './router.js';
import { buildBrokenOverlay, buildSelectionOverlay, buildSilkNote, buildZone } from './silk-layer.js';
import { centreOn, hitTest, isVisible, layoutRects, nodeRect, nextInOrder, type NodeRect } from './layout.js';
import {
  NO_DRAG,
  beginDrag,
  canDrop,
  exceedsThreshold,
  moveTo,
  panTo,
  shouldCommit,
  type DragState
} from './drag.js';
import fontUrl from '../../../assets/fonts/DepartureMono-1.500/DepartureMono-Regular.woff2?url';
import { ensureSilkFont } from './silkscreen.js';

/** Atlas URL, or null when there is none. M2 points this at assets/atlas/skynet.json. */
const ATLAS_URL: string | null = null;

export interface BoardCanvasProps {
  board: Board;
  boardId: string;
  selectedId: string | null;
  targets: Record<string, TargetInfo>;
  focus: boolean;
  /** Edit Board mode (E): shows the grid and lets nodes be dragged. docs/03 §1. */
  editMode: boolean;
  onSelect: (nodeId: string | null) => void;
  onActivate: (nodeId: string) => void;
  onMoveNode: (nodeId: string, pos: { x: number; y: number }) => void;
  onStatus?: (status: BoardCanvasStatus) => void;
  /** Written every frame so the minimap can track the camera without a React render. */
  cameraRef?: React.RefObject<{ x: number; y: number; zoom: number; viewW: number; viewH: number }>;
  /** Bumped by the minimap to ask the camera to centre somewhere. */
  jumpTo?: { x: number; y: number; seq: number } | null;
}

export interface BoardCanvasStatus {
  zoom: Zoom;
  cameraX: number;
  cameraY: number;
  /**
   * True when the whole board fits on screen, so clampCamera is centring it and panning has
   * nowhere to go. Surfaced in the HUD because a gesture that correctly does nothing is
   * indistinguishable from a broken one — which is exactly how this was first reported.
   */
  fitsOnScreen: boolean;
  devicePixelRatio: number;
  atlasFrames: number;
  placeholderCount: number;
  brokenCount: number;
  faceCount: number;
  /** How many traces the A* router handled, and how many fell back to the dumb Z-route. */
  routedCount: number;
  fallbackCount: number;
  fps: number;
}

const PAN_KEYS: Record<string, 'up' | 'down' | 'left' | 'right'> = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right'
};

interface PanHeld { up: boolean; down: boolean; left: boolean; right: boolean; heldFrames: number }

export function BoardCanvas(props: BoardCanvasProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Props the ticker and event handlers read without re-running the init effect.
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
    let drag: DragState = NO_DRAG;
    let overlayLayer: Container | null = null;
    let nodeLayer: Container | null = null;
    let gridLayer: Container | null = null;
    const spriteById = new Map<string, Sprite>();
    const boardPx = boardPixelSize(props.board.grid);

    const viewport = (): Viewport => ({ width: app?.renderer.width ?? 0, height: app?.renderer.height ?? 0 });

    const canvasPoint = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
      if (!app) return { x: 0, y: 0 };
      const bounds = app.canvas.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };

    /* ---------------- keyboard ---------------- */

    const onKeyDown = (event: KeyboardEvent) => {
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
        if (rect && !isVisible(rect, camera, viewport())) {
          camera = clampCamera({ ...camera, ...centreOn(rect, camera.zoom, viewport()) }, boardPx, viewport());
        }
        return;
      }

      if (event.code === 'Space' || event.code === 'Enter') {
        if (live.current.selectedId) { event.preventDefault(); live.current.onActivate(live.current.selectedId); }
        return;
      }

      if (event.code === 'Escape') live.current.onSelect(null);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const dir = PAN_KEYS[event.code];
      if (dir) held[dir] = false;
    };

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      camera = { ...camera, zoom: stepZoom(camera.zoom, event.deltaY < 0 ? 1 : -1) };
    };

    /* ---------------- pointer: pan and move ---------------- */

    const onPointerDown = (event: PointerEvent) => {
      if (!app) return;
      const screen = canvasPoint(event);
      const world = screenToWorld(camera, screen.x, screen.y);
      const hit = hitTest(rects, world.x, world.y);
      const node = hit ? props.board.nodes.find((n) => n.id === hit.nodeId) : undefined;

      drag = beginDrag({
        button: event.button,
        screen,
        camera,
        hit,
        editMode: live.current.editMode,
        nodeTile: node ? { x: node.pos.x, y: node.pos.y } : null
      });

      if (drag.kind !== 'none') {
        // Capture the pointer so a drag that leaves the window still tracks and still ends.
        app.canvas.setPointerCapture(event.pointerId);
        app.canvas.style.cursor = drag.kind === 'move' ? 'grabbing' : 'move';
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (drag.kind === 'none' || !app) return;
      const screen = canvasPoint(event);

      if (!drag.exceeded) {
        if (!exceedsThreshold(drag, screen)) return;
        drag = { ...drag, exceeded: true };
      }

      if (drag.kind === 'pan') {
        camera = clampCamera({ ...camera, ...panTo(drag, screen, camera.zoom) }, boardPx, viewport());
        return;
      }

      const node = props.board.nodes.find((n) => n.id === drag.nodeId);
      if (!node) return;
      const tile = moveTo(drag, screen, camera.zoom);
      const fp = footprintOf(node);
      drag = {
        ...drag,
        currentTile: tile,
        valid: canDrop(node.id, tile, fp, rects, props.board.grid)
      };
    };

    const endDrag = (event: PointerEvent) => {
      if (drag.kind === 'none' || !app) return;
      try { app.canvas.releasePointerCapture(event.pointerId); } catch { /* already released */ }
      app.canvas.style.cursor = '';

      // A press that never exceeded the threshold is a click, and a click selects.
      if (!drag.exceeded && event.button === 0) {
        const screen = canvasPoint(event);
        const world = screenToWorld(camera, screen.x, screen.y);
        const hit = hitTest(rects, world.x, world.y);
        live.current.onSelect(hit ? hit.nodeId : null);
      } else if (shouldCommit(drag) && drag.nodeId && drag.currentTile) {
        live.current.onMoveNode(drag.nodeId, drag.currentTile);
      }

      drag = NO_DRAG;
    };

    const onDoubleClick = (event: MouseEvent) => {
      if (!app) return;
      const screen = canvasPoint(event);
      const world = screenToWorld(camera, screen.x, screen.y);
      const hit = hitTest(rects, world.x, world.y);
      if (hit) live.current.onActivate(hit.nodeId);
    };

    /* ---------------- build the scene ---------------- */

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
        app.canvas.style.touchAction = 'none';

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

        /*
         * Layer 1 — copper traces, auto-routed.
         *
         * A* on the half-grid with every mounted footprint as an obstacle, so a trace goes AROUND
         * a component instead of through it. Hand-placed waypoints in the board JSON still win,
         * and a route A* cannot find falls back to the two-bend Z rather than vanishing.
         */
        const routed: RoutedEdge[] = [];
        const rectById = new Map(props.board.nodes.map((n) => [n.id, nodeRect(n)] as const));
        const obstacles: RouteObstacle[] = props.board.nodes
          .filter((n) => n.kind !== 'note.silk' && n.kind !== 'group.zone')
          .map((n) => ({ ...nodeRect(n), nodeId: n.id }));
        const routeGrid = buildRouteGrid(obstacles, boardPx);

        let routedCount = 0;
        let fallbackCount = 0;
        for (const edge of props.board.edges) {
          const from = rectById.get(edge.from);
          const to = rectById.get(edge.to);
          if (!from || !to) continue;

          let points: Point[] | null = null;
          if (edge.waypoints?.length) {
            points = routeOrthogonal(from, to, edge.waypoints, props.board.grid.tile);
          } else {
            const path = routeAStar(
              { from: { ...from, nodeId: edge.from }, to: { ...to, nodeId: edge.to }, obstacles, boardPx },
              routeGrid
            );
            if (path) { points = attachEndpoints(path, from, to); routedCount++; }
          }
          if (!points) {
            points = routeOrthogonal(from, to, edge.waypoints, props.board.grid.tile);
            if (!edge.waypoints?.length) fallbackCount++;
          }

          routed.push({ edge, points, style: styleFor(edge, props.board.theme.signal) });
        }
        console.info(`[router] ${routedCount} auto-routed, ${fallbackCount} fell back to a direct run`);
        world.addChild(buildTraceLayer(routed));

        // Layer 2 — silkscreen zones, printed under the components they group.
        const silkLayer = new Container();
        for (const node of props.board.nodes) {
          if (node.kind === 'group.zone') silkLayer.addChild(buildZone(node, props.board.theme.signal));
        }
        world.addChild(silkLayer);

        // Layer 3 — node sprites.
        const sprites = new SpriteStore();
        const atlas = await sprites.load(ATLAS_URL);
        if (disposed) { app.destroy(true, { children: true }); return; }
        if (!atlas.loaded) console.info(`[atlas] ${atlas.reason} — every node renders as a placeholder`);

        nodeLayer = new Container();
        world.addChild(nodeLayer);

        /**
         * Face images. Each node with an `image` gets its mosaic from main, which downsamples
         * and dithers it to the room's six colours. Loaded in parallel and drawn as soon as it
         * arrives, so a slow disk or a large source never blocks the first frame.
         */
        let faceCount = 0;
        const drawNode = (nodeId: string, face: HTMLImageElement | null): void => {
          const node = props.board.nodes.find((n) => n.id === nodeId);
          const sprite = spriteById.get(nodeId);
          if (!node || !sprite) return;
          const fp = footprintOf(node);
          sprite.texture = sprites.placeholder({
            w: fp.w,
            h: fp.h,
            designator: node.designator ?? '',
            name: node.name,
            maskLight: props.board.theme.maskLight,
            face
          });
        };

        let placeholderCount = 0;
        for (const node of props.board.nodes) {
          if (node.kind === 'note.silk' || node.kind === 'group.zone') continue;
          const fp = footprintOf(node);
          const key = spriteKeyOf(node);
          const texture = sprites.get(key) ?? sprites.placeholder({
            w: fp.w,
            h: fp.h,
            designator: node.designator ?? '',
            name: node.name,
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

        for (const node of props.board.nodes) {
          if (!node.image) continue;
          void window.skynet['mosaic:forNode'](props.boardId, node.id).then(async (result) => {
            if (disposed) return;
            if (!result.ok) { console.warn(`[mosaic] ${node.id}: ${result.error}`); return; }
            const img = new Image();
            img.src = result.dataUrl;
            await img.decode();
            if (disposed) return;
            faceCount++;
            drawNode(node.id, img);
          }).catch((err: unknown) => console.warn(`[mosaic] ${node.id} failed`, err));
        }

        // Layer 4 — printed notes, on top of components so a label is never buried.
        const noteLayer = new Container();
        for (const node of props.board.nodes) {
          if (node.kind !== 'note.silk') continue;
          const note = buildSilkNote(node);
          if (note) noteLayer.addChild(note);
        }
        world.addChild(noteLayer);

        // Layer 5 — edit-mode grid, then selection / broken / drag overlays.
        gridLayer = new Container();
        world.addChild(gridLayer);
        overlayLayer = new Container();
        world.addChild(overlayLayer);

        rects = layoutRects(props.board);

        const buildGrid = (): void => {
          if (!gridLayer) return;
          gridLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
          if (!live.current.editMode) return;
          // A 1px dot at every tile corner. Dots, not lines: a full grid of lines over the whole
          // board is louder than the board itself and you cannot see the components any more.
          const g = new Graphics();
          for (let ty = 0; ty <= props.board.grid.height; ty++) {
            for (let tx = 0; tx <= props.board.grid.width; tx++) {
              g.rect(tx * TILE, ty * TILE, 1, 1);
            }
          }
          g.fill({ color: hexToNumber(SILK), alpha: 0.35 });
          g.roundPixels = true;
          gridLayer.addChild(g);
        };

        const rebuildOverlay = (): void => {
          if (!overlayLayer) return;
          overlayLayer.removeChildren().forEach((c) => c.destroy({ children: true }));

          const { targets, selectedId } = live.current;
          brokenCount = 0;
          for (const node of props.board.nodes) {
            const info = targets[node.id];
            if (!info || !isBroken(info)) continue;
            if (node.kind === 'note.silk' || node.kind === 'group.zone') continue;
            brokenCount++;
            const color = info.state === 'outside-dev-root' || info.state === 'unset' ? WARN : FAULT;
            overlayLayer.addChild(buildBrokenOverlay(nodeRect(node), color));
          }

          if (selectedId) {
            const node = props.board.nodes.find((n) => n.id === selectedId);
            if (node) overlayLayer.addChild(buildSelectionOverlay(nodeRect(node), props.board.theme.signal));
          }

          // Drag ghost: where the node would land, green if legal, red if not. Corner brackets
          // and a 1px frame, same vocabulary as selection — nothing translucent or blurred.
          if (drag.kind === 'move' && drag.exceeded && drag.currentTile && drag.nodeId) {
            const node = props.board.nodes.find((n) => n.id === drag.nodeId);
            if (node) {
              const fp = footprintOf(node);
              const ghost = {
                nodeId: node.id,
                kind: node.kind,
                x: drag.currentTile.x * TILE,
                y: drag.currentTile.y * TILE,
                w: fp.w * TILE,
                h: fp.h * TILE
              };
              const color = drag.valid ? props.board.theme.signal : FAULT;
              const frame = new Graphics();
              frame.rect(ghost.x, ghost.y, ghost.w, 1);
              frame.rect(ghost.x, ghost.y + ghost.h - 1, ghost.w, 1);
              frame.rect(ghost.x, ghost.y, 1, ghost.h);
              frame.rect(ghost.x + ghost.w - 1, ghost.y, 1, ghost.h);
              frame.fill({ color: hexToNumber(color) });
              frame.roundPixels = true;
              overlayLayer.addChild(frame);
              overlayLayer.addChild(buildSelectionOverlay(ghost, color));
            }
          }
        };

        const applyFocus = (): void => {
          const { focus, selectedId } = live.current;
          if (!focus || !selectedId) {
            for (const sprite of spriteById.values()) sprite.alpha = 1;
            return;
          }
          const related = new Set<string>([selectedId]);
          for (const edge of props.board.edges) {
            if (edge.from === selectedId) related.add(edge.to);
            if (edge.to === selectedId) related.add(edge.from);
          }
          for (const [id, sprite] of spriteById) sprite.alpha = related.has(id) ? 1 : 0.25;
        };

        let brokenCount = 0;
        buildGrid();
        rebuildOverlay();

        let frames = 0;
        let fpsAccum = 0;
        let fps = 0;
        let lastSelection: string | null = null;
        let lastBrokenKey = '';
        let lastFocus = false;
        let lastEditMode = live.current.editMode;
        let lastDragKey = '';
        let lastJumpSeq = live.current.jumpTo?.seq ?? 0;

        app.ticker.add((ticker) => {
          const view = viewport();

          // Keyboard panning is suppressed while dragging: two things moving the camera at once
          // makes a drag feel like it is fighting you.
          const panning = drag.kind === 'none' && (held.up || held.down || held.left || held.right);
          held.heldFrames = panning ? held.heldFrames + 1 : 0;
          camera = panning
            ? stepCamera(camera, { ...held }, boardPx, view)
            : clampCamera(camera, boardPx, view);

          // Minimap jump: centre on the requested world point, once per seq bump.
          const jump = live.current.jumpTo;
          if (jump && jump.seq !== lastJumpSeq) {
            lastJumpSeq = jump.seq;
            camera = clampCamera(
              { ...camera, x: jump.x - view.width / (2 * camera.zoom), y: jump.y - view.height / (2 * camera.zoom) },
              boardPx,
              view
            );
          }

          if (live.current.cameraRef?.current) {
            live.current.cameraRef.current.x = camera.x;
            live.current.cameraRef.current.y = camera.y;
            live.current.cameraRef.current.zoom = camera.zoom;
            live.current.cameraRef.current.viewW = view.width;
            live.current.cameraRef.current.viewH = view.height;
          }

          // The one line that keeps the board from shimmering.
          const pos = stagePosition(camera);
          world.x = pos.x;
          world.y = pos.y;
          world.scale.set(camera.zoom);

          if (live.current.editMode !== lastEditMode) {
            lastEditMode = live.current.editMode;
            buildGrid();
          }

          const brokenKey = Object.entries(live.current.targets).map(([id, t]) => `${id}:${t.state}`).join('|');
          const dragKey = drag.kind === 'move' && drag.exceeded
            ? `${drag.nodeId}:${drag.currentTile?.x},${drag.currentTile?.y}:${drag.valid}`
            : '';
          if (live.current.selectedId !== lastSelection || brokenKey !== lastBrokenKey || dragKey !== lastDragKey) {
            lastSelection = live.current.selectedId;
            lastBrokenKey = brokenKey;
            lastDragKey = dragKey;
            rebuildOverlay();
          }
          if (live.current.focus !== lastFocus) {
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
              fitsOnScreen:
                boardPx.width <= view.width / camera.zoom && boardPx.height <= view.height / camera.zoom,
              devicePixelRatio: window.devicePixelRatio,
              atlasFrames: sprites.frameCount,
              placeholderCount,
              brokenCount,
              faceCount,
              routedCount,
              fallbackCount,
              fps
            });
          }
        });

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        host.addEventListener('wheel', onWheel, { passive: false });
        app.canvas.addEventListener('pointerdown', onPointerDown);
        app.canvas.addEventListener('pointermove', onPointerMove);
        app.canvas.addEventListener('pointerup', endDrag);
        app.canvas.addEventListener('pointercancel', endDrag);
        app.canvas.addEventListener('dblclick', onDoubleClick);
        // Middle-drag pans, and the browser's default for middle-click is autoscroll.
        app.canvas.addEventListener('auxclick', (e) => e.preventDefault());
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
      if (app) {
        app.canvas.removeEventListener('pointerdown', onPointerDown);
        app.canvas.removeEventListener('pointermove', onPointerMove);
        app.canvas.removeEventListener('pointerup', endDrag);
        app.canvas.removeEventListener('pointercancel', endDrag);
        app.canvas.removeEventListener('dblclick', onDoubleClick);
        app.destroy(true, { children: true });
      }
    };
  }, [props.board, props.boardId]);

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
