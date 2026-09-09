import { useCallback, useEffect, useState } from 'react';
import { BoardCanvas, type BoardCanvasStatus } from './board/BoardCanvas.js';
import { Inspector } from './ui/Inspector.js';
import { useBoardStore } from './store/useBoardStore.js';

export function App(): React.JSX.Element {
  const load = useBoardStore((s) => s.load);
  const board = useBoardStore((s) => s.board);
  const boardId = useBoardStore((s) => s.boardId);
  const selectedId = useBoardStore((s) => s.selectedId);
  const targets = useBoardStore((s) => s.targets);
  const history = useBoardStore((s) => s.history);
  const toasts = useBoardStore((s) => s.toasts);
  const focus = useBoardStore((s) => s.focus);
  const loadBoard = useBoardStore((s) => s.loadBoard);
  const select = useBoardStore((s) => s.select);
  const beginEdit = useBoardStore((s) => s.beginEdit);
  const openNode = useBoardStore((s) => s.openNode);
  const undo = useBoardStore((s) => s.undo);
  const redo = useBoardStore((s) => s.redo);
  const toggleFocus = useBoardStore((s) => s.toggleFocus);

  const [status, setStatus] = useState<BoardCanvasStatus | null>(null);
  const onStatus = useCallback((next: BoardCanvasStatus) => setStatus(next), []);

  useEffect(() => { void loadBoard('root'); }, [loadBoard]);

  /**
   * Global shortcuts. Ctrl+Z / Ctrl+Y go through main's command bus, so they undo an agent's
   * edit exactly the same way they undo one of yours (CLAUDE.md prime directive 5).
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      const inForm = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');

      if (event.ctrlKey && event.code === 'KeyZ') { event.preventDefault(); void undo(); return; }
      if (event.ctrlKey && (event.code === 'KeyY' || (event.shiftKey && event.code === 'KeyZ'))) {
        event.preventDefault(); void redo(); return;
      }
      if (inForm) return;
      if (event.code === 'KeyE' && selectedId) { event.preventDefault(); beginEdit(selectedId); return; }
      if (event.code === 'KeyF') { event.preventDefault(); toggleFocus(); return; }
      if (event.code === 'KeyR') { event.preventDefault(); void loadBoard(boardId); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, selectedId, beginEdit, toggleFocus, loadBoard, boardId]);

  if (!load) return <div className="boot">READING BOARD…</div>;

  // "If a node cannot resolve its target, it renders as broken hardware and says exactly what is
  // missing." The board file itself is held to the same standard.
  if (!load.ok) {
    return (
      <div className="fault">
        <p>BOARD NOT LOADED</p>
        <p>{load.error}</p>
        <p className="dim">{load.file}</p>
        {load.problems?.length ? (
          <ul className="problem-list">
            {load.problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        ) : null}
        <button type="button" className="btn" onClick={() => void loadBoard(boardId)}>Re-read board file (R)</button>
      </div>
    );
  }

  if (!board) return <div className="boot">READING BOARD…</div>;

  return (
    <div className="app">
      <BoardCanvas
        board={board}
        selectedId={selectedId}
        targets={targets}
        focus={focus}
        onSelect={select}
        onActivate={(nodeId) => void openNode(nodeId)}
        onStatus={onStatus}
      />

      <div className="breadcrumb">{(board.engraving ?? board.name).toUpperCase()}</div>

      <div className="hud">
        {status ? (
          <>
            <span>ZOOM {status.zoom}X</span>
            <span>CAM {status.cameraX},{status.cameraY}</span>
            <span>DPR {status.devicePixelRatio}</span>
            <span>{status.fps} FPS</span>
            <span>{board.nodes.length} NODES · {board.edges.length} TRACES</span>
            {status.brokenCount > 0 ? <span className="fault-text">{status.brokenCount} BROKEN</span> : <span className="ok-text">ALL BOUND</span>}
            <span className={status.atlasFrames === 0 ? 'warn' : undefined}>
              ATLAS {status.atlasFrames} · {status.placeholderCount} PLACEHOLDER
            </span>
          </>
        ) : (
          <span>INITIALISING RENDERER…</span>
        )}
      </div>

      <Inspector />

      <div className="help">
        WASD PAN · 2 3 4 ZOOM · TAB CYCLE · SPACE ACTIVATE · E EDIT · F FOCUS{focus ? ' (ON)' : ''} · R RELOAD
        {history.canUndo ? ` · CTRL+Z UNDO ${history.undoLabel?.toUpperCase() ?? ''}` : ''}
        {history.canRedo ? ' · CTRL+Y REDO' : ''}
      </div>

      <div className="toasts">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.level}`}>{t.text}</div>)}
      </div>
    </div>
  );
}
