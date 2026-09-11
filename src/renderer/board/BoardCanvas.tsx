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
import type { Board, BoardNode, Footprint } from '@shared/types.js';
import { displayOf, footprintOf, isPrinted, maxFootprintFor, spriteKeyOf, type Rotation } from '@shared/types.js';
import { FAULT, SILK, WARN, hexToNumber } from '@shared/palette.js';
import { isBroken, type TargetInfo } from '@shared/targets.js';
import {
  type Camera,
  type Viewport,
  type Zoom,
  boardPixelSize,
  clampCamera,
  fitZoom,
  isZoom,
  screenToWorld,
  stagePosition,
  setZoom,
  stepCamera,
  stepZoom,
  TILE
} from './camera.js';
import { buildSubstrate } from './substrate.js';
import { CourierLayer, courierColor, courierSource, type CourierRoute } from './couriers.js';
import { courierHub, elbowPath, wirePath, type Wire } from './courier-paths.js';
import { GLOW_FPS, GLOW_FRAMES, buildGlowFrames } from './glow.js';
import type { Point } from './traces.js';
import { SpriteStore, textureOffset } from './sprites.js';
import { attachEndpoints, buildTraceLayer, routeOrthogonal, styleFor, type RoutedEdge } from './traces.js';
import { buildRouteGrid, routeAStar, type RouteObstacle } from './router.js';
import { buildBrokenOverlay, buildSelectionOverlay, buildSilkNote, buildZone } from './silk-layer.js';
import { measureTextBlock } from './text-plate.js';
import { roomTitle, suffixSize } from '@shared/room-title.js';
import { COPPER_DARK, SILK as SILK_HEX, brighten, resolveToken } from '@shared/palette.js';
import { centreOn, contentBounds, hitTest, isVisible, layoutRects, nodeRect, nextInOrder, type NodeRect } from './layout.js';
import { portUnderPoint, wireRefusal, type Port, type WiringState } from './ports.js';
import {
  NO_DRAG,
  beginDrag,
  canDrop,
  exceedsThreshold,
  moveTo,
  panTo,
  resizeTo,
  shouldCommit,
  shouldCommitResize,
  shouldCommitGroup,
  groupDelta,
  groupTargets,
  canDropGroup,
  marqueeRect,
  selectInRect,
  type GroupMember,
  type DragState
} from './drag.js';
import fontUrl from '../../../assets/fonts/DepartureMono-1.500/DepartureMono-Regular.woff2?url';
import atlasUrl from '../../../assets/atlas/skynet.json?url';
import atlasImageUrl from '../../../assets/atlas/skynet.png?url';
import { ensureSilkFont } from './silkscreen.js';

/**
 * The baked atlas. `npm run assets:bake` writes it from assets/sprites/manifest.json.
 *
 * Resolved at BUILD time by Vite, which is why `assets:bake` always writes a file even when it
 * bakes nothing: assets/atlas is git-ignored, and a missing import is a build failure rather than
 * a graceful degrade. An empty atlas is a perfectly good atlas — every key misses and every node
 * draws a labelled placeholder, which is the documented pre-art state.
 */
const ATLAS_URL: string | null = atlasUrl;

/** Side of the corner resize handle, in world px. Two tiles: findable at 2x, not fat at 4x. */
const HANDLE_PX = 8;

export interface BoardCanvasProps {
  board: Board;
  boardId: string;
  selectedId: string | null;
  targets: Record<string, TargetInfo>;
  focus: boolean;
  /** Edit Board mode (E): shows the grid and lets nodes be dragged and resized. docs/03 §1. */
  editMode: boolean;
  onSelect: (nodeId: string | null) => void;
  onActivate: (nodeId: string) => void;
  onMoveNode: (nodeId: string, pos: { x: number; y: number }) => void;
  /** Commit a group move: every member at once, as one command and one undo step. */
  onMoveNodes?: (moves: { nodeId: string; pos: { x: number; y: number } }[]) => void;
  /** Commit a new footprint. Same command bus, same undo, as a move. */
  onResizeNode: (nodeId: string, footprint: Footprint) => void;
  onStatus?: (status: BoardCanvasStatus) => void;
  /** Written every frame so the minimap can track the camera without a React render. */
  cameraRef?: React.RefObject<{ x: number; y: number; zoom: number; viewW: number; viewH: number }>;
  /** Bumped by the minimap to ask the camera to centre somewhere. */
  jumpTo?: { x: number; y: number; seq: number } | null;
  /**
   * Per-node share of real Claude usage. Drives the couriers — the little robots that carry
   * packets to whichever node is actually consuming tokens. Empty means nothing walks.
   */
  usageRoutes?: { nodeId: string; share: number }[];
  /** docs/02: state must survive without animation. With this on, no couriers walk at all. */
  reducedMotion?: boolean;
  /**
   * Create a trace between two nodes, drawn by hand on the board.
   *
   * Goes to the same command bus as every other mutation — schema-validated, snapshotted,
   * undoable — which is why the canvas asks for it rather than writing an edge itself.
   */
  onConnect?: (from: string, to: string) => void;
  /** Say something to the user. Used when a wire is refused, so a dead click explains itself. */
  onToast?: (text: string, level: 'ok' | 'warn' | 'fault') => void;
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
  /** Couriers walking right now, so the layer is never a mystery. */
  courierCount: number;
  /** Nodes in the group selection. 0 when the selection is one node or none. */
  groupCount: number;
  fps: number;
}

const PAN_KEYS: Record<string, 'up' | 'down' | 'left' | 'right'> = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right'
};

interface PanHeld { up: boolean; down: boolean; left: boolean; right: boolean; heldFrames: number }

/** One decoded, dithered image for a node, keyed so a rebuild does not re-fetch what it has. */
interface ImageCacheEntry { key: string; image: HTMLImageElement | null }

export function BoardCanvas(props: BoardCanvasProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Props the ticker and event handlers read without re-running the init effect.
  const live = useRef(props);
  live.current = props;

  /*
   * ── Why the camera lives out here ─────────────────────────────────────────────────────────────
   *
   * This used to be a local inside the init effect, and the effect was keyed on `props.board`.
   * Every board mutation replaces that object (the store re-reads the file main just wrote), so
   * moving a single node tore down the entire Pixi application and built a new one — which reset
   * the camera to 0,0 and the zoom to 3, refetched every mosaic, and re-ran the router.
   *
   * The visible symptom was the one William reported: "re-arranging the board snaps back to the
   * default camera position each time a node is moved."
   *
   * So the application is now created once per ROOM, the scene is rebuilt in place when the board
   * data changes, and the camera survives in a ref across both. It resets when you actually go
   * somewhere else, which is the only time resetting it is right.
   */
  const cameraStore = useRef<Camera>({ x: 0, y: 0, zoom: 3 });
  const rebuildRef = useRef<((board: Board) => void) | null>(null);
  const builtRef = useRef<Board | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // A different room is a different place: start at its origin. The zoom is a preference about
    // how you like to read a board, not a property of one, so it carries over.
    cameraStore.current = { x: 0, y: 0, zoom: cameraStore.current.zoom };
    builtRef.current = null;

    let disposed = false;
    let app: Application | null = null;
    const held: PanHeld = { up: false, down: false, left: false, right: false, heldFrames: 0 };

    /** The board currently drawn. Every handler reads this, never a captured prop. */
    let board: Board = props.board;
    let boardPx = boardPixelSize(board.grid);
    let rects: NodeRect[] = [];
    let drag: DragState = NO_DRAG;

    /*
     * The group selection: two or more nodes, picked with a selection box (Shift+drag on the
     * substrate in Edit Board mode) or with Shift+click. Pressing on any member moves all of them.
     *
     * Local to the canvas rather than in the store. Nothing outside the canvas acts on a group,
     * since the inspector edits one node, and it has to survive a scene rebuild after the move
     * lands. A local here does that; a prop would be re-supplied from outside on every render.
     */
    let group = new Set<string>();

    /*
     * ── Wiring ────────────────────────────────────────────────────────────────────────────────
     *
     * Click a node's edge to start a trace, click another node's edge to finish it. Not a drag:
     * the two ends can be far apart on a board this size, and a click-move-click lets you pan and
     * zoom in between. Escape, a right click, or clicking empty substrate abandons it.
     *
     * `hoverPort` is what the cursor is over; `wiring` is what has been started. Both live here
     * rather than in React state because they change on pointermove and the overlay redraws in the
     * ticker — pushing that through a render would be the same mistake the minimap avoids.
     */
    let hoverPort: Port | null = null;
    let wiring: WiringState | null = null;
    /** Cursor in world pixels, for the rubber band. */
    let wirePoint = { x: 0, y: 0 };
    let wireRefused: string | null = null;

    let world: Container | null = null;
    let substrateLayer: Container | null = null;
    let decorLayer: Container | null = null;
    let traceLayer: Container | null = null;
    let zoneLayer: Container | null = null;
    let nodeLayer: Container | null = null;
    let partLayer: Container | null = null;
    let noteLayer: Container | null = null;
    let gridLayer: Container | null = null;
    let overlayLayer: Container | null = null;
    let couriers: CourierLayer | null = null;
    /**
     * The traces as last routed, and the obstacle map they were routed against. The couriers'
     * road network, and what the router uses to generate a road where no wire runs.
     */
    let wires: Wire[] = [];
    let routeGrid: ReturnType<typeof buildRouteGrid> | null = null;
    let routeObstacles: RouteObstacle[] = [];

    const spriteById = new Map<string, Sprite>();
    /** Decor parts whose atlas key has more than one frame — the LEDs. */
    const animated: { nodeId: string; key: string; frames: number; rotation: Rotation | undefined }[] = [];
    /**
     * Precomputed pulse-glow cycles, per node. Built once from the decoded wallpaper and cycled;
     * recomputing a 320x224 backdrop's palette shift every frame would be millions of pixel
     * operations a second for decoration.
     */
    const glows = new Map<string, HTMLCanvasElement[]>();
    const faces = new Map<string, ImageCacheEntry>();
    const logos = new Map<string, ImageCacheEntry>();
    let sprites: SpriteStore | null = null;

    let placeholderCount = 0;
    let brokenCount = 0;
    let faceCount = 0;
    let routedCount = 0;
    let fallbackCount = 0;

    const viewport = (): Viewport => ({ width: app?.renderer.width ?? 0, height: app?.renderer.height ?? 0 });

    const canvasPoint = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
      if (!app) return { x: 0, y: 0 };
      const bounds = app.canvas.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };

    const nodeById = (id: string | null): BoardNode | undefined =>
      id ? board.nodes.find((n) => n.id === id) : undefined;

    /** The group as a drag needs it: where each member stands now, and how big it is. */
    const groupMembers = (): GroupMember[] =>
      [...group]
        .map((id) => nodeById(id))
        .filter((n): n is BoardNode => Boolean(n))
        .map((n) => ({ nodeId: n.id, kind: n.kind, originTile: { x: n.pos.x, y: n.pos.y }, footprint: footprintOf(n) }));

    /**
     * The corner handle's world rect for a node, or null when it should not be offered.
     *
     * Only on the SELECTED node, and only in Edit Board mode. A handle on every node would be
     * eight hit targets fighting the move gesture on a busy board; a handle on one is a control
     * you went looking for.
     */
    const handleRect = (node: BoardNode): { x: number; y: number; w: number; h: number } | null => {
      if (!live.current.editMode) return null;
      if (live.current.selectedId !== node.id) return null;
      // note.silk is text with no footprint to grab. group.zone deliberately KEEPS its handle:
      // resizing the bracket around a cluster is exactly what it is for.
      if (node.kind === 'note.silk') return null;
      const fp = footprintOf(node);
      return {
        x: node.pos.x * TILE + fp.w * TILE - HANDLE_PX,
        y: node.pos.y * TILE + fp.h * TILE - HANDLE_PX,
        w: HANDLE_PX,
        h: HANDLE_PX
      };
    };

    /* ---------------- keyboard ---------------- */

    const onKeyDown = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;

      /*
       * Shift+arrows resize the selection. The keyboard path for scaling, because
       * CLAUDE.md's definition of done requires one and a corner handle is mouse-only.
       * Checked BEFORE the pan keys, which share the arrow codes.
       */
      if (event.shiftKey && live.current.editMode && live.current.selectedId) {
        const node = nodeById(live.current.selectedId);
        const dir = PAN_KEYS[event.code];
        if (node && dir && node.kind !== 'note.silk') {
          event.preventDefault();
          const fp = footprintOf(node);
          const max = maxFootprintFor(node.kind);
          const next: Footprint = {
            w: Math.max(1, Math.min(max, fp.w + (dir === 'right' ? 1 : dir === 'left' ? -1 : 0))),
            h: Math.max(1, Math.min(max, fp.h + (dir === 'down' ? 1 : dir === 'up' ? -1 : 0)))
          };
          if (next.w !== fp.w || next.h !== fp.h) live.current.onResizeNode(node.id, next);
          return;
        }
      }

      const dir = PAN_KEYS[event.code];
      if (dir) { held[dir] = true; event.preventDefault(); return; }

      if (event.code === 'Digit1' || event.code === 'Digit2' || event.code === 'Digit3' || event.code === 'Digit4') {
        const z = Number(event.code.slice(-1));
        if (isZoom(z)) cameraStore.current = { ...cameraStore.current, zoom: z };
        event.preventDefault();
        return;
      }

      /*
       * 0: the whole board. The closest level at which all of it fits, which clampCamera then
       * centres, because a board smaller than the view is always centred. William: "I want to be
       * able to see the whole board from far away."
       */
      if (event.code === 'Digit0') {
        const view = viewport();
        cameraStore.current = clampCamera(setZoom(cameraStore.current, fitZoom(boardPx, view), view), boardPx, view);
        event.preventDefault();
        return;
      }

      // - and = step out and in, for anyone without a wheel. Centred, like the number keys.
      if (event.code === 'Minus' || event.code === 'Equal' || event.code === 'NumpadSubtract' || event.code === 'NumpadAdd') {
        const out = event.code === 'Minus' || event.code === 'NumpadSubtract';
        const view = viewport();
        const next = stepZoom(cameraStore.current.zoom, out ? -1 : 1);
        cameraStore.current = clampCamera(setZoom(cameraStore.current, next, view), boardPx, view);
        event.preventDefault();
        return;
      }

      if (event.code === 'Tab') {
        event.preventDefault();
        const next = nextInOrder(rects, live.current.selectedId, event.shiftKey ? -1 : 1);
        if (!next) return;
        live.current.onSelect(next);
        const rect = rects.find((r) => r.nodeId === next);
        if (rect && !isVisible(rect, cameraStore.current, viewport())) {
          cameraStore.current = clampCamera(
            { ...cameraStore.current, ...centreOn(rect, cameraStore.current.zoom, viewport()) },
            boardPx,
            viewport()
          );
        }
        return;
      }

      if (event.code === 'Space' || event.code === 'Enter') {
        if (live.current.selectedId) { event.preventDefault(); live.current.onActivate(live.current.selectedId); }
        return;
      }

      if (event.code === 'Escape') {
        // A half-drawn wire is the more urgent thing to cancel: Escape also leaves a room, and
        // leaving the room because you changed your mind about a trace would be a bad trade.
        if (wiring) {
          wiring = null;
          rebuildOverlay();
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        live.current.onSelect(null);
      }
    };

    /*
     * Escape with a group selected clears the group, and does nothing else.
     *
     * In the CAPTURE phase, and it stops the event there. App's own Escape leaves the room when
     * nothing is selected, and a group has no single selected node, so without this the first
     * Escape after drawing a selection box would throw you out of the room you were arranging.
     * App's listener is registered before this component's, so going first is the only way to
     * go first.
     */
    const onEscapeCapture = (event: KeyboardEvent) => {
      if (event.code !== 'Escape' || !group.size) return;
      group = new Set();
      rebuildOverlay();
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const dir = PAN_KEYS[event.code];
      if (dir) held[dir] = false;
    };

    /**
     * Losing the window drops everything being held.
     *
     * Alt-tab away mid-pan and the `keyup` is delivered to whatever you switched to, not to us —
     * so the board would keep panning by itself when you came back. Same for a drag interrupted
     * by a UAC prompt, which this app raises on purpose.
     */
    const onBlur = (): void => {
      held.up = held.down = held.left = held.right = false;
      held.heldFrames = 0;
      if (drag.kind === 'move' && drag.nodeId) placeSprite(drag.nodeId);
      drag = NO_DRAG;
      if (app) app.canvas.style.cursor = '';
    };

    /**
     * The wheel zooms, anchored on the cursor.
     *
     * It used to require Ctrl, on the reasoning that a board is a document and a document scrolls.
     * It is not: this board pans with WASD and with a drag, so the wheel had no job at all and did
     * nothing when you turned it — which reads as broken, not as reserved. Ctrl still works, so
     * nothing that was in anyone's fingers has changed.
     *
     * Anchored rather than centred: zooming toward what you are pointing at is the difference
     * between magnifying a map and being thrown across one. `setZoom` keeps the world point under
     * the cursor fixed, and `clampCamera` then pulls it back over the board if that pushed it off.
     */
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0 || !app) return;
      event.preventDefault();
      const camera = cameraStore.current;
      const next = stepZoom(camera.zoom, event.deltaY < 0 ? 1 : -1);
      if (next === camera.zoom) return;
      const anchor = canvasPoint(event);
      cameraStore.current = clampCamera(setZoom(camera, next, viewport(), anchor), boardPx, viewport());
    };

    /* ---------------- pointer: pan, move, resize ---------------- */

    /**
     * How close the cursor has to be to an edge to mean it, in WORLD pixels.
     *
     * Divided by zoom so the target is a constant number of screen pixels however far in you are.
     * A fixed world tolerance would be a 24-pixel-wide target at 4x and a 6-pixel one at 2x.
     */
    const portTolerance = (): number => 7 / cameraStore.current.zoom;

    /** The selected node's resize handle in world pixels, or null. */
    const selectedHandle = (): { x: number; y: number; w: number; h: number } | null => {
      const selected = nodeById(live.current.selectedId);
      return selected ? handleRect(selected) : null;
    };

    /**
     * The port under a world point, unless the resize handle has a better claim on it.
     *
     * The handle is in the node's bottom-right CORNER, where the east and south edges meet, and a
     * port is hit-tested along the whole length of an edge — so without this every press on the
     * handle was also a press on two ports and wiring took all of them. See `portUnderPoint`.
     */
    const portUnder = (x: number, y: number): Port | null =>
      portUnderPoint(rects, x, y, portTolerance(), selectedHandle());

    /** Is the cursor claiming the resize handle rather than an edge? */
    const overResizeHandle = (x: number, y: number): boolean => {
      const handle = selectedHandle();
      if (!handle) return false;
      const pad = portTolerance();
      return (
        x >= handle.x - pad && x <= handle.x + handle.w + pad &&
        y >= handle.y - pad && y <= handle.y + handle.h + pad
      );
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!app) return;
      const screen = canvasPoint(event);
      const camera = cameraStore.current;
      const point = screenToWorld(camera, screen.x, screen.y);

      /*
       * Wiring takes precedence over every other gesture, but only in Edit Board mode, only when
       * the cursor is actually on an edge, and never over the resize handle. Browsing a board
       * involves a lot of clicking near components, and a click that starts a trace by accident
       * would be worse than no feature.
       */
      if (live.current.editMode && event.button === 0 && !overResizeHandle(point.x, point.y)) {
        const port = portUnder(point.x, point.y);

        if (wiring && port) {
          const refusal = wireRefusal(wiring.from, port, board.edges);
          if (refusal) {
            wireRefused = refusal;
            live.current.onToast?.(refusal, 'warn');
          } else {
            void commitWire(wiring.from, port);
            wiring = null;
          }
          rebuildOverlay();
          return;
        }

        if (port) {
          wiring = { from: port };
          wireRefused = null;
          wirePoint = point;
          rebuildOverlay();
          return;
        }

        if (wiring) {
          // Clicking open substrate abandons it. An in-progress wire that survives a click
          // somewhere else is a wire you have to fight to get rid of.
          wiring = null;
          rebuildOverlay();
          return;
        }
      } else if (wiring) {
        /*
         * Grabbing the resize handle mid-wire abandons the wire and resizes — one gesture, not
         * two. Making the first press cancel and the second resize would mean the handle needs
         * clicking twice for no reason the user can see.
         */
        wiring = null;
        hoverPort = null;
        rebuildOverlay();
      }

      const hit = hitTest(rects, point.x, point.y);
      const node = hit ? nodeById(hit.nodeId) : undefined;

      const handle = node ? handleRect(node) : null;
      const onHandle = Boolean(
        handle &&
        point.x >= handle.x && point.x <= handle.x + handle.w &&
        point.y >= handle.y && point.y <= handle.y + handle.h
      );

      drag = beginDrag({
        button: event.button,
        screen,
        camera,
        hit,
        editMode: live.current.editMode,
        nodeTile: node ? { x: node.pos.x, y: node.pos.y } : null,
        nodeFootprint: node ? footprintOf(node) : null,
        onResizeHandle: onHandle,
        shiftKey: event.shiftKey,
        group: groupMembers()
      });

      if (drag.kind !== 'none') {
        /*
         * Capture the pointer so a drag that leaves the window still tracks and still ends.
         *
         * In a try: setPointerCapture throws InvalidStateError for a pointerId the element has
         * never seen, and an exception here would abandon the gesture before the cursor is even
         * set. The capture is a nicety — pointermove and pointerup are on `window` precisely so a
         * drag that leaves the canvas still completes — so failing to get it must not cost the
         * drag itself.
         */
        try { app.canvas.setPointerCapture(event.pointerId); } catch { /* the window listeners carry it */ }
        app.canvas.style.cursor =
          drag.kind === 'resize' ? 'nwse-resize'
            : drag.kind === 'move' || drag.kind === 'group' ? 'grabbing'
              : drag.kind === 'marquee' ? 'crosshair' : 'move';
      }
    };

    /** Hand a finished wire to the command bus. */
    const commitWire = (from: Port, to: Port): void => {
      live.current.onConnect?.(from.nodeId, to.nodeId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!app) return;
      const screen = canvasPoint(event);

      /*
       * Port hovering. Only in Edit Board mode, and only when no drag is under way — a glowing dot
       * appearing while you are dragging a component would be noise pointing at a gesture you
       * cannot start.
       */
      if (live.current.editMode && drag.kind === 'none') {
        const point = screenToWorld(cameraStore.current, screen.x, screen.y);
        // `portUnder`, not `portAt`: the resize handle keeps its corner, so no dot lights over it
        // and the block below can set the resize cursor without something else fighting for it.
        const port = portUnder(point.x, point.y);
        const changed =
          port?.nodeId !== hoverPort?.nodeId ||
          port?.side !== hoverPort?.side ||
          (wiring !== null && (point.x !== wirePoint.x || point.y !== wirePoint.y));
        hoverPort = port;
        wirePoint = point;
        if (port) app.canvas.style.cursor = 'crosshair';
        else if (app.canvas.style.cursor === 'crosshair') app.canvas.style.cursor = '';
        if (changed) rebuildOverlay();
      } else if (hoverPort) {
        hoverPort = null;
        rebuildOverlay();
      }

      if (drag.kind === 'none') {
        // Hovering the handle says it is grabbable before you try. Cheap, and it is the only
        // thing that makes a small target discoverable. Canvas only — this listener is on the
        // window now, so it also sees moves over the inspector.
        if (event.target !== app.canvas) return;
        const node = nodeById(live.current.selectedId);
        const handle = node ? handleRect(node) : null;
        if (handle) {
          const point = screenToWorld(cameraStore.current, screen.x, screen.y);
          const over =
            point.x >= handle.x && point.x <= handle.x + handle.w &&
            point.y >= handle.y && point.y <= handle.y + handle.h;
          app.canvas.style.cursor = over ? 'nwse-resize' : '';
        } else if (app.canvas.style.cursor === 'nwse-resize') {
          app.canvas.style.cursor = '';
        }
        return;
      }

      if (!drag.exceeded) {
        if (!exceedsThreshold(drag, screen)) return;
        drag = { ...drag, exceeded: true };
      }

      const camera = cameraStore.current;

      if (drag.kind === 'pan') {
        cameraStore.current = clampCamera({ ...camera, ...panTo(drag, screen, camera.zoom) }, boardPx, viewport());
        return;
      }

      if (drag.kind === 'marquee') {
        drag = { ...drag, currentScreen: { ...screen } };
        rebuildOverlay();
        return;
      }

      /*
       * A group drag moves every member's sprite a whole tile at a time, the same presentation a
       * single move has, and the data is untouched until the drop. Recomputed only when the offset
       * actually changes, which is at most once per tile rather than once per pointer event.
       */
      if (drag.kind === 'group' && drag.members) {
        const members = drag.members;
        const delta = groupDelta(drag, screen, camera.zoom);
        if (drag.delta && delta.dx === drag.delta.dx && delta.dy === drag.delta.dy) return;
        drag = { ...drag, delta, valid: canDropGroup(members, delta, rects, board.grid) };
        for (const target of groupTargets(members, delta)) placeSpriteAt(target.nodeId, target.pos);
        return;
      }

      const node = nodeById(drag.nodeId);
      if (!node) return;

      if (drag.kind === 'resize') {
        const next = resizeTo(drag, screen, camera.zoom, maxFootprintFor(node.kind));
        drag = {
          ...drag,
          currentFootprint: next,
          valid: canDrop(node.id, { x: node.pos.x, y: node.pos.y }, next, rects, board.grid, node.kind)
        };
        return;
      }

      const tile = moveTo(drag, screen, camera.zoom);
      const fp = footprintOf(node);
      drag = { ...drag, currentTile: tile, valid: canDrop(node.id, tile, fp, rects, board.grid, node.kind) };

      /*
       * Move the SPRITE, not just the ghost outline.
       *
       * William: "ideally be able to see the node moving unit by unit to where it is being
       * dragged". The ghost alone left the component sitting at its old address while a rectangle
       * floated around, which reads as a preview of a move rather than a move. The sprite steps a
       * whole tile at a time because `moveTo` snaps — so it stays on the grid the whole way and
       * never lands on a fractional pixel.
       *
       * The board data is untouched until the drop. This is presentation; the commit is the
       * command bus, with its undo entry, exactly as before.
       */
      const sprite = spriteById.get(node.id);
      if (sprite) {
        const off = textureOffset(displayOf(node).name ? node.name : undefined, titleSize(node), node.frame);
        sprite.x = tile.x * TILE - off.x;
        sprite.y = tile.y * TILE - off.y;
      }
    };

    const endDrag = (event: PointerEvent) => {
      if (drag.kind === 'none' || !app) return;
      try { app.canvas.releasePointerCapture(event.pointerId); } catch { /* already released */ }
      app.canvas.style.cursor = '';

      // A press that never exceeded the threshold is a click, and a click selects.
      if (!drag.exceeded && event.button === 0) {
        const screen = canvasPoint(event);
        const point = screenToWorld(cameraStore.current, screen.x, screen.y);
        const hit = hitTest(rects, point.x, point.y);
        // Shift+click in Edit Board mode adds a node to the group, or takes it out again.
        if (live.current.editMode && event.shiftKey) {
          if (hit) toggleInGroup(hit.nodeId);
        } else {
          if (group.size) { group = new Set(); rebuildOverlay(); }
          live.current.onSelect(hit ? hit.nodeId : null);
        }
      } else if (drag.kind === 'marquee' && drag.currentScreen) {
        const camera = cameraStore.current;
        const a = screenToWorld(camera, drag.originScreen.x, drag.originScreen.y);
        const b = screenToWorld(camera, drag.currentScreen.x, drag.currentScreen.y);
        drag = NO_DRAG;
        adoptSelection(selectInRect(rects, marqueeRect(a, b)));
      } else if (shouldCommitGroup(drag) && drag.members && drag.delta) {
        live.current.onMoveNodes?.(groupTargets(drag.members, drag.delta));
      } else if (drag.kind === 'group' && drag.members) {
        // Refused or abandoned: every sprite back where the data still says it is.
        for (const member of drag.members) placeSprite(member.nodeId);
      } else if (shouldCommit(drag) && drag.nodeId && drag.currentTile) {
        live.current.onMoveNode(drag.nodeId, drag.currentTile);
      } else if (shouldCommitResize(drag) && drag.nodeId && drag.currentFootprint) {
        live.current.onResizeNode(drag.nodeId, drag.currentFootprint);
      } else if (drag.kind === 'move' && drag.nodeId) {
        // An illegal or abandoned move: put the sprite back where the data still says it is.
        placeSprite(drag.nodeId);
      }

      drag = NO_DRAG;
    };

    const onDoubleClick = (event: MouseEvent) => {
      if (!app) return;
      const screen = canvasPoint(event);
      const point = screenToWorld(cameraStore.current, screen.x, screen.y);
      const hit = hitTest(rects, point.x, point.y);
      if (hit) live.current.onActivate(hit.nodeId);
    };

    /* ---------------- drawing ---------------- */

    /**
     * A room drive prints its STEM plus an auto-appended `OS`. Everything else prints its name.
     * Tolerant of the seeded boards, which store `MinecraftOS` — `roomStem` strips it either way.
     */
    const plateTitle = (node: BoardNode): string =>
      node.kind === 'drive.room' ? roomTitle(node.name).stem : node.name;

    /**
     * The title's size. Only a room offers 22 — a component's nameplate at 22 is taller than the
     * component, and the point of a room title is that it IS a heading.
     */
    const titleSize = (node: BoardNode): 11 | 22 =>
      node.kind === 'drive.room' && node.size === 22 ? 22 : 11;

    /**
     * The suffix, styled: one size down, in copper-dark by default with a mask-dark outline.
     *
     * "a few shades darker, into gray, with a thin black stroke" — the locked palette has no true
     * grey, so copper-dark is its darker desaturated tone and mask-dark is its near-black. Both
     * are overridable per node with the ordinary text tokens.
     */
    const roomSuffixFor = (node: BoardNode) => {
      if (node.kind !== 'drive.room') return null;
      const { suffix } = roomTitle(node.name);
      return {
        text: suffix,
        size: suffixSize(node.size === 22 ? 22 : 11),
        color: resolveToken(node.textColor === undefined ? 'copper-dark' : node.textColor, board.theme, COPPER_DARK),
        stroke: resolveToken(node.textStroke === undefined ? 'mask-dark' : node.textStroke, board.theme, board.theme.maskDark)
      };
    };

    /** `lift` brightens the title along the room's ramp — the nameplate half of the text pulse. */
    const nameStyleFor = (node: BoardNode, lift = 0) => {
      const base = resolveToken(node.textColor, board.theme);
      return {
        color: lift > 0 ? brighten(base, lift, board.theme) : base,
        stroke: node.textStroke ? resolveToken(node.textStroke, board.theme, COPPER_DARK) : null,
        plateFill: resolveToken(node.plateColor, board.theme, board.theme.maskLight),
        plateBorder: resolveToken(node.plateBorder, board.theme, SILK_HEX)
      };
    };

    /**
     * Make a list of ids THE selection.
     *
     * One id is an ordinary selection: the inspector opens and the resize handle appears. Two or
     * more is a group, which the inspector cannot edit, so it closes and the members are outlined
     * instead. None clears both.
     */
    const adoptSelection = (ids: string[]): void => {
      if (ids.length >= 2) {
        group = new Set(ids);
        live.current.onSelect(null);
      } else {
        group = new Set();
        live.current.onSelect(ids[0] ?? null);
      }
      rebuildOverlay();
    };

    /** Shift+click. Extends from the node already selected, so the first Shift+click makes a pair. */
    const toggleInGroup = (nodeId: string): void => {
      const next = new Set(group);
      const primary = live.current.selectedId;
      if (primary && next.size === 0) next.add(primary);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      adoptSelection([...next]);
    };

    /** Put a node's sprite on a tile without touching the data: a drag in progress. */
    const placeSpriteAt = (nodeId: string, tile: { x: number; y: number }): void => {
      const node = nodeById(nodeId);
      const sprite = spriteById.get(nodeId);
      if (!node || !sprite) return;
      if (node.kind === 'decor.part') {
        // A part is drawn at its tile with no nameplate offset; see drawNode.
        sprite.x = tile.x * TILE;
        sprite.y = tile.y * TILE;
        return;
      }
      const off = textureOffset(displayOf(node).name ? node.name : undefined, titleSize(node), node.frame);
      sprite.x = tile.x * TILE - off.x;
      sprite.y = tile.y * TILE - off.y;
    };

    /** Put a node's sprite where the board data says it belongs. */
    const placeSprite = (nodeId: string): void => {
      const node = nodeById(nodeId);
      const sprite = spriteById.get(nodeId);
      if (!node || !sprite) return;
      const off = textureOffset(displayOf(node).name ? node.name : undefined, titleSize(node), node.frame);
      sprite.x = node.pos.x * TILE - off.x;
      sprite.y = node.pos.y * TILE - off.y;
    };

    /**
     * Everything the placeholder needs to draw one node.
     *
     * ── Why this is a function and not three inlined objects ──────────────────────────────────
     *
     * It was three: `drawNode`, the pulse-glow ticker, and the text-glow ticker each built their
     * own spec. They drifted, and the drift was invisible until frames arrived — the glow ticker
     * did not pass `frame`, `priority`, `nameSize`, `nameStyle` or the room suffix, so every pulse
     * redrew the node stripped of all of them and the next rebuild put them back. The board
     * flickered between framed and unframed several times a second, on exactly the nodes that were
     * glowing, which is why it looked like the frame was leaking across the board.
     *
     * A spec assembled in one place cannot disagree with itself. Anything added to a node's
     * appearance from now on is added here, once.
     */
    const specFor = (node: BoardNode, opts: { face?: HTMLImageElement | HTMLCanvasElement | null; textLift?: number } = {}) => {
      const fp = footprintOf(node);
      const show = displayOf(node);
      const lift = opts.textLift ?? 0;
      return {
        w: fp.w,
        h: fp.h,
        designator: show.designator ? node.designator ?? '' : '',
        name: show.name ? plateTitle(node) : undefined,
        kind: node.kind,
        maskLight: board.theme.maskLight,
        maskDark: board.theme.maskDark,
        signal: board.theme.signal,
        face: show.thumbnail ? (opts.face !== undefined ? opts.face : faces.get(node.id)?.image ?? null) : null,
        logo: show.logo ? logos.get(node.id)?.image ?? null : null,
        nameSize: titleSize(node),
        frame: node.frame,
        priority: node.priority,
        nameStyle: nameStyleFor(node, node.textGlow ? lift : 0),
        suffix: show.name ? roomSuffixFor(node) : null
      };
    };

    /** Redraw one node's texture from whatever images it currently has. */
    const drawNode = (nodeId: string, textLift = 0): void => {
      const node = nodeById(nodeId);
      const sprite = spriteById.get(nodeId);
      if (!node || !sprite || !sprites) return;
      const fp = footprintOf(node);
      const show = displayOf(node);

      /*
       * A decor part IS its atlas sprite — the first thing on this board whose pixels come from a
       * real tilesheet rather than from component-art.ts. No nameplate, no designator, no face:
       * a via with a label over it is not a via.
       *
       * Scaled by a whole number only. The cells are 16px and the tile is 16px, so a 1x1 part is
       * 1:1 and a 3x3 part is exactly 3x — anything fractional would be the one blurred thing on
       * the board, which docs/02 treats as a crash-severity bug.
       */
      if (node.kind === 'decor.part') {
        const key = spriteKeyOf(node);
        const texture = sprites.get(key, 0, node.rotation);
        if (texture) {
          sprite.texture = texture;
          sprite.scale.set(Math.max(1, Math.min(fp.w, fp.h)));
        }
        sprite.x = node.pos.x * TILE;
        sprite.y = node.pos.y * TILE;
        return;
      }
      sprite.texture = sprites.placeholder(specFor(node, { textLift }));
      placeSprite(nodeId);
    };

    /**
     * Fetch a node's wallpaper and logo, unless the identical ones are already decoded.
     *
     * The cache key carries everything that changes the pixels — the source path and the box it
     * is drawn into — so dragging a node re-renders nothing, while resizing it or repointing it
     * at another file refetches exactly what changed. Without this, a scene rebuild on every edit
     * would re-request every mosaic on the board for every keystroke.
     */
    const loadImages = (node: BoardNode): void => {
      const fp = footprintOf(node);
      const wants: { slot: 'face' | 'logo'; source: string | undefined; store: Map<string, ImageCacheEntry> }[] = [
        { slot: 'face', source: node.image, store: faces },
        { slot: 'logo', source: node.logo, store: logos }
      ];

      const show = displayOf(node);
      for (const { slot, source, store } of wants) {
        // A slot that is switched off asks main for nothing. The image stays BOUND to the node —
        // only the drawing of it is off — so turning it back on costs a cached mosaic read.
        const wanted = slot === 'face' ? show.thumbnail : show.logo;
        if (!source || !wanted) { store.delete(node.id); continue; }
        // The rotation is part of the key. Without it, turning a backdrop would leave the old
        // mosaic in the cache and nothing would happen — the same shape as the pulse-glow
        // checkbox that did nothing because its work sat inside a fetch that was being skipped.
        // Everything that changes the pixels is in the key: the file, the box it is drawn into,
        // the rotation, and the logo's own scale. Leave one out and the setting appears to do
        // nothing, because the cached image is returned unchanged — see the pulse-glow checkbox.
        const key = `${source}@${fp.w}x${fp.h}r${node.rotation ?? 0}s${node.logoScale ?? 100}`;
        if (store.get(node.id)?.key === key) continue;
        store.set(node.id, { key, image: null });

        void window.skynet['mosaic:forNode'](live.current.boardId, node.id, slot).then(async (result) => {
          if (disposed) return;
          if (!result.ok) { console.warn(`[mosaic] ${node.id} ${slot}: ${result.error}`); return; }
          const img = new Image();
          img.src = result.dataUrl;
          await img.decode();
          if (disposed || store.get(node.id)?.key !== key) return;
          store.set(node.id, { key, image: img });
          if (slot === 'face') {
            faceCount++;
            glows.delete(node.id);
            /*
             * The glow is built from the DITHERED mosaic, not the source file — it is a shift
             * along the ramp the mosaic was already quantised onto, so it has to start from the
             * quantised pixels. Built here, once, the moment those pixels exist.
             */
            if (node.pulseGlow && !live.current.reducedMotion) {
              const frames = buildGlowFrames(img, board.theme);
              if (frames.length) glows.set(node.id, frames);
            }
          }
          drawNode(node.id);
        }).catch((err: unknown) => console.warn(`[mosaic] ${node.id} ${slot} failed`, err));
      }
    };

    /**
     * The real on-screen size of a printed text node.
     *
     * William: "the bounding boxes of the text node does not expand to fit the text within."
     * layout.ts is pure so it can be tested, and measuring text needs a canvas — so it takes this
     * as a callback and falls back to arithmetic when nobody supplies one.
     */
    const measureNode = (node: BoardNode): { w: number; h: number } | null => {
      if (node.kind !== 'note.silk') return null;
      return measureTextBlock(node, board.theme);
    };

    const clearLayer = (layer: Container | null): void => {
      layer?.removeChildren().forEach((c) => c.destroy({ children: true }));
    };

    const buildTraces = (): void => {
      if (!traceLayer) return;
      clearLayer(traceLayer);

      /*
       * A* on the half-grid with every mounted footprint as an obstacle, so a trace goes AROUND a
       * component instead of through it. Hand-placed waypoints in the board JSON still win, and a
       * route A* cannot find falls back to the two-bend Z rather than vanishing.
       */
      const routed: RoutedEdge[] = [];
      const rectById = new Map(board.nodes.map((n) => [n.id, nodeRect(n)] as const));
      const obstacles: RouteObstacle[] = board.nodes
        .filter((n) => !isPrinted(n.kind))
        .map((n) => ({ ...nodeRect(n), nodeId: n.id }));
      const grid = buildRouteGrid(obstacles, boardPx);
      routeGrid = grid;
      routeObstacles = obstacles;

      routedCount = 0;
      fallbackCount = 0;
      for (const edge of board.edges) {
        const from = rectById.get(edge.from);
        const to = rectById.get(edge.to);
        if (!from || !to) continue;

        let points: Point[] | null = null;
        if (edge.waypoints?.length) {
          points = routeOrthogonal(from, to, edge.waypoints, board.grid.tile);
        } else {
          const path = routeAStar(
            { from: { ...from, nodeId: edge.from }, to: { ...to, nodeId: edge.to }, obstacles, boardPx },
            grid
          );
          if (path) { points = attachEndpoints(path, from, to); routedCount++; }
        }
        if (!points) {
          points = routeOrthogonal(from, to, edge.waypoints, board.grid.tile);
          if (!edge.waypoints?.length) fallbackCount++;
        }

        routed.push({ edge, points, style: styleFor(edge, board.theme.signal) });
      }
      console.info(`[router] ${routedCount} auto-routed, ${fallbackCount} fell back to a direct run`);
      traceLayer.addChild(buildTraceLayer(routed));
      // The same polylines that were just drawn, so a courier walks exactly the copper on screen.
      wires = routed.map((r) => ({ id: r.edge.id, from: r.edge.from, to: r.edge.to, points: r.points }));
    };

    const buildNodes = (): void => {
      if (!nodeLayer || !decorLayer || !partLayer || !sprites) return;
      clearLayer(nodeLayer);
      clearLayer(decorLayer);
      clearLayer(partLayer);
      spriteById.clear();

      placeholderCount = 0;
      animated.length = 0;
      glowingPlates = [];
      for (const node of board.nodes) {
        if (node.kind === 'note.silk' || node.kind === 'group.zone') continue;
        const key = spriteKeyOf(node);
        if (!sprites.has(key)) placeholderCount++;

        const sprite = new Sprite(sprites.get(key) ?? undefined);
        sprite.roundPixels = true;
        /*
         * Three layers, by kind, and all three sit UNDER the components: a backdrop is scenery the
         * board stands on, and a part is a feature of the board itself — a via, a screw, a pad
         * array — so a chip soldered over it hides it, which is what a chip does to the pads
         * underneath. The paint order that decides this is where the layers are added to `world`;
         * see the comment there.
         *
         * All three are nodes in every other respect — selectable in Edit Board mode, movable,
         * resizable, undoable.
         */
        const layer = node.kind === 'decor.image' ? decorLayer
          : node.kind === 'decor.part' ? partLayer
            : nodeLayer;
        layer.addChild(sprite);
        spriteById.set(node.id, sprite);
        drawNode(node.id);
        loadImages(node);

        if (node.kind === 'decor.part') {
          const frames = sprites.frameCountFor(key);
          // The rotation travels WITH the entry. Without it the ticker would re-fetch an
          // unrotated texture every pulse and an angled LED would snap upright twelve times a
          // second — the same shape as the frame flicker, for the same reason.
          if (frames > 1) animated.push({ nodeId: node.id, key, frames, rotation: node.rotation });
        }
        if (node.textGlow && displayOf(node).name) glowingPlates.push(node.id);
      }

      // Drop cached images for nodes that no longer exist, so a long editing session does not
      // accumulate decoded bitmaps for deleted components.
      const alive = new Set(board.nodes.map((n) => n.id));
      for (const store of [faces, logos]) {
        for (const id of [...store.keys()]) if (!alive.has(id)) store.delete(id);
      }
      /*
       * Reconcile the glow cycles against what the board now says.
       *
       * Both directions matter and only one of them used to happen. Dropping a cycle when the
       * node is gone or its glow is off was here; BUILDING one when the glow was just switched on
       * was not, because that only happened when a mosaic arrived — and `loadImages` skips the
       * fetch when the image has not changed, which is precisely the case when you tick a box.
       */
      for (const id of [...glows.keys()]) {
        const node = nodeById(id);
        if (!alive.has(id) || !node?.pulseGlow) glows.delete(id);
      }
      for (const node of board.nodes) {
        if (!node.pulseGlow || glows.has(node.id)) continue;
        if (live.current.reducedMotion) continue;
        const face = faces.get(node.id)?.image;
        if (!face) continue; // The image is still loading; its own arrival will build the cycle.
        const frames = buildGlowFrames(face, board.theme);
        if (frames.length) glows.set(node.id, frames);
      }
    };

    const buildZones = (): void => {
      if (!zoneLayer) return;
      clearLayer(zoneLayer);
      for (const node of board.nodes) {
        if (node.kind === 'group.zone') zoneLayer.addChild(buildZone(node, board.theme.signal));
      }
    };

    /** Text nodes whose glow is on, so the ticker knows which ones to re-render. */
    let glowingNotes: string[] = [];
    /**
     * Nodes whose NAMEPLATE pulses. Separate from `glowingNotes` because a nameplate is part of a
     * component's texture and a note is its own sprite, so they are redrawn by different code.
     */
    let glowingPlates: string[] = [];

    const buildNotes = (glowStep = 0): void => {
      if (!noteLayer) return;
      clearLayer(noteLayer);
      glowingNotes = [];
      for (const node of board.nodes) {
        if (node.kind !== 'note.silk') continue;
        const note = buildSilkNote(node, board.theme, node.textGlow ? glowStep : 0);
        if (note) noteLayer.addChild(note);
        if (node.textGlow) glowingNotes.push(node.id);
      }
    };

    const buildGrid = (): void => {
      if (!gridLayer) return;
      clearLayer(gridLayer);
      if (!live.current.editMode) return;
      // A 1px dot at every tile corner. Dots, not lines: a full grid of lines over the whole
      // board is louder than the board itself and you cannot see the components any more.
      const g = new Graphics();
      for (let ty = 0; ty <= board.grid.height; ty++) {
        for (let tx = 0; tx <= board.grid.width; tx++) {
          g.rect(tx * TILE, ty * TILE, 1, 1);
        }
      }
      g.fill({ color: hexToNumber(SILK), alpha: 0.35 });
      g.roundPixels = true;
      gridLayer.addChild(g);
    };

    const rebuildOverlay = (): void => {
      if (!overlayLayer) return;
      clearLayer(overlayLayer);

      const { targets, selectedId } = live.current;
      brokenCount = 0;
      for (const node of board.nodes) {
        const info = targets[node.id];
        if (!info || !isBroken(info)) continue;
        if (node.kind === 'note.silk' || node.kind === 'group.zone') continue;
        brokenCount++;
        const color = info.state === 'outside-dev-root' || info.state === 'unset' ? WARN : FAULT;
        overlayLayer.addChild(buildBrokenOverlay(nodeRect(node), color));
      }

      const selected = nodeById(selectedId);
      if (selected) {
        overlayLayer.addChild(buildSelectionOverlay(nodeRect(selected), board.theme.signal));

        // The resize handle: a filled corner square with a silk edge, on the selected node only.
        const handle = handleRect(selected);
        if (handle) {
          const g = new Graphics();
          g.rect(handle.x, handle.y, handle.w, handle.h);
          g.fill({ color: hexToNumber(board.theme.signal) });
          g.rect(handle.x, handle.y, handle.w, 1);
          g.rect(handle.x, handle.y, 1, handle.h);
          g.fill({ color: hexToNumber(SILK) });
          g.roundPixels = true;
          overlayLayer.addChild(g);
        }
      }

      /*
       * The group. Every member outlined, the same vocabulary as a single selection; while the
       * group is being dragged, a ghost where each member would land instead, in fault red if the
       * group as a whole cannot land there.
       */
      const draggingGroup = drag.kind === 'group' && drag.exceeded && drag.members && drag.delta;
      if (!draggingGroup) {
        for (const id of group) {
          const node = nodeById(id);
          if (node) overlayLayer.addChild(buildSelectionOverlay(nodeRect(node), board.theme.signal));
        }
      } else if (drag.members && drag.delta) {
        const color = drag.valid ? board.theme.signal : FAULT;
        for (const target of groupTargets(drag.members, drag.delta)) {
          const node = nodeById(target.nodeId);
          if (node) overlayLayer.addChild(buildSelectionOverlay(nodeRect({ ...node, pos: target.pos }), color));
        }
      }

      /*
       * The selection box: a frame in the room's signal colour, no fill, nothing translucent.
       * Its line is one SCREEN pixel at every zoom, so it does not vanish at 1/4x, where a
       * one-world-pixel line would be a quarter of a pixel wide.
       */
      if (drag.kind === 'marquee' && drag.exceeded && drag.currentScreen) {
        const camera = cameraStore.current;
        const box = marqueeRect(
          screenToWorld(camera, drag.originScreen.x, drag.originScreen.y),
          screenToWorld(camera, drag.currentScreen.x, drag.currentScreen.y)
        );
        const t = Math.max(1, Math.round(1 / camera.zoom));
        const x = Math.round(box.x);
        const y = Math.round(box.y);
        const w = Math.max(t, Math.round(box.w));
        const h = Math.max(t, Math.round(box.h));
        const frame = new Graphics();
        frame.rect(x, y, w, t);
        frame.rect(x, y + h - t, w, t);
        frame.rect(x, y, t, h);
        frame.rect(x + w - t, y, t, h);
        frame.fill({ color: hexToNumber(board.theme.signal) });
        frame.roundPixels = true;
        overlayLayer.addChild(frame);
      }

      // Drag ghost: where the node would land, or what size it would become. Signal if legal,
      // fault if not — same vocabulary as selection, nothing translucent or blurred.
      const ghostNode = nodeById(drag.nodeId);
      if (ghostNode && drag.exceeded && (drag.kind === 'move' || drag.kind === 'resize')) {
        const tile = drag.kind === 'move' && drag.currentTile ? drag.currentTile : ghostNode.pos;
        const fp = drag.kind === 'resize' && drag.currentFootprint ? drag.currentFootprint : footprintOf(ghostNode);
        const ghost = {
          nodeId: ghostNode.id,
          kind: ghostNode.kind,
          x: tile.x * TILE,
          y: tile.y * TILE,
          w: fp.w * TILE,
          h: fp.h * TILE
        };
        const color = drag.valid ? board.theme.signal : FAULT;
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

      /*
       * ── Wiring ──────────────────────────────────────────────────────────────────────────────
       *
       * A dot on the hovered edge, and a rubber band from the started end to the cursor.
       *
       * Both are drawn with filled rects rather than strokes or circles. A 1px stroke straddles
       * the pixel boundary and a circle at this size is a smear — docs/02 §Anti-mush. A "glowing"
       * dot is therefore three concentric squares in the theme ramp, which is what a glow looks
       * like when you only have whole pixels to say it with.
       */
      /*
       * The live wiring state on `window`, for the smoke harness.
       *
       * Same reasoning as `__skynetCamera`: a test that computes where a port OUGHT to be is
       * testing its own arithmetic, and when the two disagree it reports a failure that is not
       * real. This is where the port actually is, according to the code that draws it.
       */
      (window as unknown as { __skynetWire?: unknown }).__skynetWire = {
        hover: hoverPort ? { nodeId: hoverPort.nodeId, side: hoverPort.side, x: hoverPort.x, y: hoverPort.y } : null,
        wiring: wiring ? wiring.from.nodeId : null,
        refused: wireRefused
      };

      if (live.current.editMode) {
        const drawPort = (port: Port, lit: boolean): void => {
          const g = new Graphics();
          const x = Math.round(port.x);
          const y = Math.round(port.y);
          if (lit) {
            g.rect(x - 3, y - 3, 6, 6);
            g.fill({ color: hexToNumber(board.theme.maskDark) });
          }
          g.rect(x - 2, y - 2, 4, 4);
          g.fill({ color: hexToNumber(board.theme.signal) });
          g.rect(x - 1, y - 1, 2, 2);
          g.fill({ color: hexToNumber(SILK) });
          g.roundPixels = true;
          overlayLayer!.addChild(g);
        };

        // The end already chosen stays lit, so it is obvious which wire is being drawn.
        if (wiring) drawPort(wiring.from, true);
        if (hoverPort && (!wiring || hoverPort.nodeId !== wiring.from.nodeId)) drawPort(hoverPort, true);

        if (wiring) {
          /*
           * The rubber band. Snapped to the hovered port when there is one, so the moment before
           * the click looks exactly like the trace that is about to exist.
           *
           * Drawn as an L, horizontal then vertical, because that is what the router will actually
           * lay down — a diagonal preview followed by a right-angled trace would be a preview that
           * lies. Fault red when the target would be refused.
           */
          const end = hoverPort ?? { x: wirePoint.x, y: wirePoint.y };
          const refusal = hoverPort ? wireRefusal(wiring.from, hoverPort, board.edges) : null;
          const colour = refusal ? FAULT : board.theme.signal;

          const g = new Graphics();
          const x0 = Math.round(wiring.from.x);
          const y0 = Math.round(wiring.from.y);
          const x1 = Math.round(end.x);
          const y1 = Math.round(end.y);
          g.rect(Math.min(x0, x1), y0, Math.abs(x1 - x0) + 1, 1);
          g.rect(x1, Math.min(y0, y1), 1, Math.abs(y1 - y0) + 1);
          g.fill({ color: hexToNumber(colour) });
          g.roundPixels = true;
          overlayLayer.addChild(g);
        }
      }
    };

    /**
     * Turn per-node usage shares into walkable routes, along the wires.
     *
     * The source is the JARVIS head when the board has one: the packets are its errands. A room has
     * no head, so its best-connected node stands in, the node its traces already radiate from. See
     * courier-paths.ts.
     */
    const buildCourierRoutes = (): void => {
      if (!couriers) return;
      const shares = live.current.usageRoutes ?? [];
      if (!shares.length) { couriers.setRoutes([]); return; }

      const hub = nodeById(courierHub(board.nodes, wires));

      /*
       * The road to one destination, best first:
       *   1. along the drawn traces, because the wires are the paths;
       *   2. where no wire joins the two, a trace the router generates on the spot, around the
       *      components, with the same A* that lays the copper, so the walk still looks like one;
       *   3. from the nearest board edge, for a board with no wiring at all, or for a room's hub,
       *      which has no hub of its own to be sent from.
       */
      const roadTo = (node: BoardNode): Point[] => {
        if (hub && hub.id !== node.id) {
          const wired = wirePath(hub.id, node.id, wires);
          if (wired) return wired;
          const from = nodeRect(hub);
          const to = nodeRect(node);
          if (routeGrid) {
            const path = routeAStar(
              { from: { ...from, nodeId: hub.id }, to: { ...to, nodeId: node.id }, obstacles: routeObstacles, boardPx },
              routeGrid
            );
            if (path) return attachEndpoints(path, from, to);
          }
          return routeOrthogonal(from, to, undefined, board.grid.tile);
        }
        const r = nodeRect(node);
        const centre = { x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) };
        return elbowPath(courierSource(null, centre, boardPx), centre);
      };

      const routes: CourierRoute[] = [];
      for (const share of shares) {
        const node = nodeById(share.nodeId);
        if (!node || share.share <= 0) continue;
        // The JARVIS head does not send packets to itself. A room's stand-in hub does receive
        // them, from the edge, since its work is somebody's work too.
        if (hub && node.id === hub.id && hub.kind === 'agent.jarvis') continue;
        routes.push({ nodeId: node.id, path: roadTo(node), share: share.share, color: courierColor(node.id) });
      }
      couriers.setRoutes(routes);
    };

    const applyFocus = (): void => {
      const { focus, selectedId } = live.current;
      if (!focus || !selectedId) {
        for (const sprite of spriteById.values()) sprite.alpha = 1;
        return;
      }
      const related = new Set<string>([selectedId]);
      for (const edge of board.edges) {
        if (edge.from === selectedId) related.add(edge.to);
        if (edge.to === selectedId) related.add(edge.from);
      }
      for (const [id, sprite] of spriteById) sprite.alpha = related.has(id) ? 1 : 0.25;
    };

    /**
     * Redraw the scene for a new version of the board, in place.
     *
     * The substrate is the one layer that is NOT rebuilt: it is a deterministic function of the
     * grid and the theme seed, it is the most expensive thing here, and nothing an edit can do
     * changes it unless the room itself changed — in which case the whole application is being
     * recreated anyway.
     */
    const rebuild = (next: Board): void => {
      board = next;
      // A member deleted, or moved to another room by an agent, leaves the group rather than
      // lingering as an outline around nothing.
      if (group.size) group = new Set([...group].filter((id) => next.nodes.some((n) => n.id === id)));
      boardPx = boardPixelSize(board.grid);
      rects = layoutRects(board, live.current.editMode, measureNode);
      buildTraces();
      buildZones();
      buildNodes();
      buildNotes();
      buildGrid();
      rebuildOverlay();
      applyFocus();
      buildCourierRoutes();
      builtRef.current = next;
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
          backgroundColor: board.theme.maskDark,
          resizeTo: host
        });
        if (disposed) { app.destroy(true, { children: true }); return; }

        host.appendChild(app.canvas);
        app.canvas.style.imageRendering = 'pixelated';
        app.canvas.style.display = 'block';
        app.canvas.style.touchAction = 'none';

        world = new Container();
        app.stage.addChild(world);

        // Layer 0 — substrate. Built once; see rebuild().
        substrateLayer = new Container();
        substrateLayer.addChild(buildSubstrate(
          {
            maskDark: board.theme.maskDark,
            maskLight: board.theme.maskLight,
            seed: board.theme.substrateSeed ?? 1
          },
          boardPx
        ));
        world.addChild(substrateLayer);

        /*
         * The layers, in paint order. Each one is added to `world` below, and the ORDER of those
         * calls is the whole of it — there is no z-index anywhere in this file.
         *
         *   backdrops -> copper -> zones -> PARTS -> couriers -> components -> notes -> grid -> overlays
         *
         * `decor.part` sits BELOW the components and below the couriers. William asked for this
         * twice, in opposite directions, and the second answer is the one that holds:
         *
         *   "aesthetic elements should be rendered OVER / on top of the board so mini robots pass
         *    UNDER the '+' box aesthetic elements"          — the first version
         *   "i want shapes and aesthetic elements to render as a layer below the nodes - forget
         *    them rendering on top of the robots"           — what it is now
         *
         * Which is also the more defensible one physically: a via, a screw, a pad array and a
         * grille are features OF the board, not objects mounted on it. A chip soldered over a pad
         * array hides the pads, because that is exactly what a chip does to the pads underneath
         * it. Parts stay above the traces and zones so a via still reads as sitting on the copper
         * rather than under it.
         *
         * `decor.image` sits at the very bottom, above the substrate and below the wiring: it is
         * scenery the board is built on top of, so a trace running across it should be visible,
         * and a component standing on it should occlude it.
         *
         * The couriers sit BELOW the components and above the wiring on purpose: a robot walks
         * across the substrate and along the traces in full view, then passes behind the package
         * it is delivering to. Being occluded by the destination is what makes the arrival read as
         * going INTO the node rather than stopping on top of it — and the glitch-dissolve then
         * finishes off whatever is still sticking out.
         */
        decorLayer = new Container(); world.addChild(decorLayer);
        traceLayer = new Container(); world.addChild(traceLayer);
        zoneLayer = new Container(); world.addChild(zoneLayer);
        partLayer = new Container(); world.addChild(partLayer);
        couriers = new CourierLayer(); world.addChild(couriers.container);
        nodeLayer = new Container(); world.addChild(nodeLayer);
        noteLayer = new Container(); world.addChild(noteLayer);
        gridLayer = new Container(); world.addChild(gridLayer);
        overlayLayer = new Container(); world.addChild(overlayLayer);

        sprites = new SpriteStore();
        const atlas = await sprites.load(ATLAS_URL, atlasImageUrl);
        if (disposed) { app.destroy(true, { children: true }); return; }
        if (!atlas.loaded) console.info(`[atlas] ${atlas.reason} — every node renders as a placeholder`);

        rebuildRef.current = rebuild;
        rebuild(live.current.board);

        /*
         * Open on the CONTENT, not on the origin.
         *
         * A board is not its content: the root board is 192x120 tiles and the components sit in a
         * patch in the middle. Starting the camera at 0,0 — which is what "a different room is a
         * different place: start at its origin" used to mean — showed a screenful of bare
         * substrate with the board off to the lower right. Tripling every board to give William
         * room to work turned that from a corner case into what happens every time you enter a
         * room.
         *
         * Only on arrival. Once you have moved the camera it is yours, and rebuilding the scene
         * after an edit must never touch it — see the cameraStore comment above for what that cost
         * the last time.
         */
        const bounds = contentBounds(rects);
        if (bounds) {
          cameraStore.current = clampCamera(
            { ...cameraStore.current, ...centreOn(bounds, cameraStore.current.zoom, viewport()) },
            boardPx,
            viewport()
          );
        }

        let frames = 0;
        let fpsAccum = 0;
        let fps = 0;
        let lastSelection: string | null = null;
        let lastBrokenKey = '';
        let lastFocus = false;
        let lastEditMode = live.current.editMode;
        let lastDragKey = '';
        let lastJumpSeq = live.current.jumpTo?.seq ?? 0;
        let lastRouteKey = '';
        let pulse = 0;
        let lastPulseStep = -1;
        let lastGlowStep = -1;
        let lastTextGlow = -1;

        app.ticker.add((ticker) => {
          const view = viewport();
          let camera = cameraStore.current;

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
          cameraStore.current = camera;

          /*
           * The live camera, every frame, on `window`.
           *
           * The HUD carries the same numbers but only refreshes every 30 frames, which is fine
           * for a human and useless for a test — the smoke's camera check read a stale 0,0 for a
           * camera that had in fact panned, and reported a pass it had not earned. This is the
           * value itself, with no sampling window in front of it.
           */
          (window as unknown as { __skynetCamera?: unknown }).__skynetCamera = {
            x: Math.round(camera.x), y: Math.round(camera.y), zoom: camera.zoom
          };

          if (live.current.cameraRef?.current) {
            live.current.cameraRef.current.x = camera.x;
            live.current.cameraRef.current.y = camera.y;
            live.current.cameraRef.current.zoom = camera.zoom;
            live.current.cameraRef.current.viewW = view.width;
            live.current.cameraRef.current.viewH = view.height;
          }

          // The one line that keeps the board from shimmering.
          if (world) {
            const pos = stagePosition(camera);
            world.x = pos.x;
            world.y = pos.y;
            world.scale.set(camera.zoom);
          }

          /*
           * Couriers. Routes are rebuilt only when the shares actually change — usage is polled
           * every 20 seconds and a rebuild allocates, so doing it per frame would be pure waste.
           *
           * They stop entirely in Edit Board mode as well as under reduced motion: it is hard
           * enough to drop a component on the right tile without eight robots walking over it.
           */
          const routeKey = (live.current.usageRoutes ?? [])
            .map((r) => `${r.nodeId}:${r.share.toFixed(3)}`).join('|');
          if (routeKey !== lastRouteKey) {
            lastRouteKey = routeKey;
            buildCourierRoutes();
          }
          couriers?.tick(live.current.reducedMotion || live.current.editMode ? 0 : 1);

          /*
           * The LED pulse. Two frames at 2fps — the only thing on this board that moves purely
           * for its own sake, which is exactly what an indicator lamp is for. Off under reduced
           * motion, where docs/02 requires state to survive without animation; it does, because
           * an unlit LED is still a drawn component rather than a hole.
           */
          /*
           * The pulse glow. One texture swap per glowing node per glow frame — the frames are
           * already built, so this costs a texture assignment and nothing else.
           */
          if (glows.size && !live.current.reducedMotion) {
            const step = Math.floor(pulse / Math.max(1, Math.round(60 / GLOW_FPS))) % GLOW_FRAMES;
            if (step !== lastGlowStep) {
              lastGlowStep = step;
              for (const [nodeId, frames] of glows) {
                const sprite = spriteById.get(nodeId);
                const glowFrame = frames[step % frames.length];
                if (!sprite || !glowFrame || !sprites) continue;
                const node = nodeById(nodeId);
                if (!node) continue;
                // Only the FACE differs from a normal draw. Everything else comes from the one
                // spec builder, so a pulse can never strip a node of its frame again.
                sprite.texture = sprites.placeholder(specFor(node, { face: glowFrame }));
              }
            }
          }

          /*
           * The text pulse. Rebuilding the whole note layer per step is cheap — there are a
           * handful of text nodes and the glyphs are cached by the silkscreen renderer — and it
           * keeps one code path for "draw the notes" instead of two that can disagree.
           */
          /*
           * The text pulse, for notes AND nameplates.
           *
           * Six steps rather than four, and the excursion runs the full 0-2-0: the first version
           * spent half its cycle at lift 1 and read as a flicker rather than a pulse. Two rungs of
           * a six-colour ramp is as much brightness as this palette has to give.
           */
          if ((glowingNotes.length || glowingPlates.length) && !live.current.reducedMotion) {
            const step = Math.floor(pulse / 10) % 6;
            const lift = [0, 1, 2, 2, 1, 0][step] ?? 0;
            if (lift !== lastTextGlow) {
              lastTextGlow = lift;
              if (glowingNotes.length) buildNotes(lift);
              for (const id of glowingPlates) drawNode(id, lift);
            }
          }

          if (animated.length && !live.current.reducedMotion) {
            const step = Math.floor(pulse / 30) % 2;
            if (step !== lastPulseStep) {
              lastPulseStep = step;
              for (const entry of animated) {
                const sprite = spriteById.get(entry.nodeId);
                const texture = sprites?.get(entry.key, step % entry.frames, entry.rotation);
                if (sprite && texture) sprite.texture = texture;
              }
            }
          }
          pulse++;

          if (live.current.editMode !== lastEditMode) {
            lastEditMode = live.current.editMode;
            // Printed kinds become click targets in Edit Board mode, so the hit-test set changes
            // with the mode — see layoutRects.
            rects = layoutRects(board, lastEditMode, measureNode);
            // Leaving Edit Board mode abandons a half-drawn wire. It cannot be finished outside
            // the mode, and a rubber band left hanging over a board you are only browsing is a
            // gesture you have no way to cancel.
            wiring = null;
            hoverPort = null;
            // A group only means something in Edit Board mode, where it can be moved.
            if (!lastEditMode) group = new Set();
            buildGrid();
            rebuildOverlay();
          }

          const brokenKey = Object.entries(live.current.targets).map(([id, t]) => `${id}:${t.state}`).join('|');
          const dragKey = drag.exceeded && (drag.kind === 'move' || drag.kind === 'resize')
            ? `${drag.kind}:${drag.nodeId}:${drag.currentTile?.x},${drag.currentTile?.y}:${drag.currentFootprint?.w}x${drag.currentFootprint?.h}:${drag.valid}`
            : drag.exceeded && drag.kind === 'group'
              ? `group:${drag.delta?.dx},${drag.delta?.dy}:${drag.valid}`
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
              atlasFrames: sprites?.frameCount ?? 0,
              placeholderCount,
              brokenCount,
              faceCount,
              routedCount,
              fallbackCount,
              courierCount: couriers?.count ?? 0,
              groupCount: group.size,
              fps
            });
          }
        });

        /*
         * ── Where these listeners live, and why it matters ────────────────────────────────────
         *
         * `pointerdown` is on the CANVAS, because a drag has to start over the board.
         *
         * `pointermove` and `pointerup` are on the WINDOW. They used to be on the canvas, and a
         * gesture that released outside it therefore never delivered its `pointerup` — leaving
         * `drag.kind` stuck at 'pan' forever. The ticker suppresses keyboard panning while a drag
         * is live, so the symptom was that WASD silently stopped working after one drag that
         * happened to end off the canvas, with nothing on screen to say why. Caught by the smoke
         * run: the keys arrived at the handler and the camera did not move.
         *
         * Pointer capture already covered most of this. `window` covers the rest, costs nothing,
         * and does not depend on capture having been granted.
         */
        window.addEventListener('keydown', onEscapeCapture, true);
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        window.addEventListener('blur', onBlur);
        host.addEventListener('wheel', onWheel, { passive: false });
        app.canvas.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', endDrag);
        window.addEventListener('pointercancel', endDrag);
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
      rebuildRef.current = null;
      builtRef.current = null;
      window.removeEventListener('keydown', onEscapeCapture, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      host.removeEventListener('wheel', onWheel);
      couriers?.destroy();
      couriers = null;
      if (app) {
        app.canvas.removeEventListener('pointerdown', onPointerDown);
        app.canvas.removeEventListener('dblclick', onDoubleClick);
        app.destroy(true, { children: true });
      }
    };
    // The room, and only the room. A board MUTATION rebuilds the scene in place — see the
    // cameraStore comment above for what keying this on `props.board` used to cost.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.boardId]);

  /** A new version of the board: redraw the scene, keep the application and the camera. */
  useEffect(() => {
    if (rebuildRef.current && builtRef.current !== props.board) rebuildRef.current(props.board);
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
