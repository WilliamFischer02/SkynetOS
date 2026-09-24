import { useEffect } from 'react';
import type { ControlEvent } from '@shared/gesture-control.js';
import { useBoardStore } from '../store/useBoardStore.js';
import { sayAndAct } from './actOnIntent.js';
import { DEFAULT_MIRRORED, cursorFraction } from '@shared/hand-roles.js';
import { cursorElement } from './cursor-sprites.js';

/**
 * Manual control on the board: a hand becomes a pointer.
 *
 * The board already knows how to drag a node. It hit-tests, waits for a movement threshold,
 * validates the drop against every other footprint, snaps to the 16 px grid, and on release commits
 * ONE `node.move` so a single Ctrl+Z puts it back. Reimplementing that for gesture would be a second
 * copy of the subtlest code in the renderer, drifting from the first with every fix.
 *
 * So gesture does not reimplement it. It SYNTHESISES the input events the board already listens
 * for — pointer, wheel, contextmenu, keys — and everything downstream runs unchanged. Two
 * properties of BoardCanvas make that sound, and both were checked rather than assumed:
 *   - `pointermove` and `pointerup` are bound to `window`, so a drag completes wherever it ends;
 *   - `setPointerCapture` is already inside a `try`, with a comment calling it a nicety — which is
 *     exactly what a synthetic pointer id cannot provide.
 *
 * The decisions themselves are NOT made here. `packages/shared/gesture-control.ts` is the machine —
 * the certainty gate, the postures trained to be ignored, the three-second halt, the zoom lock, the
 * single-versus-double-click window — and it is pure, so all of that is tested without a camera.
 * This file is the hand that carries out what the machine decided.
 */

/** One id, never a real device's: the canvas only ever sees one gesture pointer at a time. */
const POINTER_ID = 7311;

/**
 * The slice of the camera frame that maps to the window, until calibration says otherwise.
 *
 * The middle two thirds is a guess about where a person moves their hand; the REACH phase of the
 * wizard replaces it with the box William actually swept (packages/shared/calibration.ts).
 */
const FALLBACK_REGION = { x0: 0.18, x1: 0.82, y0: 0.15, y1: 0.85 };

/** Normalised hand movement to wheel pixels. A quarter of the frame is about one screen of text. */
const SCROLL_SCALE = 1400;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export function useGesture(): void {
  const setGestureStatus = useBoardStore((s) => s.setGestureStatus);

  useEffect(() => {
    const store = useBoardStore;
    let grabbing = false;
    let last: { x: number; y: number } | null = null;
    let region = FALLBACK_REGION;
    /** Whether the driving camera hands over a mirror image, as the AIM phase measured it. */
    let mirrored = DEFAULT_MIRRORED;

    /**
     * Use the calibrated reach if there is one. Re-read whenever manual control changes state, which
     * covers the wizard finishing: a calibration saved and then not used would be worse than never
     * having asked for it.
     */
    const loadRegion = (): void => {
      if (typeof window.skynet['gesture:calibration'] !== 'function') return;
      void window.skynet['gesture:calibration']()
        .then((profile) => {
          if (!profile) { region = FALLBACK_REGION; mirrored = DEFAULT_MIRRORED; return; }
          const driver = profile.cameras.find((camera) => camera.label === profile.driver) ?? profile.cameras[0];
          if (driver) {
            region = driver.region;
            mirrored = driver.mirrored ?? DEFAULT_MIRRORED;
          }
        })
        .catch(() => { region = FALLBACK_REGION; });
    };
    loadRegion();

    /** The surface the hand drives: the MATRIX globe while it is open, the board otherwise. */
    const canvas = (): HTMLCanvasElement | null =>
      document.querySelector<HTMLCanvasElement>('.matrix-host canvas') ?? document.querySelector<HTMLCanvasElement>('.board-host canvas');

    /**
     * Normalised camera coordinates to viewport pixels.
     *
     * William, 2026-09-12: "when moved the cursor movement in the program should mirror the hand's
     * movement." Which way that is depends on the camera, so it comes from the driving camera's measured
     * mirroring (cursorFraction in hand-roles.ts), not from an assumption about every webcam.
     */
    const toScreen = (x: number, y: number): { x: number; y: number } | null => {
      const element = canvas();
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      const u = cursorFraction(x, region, mirrored);
      const v = clamp01((y - region.y0) / (region.y1 - region.y0));
      return { x: Math.round(bounds.left + u * bounds.width), y: Math.round(bounds.top + v * bounds.height) };
    };

    const pointerInit = (at: { x: number; y: number }, buttons: number, button: number): PointerEventInit => ({
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      pointerId: POINTER_ID,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: at.x,
      clientY: at.y,
      button,
      buttons
    });

    const fire = (type: 'pointerdown' | 'pointermove' | 'pointerup', at: { x: number; y: number }): void => {
      const element = canvas();
      if (!element) return;
      const buttons = type === 'pointerup' ? 0 : grabbing ? 1 : 0;
      element.dispatchEvent(new PointerEvent(type, pointerInit(at, buttons, type === 'pointermove' ? -1 : 0)));
    };

    /** A whole click: down and up in the same place, as a mouse would deliver it. */
    const click = (at: { x: number; y: number }, count: 1 | 2): void => {
      const element = canvas();
      if (!element) return;
      element.dispatchEvent(new PointerEvent('pointerdown', pointerInit(at, 1, 0)));
      element.dispatchEvent(new PointerEvent('pointerup', pointerInit(at, 0, 0)));
      if (count === 2) {
        // The board opens a node on a double click; it listens for the real event, so send it.
        element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y }));
      }
    };

    const rightClick = (at: { x: number; y: number }): void => {
      const element = canvas();
      if (!element) return;
      element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, button: 2 }));
    };

    /** Wheel on whatever is under the hand, so a panel scrolls rather than always the board. */
    const scroll = (at: { x: number; y: number }, dx: number, dy: number): void => {
      const target = document.elementFromPoint(at.x, at.y) ?? canvas();
      target?.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: at.x,
          clientY: at.y,
          // Hand down scrolls the content down, as dragging a page would.
          deltaX: -dx * SCROLL_SCALE,
          deltaY: -dy * SCROLL_SCALE
        })
      );
    };

    /*
     * Zoom about a point, through the board's own wheel: BoardCanvas's `onWheel` steps one exact zoom level
     * per event and keeps the world point under the pointer where it is. William, 2026-09-12: "zoom should
     * always happen on where the cursor is." It used to press + and -, which zoom about the middle of the
     * window. The MATRIX listens for the same wheel.
     */
    const zoomAt = (at: { x: number; y: number }, direction: 'in' | 'out'): void => {
      canvas()?.dispatchEvent(
        new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, deltaY: direction === 'in' ? -100 : 100 })
      );
    };

    // A classic arrow, and a closed hand while something is held (cursor-sprites.ts).
    const pointer = cursorElement();
    pointer.hidden = true;
    document.body.append(pointer);
    /*
     * Moved by writing to the element, never through React state. At 26 events a second a stateful
     * cursor would re-render the whole chrome to move one dot.
     */
    const place = (at: { x: number; y: number }): void => {
      pointer.hidden = false;
      pointer.style.transform = `translate(${at.x}px, ${at.y}px)`;
      pointer.dataset['grabbing'] = grabbing ? '1' : '0';
    };

    const onEvent = (event: ControlEvent): void => {
      switch (event.type) {
        case 'cursor': {
          const at = toScreen(event.x, event.y);
          if (!at) return;
          last = at;
          place(at);
          fire('pointermove', at);
          return;
        }
        case 'click': {
          // Where the machine says it lands, which can be a few pixels back from the last cursor drawn.
          const at = toScreen(event.x, event.y) ?? last;
          if (!at) return;
          last = at;
          place(at);
          fire('pointermove', at);
          if (event.button === 'right') rightClick(at);
          else click(at, event.count);
          return;
        }
        case 'dragStart': {
          const at = toScreen(event.x, event.y) ?? last;
          if (!at) return;
          grabbing = true;
          store.getState().setInputSource('gesture');
          place(at);
          fire('pointerdown', at);
          return;
        }
        case 'dragMove': {
          const at = toScreen(event.x, event.y) ?? last;
          if (!at) return;
          last = at;
          place(at);
          fire('pointermove', at);
          return;
        }
        case 'dragEnd': {
          const at = toScreen(event.x, event.y) ?? last;
          if (!at) return;
          fire('pointerup', at);
          grabbing = false;
          place(at);
          // Left as `gesture` briefly: the drop commits asynchronously and must stay attributed to
          // the hand that made it when it lands.
          window.setTimeout(() => { if (!grabbing) store.getState().setInputSource('user'); }, 1200);
          return;
        }
        case 'scroll': {
          if (!last) return;
          scroll(last, event.dx, event.dy);
          return;
        }
        case 'zoom': {
          const at = toScreen(event.x, event.y) ?? last;
          if (!at) return;
          zoomAt(at, event.direction);
          return;
        }
        case 'zoomLocked': {
          store.getState().toast('ok', 'ZOOM LOCKED — OPEN YOUR HANDS AND START AGAIN');
          return;
        }
        case 'suppressed': {
          // Working, not gesturing: the pointer goes away so nothing looks live while it is not.
          pointer.hidden = true;
          grabbing = false;
          return;
        }
        case 'resumed': {
          if (last) place(last);
          return;
        }
        case 'stopControl': {
          /*
           * CLOSE THE BOOK. Main has already switched the cameras off (services/vision.ts) — this
           * is only the board tidying up after itself, because a pointer left on screen after
           * the hand that drove it has gone is a lie about what is still listening.
           */
          pointer.hidden = true;
          grabbing = false;
          store.getState().toast('ok', 'MANUAL CONTROL OFF');
          return;
        }
        case 'gesture': {
          /*
           * A gesture William trained, carrying WORDS. They go through exactly the grammar a spoken
           * command goes through — one bus, several producers — so a gesture can do anything he
           * could say, and nothing he could not.
           */
          void sayAndAct(event.utterance, 'gesture').then((said) => {
            store.getState().toast('ok', `${event.name} — ${said}`);
          });
          return;
        }
      }
    };

    const offEvent = window.skynet.on('gesture:event', onEvent);
    const offState = window.skynet.on('gesture:state', (status) => {
      setGestureStatus(status);
      // The wizard reloads the camera page, which lands here as a state change: pick up whatever
      // calibration it just wrote.
      if (status.phase === 'starting' || status.phase === 'watching') loadRegion();
      if (status.phase === 'off' || status.phase === 'unavailable') {
        // The cameras stopped mid-drag: end it where it was rather than leaving a node attached to
        // a cursor that will never move again.
        if (grabbing && last) { fire('pointerup', last); grabbing = false; }
        pointer.hidden = true;
        store.getState().setInputSource('user');
      }
    });

    // What is already going on, for a window that opened after the cameras did.
    if (typeof window.skynet['gesture:status'] === 'function') {
      void window.skynet['gesture:status']().then(setGestureStatus).catch(() => undefined);
    }

    return () => {
      offEvent();
      offState();
      pointer.remove();
    };
  }, [setGestureStatus]);
}
