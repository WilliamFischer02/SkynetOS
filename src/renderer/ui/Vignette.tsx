import { useEffect, useRef, useState } from 'react';
import type { BoardLook, BoardTheme } from '@shared/types.js';
import { resolveLook, vignetteCellPx, vignetteMask } from '@shared/look.js';
import { INK, hexToRgb, resolveWireToken } from '@shared/palette.js';
import './look.css';

/**
 * The room look's vignette. William: "add a vignette option".
 *
 * Pixel art, not a soft shade: docs/02 bans smooth gradients, so the darkening is an ORDERED dither
 * (Bayer 8x8, packages/shared/look.ts) of one palette colour whose density rises toward the edges.
 * It is drawn once into a small canvas, one pixel per cell, and shown at an integer multiple with
 * `image-rendering: pixelated`, so every dot is a crisp square of whole device pixels.
 *
 * Screen space, above the board and below the chrome. Rebuilt only when the window resizes or a
 * setting changes; nothing here runs per frame. Off (the default), it renders nothing at all.
 */
export function Vignette({ look, theme, uiScale }: {
  look: BoardLook | null | undefined;
  theme: BoardTheme;
  uiScale: number;
}): React.JSX.Element | null {
  const r = resolveLook(look);
  const ref = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));

  useEffect(() => {
    const onResize = () => setView({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const cell = vignetteCellPx(uiScale);
  const cols = Math.ceil(view.w / cell);
  const rows = Math.ceil(view.h / cell);
  const color = resolveWireToken(r.vignetteColor, theme, INK);

  useEffect(() => {
    const canvas = ref.current;
    if (!r.vignette || !canvas) return;
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const mask = vignetteMask(cols, rows, r.vignetteStrength);
    const image = ctx.createImageData(cols, rows);
    const [red, green, blue] = hexToRgb(color);
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const o = i * 4;
      image.data[o] = red;
      image.data[o + 1] = green;
      image.data[o + 2] = blue;
      image.data[o + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }, [r.vignette, r.vignetteStrength, color, cols, rows]);

  if (!r.vignette) return null;
  // Centred on the window by a whole number of pixels: the canvas overhangs by less than one cell,
  // split between the two sides so the dither falls off evenly on both.
  const left = -Math.floor((cols * cell - view.w) / 2);
  const top = -Math.floor((rows * cell - view.h) / 2);
  return (
    <div className="board-vignette" aria-hidden="true">
      <canvas ref={ref} style={{ width: cols * cell, height: rows * cell, left, top }} />
    </div>
  );
}
