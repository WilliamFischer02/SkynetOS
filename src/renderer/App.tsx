import { useCallback, useEffect, useState } from 'react';
import type { Board } from '@shared/types.js';
import type { BoardLoad } from '@shared/ipc.js';
import { BoardCanvas, type BoardCanvasStatus } from './board/BoardCanvas.js';

export function App(): React.JSX.Element {
  const [load, setLoad] = useState<BoardLoad | null>(null);
  const [status, setStatus] = useState<BoardCanvasStatus | null>(null);

  useEffect(() => {
    void window.skynet['board:load']('root').then(setLoad);
  }, []);

  const onStatus = useCallback((next: BoardCanvasStatus) => setStatus(next), []);

  if (!load) {
    return <div className="boot">READING BOARD…</div>;
  }

  // "If a node cannot resolve its target, it renders as broken hardware and says exactly what is
  // missing." The board file itself is held to the same standard.
  if (!load.ok) {
    return (
      <div className="fault">
        <p>BOARD NOT LOADED</p>
        <p>{load.error}</p>
        <p className="dim">{load.file}</p>
      </div>
    );
  }

  const board: Board = load.board;

  return (
    <div className="app">
      <BoardCanvas board={board} onStatus={onStatus} />
      <div className="breadcrumb">{(board.engraving ?? board.name).toUpperCase()}</div>
      <div className="hud">
        {status ? (
          <>
            <span>ZOOM {status.zoom}X</span>
            <span>CAM {status.cameraX},{status.cameraY}</span>
            <span>DPR {status.devicePixelRatio}</span>
            <span>{status.fps} FPS</span>
            <span>{board.nodes.length} NODES</span>
            <span className={status.atlasFrames === 0 ? 'warn' : undefined}>
              ATLAS {status.atlasFrames} FRAMES · {status.placeholderCount} PLACEHOLDER
            </span>
          </>
        ) : (
          <span>INITIALISING RENDERER…</span>
        )}
      </div>
      <div className="help">WASD / ARROWS PAN · 2 3 4 ZOOM · CTRL+SCROLL ZOOM</div>
    </div>
  );
}
