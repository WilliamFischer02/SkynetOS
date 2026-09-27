import { useEffect, useRef, useState } from 'react';
import { DEFAULT_TIMING, fitScale, wobbleOffset, type AvatarMood, type AvatarTiming } from '@shared/avatar.js';
import {
  HOLOGRAM_PALETTE,
  SPHERE_SIZE,
  applyScanlines,
  flickerAt,
  paletteFor,
  renderSphere,
  type HologramMood
} from '@shared/hologram.js';
import fontUrl from '../../../assets/fonts/DepartureMono-1.500/DepartureMono-Regular.woff2?url';
import './avatar.css';

/**
 * The JARVIS face window's page: one canvas, one orb.
 *
 * William, 2026-09-26: "replace the jarvis head sprite in every window it spawns in with the
 * jarvis voice orb instead, as I like it better." So the window that docks beside a Face
 * conversation or a Prime terminal now shows the same Bayer-dithered sphere the JARVIS Voice
 * window shows (`renderSphere`, packages/shared/hologram.ts), at a whole-number scale, nearest
 * neighbour, with the head's float kept as a whole-pixel offset. The head frames stay on disk and
 * `avatar:frames` still answers; this page only reads its `timing` (avatar.json's wobble and
 * scale), so a folder tuned for the head still tunes the orb.
 *
 * Mood is the same signal the head had (`avatar:mood`: speaking or idle). While speaking, the
 * orb's level breathes at the head's old mouth cadence, so the talking rhythm is unchanged.
 */

function reducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

function effectiveTiming(timing: AvatarTiming | undefined): AvatarTiming {
  const t = timing ?? DEFAULT_TIMING;
  return reducedMotion() ? { ...t, wobblePx: 0, talkFps: Math.max(1, Math.round(t.talkFps / 2)) } : t;
}

/** The orb's mood for the face window's two states. */
export function orbMood(mood: AvatarMood): HologramMood {
  return mood === 'speaking' ? 'speaking' : 'idle';
}

/**
 * The speech level the orb breathes with, 0..1. Speaking: a cadence at half the mouth rate
 * (a mouth opens and closes per frame pair), between 0.35 and 0.9. Idle: a slow, faint breath.
 */
export function orbLevel(mood: AvatarMood, t: number, talkFps: number): number {
  if (mood === 'speaking') {
    const hz = Math.max(0.5, talkFps / 2);
    return 0.35 + 0.55 * (0.5 + 0.5 * Math.sin((t / 1000) * hz * Math.PI * 2));
  }
  return 0.06 + 0.04 * (0.5 + 0.5 * Math.sin((t / 1000) * 0.25 * Math.PI * 2));
}

export function AvatarApp(): React.JSX.Element {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const label = params.get('label') ?? 'JARVIS';
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const moodRef = useRef<AvatarMood>('idle');
  const [timing, setTiming] = useState<AvatarTiming | undefined>(undefined);

  // The chrome font, loaded into this window's own document.
  useEffect(() => {
    try {
      const font = new FontFace('Departure Mono', `url(${fontUrl})`);
      void font.load().then((f) => document.fonts.add(f)).catch(() => undefined);
    } catch { /* the fallback monospace is fine */ }
  }, []);

  useEffect(() => {
    let live = true;
    const load = (): void => {
      if (typeof window.skynet['avatar:frames'] !== 'function') return;
      void window.skynet['avatar:frames']().then((next) => { if (live) setTiming(next.timing); }).catch(() => undefined);
    };
    load();
    const offChanged = window.skynet.on('avatar:changed', () => load());
    const offMood = window.skynet.on('avatar:mood', (p) => { moodRef.current = p.mood; });
    return () => { live = false; offChanged(); offMood(); };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const buffer = document.createElement('canvas');
    buffer.width = SPHERE_SIZE;
    buffer.height = SPHERE_SIZE;
    const bctx = buffer.getContext('2d');
    if (!bctx) return;
    const image = bctx.createImageData(SPHERE_SIZE, SPHERE_SIZE);
    const rgb = new Map<string, [number, number, number]>();
    const colourOf = (hex: string): [number, number, number] => {
      let c = rgb.get(hex);
      if (!c) {
        c = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
        rgb.set(hex, c);
      }
      return c;
    };
    let raf = 0;
    let lastKey = '';
    const reduced = reducedMotion();
    const draw = (): void => {
      const t = performance.now();
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; lastKey = ''; }
      const tm = effectiveTiming(timing);
      const mood = moodRef.current;
      // The sphere animates at 30 fps, like the JARVIS window; between ticks the frame is the same.
      const tick = Math.floor(t / 33);
      const scale = tm.scale || Math.max(1, fitScale({ width: SPHERE_SIZE, height: SPHERE_SIZE }, { width: w - 16, height: h - 16 }));
      const dy = wobbleOffset(t, tm) * scale;
      const key = `${tick}:${mood}:${dy}:${w}x${h}:${scale}`;
      if (key !== lastKey) {
        lastKey = key;
        const orb = orbMood(mood);
        const flicker = flickerAt(t, reduced);
        const indices = applyScanlines(
          renderSphere({ size: SPHERE_SIZE, t, mood: orb, level: orbLevel(mood, t, tm.talkFps), reducedMotion: reduced, flicker }),
          SPHERE_SIZE
        );
        const palette = paletteFor(orb);
        const data = image.data;
        for (let i = 0; i < indices.length; i++) {
          const index = indices[i] ?? 0;
          const o = i * 4;
          if (index === 0) { data[o + 3] = 0; continue; }
          const [r, g, b] = colourOf(palette[index] ?? HOLOGRAM_PALETTE[0]);
          data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
        }
        bctx.putImageData(image, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.imageSmoothingEnabled = false;
        const side = SPHERE_SIZE * scale;
        ctx.drawImage(buffer, Math.floor((w - side) / 2), Math.floor((h - side) / 2) + dy, side, side);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [timing]);

  return (
    <div className="avatar-root">
      <canvas ref={canvasRef} className="avatar-canvas" aria-label={`${label} face`} />
      <div className="avatar-label">{label}</div>
    </div>
  );
}
