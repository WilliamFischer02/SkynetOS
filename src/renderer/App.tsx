import { useCallback, useEffect, useRef, useState } from 'react';
import { BoardCanvas, type BoardCanvasStatus } from './board/BoardCanvas.js';
import { formatZoom } from './board/camera.js';
import { Inspector } from './ui/Inspector.js';
import { Iris } from './ui/Iris.js';
import { UsageMeter } from './ui/UsageMeter.js';
import { AddPalette } from './ui/AddPalette.js';
import { Mailbox } from './ui/Mailbox.js';
import { SystemMonitor } from './ui/SystemMonitor.js';
import { Minimap } from './ui/Minimap.js';
import { SessionDock } from './ui/SessionDock.js';
import { DragBadges } from './ui/DragBadges.js';
import { IngestWizard } from './ui/IngestWizard.js';
import { useBoardStore } from './store/useBoardStore.js';
import { isBroken } from '@shared/targets.js';

/**
 * The DOM chrome's scale.
 *
 * Main forces `devicePixelRatio` to 1 so the board is pixel-exact at any OS scaling (docs/02
 * anti-mush rule 9). The side effect is that every CSS pixel is one *device* pixel, so on a
 * display at 200% the chrome came out half the physical size it should be — 11px silkscreen type
 * rendered 11 device pixels tall instead of 22. Correct, and unreadable.
 *
 * So the chrome gets its own integer scale, taken from the same scale factor the board cancels.
 * Integer only, and every chrome dimension is a multiple of `--p`, so a 1px border stays a whole
 * number of device pixels and Departure Mono stays on a multiple of 11 — pixel-perfect at 11, 22
 * and 33 and nowhere in between.
 */
function uiScaleFor(scaleFactor: number): number {
  return Math.min(3, Math.max(1, Math.round(scaleFactor)));
}

export function App(): React.JSX.Element {
  const load = useBoardStore((s) => s.load);
  const board = useBoardStore((s) => s.board);
  const boardId = useBoardStore((s) => s.boardId);
  const selectedId = useBoardStore((s) => s.selectedId);
  const targets = useBoardStore((s) => s.targets);
  const history = useBoardStore((s) => s.history);
  const toasts = useBoardStore((s) => s.toasts);
  const focus = useBoardStore((s) => s.focus);
  const mode = useBoardStore((s) => s.mode);
  const stack = useBoardStore((s) => s.stack);
  const jumpTo = useBoardStore((s) => s.jumpTo);
  const ascend = useBoardStore((s) => s.ascend);
  const requestJump = useBoardStore((s) => s.requestJump);
  const setUiScale = useBoardStore((s) => s.setUiScale);
  const loadBoard = useBoardStore((s) => s.loadBoard);
  const select = useBoardStore((s) => s.select);
  const beginEdit = useBoardStore((s) => s.beginEdit);
  const setMode = useBoardStore((s) => s.setMode);
  const openNode = useBoardStore((s) => s.openNode);
  const moveNode = useBoardStore((s) => s.moveNode);
  const moveNodes = useBoardStore((s) => s.moveNodes);
  const resizeNode = useBoardStore((s) => s.resizeNode);
  const connectNodes = useBoardStore((s) => s.connectNodes);
  const toast = useBoardStore((s) => s.toast);
  const usageRoutes = useBoardStore((s) => s.usageRoutes);
  const paletteOpen = useBoardStore((s) => s.paletteOpen);
  const setPaletteOpen = useBoardStore((s) => s.setPaletteOpen);
  const mailboxOpen = useBoardStore((s) => s.mailboxOpen);
  const setMailboxOpen = useBoardStore((s) => s.setMailboxOpen);
  const refreshUsageRoutes = useBoardStore((s) => s.refreshUsageRoutes);
  const undo = useBoardStore((s) => s.undo);
  const redo = useBoardStore((s) => s.redo);
  const toggleFocus = useBoardStore((s) => s.toggleFocus);

  const liveSessionCount = useBoardStore((s) => s.sessions.filter((x) => x.state === 'running').length);
  const artifacts = useBoardStore((s) => s.artifacts);
  const offerIngest = useBoardStore((s) => s.offerIngest);
  const staleCount = Object.values(artifacts).filter((a) => a.stale === 'stale').length;
  const [status, setStatus] = useState<BoardCanvasStatus | null>(null);
  const uiScale = useBoardStore((s) => s.uiScale);
  const onStatus = useCallback((next: BoardCanvasStatus) => setStatus(next), []);
  // Written by the canvas every frame; read by the minimap in its own rAF loop. Deliberately a
  // ref and not state — 165 camera updates a second through React would be absurd.
  const cameraRef = useRef({ x: 0, y: 0, zoom: 3, viewW: 0, viewH: 0 });

  useEffect(() => { void loadBoard('root'); }, [loadBoard]);

  // Live session and service state is pushed from main; the dock must never poll.
  const subscribeToProcesses = useBoardStore((s) => s.subscribeToProcesses);
  useEffect(() => subscribeToProcesses(), [subscribeToProcesses]);

  /*
   * Usage drives the couriers, and usage moves on the scale of minutes — a scan reads every
   * conversation file on this disk. Polling it per frame would cost more than the freshness is
   * worth, so this is deliberately slow and deliberately not tied to the render loop.
   */
  useEffect(() => {
    const timer = setInterval(() => { void refreshUsageRoutes(); }, 30_000);
    return () => clearInterval(timer);
  }, [refreshUsageRoutes]);

  /*
   * Relink a broken node the moment the thing it points at appears.
   *
   * William, on moving to a second machine: "if links break I can simply add the missing folders or
   * exe's and it will relink." That was ALMOST true — resolution is never cached, so a redraw
   * always asks the filesystem afresh. What was missing is anything to prompt the redraw: targets
   * are re-resolved on a `files:changed` event, and a directory that does not exist cannot be
   * watched, so the one case that needed it was the one case that never fired.
   *
   * Polling, but only while something is actually broken — on a healthy board this does nothing at
   * all, and on a broken one it is a handful of `stat` calls every few seconds. It stops on its own
   * the moment the last fault clears.
   */
  const broken = Object.values(targets).filter((t) => isBroken(t)).length;
  const refreshTargets = useBoardStore((s) => s.refreshTargets);
  useEffect(() => {
    if (broken === 0) return;
    const timer = setInterval(() => { void refreshTargets(); }, 5_000);
    return () => clearInterval(timer);
  }, [broken, refreshTargets]);

  useEffect(() => {
    void window.skynet['display:info']().then((info) => {
      const scale = uiScaleFor(info.scaleFactor);
      setUiScale(scale);
      document.documentElement.style.setProperty('--ui-scale', String(scale));
      console.info(`[ui] OS scaleFactor ${info.scaleFactor} -> chrome scale ${scale}x (silkscreen at ${11 * scale}px)`);
    });
  }, []);

  const editMode = mode === 'edit';

  /*
   * The chrome takes the room's colours too. Descending into MinecraftOS should not leave the
   * inspector and the HUD wearing SKYNET green — the whole point of a room theme is that the
   * place looks different when you are in it.
   */
  useEffect(() => {
    if (!board) return;
    const root = document.documentElement.style;
    root.setProperty('--mask-dark', board.theme.maskDark);
    root.setProperty('--mask-light', board.theme.maskLight);
    root.setProperty('--signal', board.theme.signal);
  }, [board]);

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

      // E is Edit Board mode, per docs/03 §1 — the grid overlay and draggable components.
      // Editing the selected node's FIELDS is F2, which keeps the two meanings of "edit" apart.
      if (event.code === 'KeyE') { event.preventDefault(); setMode(editMode ? 'view' : 'edit'); return; }
      // N adds a component. Edit Board mode only — placing a node is an edit, and the mode is
      // what separates browsing a board from rearranging one.
      // M opens the JARVIS mailbox. Not gated on Edit Board mode: leaving a message for the
      // Hands is something you do while looking at the board, not while rearranging it.
      if (event.code === 'KeyM') { event.preventDefault(); setMailboxOpen(!mailboxOpen); return; }
      if (event.code === 'KeyN' && editMode) {
        event.preventDefault();
        setPaletteOpen(!paletteOpen);
        return;
      }
      if (event.code === 'F2' && selectedId) { event.preventDefault(); beginEdit(selectedId); return; }
      if (event.code === 'KeyF') { event.preventDefault(); toggleFocus(); return; }
      if (event.code === 'KeyR') { event.preventDefault(); void loadBoard(boardId); return; }
      // Backspace always goes up a room. Escape deselects first, and goes up only when there is
      // nothing selected — so Escape never surprises you out of a room you were working in.
      if (event.code === 'Backspace') { event.preventDefault(); void ascend(); return; }
      if (event.code === 'Escape' && !selectedId) { event.preventDefault(); void ascend(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, selectedId, beginEdit, setMode, editMode, toggleFocus, loadBoard, boardId, paletteOpen, setPaletteOpen, mailboxOpen, setMailboxOpen]);

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

  /*
   * Drop-in ingestion. The whole window is a drop target: dragging a repo from Explorer onto the
   * board should work wherever you let go, not only over one small zone.
   *
   * `dragover` must preventDefault or the browser refuses the drop entirely, and Chromium's
   * default action for a dropped file is to NAVIGATE to it — which would replace the app with a
   * jar. docs/07 blocks navigation anyway, but preventing it here is what makes the drop land.
   */
  const onDragOver = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const onDrop = (event: React.DragEvent) => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    const paths = window.skynet.pathsForFiles(Array.from(event.dataTransfer.files));
    if (!paths.length) return;
    const cam = cameraRef.current;
    const world = cam
      ? { x: (cam.x + event.clientX / cam.zoom) / board.grid.tile, y: (cam.y + event.clientY / cam.zoom) / board.grid.tile }
      : { x: 1, y: 1 };
    void offerIngest(paths, { x: Math.floor(world.x), y: Math.floor(world.y) });
  };

  return (
    <div
      className={[
        'app',
        editMode ? 'edit-mode' : '',
        // Drives the chrome offsets in styles.css: everything that dodges the inspector
        // reclaims that space the moment nothing is selected.
        selectedId ? 'inspector-open' : ''
      ].filter(Boolean).join(' ')}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <BoardCanvas
        board={board}
        boardId={boardId}
        selectedId={selectedId}
        targets={targets}
        focus={focus}
        editMode={editMode}
        onSelect={select}
        onActivate={(nodeId) => void openNode(nodeId)}
        onMoveNode={(nodeId, pos) => void moveNode(nodeId, pos)}
        onMoveNodes={(moves) => void moveNodes(moves)}
        onResizeNode={(nodeId, footprint) => void resizeNode(nodeId, footprint)}
        onConnect={(from, to) => void connectNodes(from, to)}
        onToast={(text, level) => toast(level, text)}
        usageRoutes={usageRoutes}
        onStatus={onStatus}
        cameraRef={cameraRef}
        jumpTo={jumpTo}
      />

      <div className="breadcrumb">
        {stack.map((crumb, i) => (
          <span key={crumb.boardId} className={i === stack.length - 1 ? 'crumb here' : 'crumb'}>
            {i > 0 ? <span className="crumb-sep">/</span> : null}
            {crumb.engraving}
          </span>
        ))}
        {editMode ? <span className="mode-badge">EDIT BOARD</span> : null}
        {/*
          * The "+" box. William: "while in board edit mode those / any and all aesthetic
          * preconstructed assets should be available to add via a '+' box somewhere on screen."
          *
          * In the breadcrumb row rather than floating over the board. Floating, it collided with
          * whatever happened to be under it — the session dock, whose height depends on how many
          * sessions are running, and then the help bar. This row already exists, already grows
          * with its content, and is the one strip of chrome nothing else is ever drawn into.
          */}
        {editMode ? (
          <button
            type="button"
            className="add-fab"
            onClick={() => setPaletteOpen(!paletteOpen)}
            title="Add a component or a board part (N)"
          >
            + ADD
          </button>
        ) : null}
      </div>

      {/* Top-left, under the breadcrumb: what this is costing, measured off disk. */}
      <UsageMeter />

      <AddPalette />
      <Mailbox />
      <SystemMonitor />

      <div className="hud">
        {status ? (
          <>
            <span>ZOOM {formatZoom(status.zoom)}</span>
            <span>CAM {status.cameraX},{status.cameraY}</span>
            <span>DPR {status.devicePixelRatio} · UI {uiScale}X</span>
            <span>{status.fps} FPS</span>
            <span>{board.nodes.length} NODES · {board.edges.length} TRACES</span>
            {status.fitsOnScreen ? <span className="warn">WHOLE BOARD VISIBLE — NOTHING TO PAN</span> : null}
            {status.groupCount > 1 ? <span className="ok-text">{status.groupCount} SELECTED · DRAG ANY TO MOVE ALL · ESC CLEARS</span> : null}
            {status.faceCount > 0 ? <span className="ok-text">{status.faceCount} FACE{status.faceCount === 1 ? '' : 'S'}</span> : null}
            {status.courierCount > 0 ? <span className="ok-text" title="Couriers walking. One robot per packet, in proportion to real Claude usage per project.">{status.courierCount} COURIER{status.courierCount === 1 ? '' : 'S'}</span> : null}
            {liveSessionCount > 0 ? <span className="ok-text">{liveSessionCount} LIVE</span> : null}
            {staleCount > 0 ? <span className="warn">{staleCount} STALE</span> : null}
            <span className={status.fallbackCount > 0 ? 'warn' : undefined}>
              ROUTED {status.routedCount}{status.fallbackCount > 0 ? ` · ${status.fallbackCount} DIRECT` : ''}
            </span>
            {status.brokenCount > 0 ? <span className="fault-text">{status.brokenCount} BROKEN</span> : <span className="ok-text">ALL BOUND</span>}
            <span className={status.atlasFrames === 0 ? 'warn' : undefined}>
              ATLAS {status.atlasFrames} · {status.placeholderCount} PLACEHOLDER
            </span>
          </>
        ) : (
          <span>INITIALISING RENDERER…</span>
        )}
      </div>

      <Minimap board={board} targets={targets} cameraRef={cameraRef} onJump={requestJump} />

      <DragBadges board={board} artifacts={artifacts} cameraRef={cameraRef} />
      <SessionDock />
      <IngestWizard />
      <Inspector />
      <Iris />

      <div className="help">
        {editMode
          ? 'DRAG A COMPONENT TO MOVE IT · SHIFT+DRAG TO SELECT A GROUP · SHIFT+CLICK ADDS ONE · CLICK TWO NODE EDGES TO WIRE THEM · DRAG THE SUBSTRATE TO PAN · E LEAVE EDIT BOARD'
          : 'DRAG TO PAN · WASD PAN · WHEEL OR 1-4 ZOOM · 0 WHOLE BOARD · TAB CYCLE · SPACE ACTIVATE · E EDIT BOARD · F2 EDIT NODE'}
        {stack.length > 1 ? ' · BACKSPACE UP A ROOM' : ''}
        {focus ? ' · FOCUS ON' : ''}
        {history.canUndo ? ` · CTRL+Z UNDO ${history.undoLabel?.toUpperCase() ?? ''}` : ''}
      </div>

      <div className="toasts">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.level}`}>{t.text}</div>)}
      </div>
    </div>
  );
}
