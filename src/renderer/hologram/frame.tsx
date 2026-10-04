import { useEffect, useRef, useState } from 'react';
import { holoNavLayout, holoScaleFor, stageSquare, type HoloNavLayout } from '@shared/hologram.js';
import { Icon, type IconName } from '../ui/Icon.js';

/**
 * The JARVIS Voice window's frame, since it became resizable (2026-09-27, docs/11 § The window).
 *
 *   - `useHoloFrame`: the chrome's integer scale from the window's shorter side (`--holo-scale`),
 *     the nav's layout (one row, two rows of four, icons), and the globe's square in the stage,
 *     re-measured on every resize by a ResizeObserver.
 *   - `SizeGrip`: an 8x8 pixel grip in the bottom-right corner. Windows' own resize borders do the
 *     job on this frameless window (thickFrame); the grip is the visible handle, and it resizes by
 *     pointer drag through `hologram:setSize` too, so it works wherever the borders are not found.
 *     It only sizes the window: main's `resize` handler is the one writer of `hologram.size`.
 *
 * CSS pixels in this window are device pixels (main cancels the OS scale), so every number here is
 * a whole device pixel.
 */

export interface HoloFrame {
  scale: 1 | 2 | 3;
  nav: HoloNavLayout;
  /** The globe canvas's square inside the stage, whole CSS pixels. */
  square: { side: number; left: number; top: number };
}

function measureWindow(): Pick<HoloFrame, 'scale' | 'nav'> {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const scale = holoScaleFor(w, h);
  return { scale, nav: holoNavLayout(w, scale) };
}

export function useHoloFrame(stageRef: React.RefObject<HTMLElement>): HoloFrame {
  const [win, setWin] = useState(measureWindow);
  const [square, setSquare] = useState({ side: 0, left: 0, top: 0 });

  useEffect(() => {
    const onResize = (): void => {
      const next = measureWindow();
      setWin((prev) => (prev.scale === next.scale && prev.nav.rows === next.nav.rows && prev.nav.icons === next.nav.icons ? prev : next));
    };
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect;
      if (!rect) return;
      const next = stageSquare(rect.width, rect.height);
      setSquare((prev) => (prev.side === next.side && prev.left === next.left && prev.top === next.top ? prev : next));
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stageRef]);

  return { ...win, square };
}

/**
 * A nav button's face: its word, or below 400 chrome pixels of width its icon, with the word kept
 * for the accessible name (the button's `title` is the tooltip).
 */
export function NavLabel({ icon, text, icons }: { icon: IconName; text: string; icons: boolean }): React.JSX.Element {
  if (!icons) return <>{text}</>;
  return <><Icon name={icon} /><span className="holo-sr">{text}</span></>;
}

/** The grip's pixels: three stepped diagonals toward the corner, 8x8. */
const GRIP_PIXELS: { x: number; y: number }[] = [];
for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (x + y >= 7 && (x + y - 7) % 3 === 0) GRIP_PIXELS.push({ x, y });

interface Drag {
  pointer: number;
  /** Window size in CSS px minus the pointer, so the corner stays under the hand. */
  offX: number;
  offY: number;
  /** CSS px per DIP, from `hologram:status`; 0 until it answers. */
  ratioX: number;
  ratioY: number;
}

export function SizeGrip(): React.JSX.Element | null {
  const drag = useRef<Drag | null>(null);
  const want = useRef<{ w: number; h: number } | null>(null);
  const inFlight = useRef(false);
  const api = window.skynet as unknown as Record<string, ((...args: unknown[]) => Promise<unknown>) | undefined>;
  const setSize = api['hologram:setSize'];
  const status = api['hologram:status'];

  // One request in flight; the latest size wins.
  const pump = (): void => {
    if (inFlight.current || !want.current || !setSize) return;
    const next = want.current;
    want.current = null;
    inFlight.current = true;
    void setSize(next).catch(() => undefined).finally(() => { inFlight.current = false; pump(); });
  };

  if (!setSize || !status) return null;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const d: Drag = { pointer: e.pointerId, offX: window.innerWidth - e.clientX, offY: window.innerHeight - e.clientY, ratioX: 0, ratioY: 0 };
    drag.current = d;
    void status().then((s) => {
      const size = (s as { size?: { w: number; h: number } }).size;
      if (drag.current !== d || !size || size.w <= 0 || size.h <= 0) return;
      d.ratioX = window.innerWidth / size.w;
      d.ratioY = window.innerHeight / size.h;
    }).catch(() => undefined);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId || !d.ratioX || !d.ratioY) return;
    want.current = { w: Math.round((e.clientX + d.offX) / d.ratioX), h: Math.round((e.clientY + d.offY) / d.ratioY) };
    pump();
  };
  const end = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointer !== e.pointerId) return;
    drag.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };

  return (
    <div
      className="holo-grip"
      aria-hidden="true"
      title="Drag to resize. Ctrl+= and Ctrl+- step it by 80, Ctrl+0 returns to 480."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <svg viewBox="0 0 8 8" shapeRendering="crispEdges" fill="currentColor">
        {GRIP_PIXELS.map((p) => <rect key={`${p.x},${p.y}`} x={p.x} y={p.y} width={1} height={1} />)}
      </svg>
    </div>
  );
}
