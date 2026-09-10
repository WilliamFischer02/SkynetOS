import { useEffect, useRef } from 'react';
import { useBoardStore } from '../store/useBoardStore.js';

/**
 * The room transition: a hard-edged 8-step iris wipe in mask-dark, 400ms total.
 * docs/02-VISUAL-LANGUAGE.md §Animation.
 *
 * Hard-edged is the whole point. A CSS fade would be a smooth alpha ramp across every pixel on
 * screen — the exact opposite of what this project is. So it is drawn as an aperture that closes
 * in **eight discrete steps**, each one a set of flat filled rectangles, on a 2D canvas at 1:1
 * device pixels. No easing curve, no interpolation, no partial alpha anywhere: at any instant the
 * screen is either mask-dark or it is not.
 *
 * It lives in the DOM rather than in the Pixi scene deliberately. The board's Pixi application is
 * torn down and rebuilt when the board changes, which is precisely the moment the iris has to be
 * covering the screen — an overlay tied to that lifecycle would blink out at the worst possible
 * frame.
 */

const STEPS = 8;
const STEP_MS = 25;

export function Iris(): React.JSX.Element | null {
  const transition = useBoardStore((s) => s.transition);
  const maskDark = useBoardStore((s) => s.board?.theme.maskDark ?? '#0E1A14');
  const setTransition = useBoardStore((s) => s.setTransition);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!transition) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    let raf = 0;
    let step = transition === 'closing' ? 0 : STEPS;
    let last = performance.now();
    let cancelled = false;

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // `step` counts how far the iris has CLOSED: 0 is wide open, STEPS is fully covered.
      // The aperture is a centred rectangle; everything outside it is flat mask-dark.
      const t = step / STEPS;
      const apertureW = Math.round((w * (1 - t)) / 2) * 2;
      const apertureH = Math.round((h * (1 - t)) / 2) * 2;
      const x = Math.round((w - apertureW) / 2);
      const y = Math.round((h - apertureH) / 2);

      ctx.fillStyle = maskDark;
      ctx.fillRect(0, 0, w, y);
      ctx.fillRect(0, y + apertureH, w, h - y - apertureH);
      ctx.fillRect(0, y, x, apertureH);
      ctx.fillRect(x + apertureW, y, w - x - apertureW, apertureH);
    };

    const tick = (now: number) => {
      if (cancelled) return;
      if (now - last >= STEP_MS) {
        last = now;
        step += transition === 'closing' ? 1 : -1;

        if (transition === 'closing' && step >= STEPS) {
          step = STEPS;
          draw();
          // Stay fully closed. The store swaps the board and then flips us to 'opening'.
          return;
        }
        if (transition === 'opening' && step <= 0) {
          setTransition(null);
          return;
        }
      }
      draw();
      raf = requestAnimationFrame(tick);
    };

    const resize = () => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      draw();
    };
    resize();
    window.addEventListener('resize', resize);
    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [transition, maskDark, setTransition]);

  if (!transition) return null;
  return <canvas className="iris" ref={canvasRef} aria-hidden="true" />;
}
