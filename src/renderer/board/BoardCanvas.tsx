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
import type { Board } from '@shared/types.js';
import { footprintOf, spriteKeyOf } from '@shared/types.js';
import {
  type Camera,
  type Viewport,
  type Zoom,
  boardPixelSize,
  clampCamera,
  isZoom,
  stagePosition,
  stepCamera,
  stepZoom,
  TILE
} from './camera.js';
import { buildSubstrate } from './substrate.js';
import { SpriteStore } from './sprites.js';
import fontUrl from '../../../assets/fonts/DepartureMono-1.500/DepartureMono-Regular.woff2?url';
import { ensureSilkFont } from './silkscreen.js';

/** Atlas URL, or null when there is none. Vite resolves this at build time; a missing file is fine. */
const ATLAS_URL: string | null = null; // M2 wires this to assets/atlas/skynet.json once art exists.

export interface BoardCanvasProps {
  board: Board;
  onStatus?: (status: BoardCanvasStatus) => void;
}

export interface BoardCanvasStatus {
  zoom: Zoom;
  cameraX: number;
  cameraY: number;
  devicePixelRatio: number;
  atlasFrames: number;
  placeholderCount: number;
  fps: number;
}

const PAN_KEYS: Record<string, keyof Omit<PanHeld, 'heldFrames'>> = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right'
};

interface PanHeld {
  up: boolean; down: boolean; left: boolean; right: boolean; heldFrames: number;
}

export function BoardCanvas({ board, onStatus }: BoardCanvasProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let app: Application | null = null;
    const held: PanHeld = { up: false, down: false, left: false, right: false, heldFrames: 0 };

    // M0 opens at 3x, per the roadmap's exit criterion.
    let camera: Camera = { x: 0, y: 0, zoom: 3 };

    const onKeyDown = (event: KeyboardEvent) => {
      const dir = PAN_KEYS[event.code];
      if (dir) { held[dir] = true; event.preventDefault(); return; }
      // Zoom keys are named for the zoom they select: 2 -> 2x, 3 -> 3x, 4 -> 4x.
      if (event.code === 'Digit2' || event.code === 'Digit3' || event.code === 'Digit4') {
        const z = Number(event.code.slice(-1));
        if (isZoom(z)) camera = { ...camera, zoom: z };
        event.preventDefault();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const dir = PAN_KEYS[event.code];
      if (dir) { held[dir] = false; event.preventDefault(); }
    };
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      camera = { ...camera, zoom: stepZoom(camera.zoom, event.deltaY < 0 ? 1 : -1) };
    };

    void (async () => {
      try {
        await ensureSilkFont(fontUrl);
        if (disposed) return;

        // Anti-mush rule 5, set before anything creates a texture.
        TextureSource.defaultOptions.scaleMode = 'nearest';
        TextureSource.defaultOptions.autoGenerateMipmaps = false;

        app = new Application();
        await app.init({
          preference: 'webgl',
          antialias: false,
          // The main process has already forced devicePixelRatio to 1, so resolution 1 with
          // autoDensity off means one canvas pixel is one device pixel. No resampling anywhere.
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

        const world = new Container();
        world.sortableChildren = false;
        app.stage.addChild(world);

        const boardPx = boardPixelSize(board.grid);

        // Layer 0 — substrate.
        world.addChild(buildSubstrate(
          { maskDark: board.theme.maskDark, maskLight: board.theme.maskLight, seed: board.theme.substrateSeed ?? 1 },
          boardPx
        ));

        // Layer 3 — node sprites. Every one of them is a placeholder right now, which is the
        // point: the whole board is legible and pannable with zero finished art.
        const sprites = new SpriteStore();
        const atlas = await sprites.load(ATLAS_URL);
        if (disposed) { app.destroy(true, { children: true }); return; }
        if (!atlas.loaded) console.info(`[atlas] ${atlas.reason} — every node renders as a placeholder`);

        const nodeLayer = new Container();
        world.addChild(nodeLayer);

        let placeholderCount = 0;
        for (const node of board.nodes) {
          // note.silk and group.zone are printed on the board, not mounted to it. M1 renders
          // them properly; M0 skips them rather than drawing a 0x0 rectangle.
          if (node.kind === 'note.silk' || node.kind === 'group.zone') continue;

          const fp = footprintOf(node);
          const key = spriteKeyOf(node);
          const texture = sprites.get(key) ?? sprites.placeholder({
            w: fp.w,
            h: fp.h,
            designator: node.designator ?? '',
            maskLight: board.theme.maskLight
          });
          if (!sprites.has(key)) placeholderCount++;

          const sprite = new Sprite(texture);
          sprite.x = node.pos.x * TILE;
          sprite.y = node.pos.y * TILE;
          sprite.roundPixels = true;
          nodeLayer.addChild(sprite);
        }

        let frames = 0;
        let fpsAccum = 0;
        let fps = 0;

        app.ticker.add((ticker) => {
          const view: Viewport = { width: app!.renderer.width, height: app!.renderer.height };

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

          fpsAccum += ticker.FPS;
          if (++frames >= 30) {
            fps = Math.round(fpsAccum / frames);
            fpsAccum = 0;
            frames = 0;
            onStatus?.({
              zoom: camera.zoom,
              cameraX: Math.round(camera.x),
              cameraY: Math.round(camera.y),
              devicePixelRatio: window.devicePixelRatio,
              atlasFrames: sprites.frameCount,
              placeholderCount,
              fps
            });
          }
        });

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        host.addEventListener('wheel', onWheel, { passive: false });
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
      app?.destroy(true, { children: true });
    };
  }, [board, onStatus]);

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
