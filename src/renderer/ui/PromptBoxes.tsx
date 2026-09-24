import { useEffect, useRef, useState } from 'react';
import type { Board, BoardNode } from '@shared/types.js';
import { footprintOf } from '@shared/types.js';
import {
  PROMPT_TO_NODE_KIND,
  extensionOf,
  isPromptBoxKind,
  promptLayout,
  promptModeOf,
  promptTabFor,
  resolvePromptTarget,
  type PromptFileInfo,
  type PromptRect
} from '@shared/prompt.js';
import { useBoardStore } from '../store/useBoardStore.js';

/**
 * The prompt nodes' live half: a real textarea and two real buttons laid over each pixel-art
 * message box on the board.
 *
 * William: "a typical empty prompt box that allows for file (image and other file types) upload …
 * I still want to use the ui font when writing my prompt and the prompt box should be pixel art /
 * mosaic rastered to look like a pixel art claude prompt interface embedded in the board."
 *
 * So there are two layers, and they must agree to the pixel:
 *
 *   - The CANVAS draws the box (component-art.ts, `drawPromptBox`): the stepped-corner frame, the
 *     caret, the dim placeholder, the paperclip and the send button, all from the locked palette.
 *   - This DOM overlay puts the real controls over exactly those pixels, in the chrome's own
 *     Departure Mono. Both take their geometry from `promptLayout`, positioned here as percentages
 *     of the node, so they stay aligned at every zoom without being re-laid out.
 *
 * The overlay tracks the camera in its own rAF loop, as DragBadges does. Pushing a camera that
 * moves at frame rate through React state would re-render every box 165 times a second.
 *
 * It steps aside when it would get in the way: below 1x the box is too small to type into and the
 * sprite alone stands in for it, and in Edit Board mode it stops taking the pointer, so the node
 * underneath can be dragged, resized and wired like any other.
 */

export interface PromptBoxesProps {
  board: Board;
  cameraRef: React.RefObject<{ x: number; y: number; zoom: number; viewW: number; viewH: number }>;
}

/** Below this zoom the box is too small to type into, and the pixel drawing stands in for it. */
const MIN_ZOOM = 1;

export function PromptBoxes({ board, cameraRef }: PromptBoxesProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  // Both message-box kinds: the quick chat, and PROMPT → NODE, which briefs JARVIS Prime instead.
  const nodes = board.nodes.filter((n) => isPromptBoxKind(n.kind));

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let raf = 0;
    const place = () => {
      const cam = cameraRef.current;
      if (cam) {
        for (const el of Array.from(host.children) as HTMLElement[]) {
          const x = Number(el.dataset['x']);
          const y = Number(el.dataset['y']);
          const w = Number(el.dataset['w']);
          const h = Number(el.dataset['h']);
          // Whole device pixels, same rule as the board: round after scaling, never before.
          const sx = Math.round((x - cam.x) * cam.zoom);
          const sy = Math.round((y - cam.y) * cam.zoom);
          const sw = Math.round(w * cam.zoom);
          const sh = Math.round(h * cam.zoom);
          const onScreen = sx + sw > 0 && sy + sh > 0 && sx < cam.viewW && sy < cam.viewH;
          el.style.transform = `translate(${sx}px, ${sy}px)`;
          el.style.width = `${sw}px`;
          el.style.height = `${sh}px`;
          el.style.visibility = cam.zoom >= MIN_ZOOM && onScreen ? 'visible' : 'hidden';
        }
      }
      raf = requestAnimationFrame(place);
    };
    raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [cameraRef, nodes.length]);

  /*
   * The wheel still zooms the board over a prompt box. The overlay sits outside the canvas's host,
   * so without this the wheel stopped dead over the box, a dead patch in the middle of the map.
   * The event is re-dispatched to the board host, which anchors the zoom on the cursor as usual.
   */
  const forwardWheel = (event: React.WheelEvent): void => {
    const board = document.querySelector('.board-host');
    if (!board) return;
    event.preventDefault();
    board.dispatchEvent(new WheelEvent('wheel', {
      deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode,
      clientX: event.clientX, clientY: event.clientY, ctrlKey: event.ctrlKey,
      bubbles: true, cancelable: true
    }));
  };

  return (
    <div className="prompt-boxes" ref={hostRef} onWheel={forwardWheel}>
      {nodes.map((node) => <PromptBox key={node.id} node={node} board={board} />)}
    </div>
  );
}

function PromptBox({ node, board }: { node: BoardNode; board: Board }): React.JSX.Element {
  const boardId = useBoardStore((s) => s.boardId);
  const editMode = useBoardStore((s) => s.mode === 'edit');
  const selected = useBoardStore((s) => s.selectedId === node.id);
  const toast = useBoardStore((s) => s.toast);

  const [text, setText] = useState('');
  const [files, setFiles] = useState<PromptFileInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const tile = board.grid.tile;
  const fp = footprintOf(node);
  const width = fp.w * tile;
  const height = fp.h * tile;
  // The same layout the canvas draws with, tab included, so the controls land on its pixels.
  const layout = promptLayout(width, height, { tab: promptTabFor(node.kind) });
  const at = (r: PromptRect): React.CSSProperties => ({
    left: `${(r.x / width) * 100}%`,
    top: `${(r.y / height) * 100}%`,
    width: `${(r.w / width) * 100}%`,
    height: `${(r.h / height) * 100}%`
  });

  /*
   * PROMPT → NODE does not talk to a conversation at all: its send briefs a fresh JARVIS Prime
   * terminal to build the node described (prompt:build). It always "sends"; there is no draft.
   */
  const builds = node.kind === PROMPT_TO_NODE_KIND;
  const target = builds ? null : resolvePromptTarget(board, node);
  const targetName = builds ? 'JARVIS PRIME' : target?.name ?? 'JARVIS';
  const mode = builds ? 'send' : promptModeOf(node);

  /*
   * The keyboard path. Tab walks the board's nodes; landing on this one puts the cursor in the box,
   * so Tab, type, Enter works without a mouse. Browse mode only: in Edit Board mode, selecting a
   * node means arranging it.
   */
  useEffect(() => {
    if (selected && !editMode) inputRef.current?.focus();
  }, [selected, editMode]);

  const addPaths = async (paths: string[]): Promise<void> => {
    const fresh = paths.filter((p) => p && !files.some((f) => f.path === p));
    if (!fresh.length) return;
    const described = await window.skynet['prompt:describeFiles'](fresh);
    setFiles((current) => [...current, ...described.filter((d) => !current.some((c) => c.path === d.path))]);
  };

  const pick = async (): Promise<void> => {
    const { paths } = await window.skynet['prompt:pickFiles']();
    if (paths.length) await addPaths(paths);
    inputRef.current?.focus();
  };

  const send = async (): Promise<void> => {
    if (busy || (!text.trim() && !files.length)) return;
    const bad = files.find((f) => f.error);
    if (bad) { toast('warn', `${bad.name}: ${bad.error} — remove it to send`); return; }
    setBusy(true);
    try {
      const request = { boardId, nodeId: node.id, text, files: files.map((f) => f.path) };
      const result = builds
        ? await window.skynet['prompt:build'](request)
        : await window.skynet['prompt:send'](request);
      toast(result.stage === 'failed' ? 'fault' : result.ok ? 'ok' : 'warn', result.message);
      // Cleared only once it is IN the conversation, sent or drafted there. A failure keeps
      // everything, so nothing typed is ever lost to a page that did not load.
      if (result.stage !== 'failed') { setText(''); setFiles([]); }
    } catch (err) {
      toast('fault', `NOT SENT — ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // The textarea's own undo, not the board's: App binds Ctrl+Z to the command bus on `window`.
    if (event.ctrlKey && (event.code === 'KeyZ' || event.code === 'KeyY')) { event.stopPropagation(); return; }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.blur();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  /*
   * Files dropped on the box are attachments, not new nodes. Stopping the event here is what keeps
   * App's drop-in ingestion from also offering to put the file on the board.
   */
  const onDragOver = (event: React.DragEvent): void => {
    if (editMode || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (event: React.DragEvent): void => {
    if (editMode || !event.dataTransfer.files.length) return;
    event.preventDefault();
    event.stopPropagation();
    void addPaths(window.skynet.pathsForFiles(Array.from(event.dataTransfer.files)));
  };

  const sendTitle = builds
    ? 'Brief JARVIS Prime to build this node on the board (Enter). Shift+Enter for a new line.'
    : mode === 'send'
      ? `Send to ${targetName} (Enter). Shift+Enter for a new line.`
      : `Put it in ${targetName}'s message box (Enter), without sending.`;

  return (
    <div
      className={['prompt-box', editMode ? 'editing' : '', busy ? 'busy' : ''].filter(Boolean).join(' ')}
      data-x={node.pos.x * tile}
      data-y={node.pos.y * tile}
      data-w={width}
      data-h={height}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {files.length ? (
        <div className="prompt-chips">
          {files.map((f) => (
            <span key={f.path} className={f.error ? 'prompt-chip bad' : 'prompt-chip'} title={f.error ? `${f.path}\n${f.error}` : f.path}>
              {f.thumbnail
                ? <img className="prompt-thumb" src={f.thumbnail} alt="" />
                : <span className="prompt-ext">{extensionOf(f.name).toUpperCase() || 'FILE'}</span>}
              <span className="prompt-chip-name">{f.name}</span>
              <button
                type="button"
                className="prompt-chip-x"
                aria-label={`Remove ${f.name}`}
                disabled={busy}
                onClick={() => setFiles((current) => current.filter((x) => x.path !== f.path))}
              >
                x
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <textarea
        ref={inputRef}
        className="prompt-input"
        style={at(layout.text)}
        value={text}
        // A single space: enough for :placeholder-shown to work, so an empty, unfocused box shows the
        // sprite's own pixel placeholder through a transparent background.
        placeholder=" "
        spellCheck
        disabled={busy || editMode}
        aria-label={builds ? 'Describe the node for JARVIS Prime to build' : `Message ${targetName}`}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className="prompt-hit"
        style={at(layout.clip)}
        title="Attach files or images. You can also drop them on the box."
        aria-label="Attach files"
        disabled={busy || editMode}
        onClick={() => void pick()}
      />
      <button
        type="button"
        className="prompt-hit"
        style={at(layout.send)}
        title={sendTitle}
        aria-label={builds ? 'Build node' : mode === 'send' ? 'Send' : 'Put in message box'}
        disabled={busy || editMode}
        onClick={() => void send()}
      />

      {busy ? <span className="prompt-status">{builds ? 'BRIEFING JARVIS PRIME…' : mode === 'send' ? 'SENDING…' : 'TYPING IT IN…'}</span> : null}
      {!builds && !target ? <span className="prompt-status fault">NO CONVERSATION TO SEND TO</span> : null}
    </div>
  );
}
