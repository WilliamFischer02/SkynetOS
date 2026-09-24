import { useCallback, useEffect, useRef, useState } from 'react';
import { BoardCanvas, type BoardCanvasStatus } from './board/BoardCanvas.js';
import { formatZoom } from './board/camera.js';
import { Inspector } from './ui/Inspector.js';
import { EdgeInspector } from './ui/EdgeInspector.js';
import { Iris } from './ui/Iris.js';
import { UsageMeter } from './ui/UsageMeter.js';
import { AddPalette } from './ui/AddPalette.js';
import { Mailbox } from './ui/Mailbox.js';
import { SystemMonitor } from './ui/SystemMonitor.js';
import { Explorer } from './ui/Explorer.js';
import { Minimap } from './ui/Minimap.js';
import { SessionDock } from './ui/SessionDock.js';
import { DragBadges } from './ui/DragBadges.js';
import { IngestWizard } from './ui/IngestWizard.js';
import { PromptBoxes } from './ui/PromptBoxes.js';
import { BoardLook } from './ui/BoardLook.js';
import { Vignette } from './ui/Vignette.js';
import { lookFilter } from '@shared/look.js';
import { Phantoms } from './ui/Phantoms.js';
import { ContextMenu } from './ui/ContextMenu.js';
import { SummonDialog } from './ui/SummonDialog.js';
import { JarvisDock } from './ui/JarvisDock.js';
import { AwayScreen, useAway } from './ui/AwayScreen.js';
import { CommandPalette } from './ui/CommandPalette.js';
import { SettingsPanel } from './ui/SettingsPanel.js';
import { NotificationBell, NotificationCentre } from './ui/NotificationCentre.js';
import { AboutBox } from './ui/AboutBox.js';
import { FirstRunHints } from './ui/FirstRunHints.js';
import { Icon } from './ui/Icon.js';
import { useChromeLayout } from './ui/useChromeLayout.js';
import { useGesture } from './ui/useGesture.js';
import { useVoice } from './ui/useVoice.js';
import { MatrixView } from './matrix/MatrixView.js';
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

/** Every key, grouped by what you are doing. Shown with ?. */
const KEY_GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Look around',
    keys: [
      ['DRAG · WASD · ARROWS', 'pan'],
      ['WHEEL · - =', 'zoom'],
      ['1 – 8', 'zoom level (1X to 8X)'],
      ['0', 'whole board'],
      ['TAB', 'next node'],
      ['F', 'focus on the selection'],
      ['SHIFT+H', 'hide · show recommended nodes'],
      ['BACKSPACE', 'up a room']
    ]
  },
  {
    title: 'Act',
    keys: [
      ['SPACE · ENTER · DOUBLE-CLICK', 'activate'],
      ['F2', 'edit the node'],
      ['ENTER · DELETE ON A REC', 'approve · dismiss it'],
      ['M', 'JARVIS mailbox'],
      ['F5', 'refresh files and builds'],
      ['R', 're-read the board'],
      ['CTRL+Z · CTRL+Y', 'undo · redo'],
      ['RIGHT-CLICK', 'copy · paste · summon JARVIS'],
      ['CTRL+C · CTRL+V', 'copy · paste nodes'],
      ['/', 'message JARVIS (corner prompt)'],
      ['SHIFT+Z', 'sleep now (away mode)']
    ]
  },
  {
    title: 'Edit Board (E)',
    keys: [
      ['DRAG A NODE', 'move it'],
      ['SHIFT+DRAG', 'select a group'],
      ['SHIFT+CLICK', 'add to the group'],
      ['CLICK TWO EDGES', 'wire them'],
      ['CLICK A WIRE', 'restyle it'],
      ['CORNER · SHIFT+ARROWS', 'resize'],
      ['N', 'add a component']
    ]
  },
  {
    title: 'Panels',
    keys: [
      ['CTRL+K', 'find a node, a room or an action'],
      ['CTRL+,', 'settings'],
      ['?', 'this list'],
      ['L', 'board look · colour, vignette, floor'],
      ['`', 'renderer diagnostics'],
      ['ESC', 'close · deselect']
    ]
  }
];

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
  const selectedEdgeId = useBoardStore((s) => s.selectedEdgeId);
  const selectEdge = useBoardStore((s) => s.selectEdge);
  const updateEdge = useBoardStore((s) => s.updateEdge);
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
  const lookPreview = useBoardStore((s) => s.lookPreview);
  const hidePhantoms = useBoardStore((s) => s.hidePhantoms);
  const copyNodes = useBoardStore((s) => s.copyNodes);
  const pasteNodes = useBoardStore((s) => s.pasteNodes);
  const setContextMenu = useBoardStore((s) => s.setContextMenu);
  // A wake report is waiting behind the HUD chip once the away screen has been left.
  const awayReportWaiting = useAway((s) => s.reportAvailable && s.view === 'hidden');

  const liveSessionCount = useBoardStore((s) => s.sessions.filter((x) => x.state === 'running').length);
  const artifacts = useBoardStore((s) => s.artifacts);
  const offerIngest = useBoardStore((s) => s.offerIngest);
  const staleCount = Object.values(artifacts).filter((a) => a.stale === 'stale').length;
  const [status, setStatus] = useState<BoardCanvasStatus | null>(null);
  /**
   * The full key reference (?) and the renderer diagnostics (`). Both stay off until asked for. The
   * key list and LOOK are in the store so the command palette and Settings can open them too.
   */
  const keysOpen = useBoardStore((s) => s.keysOpen);
  const setKeysOpen = useBoardStore((s) => s.setKeysOpen);
  const [diagOpen, setDiagOpen] = useState(false);
  /** The LOOK panel (L): the room's colour, vignette and tiled floor. */
  const lookOpen = useBoardStore((s) => s.lookOpen);
  const setLookOpen = useBoardStore((s) => s.setLookOpen);
  /** The layout manager's plan (ui/chrome-layout.ts), and what the user folded or hid. */
  const layout = useBoardStore((s) => s.layout);
  const chromePrefs = useBoardStore((s) => s.chromePrefs);
  const gestureStatus = useBoardStore((s) => s.gestureStatus);
  const setGestureEnabled = useBoardStore((s) => s.setGestureEnabled);
  const setChromePref = useBoardStore((s) => s.setChromePref);
  const setCommandPaletteOpen = useBoardStore((s) => s.setCommandPaletteOpen);
  const setSettingsOpen = useBoardStore((s) => s.setSettingsOpen);
  const appRef = useRef<HTMLDivElement>(null);
  useChromeLayout(appRef);
  // Manual control: gestures arrive as synthesised pointer events, so the board's own drag runs
  // them. Nothing here re-renders per frame — see ui/useGesture.ts.
  useGesture();
  useVoice();
  const voiceStatus = useBoardStore((s) => s.voiceStatus);
  const setVoiceEnabled = useBoardStore((s) => s.setVoiceEnabled);
  const matrixOpen = useBoardStore((s) => s.matrixOpen);
  const setMatrixOpen = useBoardStore((s) => s.setMatrixOpen);
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
  const refreshFiles = useBoardStore((s) => s.refreshFiles);
  useEffect(() => {
    if (broken === 0) return;
    /*
     * 5 s at first, doubling to a 30 s ceiling while nothing changes. Some targets stay broken
     * for good on a given machine (repos that only exist on the other desktop), and re-resolving
     * the whole board every 5 s forever is a stat storm for nothing. A change in the broken count
     * re-runs this effect, which re-arms the fast cadence.
     */
    let delay = 5_000;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async (): Promise<void> => {
      // refreshFiles, not refreshTargets alone: a jar that appears must also get its file name,
      // version and staleness, which live in `artifacts`. Until 2026-09-21 the target healed and
      // the cartridge went on saying NO BUILD.
      await refreshFiles();
      delay = Math.min(30_000, delay * 2);
      timer = setTimeout(() => void tick(), delay);
    };
    timer = setTimeout(() => void tick(), delay);
    return () => clearTimeout(timer);
  }, [broken, refreshFiles]);

  /*
   * Coming back to the window re-reads the files. The usual sequence is: build in a terminal, click
   * back on the board, look at the jar. The watchers should already have caught it; this is the
   * net under them, and it costs one resolve per return, at most one every five seconds.
   */
  useEffect(() => {
    let last = 0;
    const onFocus = (): void => {
      const now = Date.now();
      if (now - last < 5_000) return;
      last = now;
      void refreshFiles();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshFiles]);

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
      // Ctrl+K finds anything, Ctrl+, is Settings: from anywhere, a form field included, as in other apps.
      if (event.ctrlKey && event.code === 'KeyK') {
        event.preventDefault();
        setCommandPaletteOpen(!useBoardStore.getState().commandPaletteOpen);
        return;
      }
      if (event.ctrlKey && event.code === 'Comma') {
        event.preventDefault();
        setSettingsOpen(!useBoardStore.getState().settingsOpen);
        return;
      }
      if (event.code === 'F5') { event.preventDefault(); void refreshFiles({ announce: true }); return; }
      if (inForm) return;

      // ? lists every key; ` shows the renderer's diagnostics. Chrome only, both toggles.
      if (event.key === '?') { event.preventDefault(); setKeysOpen(!keysOpen); return; }
      if (event.code === 'Backquote') { event.preventDefault(); setDiagOpen((v) => !v); return; }
      if (event.code === 'Escape' && keysOpen) { event.preventDefault(); setKeysOpen(false); return; }
      // Escape closes the LOOK panel before it is allowed to mean "up a room".
      if (event.code === 'Escape' && lookOpen) { event.preventDefault(); setLookOpen(false); return; }
      if (event.code === 'KeyL' && !event.ctrlKey) { event.preventDefault(); setLookOpen(!lookOpen); return; }
      // G opens THE MATRIX. While it is open it takes the keys itself, G and Esc included, to leave.
      if (event.code === 'KeyG' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        const store = useBoardStore.getState();
        store.setMatrixOpen(!store.matrixOpen);
        return;
      }
      // Shift+H hides JARVIS's recommended nodes, or shows them again. Read from the store here so
      // this handler's dependency list does not grow a flag it only flips.
      if (event.shiftKey && event.code === 'KeyH') {
        event.preventDefault();
        const store = useBoardStore.getState();
        store.setHidePhantoms(!store.hidePhantoms);
        return;
      }

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
      // F5 re-reads the FILES the board points at (a rebuilt jar, a saved manuscript). R re-reads
      // the board's own JSON. F5 works from a form field too, as it does everywhere else.
      if (event.code === 'KeyR') { event.preventDefault(); void loadBoard(boardId); return; }
      // Backspace always goes up a room. Escape deselects first, and goes up only when there is
      // nothing selected — so Escape never surprises you out of a room you were working in.
      if (event.code === 'Backspace') { event.preventDefault(); void ascend(); return; }
      if (event.code === 'Escape' && !selectedId) { event.preventDefault(); void ascend(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [refreshFiles, undo, redo, selectedId, beginEdit, setMode, editMode, toggleFocus, loadBoard, boardId, paletteOpen, setPaletteOpen, mailboxOpen, setMailboxOpen, keysOpen, lookOpen, setKeysOpen, setLookOpen, setCommandPaletteOpen, setSettingsOpen]);

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

  /*
   * The HUD's chips, each marked primary or not. The layout manager (ui/chrome-layout.ts) keeps the
   * HUD on one line between the breadcrumb and the right-hand chrome; when every chip will not fit
   * it goes compact and the secondary chips move behind a + button. What it measures is an
   * invisible copy holding every chip, so it knows the full width even while some are hidden.
   */
  const hudChips: { id: string; primary: boolean; node: React.ReactNode }[] = [];
  const chip = (id: string, primary: boolean, node: React.ReactNode): void => { hudChips.push({ id, primary, node }); };
  if (status) {
    chip('zoom', true, <span>ZOOM {formatZoom(status.zoom)}</span>);
    // Renderer diagnostics: useful when something is wrong, noise when it is not. ` shows them.
    if (diagOpen) {
      chip('cam', false, <span>CAM {status.cameraX},{status.cameraY}</span>);
      chip('dpr', false, <span>DPR {status.devicePixelRatio} · UI {uiScale}X</span>);
      chip('fps', false, <span>{status.fps} FPS</span>);
    }
    chip('count', false, <span>{board.nodes.length} NODES · {board.edges.length} TRACES</span>);
    if (status.fitsOnScreen) chip('fits', false, <span className="warn">WHOLE BOARD VISIBLE — NOTHING TO PAN</span>);
    if (status.groupCount > 1) {
      chip('group', true, <span className="ok-text">{status.groupCount} SELECTED</span>);
      chip('group-hint', false, <span className="ok-text">DRAG ANY TO MOVE ALL · ESC CLEARS</span>);
    }
    if (status.faceCount > 0) chip('faces', false, <span className="ok-text">{status.faceCount} FACE{status.faceCount === 1 ? '' : 'S'}</span>);
    if (status.courierCount > 0) {
      chip('couriers', false, (
        <span className="ok-text" title="Couriers walking. One robot per packet, in proportion to real Claude usage per project.">
          {status.courierCount} COURIER{status.courierCount === 1 ? '' : 'S'}
        </span>
      ));
    }
    if (board.phantoms?.length) {
      chip('phantoms', false, (
        <span
          className="ok-text"
          title="Recommended nodes: JARVIS's suggestions for this room. Tick to approve, cross to dismiss. Shift+H hides them."
        >
          {board.phantoms.length} RECOMMENDED{hidePhantoms ? ' · HIDDEN' : ''}
        </span>
      ));
    }
    /*
     * Manual control, as a HUD chip rather than a panel of its own: it then takes part in the
     * layout manager's compaction and can never overlap anything (ui/chrome-layout.ts). Primary,
     * so it survives a narrow window — a mode that drives the board must not hide behind a +N.
     */
    if (gestureStatus.phase !== 'off') {
      const tracking = gestureStatus.phase === 'tracking';
      chip('gesture', true, (
        <button
          type="button"
          className={gestureStatus.phase === 'unavailable' ? 'away-chip warn' : tracking ? 'away-chip ok-text' : 'away-chip'}
          onClick={() => void setGestureEnabled(false)}
          title={
            gestureStatus.error
              ? gestureStatus.error
              : `${gestureStatus.cameras.map((c) => `${c.label}: ${c.fps} fps`).join(' · ') || 'starting'} — click to switch manual control off`
          }
        >
          {gestureStatus.phase === 'unavailable'
            ? 'MANUAL CONTROL FAILED'
            : `MANUAL${tracking && gestureStatus.pose ? ` · ${gestureStatus.pose.toUpperCase()}` : ''}`}
        </button>
      ));
    }
    if (liveSessionCount > 0) chip('live', true, <span className="ok-text">{liveSessionCount} LIVE</span>);
    if (awayReportWaiting) {
      chip('away', true, (
        <button type="button" className="away-chip" onClick={() => useAway.getState().setView('report')} title="What JARVIS did while you were away">
          AWAY REPORT
        </button>
      ));
    }
    if (staleCount > 0) chip('stale', true, <span className="warn">{staleCount} STALE</span>);
    chip('bound', true, status.brokenCount > 0 ? <span className="fault-text">{status.brokenCount} BROKEN</span> : <span className="ok-text">ALL BOUND</span>);
    if (diagOpen || status.fallbackCount > 0) {
      chip('routed', status.fallbackCount > 0, (
        <span className={status.fallbackCount > 0 ? 'warn' : undefined}>
          ROUTED {status.routedCount}{status.fallbackCount > 0 ? ` · ${status.fallbackCount} DIRECT` : ''}
        </span>
      ));
    }
    if (diagOpen || status.atlasFrames === 0) {
      chip('atlas', status.atlasFrames === 0, (
        <span className={status.atlasFrames === 0 ? 'warn' : undefined}>
          ATLAS {status.atlasFrames} · {status.placeholderCount} PLACEHOLDER
        </span>
      ));
    }
  } else {
    chip('init', true, <span>INITIALISING RENDERER…</span>);
  }
  const hiddenChips = layout.hudCompact ? hudChips.filter((c) => !c.primary) : [];
  const renderHud = (measure: boolean): React.JSX.Element => (
    <div
      className={['hud', measure ? 'hud-measure' : '', !measure && layout.hudCompact ? 'compact' : ''].filter(Boolean).join(' ')}
      aria-hidden={measure || undefined}
    >
      {hudChips.map((c) => (
        <span key={c.id} className={c.primary ? 'hud-chip' : 'hud-chip hud-secondary'}>{c.node}</span>
      ))}
      {!measure && hiddenChips.length > 0 ? (
        <button
          type="button"
          className="hud-more"
          aria-expanded={chromePrefs.hudExpanded}
          onClick={() => setChromePref('hudExpanded', !chromePrefs.hudExpanded)}
          title={`${hiddenChips.length} more: the window is too narrow for the whole HUD on one line`}
        >
          +{hiddenChips.length}
        </button>
      ) : null}
      <button type="button" className="hud-tool" onClick={() => setCommandPaletteOpen(true)} title="Find a node, a room or an action (Ctrl+K)" aria-label="Find (Ctrl+K)">
        <Icon name="search" />
      </button>
      <NotificationBell />
      <button type="button" className="hud-tool" onClick={() => setSettingsOpen(true)} title="Settings (Ctrl+,)" aria-label="Settings (Ctrl+,)">
        <Icon name="gear" />
      </button>
    </div>
  );

  return (
    <div
      ref={appRef}
      className={[
        'app',
        editMode ? 'edit-mode' : '',
        // Drives the chrome offsets in styles.css: everything that dodges the inspector
        // reclaims that space the moment nothing is selected.
        // A selected wire's inspector is the same box, so the chrome dodges it too.
        selectedId || selectedEdgeId ? 'inspector-open' : '',
        // The board is being driven by hands. Marked on the root so the canvas can wear a border
        // that says so, the way Edit Board mode does: a mode you are in without having touched
        // anything must be visible without being read.
        gestureStatus.phase === 'watching' || gestureStatus.phase === 'tracking' ? 'manual-control' : '',
        // The MATRIX covers the board; this lifts the row of switches above it so it can be left again.
        matrixOpen ? 'matrix-mode' : ''
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
        selectedEdgeId={selectedEdgeId}
        onSelectEdge={selectEdge}
        onUpdateEdge={(edgeId, patch) => void updateEdge(edgeId, patch)}
        onResizeNode={(nodeId, footprint) => void resizeNode(nodeId, footprint)}
        onConnect={(from, to) => void connectNodes(from, to)}
        onToast={(text, level) => toast(level, text)}
        onCopy={copyNodes}
        onPaste={(tile) => void pasteNodes(tile)}
        onContextMenu={setContextMenu}
        usageRoutes={usageRoutes}
        onStatus={onStatus}
        cameraRef={cameraRef}
        jumpTo={jumpTo}
        lookFilter={lookFilter(lookPreview ?? board.look)}
      />
      <Vignette look={lookPreview ?? board.look} theme={board.theme} uiScale={uiScale} />

      <div className="breadcrumb">
        {/*
          * The room path truncates; the switches after it never do. The layout planner narrows the HUD to
          * whatever room this row leaves (ui/chrome-layout.ts), so a longer row costs HUD chips, not buttons.
          */}
        <span className="crumbs">
          {stack.map((crumb, i) => (
            <span key={crumb.boardId} className={i === stack.length - 1 ? 'crumb here' : 'crumb'}>
              {i > 0 ? <span className="crumb-sep">/</span> : null}
              {crumb.engraving}
            </span>
          ))}
          {editMode ? <span className="mode-badge">EDIT BOARD</span> : null}
        </span>
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
            <Icon name="add" />ADD
          </button>
        ) : null}
        {/*
          * Settings. It was LOOK, and it only ever opened the room's colours; the same panel now
          * carries audio, video, the machine switches and the gesture catalogue, so it is named
          * for what it is and given the size that implies.
          */}
        <button
          type="button"
          className="add-fab settings-fab"
          aria-pressed={lookOpen}
          onClick={() => setLookOpen(!lookOpen)}
          title="Settings: audio, video and gestures, the board's look, system switches (L)"
        >
          <Icon name="gear" /><span className="fab-word">SETTINGS</span>
        </button>
        {/*
          * Manual control, on the board itself rather than buried in a menu: it turns the cameras
          * on, so it should never take more than one obvious press to turn them off again.
          */}
        <button
          type="button"
          className={gestureStatus.phase === 'off' ? 'add-fab manual-fab gesture-fab' : 'add-fab manual-fab gesture-fab live'}
          aria-pressed={gestureStatus.phase !== 'off'}
          onClick={() => void setGestureEnabled(gestureStatus.phase === 'off')}
          title={
            gestureStatus.phase === 'off'
              ? 'Manual control: let the cameras drive the board (also "hey JARVIS, give me manual control")'
              : `Manual control is ON — ${gestureStatus.cameras.map((camera) => `${camera.label}: ${camera.fps} fps`).join(' · ') || 'starting'}. Click to switch the cameras off.`
          }
        >
          <Icon name="hand" /><span className="fab-word">{gestureStatus.phase === 'off' ? 'MANUAL' : gestureStatus.phase === 'unavailable' ? 'MANUAL ?' : 'MANUAL ON'}</span>
        </button>
        {/*
          * THE MATRIX, beside manual control as William asked: the projects' end products on a globe. It is
          * a view, not a mode of the board — nothing on any board changes by opening it.
          */}
        <button
          type="button"
          className={matrixOpen ? 'add-fab manual-fab matrix-fab live' : 'add-fab manual-fab matrix-fab'}
          aria-pressed={matrixOpen}
          onClick={() => setMatrixOpen(!matrixOpen)}
          title={matrixOpen ? 'Leave the MATRIX and return to the board (G or Esc)' : 'The MATRIX: every document, artifact and link on every board, on a globe (G)'}
        >
          <Icon name="globe" /><span className="fab-word">MATRIX</span>
        </button>
        {/*
          * Voice, beside manual control and for the same reason: it opens a microphone, so turning it off
          * must never take more than one press. Off is the hard mute — the wake phrase, the speech engine
          * and the microphone window all stop (docs/07-SECURITY.md, Voice).
          */}
        <button
          type="button"
          className={voiceStatus.phase === 'off' ? 'add-fab manual-fab voice-fab' : 'add-fab manual-fab voice-fab live'}
          aria-pressed={voiceStatus.phase !== 'off'}
          onClick={() => void setVoiceEnabled(voiceStatus.phase === 'off')}
          title={
            voiceStatus.phase === 'off'
              ? 'Voice: listen for "Hey JARVIS". Nothing is transcribed before it, and no audio leaves this machine.'
              : voiceStatus.phase === 'unavailable'
                ? `Voice cannot start — ${voiceStatus.error ?? 'see Settings, Audio'}. Click to switch it off.`
                : `Voice is ON (${voiceStatus.model ?? 'whisper'}). Click to switch it off: the microphone closes.`
          }
        >
          <Icon name="mic" />
          <span className="fab-word">{voiceStatus.phase === 'off'
            ? 'VOICE'
            : voiceStatus.phase === 'unavailable'
              ? 'VOICE ?'
              : voiceStatus.phase === 'starting'
                ? 'VOICE …'
                : voiceStatus.phase === 'listening'
                  ? 'LISTENING'
                  : voiceStatus.phase === 'thinking'
                    ? 'THINKING'
                    : 'VOICE ON'}</span>
        </button>
      </div>

      {/* Top-left, under the breadcrumb: what this is costing, measured off disk. */}
      <UsageMeter />

      <AddPalette />
      <Mailbox />
      <SystemMonitor />
      <Explorer />

      {renderHud(false)}
      {renderHud(true)}
      {hiddenChips.length > 0 && chromePrefs.hudExpanded ? (
        <div className="hud-more-panel" role="group" aria-label="The rest of the HUD">
          {hiddenChips.map((c) => <span key={c.id}>{c.node}</span>)}
        </div>
      ) : null}

      <Minimap board={board} targets={targets} cameraRef={cameraRef} onJump={requestJump} />

      <DragBadges board={board} artifacts={artifacts} cameraRef={cameraRef} />
      <PromptBoxes board={board} cameraRef={cameraRef} />
      <Phantoms board={board} cameraRef={cameraRef} />
      {/* Bottom left: running sessions, then the corner prompt to the Face. One column, never overlapping. */}
      <div className="left-stack">
        <SessionDock />
        <JarvisDock />
      </div>
      <IngestWizard />
      <Inspector />
      <EdgeInspector />
      {lookOpen ? <BoardLook onClose={() => setLookOpen(false)} /> : null}
      <ContextMenu />
      <SummonDialog />
      <AwayScreen />
      <Iris />
      {matrixOpen ? <MatrixView onClose={() => setMatrixOpen(false)} /> : null}

      {/*
        * One short line of the keys that matter right now, and ? for the rest. The line had grown to
        * three screens' worth of shortcuts, which is a manual, not a hint.
        */}
      {/* Hidden by its own X (Settings brings it back), or by the layout manager when the bottom edge has no room. */}
      {layout.helpHidden || chromePrefs.helpHidden ? null : (
        <div className="help">
          <span className="help-text">
            {editMode
              ? 'EDIT BOARD · DRAG TO MOVE · SHIFT+DRAG TO SELECT · CLICK EDGES TO WIRE · E DONE'
              : 'DRAG TO PAN · WHEEL TO ZOOM · 0 WHOLE BOARD · E EDIT BOARD'}
            {stack.length > 1 ? ' · BACKSPACE UP A ROOM' : ''}
            {focus ? ' · FOCUS ON' : ''}
            {history.canUndo ? ` · CTRL+Z UNDO ${history.undoLabel?.toUpperCase() ?? ''}` : ''}
            {' · G MATRIX · CTRL+K FIND · ? ALL KEYS'}
          </span>
          <button
            type="button"
            className="help-x"
            onClick={() => setChromePref('helpHidden', true)}
            title="Hide this line. Settings (Ctrl+,) brings it back."
            aria-label="Hide the help line"
          >
            <Icon name="close" />
          </button>
        </div>
      )}

      {keysOpen ? (
        <div className="keys-backdrop">
          <div className="keys-panel" role="dialog" aria-label="Keys">
            <div className="keys-head">
              <span className="with-icon"><Icon name="keys" />KEYS</span>
              <button type="button" className="btn tiny" onClick={() => setKeysOpen(false)}>Close (?)</button>
            </div>
            {KEY_GROUPS.map((group) => (
              <div className="keys-group" key={group.title}>
                <div className="section-head">{group.title}</div>
                {group.keys.map(([key, what]) => (
                  <div className="keys-row" key={key}>
                    <span className="keys-key">{key}</span>
                    <span className="keys-what">{what}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Above whatever holds the bottom-right corner (--toasts-bottom), and kept in the notification list after they fade. */}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.level}`}>
            <Icon name={t.level} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
      <NotificationCentre />
      <CommandPalette />
      <SettingsPanel />
      <AboutBox />
      <FirstRunHints />
    </div>
  );
}
