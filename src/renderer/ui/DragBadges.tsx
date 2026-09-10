import { useEffect, useRef } from 'react';
import type { Board } from '@shared/types.js';
import { footprintOf } from '@shared/types.js';
import type { ArtifactInfo } from '@shared/ipc.js';
import { useBoardStore } from '../store/useBoardStore.js';

/**
 * The drag-out handles — and the answer to CLAUDE.md's `startDrag` landmine.
 *
 * > "Electron `startDrag` on Windows kills in-app drop targets for the same gesture. Distinguish
 * > drag-out (from the node's file badge) from drag-to-move (from the node body) at the DOM
 * > level, with different handles."
 *
 * Once `startDrag` is called Windows owns the gesture and the app stops seeing it, so an in-app
 * drag can never become a drag-out or vice versa — the decision must be made at `dragstart`,
 * before any of that, purely from which element was grabbed.
 *
 * So every draggable file node gets a small DOM badge overlaid on the canvas, and that badge is
 * the ONLY drag-out handle. The node body underneath stays canvas and keeps drag-to-move. Two
 * elements, two gestures, decided by the DOM before Windows takes over.
 *
 * The badges track the camera in their own rAF loop rather than through React state — the board
 * pans at frame rate and re-rendering this list 165 times a second would be absurd.
 */

export interface DragBadgesProps {
  board: Board;
  artifacts: Record<string, ArtifactInfo>;
  cameraRef: React.RefObject<{ x: number; y: number; zoom: number; viewW: number; viewH: number }>;
}

/** Kinds that resolve to a single real file, and can therefore be dragged into another program. */
const DRAGGABLE = new Set(['file.artifact', 'file.document', 'file.exe']);

export function DragBadges({ board, artifacts, cameraRef }: DragBadgesProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const boardId = useBoardStore((s) => s.boardId);
  const toast = useBoardStore((s) => s.toast);
  const uiScale = useBoardStore((s) => s.uiScale);
  const select = useBoardStore((s) => s.select);

  const nodes = board.nodes.filter((n) => DRAGGABLE.has(n.kind));

  /*
   * Position every badge each frame from the live camera. The badge is CHROME, not board art: it
   * tracks a board position but keeps a fixed, readable size at the chrome scale, the way a map
   * pin does. Sizing it to the node's footprint instead — the first attempt — clipped
   * `thestalker-0.1.0.jar` down to `TH` on a 3-tile cartridge.
   */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let raf = 0;
    const place = () => {
      const cam = cameraRef.current;
      if (cam) {
        for (const el of Array.from(host.children) as HTMLElement[]) {
          const bx = Number(el.dataset['bx']);
          const by = Number(el.dataset['by']);
          // Whole device pixels, same rule as the board: round after scaling, never before.
          const sx = Math.round((bx - cam.x) * cam.zoom);
          const sy = Math.round((by - cam.y) * cam.zoom);
          const onScreen = sx > -400 && sy > -40 && sx < cam.viewW && sy < cam.viewH;
          el.style.transform = `translate(${sx}px, ${sy}px)`;
          el.style.visibility = onScreen ? 'visible' : 'hidden';
        }
      }
      raf = requestAnimationFrame(place);
    };
    raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [cameraRef, nodes.length, uiScale]);

  return (
    <div className="drag-badges" ref={hostRef}>
      {nodes.map((node) => {
        const fp = footprintOf(node);
        const info = artifacts[node.id];
        const label = node.kind === 'file.artifact'
          ? (info?.fileName ?? null)
          : (node.path?.split(/[\\/]/).pop() ?? null);
        const stale = info?.stale === 'stale';
        const missing = node.kind === 'file.artifact' && !info?.target.resolved;

        return (
          <div
            key={node.id}
            className={missing ? 'drag-badge missing' : stale ? 'drag-badge stale' : 'drag-badge'}
            data-bx={node.pos.x * board.grid.tile}
            data-by={(node.pos.y + fp.h) * board.grid.tile}
            /*
             * draggable + preventDefault + IPC is the required shape. Returning without
             * preventDefault would let Chromium start its own HTML drag, which carries no file
             * and lands nowhere useful.
             */
            draggable={!missing}
            title={missing ? 'No build to drag' : `Drag ${label ?? 'this file'} out into another program`}
            onClick={() => select(node.id)}
            onDragStart={(event) => {
              event.preventDefault();
              void window.skynet['drag:startFile'](boardId, node.id).then((result) => {
                if (!result.ok) toast('warn', result.error ?? 'could not start drag');
              });
            }}
          >
            <span className="badge-grip" aria-hidden="true">⠿</span>
            <span className="badge-label">
              {missing ? 'NO BUILD' : label ?? 'FILE'}
              {info?.version ? ` v${info.version}` : ''}
            </span>
            {stale ? <span className="badge-stale">STALE</span> : null}
          </div>
        );
      })}
    </div>
  );
}
