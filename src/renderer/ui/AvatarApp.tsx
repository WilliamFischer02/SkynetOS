import { useEffect, useRef, useState } from 'react';
import {
  avatarFrameAt,
  fitScale,
  wobbleOffset,
  DEFAULT_TIMING,
  type AvatarMood,
  type AvatarPayload,
  type AvatarTiming
} from '@shared/avatar.js';
import { COPPER, COPPER_DARK, SILK } from '@shared/palette.js';
import fontUrl from '../../../assets/fonts/DepartureMono-1.500/DepartureMono-Regular.woff2?url';
import './avatar.css';

/**
 * The JARVIS face window's page: one canvas, one face.
 *
 * Drawn a frame at a time from the frames folder (assets/avatar/jarvis), picked by avatarFrameAt,
 * at a whole-number scale, nearest neighbour, with the float added as a whole-pixel offset. The
 * canvas is only redrawn when the frame or the offset actually changes, so a face at rest costs a
 * few comparisons a frame. Main tells it when JARVIS is speaking (`avatar:mood`) and when the
 * frames folder changes (`avatar:changed`).
 *
 * Before any frames exist it shows a small placeholder face, which still blinks and still talks,
 * and says where the frames go. Never a blank window.
 */

// A 12x12 placeholder face: # copper outline, o eyes, m mouth.
const EYES_OPEN = '.#.oo..oo.#.';
const EYES_SHUT = '.#.--..--.#.';
function face(eyes: string, mouth: string[]): string[] {
  return ['...######...', '..#......#..', '.#........#.', eyes, '.#........#.', ...mouth, '.#........#.', '..#......#..', '...######...', '............'];
}
const PLACEHOLDER_FACES: Record<string, string[]> = {
  idle: face(EYES_OPEN, ['.#........#.', '.#..mmmm..#.']),
  blink: face(EYES_SHUT, ['.#........#.', '.#..mmmm..#.']),
  'talk-a': face(EYES_OPEN, ['.#..mmmm..#.', '.#..m..m..#.']),
  'talk-b': face(EYES_OPEN, ['.#...mm...#.', '.#...mm...#.'])
};
const PLACEHOLDER_SET = { idle: 'idle', blink: ['blink'], talk: ['talk-a', 'idle', 'talk-b', 'idle'] };
const PLACEHOLDER_COLORS: Record<string, string> = { '#': COPPER, o: SILK, '-': COPPER_DARK, m: SILK };

function reducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

function effectiveTiming(timing: AvatarTiming | undefined): AvatarTiming {
  const t = timing ?? DEFAULT_TIMING;
  return reducedMotion() ? { ...t, wobblePx: 0, talkFps: Math.max(1, Math.round(t.talkFps / 2)) } : t;
}

export function AvatarApp(): React.JSX.Element {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const label = params.get('label') ?? 'JARVIS';
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const moodRef = useRef<AvatarMood>('idle');
  const imagesRef = useRef(new Map<string, HTMLImageElement>());
  const indexRef = useRef(new Map<string, number>());
  const [payload, setPayload] = useState<AvatarPayload | null>(null);

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
      void window.skynet['avatar:frames']().then((next) => {
        if (!live) return;
        const images = new Map<string, HTMLImageElement>();
        const index = new Map<string, number>();
        [next.idle, ...next.blink, ...next.talk].forEach((url, i) => {
          if (!url || images.has(url)) return;
          const img = new Image();
          img.src = url;
          images.set(url, img);
          index.set(url, i);
        });
        imagesRef.current = images;
        indexRef.current = index;
        setPayload(next);
      }).catch(() => undefined);
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
    let raf = 0;
    let lastKey = '';
    const draw = (): void => {
      const t = performance.now();
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; lastKey = ''; }
      const timing = effectiveTiming(payload?.timing);
      const mood = moodRef.current;

      if (payload?.ok) {
        const frame = avatarFrameAt({ idle: payload.idle, blink: payload.blink, talk: payload.talk }, mood, t, timing);
        const img = frame.file ? imagesRef.current.get(frame.file) : undefined;
        const scale = timing.scale || fitScale({ width: payload.width, height: payload.height }, { width: w - 16, height: h - 16 });
        const dy = wobbleOffset(t, timing) * scale;
        const key = `${frame.file ? indexRef.current.get(frame.file) : 'x'}:${dy}:${w}x${h}:${scale}`;
        if (key !== lastKey && img && img.complete && img.naturalWidth > 0) {
          lastKey = key;
          ctx.clearRect(0, 0, w, h);
          ctx.imageSmoothingEnabled = false;
          const fw = payload.width * scale;
          const fh = payload.height * scale;
          ctx.drawImage(img, Math.floor((w - fw) / 2), Math.floor((h - fh) / 2) + dy, fw, fh);
        }
      } else {
        const frame = avatarFrameAt(PLACEHOLDER_SET, mood, t, timing);
        const rows = PLACEHOLDER_FACES[frame.file ?? 'idle'] ?? PLACEHOLDER_FACES['idle']!;
        const scale = Math.max(1, fitScale({ width: 12, height: 12 }, { width: w - 64, height: h - 64 }));
        const dy = wobbleOffset(t, timing) * scale;
        const key = `ph:${frame.file}:${dy}:${w}x${h}`;
        if (key !== lastKey) {
          lastKey = key;
          ctx.clearRect(0, 0, w, h);
          const ox = Math.floor((w - 12 * scale) / 2);
          const oy = Math.floor((h - 12 * scale) / 2) + dy;
          rows.forEach((row, y) => {
            [...row].forEach((c, x) => {
              const colour = PLACEHOLDER_COLORS[c];
              if (!colour) return;
              ctx.fillStyle = colour;
              ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
            });
          });
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [payload]);

  return (
    <div className="avatar-root">
      <canvas ref={canvasRef} className="avatar-canvas" aria-label={`${label} face`} />
      {payload && !payload.ok ? (
        <div className="avatar-hint" title={payload.warnings.join('\n')}>DROP FRAMES IN assets/avatar/jarvis</div>
      ) : null}
      <div className="avatar-label">{label}</div>
    </div>
  );
}
