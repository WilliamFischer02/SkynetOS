/**
 * Touch on the board: for the remote iPhone and iPad, and any touchscreen PC. docs/08-REMOTE.md.
 *
 * One finger already works through the ordinary pointer path (a drag pans, a tap selects). This
 * adds what a mouse has other buttons for:
 *
 *   - two fingers: pinch to step through the board's EXACT zoom levels (never a fraction, docs/02),
 *     anchored between the fingers, and drag together to pan;
 *   - a long press (550 ms without moving) opens the right-click menu;
 *   - a double tap activates, like a double click.
 *
 * It listens in the CAPTURE phase and steps in only for `pointerType === 'touch'`, stopping the
 * event only while a gesture it owns is under way, so BoardCanvas's own mouse handling is
 * untouched. The rules are pure functions below, and test/touch.test.ts holds them.
 */

export const PINCH_IN = 1.25;
export const PINCH_OUT = 0.8;
export const LONG_PRESS_MS = 550;
export const TAP_MAX_MS = 300;
export const TAP_SLOP_PX = 10;
export const DOUBLE_TAP_MS = 320;
export const DOUBLE_TAP_PX = 28;

/** One zoom step in (+1), out (-1), or none, for how far the fingers have spread since the last step. */
export function pinchStep(ratio: number): 1 | -1 | 0 {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  if (ratio >= PINCH_IN) return 1;
  if (ratio <= PINCH_OUT) return -1;
  return 0;
}

export interface Tap { x: number; y: number; t: number }

/** A touch that went down and up quickly without travelling. */
export function isTap(down: Tap, up: Tap): boolean {
  return up.t - down.t <= TAP_MAX_MS && Math.hypot(up.x - down.x, up.y - down.y) <= TAP_SLOP_PX;
}

/** A second tap close enough in time and place to the first. */
export function isDoubleTap(first: Tap | null, second: Tap): boolean {
  return first !== null && second.t - first.t <= DOUBLE_TAP_MS && Math.hypot(second.x - first.x, second.y - first.y) <= DOUBLE_TAP_PX;
}

export interface TouchCallbacks {
  /** Step the zoom one exact level, keeping `anchor` (canvas px) over the same board point. */
  zoomStep: (direction: 1 | -1, anchor: { x: number; y: number }) => void;
  /** Move the view by a screen distance (canvas px). */
  panBy: (dx: number, dy: number) => void;
  /** Abandon whatever single-finger drag the board started for this pointer. */
  cancelDrag: (pointerId: number) => void;
  longPress: (clientX: number, clientY: number) => void;
  doubleTap: (clientX: number, clientY: number) => void;
  toCanvas: (clientX: number, clientY: number) => { x: number; y: number };
}

interface Point { x: number; y: number; start: Tap }

export class TouchGestures {
  private readonly points = new Map<number, Point>();
  private pinch: { dist: number; mid: { x: number; y: number } } | null = null;
  private longTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressed = false;
  private lastTap: Tap | null = null;
  private suppressDblclickUntil = 0;

  constructor(private readonly el: HTMLElement, private readonly cb: TouchCallbacks) {
    el.addEventListener('pointerdown', this.onDown, true);
    window.addEventListener('pointermove', this.onMove, true);
    window.addEventListener('pointerup', this.onUp, true);
    window.addEventListener('pointercancel', this.onUp, true);
    el.addEventListener('dblclick', this.onDblclick, true);
  }

  dispose(): void {
    this.clearLong();
    this.el.removeEventListener('pointerdown', this.onDown, true);
    window.removeEventListener('pointermove', this.onMove, true);
    window.removeEventListener('pointerup', this.onUp, true);
    window.removeEventListener('pointercancel', this.onUp, true);
    this.el.removeEventListener('dblclick', this.onDblclick, true);
  }

  private clearLong(): void {
    if (this.longTimer) { clearTimeout(this.longTimer); this.longTimer = null; }
  }

  private two(): [Point, Point] | null {
    const [a, b] = [...this.points.values()];
    return a && b ? [a, b] : null;
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    const now = performance.now();
    this.points.set(e.pointerId, { x: e.clientX, y: e.clientY, start: { x: e.clientX, y: e.clientY, t: now } });

    if (this.points.size === 1) {
      this.longPressed = false;
      this.clearLong();
      const id = e.pointerId;
      this.longTimer = setTimeout(() => {
        const p = this.points.get(id);
        if (!p || this.points.size !== 1) return;
        this.longPressed = true;
        this.cb.cancelDrag(id);
        this.cb.longPress(p.x, p.y);
      }, LONG_PRESS_MS);
      return;
    }

    // A second finger turns whatever the first one started into a pinch.
    this.clearLong();
    e.stopImmediatePropagation();
    e.preventDefault();
    const pair = this.two();
    if (this.points.size === 2 && pair) {
      const [a, b] = pair;
      for (const id of this.points.keys()) if (id !== e.pointerId) this.cb.cancelDrag(id);
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    const p = this.points.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (Math.hypot(p.x - p.start.x, p.y - p.start.y) > TAP_SLOP_PX) this.clearLong();

    const pair = this.pinch ? this.two() : null;
    if (!this.pinch || !pair) return;
    e.stopImmediatePropagation();
    const [a, b] = pair;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const step = pinchStep(dist / Math.max(1, this.pinch.dist));
    if (step !== 0) {
      this.cb.zoomStep(step, this.cb.toCanvas(mid.x, mid.y));
      this.pinch.dist = dist;
    }
    const dx = mid.x - this.pinch.mid.x;
    const dy = mid.y - this.pinch.mid.y;
    if (dx || dy) this.cb.panBy(dx, dy);
    this.pinch.mid = mid;
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    const p = this.points.get(e.pointerId);
    this.points.delete(e.pointerId);
    this.clearLong();

    if (this.pinch) {
      // The fingers of a pinch never count as taps, and the board must not read them as a click.
      e.stopImmediatePropagation();
      if (this.points.size < 2) this.pinch = null;
      this.lastTap = null;
      return;
    }
    if (this.longPressed) {
      this.longPressed = false;
      e.stopImmediatePropagation();
      return;
    }
    if (!p) return;
    const up: Tap = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (!isTap(p.start, up)) { this.lastTap = null; return; }
    if (isDoubleTap(this.lastTap, up)) {
      this.lastTap = null;
      this.suppressDblclickUntil = up.t + 600;
      this.cb.doubleTap(up.x, up.y);
      return;
    }
    this.lastTap = up;
  };

  /** A browser that also synthesises dblclick from two taps must not activate a node twice. */
  private readonly onDblclick = (e: MouseEvent): void => {
    if (performance.now() < this.suppressDblclickUntil) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  };
}
