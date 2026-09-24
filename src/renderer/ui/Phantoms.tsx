import { useEffect, useRef, useState } from 'react';
import type { Board, Phantom } from '@shared/types.js';
import { footprintOf } from '@shared/types.js';
import { phantomFootprint } from '@shared/phantoms.js';
import { useBoardStore } from '../store/useBoardStore.js';
import { plateOrder, pushBelow, type PlateBox } from './stack-plates.js';

/**
 * Recommended nodes, drawn over the board: a dashed ghost where the component would go, a plate
 * saying what it is and why, the traces it would get, and a tick and a cross.
 *
 * William: "these will appear as phantom objects with a title / description of what you think the
 * recommended node for there would be, then a check or x I can select to approve or delete a
 * phantom."
 *
 * A DOM overlay rather than canvas sprites, like PromptBoxes and DragBadges: the tick and the cross
 * are real buttons with a real focus ring and a keyboard path, and nothing about a phantom belongs
 * in the texture cache — it is a suggestion, not a component. The overlay tracks the camera in its
 * own rAF loop (a camera that moves at frame rate is never pushed through React state), and only
 * runs that loop while there is something to draw.
 *
 * Pixel rules still hold. Every coordinate is rounded to a whole device pixel after scaling, the
 * dashes and strokes are whole multiples of one world pixel, and the SVG renders crispEdges: a
 * phantom is dashed, never blurred.
 */

export interface PhantomsProps {
  board: Board;
  cameraRef: React.RefObject<{ x: number; y: number; zoom: number; viewW: number; viewH: number }>;
}

/** Below this zoom a plate shows its name and buttons only; the reason would be unreadable noise. */
const COMPACT_BELOW = 1;

/**
 * The route a proposed trace would take, in world pixels: out of the phantom's centre, one elbow,
 * into the target's centre. Orthogonal like every real trace; the router takes over on approval.
 */
function linkPoints(board: Board, phantom: Phantom, targetId: string): string | null {
  const target = board.nodes.find((n) => n.id === targetId);
  if (!target) return null;
  const tile = board.grid.tile;
  const fp = phantomFootprint(phantom);
  const tf = footprintOf(target);
  const ax = (phantom.pos.x + fp.w / 2) * tile;
  const ay = (phantom.pos.y + fp.h / 2) * tile;
  const bx = (target.pos.x + tf.w / 2) * tile;
  const by = (target.pos.y + tf.h / 2) * tile;
  return `${ax},${ay} ${bx},${ay} ${bx},${by}`;
}

/** What it would bind to, for the plate's second line. */
function bindingOf(phantom: Phantom): string | null {
  const f = phantom.fields ?? {};
  const value = f.path ?? f.url ?? f.cwd ?? f.glob ?? f.boardFile ?? null;
  return typeof value === 'string' && value.trim() ? value : null;
}

/*
 * The tick and the cross as 7x7 bitmaps, drawn as whole-pixel rects, so they are crisp whatever
 * font is loaded. A glyph that fell through to a fallback font would be the one antialiased shape
 * on the board.
 */
const TICK = ['.......', '......#', '.....##', '#...##.', '##.##..', '.###...', '..#....'];
const CROSS = ['#.....#', '##...##', '.##.##.', '..###..', '.##.##.', '##...##', '#.....#'];

function PixelGlyph({ rows }: { rows: string[] }): React.JSX.Element {
  return (
    <svg className="phantom-glyph" viewBox="0 0 7 7" shapeRendering="crispEdges" aria-hidden="true">
      {rows.flatMap((row, y) =>
        [...row].map((c, x) => (c === '#' ? <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} /> : null)))}
    </svg>
  );
}

export function Phantoms({ board, cameraRef }: PhantomsProps): React.JSX.Element | null {
  const hidden = useBoardStore((s) => s.hidePhantoms);
  const closed = useBoardStore((s) => s.closedPhantoms);
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const phantoms = (board.phantoms ?? []).filter((p) => !closed.includes(p.id));
  const visible = !hidden && phantoms.length > 0;

  useEffect(() => {
    if (!visible) return;
    const host = hostRef.current;
    const svg = svgRef.current;
    if (!host || !svg) return;
    let raf = 0;
    const place = () => {
      const cam = cameraRef.current;
      if (cam) {
        const z = cam.zoom;
        // One world pixel, in whole device pixels: the stroke and the dash unit.
        const unit = Math.max(1, Math.round(z));
        const sx = (x: number) => Math.round((x - cam.x) * z);
        const sy = (y: number) => Math.round((y - cam.y) * z);
        svg.setAttribute('width', String(cam.viewW));
        svg.setAttribute('height', String(cam.viewH));

        for (const el of Array.from(svg.querySelectorAll<SVGRectElement>('rect.phantom-ghost'))) {
          const x = sx(Number(el.dataset['x']));
          const y = sy(Number(el.dataset['y']));
          const w = Math.max(unit, Math.round(Number(el.dataset['w']) * z));
          const h = Math.max(unit, Math.round(Number(el.dataset['h']) * z));
          // Inset by half a stroke so the dashes land inside the footprint, on whole pixels.
          el.setAttribute('x', String(x + unit / 2));
          el.setAttribute('y', String(y + unit / 2));
          el.setAttribute('width', String(Math.max(0, w - unit)));
          el.setAttribute('height', String(Math.max(0, h - unit)));
          el.setAttribute('stroke-width', String(unit));
          el.setAttribute('stroke-dasharray', `${2 * unit} ${2 * unit}`);
        }
        for (const el of Array.from(svg.querySelectorAll<SVGPolylineElement>('polyline.phantom-link'))) {
          const pts = (el.dataset['pts'] ?? '').split(' ').map((pair) => {
            const [x, y] = pair.split(',').map(Number);
            return `${sx(x ?? 0) + unit / 2},${sy(y ?? 0) + unit / 2}`;
          });
          el.setAttribute('points', pts.join(' '));
          el.setAttribute('stroke-width', String(unit));
          el.setAttribute('stroke-dasharray', `${unit} ${2 * unit}`);
        }
        /*
         * Plates never sit on one another. Seen in a screenshot: at overview zoom the ghosts shrink
         * but a plate keeps its minimum width, so two neighbouring plates overlapped and the upper
         * one covered the lower one's tick and cross, taking their clicks. Each plate, top to
         * bottom, is pushed below any plate already placed that it would cover (`pushBelow`, shared
         * with the drag badges). Four plates at most, so this is a handful of comparisons a frame.
         */
        const plates = Array.from(host.querySelectorAll<HTMLElement>('.phantom-plate'))
          .sort((a, b) => plateOrder(
            { x: Number(a.dataset['x']), y: Number(a.dataset['y']) },
            { x: Number(b.dataset['x']), y: Number(b.dataset['y']) }
          ));
        const placed: PlateBox[] = [];
        for (const el of plates) {
          const x = sx(Number(el.dataset['x']));
          const w = Math.round(Number(el.dataset['w']) * z);
          el.style.width = `${w}px`;
          el.classList.toggle('compact', z < COMPACT_BELOW);
          const box: PlateBox = { x, y: sy(Number(el.dataset['y'])), w: el.offsetWidth, h: el.offsetHeight };
          const y = pushBelow(box, placed, unit);
          placed.push({ ...box, y });
          const onScreen = x + Math.max(box.w, 1) > 0 && y + 1 > 0 && x < cam.viewW && y < cam.viewH;
          el.style.transform = `translate(${x}px, ${y}px)`;
          el.style.visibility = onScreen ? 'visible' : 'hidden';
        }
      }
      raf = requestAnimationFrame(place);
    };
    raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [cameraRef, visible, phantoms.length]);

  if (!visible) return null;

  // The wheel keeps zooming the board over a plate, as it does over a prompt box.
  const forwardWheel = (event: React.WheelEvent): void => {
    const target = document.querySelector('.board-host');
    if (!target) return;
    event.preventDefault();
    target.dispatchEvent(new WheelEvent('wheel', {
      deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode,
      clientX: event.clientX, clientY: event.clientY, ctrlKey: event.ctrlKey,
      bubbles: true, cancelable: true
    }));
  };

  const tile = board.grid.tile;
  return (
    <div className="phantoms" ref={hostRef} onWheel={forwardWheel}>
      <svg className="phantom-wires" ref={svgRef} shapeRendering="crispEdges" aria-hidden="true">
        {phantoms.map((p) => {
          const fp = phantomFootprint(p);
          return (
            <g key={p.id}>
              {(p.connect ?? []).map((link) => {
                const pts = linkPoints(board, p, link.to);
                return pts ? <polyline key={link.to} className="phantom-link" data-pts={pts} /> : null;
              })}
              <rect
                className="phantom-ghost"
                data-x={p.pos.x * tile}
                data-y={p.pos.y * tile}
                data-w={Math.max(1, fp.w) * tile}
                data-h={Math.max(1, fp.h) * tile}
              />
            </g>
          );
        })}
      </svg>
      {phantoms.map((p) => <PhantomPlate key={p.id} board={board} phantom={p} />)}
    </div>
  );
}

function PhantomPlate({ board, phantom }: { board: Board; phantom: Phantom }): React.JSX.Element {
  const approve = useBoardStore((s) => s.approvePhantom);
  const dismiss = useBoardStore((s) => s.dismissPhantom);
  const [busy, setBusy] = useState(false);
  const tile = board.grid.tile;
  const fp = phantomFootprint(phantom);
  const binding = bindingOf(phantom);
  const links = (phantom.connect ?? [])
    .map((l) => board.nodes.find((n) => n.id === l.to))
    .filter((n): n is NonNullable<typeof n> => Boolean(n))
    .map((n) => n.designator ?? n.name);

  const act = async (what: 'approve' | 'dismiss'): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await (what === 'approve' ? approve(phantom.id) : dismiss(phantom.id));
    } catch (err) {
      // Never silent: a button that does nothing and says nothing is the bug being fixed here.
      useBoardStore.getState().toast('fault', `${what.toUpperCase()} FAILED — ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  /*
   * The keyboard path: Tab to a plate, Enter approves, Delete dismisses. Stopped here so Enter does
   * not also activate the selected node and Backspace does not also climb out of the room.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void act('approve'); return; }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault(); event.stopPropagation(); void act('dismiss'); return;
    }
    if (event.key === 'Escape') { event.stopPropagation(); event.currentTarget.blur(); }
  };

  return (
    <div
      className={busy ? 'phantom-plate busy' : 'phantom-plate'}
      data-x={phantom.pos.x * tile}
      data-y={phantom.pos.y * tile}
      data-w={Math.max(1, fp.w) * tile}
      tabIndex={0}
      role="group"
      aria-label={`Recommended ${phantom.kind}: ${phantom.name}. Enter approves, Delete dismisses.`}
      onKeyDown={onKeyDown}
    >
      <div className="phantom-head">
        <span className="phantom-tag">REC</span>
        <span className="phantom-name" title={phantom.name}>{phantom.name}</span>
        <button
          type="button"
          className="phantom-btn yes"
          disabled={busy}
          title="Approve: make it a real node, wired as shown (Enter). Ctrl+Z takes it back."
          aria-label={`Approve ${phantom.name}`}
          onClick={() => void act('approve')}
        >
          <PixelGlyph rows={TICK} />
        </button>
        <button
          type="button"
          className="phantom-btn no"
          disabled={busy}
          title="Dismiss this recommendation (Delete). Nothing real is touched."
          aria-label={`Dismiss ${phantom.name}`}
          onClick={() => void act('dismiss')}
        >
          <PixelGlyph rows={CROSS} />
        </button>
      </div>
      <div className="phantom-desc">{phantom.description}</div>
      <div className="phantom-meta" title={binding ?? undefined}>
        {phantom.kind.toUpperCase()}
        {binding ? ` · ${binding}` : ''}
        {links.length ? ` · → ${links.join(', ')}` : ''}
        {` · BY ${phantom.proposedBy.toUpperCase()}`}
      </div>
    </div>
  );
}
