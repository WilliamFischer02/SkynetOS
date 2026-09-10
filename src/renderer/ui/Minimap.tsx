import { useEffect, useRef } from 'react';
import type { Board } from '@shared/types.js';
import { footprintOf } from '@shared/types.js';
import { isBroken, type TargetInfo } from '@shared/targets.js';
import { useBoardStore } from '../store/useBoardStore.js';

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

/** Pixels per tile. 3 keeps a 64x40 board at 192x120 — big enough to aim at, small enough to sit in a corner. */
const SCALE = 3;

export function Minimap({ board, targets, cameraRef, onJump }: MinimapProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const uiScale = useBoardStore((s) => s.uiScale);

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
  }, [board, targets, cameraRef, width, height]);

  const jump = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    // The canvas is displayed at uiScale times its pixel size, so undo that before converting.
    const px = (event.clientX - rect.left) / (rect.width / width);
    const py = (event.clientY - rect.top) / (rect.height / height);
    onJump({ x: (px / SCALE) * board.grid.tile, y: (py / SCALE) * board.grid.tile });
  };

  return (
    <div className="minimap" title="Click to jump">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ width: width * uiScale, height: height * uiScale }}
        onClick={jump}
      />
    </div>
  );
}
