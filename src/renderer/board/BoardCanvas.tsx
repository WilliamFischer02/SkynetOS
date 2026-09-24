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
import type { Board, BoardEdge, BoardNode, Footprint } from '@shared/types.js';
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
import { Texture, TilingSprite } from 'pixi.js';
import { resolveLook } from '@shared/look.js';
import { CourierLayer, courierColor, courierSource, type CourierRoute } from './couriers.js';
import { courierHub, elbowPath, wirePath, type Wire } from './courier-paths.js';
import { separateParallel, wireAt } from './wire-lanes.js';
import { buildWireHandles, buildWireHighlight, type TraceStyle } from './traces.js';
import { routeEdge } from './wire-route.js';
import {
  anchorPoint,
  handleAt,
  moveElbow,
  moveSegment,
  nearestAnchor,
  nudgeAnchor,
  waypointsFrom,
  wireHandles,
  type WireHandle
} from './wire-geometry.js';
import { GLOW_FPS, buildGlowFrames } from './glow.js';
import { EFFECT_FPS, chaseRects, cycleFrame, scanRect } from './effects.js';
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
import { updateMonitorFace } from './monitor-widget.js';
import type { BoardContextMenu } from '../store/useBoardStore.js';
import { TouchGestures } from './touch.js';
import { isLiveAvatarLogo, logoBoxPx, logoCacheSource } from '@shared/logo-source.js';
import { gifFrameAt } from '@shared/gif.js';
import { avatarFrameAt, liveLogoLayout, wobbleOffset, type AvatarMood, type AvatarPayload } from '@shared/avatar.js';

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

/**
 * Every node's target state as one string, so the ticker can tell when the broken set changed.
 *
 * Memoised on the object: the store replaces `targets` only when a resolve actually changed
 * something, so this is built once per change instead of once per frame, which was up to 165
 * string joins over every node a second.
 */
const targetKeys = new WeakMap<Record<string, TargetInfo>, string>();
function targetsKey(targets: Record<string, TargetInfo>): string {
  let key = targetKeys.get(targets);
  if (key === undefined) {
    key = Object.entries(targets).map(([id, t]) => `${id}:${t.state}`).join('|');
    targetKeys.set(targets, key);
  }
  return key;
}

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
  /** The selected wire, if any. A wire and a node are never selected at the same time. */
  selectedEdgeId?: string | null;
  /** Select a wire by clicking it, or clear the selection with null. */
  onSelectEdge?: (edgeId: string | null) => void;
  /**
   * Commit a hand-made change to a wire's route: a pinned end, or moved elbows. One `edge.update`,
   * so one Ctrl+Z puts the wire back.
   */
  onUpdateEdge?: (edgeId: string, patch: Partial<BoardEdge>) => void;
  /**
   * The room look's whole-board colour transform, as a CSS filter (see packages/shared/look.ts
   * `lookFilter`). Applied to the board host only, so the chrome keeps its own colours. Empty or
   * absent means no filter at all.
   */
  lookFilter?: string;
  /** Ctrl+C: the group if there is one, else the selected node. */
  onCopy?: (ids: string[]) => void;
  /** Ctrl+V: paste with the cluster's top-left on this tile, under the cursor or at the view's centre. */
  onPaste?: (tile: { x: number; y: number }) => void;
  /** A right click: what was under the cursor, and where. */
  onContextMenu?: (menu: BoardContextMenu) => void;
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
    /** Where the cursor last was over the canvas, in canvas px: where Ctrl+V pastes. */
    let lastPointer: { x: number; y: number } | null = null;
    /** Pinch, long-press and double-tap for touchscreens and the remote iPhone (board/touch.ts). */
    let touch: TouchGestures | null = null;

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
    /** The procedural substrate, kept while a tiled floor is shown so switching back is instant. */
    let substrateSprite: TilingSprite | null = null;
    /** The room's tiled background (Board.look), and the key it was built for. See applyTile. */
    let tileSprite: TilingSprite | null = null;
    let tileKey = '';
    let decorLayer: Container | null = null;
    let traceLayer: Container | null = null;
    let zoneLayer: Container | null = null;
    let nodeLayer: Container | null = null;
    let partLayer: Container | null = null;
    let noteLayer: Container | null = null;
    let gridLayer: Container | null = null;
    let overlayLayer: Container | null = null;
    /** Chase and scan lights: one Graphics, cleared and redrawn at EFFECT_FPS. See effects.ts. */
    let effectLayer: Container | null = null;
    let effectGraphics: Graphics | null = null;
    let couriers: CourierLayer | null = null;
    /**
     * The traces as last routed, and the obstacle map they were routed against. The couriers'
     * road network, and what the router uses to generate a road where no wire runs.
     */
    let wires: Wire[] = [];
    /** How each wire was drawn, by edge id: for hit-testing a click and for lighting the selected one. */
    let wireStyles = new Map<string, TraceStyle>();
    let routeGrid: ReturnType<typeof buildRouteGrid> | null = null;
    let routeObstacles: RouteObstacle[] = [];

    /*
     * Reshaping the selected wire by hand, in Edit Board mode. William: "reposition both endpoints
     * of a wire to a desired point along a nodes edge and it sticks to that point, as well as the
     * ability to reposition elbows". The board is untouched until the drop (or Enter): meanwhile
     * the wire is drawn where it would go, and the drop is one `edge.update`.
     */
    let wireEdit: {
      edgeId: string;
      /** The handle being moved, as it was when the gesture began. */
      handle: WireHandle;
      /** The route as drawn when the gesture began: what an elbow or segment move reshapes. */
      base: Point[];
      /** The route to draw now. */
      points: Point[];
      /** What letting go commits. */
      patch: Partial<BoardEdge>;
      /** A pointer drag, or a keyboard nudge waiting for Enter. */
      dragging: boolean;
      /** The last snapped target, so a move within the same grid step does no work. */
      key: string;
    } | null = null;
    /** The handle Tab has focused on the selected wire. -1: none. */
    let focusedHandle = -1;

    const spriteById = new Map<string, Sprite>();
    /** Decor parts whose atlas key has more than one frame — the LEDs. */
    const animated: { nodeId: string; key: string; frames: number; rotation: Rotation | undefined }[] = [];
    /**
     * Precomputed pulse-glow cycles, per node. Built once from the decoded wallpaper and cycled;
     * recomputing a 320x224 backdrop's palette shift every frame would be millions of pixel
     * operations a second for decoration.
     */
    const glows = new Map<string, HTMLCanvasElement[]>();
    /** The crest colour each glow cycle was built with, so changing `pulseColor` rebuilds it. */
    const glowCrest = new Map<string, string>();
    const crestOf = (node: BoardNode): string => (node.pulseColor ? resolveToken(node.pulseColor, board.theme) : '');
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
       * Ctrl+C / Ctrl+V copy and paste nodes: the group if there is one, otherwise the selection.
       * Left alone when there is selected TEXT on the page, so copying words out of a panel still
       * copies words.
       */
      if (event.ctrlKey && (event.code === 'KeyC' || event.code === 'KeyV')) {
        if (window.getSelection()?.toString()) return;
        event.preventDefault();
        if (event.code === 'KeyC') {
          const ids = group.size ? [...group] : live.current.selectedId ? [live.current.selectedId] : [];
          if (ids.length) live.current.onCopy?.(ids);
        } else {
          live.current.onPaste?.(pasteTile());
        }
        return;
      }

      /*
       * A selected wire in Edit Board mode takes Tab, the arrows and Enter for its handles. Tab
       * cycles them (from, along the wire, to), the arrows nudge the focused one, Enter keeps the
       * change; Esc, in the capture listener below, drops it. The keyboard path for everything the
       * handles do with a mouse. WASD still pans.
       */
      const editable = editableWire();
      if (editable) {
        if (event.code === 'Tab') {
          event.preventDefault();
          const n = editable.handles.length;
          const start = focusedHandle < 0 ? (event.shiftKey ? n - 1 : 0) : focusedHandle + (event.shiftKey ? -1 : 1);
          focusedHandle = n ? ((start % n) + n) % n : -1;
          rebuildOverlay();
          return;
        }
        const arrow = event.code === 'ArrowUp' ? { dx: 0, dy: -1 }
          : event.code === 'ArrowDown' ? { dx: 0, dy: 1 }
            : event.code === 'ArrowLeft' ? { dx: -1, dy: 0 }
              : event.code === 'ArrowRight' ? { dx: 1, dy: 0 } : null;
        const focused = focusedHandle >= 0 ? editable.handles[Math.min(focusedHandle, editable.handles.length - 1)] : undefined;
        if (arrow && focused && !event.shiftKey) {
          event.preventDefault();
          nudgeHandle(editable, focused, arrow);
          return;
        }
        if (event.code === 'Enter' && wireEdit) {
          event.preventDefault();
          commitWireEdit();
          return;
        }
      }

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

      // 1 to 8 jump straight to that whole-number zoom. 0 is "whole board", handled below.
      if (/^Digit[1-8]$/.test(event.code)) {
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
      if (event.code !== 'Escape') return;
      // A wire's handle first: drop an unkept change, or else let go of the focused handle.
      if (wireEdit || focusedHandle >= 0) {
        if (!cancelWireEdit()) { focusedHandle = -1; rebuildOverlay(); }
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      // The same reasoning covers a selected wire: nothing NODE-selected, so App would leave.
      if (group.size) {
        group = new Set();
        rebuildOverlay();
      } else if (live.current.selectedEdgeId) {
        live.current.onSelectEdge?.(null);
      } else {
        return;
      }
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

    /**
     * The wire under a world point, or null. Four screen pixels of slack either side, at any zoom,
     * the same way port hovering is sized, plus the outline.
     */
    const wireUnder = (x: number, y: number): string | null =>
      wireAt(
        wires.map((w) => {
          const style = wireStyles.get(w.id);
          return { id: w.id, points: w.points, width: (style?.width ?? 2) + 2 * (style?.outlineWidth ?? 1) };
        }),
        x,
        y,
        4 / cameraStore.current.zoom
      );

    /* ---------------- reshaping the selected wire ---------------- */

    /** The selected wire, in Edit Board mode: the edge, the route as drawn now, and its handles. */
    const editableWire = (): { edge: BoardEdge; points: Point[]; handles: WireHandle[] } | null => {
      if (!live.current.editMode) return null;
      const id = live.current.selectedEdgeId;
      const edge = id ? board.edges.find((e) => e.id === id) : undefined;
      if (!edge) return null;
      const points = wireEdit?.edgeId === edge.id ? wireEdit.points : wires.find((w) => w.id === edge.id)?.points;
      if (!points || points.length < 2) return null;
      return { edge, points, handles: wireHandles(points) };
    };

    /** Six screen pixels of target round a handle, at any zoom, the way ports are sized. */
    const handleTolerance = (): number => Math.max(3, 6 / cameraStore.current.zoom);

    const rectOfNode = (id: string): NodeRect | null => {
      const n = nodeById(id);
      return n ? nodeRect(n) : null;
    };

    /** The route this edge would have with `patch` applied: what letting go commits, drawn before it is. */
    const previewRoute = (edge: BoardEdge, patch: Partial<BoardEdge>): Point[] | null => {
      const from = rectOfNode(edge.from);
      const to = rectOfNode(edge.to);
      if (!from || !to || !routeGrid) return null;
      return routeEdge({ ...edge, ...patch }, from, to, { grid: routeGrid, obstacles: routeObstacles, boardPx, tile: board.grid.tile }).points;
    };

    /**
     * What moving one handle to `world` does to the wire: the patch letting go commits, and the route
     * to draw meanwhile. An end slides round its own node's perimeter and turns its corners; an elbow
     * or a segment snaps to whole tiles, the unit waypoints are saved in, so what is drawn is what is
     * saved. Moving a corner pins both ends where they are, so the router brings the wire back
     * through exactly these corners.
     */
    const reshapeWire = (
      edge: BoardEdge,
      base: Point[],
      handle: WireHandle,
      world: { x: number; y: number }
    ): { patch: Partial<BoardEdge>; points: Point[] } | null => {
      if (handle.kind === 'from' || handle.kind === 'to') {
        const rect = rectOfNode(handle.kind === 'from' ? edge.from : edge.to);
        if (!rect) return null;
        const anchor = nearestAnchor(rect, world);
        const patch: Partial<BoardEdge> = handle.kind === 'from' ? { fromAnchor: anchor } : { toAnchor: anchor };
        const points = previewRoute(edge, patch);
        return points ? { patch, points } : null;
      }
      const tile = board.grid.tile;
      const to = { x: Math.round(world.x / tile) * tile, y: Math.round(world.y / tile) * tile };
      const shaped = handle.kind === 'elbow' ? moveElbow(base, handle.index, to) : moveSegment(base, handle.index, to);
      const fromRect = rectOfNode(edge.from);
      const toRect = rectOfNode(edge.to);
      if (!fromRect || !toRect || shaped.length < 2) return null;
      const bends = waypointsFrom(shaped, tile);
      const patch: Partial<BoardEdge> = {
        waypoints: bends.length ? bends : undefined,
        fromAnchor: edge.fromAnchor ?? nearestAnchor(fromRect, shaped[0]!),
        toAnchor: edge.toAnchor ?? nearestAnchor(toRect, shaped[shaped.length - 1]!)
      };
      return { patch, points: previewRoute(edge, patch) ?? shaped };
    };

    /** Keep the change: one edge.update, so one Ctrl+Z puts the wire back. */
    const commitWireEdit = (): void => {
      if (!wireEdit) return;
      const { edgeId, patch } = wireEdit;
      wireEdit = null;
      if (Object.keys(patch).length) live.current.onUpdateEdge?.(edgeId, patch);
      rebuildOverlay();
    };

    /** Drop an unkept change. Returns whether there was one. */
    const cancelWireEdit = (): boolean => {
      if (!wireEdit) return false;
      wireEdit = null;
      rebuildOverlay();
      return true;
    };

    /**
     * The keyboard path for a handle: an end slides one grid step round its node the way the arrow
     * points (an arrow into or out of the node does nothing), an elbow or a segment moves one tile.
     * Kept as a pending change, drawn, until Enter keeps it or Esc drops it.
     */
    const nudgeHandle = (
      editable: { edge: BoardEdge; points: Point[] },
      handle: WireHandle,
      dir: { dx: number; dy: number }
    ): void => {
      const { edge } = editable;
      const pending = wireEdit?.edgeId === edge.id ? wireEdit.patch : {};
      let world: { x: number; y: number };
      if (handle.kind === 'from' || handle.kind === 'to') {
        const rect = rectOfNode(handle.kind === 'from' ? edge.from : edge.to);
        if (!rect) return;
        const key = handle.kind === 'from' ? 'fromAnchor' : 'toAnchor';
        const current = pending[key] ?? edge[key] ?? nearestAnchor(rect, handle);
        const next = nudgeAnchor(rect, current, dir.dx, dir.dy);
        if (next === current) return;
        world = anchorPoint(rect, next);
      } else {
        const tile = board.grid.tile;
        world = { x: handle.x + dir.dx * tile, y: handle.y + dir.dy * tile };
      }
      const shaped = reshapeWire(edge, editable.points, handle, world);
      if (!shaped) return;
      const patch = { ...pending, ...shaped.patch };
      const points = previewRoute(edge, patch) ?? shaped.points;
      // Keep focus on the handle that moved: the nearest one of the same kind to where it went.
      const handles = wireHandles(points);
      let best = -1;
      let bestD = Infinity;
      handles.forEach((h, i) => {
        if (h.kind !== handle.kind) return;
        const d = Math.abs(h.x - world.x) + Math.abs(h.y - world.y);
        if (d < bestD) { bestD = d; best = i; }
      });
      focusedHandle = best >= 0 ? best : Math.min(focusedHandle, handles.length - 1);
      wireEdit = { edgeId: edge.id, handle, base: points, points, patch, dragging: false, key: '' };
      rebuildOverlay();
    };

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
       * A selected wire's handles come first in Edit Board mode. An end handle sits exactly on a
       * node's edge, where a press would otherwise start a new wire from that port.
       */
      if (live.current.editMode && event.button === 0) {
        const editable = editableWire();
        const handle = editable ? handleAt(editable.handles, point.x, point.y, handleTolerance()) : null;
        if (editable && handle) {
          wireEdit = { edgeId: editable.edge.id, handle, base: editable.points, points: editable.points, patch: {}, dragging: true, key: '' };
          focusedHandle = editable.handles.indexOf(handle);
          try { app.canvas.setPointerCapture(event.pointerId); } catch { /* the window listeners carry it */ }
          app.canvas.style.cursor = 'grabbing';
          rebuildOverlay();
          return;
        }
      }

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

    /** The tile Ctrl+V pastes onto: under the cursor if it has been over the board, else the view's centre. */
    const pasteTile = (): { x: number; y: number } => {
      if (!app) return { x: 0, y: 0 };
      const bounds = app.canvas.getBoundingClientRect();
      const screen = lastPointer ?? { x: bounds.width / 2, y: bounds.height / 2 };
      const world = screenToWorld(cameraStore.current, screen.x, screen.y);
      return { x: Math.floor(world.x / TILE), y: Math.floor(world.y / TILE) };
    };

    /*
     * Right click: the board's menu. On a node that belongs to the group, the menu acts on the
     * group; on any other node it selects that node and acts on it alone; on bare substrate it
     * offers Paste. A right press already abandons a half-drawn wire in onPointerDown.
     */
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      if (!app) return;
      const screen = canvasPoint(event);
      const point = screenToWorld(cameraStore.current, screen.x, screen.y);
      const hit = hitTest(rects, point.x, point.y);
      const nodeId = hit ? hit.nodeId : null;
      let ids: string[] = [];
      if (nodeId && group.has(nodeId)) {
        ids = [...group];
      } else if (nodeId) {
        ids = [nodeId];
        if (group.size) { group = new Set(); rebuildOverlay(); }
        live.current.onSelect(nodeId);
      }
      live.current.onContextMenu?.({
        screen: { x: event.clientX, y: event.clientY },
        tile: { x: Math.floor(point.x / TILE), y: Math.floor(point.y / TILE) },
        nodeId,
        ids
      });
    };

    /** Hand a finished wire to the command bus. */
    const commitWire = (from: Port, to: Port): void => {
      live.current.onConnect?.(from.nodeId, to.nodeId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!app) return;
      const screen = canvasPoint(event);
      if (event.target === app.canvas) lastPointer = screen;

      // A wire handle in hand: reshape, redrawing only when the snapped target changes.
      if (wireEdit?.dragging) {
        const editable = editableWire();
        if (!editable) { wireEdit = null; return; }
        const world = screenToWorld(cameraStore.current, screen.x, screen.y);
        const step = wireEdit.handle.kind === 'from' || wireEdit.handle.kind === 'to' ? 8 : board.grid.tile;
        const key = `${Math.round(world.x / step)},${Math.round(world.y / step)}`;
        if (key === wireEdit.key) return;
        const shaped = reshapeWire(editable.edge, wireEdit.base, wireEdit.handle, world);
        wireEdit = shaped ? { ...wireEdit, key, patch: shaped.patch, points: shaped.points } : { ...wireEdit, key };
        rebuildOverlay();
        return;
      }

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
      // Letting go of a wire handle keeps the change: one edge.update. A press with no move changes nothing.
      if (wireEdit?.dragging) {
        if (app) {
          try { app.canvas.releasePointerCapture(event.pointerId); } catch { /* already released */ }
          app.canvas.style.cursor = '';
        }
        commitWireEdit();
        return;
      }
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
          /*
           * A click that lands on a wire selects the wire, unless a component is in the way.
           * Printed things do not count as in the way: a backdrop sits under the wiring, and if it
           * won, no wire drawn across it could ever be selected in Edit Board mode.
           */
          const wire = !hit || isPrinted(hit.kind) ? wireUnder(point.x, point.y) : null;
          if (wire) live.current.onSelectEdge?.(wire);
          else live.current.onSelect(hit ? hit.nodeId : null);
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
        // At the peak of the pulse, the node's own glow colour if it names one; otherwise the ramp.
        color: lift >= 2 && node.textGlowColor
          ? resolveToken(node.textGlowColor, board.theme)
          : lift > 0 ? brighten(base, lift, board.theme) : base,
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
    /*
     * Animated GIFs (packages/shared/gif.ts): every frame already dithered by main, stepped by the
     * ticker on the GIF's own delays. `step` is the frame on screen, and specFor draws it, so any
     * redraw of the node (a text pulse, an edit) shows the current frame rather than snapping to the
     * first. Each frame image carries `liveFace`, so sprites.ts keeps ONE texture per node however
     * many frames play (live-slots.ts), rather than one per frame.
     */
    interface GifAnim { frames: HTMLImageElement[]; delays: number[]; step: number }
    const gifAnims = new Map<string, { face?: GifAnim; logo?: GifAnim }>();
    const gifFrame = (nodeId: string, slot: 'face' | 'logo'): HTMLImageElement | null => {
      const anim = gifAnims.get(nodeId)?.[slot];
      return anim ? anim.frames[Math.max(0, anim.step)] ?? null : null;
    };
    const dropGif = (nodeId: string, slot: 'face' | 'logo'): void => {
      const entry = gifAnims.get(nodeId);
      if (!entry?.[slot]) return;
      delete entry[slot];
      if (!entry.face && !entry.logo) gifAnims.delete(nodeId);
    };

    const specFor = (node: BoardNode, opts: { face?: HTMLImageElement | HTMLCanvasElement | null; logo?: HTMLImageElement | null; textLift?: number } = {}) => {
      const fp = footprintOf(node);
      const show = displayOf(node);
      const lift = opts.textLift ?? 0;
      /*
       * A monitor draws the machine on its own face (see the monitor.system block further down).
       * The widget wins over a wallpaper, a glow frame and a logo, and hides the centred designator
       * that would sit on top of its readings. Only when it matches the footprint: straight after
       * a resize the old one would be stretched, so the node shows its ordinary face until the next
       * refresh repaints the widget at the new size.
       */
      // `showSystemGraphics: false` hands the face back to the node's own wallpaper and logo.
      const widget = node.kind === 'monitor.system' && node.showSystemGraphics !== false ? monitorFaces.get(node.id) : undefined;
      const live = widget && widget.width === fp.w * TILE && widget.height === fp.h * TILE ? widget : null;
      return {
        w: fp.w,
        h: fp.h,
        designator: !live && show.designator ? node.designator ?? '' : '',
        name: show.name ? plateTitle(node) : undefined,
        kind: node.kind,
        maskLight: board.theme.maskLight,
        maskDark: board.theme.maskDark,
        signal: board.theme.signal,
        face: live ?? (show.thumbnail ? (opts.face !== undefined ? opts.face : gifFrame(node.id, 'face') ?? faces.get(node.id)?.image ?? null) : null),
        logo: !live && show.logo ? (opts.logo !== undefined ? opts.logo : gifFrame(node.id, 'logo') ?? logos.get(node.id)?.image ?? null) : null,
        nameSize: titleSize(node),
        frame: node.frame,
        priority: node.priority,
        nameStyle: nameStyleFor(node, node.textGlow ? lift : 0),
        suffix: show.name ? roomSuffixFor(node) : null
      };
    };

    /**
     * Redraw one node's texture from whatever images it currently has.
     *
     * `place: false` redraws the texture where the sprite already is. The GIF frame stepper needs
     * that: a node being dragged sits at the drag preview, and snapping it back to its saved
     * position on every frame of its GIF would make it jerk under the cursor.
     */
    const drawNode = (nodeId: string, textLift = 0, place = true): void => {
      const node = nodeById(nodeId);
      const sprite = spriteById.get(nodeId);
      if (!node || !sprite || !sprites) return;
      const fp = footprintOf(node);

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
      if (place) placeSprite(nodeId);
    };

    /** Bumped when the avatar's frames folder changes, so a `logoSource: avatar` logo is refetched. */
    let avatarStamp = 0;

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
        // `logoSource` decides what the logo slot is: the node's file, the avatar's face, or nothing.
        { slot: 'logo', source: logoCacheSource(node, avatarStamp), store: logos }
      ];

      const show = displayOf(node);
      for (const { slot, source, store } of wants) {
        // A slot that is switched off asks main for nothing. The image stays BOUND to the node —
        // only the drawing of it is off — so turning it back on costs a cached mosaic read.
        const wanted = slot === 'face' ? show.thumbnail : show.logo;
        if (!source || !wanted) { store.delete(node.id); dropGif(node.id, slot); continue; }
        // The rotation is part of the key. Without it, turning a backdrop would leave the old
        // mosaic in the cache and nothing would happen — the same shape as the pulse-glow
        // checkbox that did nothing because its work sat inside a fetch that was being skipped.
        // Everything that changes the pixels is in the key: the file, the box it is drawn into,
        // the rotation, and the logo's own scale. Leave one out and the setting appears to do
        // nothing, because the cached image is returned unchanged — see the pulse-glow checkbox.
        // `imageAnimate` too: ticking "Animate GIFs" off must fetch the still, not keep the frames.
        const key = `${source}@${fp.w}x${fp.h}r${node.rotation ?? 0}s${node.logoScale ?? 100}a${node.imageAnimate === false ? 0 : 1}`;
        if (store.get(node.id)?.key === key) continue;
        store.set(node.id, { key, image: null });
        dropGif(node.id, slot);

        void window.skynet['mosaic:forNode'](live.current.boardId, node.id, slot).then(async (result) => {
          if (disposed) return;
          if (!result.ok) { console.warn(`[mosaic] ${node.id} ${slot}: ${result.error}`); return; }
          const img = new Image();
          img.src = result.dataUrl;
          await img.decode();
          /*
           * An animated GIF arrives as frames main has already dithered. All of them are decoded
           * before the node is redrawn, so it never plays a half-loaded strip.
           */
          const animation = result.animation && node.imageAnimate !== false ? result.animation : null;
          const frames = animation
            ? await Promise.all(animation.frames.map(async (src) => {
                const frame = new Image();
                frame.src = src;
                await frame.decode();
                frame.dataset['liveFace'] = `anim:${node.id}`;
                return frame;
              }))
            : [];
          if (disposed || store.get(node.id)?.key !== key) return;
          if (animation && frames.length > 1) {
            gifAnims.set(node.id, { ...gifAnims.get(node.id), [slot]: { frames, delays: animation.delays, step: -1 } });
          } else {
            dropGif(node.id, slot);
          }
          store.set(node.id, { key, image: animation && frames.length > 1 ? frames[0]! : img });
          if (slot === 'face') {
            faceCount++;
            glows.delete(node.id);
            /*
             * The glow is built from the DITHERED mosaic, not the source file — it is a shift
             * along the ramp the mosaic was already quantised onto, so it has to start from the
             * quantised pixels. Built here, once, the moment those pixels exist.
             */
            // A playing GIF is its own motion; a glow cycle built from frame 0 would fight it.
            if (node.pulseGlow && !live.current.reducedMotion && !gifAnims.get(node.id)?.face) {
              const frames = buildGlowFrames(img, board.theme, crestOf(node) || undefined);
              if (frames.length) { glows.set(node.id, frames); glowCrest.set(node.id, crestOf(node)); }
            }
          }
          drawNode(node.id);
          // No GIF left on this node (switched off, or replaced by a still): the texture its GIF slot
          // last showed is no longer drawn, unless the still IS that texture. See releaseLive.
          if (!gifAnims.has(node.id)) sprites?.releaseLive(`anim:${node.id}`, spriteById.get(node.id)?.texture);
        }).catch((err: unknown) => console.warn(`[mosaic] ${node.id} ${slot} failed`, err));
      }
    };

    // New or changed avatar frames: refetch only the logos that show the avatar's face.
    const offAvatar = window.skynet.on('avatar:changed', () => {
      avatarStamp++;
      for (const n of board.nodes) if (n.logoSource === 'avatar') loadImages(n);
      // The animated faces reload their frames and redraw.
      resetAvatarFrames();
      if (board.nodes.some((n) => isLiveAvatarLogo(n))) void loadAvatarPayload();
    });

    /* ---------------- logoSource: avatar-live — the animated JARVIS face as a logo ---------------- */

    /*
     * William: "on a node I can select the animated robot face as a logo instead of an image file and
     * it uses the box it generates for the typical window but as a logo graphic."
     *
     * So the logo box holds the face window's own composition: its mask-dark ground and copper-dark
     * edge, the face at the largest whole-number scale that fits (liveLogoLayout), the float, the
     * blinks, and the mouth while that node's JARVIS is responding (services/avatar-mood.ts pushes
     * `avatar:nodeMood`). A world-space layer above the components, so it pans, zooms and layers with
     * the board, and it follows its node's sprite, which is what a drag moves. It is NOT baked into the
     * node's texture: a face that changes several times a second would otherwise rebuild the whole
     * component each time. Faces step at most ~30 times a second, and a sprite's texture changes only
     * when its frame or float does. The frames keep their true colours, the one place docs/02's palette
     * lock does not hold, recorded there as William's choice. Printed kinds (backdrops, parts, notes,
     * zones) get no live face.
     */
    let avatarLayer: Container | null = null;
    let avatarPayload: AvatarPayload | null = null;
    let avatarLoading = false;
    const avatarImages = new Map<string, HTMLImageElement>();
    const avatarTextures = new Map<string, Texture>();
    const nodeMoods = new Map<string, AvatarMood>();
    interface LiveLogo {
      box: Container;
      face: Sprite;
      /** Whole-number scale of the frame, or 1/divisor. */
      ratio: number;
      integer: boolean;
      /** 1 at a whole scale; N when the box is smaller than a frame and every Nth pixel is taken. */
      divisor: number;
      /** The face's size in world pixels when decimated (unused at a whole scale). */
      w: number;
      h: number;
      faceX: number;
      faceY: number;
      /** How far the float may move the face and keep it inside the box's edge. */
      floatMin: number;
      floatMax: number;
      /** From the node's sprite (which a drag moves) to the box's top-left. */
      offX: number;
      offY: number;
      /** What is on screen now, so a tick that changes neither frame nor float touches nothing. */
      lastFile: string | null;
      lastFloat: number;
    }
    const liveLogos = new Map<string, LiveLogo>();
    let lastWatchKey = '';
    let lastAvatarTick = -1;

    const offNodeMood = window.skynet.on('avatar:nodeMood', (p) => {
      if (p.boardId === live.current.boardId) nodeMoods.set(p.nodeId, p.mood);
    });

    const resetAvatarFrames = (): void => {
      for (const texture of avatarTextures.values()) texture.destroy(true);
      avatarTextures.clear();
      avatarImages.clear();
      avatarPayload = null;
      for (const entry of liveLogos.values()) entry.lastFile = null;
    };

    const loadAvatarPayload = async (): Promise<void> => {
      if (avatarLoading || typeof window.skynet['avatar:frames'] !== 'function') return;
      avatarLoading = true;
      try {
        const payload = await window.skynet['avatar:frames']();
        const urls = [payload.idle, ...payload.blink, ...payload.talk].filter((u): u is string => Boolean(u));
        const decoded = await Promise.all(urls.map(async (url) => {
          const img = new Image();
          img.src = url;
          await img.decode();
          return [url, img] as const;
        }));
        if (disposed) return;
        resetAvatarFrames();
        for (const [url, img] of decoded) avatarImages.set(url, img);
        avatarPayload = payload;
        buildLiveLogos();
      } catch (err) {
        console.warn('[ui] animated face logo: the frames did not load', err);
      } finally {
        avatarLoading = false;
      }
    };

    /** A frame's texture for this box: the frame itself at a whole scale, a fitted copy otherwise. */
    const avatarTexture = (url: string, entry: LiveLogo): Texture | null => {
      const img = avatarImages.get(url);
      if (!img) return null;
      const key = entry.integer ? `whole|${url}` : `${entry.w}x${entry.h}|${url}`;
      let texture = avatarTextures.get(key);
      if (!texture) {
        if (entry.integer) {
          texture = Texture.from(img);
        } else {
          /*
           * Smaller than one frame: every Nth pixel, nearest, from a centred crop that is an exact
           * multiple of N, so no colour is invented and the sampling phase is the same on every frame.
           * The overview zooms' rule (docs/02 rule 4), applied once, here.
           */
          const n = entry.divisor;
          const canvas = document.createElement('canvas');
          canvas.width = entry.w;
          canvas.height = entry.h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return null;
          ctx.imageSmoothingEnabled = false;
          const sx = Math.floor((img.width - entry.w * n) / 2);
          const sy = Math.floor((img.height - entry.h * n) / 2);
          ctx.drawImage(img, sx, sy, entry.w * n, entry.h * n, 0, 0, entry.w, entry.h);
          texture = Texture.from(canvas);
        }
        texture.source.scaleMode = 'nearest';
        avatarTextures.set(key, texture);
      }
      return texture;
    };

    /** Follow each node every frame (a drag moves its sprite directly); step the faces ~30 times a second. */
    const stepLiveLogos = (seconds: number, force = false): void => {
      if (!liveLogos.size || !avatarPayload?.ok) return;
      for (const [nodeId, entry] of liveLogos) {
        const sprite = spriteById.get(nodeId);
        if (!sprite) continue;
        const x = Math.round(sprite.x + entry.offX);
        const y = Math.round(sprite.y + entry.offY);
        if (entry.box.x !== x) entry.box.x = x;
        if (entry.box.y !== y) entry.box.y = y;
      }
      const t = seconds * 1000;
      const tick = Math.floor(t / 33);
      if (!force && tick === lastAvatarTick) return;
      lastAvatarTick = tick;
      const base = avatarPayload.timing;
      const timing = live.current.reducedMotion
        ? { ...base, wobblePx: 0, talkFps: Math.max(1, Math.round(base.talkFps / 2)) }
        : base;
      // Under reduced motion the face neither floats nor blinks; the mouth still says "responding".
      const set = {
        idle: avatarPayload.idle,
        blink: live.current.reducedMotion ? [] : avatarPayload.blink,
        talk: avatarPayload.talk
      };
      for (const [nodeId, entry] of liveLogos) {
        const frame = avatarFrameAt(set, nodeMoods.get(nodeId) ?? 'idle', t, timing);
        if (!frame.file) continue;
        const float = Math.max(entry.floatMin, Math.min(entry.floatMax, Math.round(wobbleOffset(t, timing) * entry.ratio)));
        if (frame.file === entry.lastFile && float === entry.lastFloat) continue;
        const texture = avatarTexture(frame.file, entry);
        if (!texture) continue;
        entry.lastFile = frame.file;
        entry.lastFloat = float;
        entry.face.texture = texture;
        entry.face.y = entry.faceY + float;
      }
    };

    const buildLiveLogos = (): void => {
      if (!avatarLayer) return;
      clearLayer(avatarLayer);
      liveLogos.clear();
      lastAvatarTick = -1;
      const wanted = board.nodes.filter((n) =>
        isLiveAvatarLogo(n) && displayOf(n).logo && !isPrinted(n.kind) &&
        // A monitor's widget owns its face, logo included.
        !(n.kind === 'monitor.system' && n.showSystemGraphics !== false));

      // Ask main to watch who is talking, only when the set changes. An empty set stops it.
      const ids = wanted.map((n) => n.id);
      const watchKey = `${live.current.boardId}|${ids.join(',')}`;
      if (watchKey !== lastWatchKey && typeof window.skynet['avatar:watchNodes'] === 'function') {
        lastWatchKey = watchKey;
        void window.skynet['avatar:watchNodes'](live.current.boardId, ids)
          .then((r) => { for (const [id, mood] of Object.entries(r.moods)) nodeMoods.set(id, mood); })
          .catch(() => undefined);
      }
      if (!wanted.length) return;
      if (!avatarPayload) { void loadAvatarPayload(); return; }
      // No idle.png yet: nothing to draw, and the inspector says so (AvatarLogoNote).
      if (!avatarPayload.ok) return;

      const frame = { width: avatarPayload.width, height: avatarPayload.height };
      for (const node of wanted) {
        const fp = footprintOf(node);
        const box = logoBoxPx(fp, node.logoScale, TILE);
        const layout = liveLogoLayout(frame, box, avatarPayload.timing.wobblePx);
        if (layout.width < 1) continue;
        const container = new Container();
        const ground = new Graphics();
        ground.rect(0, 0, box.width, box.height).fill({ color: hexToNumber(board.theme.maskDark) });
        // The face window's edge: one whole pixel of copper-dark, four rects, so it never straddles a pixel.
        ground
          .rect(0, 0, box.width, 1).rect(0, box.height - 1, box.width, 1)
          .rect(0, 0, 1, box.height).rect(box.width - 1, 0, 1, box.height)
          .fill({ color: hexToNumber(COPPER_DARK) });
        const face = new Sprite();
        face.roundPixels = true;
        if (layout.integer) face.scale.set(layout.ratio);
        container.addChild(ground, face);
        avatarLayer.addChild(container);
        const off = textureOffset(displayOf(node).name ? node.name : undefined, titleSize(node), node.frame);
        const faceX = Math.floor((box.width - layout.width) / 2);
        const faceY = Math.floor((box.height - layout.height) / 2);
        const entry: LiveLogo = {
          box: container,
          face,
          ratio: layout.ratio,
          integer: layout.integer,
          divisor: layout.divisor,
          w: layout.width,
          h: layout.height,
          faceX,
          faceY,
          // Inside the 1 px edge, in whatever room the layout left.
          floatMin: Math.min(0, 1 - faceY),
          floatMax: Math.max(0, box.height - 1 - layout.height - faceY),
          offX: off.x + Math.floor((fp.w * TILE - box.width) / 2),
          offY: off.y + Math.floor((fp.h * TILE - box.height) / 2),
          lastFile: null,
          lastFloat: 0
        };
        face.x = entry.faceX;
        face.y = entry.faceY;
        liveLogos.set(node.id, entry);
      }
      stepLiveLogos(performance.now() / 1000, true);
    };

    const stopLiveLogos = (): void => {
      if (lastWatchKey && typeof window.skynet['avatar:watchNodes'] === 'function') {
        void window.skynet['avatar:watchNodes'](live.current.boardId, []).catch(() => undefined);
      }
      liveLogos.clear();
      resetAvatarFrames();
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
      const routeContext = { grid, obstacles, boardPx, tile: board.grid.tile };
      for (const edge of board.edges) {
        const from = rectById.get(edge.from);
        const to = rectById.get(edge.to);
        if (!from || !to) continue;
        // Automatic, or through the ends and elbows pinned by hand. See wire-route.ts.
        const route = routeEdge(edge, from, to, routeContext);
        if (route.routed) routedCount++;
        if (route.fellBack) fallbackCount++;
        routed.push({ edge, points: route.points, style: styleFor(edge, board.theme.signal, board.theme) });
      }
      // Wires that share a run get a lane each, so two wires never draw as one. See wire-lanes.ts.
      const laned = separateParallel(routed.map((r) => ({ id: r.edge.id, points: r.points, width: r.style.width, outline: r.style.outlineWidth })));
      for (const r of routed) r.points = laned.get(r.edge.id) ?? r.points;

      console.info(`[router] ${routedCount} auto-routed, ${fallbackCount} fell back to a direct run`);
      traceLayer.addChild(buildTraceLayer(routed));
      // The same polylines that were just drawn, so a courier walks exactly the copper on screen
      // and a click lands on exactly the wire it looks like it lands on.
      wires = routed.map((r) => ({ id: r.edge.id, from: r.edge.from, to: r.edge.to, points: r.points }));
      wireStyles = new Map(routed.map((r) => [r.edge.id, r.style]));
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
      const gone = new Set<string>();
      for (const store of [faces, logos]) {
        for (const id of [...store.keys()]) if (!alive.has(id)) { store.delete(id); gone.add(id); }
      }
      for (const id of [...gifAnims.keys()]) if (!alive.has(id)) { gifAnims.delete(id); gone.add(id); }
      // A GIF node that is gone frees the one texture its slot last showed. Its sprite was destroyed
      // above, so nothing draws it. A no-op for every node that never played a GIF.
      for (const id of gone) sprites.releaseLive(`anim:${id}`);
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
        // A changed crest colour is a different cycle: drop it and let the loop below rebuild it.
        if (!alive.has(id) || !node?.pulseGlow || glowCrest.get(id) !== crestOf(node)) glows.delete(id);
      }
      for (const node of board.nodes) {
        if (!node.pulseGlow || glows.has(node.id) || gifAnims.get(node.id)?.face) continue;
        if (live.current.reducedMotion) continue;
        const face = faces.get(node.id)?.image;
        if (!face) continue; // The image is still loading; its own arrival will build the cycle.
        const frames = buildGlowFrames(face, board.theme, crestOf(node) || undefined);
        if (frames.length) { glows.set(node.id, frames); glowCrest.set(node.id, crestOf(node)); }
      }
      buildLiveLogos();
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

    /** `liftFor` gives each glowing note its own pulse step, since each has its own speed. */
    const buildNotes = (liftFor?: (node: BoardNode) => number): void => {
      if (!noteLayer) return;
      clearLayer(noteLayer);
      glowingNotes = [];
      for (const node of board.nodes) {
        if (node.kind !== 'note.silk') continue;
        const note = buildSilkNote(node, board.theme, node.textGlow ? (liftFor?.(node) ?? 0) : 0);
        if (note) noteLayer.addChild(note);
        if (node.textGlow) glowingNotes.push(node.id);
      }
    };

    /**
     * Chase and scan lights, for every node that has them on. One Graphics, cleared and redrawn:
     * a handful of rects per lit node, twenty times a second, and nothing at all when no node has
     * an effect. Geometry and speeds are effects.ts; this only places and colours them.
     */
    const drawEffects = (seconds: number): void => {
      const g = effectGraphics;
      if (!g) return;
      g.clear();
      if (live.current.reducedMotion) return;
      for (const node of board.nodes) {
        if (!node.chase && !node.scan) continue;
        const r = nodeRect(node);
        if (node.chase) {
          const lit = chaseRects(r.w, r.h, seconds, (node.chaseSpeed ?? 100) / 100);
          for (const p of lit) g.rect(r.x + p.x, r.y + p.y, p.w, p.h);
          if (lit.length) g.fill({ color: hexToNumber(resolveToken(node.chaseColor ?? 'signal', board.theme)) });
        }
        if (node.scan) {
          const line = scanRect(r.w, r.h, seconds, (node.scanSpeed ?? 100) / 100);
          if (line) {
            g.rect(r.x + line.x, r.y + line.y, line.w, line.h);
            g.fill({ color: hexToNumber(resolveToken(node.scanColor ?? 'signal', board.theme)) });
          }
        }
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
      // The selected wire, redrawn with a halo in the room's signal colour.
      const edgeId = live.current.selectedEdgeId;
      const selectedWire = edgeId ? wires.find((w) => w.id === edgeId) : undefined;
      const selectedStyle = edgeId ? wireStyles.get(edgeId) : undefined;
      if (selectedWire && selectedStyle) {
        // Mid-reshape, the wire is drawn where it would go if let go now.
        const shown = wireEdit && wireEdit.edgeId === edgeId ? wireEdit.points : selectedWire.points;
        overlayLayer.addChild(buildWireHighlight(shown, selectedStyle, board.theme.signal, 2));
        if (live.current.editMode) overlayLayer.addChild(buildWireHandles(wireHandles(shown), focusedHandle, board.theme.signal));
      }

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
    /*
     * The room's tiled floor. William: "select an image that is a perfect square and that image can
     * be tiled as the board background, or else it defaults to what it already is. enable background
     * image tile is a toggle."
     *
     * The picture comes through main's mosaic, square-checked and dithered onto the room's palette
     * like any backdrop, and is tiled across the whole board in WORLD space at an integer scale, so
     * it pans and zooms with everything else and stays pixel-exact. The procedural substrate is only
     * hidden: the toggle going off, or a picture that fails its check, puts it straight back. Keyed,
     * so the rebuild after every ordinary edit costs one string comparison.
     */
    const applyTile = (): void => {
      if (!substrateLayer || !substrateSprite) return;
      const look = resolveLook(board.look);
      const key = look.tileEnabled && look.tileImage
        ? [look.tileImage, look.tileScale, boardPx.width, boardPx.height, board.theme.maskDark, board.theme.maskLight, board.theme.signal].join('|')
        : '';
      if (key === tileKey) return;
      tileKey = key;
      const restoreSubstrate = (): void => {
        tileSprite?.destroy({ texture: true, textureSource: true });
        tileSprite = null;
        if (substrateSprite) substrateSprite.visible = true;
      };
      if (!key) { restoreSubstrate(); return; }
      const refuse = (why: string): void => {
        restoreSubstrate();
        live.current.onToast?.(`BACKGROUND TILE NOT USED — ${why}. SHOWING THE ROOM'S OWN SUBSTRATE.`, 'warn');
      };
      void window.skynet['mosaic:boardTile'](live.current.boardId).then(async (result) => {
        if (disposed || tileKey !== key) return;
        if (!result.ok) { refuse(result.error); return; }
        if (result.width !== result.height) { refuse(`NOT SQUARE — ${result.width}x${result.height}`); return; }
        const img = new Image();
        img.src = result.dataUrl;
        try { await img.decode(); } catch { refuse('COULD NOT DECODE IT'); return; }
        if (disposed || tileKey !== key || !substrateLayer) return;
        // Through a canvas, the same path the substrate's own texture takes.
        const canvas = document.createElement('canvas');
        canvas.width = result.width;
        canvas.height = result.height;
        canvas.getContext('2d')?.drawImage(img, 0, 0);
        const sprite = new TilingSprite({ texture: Texture.from(canvas), width: boardPx.width, height: boardPx.height });
        sprite.tileScale.set(look.tileScale, look.tileScale);
        restoreSubstrate();
        tileSprite = sprite;
        substrateLayer.addChild(sprite);
        if (substrateSprite) substrateSprite.visible = false;
      }).catch((err) => {
        if (!disposed && tileKey === key) refuse((err as Error).message);
      });
    };

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
      applyTile();
      builtRef.current = next;
    };

    /* ---------------- monitor.system: a live widget on the node itself ---------------- */

    /*
     * William: "I want the actual node to be a monitor / show live update data like a widget."
     *
     * Every monitor.system node paints the machine's readings onto its own face, refreshed every
     * two seconds. Only while this board has such a node and the window is visible: on every other
     * board, and while minimised, the timer asks main for nothing. A widget whose pixels would come
     * out the same is not repainted, and sprites.ts keeps ONE texture per widget rather than one per
     * refresh (live-slots.ts). The drawing is monitor-widget.ts; double-click still opens the full
     * panel. Self-contained: the timer clears itself once the effect is disposed.
     */
    const monitorFaces = new Map<string, HTMLCanvasElement>();
    let monitorSnapshot: Parameters<typeof updateMonitorFace>[2] = null;
    let monitorBusy = false;

    const paintMonitors = (): void => {
      if (!sprites) return; // The font and the sprite store are not ready yet.
      const monitors = board.nodes.filter((n) => n.kind === 'monitor.system');
      for (const id of [...monitorFaces.keys()]) {
        if (!monitors.some((n) => n.id === id)) monitorFaces.delete(id);
      }
      for (const node of monitors) {
        const fp = footprintOf(node);
        const { canvas, changed } = updateMonitorFace(
          monitorFaces.get(node.id), node.id, monitorSnapshot, fp.w * TILE, fp.h * TILE, board.theme
        );
        monitorFaces.set(node.id, canvas);
        if (changed) drawNode(node.id);
      }
    };

    const pollMonitors = async (): Promise<void> => {
      if (disposed || monitorBusy || document.hidden) return;
      // Only while a monitor is actually on screen: a reading nobody can see is PowerShell for nothing.
      // Off screen, the face keeps its last reading and refreshes within one tick of coming back.
      const view = viewport();
      if (!rects.some((r) => r.kind === 'monitor.system' && isVisible(r, cameraStore.current, view))) return;
      // Dashes straight away, rather than the ordinary face, while the first reading is taken.
      if (!monitorSnapshot) paintMonitors();
      monitorBusy = true;
      try {
        monitorSnapshot = await window.skynet['hardware:snapshot']({ light: true });
      } catch (err) {
        // Keep the last reading. A widget that blanks on one failed refresh reads as a crash.
        console.warn('[ui] monitor widget: hardware snapshot failed', err);
      } finally {
        monitorBusy = false;
      }
      if (!disposed) paintMonitors();
    };

    const monitorTimer = setInterval(() => {
      if (disposed) { clearInterval(monitorTimer); return; }
      void pollMonitors();
    }, 2000);

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
        substrateSprite = buildSubstrate(
          {
            maskDark: board.theme.maskDark,
            maskLight: board.theme.maskLight,
            seed: board.theme.substrateSeed ?? 1
          },
          boardPx
        );
        substrateLayer.addChild(substrateSprite);
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
        // The animated JARVIS-face logos (logoSource: avatar-live), on the components they belong to.
        avatarLayer = new Container(); world.addChild(avatarLayer);
        // Effects light the components, so they sit directly over them and under the notes.
        effectLayer = new Container(); world.addChild(effectLayer);
        effectGraphics = new Graphics();
        effectGraphics.roundPixels = true;
        effectLayer.addChild(effectGraphics);
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
        let lastEdgeSelection: string | null = null;
        let lastBrokenKey = '';
        let lastFocus = false;
        let lastEditMode = live.current.editMode;
        let lastDragKey = '';
        let lastJumpSeq = live.current.jumpTo?.seq ?? 0;
        let lastRouteKey = '';
        let pulse = 0;
        let lastPulseStep = -1;
        /** The glow frame and text lift each node is showing, so a node is redrawn only when its own step changes. */
        const glowSteps = new Map<string, number>();
        const plateLifts = new Map<string, number>();
        let lastNoteLifts = '';
        let lastEffectTick = -1;
        const TEXT_LIFTS = [0, 1, 2, 2, 1, 0] as const;
        const liftOf = (node: BoardNode, seconds: number): number =>
          TEXT_LIFTS[cycleFrame(seconds, TEXT_LIFTS.length, TEXT_LIFTS.length, (node.textGlowSpeed ?? 100) / 100)] ?? 0;

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
          const seconds = performance.now() / 1000;

          // Per node, because each has its own `pulseSpeed`: a node is redrawn only when ITS frame
          // changes, so a slow pulse costs a slow node's worth of texture swaps and no more.
          if (glows.size && !live.current.reducedMotion) {
            for (const [nodeId, frames] of glows) {
              const node = nodeById(nodeId);
              const sprite = spriteById.get(nodeId);
              if (!node || !sprite || !sprites || !frames.length) continue;
              const step = cycleFrame(seconds, GLOW_FPS, frames.length, (node.pulseSpeed ?? 100) / 100);
              if (glowSteps.get(nodeId) === step) continue;
              glowSteps.set(nodeId, step);
              const glowFrame = frames[step];
              if (!glowFrame) continue;
              // Only the FACE differs from a normal draw. Everything else comes from the one
              // spec builder, so a pulse can never strip a node of its frame again.
              sprite.texture = sprites.placeholder(specFor(node, { face: glowFrame }));
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
            // Each glowing node on its own `textGlowSpeed`; redrawn only when its own lift changes.
            for (const id of glowingPlates) {
              const node = nodeById(id);
              if (!node) continue;
              const lift = liftOf(node, seconds);
              if (plateLifts.get(id) === lift) continue;
              plateLifts.set(id, lift);
              drawNode(id, lift);
            }
            if (glowingNotes.length) {
              const lifts = glowingNotes.map((id) => { const n = nodeById(id); return n ? liftOf(n, seconds) : 0; }).join('');
              if (lifts !== lastNoteLifts) {
                lastNoteLifts = lifts;
                buildNotes((node) => liftOf(node, seconds));
              }
            }
          }

          /*
           * Animated GIFs, on their own delays (gif.ts). A node is redrawn only when one of its GIFs
           * changes frame, and only while it is on screen; under reduced motion they hold frame 0.
           */
          if (gifAnims.size && !live.current.reducedMotion && sprites) {
            const ms = seconds * 1000;
            for (const [nodeId, anim] of gifAnims) {
              const node = nodeById(nodeId);
              const sprite = spriteById.get(nodeId);
              if (!node || !sprite) continue;
              const rect = rects.find((r) => r.nodeId === nodeId);
              if (rect && !isVisible(rect, camera, view)) continue;
              let changed = false;
              for (const a of [anim.face, anim.logo]) {
                if (!a) continue;
                const step = gifFrameAt(a.delays, ms);
                if (step !== a.step) { a.step = step; changed = true; }
              }
              // Through drawNode, the one redraw path (test/render-invariants), without re-placing the sprite.
              if (changed) drawNode(nodeId, plateLifts.get(nodeId) ?? 0, false);
            }
          }

          // The animated JARVIS-face logos: follow their nodes, and step their faces.
          stepLiveLogos(seconds);

          // Chase and scan lights, at EFFECT_FPS. See effects.ts.
          const effectTick = Math.floor(seconds * EFFECT_FPS);
          if (effectTick !== lastEffectTick) {
            lastEffectTick = effectTick;
            drawEffects(seconds);
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
            // So do wire handles; leaving the mode drops an unkept reshape.
            wireEdit = null;
            focusedHandle = -1;
            buildGrid();
            rebuildOverlay();
          }

          const brokenKey = targetsKey(live.current.targets);
          const dragKey = drag.exceeded && (drag.kind === 'move' || drag.kind === 'resize')
            ? `${drag.kind}:${drag.nodeId}:${drag.currentTile?.x},${drag.currentTile?.y}:${drag.currentFootprint?.w}x${drag.currentFootprint?.h}:${drag.valid}`
            : drag.exceeded && drag.kind === 'group'
              ? `group:${drag.delta?.dx},${drag.delta?.dy}:${drag.valid}`
              : '';
          const edgeSelection = live.current.selectedEdgeId ?? null;
          if (
            live.current.selectedId !== lastSelection || edgeSelection !== lastEdgeSelection ||
            brokenKey !== lastBrokenKey || dragKey !== lastDragKey
          ) {
            // Another wire, or none: a half-made change and the focused handle belong to the old one.
            if (edgeSelection !== lastEdgeSelection) { wireEdit = null; focusedHandle = -1; }
            lastSelection = live.current.selectedId;
            lastEdgeSelection = edgeSelection;
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
        app.canvas.addEventListener('contextmenu', onContextMenu);
        // Touch: two-finger pinch through the exact zoom levels, long-press for the menu, double-tap to open.
        touch = new TouchGestures(app.canvas, {
          zoomStep: (direction, anchor) => {
            const camera = cameraStore.current;
            const next = stepZoom(camera.zoom, direction);
            if (next !== camera.zoom) cameraStore.current = clampCamera(setZoom(camera, next, viewport(), anchor), boardPx, viewport());
          },
          panBy: (dx, dy) => {
            const camera = cameraStore.current;
            cameraStore.current = clampCamera({ ...camera, x: camera.x - dx / camera.zoom, y: camera.y - dy / camera.zoom }, boardPx, viewport());
          },
          cancelDrag: (pointerId) => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId, button: -1 })),
          longPress: (clientX, clientY) => onContextMenu({ clientX, clientY, preventDefault: () => undefined } as unknown as MouseEvent),
          doubleTap: (clientX, clientY) => onDoubleClick({ clientX, clientY } as MouseEvent),
          toCanvas: (clientX, clientY) => canvasPoint({ clientX, clientY })
        });
        // Middle-drag pans, and the browser's default for middle-click is autoscroll.
        app.canvas.addEventListener('auxclick', (e) => e.preventDefault());
      } catch (err) {
        console.error(err);
        setError((err as Error).message);
      }
    })();

    return () => {
      disposed = true;
      offAvatar();
      offNodeMood();
      stopLiveLogos();
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
      // The tile's texture is ours, made per room; the app's teardown frees children, not textures.
      tileSprite?.destroy({ texture: true, textureSource: true });
      tileSprite = null;
      if (app) {
        app.canvas.removeEventListener('pointerdown', onPointerDown);
        touch?.dispose();
        touch = null;
        app.canvas.removeEventListener('contextmenu', onContextMenu);
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
  return <div className="board-host" ref={hostRef} style={props.lookFilter ? { filter: props.lookFilter } : undefined} />;
}
