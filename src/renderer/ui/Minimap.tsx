import { useEffect, useRef } from 'react';
import type { Board } from '@shared/types.js';
import { footprintOf } from '@shared/types.js';
import { isBroken, type TargetInfo } from '@shared/targets.js';
import { useBoardStore } from '../store/useBoardStore.js';
import { Icon } from './Icon.js';

/**
 * The minimap: the whole room at a glance, with the viewport box, and click to jump. docs/03 §5.
 *
 * Drawn on a 2D canvas at a whole number of pixels per tile, so every component is a crisp
 * rectangle rather than a smeared one. It reads the camera from a shared ref and redraws in its
 * own rAF loop rather than through React state — the viewport box has to track a drag at frame
 * rate, and pushing 165 camera updates a second through a React render is absurd.
 */

export interface MinimapProps {
  board: Board;
  targets: Record<string, TargetInfo>;
  /** Live camera, written by the board canvas every frame. */
  cameraRef: React.RefObject<{ x: number; y: number; zoom: number; viewW: number; viewH: number }>;
  onJump: (world: { x: number; y: number }) => void;
}

/**
 * How wide the minimap wants to be, in art pixels, before the chrome scale is applied.
 *
 * This is the number that was missing. Pixels-per-tile used to be a constant — 3, chosen when a
 * board was 64 tiles wide and 3 x 64 was a tidy 192. Tripling every board to 192 tiles turned that
 * same constant into 576 art pixels, which at chrome scale 2 is over a thousand pixels of screen:
 * a minimap occupying a quarter of the window. William: "the minimap is way too big of a window."
 *
 * A panel's size should be a property of the PANEL, so this is the budget and the scale is derived
 * from it. A bigger board gets a smaller scale rather than a bigger panel.
 */
const BUDGET_PX = 240;

/** Pixels per tile that fits `grid` inside the budget. Integer, 1-4, like the board's own zoom. */
export function fitScale(grid: { width: number; height: number }): number {
  const byWidth = Math.floor(BUDGET_PX / grid.width);
  // Two thirds, so a tall board does not produce a panel taller than it is wide.
  const byHeight = Math.floor((BUDGET_PX * 0.66) / grid.height);
  return Math.min(4, Math.max(1, Math.min(byWidth, byHeight)));
}

export function Minimap({ board, targets, cameraRef, onJump }: MinimapProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const uiScale = useBoardStore((s) => s.uiScale);
  const minimapScale = useBoardStore((s) => s.minimapScale);
  const minimapOpen = useBoardStore((s) => s.minimapOpen);
  const setMinimapScale = useBoardStore((s) => s.setMinimapScale);
  const toggleMinimap = useBoardStore((s) => s.toggleMinimap);
  /*
   * Collapsed to its button by the layout manager when the window has no room for it: it would sit
   * on the left-hand stack or the usage meter, or the LOOK panel needs the height (chrome-layout.ts).
   * Opening it from there is a deliberate choice and is kept, through `minimapForced`, until closed.
   */
  const squeezed = useBoardStore((s) => s.layout.minimapSqueezed);
  const setMinimapForced = useBoardStore((s) => s.setMinimapForced);
  const shown = minimapOpen && !squeezed;

  /*
   * The stored preference is a NUDGE, not the scale. It is remembered across rooms, and rooms are
   * different sizes — a scale that suits a 144-tile room would blow a 192-tile board back out to
   * the size being fixed here. So the fit is computed per board and the preference moves it by up
   * to two steps either way.
   */
  const SCALE = Math.min(4, Math.max(1, fitScale(board.grid) + (minimapScale - 1)));

  const width = board.grid.width * SCALE;
  const height = board.grid.height * SCALE;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      ctx.fillStyle = board.theme.maskDark;
      ctx.fillRect(0, 0, width, height);

      for (const node of board.nodes) {
        if (node.kind === 'note.silk') continue;
        const fp = footprintOf(node);
        const info = targets[node.id];
        // A zone is an outline, not a block — filling it would hide everything inside it.
        if (node.kind === 'group.zone') {
          ctx.fillStyle = board.theme.maskLight;
          ctx.fillRect(node.pos.x * SCALE, node.pos.y * SCALE, fp.w * SCALE, 1);
          ctx.fillRect(node.pos.x * SCALE, (node.pos.y + fp.h) * SCALE - 1, fp.w * SCALE, 1);
          continue;
        }
        ctx.fillStyle = info && isBroken(info) ? '#D2453B' : board.theme.signal;
        ctx.fillRect(
          node.pos.x * SCALE,
          node.pos.y * SCALE,
          Math.max(1, fp.w * SCALE),
          Math.max(1, fp.h * SCALE)
        );
      }

      const cam = cameraRef.current;
      if (cam && cam.zoom > 0) {
        const vw = (cam.viewW / cam.zoom / board.grid.tile) * SCALE;
        const vh = (cam.viewH / cam.zoom / board.grid.tile) * SCALE;
        const vx = (cam.x / board.grid.tile) * SCALE;
        const vy = (cam.y / board.grid.tile) * SCALE;
        ctx.fillStyle = '#E9E4D6';
        // Four filled 1px edges, not a stroke — a 1px stroke straddles the pixel boundary.
        const rx = Math.round(vx);
        const ry = Math.round(vy);
        const rw = Math.max(2, Math.round(vw));
        const rh = Math.max(2, Math.round(vh));
        ctx.fillRect(rx, ry, rw, 1);
        ctx.fillRect(rx, ry + rh - 1, rw, 1);
        ctx.fillRect(rx, ry, 1, rh);
        ctx.fillRect(rx + rw - 1, ry, 1, rh);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // `shown`: the canvas only exists while the panel is open, so the loop has to re-attach to the
    // new one each time it comes back. Without it a re-opened minimap stayed blank.
  }, [board, targets, cameraRef, width, height, shown]);

  const jump = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    // The canvas is displayed at uiScale times its pixel size, so undo that before converting.
    const px = (event.clientX - rect.left) / (rect.width / width);
    const py = (event.clientY - rect.top) / (rect.height / height);
    onJump({ x: (px / SCALE) * board.grid.tile, y: (py / SCALE) * board.grid.tile });
  };

  /*
   * Resizing steps, because the scale is an integer and a smooth drag would lie about what it is
   * doing. Dragging left and up shrinks; the panel jumps a whole pixel-per-tile at a time, which is
   * the same bargain the board's own 2x/3x/4x zoom makes and for the same reason.
   */
  const onGrip = (event: React.PointerEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startScale = minimapScale;
    const STEP_PX = 90;

    const move = (e: PointerEvent): void => {
      // Grip is top-left, so dragging LEFT (negative) makes the panel bigger.
      setMinimapScale(startScale - Math.round((e.clientX - startX) / STEP_PX));
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (!shown) {
    const show = (): void => {
      if (!minimapOpen) toggleMinimap();
      setMinimapForced(true);
    };
    return (
      <div className={squeezed ? 'minimap collapsed squeezed' : 'minimap collapsed'}>
        <button
          type="button"
          className="minimap-toggle"
          onClick={show}
          title={squeezed ? 'The minimap moved aside to make room. Click to show it anyway.' : 'Show the minimap'}
          aria-label="Show the minimap"
        >
          <Icon name="map" />
        </button>
      </div>
    );
  }

  return (
    <div className="minimap">
      <div className="minimap-bar">
        <button
          type="button"
          className="minimap-grip"
          onPointerDown={onGrip}
          title="Drag to resize"
          aria-label="Resize the minimap"
        >
          <Icon name="resize" />
        </button>
        <span className="minimap-scale">{SCALE}×</span>
        <button
          type="button"
          className="minimap-toggle"
          onClick={() => { toggleMinimap(); setMinimapForced(false); }}
          title="Hide the minimap"
          aria-label="Hide the minimap"
        >
          <Icon name="close" />
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ width: width * uiScale, height: height * uiScale }}
        onClick={jump}
        title="Click to jump"
      />
    </div>
  );
}
